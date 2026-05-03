/**
 * Country Code to Name mapping for proxy filtering
 * Supports ISO 3166-1 alpha-2 codes and common country names
 */

const COUNTRY_CODE_MAP = {
  'af': 'afghanistan', 'al': 'albania', 'dz': 'algeria', 'ad': 'andorra', 'ao': 'angola',
  'ag': 'antigua and barbuda', 'ar': 'argentina', 'am': 'armenia', 'au': 'australia', 'at': 'austria',
  'az': 'azerbaijan', 'bs': 'bahamas', 'bh': 'bahrain', 'bd': 'bangladesh', 'bb': 'barbados',
  'by': 'belarus', 'be': 'belgium', 'bz': 'belize', 'bj': 'benin', 'bt': 'bhutan',
  'bo': 'bolivia', 'ba': 'bosnia and herzegovina', 'bw': 'botswana', 'br': 'brazil', 'bn': 'brunei',
  'bg': 'bulgaria', 'bf': 'burkina faso', 'bi': 'burundi', 'kh': 'cambodia', 'cm': 'cameroon',
  'ca': 'canada', 'cv': 'cape verde', 'cf': 'central african republic', 'td': 'chad', 'cl': 'chile',
  'cn': 'china', 'co': 'colombia', 'km': 'comoros', 'cg': 'congo', 'cd': 'democratic republic of the congo',
  'cr': 'costa rica', 'ci': 'ivory coast', 'hr': 'croatia', 'cu': 'cuba', 'cy': 'cyprus',
  'cz': 'czech republic', 'dk': 'denmark', 'dj': 'djibouti', 'dm': 'dominica', 'do': 'dominican republic',
  'ec': 'ecuador', 'eg': 'egypt', 'sv': 'el salvador', 'gq': 'equatorial guinea', 'er': 'eritrea',
  'ee': 'estonia', 'et': 'ethiopia', 'fj': 'fiji', 'fi': 'finland', 'fr': 'france',
  'ga': 'gabon', 'gm': 'gambia', 'ge': 'georgia', 'de': 'germany', 'gh': 'ghana',
  'gr': 'greece', 'gd': 'grenada', 'gt': 'guatemala', 'gn': 'guinea', 'gw': 'guinea-bissau',
  'gy': 'guyana', 'ht': 'haiti', 'hn': 'honduras', 'hk': 'hong kong', 'hu': 'hungary',
  'is': 'iceland', 'in': 'india', 'id': 'indonesia', 'ir': 'iran', 'iq': 'iraq',
  'ie': 'ireland', 'il': 'israel', 'it': 'italy', 'jm': 'jamaica', 'jp': 'japan',
  'jo': 'jordan', 'kz': 'kazakhstan', 'ke': 'kenya', 'ki': 'kiribati', 'kp': 'north korea',
  'kr': 'south korea', 'kw': 'kuwait', 'kg': 'kyrgyzstan', 'la': 'laos', 'lv': 'latvia',
  'lb': 'lebanon', 'ls': 'lesotho', 'lr': 'liberia', 'ly': 'libya', 'li': 'liechtenstein',
  'lt': 'lithuania', 'lu': 'luxembourg', 'mo': 'macao', 'mk': 'north macedonia', 'mg': 'madagascar',
  'mw': 'malawi', 'my': 'malaysia', 'mv': 'maldives', 'ml': 'mali', 'mt': 'malta',
  'mh': 'marshall islands', 'mr': 'mauritania', 'mu': 'mauritius', 'mx': 'mexico', 'fm': 'micronesia',
  'md': 'moldova', 'mc': 'monaco', 'mn': 'mongolia', 'me': 'montenegro', 'ma': 'morocco',
  'mz': 'mozambique', 'mm': 'myanmar', 'na': 'namibia', 'nr': 'nauru', 'np': 'nepal',
  'nl': 'netherlands', 'nz': 'new zealand', 'ni': 'nicaragua', 'ne': 'niger', 'ng': 'nigeria',
  'no': 'norway', 'om': 'oman', 'pk': 'pakistan', 'pw': 'palau', 'ps': 'palestine',
  'pa': 'panama', 'pg': 'papua new guinea', 'py': 'paraguay', 'pe': 'peru', 'ph': 'philippines',
  'pl': 'poland', 'pt': 'portugal', 'qa': 'qatar', 'ro': 'romania', 'ru': 'russia',
  'rw': 'rwanda', 'kn': 'saint kitts and nevis', 'lc': 'saint lucia', 'vc': 'saint vincent',
  'ws': 'samoa', 'sm': 'san marino', 'st': 'sao tome and principe', 'sa': 'saudi arabia',
  'sn': 'senegal', 'rs': 'serbia', 'sc': 'seychelles', 'sl': 'sierra leone', 'sg': 'singapore',
  'sk': 'slovakia', 'si': 'slovenia', 'sb': 'solomon islands', 'so': 'somalia', 'za': 'south africa',
  'es': 'spain', 'lk': 'sri lanka', 'sd': 'sudan', 'sr': 'suriname', 'sz': 'eswatini',
  'se': 'sweden', 'ch': 'switzerland', 'sy': 'syria', 'tw': 'taiwan', 'tj': 'tajikistan',
  'tz': 'tanzania', 'th': 'thailand', 'tl': 'timor-leste', 'tg': 'togo', 'to': 'tonga',
  'tt': 'trinidad and tobago', 'tn': 'tunisia', 'tr': 'turkey', 'tm': 'turkmenistan', 'tv': 'tuvalu',
  'ug': 'uganda', 'ua': 'ukraine', 'ae': 'united arab emirates', 'gb': 'united kingdom',
  'us': 'united states', 'uy': 'uruguay', 'uz': 'uzbekistan', 'vu': 'vanuatu', 've': 'venezuela',
  'vn': 'vietnam', 'ye': 'yemen', 'zm': 'zambia', 'zw': 'zimbabwe'
};

