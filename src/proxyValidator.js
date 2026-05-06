/**
 * Proxy Validator Module
 * Provides fast TCP connectivity checks and proxy health validation
 * to prevent ERR_PROXY_CONNECTION_FAILED errors.
 * 
 * Key features:
 * - Fast TCP port reachability check (5s timeout)
 * - HTTP CONNECT tunnel validation for HTTPS proxies
 * - Proper SOCKS5 protocol detection
 * - Port range validation
 * - Batch validation with concurrency control
 */

const net = require('net');
const http = require('http');

// Track validated proxies to avoid re-checking recently validated ones
const validatedCache = new Map(); // key -> { valid: bool, timestamp: number }
const VALIDATION_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Validate that a port number is in valid range (1-65535)
 * @param {string|number} port 
 * @returns {boolean}
 */
function isValidPort(port) {
  const portNum = parseInt(port, 10);
  return !isNaN(portNum) && portNum >= 1 && portNum <= 65535;
}

/**
 * Validate that an IP address is properly formatted
 * @param {string} ip 
 * @returns {boolean}
 */
function isValidIP(ip) {
  if (!ip) return false;
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every(part => {
    const num = parseInt(part, 10);
    return !isNaN(num) && num >= 0 && num <= 255 && String(num) === part;
  });
}

/**
 * Fast TCP connectivity check - just verifies the port is open
 * This is the fastest way to check if a proxy is reachable.
 * @param {string} ip - Proxy IP address
 * @param {string|number} port - Proxy port
 * @param {number} timeoutMs - Connection timeout (default: 5000ms)
 * @returns {Promise<{reachable: boolean, latencyMs: number, error?: string}>}
 */
function checkTCPConnectivity(ip, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = new net.Socket();
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
      }
    };

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      const latencyMs = Date.now() - startTime;
      cleanup();
      resolve({ reachable: true, latencyMs });
    });

    socket.on('timeout', () => {
      cleanup();
      resolve({ reachable: false, latencyMs: timeoutMs, error: 'Connection timeout' });
    });

    socket.on('error', (err) => {
      cleanup();
      resolve({ reachable: false, latencyMs: Date.now() - startTime, error: err.message });
    });

    try {
      socket.connect(parseInt(port, 10), ip);
    } catch (err) {
      cleanup();
      resolve({ reachable: false, latencyMs: 0, error: `Connect error: ${err.message}` });
    }
  });
}

/**
 * Validate a proxy with HTTP CONNECT method (tests if it can tunnel HTTPS)
 * This is more thorough than TCP check but slower.
 * @param {object} proxy - Proxy object {ip, port, username?, password?}
 * @param {string} testHost - Host to test CONNECT tunnel to (default: www.google.com)
 * @param {number} timeoutMs - Timeout in ms (default: 8000)
 * @returns {Promise<{valid: boolean, latencyMs: number, error?: string}>}
 */
function validateHTTPConnect(proxy, testHost = 'www.google.com', timeoutMs = 6000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let resolved = false;

    const cleanup = (socket) => {
      if (!resolved) {
        resolved = true;
        if (socket) socket.destroy();
      }
    };

    const options = {
      host: proxy.ip,
      port: parseInt(proxy.port, 10),
      method: 'CONNECT',
      path: `${testHost}:443`,
      timeout: timeoutMs,
      headers: {
        'Host': `${testHost}:443`,
        'Proxy-Connection': 'keep-alive',
      }
    };

    // Add proxy authentication if provided
    if (proxy.username && proxy.password) {
      const auth = Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');
      options.headers['Proxy-Authorization'] = `Basic ${auth}`;
    }

    const req = http.request(options);

    req.setTimeout(timeoutMs, () => {
      cleanup(req.socket);
      resolve({ valid: false, latencyMs: timeoutMs, error: 'CONNECT timeout' });
    });

    req.on('connect', (res, socket) => {
      const latencyMs = Date.now() - startTime;
      cleanup(socket);
      
      if (res.statusCode === 200) {
        resolve({ valid: true, latencyMs });
      } else {
        resolve({ valid: false, latencyMs, error: `CONNECT returned ${res.statusCode}` });
      }
    });

    req.on('error', (err) => {
      cleanup(req.socket);
      resolve({ valid: false, latencyMs: Date.now() - startTime, error: err.message });
    });

    req.end();
  });
}

