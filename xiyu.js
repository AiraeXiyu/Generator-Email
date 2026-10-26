/**
 * ge.js
 * Scrape By Emissary Xiyu
 * Generator.email scraper/provider
 *
 * Node.js >= 18
 *
 * Temuan yang dipakai:
 * - Homepage bootstrap + meta api-token
 * - GET /api/domains.php
 * - POST /dom_to_punycode.php
 * - POST /mark_remove.php
 * - POST /uptime.php
 * - GET /{domain}/{user} -> inbox context
 * - GET /inbox7/
 * - inbox_ctx cookie
 * - cur_user / cur_domain / cur_msg_id / num_mess
 * - data-mid message container
 * - WebSocket endpoint metadata
 *
 * Tidak mencoba melewati CAPTCHA / challenge.
 */

const GE_BASE = 'https://generator.email';

const DEFAULT_TIMEOUT = 15_000;

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/130.0.0.0 Safari/537.36',

  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,' +
    'image/avif,image/webp,image/apng,*/*;q=0.8',

  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache'
};


// ============================================================
// ENDPOINT MAP
// ============================================================

const ENDPOINTS = Object.freeze({
  homepage: '/',
  inbox: '/inbox7/',
  domains: '/api/domains.php',
  punycode: '/dom_to_punycode.php',
  markRemove: '/mark_remove.php',
  uptime: '/uptime.php',
  search: '/search.php',
  websocket: '/notificon/ws'
});


// ============================================================
// BASIC HELPERS
// ============================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomString(length = 10) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';

  let out = '';

  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }

  return out;
}

