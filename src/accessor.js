const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const https = require('https');

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

  if (useHeadless) {
    // Headless mode: browser hidden
    return await accessWithPuppeteer(url, proxy, startTime, true);
  } else {
    // Visible browser mode: window appears
    return await accessWithPuppeteer(url, proxy, startTime, false);
  }
}

/**
 * Access URL using Puppeteer (without puppeteer-extra to avoid TargetCloseError)
 * @param {boolean} headless - true = hidden browser, false = visible window
 */
async function accessWithPuppeteer(url, proxy, startTime, headless) {
  let browser = null;
  
  try {
    const puppeteer = require('puppeteer');

    browser = await puppeteer.launch({
      headless: headless ? 'new' : false,
      args: [
        `--proxy-server=http://${proxy.ip}:${proxy.port}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1366,768',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-blink-features=AutomationControlled'
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
    
    // Manual stealth: override navigator.webdriver
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      window.chrome = { runtime: {} };
    });

    // Set random user agent
    await page.setUserAgent(getRandomUserAgent());
    
    // Set viewport
    await page.setViewport({ width: 1366, height: 768 });

    // Set extra headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': getRandomAcceptLanguage(),
      'DNT': Math.random() > 0.5 ? '1' : '0'
    });

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

    // === STEP 1: Page is FULLY loaded, now wait 10 seconds ===
    await new Promise(resolve => setTimeout(resolve, 10000));

    // === STEP 1.5: Ad clicking disabled ===
    // await detectAndClickAds(page);

    // === STEP 2: Scroll down to the bottom of the page ===
    await autoScroll(page, 'down');

    // Small pause at the bottom
    await new Promise(resolve => setTimeout(resolve, 2000));

    // === STEP 3: Scroll back up to the top ===
    await autoScroll(page, 'up');

    // Small pause at the top
    await new Promise(resolve => setTimeout(resolve, 1000));

    const responseTime = Date.now() - startTime;

    await browser.close();

    return {
      statusCode,
      responseTime,
      title: title || 'N/A',
      contentLength: 'N/A (Browser mode)'
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
      const distance = 200 + Math.floor(Math.random() * 150);
      const delay = 100 + Math.floor(Math.random() * 100);

      if (dir === 'down') {
        let totalHeight = 0;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

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
          window.scrollBy(0, -distance);
          scrolled += distance;

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
 * Get a random User-Agent string
 */
function getRandomUserAgent() {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0',
    'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Vivaldi/6.5'
  ];
  
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

/**
 * Get random Accept-Language header
 */
function getRandomAcceptLanguage() {
  const languages = [
    'en-US,en;q=0.9',
    'en-GB,en;q=0.9',
    'en-US,en;q=0.9,id;q=0.8',
    'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'en-US,en;q=0.9,fr;q=0.8',
    'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
    'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
    'zh-CN,zh;q=0.9,en;q=0.8',
    'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    'es-ES,es;q=0.9,en;q=0.8'
  ];
  return languages[Math.floor(Math.random() * languages.length)];
}

/**
 * Verify a proxy by accessing a URL and checking for status 200
 * Uses a lightweight HTTP request (not full browser) for speed
 */
async function verifyProxy(verifyUrl, proxy) {
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
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': getRandomAcceptLanguage()
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