/**
 * Full proxy validation: format check + TCP connectivity + optional CONNECT test
 * @param {object} proxy - Proxy object {ip, port, type, username?, password?}
 * @param {object} options - Validation options
 * @param {boolean} options.skipTCP - Skip TCP check (default: false)
 * @param {boolean} options.doConnectTest - Also test HTTP CONNECT (default: false, slower)
 * @param {number} options.tcpTimeout - TCP timeout ms (default: 5000)
 * @param {boolean} options.useCache - Use validation cache (default: true)
 * @returns {Promise<{valid: boolean, latencyMs: number, error?: string, reason?: string}>}
 */
async function validateProxy(proxy, options = {}) {
  const {
    skipTCP = false,
    doConnectTest = false,
    tcpTimeout = 5000,
    useCache = true
  } = options;

  const key = `${proxy.ip}:${proxy.port}`;

  // Check validation cache
  if (useCache) {
    const cached = validatedCache.get(key);
    if (cached && (Date.now() - cached.timestamp) < VALIDATION_CACHE_TTL_MS) {
      return { valid: cached.valid, latencyMs: cached.latencyMs || 0, fromCache: true, reason: cached.reason };
    }
  }

  // Step 1: Format validation
  if (!isValidIP(proxy.ip)) {
    const result = { valid: false, latencyMs: 0, error: 'Invalid IP format', reason: 'invalid_ip' };
    if (useCache) validatedCache.set(key, { ...result, timestamp: Date.now() });
    return result;
  }

  if (!isValidPort(proxy.port)) {
    const result = { valid: false, latencyMs: 0, error: `Invalid port: ${proxy.port}`, reason: 'invalid_port' };
    if (useCache) validatedCache.set(key, { ...result, timestamp: Date.now() });
    return result;
  }

  // Step 2: TCP connectivity check
  if (!skipTCP) {
    const tcpResult = await checkTCPConnectivity(proxy.ip, proxy.port, tcpTimeout);
    
    if (!tcpResult.reachable) {
      const result = { valid: false, latencyMs: tcpResult.latencyMs, error: tcpResult.error, reason: 'tcp_unreachable' };
      if (useCache) validatedCache.set(key, { ...result, timestamp: Date.now() });
      return result;
    }

    // If TCP is reachable and we don't need CONNECT test, it's valid
    if (!doConnectTest) {
      const result = { valid: true, latencyMs: tcpResult.latencyMs, reason: 'tcp_reachable' };
      if (useCache) validatedCache.set(key, { ...result, timestamp: Date.now() });
      return result;
    }
  }

  // Step 3: HTTP CONNECT test (optional, more thorough)
  if (doConnectTest) {
    const proxyType = (proxy.type || 'HTTP').toUpperCase();
    
    // For SOCKS proxies, TCP reachability is sufficient validation
    // (HTTP CONNECT method doesn't apply to SOCKS protocol)
    if (proxyType === 'SOCKS5' || proxyType === 'SOCKS4' || proxyType === 'SOCKS') {
      // SOCKS proxy - TCP check already passed, consider it valid
      const result = { valid: true, latencyMs: 0, reason: 'socks_tcp_reachable' };
      if (useCache) validatedCache.set(key, { ...result, timestamp: Date.now() });
      return result;
    }
    
    // HTTP/HTTPS proxy - test CONNECT tunnel
    const connectResult = await validateHTTPConnect(proxy);
    const result = {
      valid: connectResult.valid,
      latencyMs: connectResult.latencyMs,
      error: connectResult.error,
      reason: connectResult.valid ? 'connect_success' : 'connect_failed'
    };
    if (useCache) validatedCache.set(key, { ...result, timestamp: Date.now() });
    return result;
  }

  return { valid: true, latencyMs: 0, reason: 'format_only' };
}

/**
 * Batch validate proxies with concurrency control
 * Returns only valid proxies, sorted by latency (fastest first)
 * @param {Array} proxies - Array of proxy objects
 * @param {object} options - Validation options
 * @param {number} options.concurrency - Max concurrent validations (default: 20)
 * @param {number} options.maxValid - Stop after finding this many valid proxies (default: 0 = all)
 * @param {number} options.tcpTimeout - TCP timeout per proxy (default: 5000)
 * @param {boolean} options.doConnectTest - Also test HTTP CONNECT (default: false)
 * @param {function} options.onProgress - Progress callback (validated, total, validCount)
 * @returns {Promise<{valid: Array, invalid: Array, stats: object}>}
 */
