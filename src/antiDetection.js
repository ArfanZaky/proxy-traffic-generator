/**
 * Anti-Detection Module
 * Comprehensive browser fingerprint randomization to avoid detection
 * Includes: User-Agent rotation, viewport randomization, header randomization,
 * WebGL/Canvas fingerprint spoofing, timezone randomization, WebRTC leak prevention
 */

// ============================================================
// USER-AGENT DATABASE (Updated 2024-2025)
// ============================================================

const USER_AGENTS = {
  chrome_windows: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  ],
  chrome_mac: [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  ],
  chrome_linux: [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  ],
  firefox_windows: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  ],
  firefox_mac: [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) Gecko/20100101 Firefox/126.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:126.0) Gecko/20100101 Firefox/126.0',
  ],
  firefox_linux: [
    'Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0',
    'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
    'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0',
  ],
  edge_windows: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
  ],
  safari_mac: [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  ],
  opera_windows: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 OPR/111.0.0.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 OPR/110.0.0.0',
  ]
};

// ============================================================
// VIEWPORT SIZES (Common screen resolutions)
// ============================================================

const VIEWPORTS = [
  { width: 1920, height: 1080 },  // Full HD (most common)
  { width: 1366, height: 768 },   // HD (laptops)
  { width: 1536, height: 864 },   // Common laptop
  { width: 1440, height: 900 },   // MacBook
  { width: 1280, height: 720 },   // HD
  { width: 1600, height: 900 },   // HD+
  { width: 2560, height: 1440 },  // QHD
  { width: 1680, height: 1050 },  // WSXGA+
  { width: 1280, height: 800 },   // WXGA
  { width: 1920, height: 1200 },  // WUXGA
  { width: 1360, height: 768 },   // Common
  { width: 1400, height: 1050 },  // SXGA+
];

// ============================================================
// ACCEPT-LANGUAGE HEADERS
// ============================================================

const ACCEPT_LANGUAGES = [
  'en-US,en;q=0.9',
  'en-US,en;q=0.9,es;q=0.8',
  'en-GB,en;q=0.9,en-US;q=0.8',
  'en-US,en;q=0.9,fr;q=0.8',
  'en-US,en;q=0.9,de;q=0.8',
  'en-US,en;q=0.9,ja;q=0.8',
  'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
  'en-US,en;q=0.9,ko;q=0.8',
  'en-US,en;q=0.9,pt;q=0.8',
  'en-US,en;q=0.9,it;q=0.8',
  'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'en-US,en;q=0.9,id;q=0.8',
  'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
  'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
  'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
  'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'zh-CN,zh;q=0.9,en;q=0.8',
  'es-ES,es;q=0.9,en;q=0.8',
  'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
];

// ============================================================
// TIMEZONE DATA
// ============================================================

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Seoul',
  'Asia/Jakarta',
  'Asia/Singapore',
  'Australia/Sydney',
  'America/Sao_Paulo',
  'Asia/Kolkata',
  'Pacific/Auckland',
];

// ============================================================
// WEBGL VENDORS & RENDERERS
// ============================================================

const WEBGL_VENDORS = [
  'Google Inc. (NVIDIA)',
  'Google Inc. (AMD)',
  'Google Inc. (Intel)',
  'Google Inc.',
  'Intel Inc.',
  'NVIDIA Corporation',
  'ATI Technologies Inc.',
];

const WEBGL_RENDERERS = [
  'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (AMD, AMD Radeon RX 6600 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'Mesa Intel(R) UHD Graphics 630 (CFL GT2)',
  'AMD Radeon Pro 5500M OpenGL Engine',
  'Apple M1',
  'Apple M2',
  'Apple M3',
];

// ============================================================
// PLATFORM DATA
// ============================================================

const PLATFORMS = {
  windows: { platform: 'Win32', oscpu: 'Windows NT 10.0; Win64; x64' },
  mac: { platform: 'MacIntel', oscpu: 'Intel Mac OS X 10.15' },
  linux: { platform: 'Linux x86_64', oscpu: 'Linux x86_64' },
};

// ============================================================
// PROXY DETECTION SIGNATURES
// Patterns that indicate a proxy has been detected
// ============================================================

const PROXY_DETECTION_PATTERNS = [
  'anonymous proxy detected',
  'proxy detected',
  'vpn detected',
  'proxy/vpn detected',
  'access denied.*proxy',
  'proxy.*not allowed',
  'datacenter.*detected',
  'suspicious.*traffic',
  'bot.*detected',
  'automated.*access',
  'please disable.*proxy',
  'please disable.*vpn',
  'your ip.*flagged',
  'ip.*blocked',
  'connection.*not private',
  'cloudflare.*challenge',
  'captcha.*required',
  'rate.*limit.*exceeded',
  'too many requests',
  'forbidden.*proxy',
];