function randomUsername(length = 10) {
  let value = randomString(length);

  // Lebih aman username diawali huruf.
  if (!/^[a-z]/i.test(value)) {
    value = 'a' + value.slice(1);
  }

  return value.toLowerCase();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeHtml(value = '') {
  return String(value)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#47;/gi, '/')
    .replace(/&#x3A;/gi, ':')
    .replace(/&#58;/gi, ':')
    .replace(/&#x3D;/gi, '=')
    .replace(/&#61;/gi, '=')
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCodePoint(Number(n));
      } catch {
        return _;
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      try {
        return String.fromCodePoint(parseInt(n, 16));
      } catch {
        return _;
      }
    });
}

function stripTags(html = '') {
  return decodeHtml(
    String(html)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p\s*>/gi, '\n')
      .replace(/<\/div\s*>/gi, '\n')
      .replace(/<\/li\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  );
}

function cleanText(value = '') {
  return String(value)
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function htmlToText(html = '') {
  return cleanText(stripTags(html));
}

function getAttribute(tag, name) {
  if (!tag) return null;

  const escaped = escapeRegex(name);

  const patterns = [
    new RegExp(`${escaped}\\s*=\\s*"([^"]*)"`, 'i'),
    new RegExp(`${escaped}\\s*=\\s*'([^']*)'`, 'i'),
    new RegExp(`${escaped}\\s*=\\s*([^\\s>]+)`, 'i')
  ];

  for (const pattern of patterns) {
    const match = String(tag).match(pattern);

    if (match) {
      return decodeHtml(match[1]);
    }
  }

  return null;
}

function findElementById(html, id) {
  const escaped = escapeRegex(id);

  const regex = new RegExp(
    `<([a-z0-9:-]+)\\b[^>]*\\bid\\s*=\\s*["']${escaped}["'][^>]*>`,
    'i'
  );

  const match = String(html).match(regex);

  return match ? match[0] : null;
}

function extractInputValue(html, id) {
  const tag = findElementById(html, id);

  if (!tag) return null;

  return getAttribute(tag, 'value');
}

function extractMeta(html, name) {
  const tags = String(html).match(/<meta\b[^>]*>/gi) || [];

  for (const tag of tags) {
    const metaName = getAttribute(tag, 'name');

    if (
      metaName &&
      metaName.toLowerCase() === String(name).toLowerCase()
    ) {
      return getAttribute(tag, 'content');
    }
  }

  return null;
}

function normalizeDomain(domain) {
  return String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');
}

function normalizeUser(user) {
  return String(user || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._+-]/g, '');
}

function splitEmail(email) {
  const value = String(email || '').trim().toLowerCase();

  const at = value.lastIndexOf('@');

  if (at <= 0 || at >= value.length - 1) {
    throw new Error('Email tidak valid');
  }

  return {
    user: normalizeUser(value.slice(0, at)),
    domain: normalizeDomain(value.slice(at + 1))
  };
}

function buildEmail(user, domain) {
  return `${normalizeUser(user)}@${normalizeDomain(domain)}`;
}

function buildMailboxURL(user, domain) {
  return `${GE_BASE}/${encodeURIComponent(
    normalizeDomain(domain)
  )}/${encodeURIComponent(normalizeUser(user))}`;
}

function buildInboxCookie(user, domain) {
  return `inbox_ctx=${encodeURIComponent(
    `${normalizeDomain(domain)}/${normalizeUser(user)}`
  )}`;
}


// ============================================================
// COOKIE JAR
// ============================================================

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  set(name, value) {
    if (!name) return;

    this.cookies.set(name, value);
  }

  get(name) {
    return this.cookies.get(name);
  }

  parseSetCookie(header) {
    if (!header) return;

    const chunks = splitSetCookieHeader(header);

    for (const chunk of chunks) {
      const first = chunk.split(';')[0];

      const eq = first.indexOf('=');

      if (eq <= 0) continue;

      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();

      if (name) {
        this.cookies.set(name, value);
      }
    }
  }

  header() {
    return [...this.cookies.entries()]
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }

  toJSON() {
    return Object.fromEntries(this.cookies.entries());
  }
}

function splitSetCookieHeader(header) {
  // fetch pada beberapa runtime menggabungkan Set-Cookie.
  // Jangan split koma yang berada dalam Expires=...
  return String(header)
    .split(/,(?=\s*[A-Za-z0-9_.-]+=)/g)
    .map(v => v.trim())
    .filter(Boolean);
}


// ============================================================
// HTTP
// ============================================================

async function request(
  path,
  {
    method = 'GET',
    headers = {},
    body,
    timeout = DEFAULT_TIMEOUT,
    redirect = 'follow',
    jar
  } = {}
) {
  const url = path.startsWith('http')
    ? path
    : `${GE_BASE}${path.startsWith('/') ? path : '/' + path}`;

  const requestHeaders = {
    ...DEFAULT_HEADERS,
    ...headers
  };

  if (jar) {
    const cookie = jar.header();

    if (cookie) {
      requestHeaders.Cookie = cookie;
    }
  }

  const controller = new AbortController();

  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body,
      redirect,
      signal: controller.signal
    });

    if (jar) {
      let cookies = null;

      // Node/undici baru.
      if (
        response.headers &&
        typeof response.headers.getSetCookie === 'function'
      ) {
        const setCookies = response.headers.getSetCookie();

        for (const item of setCookies) {
          jar.parseSetCookie(item);
        }
      } else {
        cookies = response.headers.get('set-cookie');

        if (cookies) {
          jar.parseSetCookie(cookies);
        }
      }
    }

    const text = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      headers: response.headers,
      text
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Request timeout: ${url}`);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function postForm(path, data, options = {}) {
  const body = new URLSearchParams();

  for (const [key, value] of Object.entries(data || {})) {
    if (value !== undefined && value !== null) {
      body.set(key, String(value));
    }
  }

  return request(path, {
    ...options,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      ...(options.headers || {})
    },
    body: body.toString()
  });
}


// ============================================================
// HOMEPAGE / BOOTSTRAP
// ============================================================

function parseBootstrap(html) {
  const apiToken = extractMeta(html, 'api-token');

  const user =
    extractInputValue(html, 'userName') ||
    extractJSString(html, 'cur_user');

  const domain =
    extractInputValue(html, 'domainName2') ||
    extractJSString(html, 'cur_domain');

  const domainAscii =
    extractJSString(html, 'cur_domain_ascii') ||
    domain;

  const state = parseInboxState(html);

  return {
    apiToken,
    user: user || null,
    domain: domain || null,
    domainAscii: domainAscii || null,
    state
  };
}

async function bootstrap(options = {}) {
  const jar = options.jar || new CookieJar();

  const response = await request('/', {
    jar,
    timeout: options.timeout
  });

  if (!response.ok) {
    throw new Error(
      `Generator.email homepage HTTP ${response.status}`
    );
  }

  const parsed = parseBootstrap(response.text);

  return {
    status: response.status,
    url: response.url,
    html: response.text,
    jar,
    ...parsed
  };
}


// ============================================================
// DOMAIN API
// ============================================================

function parseDomainsPayload(text) {
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }

  let candidates = [];

  if (Array.isArray(data)) {
    candidates = data;
  } else if (Array.isArray(data?.domains)) {
    candidates = data.domains;
  } else if (Array.isArray(data?.data)) {
    candidates = data.data;
  } else if (Array.isArray(data?.result)) {
    candidates = data.result;
  }

  const domains = [];

  for (const item of candidates) {
    let value = null;

    if (typeof item === 'string') {
      value = item;
    } else if (item && typeof item === 'object') {
      value =
        item.domain ||
        item.name ||
        item.value ||
        item.host ||
        null;
    }

    value = normalizeDomain(value);

    if (
      value &&
      /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value) &&
      !domains.includes(value)
    ) {
      domains.push(value);
    }
  }

  return domains;
}

async function getDomains(options = {}) {
  const session =
    options.session ||
    await bootstrap({
      timeout: options.timeout
    });

  if (!session.apiToken) {
    throw new Error(
      'api-token tidak ditemukan dari homepage'
    );
  }

  const response = await request(ENDPOINTS.domains, {
    jar: session.jar,
    timeout: options.timeout,
    headers: {
      Accept: 'application/json, text/plain, */*',
      'X-API-Token': session.apiToken,
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${GE_BASE}/`
    }
  });

  if (!response.ok) {
    throw new Error(
      `Domains API HTTP ${response.status}`
    );
  }

  return {
    domains: parseDomainsPayload(response.text),
    raw: response.text,
    apiToken: session.apiToken,
    jar: session.jar
  };
}


