/**
 * Proxy Cache Module
 * Caches scraped proxies with TTL to avoid re-scraping on every loop.
 * Smart refresh: only re-scrape when cache expires or success rate drops.
 * Enhanced: Removes dead proxies on connection failure, tracks removal stats.
 */

const { scrapeProxies } = require('./proxyScraper');
const { batchValidateProxies } = require('./proxyValidator');

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
  const removed = before - cachedProxies.length;
  if (removed > 0) {
    cacheStats.removedDead = (cacheStats.removedDead || 0) + removed;
  }
  return removed;
}

/**
 * Get validated proxies - scrape/cache + TCP validation
 * This ensures only reachable proxies are returned, dramatically reducing
 * ERR_PROXY_CONNECTION_FAILED errors.
 *
 * @param {object} options - Same as getProxies() plus validation options
 * @param {boolean} options.validate - Whether to run TCP validation (default: true)
 * @param {number} options.maxValid - Max proxies to validate (default: 50, 0 = all)
 * @param {number} options.tcpTimeout - TCP check timeout ms (default: 4000)
 * @param {function} options.onValidationProgress - Progress callback
 * @returns {Object} { proxies, fromCache, validated, stats }
 */
async function getValidatedProxies(options = {}) {
  const {
    validate = true,
    maxValid = 50,
    tcpTimeout = 4000,
    onValidationProgress = null,
    ...cacheOptions
  } = options;

  // First get proxies from cache/scrape
  const cacheResult = await getProxies(cacheOptions);
  
  if (!validate || cacheResult.proxies.length === 0) {
    return { ...cacheResult, validated: false, validationStats: null };
  }

  // Run batch validation with HTTP CONNECT test
  // TCP-only validation is insufficient - many proxies accept TCP but refuse HTTPS tunneling
  const validationResult = await batchValidateProxies(cacheResult.proxies, {
    concurrency: 30,
    maxValid,
    tcpTimeout,
    doConnectTest: true,  // Actually verify HTTPS CONNECT tunneling works
    onProgress: onValidationProgress
  });

  console.log(`Proxy validation: ${validationResult.stats.validCount}/${validationResult.stats.total} reachable (avg latency: ${validationResult.stats.avgLatencyMs}ms)`);

  // === CRITICAL FALLBACK ===
  // If TCP validation rejected ALL proxies, DON'T return empty array.
  // Instead, return the original unvalidated proxies so the system can still function.
  // The browser-level attempt will be the real test (TCP probes may be blocked by firewall).
  if (validationResult.valid.length === 0 && cacheResult.proxies.length > 0) {
    console.log(`⚠️ TCP validation rejected ALL ${cacheResult.proxies.length} proxies - FALLBACK: using unvalidated proxies`);
    console.log(`   (This usually means the local firewall blocks outbound TCP probes to non-standard ports)`);
    console.log(`   (The browser may still be able to connect through these proxies)`);
    
    // Return original proxies without removing any from cache
    return {
      proxies: cacheResult.proxies,
      fromCache: cacheResult.fromCache,
      cacheAge: cacheResult.cacheAge,
      totalScraped: cacheResult.totalScraped,
      validated: true,
      validationSkipped: true,
      validationStats: {
        ...validationResult.stats,
        fallbackUsed: true,
        fallbackReason: 'all_proxies_failed_tcp_check'
      }
    };
  }

  // Normal case: some proxies passed validation
  // Remove invalid proxies from cache (only when we have valid ones to use)
  for (const { proxy } of validationResult.invalid) {
    removeFromCache(proxy.ip, proxy.port);
  }

  return {
    proxies: validationResult.valid,
    fromCache: cacheResult.fromCache,
    cacheAge: cacheResult.cacheAge,
    totalScraped: cacheResult.totalScraped,
    validated: true,
    validationStats: validationResult.stats
  };
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
    ttlRemaining: cacheTimestamp ? Math.max(0, DEFAULT_TTL_MS - (Date.now() - cacheTimestamp)) : 0,
    removedDead: cacheStats.removedDead || 0
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
  getValidatedProxies,
  removeFromCache,
  getCacheStats,
  clearCache,
  getCachedCount,
  isCacheValid,
  getCacheAge
};
