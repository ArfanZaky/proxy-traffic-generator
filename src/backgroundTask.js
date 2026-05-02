const { scrapeProxies, parseCustomProxies } = require('./proxyScraper');
const { accessWithProxy, verifyProxy } = require('./accessor');
const { recordProxyResult, filterProxiesByHistory, getHistoryStats } = require('./proxyHistory');
const { getProxies: getCachedProxies } = require('./proxyCache');

/**
 * Background Task Manager
 * Runs tasks independently of client WebSocket connection
 */
class BackgroundTaskManager {
  constructor(io) {
    this.io = io;
    this.task = null; // Current running task
    this.logs = []; // Store last 500 logs
    this.results = []; // Store last 1000 results
    this.maxLogs = 500;
    this.maxResults = 1000;
  }

  getStatus() {
    if (!this.task) {
      return { running: false, task: null };
    }
    return {
      running: this.task.running,
      task: {
        url: this.task.url,
        urls: this.task.urls,
        totalAccess: this.task.totalAccess,
        successCount: this.task.successCount,
        failCount: this.task.failCount,
        completedCount: this.task.completedCount,
        totalSuccessCount: this.task.totalSuccessCount,
        totalFailCount: this.task.totalFailCount,
        totalCompletedCount: this.task.totalCompletedCount,
        startedAt: this.task.startedAt,
        loopMode: this.task.loopMode,
        loopCount: this.task.loopCount,
        currentLoop: this.task.currentLoop,
        proxyCount: this.task.proxyCount
      },
      logs: this.logs.slice(-100), // Return last 100 logs
      results: this.results.slice(-50) // Return last 50 results
    };
  }

  getLogs(offset = 0, limit = 100) {
    return this.logs.slice(offset, offset + limit);
  }

  getResults(offset = 0, limit = 50) {
    return this.results.slice(offset, offset + limit);
  }

  addLog(message, type = 'info') {
    const entry = { message, type, timestamp: new Date().toISOString() };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
    // Broadcast to any connected clients
    this.io.emit('bg-log', entry);
  }

  addResult(data) {
    this.results.push(data);
    if (this.results.length > this.maxResults) {
      this.results = this.results.slice(-this.maxResults);
    }
    // Broadcast to any connected clients
    this.io.emit('bg-result', data);
  }

  stop() {
    if (this.task) {
      this.task.running = false;
      this.addLog('⏹️ Background task stopped by user', 'warning');
    }
  }

  async start(config) {
    if (this.task && this.task.running) {
      return { success: false, message: 'A background task is already running' };
    }

    const {
      url,
      urls: rawUrls,
      verifyUrl = '',
      totalAccess = 100,
      useHeadless = true,
      concurrency = 5,
      delayMin = 500,
      delayMax = 2000,
      loopMode = false,
      loopCount = 1,
      proxySource = 'auto',
      customProxies = ''
    } = config;

    // Support multiple URLs
    const urls = (rawUrls && rawUrls.length > 0) ? rawUrls : (url ? [url] : []);
    const primaryUrl = urls[0] || url;

    if (!primaryUrl) {
      return { success: false, message: 'URL is required' };
    }

    // Store urls in config for _runTask
    config._urls = urls;
    config._primaryUrl = primaryUrl;

    // Reset logs and results
    this.logs = [];
    this.results = [];

    // Initialize task state
    this.task = {
      running: true,
      url: primaryUrl,
      urls,
      totalAccess,
      successCount: 0,
      failCount: 0,
      completedCount: 0,
      // Cumulative counters across all loops (for infinite mode display)
      totalSuccessCount: 0,
      totalFailCount: 0,
      totalCompletedCount: 0,
      startedAt: new Date().toISOString(),
      loopMode,
      loopCount,
      currentLoop: 0,
      proxyCount: 0
    };

    if (urls.length > 1) {
      this.addLog(`🚀 Background task started for ${urls.length} URLs:`);
      urls.forEach((u, i) => this.addLog(`   ${i+1}. ${u}`));
    } else {
      this.addLog(`🚀 Background task started for: ${primaryUrl}`);
    }
    this.addLog(`⚙️ Config: ${totalAccess} accesses, concurrency ${concurrency}, delay ${delayMin}-${delayMax}ms`);

    // Run in background (don't await - fire and forget)
    this._runTask(config).catch(err => {
      this.addLog(`❌ Background task crashed: ${err.message}`, 'error');
      this.task.running = false;
    });

    return { success: true, message: 'Background task started' };
  }