// Compiled regex for fast matching
const PROXY_DETECTION_REGEX = new RegExp(
  PROXY_DETECTION_PATTERNS.join('|'),
  'i'
);

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ============================================================
// MAIN FUNCTIONS
// ============================================================

/**
 * Generate a complete browser fingerprint profile
 * All values are consistent (e.g., Windows UA won't have Mac platform)
 */
function generateFingerprint() {
  // Pick a browser/OS combination
  const profiles = [
    { browser: 'chrome', os: 'windows', weight: 40 },
    { browser: 'chrome', os: 'mac', weight: 20 },
    { browser: 'chrome', os: 'linux', weight: 10 },
    { browser: 'firefox', os: 'windows', weight: 10 },
    { browser: 'firefox', os: 'mac', weight: 5 },
    { browser: 'firefox', os: 'linux', weight: 5 },
    { browser: 'edge', os: 'windows', weight: 5 },
    { browser: 'safari', os: 'mac', weight: 3 },
    { browser: 'opera', os: 'windows', weight: 2 },
  ];

  // Weighted random selection
  const totalWeight = profiles.reduce((sum, p) => sum + p.weight, 0);
  let random = Math.random() * totalWeight;
  let selected = profiles[0];
  for (const profile of profiles) {
    random -= profile.weight;
    if (random <= 0) {
      selected = profile;
      break;
    }
  }

  const { browser, os } = selected;
  const uaKey = `${browser}_${os}`;
  const userAgent = randomItem(USER_AGENTS[uaKey] || USER_AGENTS.chrome_windows);
  const viewport = randomItem(VIEWPORTS);
  const acceptLanguage = randomItem(ACCEPT_LANGUAGES);
  const timezone = randomItem(TIMEZONES);
  const platformData = PLATFORMS[os] || PLATFORMS.windows;
  const webglVendor = randomItem(WEBGL_VENDORS);
  const webglRenderer = randomItem(WEBGL_RENDERERS);

  // Generate consistent screen properties
  const screenWidth = viewport.width + randomInt(0, 200);
  const screenHeight = viewport.height + randomInt(0, 100);
  const colorDepth = randomItem([24, 32]);
  const pixelRatio = randomItem([1, 1, 1, 1.25, 1.5, 2]);
  const hardwareConcurrency = randomItem([2, 4, 6, 8, 12, 16]);
  const deviceMemory = randomItem([2, 4, 8, 16]);

  return {
    userAgent,
    viewport,
    acceptLanguage,
    timezone,
    platform: platformData.platform,
    oscpu: platformData.oscpu,
    webglVendor,
    webglRenderer,
    screen: {
      width: screenWidth,
      height: screenHeight,
      colorDepth,
      pixelRatio,
    },
    hardwareConcurrency,
    deviceMemory,
    browser,
    os,
    // Extra headers
    headers: generateHeaders(browser, acceptLanguage),
  };
}

/**
 * Generate realistic HTTP headers based on browser type
 */
function generateHeaders(browser, acceptLanguage) {
  const headers = {
    'Accept-Language': acceptLanguage,
    'DNT': Math.random() > 0.7 ? '1' : undefined,
    'Upgrade-Insecure-Requests': '1',
  };

  switch (browser) {
    case 'chrome':
    case 'edge':
    case 'opera':
      headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';
      headers['sec-ch-ua'] = generateSecChUa(browser);
      headers['sec-ch-ua-mobile'] = '?0';
      headers['sec-ch-ua-platform'] = randomItem(['"Windows"', '"macOS"', '"Linux"']);
      headers['Sec-Fetch-Dest'] = 'document';
      headers['Sec-Fetch-Mode'] = 'navigate';
      headers['Sec-Fetch-Site'] = randomItem(['none', 'same-origin', 'cross-site']);
      headers['Sec-Fetch-User'] = '?1';
      break;
    case 'firefox':
      headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
      headers['Sec-Fetch-Dest'] = 'document';
      headers['Sec-Fetch-Mode'] = 'navigate';
      headers['Sec-Fetch-Site'] = randomItem(['none', 'same-origin', 'cross-site']);
      headers['Sec-Fetch-User'] = '?1';
      break;
    case 'safari':
      headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
      break;
  }

  // Remove undefined values
  Object.keys(headers).forEach(key => {
    if (headers[key] === undefined) delete headers[key];
  });

  return headers;
}

