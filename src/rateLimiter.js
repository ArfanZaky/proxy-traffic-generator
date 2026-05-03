/**
 * Rate Limiter Module
 * Prevents excessive requests to the same domain within a time window.
 * Helps avoid IP bans and detection by target sites.
 */

class RateLimiter {
  constructor(options = {}) {
    // Default: max 30 requests per domain per minute
    this.maxRequestsPerWindow = options.maxRequestsPerWindow || 30;
    this.windowMs = options.windowMs || 60000; // 1 minute
    this.minDelayBetweenRequests = options.minDelayBetweenRequests || 500; // 500ms minimum between requests to same domain
    this.maxDelayBetweenRequests = options.maxDelayBetweenRequests || 2000; // 2s max random delay
    
    // Track requests per domain: { domain: [timestamp1, timestamp2, ...] }
    this.requestLog = new Map();
    
    // Track last request time per domain
    this.lastRequestTime = new Map();
    
    // Stats
    this.stats = {
      totalRequests: 0,
      throttledRequests: 0,
      domains: 0,
    };
  }

  /**
   * Extract domain from URL
   */
  getDomain(url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname;
    } catch (e) {
      return url;
    }
  }

  /**
   * Check if a request to this domain should be throttled
   * Returns: { allowed: boolean, waitMs: number, reason: string }
   */
  check(url) {
    const domain = this.getDomain(url);
    const now = Date.now();

    // Get request history for this domain
    let history = this.requestLog.get(domain) || [];
    
    // Clean old entries outside the window
    history = history.filter(ts => now - ts < this.windowMs);
    this.requestLog.set(domain, history);

    // Check rate limit
    if (history.length >= this.maxRequestsPerWindow) {
      const oldestInWindow = history[0];
      const waitMs = this.windowMs - (now - oldestInWindow) + 100; // +100ms buffer
      return {
        allowed: false,
        waitMs,
        reason: `Rate limit: ${history.length}/${this.maxRequestsPerWindow} requests in ${this.windowMs / 1000}s window for ${domain}`
      };
    }

    // Check minimum delay between requests
    const lastTime = this.lastRequestTime.get(domain) || 0;
    const elapsed = now - lastTime;
    if (elapsed < this.minDelayBetweenRequests) {
      const waitMs = this.minDelayBetweenRequests - elapsed;
      return {
        allowed: false,
        waitMs,
        reason: `Min delay: ${elapsed}ms < ${this.minDelayBetweenRequests}ms for ${domain}`
      };
    }

    return { allowed: true, waitMs: 0, reason: null };
  }

  /**
   * Wait until request is allowed, then record it
   * Use this before making a request
   */
  async acquire(url) {
    const domain = this.getDomain(url);
    
    while (true) {
      const result = this.check(url);
      
      if (result.allowed) {
        this.record(url);
        return { waited: 0, domain };
      }
      
      this.stats.throttledRequests++;
      await new Promise(resolve => setTimeout(resolve, result.waitMs));
    }
  }

  /**
   * Record a request to a domain
   */
  record(url) {
    const domain = this.getDomain(url);
    const now = Date.now();

    // Add to history
    let history = this.requestLog.get(domain) || [];
    history.push(now);
    this.requestLog.set(domain, history);

    // Update last request time
    this.lastRequestTime.set(domain, now);

    // Update stats
    this.stats.totalRequests++;
    this.stats.domains = this.requestLog.size;
  }

  /**
   * Get a random delay to add between requests (for natural behavior)
   */
  getRandomDelay() {
    return Math.floor(
      Math.random() * (this.maxDelayBetweenRequests - this.minDelayBetweenRequests)
    ) + this.minDelayBetweenRequests;
  }

  /**
   * Get current stats
   */
  getStats() {
    const domainStats = {};
    for (const [domain, history] of this.requestLog.entries()) {
      const now = Date.now();
      const recentHistory = history.filter(ts => now - ts < this.windowMs);
      domainStats[domain] = {
        requestsInWindow: recentHistory.length,
        maxRequests: this.maxRequestsPerWindow,
        lastRequest: this.lastRequestTime.get(domain) || 0,
      };
    }

    return {
      ...this.stats,
      domainStats,
      config: {
        maxRequestsPerWindow: this.maxRequestsPerWindow,
        windowMs: this.windowMs,
        minDelayBetweenRequests: this.minDelayBetweenRequests,
      }
    };
  }

  /**
   * Reset all tracking data
   */
  reset() {
    this.requestLog.clear();
    this.lastRequestTime.clear();
    this.stats = { totalRequests: 0, throttledRequests: 0, domains: 0 };
  }

  /**
   * Reset tracking for a specific domain
   */
  resetDomain(url) {
    const domain = this.getDomain(url);
    this.requestLog.delete(domain);
    this.lastRequestTime.delete(domain);
  }

  /**
   * Update configuration dynamically
   */
  updateConfig(options) {
    if (options.maxRequestsPerWindow !== undefined) {
      this.maxRequestsPerWindow = options.maxRequestsPerWindow;
    }
    if (options.windowMs !== undefined) {
      this.windowMs = options.windowMs;
    }
    if (options.minDelayBetweenRequests !== undefined) {
      this.minDelayBetweenRequests = options.minDelayBetweenRequests;
    }
    if (options.maxDelayBetweenRequests !== undefined) {
      this.maxDelayBetweenRequests = options.maxDelayBetweenRequests;
    }
  }
}

// Singleton instance for global rate limiting
const globalRateLimiter = new RateLimiter();

module.exports = {
  RateLimiter,
  globalRateLimiter,
};
