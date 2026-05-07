process.setMaxListeners(100);

// Suppress TargetCloseError from puppeteer-extra-plugin-stealth race conditions
process.on('unhandledRejection', (reason, promise) => {
  if (reason && (reason.message?.includes('Session closed') || reason.name === 'TargetCloseError')) {
    console.warn('⚠️ Suppressed TargetCloseError (page closed during stealth plugin init)');
    return;
  }
  console.error('Unhandled Rejection:', reason);
});

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { scrapeProxies, parseCustomProxies } = require('./src/proxyScraper');
const { accessWithProxy, verifyProxy } = require('./src/accessor');
const { recordProxyResult, filterProxiesByHistory, getHistoryStats } = require('./src/proxyHistory');
const { getProxies: getCachedProxies, getValidatedProxies, getCacheStats, clearCache: clearProxyCache, removeFromCache } = require('./src/proxyCache');
const { filterProxiesByCountry } = require('./src/countryFilter');
const { sendDiscordNotification } = require('./src/discordNotifier');
const { invalidateProxy, getValidationCacheStats } = require('./src/proxyValidator');
const BackgroundTaskManager = require('./src/backgroundTask');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 120000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e7
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Background task manager
const bgTaskManager = new BackgroundTaskManager(io);

let isRunning = false;
let activeConnections = new Map();

