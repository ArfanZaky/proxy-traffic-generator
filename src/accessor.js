const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const https = require('https');
const { generateFingerprint, applyFingerprint, getLaunchArgs, humanMouseMove, simulateIdleBehavior } = require('./antiDetection');
const { globalRateLimiter } = require('./rateLimiter');

// Increase max listeners to prevent warnings
process.setMaxListeners(100);

/**
 * Access a URL using a proxy
 * @param {string} url - Target URL to access
 * @param {object} proxy - Proxy object {ip, port, type}
 * @param {boolean} useHeadless - true = headless (hidden), false = visible browser window
 */
async function accessWithProxy(url, proxy, useHeadless) {
  const startTime = Date.now();

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
 * Access URL using Puppeteer with full anti-detection
 * @param {boolean} headless - true = hidden browser, false = visible window
 */
async function accessWithPuppeteer(url, proxy, startTime, headless) {
  let browser = null;
  
  // Generate unique fingerprint for this session
  const fingerprint = generateFingerprint();
  
  try {
    const puppeteer = require('puppeteer');

    // Get anti-detection launch args based on fingerprint
    const stealthArgs = getLaunchArgs(fingerprint);
    
    browser = await puppeteer.launch({
      headless: headless ? 'new' : false,
      args: [
        `--proxy-server=http://${proxy.ip}:${proxy.port}`,
        ...stealthArgs,
      ],
      defaultViewport: null,
      timeout: 60000,
      ignoreDefaultArgs: ['--enable-automation']
    });

    const page = await browser.newPage();

    // Authenticate proxy if username/password provided
    if (proxy.username && proxy.password) {
      await page.authenticate({
        username: proxy.username,
        password: proxy.password
      });
    }
    
    // Apply full fingerprint (user-agent, viewport, headers, stealth scripts)
    await applyFingerprint(page, fingerprint);

    // Navigate to URL - wait until FULLY loaded
    const response = await page.goto(url, {
      waitUntil: ['load', 'networkidle0'],
      timeout: 60000
    });

    const statusCode = response ? response.status() : 0;

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
    throw new Error(`Browser: ${error.message.substring(0, 100)}`);
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
 * Uses a lightweight HTTP request (not full browser) for speed
 */
async function verifyProxy(verifyUrl, proxy) {
  // Generate fingerprint for consistent headers
  const fingerprint = generateFingerprint();
  
  try {
    // Build proxy URL with auth if needed
    let proxyUrl;
    if (proxy.username && proxy.password) {
      proxyUrl = `http://${proxy.username}:${proxy.password}@${proxy.ip}:${proxy.port}`;
    } else {
      proxyUrl = `http://${proxy.ip}:${proxy.port}`;
    }

    const agent = new HttpsProxyAgent(proxyUrl);
    
    const response = await axios.get(verifyUrl, {
      httpAgent: agent,
      httpsAgent: agent,
      timeout: 15000,
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

    return {
      success: response.status === 200,
      statusCode: response.status
    };
  } catch (error) {
    return {
      success: false,
      statusCode: 0,
      error: error.message
    };
  }
}

module.exports = { accessWithProxy, verifyProxy };
