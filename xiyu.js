const GE_BASE = 'https://generator.email';
const DEFAULT_TIMEOUT = 15000;

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

const ENDPOINTS = Object.freeze({
  homepage: '/',
  inbox: '/inbox7/',
  domains: '/api/domains.php',
  punycode: '/dom_to_punycode.php',
  uptime: '/uptime.php'
});

/* ============================================================
   BASIC
============================================================ */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

function cleanText(value = '') {
  return String(value)
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function htmlToText(html = '') {
  return cleanText(
    decodeHtml(
      String(html)
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p\s*>/gi, '\n')
        .replace(/<\/div\s*>/gi, '\n')
        .replace(/<\/tr\s*>/gi, '\n')
        .replace(/<\/li\s*>/gi, '\n')
        .replace(/<\/h[1-6]\s*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
    )
  );
}

function getAttribute(tag, name) {
  if (!tag) return null;

  const key = escapeRegex(name);

  const patterns = [
    new RegExp(`${key}\\s*=\\s*"([^"]*)"`, 'i'),
    new RegExp(`${key}\\s*=\\s*'([^']*)'`, 'i'),
    new RegExp(`${key}\\s*=\\s*([^\\s>]+)`, 'i')
  ];

  for (const pattern of patterns) {
    const match = String(tag).match(pattern);
    if (match) return decodeHtml(match[1]);
  }

  return null;
}

function findElementById(html, id) {
  const key = escapeRegex(id);

  const regex = new RegExp(
    `<([a-z0-9:-]+)\\b[^>]*\\bid\\s*=\\s*["']${key}["'][^>]*>`,
    'i'
  );

  return String(html).match(regex)?.[0] || null;
}

function extractInputValue(html, id) {
  return getAttribute(findElementById(html, id), 'value');
}

function extractMeta(html, name) {
  const tags = String(html).match(/<meta\b[^>]*>/gi) || [];

  for (const tag of tags) {
    const currentName = getAttribute(tag, 'name');

    if (
      currentName &&
      currentName.toLowerCase() === String(name).toLowerCase()
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

  const user = normalizeUser(value.slice(0, at));
  const domain = normalizeDomain(value.slice(at + 1));

  if (!user || !domain) {
    throw new Error('Email tidak valid');
  }

  return {
    user,
    domain,
    email: `${user}@${domain}`
  };
}

function buildMailboxURL(user, domain) {
  return (
    `${GE_BASE}/` +
    `${encodeURIComponent(normalizeDomain(domain))}/` +
    `${encodeURIComponent(normalizeUser(user))}`
  );
}

/* ============================================================
   COOKIE
============================================================ */

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  set(name, value) {
    if (!name) return;
    this.cookies.set(name, value);
  }

  parseSetCookie(header) {
    if (!header) return;

    const chunks = String(header)
      .split(/,(?=\s*[A-Za-z0-9_.-]+=)/g)
      .map(v => v.trim())
      .filter(Boolean);

    for (const chunk of chunks) {
      const first = chunk.split(';')[0];
      const eq = first.indexOf('=');

      if (eq <= 0) continue;

      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();

      if (name) this.cookies.set(name, value);
    }
  }

  header() {
    return [...this.cookies.entries()]
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }
}

/* ============================================================
   REQUEST
============================================================ */

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
  const url = /^https?:\/\//i.test(path)
    ? path
    : `${GE_BASE}${path.startsWith('/') ? path : '/' + path}`;

  const requestHeaders = {
    ...DEFAULT_HEADERS,
    ...headers
  };

  if (jar) {
    const cookie = jar.header();
    if (cookie) requestHeaders.Cookie = cookie;
  }

  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body,
      redirect,
      signal: controller.signal,
      cache: 'no-store'
    });

    if (jar) {
      if (typeof response.headers.getSetCookie === 'function') {
        for (const cookie of response.headers.getSetCookie()) {
          jar.parseSetCookie(cookie);
        }
      } else {
        const cookie = response.headers.get('set-cookie');
        if (cookie) jar.parseSetCookie(cookie);
      }
    }

    const text = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      text
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Generator.email request timeout');
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/* ============================================================
   GENERATOR STATE
============================================================ */