/**
 * Generate sec-ch-ua header for Chromium browsers
 */
function generateSecChUa(browser) {
  const version = randomInt(120, 126);
  const brands = [
    `"Chromium";v="${version}"`,
    `"Not_A Brand";v="${randomItem(['8', '24', '99'])}"`,
  ];

  switch (browser) {
    case 'chrome':
      brands.push(`"Google Chrome";v="${version}"`);
      break;
    case 'edge':
      brands.push(`"Microsoft Edge";v="${version}"`);
      break;
    case 'opera':
      brands.push(`"Opera";v="${version - 14}"`);
      break;
  }

  // Shuffle brands
  return brands.sort(() => Math.random() - 0.5).join(', ');
}

/**
 * Get stealth scripts to inject into page (evaluateOnNewDocument)
 * These override browser APIs to prevent fingerprint detection
 */
function getStealthScripts(fingerprint) {
  return function (fp) {
    // Override navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', { get: () => false });

    // Override navigator.plugins (non-empty)
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const plugins = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
        ];
        plugins.length = 3;
        return plugins;
      }
    });

    // Override navigator.languages
    const lang = fp.acceptLanguage.split(',')[0].split(';')[0];
    Object.defineProperty(navigator, 'languages', {
      get: () => [lang, lang.split('-')[0]]
    });

    // Override navigator.platform
    Object.defineProperty(navigator, 'platform', { get: () => fp.platform });

    // Override navigator.hardwareConcurrency
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => fp.hardwareConcurrency });

    // Override navigator.deviceMemory
    if (fp.deviceMemory) {
      Object.defineProperty(navigator, 'deviceMemory', { get: () => fp.deviceMemory });
    }

    // Override screen properties
    Object.defineProperty(screen, 'width', { get: () => fp.screen.width });
    Object.defineProperty(screen, 'height', { get: () => fp.screen.height });
    Object.defineProperty(screen, 'availWidth', { get: () => fp.screen.width });
    Object.defineProperty(screen, 'availHeight', { get: () => fp.screen.height - 40 });
    Object.defineProperty(screen, 'colorDepth', { get: () => fp.screen.colorDepth });
    Object.defineProperty(screen, 'pixelDepth', { get: () => fp.screen.colorDepth });

    // Override window.devicePixelRatio
    Object.defineProperty(window, 'devicePixelRatio', { get: () => fp.screen.pixelRatio });

    // Override WebGL fingerprint
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (parameter) {
      if (parameter === 37445) return fp.webglVendor; // UNMASKED_VENDOR_WEBGL
      if (parameter === 37446) return fp.webglRenderer; // UNMASKED_RENDERER_WEBGL
      return getParameter.call(this, parameter);
    };

    // Also override WebGL2
    if (typeof WebGL2RenderingContext !== 'undefined') {
      const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function (parameter) {
        if (parameter === 37445) return fp.webglVendor;
        if (parameter === 37446) return fp.webglRenderer;
        return getParameter2.call(this, parameter);
      };
    }

    // Override canvas fingerprint (add noise)
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (type) {
      if (this.width === 0 || this.height === 0) return originalToDataURL.apply(this, arguments);
      const ctx = this.getContext('2d');
      if (ctx) {
        // Add subtle noise to canvas
        const imageData = ctx.getImageData(0, 0, Math.min(this.width, 2), Math.min(this.height, 2));
        for (let i = 0; i < imageData.data.length; i += 4) {
          imageData.data[i] = imageData.data[i] ^ (Math.random() > 0.5 ? 1 : 0);
        }
        ctx.putImageData(imageData, 0, 0);
      }
      return originalToDataURL.apply(this, arguments);
    };

    // Override Intl.DateTimeFormat for timezone
    const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    Intl.DateTimeFormat.prototype.resolvedOptions = function () {
      const result = originalResolvedOptions.call(this);
      result.timeZone = fp.timezone;
      return result;
    };

    // Chrome-specific: window.chrome
    if (!window.chrome) {
      window.chrome = { runtime: {}, loadTimes: function () { }, csi: function () { } };
    }

    // Override permissions query
    const originalQuery = window.navigator.permissions?.query;
    if (originalQuery) {
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
    }

    // Prevent iframe detection
    Object.defineProperty(document, 'hidden', { get: () => false });
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });

    // ============================================================
    // WebRTC Leak Prevention - Critical for proxy anonymity
    // ============================================================

    // Block WebRTC from leaking real IP
    if (window.RTCPeerConnection) {
      const OriginalRTCPeerConnection = window.RTCPeerConnection;
      window.RTCPeerConnection = function (config, constraints) {
        // Force all ICE candidates through the proxy by disabling local candidates
        if (config && config.iceServers) {
          config.iceServers = [];
        }
        config = config || {};
        config.iceServers = [];

        const pc = new OriginalRTCPeerConnection(config, constraints);

        // Override onicecandidate to filter local IPs
        const originalAddEventListener = pc.addEventListener.bind(pc);
        pc.addEventListener = function (type, listener, options) {
          if (type === 'icecandidate') {
            const wrappedListener = function (event) {
              if (event.candidate && event.candidate.candidate) {
                // Block candidates that reveal local/real IP
                const candidate = event.candidate.candidate;
                if (candidate.includes('srflx') || candidate.includes('relay') ||
                  candidate.includes('host')) {
                  // Create a modified event with null candidate
                  const modifiedEvent = new Event('icecandidate');
                  modifiedEvent.candidate = null;
                  listener(modifiedEvent);
                  return;
                }
              }
              listener(event);
            };
            return originalAddEventListener(type, wrappedListener, options);
          }
          return originalAddEventListener(type, listener, options);
        };

        return pc;
      };
      window.RTCPeerConnection.prototype = OriginalRTCPeerConnection.prototype;
    }

    // Also block webkitRTCPeerConnection
    if (window.webkitRTCPeerConnection) {
      window.webkitRTCPeerConnection = window.RTCPeerConnection;
    }

    // Block MediaDevices to prevent device enumeration fingerprinting
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices = () => Promise.resolve([]);
    }

    // Override connection info (Network Information API)
    if (navigator.connection) {
      Object.defineProperty(navigator.connection, 'effectiveType', { get: () => '4g' });
      Object.defineProperty(navigator.connection, 'rtt', { get: () => 50 });
      Object.defineProperty(navigator.connection, 'downlink', { get: () => 10 });
    }

    // Override Battery API (can be used for fingerprinting)
    if (navigator.getBattery) {
      navigator.getBattery = () => Promise.resolve({
        charging: true,
        chargingTime: 0,
        dischargingTime: Infinity,
        level: 1.0,
        addEventListener: () => { },
        removeEventListener: () => { }
      });
    }

    // Spoof AudioContext fingerprint
    if (window.AudioContext || window.webkitAudioContext) {
      const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
      const originalCreateOscillator = OriginalAudioContext.prototype.createOscillator;
      OriginalAudioContext.prototype.createOscillator = function () {
        const oscillator = originalCreateOscillator.call(this);
        // Add slight randomness to frequency
        const originalFrequency = oscillator.frequency;
        return oscillator;
      };
    }
  };
}

