const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const https = require('https');
const { generateFingerprint, applyFingerprint, getLaunchArgs, humanMouseMove, simulateIdleBehavior, checkProxyDetection, PROXY_DETECTION_REGEX } = require('./antiDetection');
const { globalRateLimiter } = require('./rateLimiter');
const { quickCheck, invalidateProxy, getProxyServerArg } = require('./proxyValidator');

// Increase max listeners to prevent warnings
process.setMaxListeners(100);

// ============================================================
// PROXY QUALITY TRACKER
// Tracks proxy detection events to blacklist bad proxies
// ============================================================

const proxyBlacklist = new Map(); // ip:port -> { detectedCount, lastDetected, reason }
const BLACKLIST_THRESHOLD = 2;    // Blacklist after 2 detections
const BLACKLIST_TTL_MS = 30 * 60 * 1000; // 30 minutes blacklist duration

/**
 * Check if a proxy is blacklisted
 */
function isProxyBlacklisted(proxy) {
  const key = `${proxy.ip}:${proxy.port}`;
  const entry = proxyBlacklist.get(key);
  if (!entry) return false;
  
  // Check if blacklist has expired
  if (Date.now() - entry.lastDetected > BLACKLIST_TTL_MS) {
    proxyBlacklist.delete(key);
    return false;
  }
  
  return entry.detectedCount >= BLACKLIST_THRESHOLD;
}

/**
 * Record a proxy detection event
 */
function recordProxyDetection(proxy, reason) {
  const key = `${proxy.ip}:${proxy.port}`;
  const entry = proxyBlacklist.get(key) || { detectedCount: 0, lastDetected: 0, reason: '' };
  entry.detectedCount++;
  entry.lastDetected = Date.now();
  entry.reason = reason;
  proxyBlacklist.set(key, entry);
  
  console.log(`  ⚠️ Proxy ${key} detected (${entry.detectedCount}x): ${reason}`);
  if (entry.detectedCount >= BLACKLIST_THRESHOLD) {
    console.log(`  🚫 Proxy ${key} BLACKLISTED for ${BLACKLIST_TTL_MS / 60000} minutes`);
  }
}

/**
 * Get blacklist stats
 */
function getBlacklistStats() {
  const now = Date.now();
  let active = 0;
  let expired = 0;
  
  for (const [key, entry] of proxyBlacklist) {
    if (now - entry.lastDetected > BLACKLIST_TTL_MS) {
      expired++;
    } else if (entry.detectedCount >= BLACKLIST_THRESHOLD) {
      active++;
    }
  }
  
  return { total: proxyBlacklist.size, active, expired };
}

/**
 * Filter out blacklisted proxies from a list
 */
function filterBlacklistedProxies(proxies) {
  const before = proxies.length;
  const filtered = proxies.filter(p => !isProxyBlacklisted(p));
  const removed = before - filtered.length;
  
  if (removed > 0) {
    console.log(`  🚫 Filtered ${removed} blacklisted proxies (${filtered.length} remaining)`);
  }
  
  return filtered;
}

/**
 * Access a URL using a proxy
 * @param {string} url - Target URL to access
 * @param {object} proxy - Proxy object {ip, port, type}
 * @param {boolean} useHeadless - true = headless (hidden), false = visible browser window
 * @param {object} options - Additional options
 * @param {boolean} options.skipTCPCheck - Skip TCP pre-check (default: false)
 */
async function accessWithProxy(url, proxy, useHeadless, options = {}) {
  const startTime = Date.now();
  const { skipTCPCheck = false } = options;

  if (!proxy) {
    throw new Error('Proxy is required - direct connections are not allowed');
  }

  // Check if proxy is blacklisted
  if (isProxyBlacklisted(proxy)) {
    throw new Error(`Proxy ${proxy.ip}:${proxy.port} is blacklisted (proxy detected)`);
  }

  // === PRE-CHECK: Fast TCP connectivity test ===
  // Non-blocking: if TCP check fails, log warning but still try the proxy
  // (some firewalls block raw TCP but the proxy may still work via browser)
  if (!skipTCPCheck) {
    const isReachable = await quickCheck(proxy);
    if (!isReachable) {
      // DON'T reject immediately - just log a warning
      // The proxy might still work (some environments block raw TCP probes)
      console.log(`  ⚠️ TCP pre-check failed for ${proxy.ip}:${proxy.port} - will try anyway (browser may succeed)`);
      // Note: We no longer call invalidateProxy() here to avoid poisoning the cache
      // The browser attempt will be the real test
    }
  }

  // Rate limiting: wait if needed
  await globalRateLimiter.acquire(url);

  if (useHeadless) {
    // Headless mode: browser hidden
    return await accessWithPuppeteer(url, proxy, startTime, true);
  } else {
    // Visible browser mode: window appears
    return await accessWithPuppeteer(url, proxy, startTime, false);
  }
}