async function batchValidateProxies(proxies, options = {}) {
  const {
    concurrency = 20,
    maxValid = 0,
    tcpTimeout = 5000,
    doConnectTest = false,
    onProgress = null
  } = options;

  const valid = [];
  const invalid = [];
  let validated = 0;
  let stopped = false;

  // Process in batches
  const queue = [...proxies];
  const executing = new Set();

  const processOne = async (proxy) => {
    if (stopped) return;

    const result = await validateProxy(proxy, { tcpTimeout, doConnectTest });
    validated++;

    if (result.valid) {
      valid.push({ proxy, latencyMs: result.latencyMs });
      
      // Stop early if we have enough valid proxies
      if (maxValid > 0 && valid.length >= maxValid) {
        stopped = true;
      }
    } else {
      invalid.push({ proxy, error: result.error, reason: result.reason });
    }

    if (onProgress) {
      onProgress(validated, proxies.length, valid.length);
    }
  };

  // Run with concurrency limit
  for (const proxy of queue) {
    if (stopped) break;

    const p = processOne(proxy).then(() => {
      executing.delete(p);
    });
    executing.add(p);

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  // Wait for remaining
  await Promise.all(executing);

  // Sort valid proxies by latency (fastest first)
  valid.sort((a, b) => a.latencyMs - b.latencyMs);

  return {
    valid: valid.map(v => ({ ...v.proxy, _latencyMs: v.latencyMs })),
    invalid,
    stats: {
      total: proxies.length,
      validated,
      validCount: valid.length,
      invalidCount: invalid.length,
      avgLatencyMs: valid.length > 0 ? Math.round(valid.reduce((sum, v) => sum + v.latencyMs, 0) / valid.length) : 0
    }
  };
}

/**
 * Quick-validate a single proxy (TCP only, fast)
 * Use this before launching a browser to avoid wasting time on dead proxies
 * @param {object} proxy - Proxy object
 * @returns {Promise<boolean>} - true if proxy is reachable
 */
async function quickCheck(proxy) {
  const result = await validateProxy(proxy, { tcpTimeout: 4000, useCache: true });
  if (!result.valid) {
    console.log(`  [TCP] ${proxy.ip}:${proxy.port} - FAILED: ${result.error || result.reason || 'unknown'} (${result.latencyMs}ms)`);
  }
  return result.valid;
}

/**
 * Invalidate a proxy in the validation cache (mark as dead)
 * Call this when ERR_PROXY_CONNECTION_FAILED is encountered
 * @param {object} proxy - Proxy object {ip, port}
 */
function invalidateProxy(proxy) {
  const key = `${proxy.ip}:${proxy.port}`;
  validatedCache.set(key, {
    valid: false,
    timestamp: Date.now(),
    latencyMs: 0,
    reason: 'connection_failed'
  });
}

/**
 * Get the correct proxy protocol string for Puppeteer's --proxy-server arg
 * @param {object} proxy - Proxy object {ip, port, type}
 * @returns {string} - Properly formatted proxy URL for Puppeteer
 */
function getProxyServerArg(proxy) {
  const type = (proxy.type || 'HTTP').toUpperCase();
  
  if (type === 'SOCKS5' || type === 'SOCKS') {
    return `socks5://${proxy.ip}:${proxy.port}`;
  } else if (type === 'SOCKS4') {
    return `socks4://${proxy.ip}:${proxy.port}`;
  } else {
    // HTTP and HTTPS proxies both use http:// in the proxy-server arg
    return `http://${proxy.ip}:${proxy.port}`;
  }
}

/**
 * Clear the validation cache
 */
function clearValidationCache() {
  validatedCache.clear();
}

/**
 * Get validation cache stats
 */
function getValidationCacheStats() {
  const now = Date.now();
  let valid = 0;
  let invalid = 0;
  let expired = 0;

  for (const [key, entry] of validatedCache) {
    if (now - entry.timestamp > VALIDATION_CACHE_TTL_MS) {
      expired++;
    } else if (entry.valid) {
      valid++;
    } else {
      invalid++;
    }
  }

  return { total: validatedCache.size, valid, invalid, expired };
}

module.exports = {
  validateProxy,
  batchValidateProxies,
  quickCheck,
  invalidateProxy,
  getProxyServerArg,
  checkTCPConnectivity,
  validateHTTPConnect,
  isValidPort,
  isValidIP,
  clearValidationCache,
  getValidationCacheStats
};
