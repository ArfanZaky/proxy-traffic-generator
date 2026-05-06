const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');
const { isValidPort, isValidIP } = require('./proxyValidator');

// Create axios instance that ignores SSL certificate errors
const axiosInsecure = axios.create({
  httpsAgent: new https.Agent({ rejectUnauthorized: false })
});

/**
 * Scrape HTTPS/SSL proxies - prioritize Elite/High Anonymous proxies
 * Enhanced: More sources, better filtering, residential proxy preference
 */
async function scrapeProxies() {
  const proxies = [];
  
  try {
    // Source 1: spys.one HTTPS proxy list
    const spysProxies = await scrapeSpysOne();
    proxies.push(...spysProxies);
  } catch (error) {
    console.error('Error scraping spys.one:', error.message);
  }

  try {
    // Source 2: free-proxy-list.net (Elite proxies only)
    const fplProxies = await scrapeFreeProxyList();
    proxies.push(...fplProxies);
  } catch (error) {
    console.error('Error scraping free-proxy-list:', error.message);
  }

  try {
    // Source 3: sslproxies.org
    const sslProxies = await scrapeSSLProxies();
    proxies.push(...sslProxies);
  } catch (error) {
    console.error('Error scraping sslproxies:', error.message);
  }

  try {
    // Source 4: GitHub proxy lists (elite/anonymous only)
    const ghProxies = await scrapeGitHubProxies();
    proxies.push(...ghProxies);
  } catch (error) {
    console.error('Error scraping GitHub proxies:', error.message);
  }

  try {
    // Source 5: ProxyScrape API (elite HTTPS proxies)
    const psProxies = await scrapeProxyScrapeAPI();
    proxies.push(...psProxies);
  } catch (error) {
    console.error('Error scraping ProxyScrape:', error.message);
  }

  try {
    // Source 6: GeoNode free proxy list
    const geoProxies = await scrapeGeoNode();
    proxies.push(...geoProxies);
  } catch (error) {
    console.error('Error scraping GeoNode:', error.message);
  }

  try {
    // Source 7: proxy-list.download API (Elite HTTPS)
    const pldProxies = await scrapeProxyListDownload();
    proxies.push(...pldProxies);
  } catch (error) {
    console.error('Error scraping proxy-list.download:', error.message);
  }

  try {
    // Source 8: ShiftyTR GitHub HTTPS proxy list
    const shiftyProxies = await scrapeShiftyTR();
    proxies.push(...shiftyProxies);
  } catch (error) {
    console.error('Error scraping ShiftyTR GitHub:', error.message);
  }

  try {
    // Source 9: jetkai GitHub HTTPS proxy list
    const jetkaiProxies = await scrapeJetkai();
    proxies.push(...jetkaiProxies);
  } catch (error) {
    console.error('Error scraping jetkai GitHub:', error.message);
  }

  try {
    // Source 10: roosterkid GitHub HTTPS proxy list
    const roosterkidProxies = await scrapeRoosterkid();
    proxies.push(...roosterkidProxies);
  } catch (error) {
    console.error('Error scraping roosterkid GitHub:', error.message);
  }

  try {
    // Source 11: sunny9577 GitHub HTTP proxy list
    const sunnyProxies = await scrapeSunny9577();
    proxies.push(...sunnyProxies);
  } catch (error) {
    console.error('Error scraping sunny9577 GitHub:', error.message);
  }

  // Remove duplicates and validate format
  const unique = [];
  const seen = new Set();
  let invalidCount = 0;
  for (const proxy of proxies) {
    // Validate IP and port format before adding
    if (!isValidIP(proxy.ip) || !isValidPort(proxy.port)) {
      invalidCount++;
      continue;
    }
    const key = `${proxy.ip}:${proxy.port}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(proxy);
    }
  }

  if (invalidCount > 0) {
    console.log(`Filtered out ${invalidCount} proxies with invalid IP/port format`);
  }

  // Sort: Elite first, then High Anonymous, then Anonymous
  // Transparent proxies are excluded entirely (they reveal your IP)
  const filtered = unique.filter(p => p.anonymity !== 'transparent');
  
  filtered.sort((a, b) => {
    const order = { 'elite': 0, 'high': 1, 'anonymous': 2, 'unknown': 3 };
    const aOrder = order[a.anonymity] !== undefined ? order[a.anonymity] : 3;
    const bOrder = order[b.anonymity] !== undefined ? order[b.anonymity] : 3;
    return aOrder - bOrder;
  });

  const eliteCount = filtered.filter(p => p.anonymity === 'elite').length;
  const anonCount = filtered.filter(p => p.anonymity === 'anonymous' || p.anonymity === 'high').length;
  
  console.log(`Total proxies scraped: ${filtered.length} (Elite: ${eliteCount}, Anonymous: ${anonCount}, Other: ${filtered.length - eliteCount - anonCount})`);
  console.log(`Excluded ${unique.length - filtered.length} transparent proxies`);

  return filtered;
}

/**
 * Scrape from spys.one
 */
async function scrapeSpysOne() {
  const proxies = [];
  
  const response = await axiosInsecure.get('https://spys.one/en/https-ssl-proxy/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    },
    timeout: 30000
  });

  const $ = cheerio.load(response.data);
  
  // Extract JavaScript variables for port decoding
  const scripts = $('script').map((i, el) => $(el).html()).get().join('\n');
  const varMatches = scripts.match(/([a-z0-9]+)=(\d+)/g);
  const vars = {};
  if (varMatches) {
    varMatches.forEach(match => {
      const [key, value] = match.split('=');
      vars[key] = parseInt(value);
    });
  }

  // Parse proxy table
  $('tr.spy1x, tr.spy1xx').each((i, row) => {
    const cells = $(row).find('td');
    if (cells.length >= 2) {
      const ipCell = $(cells[0]);
      const ipText = ipCell.text().trim();
      const ipMatch = ipText.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
      const portMatch = ipText.match(/:(\d+)/);
      
      if (ipMatch) {
        const ip = ipMatch[1];
        let port = portMatch ? portMatch[1] : null;
        
        if (!port) {
          const portScript = ipCell.find('script').html() || '';
          port = decodePort(portScript, vars);
        }
        
        if (port) {
          const typeText = cells.length > 1 ? $(cells[1]).text().trim().toLowerCase() : '';
          const country = cells.length > 3 ? $(cells[3]).text().trim() : 'Unknown';
          
          // Determine anonymity level
          let anonymity = 'unknown';
          if (typeText.includes('hia') || typeText.includes('elite')) {
            anonymity = 'elite';
          } else if (typeText.includes('anm') || typeText.includes('anonymous')) {
            anonymity = 'anonymous';
          } else if (typeText.includes('noa') || typeText.includes('transparent')) {
            anonymity = 'transparent';
          }
          
          // Only add non-transparent proxies
          if (anonymity !== 'transparent') {
            proxies.push({
              ip, port,
              type: 'HTTPS',
              country: country || 'Unknown',
              anonymity
            });
          }
        }
      }
    }
  });

  return proxies;
}

/**
 * Decode port from spys.one JavaScript encoding
 */
function decodePort(script, vars) {
  if (!script) return null;
  try {
    const portParts = script.match(/\(([a-z0-9]+)\^([a-z0-9]+)\)/g);
    if (portParts) {
      let port = '';
      portParts.forEach(part => {
        const match = part.match(/\(([a-z0-9]+)\^([a-z0-9]+)\)/);
        if (match) {
          const val1 = vars[match[1]] !== undefined ? vars[match[1]] : parseInt(match[1]) || 0;
          const val2 = vars[match[2]] !== undefined ? vars[match[2]] : parseInt(match[2]) || 0;
          port += (val1 ^ val2).toString();
        }
      });
      return port || null;
    }
  } catch (e) {}
  return null;
}

/**
 * Scrape from free-proxy-list.net - ELITE proxies only
 */
async function scrapeFreeProxyList() {
  const proxies = [];
  
  const response = await axios.get('https://free-proxy-list.net/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    timeout: 15000
  });

  const $ = cheerio.load(response.data);
  
  $('table.table tbody tr').each((i, row) => {
    const cells = $(row).find('td');
    if (cells.length >= 7) {
      const ip = $(cells[0]).text().trim();
      const port = $(cells[1]).text().trim();
      const country = $(cells[3]).text().trim();
      const anonymityText = $(cells[4]).text().trim().toLowerCase();
      const isHttps = $(cells[6]).text().trim();
      
      if (ip && port) {
        let anonymity = 'unknown';
        if (anonymityText.includes('elite')) {
          anonymity = 'elite';
        } else if (anonymityText.includes('anonymous')) {
          anonymity = 'anonymous';
        } else if (anonymityText.includes('transparent')) {
          anonymity = 'transparent';
        }
        
        // Only add elite and anonymous proxies (skip transparent)
        if (anonymity === 'elite' || anonymity === 'anonymous') {
          proxies.push({
            ip, port,
            type: isHttps === 'yes' ? 'HTTPS' : 'HTTP',
            country: country || 'Unknown',
            anonymity
          });
        }
      }
    }
  });

  return proxies;
}

/**
 * Scrape from sslproxies.org
 */
async function scrapeSSLProxies() {
  const proxies = [];
  
  try {
    const response = await axios.get('https://www.sslproxies.org/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 15000
    });

    const $ = cheerio.load(response.data);
    
    $('table.table tbody tr').each((i, row) => {
      const cells = $(row).find('td');
      if (cells.length >= 7) {
        const ip = $(cells[0]).text().trim();
        const port = $(cells[1]).text().trim();
        const country = $(cells[3]).text().trim();
        const anonymityText = $(cells[4]).text().trim().toLowerCase();
        
        if (ip && port) {
          let anonymity = 'unknown';
          if (anonymityText.includes('elite')) {
            anonymity = 'elite';
          } else if (anonymityText.includes('anonymous')) {
            anonymity = 'anonymous';
          }
          
          if (anonymity === 'elite' || anonymity === 'anonymous') {
            proxies.push({
              ip, port,
              type: 'HTTPS',
              country: country || 'Unknown',
              anonymity
            });
          }
        }
      }
    });
  } catch (e) {}

  return proxies;
}

/**
 * Scrape from GitHub proxy lists - enhanced with more sources
 */
async function scrapeGitHubProxies() {
  const proxies = [];
  
  // Source 1: TheSpeedX HTTP proxy list (labeled correctly as HTTP, not HTTPS)
  try {
    const response = await axios.get('https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt', {
      timeout: 15000
    });
    
    const lines = response.data.split('\n').filter(line => line.trim());
    
    // Take first 100 proxies (these are generally better quality)
    lines.slice(0, 100).forEach(line => {
      const [ip, port] = line.trim().split(':');
      if (ip && port && isValidIP(ip) && isValidPort(port)) {
        proxies.push({
          ip, port,
          type: 'HTTP',
          country: 'Unknown',
          anonymity: 'unknown'
        });
      }
    });
  } catch (e) {}

  // Source 2: clarketm proxy list (HTTP proxies)
  try {
    const response = await axios.get('https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt', {
      timeout: 15000
    });
    
    const lines = response.data.split('\n').filter(line => line.trim());
    
    lines.slice(0, 50).forEach(line => {
      const [ip, port] = line.trim().split(':');
      if (ip && port && isValidIP(ip) && isValidPort(port)) {
        proxies.push({
          ip, port,
          type: 'HTTP',
          country: 'Unknown',
          anonymity: 'unknown'
        });
      }
    });
  } catch (e) {}

  // Source 3: monosans proxy list (high quality, frequently updated, HTTP proxies)
  try {
    const response = await axios.get('https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt', {
      timeout: 15000
    });
    
    const lines = response.data.split('\n').filter(line => line.trim());
    
    lines.slice(0, 80).forEach(line => {
      const [ip, port] = line.trim().split(':');
      if (ip && port && isValidIP(ip) && isValidPort(port)) {
        proxies.push({
          ip, port,
          type: 'HTTP',
          country: 'Unknown',
          anonymity: 'unknown'
        });
      }
    });
  } catch (e) {}

  // Source 4: hookzof/socks5_list (SOCKS5 proxies - higher anonymity)
  try {
    const response = await axios.get('https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt', {
      timeout: 15000
    });
    
    const lines = response.data.split('\n').filter(line => line.trim());
    
    lines.slice(0, 50).forEach(line => {
      const [ip, port] = line.trim().split(':');
      if (ip && port && isValidIP(ip) && isValidPort(port)) {
        proxies.push({
          ip, port,
          type: 'SOCKS5',
          country: 'Unknown',
          anonymity: 'elite' // SOCKS5 proxies are generally elite
        });
      }
    });
  } catch (e) {}

  return proxies;
}

/**
 * Scrape from ProxyScrape API - elite HTTPS proxies
 */
async function scrapeProxyScrapeAPI() {
  const proxies = [];
  
  try {
    const response = await axios.get('https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=yes&anonymity=elite', {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    const lines = response.data.split('\n').filter(line => line.trim());
    
    lines.forEach(line => {
      const [ip, port] = line.trim().split(':');
      if (ip && port && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip) && /^\d+$/.test(port)) {
        proxies.push({
          ip, port,
          type: 'HTTPS',
          country: 'Unknown',
          anonymity: 'elite' // API specifically returns elite proxies
        });
      }
    });
  } catch (e) {}

  // Also get anonymous proxies
  try {
    const response = await axios.get('https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=yes&anonymity=anonymous', {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    const lines = response.data.split('\n').filter(line => line.trim());
    
    lines.forEach(line => {
      const [ip, port] = line.trim().split(':');
      if (ip && port && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip) && /^\d+$/.test(port)) {
        proxies.push({
          ip, port,
          type: 'HTTPS',
          country: 'Unknown',
          anonymity: 'anonymous'
        });
      }
    });
  } catch (e) {}

  return proxies;
}

/**
 * Scrape from GeoNode free proxy API
 */
async function scrapeGeoNode() {
  const proxies = [];
  
  try {
    const response = await axios.get('https://proxylist.geonode.com/api/proxy-list?limit=100&page=1&sort_by=lastChecked&sort_type=desc&protocols=https&anonymityLevel=elite&anonymityLevel=anonymous', {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    if (response.data && response.data.data) {
      response.data.data.forEach(item => {
        if (item.ip && item.port) {
          let anonymity = 'unknown';
          if (item.anonymityLevel === 'elite') anonymity = 'elite';
          else if (item.anonymityLevel === 'anonymous') anonymity = 'anonymous';
          
          proxies.push({
            ip: item.ip,
            port: String(item.port),
            type: 'HTTPS',
            country: item.country || 'Unknown',
            anonymity
          });
        }
      });
    }
  } catch (e) {}

  return proxies;
}

/**
 * Scrape from proxy-list.download API (Elite HTTPS proxies)
 */
async function scrapeProxyListDownload() {
  const proxies = [];
  
  try {
    const response = await axios.get('https://www.proxy-list.download/api/v1/get?type=https&anon=elite', {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    const lines = response.data.split('\n').filter(line => line.trim());
    
    lines.slice(0, 100).forEach(line => {
      const [ip, port] = line.trim().split(':');
      if (ip && port && isValidIP(ip) && isValidPort(port)) {
        proxies.push({
          ip, port,
          type: 'HTTPS',
          country: 'Unknown',
          anonymity: 'elite'
        });
      }
    });
  } catch (e) {}

  return proxies;
}

/**
 * Scrape from ShiftyTR GitHub HTTPS proxy list
 */
async function scrapeShiftyTR() {
  const proxies = [];
  
  try {
    const response = await axios.get('https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/https.txt', {
      timeout: 15000
    });
    
    const lines = response.data.split('\n').filter(line => line.trim());
    
    lines.slice(0, 100).forEach(line => {
      const [ip, port] = line.trim().split(':');
      if (ip && port && isValidIP(ip) && isValidPort(port)) {
        proxies.push({
          ip, port,
          type: 'HTTPS',
          country: 'Unknown',
          anonymity: 'unknown'
        });
      }
    });
  } catch (e) {}

  return proxies;
}

/**
 * Scrape from jetkai GitHub HTTPS proxy list
 */
async function scrapeJetkai() {
  const proxies = [];
  
  try {
    const response = await axios.get('https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-https.txt', {
      timeout: 15000
    });
    
    const lines = response.data.split('\n').filter(line => line.trim());
    
    lines.slice(0, 100).forEach(line => {
      const [ip, port] = line.trim().split(':');
      if (ip && port && isValidIP(ip) && isValidPort(port)) {
        proxies.push({
          ip, port,
          type: 'HTTPS',
          country: 'Unknown',
          anonymity: 'unknown'
        });
      }
    });
  } catch (e) {}

  return proxies;
}

/**
 * Scrape from roosterkid GitHub HTTPS proxy list
 */
async function scrapeRoosterkid() {
  const proxies = [];
  
  try {
    const response = await axios.get('https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt', {
      timeout: 15000
    });
    
    const lines = response.data.split('\n').filter(line => line.trim());
    
    lines.slice(0, 100).forEach(line => {
      const [ip, port] = line.trim().split(':');
      if (ip && port && isValidIP(ip) && isValidPort(port)) {
        proxies.push({
          ip, port,
          type: 'HTTPS',
          country: 'Unknown',
          anonymity: 'unknown'
        });
      }
    });
  } catch (e) {}

  return proxies;
}

/**
 * Scrape from sunny9577 GitHub HTTP proxy list
 */
async function scrapeSunny9577() {
  const proxies = [];
  
  try {
    const response = await axios.get('https://raw.githubusercontent.com/sunny9577/proxy-scraper/master/generated/http_proxies.txt', {
      timeout: 15000
    });
    
    const lines = response.data.split('\n').filter(line => line.trim());
    
    lines.slice(0, 100).forEach(line => {
      const [ip, port] = line.trim().split(':');
      if (ip && port && isValidIP(ip) && isValidPort(port)) {
        proxies.push({
          ip, port,
          type: 'HTTP',
          country: 'Unknown',
          anonymity: 'unknown'
        });
      }
    });
  } catch (e) {}

  return proxies;
}

/**
 * Parse custom proxy list (user-provided)
 * Supported formats:
 *   - ip:port
 *   - http://ip:port
 *   - http://username:password@ip:port
 *   - username:password@ip:port
 */
function parseCustomProxies(proxyText) {
  const proxies = [];
  const lines = proxyText.split('\n').filter(line => line.trim());
  
  lines.forEach(line => {
    let trimmed = line.trim();
    
    // Try format: http://username:password@ip:port or http://ip:port
    const urlMatch = trimmed.match(/^(?:https?:\/\/)?(?:([^:@]+):([^@]+)@)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d+)$/);
    if (urlMatch) {
      const username = urlMatch[1] || null;
      const password = urlMatch[2] || null;
      const ip = urlMatch[3];
      const port = urlMatch[4];
      
      proxies.push({
        ip, port,
        type: 'HTTPS',
        country: 'Custom',
        anonymity: 'elite',
        username,
        password
      });
      return;
    }

    // Try format: username:password@ip:port (without http://)
    const authMatch = trimmed.match(/^([^:@]+):([^@]+)@(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d+)$/);
    if (authMatch) {
      proxies.push({
        ip: authMatch[3],
        port: authMatch[4],
        type: 'HTTPS',
        country: 'Custom',
        anonymity: 'elite',
        username: authMatch[1],
        password: authMatch[2]
      });
      return;
    }

    // Try simple format: ip:port
    const parts = trimmed.split(':');
    if (parts.length === 2) {
      const ip = parts[0].trim();
      const port = parts[1].trim();
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip) && /^\d+$/.test(port)) {
        proxies.push({
          ip, port,
          type: 'HTTPS',
          country: 'Custom',
          anonymity: 'elite',
          username: null,
          password: null
        });
      }
    }
  });
  
  return proxies;
}

module.exports = { scrapeProxies, parseCustomProxies };