/**
 * Access URL using Puppeteer-Extra with Stealth Plugin for full anti-detection
 * @param {boolean} headless - true = hidden browser, false = visible window
 */
async function accessWithPuppeteer(url, proxy, startTime, headless) {
  let browser = null;
  
  // Generate unique fingerprint for this session
  const fingerprint = generateFingerprint();
  
  try {
    // Use puppeteer-extra with stealth plugin for better anti-detection
    let puppeteer;
    try {
      puppeteer = require('puppeteer-extra');
      const StealthPlugin = require('puppeteer-extra-plugin-stealth');
      puppeteer.use(StealthPlugin());
    } catch (e) {
      // Fallback to regular puppeteer if puppeteer-extra not available
      console.log('  ⚠️ puppeteer-extra not available, using regular puppeteer');
      puppeteer = require('puppeteer');
    }

    // Get anti-detection launch args based on fingerprint
    const stealthArgs = getLaunchArgs(fingerprint);
    
    // Build launch args - include proxy only if proxy is provided
    const launchArgs = [...stealthArgs];
    if (proxy) {
      const proxyServerArg = getProxyServerArg(proxy);
      launchArgs.unshift(`--proxy-server=${proxyServerArg}`);
      // Chrome already routes DNS through the proxy for HTTPS (via CONNECT tunnel)
      // Do NOT use --host-resolver-rules as it breaks DNS resolution
    }
    
    browser = await puppeteer.launch({
      headless: headless ? 'new' : false,
      args: launchArgs,
      defaultViewport: null,
      timeout: 60000,
      ignoreDefaultArgs: ['--enable-automation']
    });

    const page = await browser.newPage();

    // Authenticate proxy if username/password provided
    if (proxy && proxy.username && proxy.password) {
      await page.authenticate({
        username: proxy.username,
        password: proxy.password
      });
    }
    
    // Apply full fingerprint (user-agent, viewport, headers, stealth scripts)
    await applyFingerprint(page, fingerprint);

    // Block WebRTC at the CDP level for extra protection
    try {
      const client = await page.target().createCDPSession();
      await client.send('Network.setBypassServiceWorker', { bypass: true });
      // Disable WebRTC via CDP
      await client.send('Emulation.setHardwareConcurrencyOverride', { 
        hardwareConcurrency: fingerprint.hardwareConcurrency 
      });
    } catch (e) {
      // CDP commands may not be available in all versions
    }

    // Navigate to URL - use domcontentloaded for reliability with proxies
    // networkidle2 causes timeouts with slow proxy connections
    // The page content is loaded when DOM is ready; we do our own resource waiting below
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    const statusCode = response ? response.status() : 0;

    // === CHECK FOR PROXY DETECTION ===
    const detectionResult = await checkProxyDetection(page);
    if (detectionResult.detected) {
      // Record this proxy as detected
      recordProxyDetection(proxy, detectionResult.reason);
      
      await browser.close();
      throw new Error(`PROXY_DETECTED: ${detectionResult.reason}`);
    }

    // Wait for all images and resources to be fully loaded
    await page.evaluate(async () => {
      // Wait for all images to load
      const images = Array.from(document.querySelectorAll('img'));
      await Promise.all(images.map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          img.addEventListener('load', resolve);
          img.addEventListener('error', resolve);
          setTimeout(resolve, 10000);
        });
      }));

      // Wait for fonts
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }

      // Extra wait for lazy content
      await new Promise(resolve => setTimeout(resolve, 2000));
    });

    const title = await page.title();

    // === SECOND CHECK: After full load, check again for delayed proxy detection ===
    const detectionResult2 = await checkProxyDetection(page);
    if (detectionResult2.detected) {
      recordProxyDetection(proxy, detectionResult2.reason);
      await browser.close();
      throw new Error(`PROXY_DETECTED: ${detectionResult2.reason}`);
    }

    // === STEP 1: Page is FULLY loaded, simulate human idle behavior ===
    // Random wait between 5-15 seconds (more natural than fixed 10s)
    const idleTime = 5000 + Math.floor(Math.random() * 10000);
    await simulateIdleBehavior(page, idleTime);

    // === STEP 1.5: Ad clicking disabled ===
    // await detectAndClickAds(page);

    // === STEP 2: Scroll down to the bottom of the page ===
    await autoScroll(page, 'down');

    // Small pause at the bottom with random mouse movement
    const pauseBottom = 1000 + Math.floor(Math.random() * 3000);
    await simulateIdleBehavior(page, pauseBottom);

    // === STEP 3: Scroll back up to the top ===
    await autoScroll(page, 'up');

    // Small pause at the top
    const pauseTop = 500 + Math.floor(Math.random() * 1500);
    await new Promise(resolve => setTimeout(resolve, pauseTop));

    const responseTime = Date.now() - startTime;

    await browser.close();

    return {
      statusCode,
      responseTime,
      title: title || 'N/A',
      contentLength: 'N/A (Browser mode)',
      fingerprint: `${fingerprint.browser}/${fingerprint.os}`
    };
  } catch (error) {
    if (browser) {
      try { await browser.close(); } catch(e) {}
    }
    
    // Specifically handle proxy connection failures - invalidate the proxy
    const errMsg = error.message || '';
    if (errMsg.includes('ERR_PROXY_CONNECTION_FAILED') ||
        errMsg.includes('ERR_TUNNEL_CONNECTION_FAILED') ||
        errMsg.includes('ERR_PROXY_CERTIFICATE_INVALID') ||
        errMsg.includes('ERR_SOCKS_CONNECTION_FAILED') ||
        errMsg.includes('ERR_CONNECTION_RESET') ||
        errMsg.includes('ERR_CONNECTION_REFUSED') ||
        errMsg.includes('ERR_CONNECTION_TIMED_OUT')) {
      // Mark this proxy as dead in the validation cache
      invalidateProxy(proxy);
    }
    
    throw new Error(`Browser: ${error.message.substring(0, 150)}`);
  }
}