/**
 * Generate Puppeteer launch args based on fingerprint
 * Enhanced with WebRTC leak prevention and proxy detection avoidance
 */
function getLaunchArgs(fingerprint) {
  const { viewport } = fingerprint;
  return [
    `--window-size=${viewport.width},${viewport.height}`,
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    `--lang=${fingerprint.acceptLanguage.split(',')[0].split(';')[0]}`,
    // WebRTC leak prevention
    '--enforce-webrtc-ip-permission-check',
    '--disable-webrtc-hw-decoding',
    '--disable-webrtc-hw-encoding',
    '--webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    // Additional anti-detection
    '--disable-features=WebRtcHideLocalIpsWithMdns',
    '--disable-component-extensions-with-background-pages',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-hang-monitor',
    '--disable-popup-blocking',
    '--disable-prompt-on-repost',
    '--disable-sync',
    '--disable-translate',
    '--metrics-recording-only',
    '--no-first-run',
    '--safebrowsing-disable-auto-update',
    // Storage optimization - reduce temporary file usage
    '--disk-cache-size=0',
    '--media-cache-size=0',
    '--disable-application-cache',
    '--disable-offline-load-stale-cache',
    '--disable-cache',
    // NOTE: DNS leak prevention is handled in accessor.js (only when proxy is active)
    // Do NOT add --host-resolver-rules here as it breaks direct connections
  ];
}

/**
 * Apply fingerprint to a Puppeteer page
 */
async function applyFingerprint(page, fingerprint) {
  // Set user agent
  if (page.isClosed()) return;
  await page.setUserAgent(fingerprint.userAgent);

  // Set viewport with device scale factor
  if (page.isClosed()) return;
  await page.setViewport({
    width: fingerprint.viewport.width,
    height: fingerprint.viewport.height,
    deviceScaleFactor: fingerprint.screen.pixelRatio,
  });

  // Set extra HTTP headers
  if (page.isClosed()) return;
  await page.setExtraHTTPHeaders(fingerprint.headers);

  // Inject stealth scripts before any page loads
  if (page.isClosed()) return;
  await page.evaluateOnNewDocument(getStealthScripts(fingerprint), fingerprint);

  // Emulate timezone
  if (page.isClosed()) return;
  try {
    await page.emulateTimezone(fingerprint.timezone);
  } catch (e) {
    // Some puppeteer versions don't support this
  }
}