  async _runTask(config) {
    const {
      url,
      verifyUrl = '',
      totalAccess = 100,
      useHeadless = true,
      concurrency = 5,
      delayMin = 500,
      delayMax = 2000,
      loopMode = false,
      loopCount = 1,
      proxySource = 'auto',
      customProxies = ''
    } = config;

    // Multiple URL support
    const urls = config._urls || (url ? [url] : []);
    const primaryUrl = config._primaryUrl || urls[0] || url;

    const isInfinite = loopMode && loopCount === -1;
    const totalLoops = isInfinite ? Infinity : (loopMode ? loopCount : 1);

    for (let loop = 0; (isInfinite ? true : loop < totalLoops); loop++) {
      if (!this.task.running) break;

      this.task.currentLoop = loop + 1;

      if (loopMode && !isInfinite && totalLoops > 1) {
        this.addLog(`\n🔁 Loop ${loop + 1}/${totalLoops}`);
      } else if (isInfinite) {
        this.addLog(`\n🔁 Loop ${loop + 1} (unlimited)`);
      }

      try {
        let proxies = [];

        if (proxySource === 'custom' && customProxies.trim()) {
          this.addLog('📋 Parsing custom proxies...');
          proxies = parseCustomProxies(customProxies);

          if (proxies.length === 0) {
            this.addLog('❌ No valid proxies found in custom input', 'error');
            this.task.running = false;
            return;
          }

          this.addLog(`✅ Loaded ${proxies.length} custom proxies`);
        } else {
          this.addLog('🔄 Loading proxies (cached or fresh scrape)...');

          const cacheResult = await getCachedProxies();
          const allProxies = cacheResult.proxies;

          if (cacheResult.fromCache) {
            this.addLog(`📦 Using cached proxies (age: ${cacheResult.cacheAge}s, ${allProxies.length} proxies)`);
          } else {
            this.addLog(`🔄 Fresh scrape completed: ${allProxies.length} proxies found`);
          }

          proxies = allProxies.filter(p => p.country && p.country !== 'Unknown');

          this.addLog(`✅ ${proxies.length} proxies with known country`);

          if (proxies.length === 0) {
            this.addLog('⚠️ No proxies with known country, using all proxies...');
            if (allProxies.length === 0) {
              this.addLog('❌ No proxies found. Task stopped.', 'error');
              this.task.running = false;
              return;
            }
            proxies.push(...allProxies);
          }
        }

        // === PROXY HISTORY FILTERING ===
        const historyResult = filterProxiesByHistory(primaryUrl, proxies);
        const historyStats = getHistoryStats(primaryUrl);

        if (historyStats.successCount > 0 || historyStats.failedCount > 0) {
          this.addLog(`📋 Proxy History: ${historyStats.successCount} known good, ${historyStats.failedCount} known bad`);
        }

        if (historyResult.prioritized.length > 0 || historyResult.failed.length > 0) {
          const filteredProxies = [...historyResult.prioritized, ...historyResult.unused];
          this.addLog(`🔀 Priority: ${historyResult.stats.successKnown} proven → ${historyResult.stats.unused} new | ${historyResult.stats.failedExcluded} excluded`);

          if (filteredProxies.length > 0) {
            proxies = filteredProxies;
          } else {
            this.addLog('⚠️ All proxies previously failed - using all anyway');
          }
        }

        this.task.proxyCount = proxies.length;

        // Random URL picker for multiple URLs
        function getRandomUrl() {
          return urls[Math.floor(Math.random() * urls.length)];
        }

        if (urls.length > 1) {
          this.addLog(`🌐 ${urls.length} Target URLs (random distribution):`);
          urls.forEach((u, i) => this.addLog(`   ${i+1}. ${u}`));
        }
        this.addLog(`🚀 Starting ${totalAccess} access(es) with ${proxies.length} proxies`);

        // Reset counts for each loop iteration
        // For infinite mode: reset per-loop counters so new batch of tasks can run
        this.task.successCount = 0;
        this.task.failCount = 0;
        this.task.completedCount = 0;

        let proxyUsageIndex = 0;
        const shuffledProxies = [...proxies].sort(() => Math.random() - 0.5);

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
            if (!this.task.running) return null;

            // Pick a random URL from the list for this task
            const targetUrl = getRandomUrl();

            const delay = Math.floor(Math.random() * (delayMax - delayMin)) + delayMin;
            await new Promise(resolve => setTimeout(resolve, delay));

            if (!this.task.running) return null;

            const maxRetries = verifyUrl ? 5 : 3;
            let lastError = null;

            for (let attempt = 0; attempt < maxRetries; attempt++) {
              if (!this.task.running) return null;

              const proxy = getNextProxy();

              if (attempt === 0) {
                this.addLog(`[${taskIndex + 1}/${totalAccess}] Proxy: ${proxy.ip}:${proxy.port} (${proxy.country})`);
              } else {
                this.addLog(`  🔄 Retry #${attempt}: ${proxy.ip}:${proxy.port}`);
              }

              try {
                // Verify proxy first
                if (verifyUrl) {
                  const verifyResult = await verifyProxy(verifyUrl, proxy);

                  if (!verifyResult.success) {
                    recordProxyResult(targetUrl, proxy, false);
                    lastError = new Error(`Verify failed: status ${verifyResult.statusCode}`);
                    await new Promise(resolve => setTimeout(resolve, 300));
                    continue;
                  }
                }

                // Access target URL
                const result = await accessWithProxy(targetUrl, proxy, useHeadless);
                this.task.successCount++;
                this.task.completedCount++;
                this.task.totalSuccessCount++;
                this.task.totalCompletedCount++;

                recordProxyResult(targetUrl, proxy, true);

                this.addResult({
                  index: taskIndex + 1,
                  proxy: `${proxy.ip}:${proxy.port}`,
                  country: proxy.country,
                  status: 'success',
                  statusCode: result.statusCode,
                  responseTime: result.responseTime,
                  title: result.title || 'N/A',
                  targetUrl: urls.length > 1 ? targetUrl : undefined,
                  timestamp: new Date().toISOString()
                });

                this.addLog(`  ✅ [${taskIndex + 1}] Success! Status: ${result.statusCode} | Time: ${result.responseTime}ms${urls.length > 1 ? ' | URL: ' + targetUrl.substring(0, 50) : ''}`);

                // Broadcast progress
                this.io.emit('bg-progress', {
                  completed: this.task.completedCount,
                  total: totalAccess,
                  success: this.task.successCount,
                  failed: this.task.failCount,
                  isInfinite,
                  currentLoop: this.task.currentLoop,
                  totalCompleted: this.task.totalCompletedCount,
                  totalSuccess: this.task.totalSuccessCount,
                  totalFailed: this.task.totalFailCount
                });

                return result;
              } catch (error) {
                lastError = error;
                recordProxyResult(targetUrl, proxy, false);
                if (attempt < maxRetries - 1) {
                  this.addLog(`  ⚠️ [${taskIndex + 1}] Failed: ${error.message} - retrying...`);
                  await new Promise(resolve => setTimeout(resolve, 500));
                }
              }
            }

            // All retries failed
            this.task.failCount++;
            this.task.completedCount++;
            this.task.totalFailCount++;
            this.task.totalCompletedCount++;

            this.addResult({
              index: taskIndex + 1,
              proxy: 'multiple',
              status: 'failed',
              error: `All ${maxRetries} retries failed: ${lastError.message}`,
              timestamp: new Date().toISOString()
            });

            this.addLog(`  ❌ [${taskIndex + 1}] Failed after ${maxRetries} retries`);

            this.io.emit('bg-progress', {
              completed: this.task.completedCount,
              total: totalAccess,
              success: this.task.successCount,
              failed: this.task.failCount,
              isInfinite,
              currentLoop: this.task.currentLoop,
              totalCompleted: this.task.totalCompletedCount,
              totalSuccess: this.task.totalSuccessCount,
              totalFailed: this.task.totalFailCount
            });

            return null;
          });
        }