// Build reverse map: country name -> code
const COUNTRY_NAME_MAP = {};
for (const [code, name] of Object.entries(COUNTRY_CODE_MAP)) {
  COUNTRY_NAME_MAP[name] = code;
}

// Common aliases
const COUNTRY_ALIASES = {
  'usa': 'us', 'uk': 'gb', 'england': 'gb', 'britain': 'gb', 'great britain': 'gb',
  'korea': 'kr', 'republic of korea': 'kr', 'south korea': 'kr',
  'russian federation': 'ru', 'russia': 'ru', 'uae': 'ae',
  'czech': 'cz', 'czechia': 'cz', 'holland': 'nl',
  'ivory coast': 'ci', "cote d'ivoire": 'ci',
  'burma': 'mm', 'myanmar': 'mm',
  'taiwan, province of china': 'tw', 'republic of china': 'tw',
  'hong kong sar': 'hk', 'macau': 'mo', 'macao sar': 'mo',
  'palestine, state of': 'ps', 'west bank': 'ps',
  'democratic republic of the congo': 'cd', 'dr congo': 'cd', 'drc': 'cd',
  'republic of the congo': 'cg', 'congo-brazzaville': 'cg',
  'eswatini': 'sz', 'swaziland': 'sz',
  'north macedonia': 'mk', 'macedonia': 'mk',
  'timor-leste': 'tl', 'east timor': 'tl',
  'brunei darussalam': 'bn',
  'lao': 'la', "lao people's democratic republic": 'la',
  'viet nam': 'vn', 'vietnam': 'vn',
  'türkiye': 'tr', 'turkiye': 'tr',
  'cabo verde': 'cv',
  'the bahamas': 'bs', 'the gambia': 'gm'
};

/**
 * Resolve a user input to a country code
 * @param {string} input - Country code or name (e.g. "US", "United States", "usa")
 * @returns {string|null} - 2-letter country code or null
 */
function resolveCountryCode(input) {
  const lower = input.toLowerCase().trim();
  
  // Direct code match (2 letters)
  if (lower.length === 2 && COUNTRY_CODE_MAP[lower]) {
    return lower;
  }
  
  // Check aliases
  if (COUNTRY_ALIASES[lower]) {
    return COUNTRY_ALIASES[lower];
  }
  
  // Check full name match
  if (COUNTRY_NAME_MAP[lower]) {
    return COUNTRY_NAME_MAP[lower];
  }
  
  // Partial name match (e.g. "united" matches "united states")
  for (const [name, code] of Object.entries(COUNTRY_NAME_MAP)) {
    if (name.startsWith(lower) || lower.startsWith(name)) {
      return code;
    }
  }
  
  // Check aliases partial match
  for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) {
    if (alias.startsWith(lower) || lower.startsWith(alias)) {
      return code;
    }
  }
  
  return null;
}

/**
 * Resolve a proxy's country to a country code
 * @param {string} proxyCountry - Country name from proxy (e.g. "Russian Federation", "United States")
 * @returns {string|null} - 2-letter country code or null
 */
function resolveProxyCountryCode(proxyCountry) {
  if (!proxyCountry) return null;
  const lower = proxyCountry.toLowerCase().trim();
  
  // Direct code match
  if (lower.length === 2 && COUNTRY_CODE_MAP[lower]) {
    return lower;
  }
  
  // Check aliases first (handles "Russian Federation" -> "ru")
  if (COUNTRY_ALIASES[lower]) {
    return COUNTRY_ALIASES[lower];
  }
  
  // Check full name
  if (COUNTRY_NAME_MAP[lower]) {
    return COUNTRY_NAME_MAP[lower];
  }
  
  // Partial match against known names
  for (const [name, code] of Object.entries(COUNTRY_NAME_MAP)) {
    if (lower.includes(name) || name.includes(lower)) {
      return code;
    }
  }
  
  // Partial match against aliases
  for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) {
    if (lower.includes(alias) || alias.includes(lower)) {
      return code;
    }
  }
  
  return null;
}

/**
 * Filter proxies by country whitelist
 * @param {Array} proxies - Array of proxy objects with .country field
 * @param {Array<string>} whitelist - Array of country codes or names (e.g. ["US", "GB", "Germany"])
 * @returns {Array} - Filtered proxies matching the whitelist
 */
function filterProxiesByCountry(proxies, whitelist) {
  if (!whitelist || whitelist.length === 0) {
    return proxies;
  }
  
  // Resolve all whitelist entries to country codes
  const allowedCodes = new Set();
  for (const entry of whitelist) {
    const code = resolveCountryCode(entry);
    if (code) {
      allowedCodes.add(code);
    }
  }
  
  if (allowedCodes.size === 0) {
    // Could not resolve any country codes - return all proxies
    return proxies;
  }
  
  return proxies.filter(p => {
    const proxyCode = resolveProxyCountryCode(p.country);
    return proxyCode && allowedCodes.has(proxyCode);
  });
}

module.exports = {
  filterProxiesByCountry,
  resolveCountryCode,
  resolveProxyCountryCode,
  COUNTRY_CODE_MAP,
  COUNTRY_ALIASES
};