// API: Get fresh proxies
app.get('/api/proxies', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const cacheResult = await getCachedProxies({ forceRefresh });
    res.json({ success: true, count: cacheResult.proxies.length, proxies: cacheResult.proxies, fromCache: cacheResult.fromCache, cacheAge: cacheResult.cacheAge });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Stop current task
app.post('/api/stop', (req, res) => {
  isRunning = false;
  res.json({ success: true, message: 'Stopped' });
});

// === BACKGROUND TASK API ===

// Start background task (no client needed)
app.post('/api/background/start', async (req, res) => {
  const result = await bgTaskManager.start(req.body);
  res.json(result);
});

// Stop background task
app.post('/api/background/stop', (req, res) => {
  bgTaskManager.stop();
  res.json({ success: true, message: 'Background task stopped' });
});

// Get background task status
app.get('/api/background/status', (req, res) => {
  res.json(bgTaskManager.getStatus());
});

// Get background task logs
app.get('/api/background/logs', (req, res) => {
  const offset = parseInt(req.query.offset) || 0;
  const limit = parseInt(req.query.limit) || 100;
  res.json({ logs: bgTaskManager.getLogs(offset, limit), total: bgTaskManager.logs.length });
});

// Get background task results
app.get('/api/background/results', (req, res) => {
  const offset = parseInt(req.query.offset) || 0;
  const limit = parseInt(req.query.limit) || 50;
  res.json({ results: bgTaskManager.getResults(offset, limit), total: bgTaskManager.results.length });
});

// Resume background task
app.post('/api/background/resume', async (req, res) => {
  const result = await bgTaskManager.resume();
  res.json(result);
});

// Check if there's a resumable state
app.get('/api/background/resumable', (req, res) => {
  res.json({
    hasResumable: bgTaskManager.hasResumableState(),
    info: bgTaskManager.getResumableInfo()
  });
});

// === PROXY CACHE API ===
app.get('/api/cache/status', (req, res) => {
  res.json({
    cache: getCacheStats(),
    validation: getValidationCacheStats()
  });
});

app.post('/api/cache/clear', (req, res) => {
  clearProxyCache();
  res.json({ success: true, message: 'Proxy cache cleared' });
});

/**
 * Run tasks in parallel with concurrency limit
 */
async function runParallel(tasks, concurrency) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < tasks.length && isRunning) {
      const currentIndex = index++;
      try {
        const result = await tasks[currentIndex]();
        results[currentIndex] = result;
      } catch (error) {
        results[currentIndex] = { error: error.message };
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, tasks.length); i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

// Socket.IO for real-time updates
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  activeConnections.set(socket.id, { running: false });

  socket.on('start-access', async (data) => {
    const { url, urls: rawUrls, verifyUrl = '', totalAccess, useHeadless, concurrency = 5, delayMin = 500, delayMax = 2000, loopMode = false, loopCount = 1, proxySource = 'auto', customProxies = '', countryWhitelist = [], discordWebhook = '' } = data;
    
    // Support multiple URLs - use urls array if provided, otherwise fall back to single url
    const urls = (rawUrls && rawUrls.length > 0) ? rawUrls : (url ? [url] : []);
    const primaryUrl = urls[0] || url;
    
    if (isRunning) {
      socket.emit('error', { message: 'A task is already running. Please stop it first.' });
      return;
    }

    isRunning = true;
    activeConnections.set(socket.id, { running: true });
    const taskStartTime = Date.now();

    const isInfinite = loopMode && loopCount === -1;
    const totalLoops = isInfinite ? Infinity : (loopMode ? loopCount : 1);
    let successCount = 0;
    let failCount = 0;
    let completedCount = 0;
    // Cumulative counters across all loops (for infinite mode)
    let totalSuccessCount = 0;
    let totalFailCount = 0;
    let totalCompletedCount = 0;
    let currentLoop = 0;
    
    for (let loop = 0; (isInfinite ? true : loop < totalLoops); loop++) {
      if (!isRunning) break;

      currentLoop = loop + 1;

      if (loopMode && !isInfinite && totalLoops > 1) {
        socket.emit('log', { message: `\n🔁 Loop ${loop + 1}/${totalLoops}` });
      } else if (isInfinite) {
        socket.emit('log', { message: `\n🔁 Loop ${loop + 1} (unlimited)` });
      }

      try {
        let proxies = [];
        let proxiesValidated = false;

        if (proxySource === 'custom' && customProxies.trim()) {
          // Use custom proxies provided by user
          socket.emit('log', { message: '📋 Parsing custom proxies...' });
          proxies = parseCustomProxies(customProxies);
          
          if (proxies.length === 0) {
            socket.emit('error', { message: '❌ No valid proxies found in custom input. Format: ip:port per line.' });
            isRunning = false;
            return;
          }
          
          socket.emit('log', { message: `✅ Loaded ${proxies.length} custom proxies` });
        } else {
          // Auto-scrape proxies (with caching + TCP validation)
          socket.emit('log', { message: '🔄 Loading proxies (cached or fresh scrape + TCP validation)...' });
          
          const cacheResult = await getValidatedProxies({
            tcpTimeout: 4000,
            concurrency: 100,
            onValidationProgress: (validated, total, validCount) => {
              if (validated % 25 === 0 || validated === total) {
                socket.emit('log', { message: `  🔍 Validating: ${validated}/${total} checked, ${validCount} reachable` });
              }
            }
          });
          const allProxies = cacheResult.proxies;
          
          if (cacheResult.fromCache) {
            socket.emit('log', { message: `📦 Using cached proxies (age: ${cacheResult.cacheAge}s)` });
          } else {
            socket.emit('log', { message: `🔄 Fresh scrape completed: ${cacheResult.totalScraped} proxies found` });
          }
          
          if (cacheResult.validated && cacheResult.validationStats) {
            if (cacheResult.validationStats.fallbackUsed) {
              socket.emit('log', { message: `⚠️ TCP Validation: 0/${cacheResult.validationStats.total} reachable - FALLBACK MODE: using all proxies anyway (firewall may block TCP probes)` });
            } else {
              socket.emit('log', { message: `✅ TCP Validation: ${cacheResult.validationStats.validCount}/${cacheResult.validationStats.total} reachable (avg latency: ${cacheResult.validationStats.avgLatencyMs}ms)` });
            }
          }
          
          // Use all proxies (filter out only Unknown country if we have enough)
          proxies = allProxies.filter(p => p.country && p.country !== 'Unknown');
          
          // If too few proxies have known country, include all validated proxies
          if (proxies.length < 10 && allProxies.length > proxies.length) {
            socket.emit('log', { message: `⚠️ Only ${proxies.length} proxies with known country, including all ${allProxies.length} validated proxies` });
            proxies = allProxies;
          } else {
            socket.emit('log', { message: `✅ ${proxies.length} validated proxies with known country (Elite: ${proxies.filter(p => p.anonymity === 'elite').length})` });
          }
          
          // Apply country whitelist filter if specified
          if (countryWhitelist && countryWhitelist.length > 0) {
            const beforeCount = proxies.length;
            proxies = filterProxiesByCountry(proxies, countryWhitelist);
            socket.emit('log', { message: `🌍 Country whitelist [${countryWhitelist.join(', ')}]: ${proxies.length}/${beforeCount} proxies matched` });
          }
          
          if (proxies.length === 0) {
            socket.emit('log', { message: '⚠️ No proxies matched filters, using all proxies...' });
            if (allProxies.length === 0) {
              socket.emit('error', { message: '❌ No proxies found. Please try again.' });
              isRunning = false;
              return;
            }
            proxies.push(...allProxies);
          }
          proxiesValidated = true;
        }

        // === PROXY HISTORY FILTERING ===
        // Pass validated flag so currently-validated proxies are not excluded by stale history
        const historyResult = filterProxiesByHistory(primaryUrl, proxies, { validated: proxiesValidated });
        const historyStats = getHistoryStats(primaryUrl);
        
        if (historyStats.successCount > 0 || historyStats.failedCount > 0) {
          socket.emit('log', {
            message: `📋 Proxy History: ${historyStats.successCount} known good, ${historyStats.failedCount} known bad`
          });
        }
        
        // Reorder proxies: success first, then unused, exclude failed
        if (historyResult.prioritized.length > 0 || historyResult.failed.length > 0) {
          const filteredProxies = [...historyResult.prioritized, ...historyResult.unused];
          socket.emit('log', {
            message: `🔀 Proxy priority: ${historyResult.stats.successKnown} proven good → ${historyResult.stats.unused} new/untested | ${historyResult.stats.failedExcluded} excluded (previously failed)`
          });
          
          if (filteredProxies.length > 0) {
            proxies = filteredProxies;
          } else {
            socket.emit('log', { message: `⚠️ All proxies were previously failed - using all proxies anyway` });
          }
        }

        // Random URL picker for multiple URLs
        function getRandomUrl() {
          return urls[Math.floor(Math.random() * urls.length)];
        }

        socket.emit('proxies-count', { count: proxies.length, list: proxies.map(p => `${p.ip}:${p.port}`) });
        if (urls.length > 1) {
          socket.emit('log', { message: `🌐 ${urls.length} Target URLs (random distribution):` });
          urls.forEach((u, i) => socket.emit('log', { message: `   ${i+1}. ${u}` }));
        }
        socket.emit('log', { message: `🚀 Starting ${totalAccess} access(es) to: ${urls.length > 1 ? urls.length + ' URLs' : primaryUrl}` });
        if (verifyUrl) {
          socket.emit('log', { message: `🔍 Verify URL: ${verifyUrl} (proxy must return 200 before proceeding)` });
        }
        socket.emit('log', { message: `🖥️ Mode: ${useHeadless ? 'Headless Browser' : 'Visible Browser'} | Proxy: ${proxySource === 'custom' ? 'Custom' : 'Auto-Scrape'}` });
        socket.emit('log', { message: `⚡ Concurrency: ${concurrency} parallel requests` });
        socket.emit('log', { message: `⏱️ Delay: ${delayMin}ms - ${delayMax}ms between batches` });
        if (countryWhitelist && countryWhitelist.length > 0) {
          socket.emit('log', { message: `🌍 Country Whitelist: ${countryWhitelist.join(', ')}` });
        }

        // Reset per-loop counters for each loop iteration
        successCount = 0;
        failCount = 0;
        completedCount = 0;
        let proxyUsageIndex = 0;

        // Shuffle proxies for randomness
        const shuffledProxies = [...proxies].sort(() => Math.random() - 0.5);

        // Function to get next proxy (round-robin through known proxies)
        function getNextProxy() {
          const proxy = shuffledProxies[proxyUsageIndex % shuffledProxies.length];
          proxyUsageIndex++;
          return proxy;
        }

        // Create tasks array
        const tasks = [];
        for (let i = 0; i < totalAccess; i++) {
          const taskIndex = i;

          tasks.push(async () => {
            if (!isRunning) return null;

            // Pick a random URL from the list for this task
            const targetUrl = getRandomUrl();

            // Random delay within range
            const delay = Math.floor(Math.random() * (delayMax - delayMin)) + delayMin;
            await new Promise(resolve => setTimeout(resolve, delay));

            if (!isRunning) return null;

            // Try with retry logic - if proxy fails, try another one
            // More retries when verify URL is set (need to find working proxy first)
            const maxRetries = verifyUrl ? 5 : 3;
            let lastError = null;

            for (let attempt = 0; attempt < maxRetries; attempt++) {
              if (!isRunning) return null;

              const proxy = getNextProxy();

              if (attempt === 0) {
                socket.emit('log', {
                  message: `[${taskIndex + 1}/${totalAccess}] Using proxy: ${proxy.ip}:${proxy.port} (${proxy.country})`
                });
              } else {
                socket.emit('log', {
                  message: `  🔄 Retry #${attempt} with proxy: ${proxy.ip}:${proxy.port} (${proxy.country})`
                });
              }

              try {
                // === VERIFY PROXY FIRST (if verifyUrl is set) ===
                if (verifyUrl) {
                  socket.emit('log', {
                    message: `  🔍 [${taskIndex + 1}] Verifying proxy on: ${verifyUrl}`
                  });
                  
                  const verifyResult = await verifyProxy(verifyUrl, proxy);
                  
                  if (!verifyResult.success) {
                    socket.emit('log', {
                      message: `  ⚠️ [${taskIndex + 1}] Verify failed (status: ${verifyResult.statusCode}) - switching proxy...`
                    });
                    // Record verify failure in history
                    recordProxyResult(targetUrl, proxy, false);
                    // Skip to next retry with different proxy
                    lastError = new Error(`Verify failed: status ${verifyResult.statusCode}`);
                    await new Promise(resolve => setTimeout(resolve, 300));
                    continue;
                  }
                  
                  socket.emit('log', {
                    message: `  ✅ [${taskIndex + 1}] Verify passed (200) - proceeding to target URL`
                  });
                }

                // === ACCESS TARGET URL ===
                const result = await accessWithProxy(targetUrl, proxy, useHeadless);
                successCount++;
                completedCount++;
                totalSuccessCount++;
                totalCompletedCount++;
                
                // Record proxy success in history
                recordProxyResult(targetUrl, proxy, true);
                
                socket.emit('result', {
                  index: taskIndex + 1,
                  proxy: `${proxy.ip}:${proxy.port}`,
                  country: proxy.country,
                  status: 'success',
                  statusCode: result.statusCode,
                  responseTime: result.responseTime,
                  title: result.title || 'N/A',
                  targetUrl: urls.length > 1 ? targetUrl : undefined
                });
                socket.emit('log', {
                  message: `  ✅ [${taskIndex + 1}] Success! Status: ${result.statusCode} | Time: ${result.responseTime}ms${urls.length > 1 ? ' | URL: ' + targetUrl.substring(0, 50) : ''}`
                });
                socket.emit('progress', {
                  completed: completedCount,
                  total: totalAccess,
                  success: successCount,
                  failed: failCount,
                  isInfinite,
                  currentLoop,
                  totalCompleted: totalCompletedCount,
                  totalSuccess: totalSuccessCount,
                  totalFailed: totalFailCount
                });

                return result;
              } catch (error) {
                lastError = error;
                // Record proxy failure in history
                recordProxyResult(targetUrl, proxy, false);
                
                const errMsg = error.message || '';
                
                // Handle dead proxy - remove from cache and invalidate
                if (errMsg.includes('unreachable') || errMsg.includes('ERR_PROXY_CONNECTION_FAILED') ||
                    errMsg.includes('ERR_TUNNEL_CONNECTION_FAILED') || errMsg.includes('ERR_CONNECTION_REFUSED') ||
                    errMsg.includes('TCP pre-check failed')) {
                  removeFromCache(proxy.ip, proxy.port);
                  invalidateProxy(proxy);
                  if (attempt < maxRetries - 1) {
                    socket.emit('log', {
                      message: `  💀 [${taskIndex + 1}] Proxy DEAD: ${proxy.ip}:${proxy.port} - removed, trying next...`
                    });
                  }
                  await new Promise(resolve => setTimeout(resolve, 200));
                } else if (attempt < maxRetries - 1) {
                  socket.emit('log', {
                    message: `  ⚠️ [${taskIndex + 1}] Failed with ${proxy.ip}:${proxy.port}: ${errMsg.substring(0, 100)} - retrying...`
                  });
                  // Small delay before retry
                  await new Promise(resolve => setTimeout(resolve, 500));
                }
              }
            }

            // All proxy retries failed
            if (!isRunning) return null;

            failCount++;
            completedCount++;
            totalFailCount++;
            totalCompletedCount++;
            
            socket.emit('result', {
              index: taskIndex + 1,
              proxy: 'multiple',
              status: 'failed',
              error: `All ${maxRetries} proxy retries failed: ${lastError.message}`
            });
            socket.emit('log', {
              message: `  ❌ [${taskIndex + 1}] Failed after ${maxRetries} proxy retries: ${lastError.message}`
            });
            socket.emit('progress', {
              completed: completedCount,
              total: totalAccess,
              success: successCount,
              failed: failCount,
              isInfinite,
              currentLoop,
              totalCompleted: totalCompletedCount,
              totalSuccess: totalSuccessCount,
              totalFailed: totalFailCount
            });

            return null;
          });
        }

        // Run tasks with concurrency limit
        await runParallel(tasks, concurrency);

        socket.emit('log', {
          message: `\n📊 Summary: ${successCount} success, ${failCount} failed out of ${totalAccess} total`
        });

        // Auto-refresh proxy cache if success rate is too low (< 20%)
        if (proxySource !== 'custom' && completedCount > 0) {
          const successRate = successCount / completedCount;
          if (successRate < 0.2) {
            socket.emit('log', { message: `⚠️ Low success rate (${Math.round(successRate * 100)}%) - refreshing proxy cache for next loop...` });
            clearProxyCache();
            socket.emit('log', { message: '🔄 Proxy cache cleared. Fresh proxies will be scraped on next loop.' });
          }
        }

        if (!isInfinite && (loop === totalLoops - 1 || !isRunning)) {
          socket.emit('complete', { successCount, failCount, total: totalAccess });
        }

      } catch (error) {
        socket.emit('log', { message: `❌ Error in loop ${loop + 1}: ${error.message}` });
        if (!isInfinite) {
          socket.emit('error', { message: `❌ Error: ${error.message}` });
          break;
        }
        // In infinite mode, log error and continue to next loop
        socket.emit('log', { message: `⏳ Retrying in 5s...` });
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }

      // Delay between loops
      if (loopMode && (isInfinite || loop < totalLoops - 1) && isRunning) {
        socket.emit('log', { message: `⏳ Waiting 3s before next loop...` });
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    // Send Discord notification on task complete
    if (discordWebhook) {
      const duration = Date.now() - taskStartTime;
      sendDiscordNotification(discordWebhook, {
        successCount: totalSuccessCount || successCount,
        failCount: totalFailCount || failCount,
        total: totalCompletedCount || completedCount,
        url: primaryUrl,
        urls,
        duration,
        mode: 'normal'
      }).then(sent => {
        if (sent) socket.emit('log', { message: '📨 Discord notification sent!' });
      }).catch(() => {});
    }

    isRunning = false;
    activeConnections.set(socket.id, { running: false });
  });

  socket.on('stop', () => {
    isRunning = false;
    activeConnections.set(socket.id, { running: false });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    activeConnections.delete(socket.id);
    // Don't stop running tasks on disconnect - let them continue
    // Tasks should only stop via explicit 'stop' event or /api/stop
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
