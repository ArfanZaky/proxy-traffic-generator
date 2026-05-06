/**
 * Standalone test script to diagnose watcher-web proxy issues
 * Tests: 1) Direct connection, 2) Proxy scraping, 3) Proxy connection
 */

const path = require('path');

// Ensure we're in the right directory
process.chdir(__dirname);

async function main() {
  console.log('='.repeat(60));
  console.log('WATCHER-WEB DIAGNOSTIC TEST');
  console.log('='.repeat(60));
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Node: ${process.version}`);
  console.log(`CWD: ${process.cwd()}`);
  console.log('');

  // ============================================================
  // TEST 1: Can we even require all modules without errors?
  // ============================================================
  console.log('--- TEST 1: Module Loading ---');
  
  let puppeteer, proxyScraper, proxyValidator, antiDetection, rateLimiter;
  
  try {
    puppeteer = require('puppeteer');
    console.log(`✅ puppeteer loaded (v${require('puppeteer/package.json').version})`);
  } catch (e) {
    console.log(`❌ puppeteer FAILED: ${e.message}`);
    return;
  }

  try {
    const pExtra = require('puppeteer-extra');
    const stealth = require('puppeteer-extra-plugin-stealth');
    pExtra.use(stealth());
    console.log(`✅ puppeteer-extra + stealth loaded`);
  } catch (e) {
    console.log(`⚠️ puppeteer-extra not available: ${e.message}`);
  }

  try {
    proxyScraper = require('./src/proxyScraper');
    console.log(`✅ proxyScraper loaded`);
  } catch (e) {
    console.log(`❌ proxyScraper FAILED: ${e.message}`);
    console.log(e.stack);
    return;
  }

  try {
    proxyValidator = require('./src/proxyValidator');
    console.log(`✅ proxyValidator loaded`);
  } catch (e) {
    console.log(`❌ proxyValidator FAILED: ${e.message}`);
    console.log(e.stack);
    return;
  }

  try {
    antiDetection = require('./src/antiDetection');
    console.log(`✅ antiDetection loaded`);
  } catch (e) {
    console.log(`❌ antiDetection FAILED: ${e.message}`);
    console.log(e.stack);
    return;
  }

  try {
    rateLimiter = require('./src/rateLimiter');
    console.log(`✅ rateLimiter loaded`);
  } catch (e) {
    console.log(`❌ rateLimiter FAILED: ${e.message}`);
    console.log(e.stack);
    return;
  }

  try {
    const accessor = require('./src/accessor');
    console.log(`✅ accessor loaded (exports: ${Object.keys(accessor).join(', ')})`);
  } catch (e) {
    console.log(`❌ accessor FAILED: ${e.message}`);
    console.log(e.stack);
    return;
  }

  console.log('');

  // ============================================================
  // TEST 2: Direct Puppeteer launch (no proxy)
  // ============================================================
  console.log('--- TEST 2: Direct Puppeteer Launch (no proxy) ---');
  
  try {
    const startTime = Date.now();
    console.log('  Launching browser...');
    
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      timeout: 30000
    });
    
    console.log(`  ✅ Browser launched in ${Date.now() - startTime}ms`);
    
    const page = await browser.newPage();
    console.log('  Navigating to https://httpbin.org/ip ...');
    
    const response = await page.goto('https://httpbin.org/ip', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    const status = response.status();
    const body = await page.content();
    const title = await page.title();
    
    console.log(`  ✅ Status: ${status}`);
    console.log(`  ✅ Body preview: ${body.substring(0, 200)}`);
    
    await browser.close();
    console.log(`  ✅ Direct connection works! Total time: ${Date.now() - startTime}ms`);
  } catch (e) {
    console.log(`  ❌ Direct connection FAILED: ${e.message}`);
    console.log(`  Stack: ${e.stack}`);
  }

  console.log('');

  // ============================================================
  // TEST 3: Scrape proxies
  // ============================================================
  console.log('--- TEST 3: Proxy Scraping ---');
  
  let proxies = [];
  try {
    console.log('  Scraping proxies (this may take 10-30 seconds)...');
    const startTime = Date.now();
    proxies = await proxyScraper.scrapeProxies();
    console.log(`  ✅ Scraped ${proxies.length} proxies in ${Date.now() - startTime}ms`);
    
    if (proxies.length > 0) {
      // Show first 5 proxies
      console.log('  First 5 proxies:');
      proxies.slice(0, 5).forEach((p, i) => {
        console.log(`    ${i+1}. ${p.ip}:${p.port} (${p.type || 'HTTP'}) [${p.country || '??'}]`);
      });
    } else {
      console.log('  ⚠️ No proxies scraped! This is a problem.');
      console.log('  Trying to use a hardcoded test proxy instead...');
      // Use a known free proxy for testing
      proxies = [{ ip: '8.219.97.57', port: '80', type: 'HTTP', country: 'SG' }];
    }
  } catch (e) {
    console.log(`  ❌ Proxy scraping FAILED: ${e.message}`);
    console.log(`  Stack: ${e.stack}`);
    // Use a hardcoded proxy for testing
    proxies = [{ ip: '8.219.97.57', port: '80', type: 'HTTP', country: 'SG' }];
    console.log('  Using hardcoded test proxy instead.');
  }

  console.log('');

  // ============================================================
  // TEST 4: Access with proxy using Puppeteer
  // ============================================================
  console.log('--- TEST 4: Puppeteer with Proxy ---');
  
  // Try up to 3 proxies
  const testProxies = proxies.slice(0, 3);
  
  for (let i = 0; i < testProxies.length; i++) {
    const proxy = testProxies[i];
    const proxyArg = proxyValidator.getProxyServerArg(proxy);
    
    console.log(`\n  Attempt ${i+1}/${testProxies.length}: ${proxy.ip}:${proxy.port} (${proxy.type || 'HTTP'})`);
    console.log(`  Proxy arg: --proxy-server=${proxyArg}`);
    
    let browser = null;
    try {
      // Step 1: TCP check
      console.log('  Step 1: TCP connectivity check...');
      const tcpResult = await proxyValidator.checkTCPConnectivity(proxy.ip, proxy.port, 5000);
      console.log(`  TCP result: reachable=${tcpResult.reachable}, latency=${tcpResult.latencyMs}ms${tcpResult.error ? ', error=' + tcpResult.error : ''}`);
      
      if (!tcpResult.reachable) {
        console.log('  ⚠️ TCP unreachable, but trying browser anyway...');
      }
      
      // Step 2: Launch browser with proxy
      console.log('  Step 2: Launching browser with proxy...');
      const launchArgs = [
        `--proxy-server=${proxyArg}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ];
      console.log(`  Launch args: ${JSON.stringify(launchArgs)}`);
      
      const startTime = Date.now();
      browser = await puppeteer.launch({
        headless: 'new',
        args: launchArgs,
        timeout: 30000
      });
      console.log(`  ✅ Browser launched in ${Date.now() - startTime}ms`);
      
      // Step 3: Navigate
      const page = await browser.newPage();
      console.log('  Step 3: Navigating to https://httpbin.org/ip ...');
      
      const response = await page.goto('https://httpbin.org/ip', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      
      const status = response.status();
      const bodyText = await page.evaluate(() => document.body.innerText);
      
      console.log(`  ✅ Status: ${status}`);
      console.log(`  ✅ Response body: ${bodyText.trim()}`);
      console.log(`  ✅ SUCCESS! Proxy ${proxy.ip}:${proxy.port} works! Time: ${Date.now() - startTime}ms`);
      
      await browser.close();
      break; // Success, stop trying
      
    } catch (e) {
      console.log(`  ❌ FAILED: ${e.message}`);
      if (browser) {
        try { await browser.close(); } catch(closeErr) {}
      }
    }
  }

  console.log('');

  // ============================================================
  // TEST 5: Full accessor.accessWithProxy() test
  // ============================================================
  console.log('--- TEST 5: Full accessor.accessWithProxy() ---');
  
  // Test with proxy
  if (proxies.length > 0) {
    const proxy = proxies[0];
    console.log(`  Testing accessWithProxy("https://httpbin.org/ip", ${proxy.ip}:${proxy.port})...`);
    try {
      const { accessWithProxy } = require('./src/accessor');
      const result = await accessWithProxy('https://httpbin.org/ip', proxy, true, { skipTCPCheck: false });
      console.log(`  ✅ accessWithProxy succeeded!`);
      console.log(`  Result: status=${result.statusCode}, time=${result.responseTime}ms, title="${result.title}"`);
    } catch (e) {
      console.log(`  ❌ accessWithProxy FAILED: ${e.message}`);
    }
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('DIAGNOSTIC COMPLETE');
  console.log('='.repeat(60));
}

main().catch(e => {
  console.error('FATAL ERROR:', e);
  process.exit(1);
});
