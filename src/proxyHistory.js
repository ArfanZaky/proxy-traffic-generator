const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'proxy-history.json');

/**
 * Load proxy history from JSON file
 * Structure: {
 *   "https://example.com": {
 *     "success": { "1.2.3.4:8080": { count: 5, lastUsed: "2024-01-01T00:00:00Z" } },
 *     "failed": { "5.6.7.8:3128": { count: 3, lastUsed: "2024-01-01T00:00:00Z" } }
 *   }
 * }
 */
function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading proxy history:', error.message);
  }
  return {};
}

/**
 * Save proxy history to JSON file
 */
function saveHistory(history) {
  try {
    const dir = path.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving proxy history:', error.message);
  }
}

/**
 * Get proxy key (unique identifier)
 */
function getProxyKey(proxy) {
  if (proxy.username && proxy.password) {
    return `${proxy.username}:${proxy.password}@${proxy.ip}:${proxy.port}`;
  }
  return `${proxy.ip}:${proxy.port}`;
}

/**
 * Normalize URL to use as key (remove trailing slash, query params for grouping)
 */
function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    // Use origin + pathname as key (ignore query params for grouping)
    return `${parsed.origin}${parsed.pathname}`.replace(/\/$/, '');
  } catch {
    return url;
  }
}

/**
 * Record a proxy result (success or fail) for a URL
 */
function recordProxyResult(url, proxy, success) {
  const history = loadHistory();
  const urlKey = normalizeUrl(url);
  const proxyKey = getProxyKey(proxy);
  
  if (!history[urlKey]) {
    history[urlKey] = { success: {}, failed: {} };
  }
  
  const category = success ? 'success' : 'failed';
  const oppositeCategory = success ? 'failed' : 'success';
  
  // Add/update in the correct category
  if (!history[urlKey][category][proxyKey]) {
    history[urlKey][category][proxyKey] = { count: 0, lastUsed: null };
  }
  history[urlKey][category][proxyKey].count++;
  history[urlKey][category][proxyKey].lastUsed = new Date().toISOString();
  
  // If proxy succeeds, remove from failed list (it's working now)
  if (success && history[urlKey][oppositeCategory][proxyKey]) {
    delete history[urlKey][oppositeCategory][proxyKey];
  }
  
  saveHistory(history);
}

/**
 * Filter and prioritize proxies based on history for a URL
 * Returns: { prioritized: [...], unused: [...], failed: [...] }
 *
 * Priority order:
 * 1. Proxies that succeeded before (sorted by success count, most first)
 * 2. Proxies never used before (new/unknown)
 * 3. Proxies that failed before are EXCLUDED (unless validated = true)
 *
 * @param {string} url - Target URL to check history for
 * @param {Array} proxies - List of proxy objects to filter
 * @param {Object} options - Options
 * @param {boolean} options.validated - If true, proxies have passed current TCP/CONNECT validation.
 *   Previously-failed proxies that are now validated will be given a second chance (moved to "unused")
 *   instead of being excluded. This prevents stale history from blocking currently-working proxies.
 */
function filterProxiesByHistory(url, proxies, options = {}) {
  const { validated = false } = options;
  const history = loadHistory();
  const urlKey = normalizeUrl(url);
  
  const urlHistory = history[urlKey];
  
  // No history for this URL - return all proxies as unused
  if (!urlHistory) {
    return {
      prioritized: [],
      unused: proxies,
      failed: [],
      stats: { successKnown: 0, unused: proxies.length, failedExcluded: 0 }
    };
  }
  
  const successProxies = [];
  const unusedProxies = [];
  const failedProxies = [];
  
  for (const proxy of proxies) {
    const proxyKey = getProxyKey(proxy);
    
    if (urlHistory.success[proxyKey]) {
      // This proxy succeeded before - prioritize it
      successProxies.push({
        proxy,
        successCount: urlHistory.success[proxyKey].count,
        lastUsed: urlHistory.success[proxyKey].lastUsed
      });
    } else if (urlHistory.failed[proxyKey]) {
      if (validated) {
        // Proxy failed before BUT passed current TCP/CONNECT validation
        // Give it a second chance - treat as "unused" (lower priority than proven good)
        unusedProxies.push(proxy);
      } else {
        // Proxy failed before and NOT currently validated - exclude it
        failedProxies.push(proxy);
      }
    } else {
      // Never used before - include as unused
      unusedProxies.push(proxy);
    }
  }
  
  // Sort success proxies by count (most successful first)
  successProxies.sort((a, b) => b.successCount - a.successCount);
  
  return {
    prioritized: successProxies.map(s => s.proxy),
    unused: unusedProxies,
    failed: failedProxies,
    stats: {
      successKnown: successProxies.length,
      unused: unusedProxies.length,
      failedExcluded: failedProxies.length
    }
  };
}

/**
 * Get history stats for a URL
 */
function getHistoryStats(url) {
  const history = loadHistory();
  const urlKey = normalizeUrl(url);
  const urlHistory = history[urlKey];
  
  if (!urlHistory) {
    return { successCount: 0, failedCount: 0, totalUrls: Object.keys(history).length };
  }
  
  return {
    successCount: Object.keys(urlHistory.success).length,
    failedCount: Object.keys(urlHistory.failed).length,
    totalUrls: Object.keys(history).length
  };
}

/**
 * Clear history for a specific URL or all
 */
function clearHistory(url = null) {
  if (url) {
    const history = loadHistory();
    const urlKey = normalizeUrl(url);
    delete history[urlKey];
    saveHistory(history);
  } else {
    saveHistory({});
  }
}

module.exports = {
  recordProxyResult,
  filterProxiesByHistory,
  getHistoryStats,
  clearHistory,
  getProxyKey,
  normalizeUrl
};