// ============================================================
// ADDRESS HELPERS / DISCOVERED ENDPOINTS
// ============================================================

async function domainToPunycode(domain, options = {}) {
  const response = await postForm(
    ENDPOINTS.punycode,
    {
      dmn: normalizeDomain(domain)
    },
    {
      jar: options.jar,
      timeout: options.timeout,
      headers: {
        Referer: `${GE_BASE}/`
      }
    }
  );

  return {
    status: response.status,
    ok: response.ok,
    text: response.text
  };
}

async function markMailbox(email, options = {}) {
  const { user, domain } = splitEmail(email);

  const response = await postForm(
    ENDPOINTS.markRemove,
    {
      chekinbox: `${user}@${domain}`
    },
    {
      jar: options.jar,
      timeout: options.timeout,
      headers: {
        Referer: `${GE_BASE}/`
      }
    }
  );

  return {
    status: response.status,
    ok: response.ok,
    text: response.text
  };
}

async function checkUptime(user, domain, options = {}) {
  const response = await postForm(
    ENDPOINTS.uptime,
    {
      dmn: normalizeDomain(domain),
      usr: normalizeUser(user)
    },
    {
      jar: options.jar,
      timeout: options.timeout,
      headers: {
        Referer: `${GE_BASE}/`
      }
    }
  );

  return {
    status: response.status,
    ok: response.ok,
    text: response.text
  };
}


// ============================================================
// MAILBOX GENERATION
// ============================================================

function parseGeneratedMailbox(html) {
  const user =
    extractInputValue(html, 'userName') ||
    extractJSString(html, 'cur_user');

  const domain =
    extractInputValue(html, 'domainName2') ||
    extractJSString(html, 'cur_domain');

  if (!user || !domain) {
    return null;
  }

  return {
    user: normalizeUser(user),
    domain: normalizeDomain(domain),
    email: buildEmail(user, domain)
  };
}

/**
 * Generator.email sendiri menghasilkan mailbox ketika halaman
 * inbox/homepage dimuat.
 */