        // Run tasks with concurrency limit
        await this._runParallel(tasks, concurrency);

        this.addLog(`\n📊 Loop Summary: ${this.task.successCount} success, ${this.task.failCount} failed out of ${totalAccess}`);

      } catch (error) {
        this.addLog(`❌ Error in loop ${loop + 1}: ${error.message}`, 'error');
        if (!isInfinite) {
          break;
        }
        // In infinite mode, retry after delay
        this.addLog('⏳ Retrying in 5s...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }

      // Delay between loops
      if (loopMode && (isInfinite || loop < totalLoops - 1) && this.task.running) {
        this.addLog('⏳ Waiting 3s before next loop...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    this.task.running = false;
    this.addLog('🏁 Background task completed');
    this.io.emit('bg-complete', {
      successCount: this.task.successCount,
      failCount: this.task.failCount,
      total: totalAccess
    });
  }

  async _runParallel(tasks, concurrency) {
    const results = [];
    const executing = [];

    for (const task of tasks) {
      if (!this.task.running) break;

      const p = task().then(result => {
        executing.splice(executing.indexOf(p), 1);
        results.push(result);
      }).catch(err => {
        // Ensure promise is removed from executing even on error
        executing.splice(executing.indexOf(p), 1);
        results.push(null);
      });
      executing.push(p);

      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }

    // Wait for remaining tasks, with error handling
    if (executing.length > 0) {
      await Promise.allSettled(executing);
    }
    return results;
  }
}

module.exports = BackgroundTaskManager;
