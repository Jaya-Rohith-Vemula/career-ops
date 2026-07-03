import * as cheerio from 'cheerio';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const REQUEST_TIMEOUT_MS = 8000;

const URL_PATTERNS = [
  'https://careers.{domain}',
  'https://{domain}/careers',
  'https://{domain}/jobs',
  'https://jobs.{domain}',
  'https://{domain}/about/careers',
  'https://{domain}/company/careers',
  'https://{domain}/work-with-us',
  'https://{domain}/join-us',
];

const LINK_KEYWORDS = [
  'careers',
  'jobs',
  'hiring',
  'join us',
  'join our team',
  "we're hiring",
  'work with us',
  'work here',
  'open roles',
  'open positions',
];

function deriveDomain(companyName) {
  // Some companies' names already are a domain (e.g. "Alarm.com") — stripping
  // the dot and re-appending ".com" would probe an unrelated squatted domain
  // (alarmcom.com) instead of the real one (alarm.com).
  const cleaned = companyName.toLowerCase().replace(/[^a-z0-9.]/g, '');
  if (/\.[a-z]{2,}$/.test(cleaned)) return cleaned;
  return cleaned.replace(/\./g, '') + '.com';
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, ...(options.headers || {}) },
    });
  } finally {
    clearTimeout(timeout);
  }
}

function resolvesToDomain(resolvedUrl, domain) {
  const hostname = new URL(resolvedUrl).hostname.toLowerCase();
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

async function probeUrlPatterns(domain) {
  for (const pattern of URL_PATTERNS) {
    const url = pattern.replace('{domain}', domain);
    try {
      const res = await fetchWithTimeout(url, { method: 'HEAD' });
      if (res.status === 200 && resolvesToDomain(res.url, domain)) {
        return res.url;
      }
    } catch {
      // network error, timeout, etc — try next pattern
    }
  }
  return null;
}

async function scrapeHomepageLink(domain) {
  const homepageUrl = `https://${domain}`;
  let html;
  try {
    const res = await fetchWithTimeout(homepageUrl);
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  const $ = cheerio.load(html);
  let candidate = null;

  $('a').each((_, el) => {
    if (candidate) return;
    const href = $(el).attr('href');
    const text = $(el).text().toLowerCase().trim();
    if (!href) return;
    const hrefLower = href.toLowerCase();
    const matches = LINK_KEYWORDS.some(
      (kw) => hrefLower.includes(kw.replace(/\s+/g, '')) || text.includes(kw)
    );
    if (matches) {
      candidate = href;
    }
  });

  if (!candidate) return null;

  const resolvedUrl = new URL(candidate, homepageUrl).toString();

  try {
    const res = await fetchWithTimeout(resolvedUrl, { method: 'HEAD' });
    if (res.ok) return res.url;
    // some servers reject HEAD; fall back to GET
    const getRes = await fetchWithTimeout(resolvedUrl);
    if (getRes.ok) return getRes.url;
  } catch {
    return null;
  }

  return null;
}

export async function findCareersPage(companyName) {
  const domain = deriveDomain(companyName);

  const patternUrl = await probeUrlPatterns(domain);
  if (patternUrl) {
    return { url: patternUrl, method: 'pattern' };
  }

  const homepageLinkUrl = await scrapeHomepageLink(domain);
  if (homepageLinkUrl) {
    return { url: homepageLinkUrl, method: 'homepage_link' };
  }

  return null;
}