async function generateMailbox(options = {}) {
  const jar = options.jar || new CookieJar();

  const response = await request('/', {
    jar,
    timeout: options.timeout,
    headers: {
      Referer: `${GE_BASE}/`
    }
  });

  if (!response.ok) {
    throw new Error(
      `Generate mailbox HTTP ${response.status}`
    );
  }

  const mailbox = parseGeneratedMailbox(response.text);

  if (!mailbox) {
    throw new Error(
      'Mailbox Generator.email tidak ditemukan di HTML'
    );
  }

  return {
    ...mailbox,
    mailboxUrl: buildMailboxURL(
      mailbox.user,
      mailbox.domain
    ),
    apiToken: extractMeta(response.text, 'api-token'),
    jar,
    html: options.includeHtml ? response.text : undefined
  };
}


// ============================================================
// OPEN EXISTING MAILBOX
// ============================================================

async function openMailbox(user, domain, options = {}) {
  user = normalizeUser(user);
  domain = normalizeDomain(domain);

  if (!user || !domain) {
    throw new Error('User/domain mailbox tidak valid');
  }

  const jar = options.jar || new CookieJar();

  // Generator.email memakai inbox_ctx.
  jar.set(
    'inbox_ctx',
    encodeURIComponent(`${domain}/${user}`)
  );

  const mailboxPath =
    `/${encodeURIComponent(domain)}/${encodeURIComponent(user)}`;

  const response = await request(mailboxPath, {
    jar,
    timeout: options.timeout,
    redirect: 'follow',
    headers: {
      Referer: `${GE_BASE}/`
    }
  });

  return {
    ok: response.ok,
    status: response.status,
    url: response.url,
    user,
    domain,
    email: `${user}@${domain}`,
    mailboxUrl: buildMailboxURL(user, domain),
    jar,
    html: options.includeHtml ? response.text : undefined
  };
}


// ============================================================
// INBOX STATE
// ============================================================

function extractJSString(html, key) {
  const escaped = escapeRegex(key);

  const patterns = [
    new RegExp(
      `${escaped}\\s*:\\s*"([^"]*)"`,
      'i'
    ),

    new RegExp(
      `${escaped}\\s*:\\s*'([^']*)'`,
      'i'
    ),

    new RegExp(
      `["']${escaped}["']\\s*:\\s*"([^"]*)"`,
      'i'
    ),

    new RegExp(
      `["']${escaped}["']\\s*:\\s*'([^']*)'`,
      'i'
    )
  ];

  for (const pattern of patterns) {
    const match = String(html).match(pattern);

    if (match) {
      return decodeHtml(match[1]);
    }
  }

  return null;
}

function extractJSNumber(html, key) {
  const escaped = escapeRegex(key);

  const patterns = [
    new RegExp(
      `${escaped}\\s*:\\s*(\\d+)`,
      'i'
    ),

    new RegExp(
      `["']${escaped}["']\\s*:\\s*(\\d+)`,
      'i'
    )
  ];

  for (const pattern of patterns) {
    const match = String(html).match(pattern);

    if (match) {
      return Number(match[1]);
    }
  }

  return null;
}

function parseInboxState(html) {
  return {
    user: extractJSString(html, 'cur_user'),
    domain: extractJSString(html, 'cur_domain'),
    domainAscii:
      extractJSString(html, 'cur_domain_ascii'),

    messageId:
      extractJSString(html, 'cur_msg_id') ||
      null,

    messageIdRaw:
      extractJSString(html, 'mess_id_raw') ||
      null,

    messageCount:
      extractJSNumber(html, 'num_mess') ?? 0
  };
}


// ============================================================
// MESSAGE CONTAINERS
// ============================================================