/**
 * Detect and click ads (iframes and common ad elements)
 * Clicks the ad, waits for it to load (with timeout), then returns to original page
 */
async function detectAndClickAds(page) {
  const AD_CLICK_TIMEOUT = 15000; // 15 seconds timeout for ad page loading
  
  // 80% chance to click ads, 20% chance to skip
  const random = Math.random();
  if (random > 0.8) {
    console.log('  Skipping ad click (20% chance - not clicking)');
    return;
  }
  console.log(`  Ad click probability: ${(random * 100).toFixed(1)}% (will click ads)`);
  
  try {
    // Detect ad iframes and clickable ad elements
    const adInfo = await page.evaluate(() => {
      const ads = [];
      
      // 1. Find ad iframes (like the example: iframe with specific sizes)
      const iframes = document.querySelectorAll('iframe');
      iframes.forEach((iframe, index) => {
        const width = iframe.width || iframe.offsetWidth || 0;
        const height = iframe.height || iframe.offsetHeight || 0;
        const src = iframe.src || '';
        
        // Common ad sizes: 728x90, 300x250, 160x600, 320x50, 468x60, 336x280, 970x90
        const adSizes = [
          [728, 90], [300, 250], [160, 600], [320, 50],
          [468, 60], [336, 280], [970, 90], [970, 250],
          [300, 600], [250, 250], [200, 200], [120, 600]
        ];
        
        const isAdSize = adSizes.some(([w, h]) =>
          (parseInt(width) === w && parseInt(height) === h) ||
          (Math.abs(parseInt(width) - w) < 10 && Math.abs(parseInt(height) - h) < 10)
        );
        
        // Check if iframe looks like an ad
        const isAd = isAdSize ||
          src.includes('ad') ||
          src.includes('doubleclick') ||
          src.includes('googlesyndication') ||
          src.includes('adserver') ||
          src.includes('banner') ||
          iframe.id?.toLowerCase().includes('ad') ||
          iframe.className?.toLowerCase().includes('ad') ||
          iframe.getAttribute('data-ad') !== null ||
          (iframe.getAttribute('bis_size') !== null); // bis_size attribute from the example
        
        if (isAd && iframe.offsetWidth > 0 && iframe.offsetHeight > 0) {
          const rect = iframe.getBoundingClientRect();
          ads.push({
            type: 'iframe',
            index,
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
            width: rect.width,
            height: rect.height,
            visible: rect.top < window.innerHeight && rect.bottom > 0
          });
        }
      });
      
      // 2. Find common ad containers/links
      const adSelectors = [
        '[class*="ad-banner"]', '[class*="ad_banner"]',
        '[class*="advertisement"]', '[id*="ad-"]',
        '[id*="banner"]', '[class*="banner-ad"]',
        'a[href*="doubleclick"]', 'a[href*="googleads"]',
        'a[href*="adclick"]', 'a[href*="ad."]',
        '[data-ad]', '[data-ad-slot]',
        '.adsbygoogle', '[class*="sponsored"]',
        'ins.adsbygoogle'
      ];
      
      adSelectors.forEach(selector => {
        try {
          const elements = document.querySelectorAll(selector);
          elements.forEach(el => {
            if (el.offsetWidth > 0 && el.offsetHeight > 0) {
              const rect = el.getBoundingClientRect();
              if (rect.top < window.innerHeight && rect.bottom > 0) {
                ads.push({
                  type: 'element',
                  selector,
                  x: rect.x + rect.width / 2,
                  y: rect.y + rect.height / 2,
                  width: rect.width,
                  height: rect.height,
                  visible: true
                });
              }
            }
          });
        } catch(e) {}
      });
      
      return ads;
    });

    if (adInfo.length === 0) {
      console.log('  No ads detected on page');
      return;
    }

    console.log(`  Found ${adInfo.length} ad(s) on page`);

    // Click the first visible ad
    const targetAd = adInfo.find(ad => ad.visible) || adInfo[0];
    
    if (targetAd) {
      // Scroll to ad if needed
      await page.evaluate((ad) => {
        window.scrollTo({
          top: ad.y - window.innerHeight / 2,
          behavior: 'smooth'
        });
      }, targetAd);
      
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Use human-like mouse movement to click ad
      await humanMouseMove(page, targetAd.x, targetAd.y);

      // Remember original URL
      const originalUrl = page.url();
      
      // Click the ad
      try {
        if (targetAd.type === 'iframe') {
          // For iframes, click on the iframe element itself
          const frames = await page.$$('iframe');
          if (frames[targetAd.index]) {
            const frame = frames[targetAd.index];
            const box = await frame.boundingBox();
            if (box) {
              await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            }
          }
        } else {
          // Click at the center of the ad element
          await page.mouse.click(targetAd.x, targetAd.y);
        }

        console.log('  Clicked ad, waiting for navigation...');

        // Wait for navigation with timeout (ad page might open)
        try {
          await page.waitForNavigation({
            waitUntil: 'load',
            timeout: AD_CLICK_TIMEOUT
          });
          
          console.log(`  Ad page loaded: ${page.url()}`);
          
          // Wait a bit on the ad page (simulate reading)
          await new Promise(resolve => setTimeout(resolve, 3000));
          
        } catch (navError) {
          // Navigation timeout or no navigation happened (ad opened in new tab)
          console.log('  Ad click: no navigation or timeout (may have opened in new tab)');
        }

        // Check if we navigated away - if so, go back
        const currentUrl = page.url();
        if (currentUrl !== originalUrl && !currentUrl.includes('about:blank')) {
          console.log('  Navigating back to original page...');
          await page.goto(originalUrl, {
            waitUntil: 'load',
            timeout: 30000
          });
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        // Also check for new tabs/pages opened by the ad
        const pages = await page.browser().pages();
        if (pages.length > 1) {
          // Close any extra tabs opened by ads
          for (let i = pages.length - 1; i > 0; i--) {
            if (pages[i] !== page) {
              try {
                // Wait briefly on the ad tab
                await new Promise(resolve => setTimeout(resolve, 2000));
                await pages[i].close();
                console.log('  Closed ad tab');
              } catch(e) {}
            }
          }
        }

      } catch (clickError) {
        console.log(`  Ad click error: ${clickError.message}`);
      }
    }
  } catch (error) {
    console.log(`  Ad detection error: ${error.message}`);
  }
}

/**
 * Auto-scroll the page smoothly (like a real user)
 * @param {object} page - Puppeteer page object
 * @param {string} direction - 'down' or 'up'
 */
async function autoScroll(page, direction = 'down') {
  await page.evaluate(async (dir) => {
    await new Promise((resolve) => {
      // Randomize scroll behavior for each session
      const distance = 150 + Math.floor(Math.random() * 200);
      const delay = 80 + Math.floor(Math.random() * 150);

      if (dir === 'down') {
        let totalHeight = 0;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          // Add slight randomness to each scroll step
          const step = distance + Math.floor(Math.random() * 50) - 25;
          window.scrollBy(0, step);
          totalHeight += step;

          if (totalHeight >= scrollHeight) {
            window.scrollTo(0, document.body.scrollHeight);
            clearInterval(timer);
            resolve();
          }
        }, delay);
      } else {
        let scrolled = 0;
        const currentPos = window.pageYOffset || document.documentElement.scrollTop;
        
        const timer = setInterval(() => {
          const step = distance + Math.floor(Math.random() * 50) - 25;
          window.scrollBy(0, -step);
          scrolled += step;

          if (scrolled >= currentPos || window.pageYOffset <= 0) {
            window.scrollTo(0, 0);
            clearInterval(timer);
            resolve();
          }
        }, delay);
      }
    });
  }, direction);
}