function extractJSString(html, key) {
  const k = escapeRegex(key);

  const patterns = [
    new RegExp(`${k}\\s*:\\s*"([^"]*)"`, 'i'),
    new RegExp(`${k}\\s*:\\s*'([^']*)'`, 'i'),
    new RegExp(`["']${k}["']\\s*:\\s*"([^"]*)"`, 'i'),
    new RegExp(`["']${k}["']\\s*:\\s*'([^']*)'`, 'i')
  ];

  for (const pattern of patterns) {
    const match = String(html).match(pattern);

    if (match) return decodeHtml(match[1]);
  }

  return null;
}

function extractJSNumber(html, key) {
  const k = escapeRegex(key);

  const patterns = [
    new RegExp(`${k}\\s*:\\s*(\\d+)`, 'i'),
    new RegExp(`["']${k}["']\\s*:\\s*(\\d+)`, 'i')
  ];

  for (const pattern of patterns) {
    const match = String(html).match(pattern);

    if (match) return Number(match[1]);
  }

  return null;
}

function parseInboxState(html) {
  return {
    user: extractJSString(html, 'cur_user'),

    domain: extractJSString(html, 'cur_domain'),

    domainAscii: extractJSString(
      html,
      'cur_domain_ascii'
    ),

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

/* ============================================================
   GENERATE PARSER
============================================================ */

function parseGeneratedMailbox(html) {
  const user =
    extractInputValue(html, 'userName') ||
    extractJSString(html, 'cur_user');

  const domain =
    extractInputValue(html, 'domainName2') ||
    extractJSString(html, 'cur_domain');

  if (!user || !domain) return null;

  const normalizedUser = normalizeUser(user);
  const normalizedDomain = normalizeDomain(domain);

  if (!normalizedUser || !normalizedDomain) {
    return null;
  }

  return {
    user: normalizedUser,
    domain: normalizedDomain,
    email: `${normalizedUser}@${normalizedDomain}`
  };
}

/* ============================================================
   HTML CONTAINER HELPERS
============================================================ */

function extractBalancedElementAt(html, startIndex, tagName = 'div') {
  const source = String(html || '');

  const openRegex = new RegExp(`<${tagName}\\b[^>]*>`, 'i');
  const first = openRegex.exec(source.slice(startIndex));

  if (!first) return null;

  const realStart = startIndex + first.index;
  const contentStart = realStart + first[0].length;

  const tags = new RegExp(`</?${tagName}\\b[^>]*>`, 'gi');
  tags.lastIndex = contentStart;

  let depth = 1;
  let match;

  while ((match = tags.exec(source))) {
    if (new RegExp(`^<${tagName}\\b`, 'i').test(match[0])) {
      depth++;
    } else {
      depth--;
    }

    if (depth === 0) {
      return {
        start: realStart,
        end: tags.lastIndex,
        outer: source.slice(realStart, tags.lastIndex),
        inner: source.slice(contentStart, match.index)
      };
    }
  }

  return {
    start: realStart,
    end: source.length,
    outer: source.slice(realStart),
    inner: source.slice(contentStart)
  };
}

function extractDivInnerHTMLByClass(html, className) {
  const source = String(html || '');
  const escaped = escapeRegex(className);

  const opener = new RegExp(
    `<div\\b[^>]*class=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>`,
    'i'
  );

  const found = opener.exec(source);

  if (!found) return null;

  return extractBalancedElementAt(
    source,
    found.index,
    'div'
  )?.inner || null;
}

function extractDivInnerHTMLById(html, id) {
  const source = String(html || '');
  const escaped = escapeRegex(id);

  const opener = new RegExp(
    `<div\\b[^>]*id=["']${escaped}["'][^>]*>`,
    'i'
  );

  const found = opener.exec(source);

  if (!found) return null;

  return extractBalancedElementAt(
    source,
    found.index,
    'div'
  )?.inner || null;
}

function extractClassContent(html, className) {
  const div = extractDivInnerHTMLByClass(
    html,
    className
  );

  if (div !== null) return div;

  const escaped = escapeRegex(className);

  const regex = new RegExp(
    `<([a-z0-9]+)\\b[^>]*class=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
    'i'
  );

  return String(html).match(regex)?.[2] || null;
}

/* ============================================================
   MESSAGE IDS
============================================================ */

function parseMessageList(html, mailboxEmail = null) {
  const source = String(html || '');
  const entries = [];
  const seen = new Set();

  const regex =
    /loadInboxClientSide\s*\(\s*['"]([^'"]+)['"]\s*\)/gi;

  let match;

  while ((match = regex.exec(source))) {
    const path = decodeHtml(match[1]).trim();

    if (!path || seen.has(path)) continue;

    const parts =
      path.split('/').filter(Boolean);

    if (parts.length < 3) continue;

    const domain =
      normalizeDomain(parts[0]);

    const user =
      normalizeUser(parts[1]);

    const id =
      parts.slice(2).join('/').trim();

    if (!domain || !user || !id) continue;

    seen.add(path);

    const position = match.index;

    const start =
      Math.max(
        0,
        source.lastIndexOf(
          '<div',
          position
        )
      );

    const block =
      extractBalancedElementAt(
        source,
        start,
        'div'
      );

    const blockHtml =
      block?.outer ||
      source.slice(
        Math.max(0, position - 3000),
        Math.min(source.length, position + 5000)
      );

    const fromRaw =
      extractClassContent(
        blockHtml,
        'from_div_45g45gg'
      );

    const subjectRaw =
      extractClassContent(
        blockHtml,
        'subj_div_45g45gg'
      );

    const timeRaw =
      extractClassContent(
        blockHtml,
        'time_div_45g45gg'
      );

    entries.push({
      id,
      path: `${domain}/${user}/${id}`,
      user,
      domain,
      email:
        mailboxEmail ||
        `${user}@${domain}`,
      from:
        fromRaw
          ? htmlToText(fromRaw)
          : null,
      to:
        mailboxEmail ||
        `${user}@${domain}`,
      subject:
        subjectRaw
          ? htmlToText(subjectRaw)
          : null,
      time:
        timeRaw
          ? htmlToText(timeRaw)
          : null,
      body: null,
      html: null,
      links: []
    });
  }

  return entries;
}

function findMessageIds(html) {
  return parseMessageList(html)
    .map(item => item.id);
}

/* ============================================================
   SINGLE MESSAGE PARSERS
============================================================ */

function extractSummaryHead(html) {
  return (
    extractDivInnerHTMLById(
      html,
      'mail-summary-head'
    ) || null
  );
}

function extractSummaryBody(html) {
  return (
    extractDivInnerHTMLById(
      html,
      'mail-summary-body'
    ) || null
  );
}

function extractActualFrom(html) {
  const summary = extractSummaryHead(html);

  if (summary) {
    const raw = extractClassContent(
      summary,
      'from_div_45g45gg'
    );

    if (raw) {
      const value = htmlToText(raw);
      if (value) return value;
    }
  }

  const detail =
    extractSummaryBody(html) ||
    String(html);

  const patterns = [
    /<span\b[^>]*>\s*From:\s*<\/span>\s*<span\b[^>]*>([\s\S]*?)<\/span>/i,

    /<span\b[^>]*class=["'][^"']*\bwbreak\b[^"']*["'][^>]*>\s*From:\s*<\/span>\s*<span\b[^>]*>([\s\S]*?)<\/span>/i
  ];

  for (const pattern of patterns) {
    const match = detail.match(pattern);

    if (match?.[1]) {
      const value = htmlToText(match[1]);
      if (value) return value;
    }
  }

  return null;
}

function extractActualTo(
  html,
  fallbackEmail = null
) {
  const detail =
    extractSummaryBody(html) ||
    String(html);

  const patterns = [
    /<span\b[^>]*>\s*To:\s*<\/span>\s*<span\b[^>]*>([\s\S]*?)<\/span>/i,

    /<span\b[^>]*>\s*To:\s*<\/span>\s*<span\b[^>]*class=["'][^"']*\bwbreak\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
  ];

  for (const pattern of patterns) {
    const match = detail.match(pattern);

    if (match?.[1]) {
      const value = htmlToText(match[1]);
      if (value) return value;
    }
  }

  return fallbackEmail || null;
}

function extractActualSubject(html) {
  const detail =
    extractSummaryBody(html) ||
    String(html);

  const h1 = detail.match(
    /<h1\b[^>]*class=["'][^"']*\bsubj-h1\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i
  );

  if (h1?.[1]) {
    const value = htmlToText(h1[1]);

    if (value) return value;
  }

  const summary = extractSummaryHead(html);

  if (summary) {
    const raw = extractClassContent(
      summary,
      'subj_div_45g45gg'
    );

    if (raw) {
      const value = htmlToText(raw);

      if (value) return value;
    }
  }

  return null;
}

function extractMessageBodyHTML(html) {
  return (
    extractDivInnerHTMLByClass(
      html,
      'mess_bodiyy'
    ) || null
  );
}

function extractActualBody(html) {
  const bodyHTML = extractMessageBodyHTML(html);

  if (!bodyHTML) {
    return {
      html: null,
      text: null
    };
  }

  return {
    html: bodyHTML,
    text: htmlToText(bodyHTML) || null
  };
}

/* ============================================================
   LINKS
============================================================ */

function extractLinks(html) {
  const links = [];

  if (!html) return links;

  const hrefRegex =
    /href\s*=\s*["']([^"']+)["']/gi;

  let match;

  while ((match = hrefRegex.exec(String(html)))) {
    let url = decodeHtml(match[1]).trim();

    if (!url) continue;

    if (
      /^javascript:/i.test(url) ||
      /^mailto:/i.test(url) ||
      /^tel:/i.test(url) ||
      /^data:/i.test(url) ||
      url.startsWith('#')
    ) {
      continue;
    }

    if (url.startsWith('//')) {
      url = `https:${url}`;
    }

    if (
      /^https?:\/\//i.test(url) &&
      !links.includes(url)
    ) {
      links.push(url);
    }
  }

  const plain =
    htmlToText(html).match(
      /https?:\/\/[^\s<>"']+/gi
    ) || [];

  for (let url of plain) {
    url = url
      .replace(/[),.;]+$/, '')
      .trim();

    if (
      /^https?:\/\//i.test(url) &&
      !links.includes(url)
    ) {
      links.push(url);
    }
  }

  return links;
}

/* ============================================================
   SAFE HTML
============================================================ */

function sanitizeEmailHtml(html) {
  if (!html) return null;

  let safe = String(html);

  safe = safe
    .replace(
      /<(script|iframe|object|embed|form|input|button|textarea|select|meta|base)\b[^>]*>[\s\S]*?<\/\1>/gi,
      ''
    )
    .replace(
      /<(script|iframe|object|embed|form|input|button|textarea|select|meta|base)\b[^>]*\/?>/gi,
      ''
    );

  safe = safe.replace(
    /\s(on[a-z]+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
    ''
  );

  safe = safe.replace(
    /\shref\s*=\s*(["'])\s*(?:javascript|data|vbscript):[\s\S]*?\1/gi,
    ' href="#"'
  );

  safe = safe.replace(
    /\ssrc\s*=\s*(["'])\s*(?:javascript|vbscript):[\s\S]*?\1/gi,
    ''
  );

  safe = safe.replace(
    /<a\b([^>]*)>/gi,
    (full, attrs) => {
      let cleaned = attrs
        .replace(/\starget\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/\srel\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

      return `<a${cleaned} target="_blank" rel="noopener noreferrer nofollow">`;
    }
  );

  return safe;
}

/* ============================================================
   MULTI MESSAGE PARSER
============================================================ */

function findMessageBlocks(html) {
  const source = String(html || '');
  const positions = [];

  const regex =
    /<div\b[^>]*id=["']mail-summary-head["'][^>]*>/gi;

  let match;

  while ((match = regex.exec(source))) {
    positions.push(match.index);
  }

  if (positions.length === 0) {
    return [];
  }

  const blocks = [];

  for (let i = 0; i < positions.length; i++) {
    const start = positions[i];

    const end =
      i + 1 < positions.length
        ? positions[i + 1]
        : source.length;

    blocks.push(
      source.slice(start, end)
    );
  }

  return blocks;
}

function findNearbyMessageId(block, fullHtml, index) {
  const ownIds = findMessageIds(block);

  if (ownIds.length) {
    return ownIds[0];
  }

  const source = String(fullHtml || '');

  const blockIndex =
    typeof index === 'number'
      ? index
      : source.indexOf(block);

  if (blockIndex >= 0) {
    const before = source.slice(
      Math.max(0, blockIndex - 8000),
      blockIndex
    );

    const ids = findMessageIds(before);

    if (ids.length) {
      return ids[ids.length - 1];
    }
  }

  return null;
}

function parseMessageBlock(
  block,
  {
    id = null,
    mailboxEmail = null
  } = {}
) {
  const from = extractActualFrom(block);

  const to = extractActualTo(
    block,
    mailboxEmail
  );

  const subject =
    extractActualSubject(block);

  const parsedBody =
    extractActualBody(block);

  const rawHtml =
    parsedBody.html || null;

  const safeHtml =
    sanitizeEmailHtml(rawHtml);

  const links =
    rawHtml
      ? extractLinks(rawHtml)
      : [];

  return {
    id,
    from: from || null,
    to: to || mailboxEmail || null,
    subject: subject || null,
    body: parsedBody.text || null,
    html: safeHtml,
    links
  };
}

function parseMessages(
  html,
  mailboxEmail = null
) {
  const source = String(html || '');
  const state = parseInboxState(source);

  if (!state.messageCount) {
    return [];
  }

  const blocks =
    findMessageBlocks(source);

  const allIds =
    findMessageIds(source);

  const messages = [];

  if (blocks.length > 0) {
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];

      const blockIndex =
        source.indexOf(block);

      const id =
        findNearbyMessageId(
          block,
          source,
          blockIndex
        ) ||
        allIds[i] ||
        null;

      const parsed =
        parseMessageBlock(block, {
          id,
          mailboxEmail
        });

      if (
        parsed.from ||
        parsed.subject ||
        parsed.body ||
        parsed.html
      ) {
        messages.push(parsed);
      }
    }
  }

  /*
   * Fallback untuk struktur Generator.email
   * yang hanya merender satu message detail.
   */
  if (messages.length === 0) {
    const id =
      state.messageId ||
      state.messageIdRaw ||
      allIds[0] ||
      null;

    const parsed =
      parseMessageBlock(source, {
        id,
        mailboxEmail
      });

    if (
      parsed.from ||
      parsed.subject ||
      parsed.body ||
      parsed.html
    ) {
      messages.push(parsed);
    }
  }

  /*
   * Remove duplicate message IDs / duplicate content.
   */
  const unique = [];
  const seen = new Set();

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];

    const key =
      message.id ||
      [
        message.from || '',
        message.subject || '',
        message.body || ''
      ].join('|');

    if (seen.has(key)) continue;

    seen.add(key);

    unique.push({
      ...message,
      id: message.id || `message-${i + 1}`
    });
  }

  return unique;
}

function parseMessage(
  html,
  state = parseInboxState(html),
  mailboxEmail = null
) {
  if (!state.messageCount) {
    return {
      id: null,
      from: null,
      to: mailboxEmail || null,
      subject: null,
      body: null,
      html: null,
      links: []
    };
  }

  const messages =
    parseMessages(
      html,
      mailboxEmail
    );

  if (messages.length) {
    return messages[0];
  }

  return {
    id:
      state.messageId ||
      state.messageIdRaw ||
      findMessageIds(html)[0] ||
      null,

    from: null,
    to: mailboxEmail || null,
    subject: null,
    body: null,
    html: null,
    links: []
  };
}


/* ============================================================
   MESSAGE DETAIL FETCH
============================================================ */

function parseMessageDetail(
  html,
  {
    id = null,
    mailboxEmail = null,
    listItem = null
  } = {}
) {
  const parsed =
    parseMessageBlock(
      html,
      {
        id:
          id ||
          listItem?.id ||
          null,
        mailboxEmail
      }
    );

  return {
    ...listItem,
    ...parsed,
    id:
      id ||
      listItem?.id ||
      parsed.id ||
      null,
    from:
      parsed.from ||
      listItem?.from ||
      null,
    to:
      parsed.to ||
      listItem?.to ||
      mailboxEmail ||
      null,
    subject:
      parsed.subject ||
      listItem?.subject ||
      null,
    time:
      listItem?.time ||
      null,
    links:
      Array.isArray(parsed.links)
        ? parsed.links
        : []
  };
}

async function fetchMessageDetail(
  listItem,
  {
    jar,
    inboxPath,
    mailboxURL,
    mailboxEmail
  }
) {
  if (
    !listItem?.id ||
    !listItem?.domain ||
    !listItem?.user
  ) {
    return listItem;
  }

  const messageContext =
    `${listItem.domain}/${listItem.user}/${listItem.id}`;

  /*
   * Important:
   * Generator.email keeps the active tab/message context
   * in inbox_ctx. Set the full message context before
   * requesting the message route.
   */
  jar.set(
    'inbox_ctx',
    encodeURIComponent(messageContext)
  );

  const detailURL =
    buildMailboxURL(
      listItem.user,
      listItem.domain,
      listItem.id
    );

  const attempts = [
    detailURL,
    `${GE_BASE}${inboxPath}`
  ];

  for (const target of attempts) {
    try {
      jar.set(
        'inbox_ctx',
        encodeURIComponent(messageContext)
      );

      const response =
        await request(
          target,
          {
            jar,
            redirect: 'follow',
            headers: {
              Referer:
                `${GE_BASE}${inboxPath}`
            }
          }
        );

      if (!response.ok) continue;

      const parsed =
        parseMessageDetail(
          response.text,
          {
            id: listItem.id,
            mailboxEmail,
            listItem
          }
        );

      if (
        parsed.body ||
        parsed.html
      ) {
        return parsed;
      }
    } catch {
      // Try the next normal Generator.email route.
    }
  }

  return {
    ...listItem,
    body:
      listItem.body ||
      null,
    html:
      listItem.html ||
      null,
    links:
      Array.isArray(listItem.links)
        ? listItem.links
        : []
  };
}

/* ============================================================
   GENERATE
============================================================ */

async function generateMailbox() {
  const jar = new CookieJar();

  const response =
    await request(
      ENDPOINTS.homepage,
      { jar }
    );

  if (!response.ok) {
    throw new Error(
      `Generator.email HTTP ${response.status}`
    );
  }

  const mailbox =
    parseGeneratedMailbox(
      response.text
    );

  if (!mailbox) {
    throw new Error(
      'Gagal membaca mailbox Generator.email'
    );
  }

  return {
    ...mailbox,

    mailboxUrl:
      buildMailboxURL(
        mailbox.user,
        mailbox.domain
      )
  };
}

/* ============================================================
   INBOX
============================================================ */

async function fetchInbox(email) {
  const {
    user,
    domain,
    email: normalizedEmail
  } = splitEmail(email);

  const jar = new CookieJar();

  const mailboxContext =
    `${domain}/${user}`;

  jar.set(
    'inbox_ctx',
    encodeURIComponent(mailboxContext)
  );

  const mailboxURL =
    buildMailboxURL(
      user,
      domain
    );

  let inboxPath = null;

  try {
    const opened =
      await request(
        mailboxURL,
        {
          jar,
          redirect: 'follow',
          headers: {
            Referer: `${GE_BASE}/`
          }
        }
      );

    const match =
      String(opened.url || '')
        .match(/\/inbox\d+\//);

    if (match) {
      inboxPath = match[0];
    }
  } catch {
    // Use fallbacks below.
  }

  if (!inboxPath) {
    const candidates = [
      '/inbox8/',
      '/inbox7/',
      '/inbox6/'
    ];

    for (const candidate of candidates) {
      try {
        jar.set(
          'inbox_ctx',
          encodeURIComponent(mailboxContext)
        );

        const test =
          await request(
            candidate,
            {
              jar,
              headers: {
                Referer: mailboxURL
              }
            }
          );

        if (
          test.ok &&
          (
            test.text.includes(user) ||
            test.text.includes(domain) ||
            extractJSString(
              test.text,
              'cur_user'
            )
          )
        ) {
          inboxPath = candidate;
          break;
        }
      } catch {
        // Try next.
      }
    }
  }

  if (!inboxPath) {
    inboxPath = '/inbox8/';
  }

  jar.set(
    'inbox_ctx',
    encodeURIComponent(mailboxContext)
  );

  const response =
    await request(
      inboxPath,
      {
        jar,
        headers: {
          Referer: mailboxURL
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `Inbox HTTP ${response.status}`
    );
  }

  const state =
    parseInboxState(
      response.text
    );

  let messageList =
    parseMessageList(
      response.text,
      normalizedEmail
    );

  if (
    !messageList.length &&
    state.messageCount > 0
  ) {
    const activeId =
      state.messageId ||
      state.messageIdRaw ||
      null;

    if (activeId && activeId !== 'page_is_1') {
      messageList = [
        {
          id: activeId,
          path:
            `${domain}/${user}/${activeId}`,
          user,
          domain,
          email: normalizedEmail,
          from: null,
          to: normalizedEmail,
          subject: null,
          time: null,
          body: null,
          html: null,
          links: []
        }
      ];
    }
  }

  const messages = [];

  for (const item of messageList) {
    const detail =
      await fetchMessageDetail(
        item,
        {
          jar,
          inboxPath,
          mailboxURL,
          mailboxEmail:
            normalizedEmail
        }
      );

    messages.push(detail);
  }

  /*
   * Restore mailbox-level context after reading
   * individual messages.
   */
  jar.set(
    'inbox_ctx',
    encodeURIComponent(mailboxContext)
  );

  /*
   * Merge an already-rendered active message if the
   * main inbox response contains one.
   */
  const active =
    parseMessageDetail(
      response.text,
      {
        id:
          state.messageId &&
          state.messageId !== 'page_is_1'
            ? state.messageId
            : null,
        mailboxEmail:
          normalizedEmail
      }
    );

  if (
    active?.id &&
    (
      active.body ||
      active.html
    )
  ) {
    const index =
      messages.findIndex(
        item =>
          item.id === active.id
      );

    if (index >= 0) {
      messages[index] = {
        ...messages[index],
        ...active,
        time:
          messages[index].time ||
          active.time
      };
    }
  }

  const unique = [];
  const seen = new Set();

  for (const message of messages) {
    if (!message?.id) continue;
    if (seen.has(message.id)) continue;

    seen.add(message.id);
    unique.push(message);
  }

  const firstMessage =
    unique[0] ||
    null;

  return {
    mailbox: {
      user,
      domain,
      email:
        normalizedEmail,
      url:
        mailboxURL
    },

    inbox: {
      messageCount:
        Math.max(
          state.messageCount,
          unique.length
        ),

      messageId:
        (
          state.messageId &&
          state.messageId !== 'page_is_1'
            ? state.messageId
            : null
        ) ||
        firstMessage?.id ||
        null,

      messageIds:
        unique.map(
          item => item.id
        )
    },

    message:
      firstMessage,

    messages:
      unique,

    diagnostics: {
      inboxPath,
      serverMessageCount:
        state.messageCount,
      listMessages:
        messageList.length,
      parsedMessages:
        unique.length,
      htmlLength:
        response.text.length
    }
  };
}

/* ============================================================
   DOMAINS
============================================================ */

async function getDomains() {
  const jar = new CookieJar();

  const homepage =
    await request(
      ENDPOINTS.homepage,
      { jar }
    );

  if (!homepage.ok) {
    throw new Error(
      `Homepage HTTP ${homepage.status}`
    );
  }

  const apiToken =
    extractMeta(
      homepage.text,
      'api-token'
    );

  if (!apiToken) {
    throw new Error(
      'Generator.email API token tidak ditemukan'
    );
  }

  const response =
    await request(
      ENDPOINTS.domains,
      {
        jar,

        headers: {
          Accept:
            'application/json, text/plain, */*',

          'X-API-Token':
            apiToken,

          'X-Requested-With':
            'XMLHttpRequest',

          Referer:
            `${GE_BASE}/`
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `Domains HTTP ${response.status}`
    );
  }

  let json;

  try {
    json =
      JSON.parse(
        response.text
      );
  } catch {
    return [];
  }

  let source = [];

  if (Array.isArray(json)) {
    source = json;
  } else if (Array.isArray(json?.domains)) {
    source = json.domains;
  } else if (Array.isArray(json?.data)) {
    source = json.data;
  } else if (Array.isArray(json?.result)) {
    source = json.result;
  }

  const domains = [];

  for (const item of source) {
    let domain = null;

    if (typeof item === 'string') {
      domain = item;
    } else if (
      item &&
      typeof item === 'object'
    ) {
      domain =
        item.domain ||
        item.name ||
        item.value ||
        item.host ||
        null;
    }

    domain =
      normalizeDomain(domain);

    if (
      domain &&
      /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) &&
      !domains.includes(domain)
    ) {
      domains.push(domain);
    }
  }

  return domains;
}

/* ============================================================
   VALIDATE
============================================================ */

async function validateMailbox(email) {
  const { user, domain } =
    splitEmail(email);

  const body =
    new URLSearchParams({
      dmn: domain,
      usr: user
    }).toString();

  const response =
    await request(
      ENDPOINTS.uptime,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded',

          Referer:
            `${GE_BASE}/`
        },

        body
      }
    );

  return {
    ok: response.ok,
    status: response.status,
    text: response.text
  };
}

/* ============================================================
   PUNYCODE
============================================================ */

async function domainToPunycode(domain) {
  const normalized =
    normalizeDomain(domain);

  const body =
    new URLSearchParams({
      dmn: normalized
    }).toString();

  const response =
    await request(
      ENDPOINTS.punycode,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded',

          Referer:
            `${GE_BASE}/`
        },

        body
      }
    );

  if (!response.ok) {
    throw new Error(
      `Punycode HTTP ${response.status}`
    );
  }

  return response.text.trim();
}

/* ============================================================
   POLL
============================================================ */

async function pollInbox(
  email,
  {
    interval = 3000,
    timeout = 60000
  } = {}
) {
  const start = Date.now();
  let lastResult = null;

  while (
    Date.now() - start < timeout
  ) {
    lastResult =
      await fetchInbox(email);

    if (
      lastResult?.inbox
        ?.messageCount > 0
    ) {
      return lastResult;
    }

    await sleep(interval);
  }

  return lastResult;
}

/* ============================================================
   PARSE INBOX
============================================================ */

function parseInbox(
  html,
  mailboxEmail = null
) {
  const state =
    parseInboxState(html);

  const ids =
    findMessageIds(html);

  const messages =
    parseMessages(
      html,
      mailboxEmail
    );

  return {
    state,

    inbox: {
      messageCount:
        state.messageCount,

      messageId:
        state.messageId ||
        state.messageIdRaw ||
        ids[0] ||
        null,

      messageIds:
        ids
    },

    message:
      messages[0] || null,

    messages
  };
}

/* ============================================================
   EXPORT
============================================================ */

module.exports = {
  GE_BASE,
  ENDPOINTS,
  DEFAULT_TIMEOUT,

  generateMailbox,
  fetchInbox,
  pollInbox,
  getDomains,
  validateMailbox,
  domainToPunycode,

  parseGeneratedMailbox,
  parseInboxState,
  parseInbox,
  parseMessage,
  parseMessages,
  parseMessageList,
  parseMessageDetail,

  extractActualFrom,
  extractActualTo,
  extractActualSubject,
  extractActualBody,
  extractMessageBodyHTML,

  extractLinks,
  sanitizeEmailHtml,

  findMessageIds,
  findMessageBlocks,

  extractDivInnerHTMLByClass,
  extractDivInnerHTMLById,
  extractClassContent,

  htmlToText,
  decodeHtml,
  cleanText,

  buildMailboxURL,
  splitEmail,
  normalizeUser,
  normalizeDomain,

  sleep
};