function findMessageIds(html) {
  const ids = [];

  const regex =
    /data-mid\s*=\s*["']([^"']+)["']/gi;

  let match;

  while ((match = regex.exec(String(html)))) {
    const id = decodeHtml(match[1]).trim();

    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
}

function extractBalancedDiv(html, startIndex) {
  const source = String(html);

  const tokenRegex = /<\/?div\b[^>]*>/gi;

  tokenRegex.lastIndex = startIndex;

  let depth = 0;
  let started = false;
  let match;

  while ((match = tokenRegex.exec(source))) {
    const tag = match[0];

    if (!started) {
      if (!/^<div\b/i.test(tag)) {
        continue;
      }

      started = true;
      depth = 1;
      continue;
    }

    if (/^<div\b/i.test(tag)) {
      depth++;
    } else {
      depth--;
    }

    if (depth === 0) {
      return source.slice(
        startIndex,
        tokenRegex.lastIndex
      );
    }
  }

  return source.slice(startIndex);
}

function findMessageContainer(html, messageId) {
  if (!messageId) return null;

  const escaped = escapeRegex(messageId);

  const regex = new RegExp(
    `<div\\b[^>]*data-mid\\s*=\\s*["']${escaped}["'][^>]*>`,
    'i'
  );

  const match = regex.exec(String(html));

  if (!match) return null;

  return extractBalancedDiv(html, match.index);
}


// ============================================================
// MESSAGE PARSER
// ============================================================

function extractHeaderByLabel(html, label) {
  const text = String(html);

  const escaped = escapeRegex(label);

  const patterns = [
    new RegExp(
      `${escaped}\\s*:\\s*<[^>]*>([\\s\\S]*?)<\\/[^>]+>`,
      'i'
    ),

    new RegExp(
      `${escaped}\\s*:\\s*([^<\\r\\n]+)`,
      'i'
    )
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match) {
      const value = cleanText(htmlToText(match[1]));

      if (value) return value;
    }
  }

  return null;
}

function extractEmailAfterLabel(text, label) {
  const escaped = escapeRegex(label);

  const regex = new RegExp(
    `${escaped}\\s*:?\\s*([^\\n<]{0,200})`,
    'i'
  );

  const match = String(text).match(regex);

  if (!match) return null;

  const email = match[1].match(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
  );

  return email ? email[0] : cleanText(match[1]);
}