/**
 * Check if page content indicates proxy detection
 * @param {object} page - Puppeteer page object
 * @returns {object} { detected: boolean, reason: string }
 */
async function checkProxyDetection(page) {
  try {
    const content = await page.content();
    const bodyText = await page.evaluate(() => document.body ? document.body.innerText : '');
    const title = await page.title();

    // Check page content for proxy detection messages
    const textToCheck = `${title} ${bodyText}`.toLowerCase();

    if (PROXY_DETECTION_REGEX.test(textToCheck)) {
      const match = textToCheck.match(PROXY_DETECTION_REGEX);
      return {
        detected: true,
        reason: `Proxy detection message found: "${match[0]}"`
      };
    }

    // Check for common proxy detection HTTP status patterns
    // Some sites return 403 with specific proxy-related content
    if (content.length < 500 && (
      textToCheck.includes('access denied') ||
      textToCheck.includes('forbidden') ||
      textToCheck.includes('blocked')
    )) {
      return {
        detected: true,
        reason: 'Short page with access denied/blocked message (likely proxy detection)'
      };
    }

    // Check for Cloudflare challenge
    if (content.includes('cf-browser-verification') ||
      content.includes('cf_chl_opt') ||
      content.includes('challenge-platform')) {
      return {
        detected: true,
        reason: 'Cloudflare challenge detected (proxy may be flagged)'
      };
    }

    return { detected: false, reason: null };
  } catch (error) {
    return { detected: false, reason: null };
  }
}

/**
 * Generate random mouse movement patterns
 * Returns array of {x, y, delay} for realistic mouse movement
 */
function generateMouseMovements(startX, startY, endX, endY, steps = null) {
  if (!steps) steps = randomInt(5, 15);

  const movements = [];
  const controlX = startX + (endX - startX) * Math.random();
  const controlY = startY + (endY - startY) * Math.random();

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Bezier curve for natural movement
    const x = Math.round(
      (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * controlX + t * t * endX
    );
    const y = Math.round(
      (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * controlY + t * t * endY
    );
    const delay = randomInt(10, 50);
    movements.push({ x, y, delay });
  }

  return movements;
}

/**
 * Simulate human-like mouse movement on a page
 */
async function humanMouseMove(page, targetX, targetY) {
  const currentPos = await page.evaluate(() => ({
    x: window.mouseX || Math.floor(Math.random() * 500),
    y: window.mouseY || Math.floor(Math.random() * 300)
  }));

  const movements = generateMouseMovements(currentPos.x, currentPos.y, targetX, targetY);

  for (const move of movements) {
    await page.mouse.move(move.x, move.y);
    await new Promise(resolve => setTimeout(resolve, move.delay));
  }
}

/**
 * Simulate random idle behavior (mouse jitter, small scrolls)
 */
async function simulateIdleBehavior(page, durationMs = 3000) {
  const startTime = Date.now();

  while (Date.now() - startTime < durationMs) {
    const action = Math.random();

    if (action < 0.3) {
      // Small mouse movement
      const x = randomInt(100, 1200);
      const y = randomInt(100, 600);
      await page.mouse.move(x, y);
    } else if (action < 0.5) {
      // Tiny scroll
      await page.evaluate(() => {
        window.scrollBy(0, Math.floor(Math.random() * 50) - 25);
      });
    }
    // else: do nothing (idle)

    await new Promise(resolve => setTimeout(resolve, randomInt(200, 800)));
  }
}

module.exports = {
  generateFingerprint,
  getStealthScripts,
  getLaunchArgs,
  applyFingerprint,
  checkProxyDetection,
  generateMouseMovements,
  humanMouseMove,
  simulateIdleBehavior,
  PROXY_DETECTION_REGEX,
  PROXY_DETECTION_PATTERNS,
  // Expose individual generators for backward compat
  getRandomUserAgent: () => randomItem(Object.values(USER_AGENTS).flat()),
  getRandomAcceptLanguage: () => randomItem(ACCEPT_LANGUAGES),
  getRandomViewport: () => randomItem(VIEWPORTS),
  getRandomTimezone: () => randomItem(TIMEZONES),
};