/**
 * Verify a proxy by accessing a URL and checking for status 200
 * Also checks for proxy detection messages in the response
 * Uses a lightweight HTTP request (not full browser) for speed
 */
async function verifyProxy(verifyUrl, proxy) {
  // Check blacklist first
  if (isProxyBlacklisted(proxy)) {
    return {
      success: false,
      statusCode: 0,
      error: 'Proxy is blacklisted (previously detected)',
      proxyDetected: true
    };
  }

  // Quick TCP pre-check before attempting HTTP request
  // Non-blocking: log warning but still attempt the HTTP request
  const isReachable = await quickCheck(proxy);
  if (!isReachable) {
    console.log(`  ⚠️ TCP pre-check failed for ${proxy.ip}:${proxy.port} during verify - will try HTTP anyway`);
    // Don't invalidate or return failure - let the actual HTTP request be the judge
    // Some environments block raw TCP probes but HTTP through proxy still works
  }

  // Generate fingerprint for consistent headers
  const fingerprint = generateFingerprint();
  
  try {
    // Build proxy agent based on proxy type (HTTP vs SOCKS5)
    let agent;
    const proxyType = (proxy.type || 'HTTP').toUpperCase();
    
    if (proxyType === 'SOCKS5' || proxyType === 'SOCKS' || proxyType === 'SOCKS4') {
      // Use SOCKS proxy agent for SOCKS proxies
      let socksUrl;
      const protocol = proxyType === 'SOCKS4' ? 'socks4' : 'socks5';
      if (proxy.username && proxy.password) {
        socksUrl = `${protocol}://${proxy.username}:${proxy.password}@${proxy.ip}:${proxy.port}`;
      } else {
        socksUrl = `${protocol}://${proxy.ip}:${proxy.port}`;
      }
      agent = new SocksProxyAgent(socksUrl);
    } else {
      // Use HTTPS proxy agent for HTTP/HTTPS proxies
      let proxyUrl;
      if (proxy.username && proxy.password) {
        proxyUrl = `http://${proxy.username}:${proxy.password}@${proxy.ip}:${proxy.port}`;
      } else {
        proxyUrl = `http://${proxy.ip}:${proxy.port}`;
      }
      agent = new HttpsProxyAgent(proxyUrl);
    }
    
    const response = await axios.get(verifyUrl, {
      httpAgent: agent,
      httpsAgent: agent,
      timeout: 10000, // Reduced from 15s to 10s - if proxy is slow, it's not useful
      headers: {
        'User-Agent': fingerprint.userAgent,
        'Accept': fingerprint.headers['Accept'] || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': fingerprint.acceptLanguage,
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        ...(fingerprint.headers['sec-ch-ua'] ? {
          'sec-ch-ua': fingerprint.headers['sec-ch-ua'],
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': fingerprint.headers['sec-ch-ua-platform'],
        } : {}),
      },
      validateStatus: () => true, // Don't throw on non-2xx
      maxRedirects: 5
    });

    // Check response body for proxy detection messages
    const responseText = typeof response.data === 'string' ? response.data : '';
    if (PROXY_DETECTION_REGEX.test(responseText.toLowerCase())) {
      const match = responseText.toLowerCase().match(PROXY_DETECTION_REGEX);
      recordProxyDetection(proxy, `Verify: ${match[0]}`);
      return {
        success: false,
        statusCode: response.status,
        error: `Proxy detected during verification: ${match[0]}`,
        proxyDetected: true
      };
    }

    return {
      success: response.status === 200,
      statusCode: response.status,
      proxyDetected: false
    };
  } catch (error) {
    // Invalidate proxy on connection errors
    const errMsg = error.message || '';
    if (errMsg.includes('ECONNREFUSED') || errMsg.includes('ETIMEDOUT') ||
        errMsg.includes('ECONNRESET') || errMsg.includes('socket hang up') ||
        errMsg.includes('EHOSTUNREACH') || errMsg.includes('ENETUNREACH')) {
      invalidateProxy(proxy);
    }
    
    return {
      success: false,
      statusCode: 0,
      error: error.message,
      proxyDetected: false
    };
  }
}

module.exports = {
  accessWithProxy,
  verifyProxy,
  isProxyBlacklisted,
  filterBlacklistedProxies,
  getBlacklistStats,
  recordProxyDetection
};