function extractClassBlock(html, classNames) {
  for (const className of classNames) {
    const escaped = escapeRegex(className);

    const regex = new RegExp(
      `<([a-z0-9]+)\\b[^>]*class\\s*=\\s*["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
      'i'
    );

    const match = String(html).match(regex);

    if (match) {
      return match[2];
    }
  }

  return null;
}

function extractLinks(html) {
  const links = [];

  const hrefRegex =
    /href\s*=\s*["']([^"']+)["']/gi;

  let match;

  while ((match = hrefRegex.exec(String(html)))) {
    let url = decodeHtml(match[1]).trim();

    if (!url) continue;

    if (
      url.startsWith('#') ||
      /^javascript:/i.test(url) ||
      /^mailto:/i.test(url) ||
      /^tel:/i.test(url)
    ) {
      continue;
    }

    if (url.startsWith('//')) {
      url = 'https:' + url;
    }

    if (/^https?:\/\//i.test(url)) {
      if (!links.includes(url)) {
        links.push(url);
      }
    }
  }

  // Plain-text URLs.
  const textUrls =
    String(html).match(/https?:\/\/[^\s"'<>]+/gi) || [];

  for (let url of textUrls) {
    url = decodeHtml(url)
      .replace(/[),.;]+$/, '')
      .trim();

    if (url && !links.includes(url)) {
      links.push(url);
    }
  }

  return links;
}

function extractMessageBody(container) {
  if (!container) return null;

  const bodyHtml = extractClassBlock(
    container,
    [
      'mailbody',
      'mail-body',
      'message-body',
      'mailtext'
    ]
  );

  if (bodyHtml) {
    const value = htmlToText(bodyHtml);

    return value || null;
  }

  /*
   * Penting:
   * jangan fallback ke seluruh /inbox7/ HTML.
   * Itu bug yang dulu menyebabkan seluruh halaman
   * Generator.email dianggap sebagai isi email.
   */

  return null;
}

function parseMessage(html, state = parseInboxState(html)) {
  if (!state.messageCount || state.messageCount <= 0) {
    return {
      id: null,
      from: null,
      to: null,
      subject: null,
      body: null,
      links: []
    };
  }

  const ids = findMessageIds(html);

  const messageId =
    state.messageId ||
    state.messageIdRaw ||
    ids[0] ||
    null;

  if (!messageId) {
    return {
      id: null,
      from: null,
      to: null,
      subject: null,
      body: null,
      links: []
    };
  }

  const container =
    findMessageContainer(html, messageId);

  if (!container) {
    return {
      id: messageId,
      from: null,
      to: null,
      subject: null,
      body: null,
      links: []
    };
  }

  const visibleText = htmlToText(container);

  let from =
    extractHeaderByLabel(container, 'From') ||
    extractEmailAfterLabel(visibleText, 'From');

  let to =
    extractHeaderByLabel(container, 'To') ||
    extractEmailAfterLabel(visibleText, 'To');

  let subject =
    extractHeaderByLabel(container, 'Subject');

  if (!subject) {
    const subjectMatch = visibleText.match(
      /Subject\s*:?\s*([^\n]+)/i
    );

    if (subjectMatch) {
      subject = cleanText(subjectMatch[1]);
    }
  }

  return {
    id: messageId,
    from: from || null,
    to: to || null,
    subject: subject || null,
    body: extractMessageBody(container),
    links: extractLinks(container)
  };
}


// ============================================================
// FETCH INBOX
// ============================================================

async function fetchInbox(user, domain, options = {}) {
  user = normalizeUser(user);
  domain = normalizeDomain(domain);

  if (!user || !domain) {
    throw new Error('Mailbox tidak valid');
  }

  const jar = options.jar || new CookieJar();

  jar.set(
    'inbox_ctx',
    encodeURIComponent(`${domain}/${user}`)
  );

  const response = await request(ENDPOINTS.inbox, {
    jar,
    timeout: options.timeout,
    headers: {
      Referer: buildMailboxURL(user, domain)
    }
  });

  if (!response.ok) {
    throw new Error(
      `Inbox HTTP ${response.status}`
    );
  }

  const state = parseInboxState(response.text);

  const ids = findMessageIds(response.text);

  const message = parseMessage(
    response.text,
    state
  );

  return {
    status: response.status,

    mailbox: {
      user,
      domain,
      email: `${user}@${domain}`,
      url: buildMailboxURL(user, domain)
    },

    inbox: {
      messageCount: state.messageCount,
      messageId:
        state.messageId ||
        state.messageIdRaw ||
        ids[0] ||
        null,

      messageIds: ids
    },

    message,

    state,

    jar,

    html:
      options.includeHtml
        ? response.text
        : undefined
  };
}

async function checkEmail(email, options = {}) {
  const { user, domain } = splitEmail(email);

  return fetchInbox(user, domain, options);
}


// ============================================================
// POLLING
// ============================================================

async function waitForMessage(
  email,
  {
    timeout = 60_000,
    interval = 3_000,
    requestTimeout = DEFAULT_TIMEOUT,
    predicate
  } = {}
) {
  const { user, domain } = splitEmail(email);

  const jar = new CookieJar();

  const startedAt = Date.now();

  let lastResult = null;

  while (Date.now() - startedAt < timeout) {
    try {
      const result = await fetchInbox(
        user,
        domain,
        {
          jar,
          timeout: requestTimeout
        }
      );

      lastResult = result;

      if (result.inbox.messageCount > 0) {
        if (typeof predicate === 'function') {
          if (await predicate(result.message, result)) {
            return result;
          }
        } else {
          return result;
        }
      }
    } catch {
      // transient error -> retry sampai timeout
    }

    await sleep(interval);
  }

  return lastResult;
}


// ============================================================
// SEARCH ENDPOINT
// ============================================================

async function search(key, options = {}) {
  const session =
    options.session ||
    await bootstrap({
      timeout: options.timeout
    });

  if (!session.apiToken) {
    throw new Error(
      'api-token tidak ditemukan'
    );
  }

  const path =
    `${ENDPOINTS.search}?key=${encodeURIComponent(key)}`;

  const response = await request(path, {
    jar: session.jar,
    timeout: options.timeout,
    headers: {
      Accept: 'application/json, text/plain, */*',
      'X-API-Token': session.apiToken,
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${GE_BASE}/`
    }
  });

  return {
    ok: response.ok,
    status: response.status,
    text: response.text,
    jar: session.jar
  };
}


// ============================================================
// WEBSOCKET INFO
// ============================================================

function getWebSocketURL(email) {
  return (
    'wss://generator.email' +
    ENDPOINTS.websocket +
    '?email=' +
    encodeURIComponent(email)
  );
}


// ============================================================
// DIAGNOSTICS
// ============================================================

