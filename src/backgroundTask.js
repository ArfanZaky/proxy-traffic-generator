const { scrapeProxies, parseCustomProxies } = require('./proxyScraper');
const { accessWithProxy, verifyProxy, filterBlacklistedProxies, getBlacklistStats } = require('./accessor');
const { recordProxyResult, filterProxiesByHistory, getHistoryStats } = require('./proxyHistory');
const { getProxies: getCachedProxies, getValidatedProxies, clearCache: clearProxyCache, removeFromCache } = require('./proxyCache');
const { filterProxiesByCountry } = require('./countryFilter');
const { sendDiscordNotification } = require('./discordNotifier');
const { invalidateProxy } = require('./proxyValidator');
const fs = require('fs');
const path = require('path');

// State file for persistence (survive server restart)
const STATE_FILE = path.join(__dirname, '..', 'data', 'task-state.json');

/**
 * Background Task Manager
 * Runs tasks independently of client WebSocket connection
 * Features: graceful shutdown, state persistence, resume capability
 */
class BackgroundTaskManager {
  constructor(io) {
    this.io = io;
    this.task = null; // Current running task
    this.logs = []; // Store last 500 logs
    this.results = []; // Store last 1000 results
    this.maxLogs = 500;
    this.maxResults = 1000;
    this._config = null; // Store config for resume
    this._stopping = false; // Graceful shutdown flag
    this._activePromises = 0; // Track active task promises

    // Try to load saved state on startup
    this._loadState();
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
        proxyCount: this.task.proxyCount,
        proxyDetectedCount: this.task.proxyDetectedCount || 0,
        interrupted: this.task.interrupted || false,
        interruptedAt: this.task.interruptedAt || null
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

  stop(graceful = true) {
    if (this.task && this.task.running) {
      if (graceful) {
        // Graceful shutdown: let active requests finish, don't start new ones
        this._stopping = true;
        this.task.running = false;
        this.addLog('⏹️ Graceful shutdown initiated - waiting for active requests to finish...', 'warning');
        
        // Save state for potential resume
        this._saveState();
        
        // Wait for active promises to complete (max 30s)
        const checkInterval = setInterval(() => {
          if (this._activePromises <= 0) {
            clearInterval(checkInterval);
            this._stopping = false;
            this.addLog('✅ All active requests completed. Task stopped cleanly.', 'warning');
            this._saveState();
          }
        }, 500);
        
        // Force stop after 30 seconds
        setTimeout(() => {
          clearInterval(checkInterval);
          this._stopping = false;
          this.addLog('⚠️ Force stopped after 30s timeout', 'warning');
        }, 30000);
      } else {
        // Immediate stop
        this.task.running = false;
        this._stopping = false;
        this.addLog('⏹️ Background task force-stopped', 'warning');
      }
    }
  }

  /**
   * Save task state to file for persistence across restarts
   */
  _saveState() {
    try {
      if (!this.task) return;
      
      const state = {
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
          proxyCount: this.task.proxyCount,
          proxyDetectedCount: this.task.proxyDetectedCount || 0,
          running: this.task.running,
        },
        config: this._config,
        savedAt: new Date().toISOString(),
      };

      // Ensure data directory exists
      const dir = path.dirname(STATE_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (e) {
      // Silently fail - state saving is best-effort
    }
  }

  /**
   * Load saved state (called on startup)
   */
  _loadState() {
    try {
      if (!fs.existsSync(STATE_FILE)) return;
      
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      
      if (data.task && data.config) {
        // Don't auto-resume, just store for manual resume
        this._savedState = data;
        
        // If task was running when server stopped, mark as interrupted
        if (data.task.running) {
          this.task = {
            ...data.task,
            running: false,
            interrupted: true,
            interruptedAt: data.savedAt,
          };
          this.addLog(`⚠️ Found interrupted task from ${data.savedAt}. Use resume to continue.`, 'warning');
        }
      }
    } catch (e) {
      // Silently fail
    }
  }

  /**
   * Resume an interrupted task
   */
  async resume() {
    if (this.task && this.task.running) {
      return { success: false, message: 'A task is already running' };
    }

    if (!this._savedState || !this._savedState.config) {
      return { success: false, message: 'No saved state to resume from' };
    }

    const savedState = this._savedState;
    this.addLog(`🔄 Resuming task from loop ${savedState.task.currentLoop}...`, 'info');
    this.addLog(`📊 Previous progress: ✅${savedState.task.totalSuccessCount} ❌${savedState.task.totalFailCount}`, 'info');

    // Start with saved config
    const result = await this.start(savedState.config);
    
    if (result.success) {
      // Restore cumulative counters
      this.task.totalSuccessCount = savedState.task.totalSuccessCount || 0;
      this.task.totalFailCount = savedState.task.totalFailCount || 0;
      this.task.totalCompletedCount = savedState.task.totalCompletedCount || 0;
      this.task.currentLoop = savedState.task.currentLoop || 0;
    }

    // Clear saved state
    this._savedState = null;
    try { fs.unlinkSync(STATE_FILE); } catch(e) {}

    return result;
  }

  /**
   * Check if there's a resumable state
   */
  hasResumableState() {
    return !!(this._savedState && this._savedState.config && this._savedState.task.running);
  }

  getResumableInfo() {
    if (!this._savedState) return null;
    return {
      url: this._savedState.task.url,
      currentLoop: this._savedState.task.currentLoop,
      totalSuccess: this._savedState.task.totalSuccessCount,
      totalFailed: this._savedState.task.totalFailCount,
      savedAt: this._savedState.savedAt,
    };
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
      customProxies = '',
      countryWhitelist = [],
      discordWebhook = ''
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

    // Store config for resume capability
    this._config = { ...config };
    delete this._config._urls;
    delete this._config._primaryUrl;

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
      proxyCount: 0,
      proxyDetectedCount: 0
    };

    if (urls.length > 1) {
      this.addLog(`🚀 Background task started for ${urls.length} URLs:`);
      urls.forEach((u, i) => this.addLog(`   ${i+1}. ${u}`));
    } else {
      this.addLog(`🚀 Background task started for: ${primaryUrl}`);
    }
    this.addLog(`⚙️ Config: ${totalAccess} accesses, concurrency ${concurrency}, delay ${delayMin}-${delayMax}ms`);
    this.addLog(`🛡️ Anti-detection: puppeteer-extra stealth + WebRTC blocking + proxy blacklisting`);
    if (countryWhitelist && countryWhitelist.length > 0) {
      this.addLog(`🌍 Country Whitelist: ${countryWhitelist.join(', ')}`);
    }

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
      customProxies = '',
      countryWhitelist = [],
      discordWebhook = ''
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
        let proxiesValidated = false;

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
          this.addLog('🔄 Loading proxies (cached or fresh scrape + TCP validation)...');

          const cacheResult = await getValidatedProxies({
            tcpTimeout: 4000,
            concurrency: 100,
            onValidationProgress: (validated, total, validCount) => {
              if (validated % 50 === 0 || validated === total) {
                this.addLog(`  🔍 Validating: ${validated}/${total} checked, ${validCount} reachable`);
              }
            }
          });
          const allProxies = cacheResult.proxies;

          if (cacheResult.fromCache) {
            this.addLog(`📦 Using cached proxies (age: ${cacheResult.cacheAge}s)`);
          } else {
            this.addLog(`🔄 Fresh scrape completed: ${cacheResult.totalScraped} proxies found`);
          }

          if (cacheResult.validated && cacheResult.validationStats) {
            if (cacheResult.validationStats.fallbackUsed) {
              this.addLog(`⚠️ TCP Validation: 0/${cacheResult.validationStats.total} reachable - FALLBACK MODE: using all proxies anyway (firewall may block TCP probes)`);
            } else {
              this.addLog(`✅ TCP Validation: ${cacheResult.validationStats.validCount}/${cacheResult.validationStats.total} reachable (avg latency: ${cacheResult.validationStats.avgLatencyMs}ms)`);
            }
          }

          proxies = allProxies.filter(p => p.country && p.country !== 'Unknown');

          // If too few proxies have known country, include all validated proxies
          if (proxies.length < 10 && allProxies.length > proxies.length) {
            this.addLog(`⚠️ Only ${proxies.length} proxies with known country, including all ${allProxies.length} validated proxies`);
            proxies = allProxies;
          } else {
            this.addLog(`✅ ${proxies.length} validated proxies with known country`);
          }

          // Apply country whitelist filter if specified
          if (countryWhitelist && countryWhitelist.length > 0) {
            const beforeCount = proxies.length;
            proxies = filterProxiesByCountry(proxies, countryWhitelist);
            this.addLog(`🌍 Country whitelist [${countryWhitelist.join(', ')}]: ${proxies.length}/${beforeCount} proxies matched`);
          }

          if (proxies.length === 0) {
            this.addLog('⚠️ No proxies matched filters, using all proxies...');
            if (allProxies.length === 0) {
              this.addLog('❌ No proxies found. Task stopped.', 'error');
              this.task.running = false;
              return;
            }
            proxies.push(...allProxies);
          }
          proxiesValidated = true;
        }

        // === PROXY ANONYMITY FILTERING ===
        // Prefer elite proxies to avoid "Anonymous Proxy detected" errors
        const eliteProxies = proxies.filter(p => p.anonymity === 'elite');
        const highAnonProxies = proxies.filter(p => p.anonymity === 'anonymous' || p.anonymity === 'high');
        const otherProxies = proxies.filter(p => !['elite', 'anonymous', 'high'].includes(p.anonymity));
        
        if (eliteProxies.length >= 10) {
          // Use only elite proxies if we have enough
          this.addLog(`🛡️ Using ${eliteProxies.length} ELITE proxies (best anonymity, avoids proxy detection)`);
          proxies = eliteProxies;
        } else if (eliteProxies.length + highAnonProxies.length >= 10) {
          // Use elite + high anonymous
          proxies = [...eliteProxies, ...highAnonProxies];
          this.addLog(`🛡️ Using ${proxies.length} Elite+Anonymous proxies (${eliteProxies.length} elite, ${highAnonProxies.length} anonymous)`);
        } else {
          this.addLog(`⚠️ Only ${eliteProxies.length} elite proxies available - using all ${proxies.length} proxies`);
        }

        // === BLACKLIST FILTERING ===
        // Remove proxies that were previously detected as proxies
        const beforeBlacklist = proxies.length;
        proxies = filterBlacklistedProxies(proxies);
        if (beforeBlacklist !== proxies.length) {
          this.addLog(`🚫 Removed ${beforeBlacklist - proxies.length} blacklisted proxies`);
        }
        
        const blacklistStats = getBlacklistStats();
        if (blacklistStats.active > 0) {
          this.addLog(`📊 Blacklist: ${blacklistStats.active} active, ${blacklistStats.expired} expired`);
        }

        // === PROXY HISTORY FILTERING ===
        // Pass validated flag so currently-validated proxies are not excluded by stale history
        const historyResult = filterProxiesByHistory(primaryUrl, proxies, { validated: proxiesValidated });
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

            // Increased retries for proxy detection scenarios
            const maxRetries = verifyUrl ? 7 : 5;
            let lastError = null;
            let proxyDetectedInTask = false;

            for (let attempt = 0; attempt < maxRetries; attempt++) {
              if (!this.task.running) return null;

              let proxy = getNextProxy();
              
              // Skip blacklisted proxies during retry
              let skipCount = 0;
              while (proxy && skipCount < shuffledProxies.length) {
                try {
                  const { isProxyBlacklisted } = require('./accessor');
                  if (!isProxyBlacklisted(proxy)) break;
                } catch(e) { break; }
                proxy = getNextProxy();
                skipCount++;
              }

              if (attempt === 0) {
                this.addLog(`[${taskIndex + 1}/${totalAccess}] Proxy: ${proxy.ip}:${proxy.port} (${proxy.country || 'Unknown'}, ${proxy.anonymity || 'unknown'})`);
              } else {
                this.addLog(`  🔄 Retry #${attempt}: ${proxy.ip}:${proxy.port} (${proxy.anonymity || 'unknown'})`);
              }

              try {
                // Verify proxy first
                if (verifyUrl) {
                  const verifyResult = await verifyProxy(verifyUrl, proxy);

                  if (!verifyResult.success) {
                    recordProxyResult(targetUrl, proxy, false);
                    
                    // If proxy was detected, log it specially
                    if (verifyResult.proxyDetected) {
                      this.task.proxyDetectedCount = (this.task.proxyDetectedCount || 0) + 1;
                      this.addLog(`  🚫 Proxy DETECTED during verify: ${proxy.ip}:${proxy.port}`, 'warning');
                      // Remove from cache so it's not reused
                      removeFromCache(proxy.ip, proxy.port);
                    }
                    
                    lastError = new Error(`Verify failed: status ${verifyResult.statusCode}${verifyResult.proxyDetected ? ' (PROXY DETECTED)' : ''}`);
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
                  anonymity: proxy.anonymity,
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
                  proxyDetected: this.task.proxyDetectedCount || 0,
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
                
                const errMsg = error.message || '';
                
                // Check if this was a proxy detection error
                if (errMsg.includes('PROXY_DETECTED')) {
                  proxyDetectedInTask = true;
                  this.task.proxyDetectedCount = (this.task.proxyDetectedCount || 0) + 1;
                  this.addLog(`  🚫 [${taskIndex + 1}] PROXY DETECTED: ${proxy.ip}:${proxy.port} - switching proxy...`, 'warning');
                  // Remove from cache
                  removeFromCache(proxy.ip, proxy.port);
                  // Longer delay before retry with new proxy
                  await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
                } else if (errMsg.includes('unreachable') || errMsg.includes('ERR_PROXY_CONNECTION_FAILED') ||
                           errMsg.includes('ERR_TUNNEL_CONNECTION_FAILED') || errMsg.includes('ERR_CONNECTION_REFUSED') ||
                           errMsg.includes('TCP pre-check failed')) {
                  // Proxy is dead - remove from cache and invalidate immediately
                  removeFromCache(proxy.ip, proxy.port);
                  invalidateProxy(proxy);
                  if (attempt < maxRetries - 1) {
                    this.addLog(`  💀 [${taskIndex + 1}] Proxy DEAD: ${proxy.ip}:${proxy.port} - removed, trying next...`);
                  }
                  // Short delay - proxy is dead, just move to next one quickly
                  await new Promise(resolve => setTimeout(resolve, 200));
                } else if (attempt < maxRetries - 1) {
                  this.addLog(`  ⚠️ [${taskIndex + 1}] Failed: ${errMsg.substring(0, 100)} - retrying...`);
                  await new Promise(resolve => setTimeout(resolve, 500));
                }
              }
            }

            // All proxy retries failed
            if (!this.task.running) return null;

            this.task.failCount++;
            this.task.completedCount++;
            this.task.totalFailCount++;
            this.task.totalCompletedCount++;

            this.addResult({
              index: taskIndex + 1,
              proxy: 'multiple',
              status: 'failed',
              proxyDetected: proxyDetectedInTask,
              error: `All ${maxRetries} proxy retries failed: ${lastError.message}`,
              timestamp: new Date().toISOString()
            });

            this.addLog(`  ❌ [${taskIndex + 1}] Failed after ${maxRetries} proxy retries${proxyDetectedInTask ? ' (proxy detection issues)' : ''}`);

            this.io.emit('bg-progress', {
              completed: this.task.completedCount,
              total: totalAccess,
              success: this.task.successCount,
              failed: this.task.failCount,
              proxyDetected: this.task.proxyDetectedCount || 0,
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
        if (this.task.proxyDetectedCount > 0) {
          this.addLog(`🚫 Proxy detections this session: ${this.task.proxyDetectedCount}`, 'warning');
        }

        // Auto-refresh proxy cache if success rate is too low (< 20%) or too many proxy detections
        if (proxySource !== 'custom' && this.task.completedCount > 0) {
          const successRate = this.task.successCount / this.task.completedCount;
          const detectionRate = (this.task.proxyDetectedCount || 0) / this.task.completedCount;
          
          if (successRate < 0.2 || detectionRate > 0.3) {
            if (detectionRate > 0.3) {
              this.addLog(`⚠️ High proxy detection rate (${Math.round(detectionRate * 100)}%) - refreshing proxy cache...`, 'warning');
            } else {
              this.addLog(`⚠️ Low success rate (${Math.round(successRate * 100)}%) - refreshing proxy cache for next loop...`, 'warning');
            }
            clearProxyCache();
            this.addLog('🔄 Proxy cache cleared. Fresh proxies will be scraped on next loop.');
          }
        }

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

      // Periodic state save (every loop) for crash recovery
      this._saveState();

      // Delay between loops
      if (loopMode && (isInfinite || loop < totalLoops - 1) && this.task.running) {
        this.addLog('⏳ Waiting 3s before next loop...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    this.task.running = false;
    this._stopping = false;
    this.addLog('🏁 Background task completed');
    this.io.emit('bg-complete', {
      successCount: this.task.successCount,
      failCount: this.task.failCount,
      total: totalAccess,
      totalSuccess: this.task.totalSuccessCount,
      totalFailed: this.task.totalFailCount,
      totalCompleted: this.task.totalCompletedCount,
      proxyDetected: this.task.proxyDetectedCount || 0
    });

    // Send Discord notification on task complete
    if (discordWebhook) {
      const duration = this.task.startedAt ? Date.now() - new Date(this.task.startedAt).getTime() : 0;
      sendDiscordNotification(discordWebhook, {
        successCount: this.task.totalSuccessCount || this.task.successCount,
        failCount: this.task.totalFailCount || this.task.failCount,
        total: this.task.totalCompletedCount || totalAccess,
        url: primaryUrl,
        urls,
        duration,
        mode: 'background'
      }).then(sent => {
        if (sent) this.addLog('📨 Discord notification sent!');
      }).catch(() => {});
    }

    // Clean up state file on normal completion
    try { fs.unlinkSync(STATE_FILE); } catch(e) {}
  }

  async _runParallel(tasks, concurrency) {
    const results = [];
    const executing = [];

    for (const task of tasks) {
      if (!this.task.running && !this._stopping) break;
      if (this._stopping) break; // Don't start new tasks during graceful shutdown

      this._activePromises++;
      const p = task().then(result => {
        this._activePromises--;
        executing.splice(executing.indexOf(p), 1);
        results.push(result);
      }).catch(err => {
        this._activePromises--;
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
    this._activePromises = 0; // Reset counter
    return results;
  }
}

module.exports = BackgroundTaskManager;
