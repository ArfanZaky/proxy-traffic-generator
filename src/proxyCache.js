/**
 * Proxy Cache Module
 * Caches scraped proxies with TTL to avoid re-scraping on every loop.
 * Smart refresh: only re-scrape when cache expires or success rate drops.
 */

const { scrapeProxies } = require('./proxyScraper');

// Cache state
let cachedProxies = [];
let cacheTimestamp = null;
let cacheStats = {
  hits: 0,
  misses: 0,
  refreshes: 0,
  lastRefreshReason: null
};

// Default TTL: 10 minutes
const DEFAULT_TTL_MS = 10 * 60 * 1000;

// Minimum proxies threshold - if cache has fewer, force refresh
const MIN_PROXIES_THRESHOLD = 20;

/**
 * Check if cache is still valid (not expired)
 */
function isCacheValid(ttlMs = DEFAULT_TTL_MS) {
  if (!cacheTimestamp || cachedProxies.length === 0) {
    return false;
  }
  const age = Date.now() - cacheTimestamp;
  return age < ttlMs;
}

/**
 * Get cache age in seconds
 */
function getCacheAge() {
  if (!cacheTimestamp) return null;
  return Math.round((Date.now() - cacheTimestamp) / 1000);
}

/**
 * Get proxies - from cache if fresh, otherwise scrape new ones
 * @param {Object} options
 * @param {number} options.ttlMs - Cache TTL in milliseconds (default: 10 min)
 * @param {boolean} options.forceRefresh - Force re-scrape even if cache is valid
 * @param {number} options.successRate - Current success rate (0-1). If below threshold, force refresh
 * @param {number} options.successRateThreshold - Threshold below which to force refresh (default: 0.3)
 * @returns {Object} { proxies, fromCache, cacheAge, totalScraped }
 */
async function getProxies(options = {}) {
  const {
    ttlMs = DEFAULT_TTL_MS,
    forceRefresh = false,
    successRate = null,
    successRateThreshold = 0.3
  } = options;

  // Check if we should force refresh due to low success rate
  let shouldRefresh = forceRefresh;
  let refreshReason = forceRefresh ? 'forced' : null;

  if (!shouldRefresh && successRate !== null && successRate < successRateThreshold && cachedProxies.length > 0) {
    shouldRefresh = true;
    refreshReason = `low_success_rate (${Math.round(successRate * 100)}% < ${Math.round(successRateThreshold * 100)}%)`;
  }

  if (!shouldRefresh && cachedProxies.length < MIN_PROXIES_THRESHOLD && cacheTimestamp) {
    shouldRefresh = true;
    refreshReason = `low_proxy_count (${cachedProxies.length} < ${MIN_PROXIES_THRESHOLD})`;
  }

  // Return cached if valid and no force refresh
  if (!shouldRefresh && isCacheValid(ttlMs)) {
    cacheStats.hits++;
    return {
      proxies: [...cachedProxies],
      fromCache: true,
      cacheAge: getCacheAge(),
      totalScraped: cachedProxies.length
    };
  }

  // Cache miss or forced refresh - scrape new proxies
  cacheStats.misses++;
  cacheStats.refreshes++;
  cacheStats.lastRefreshReason = refreshReason || 'expired';

  const allProxies = await scrapeProxies();
  
  // Update cache
  cachedProxies = allProxies;
  cacheTimestamp = Date.now();

  return {
    proxies: [...allProxies],
    fromCache: false,
    cacheAge: 0,
    totalScraped: allProxies.length
  };
}

/**
 * Remove a proxy from cache (e.g., when it's confirmed dead)
 */
function removeFromCache(proxyIp, proxyPort) {
  const before = cachedProxies.length;
  cachedProxies = cachedProxies.filter(p => !(p.ip === proxyIp && p.port === String(proxyPort)));
  return before - cachedProxies.length; // number removed
}

/**
 * Get cache statistics
 */
function getCacheStats() {
  return {
    ...cacheStats,
    cachedCount: cachedProxies.length,
    cacheAge: getCacheAge(),
    isValid: isCacheValid(),
    ttlMs: DEFAULT_TTL_MS,
    ttlRemaining: cacheTimestamp ? Math.max(0, DEFAULT_TTL_MS - (Date.now() - cacheTimestamp)) : 0
  };
}

/**
 * Clear the cache (force next call to scrape fresh)
 */
function clearCache() {
  cachedProxies = [];
  cacheTimestamp = null;
  cacheStats.lastRefreshReason = 'manual_clear';
}

/**
 * Get cached proxy count without triggering a scrape
 */
function getCachedCount() {
  return cachedProxies.length;
}

module.exports = {
  getProxies,
  removeFromCache,
  getCacheStats,
  clearCache,
  getCachedCount,
  isCacheValid,
  getCacheAge
};