function inspectHTML(html) {
  const state = parseInboxState(html);

  const messageIds = findMessageIds(html);

  return {
    length: String(html).length,

    apiTokenFound:
      Boolean(extractMeta(html, 'api-token')),

    state,

    messageIds,

    messageCount:
      state.messageCount,

    currentMessageId:
      state.messageId ||
      state.messageIdRaw ||
      messageIds[0] ||
      null,

    hasMailSource:
      /\bclass\s*=\s*["'][^"']*\bmailsrc\b/i.test(
        String(html)
      ),

    hasDataMid:
      /\bdata-mid\s*=/i.test(String(html)),

    endpoints: {
      domains:
        String(html).includes('/api/domains.php'),

      uptime:
        String(html).includes('/uptime.php'),

      markRemove:
        String(html).includes('/mark_remove.php'),

      punycode:
        String(html).includes('/dom_to_punycode.php'),

      search:
        String(html).includes('/search.php'),

      websocket:
        String(html).includes('/notificon/ws')
    }
  };
}


// ============================================================
// HIGH-LEVEL PROVIDER
// ============================================================

class GeneratorEmail {
  constructor(options = {}) {
    this.timeout =
      options.timeout || DEFAULT_TIMEOUT;

    this.jar =
      options.jar || new CookieJar();

    this.apiToken = null;
  }

  async bootstrap() {
    const result = await bootstrap({
      jar: this.jar,
      timeout: this.timeout
    });

    this.apiToken = result.apiToken;

    return result;
  }

  async domains() {
    let session;

    if (this.apiToken) {
      session = {
        apiToken: this.apiToken,
        jar: this.jar
      };
    } else {
      session = await this.bootstrap();
    }

    const result = await getDomains({
      session,
      timeout: this.timeout
    });

    return result.domains;
  }

  async generate() {
    const result = await generateMailbox({
      jar: this.jar,
      timeout: this.timeout
    });

    if (result.apiToken) {
      this.apiToken = result.apiToken;
    }

    return result;
  }

  async open(email) {
    const { user, domain } = splitEmail(email);

    return openMailbox(
      user,
      domain,
      {
        jar: this.jar,
        timeout: this.timeout
      }
    );
  }

  async inbox(email, options = {}) {
    const { user, domain } = splitEmail(email);

    return fetchInbox(
      user,
      domain,
      {
        jar: this.jar,
        timeout:
          options.timeout || this.timeout,

        includeHtml:
          Boolean(options.includeHtml)
      }
    );
  }

  async wait(email, options = {}) {
    const { user, domain } = splitEmail(email);

    const startedAt = Date.now();

    const timeout =
      options.timeout ?? 60_000;

    const interval =
      options.interval ?? 3_000;

    let lastResult = null;

    while (Date.now() - startedAt < timeout) {
      try {
        const result = await fetchInbox(
          user,
          domain,
          {
            jar: this.jar,
            timeout:
              options.requestTimeout ||
              this.timeout
          }
        );

        lastResult = result;

        if (result.inbox.messageCount > 0) {
          if (
            typeof options.predicate ===
            'function'
          ) {
            const accepted =
              await options.predicate(
                result.message,
                result
              );

            if (accepted) return result;
          } else {
            return result;
          }
        }
      } catch {
        // retry
      }

      await sleep(interval);
    }

    return lastResult;
  }

  async uptime(email) {
    const { user, domain } = splitEmail(email);

    return checkUptime(
      user,
      domain,
      {
        jar: this.jar,
        timeout: this.timeout
      }
    );
  }

  websocketURL(email) {
    return getWebSocketURL(email);
  }
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  GeneratorEmail,
  CookieJar,

  GE_BASE,
  ENDPOINTS,

  bootstrap,
  getDomains,
  generateMailbox,
  openMailbox,
  fetchInbox,
  checkEmail,
  waitForMessage,

  domainToPunycode,
  markMailbox,
  checkUptime,
  search,

  parseBootstrap,
  parseGeneratedMailbox,
  parseInboxState,
  parseMessage,
  findMessageIds,
  findMessageContainer,
  extractLinks,
  inspectHTML,

  splitEmail,
  buildEmail,
  buildMailboxURL,
  buildInboxCookie,
  getWebSocketURL,

  htmlToText,
  cleanText,
  decodeHtml,

  randomUsername,
  sleep
};
