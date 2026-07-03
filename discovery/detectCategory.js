import * as cheerio from 'cheerio';
import { chromium } from 'playwright';
import { findNextPageUrl, hasNextPageControl } from '../utils/pagination.js';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const REQUEST_TIMEOUT_MS = 8000;
const XHR_LISTEN_MS = 8000;

const ATS_PATTERNS = [
  // The embed script URL has a "/js" segment before the query string
  // (boards.greenhouse.io/embed/job_board/js?for=slug), not just
  // "embed/job_board?for=slug" — both forms appear in the wild.
  { platform: 'greenhouse', host: 'greenhouse.io', slugRegex: /greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=|)([a-z0-9-]+)/i },
  { platform: 'lever', host: 'lever.co', slugRegex: /lever\.co\/([a-z0-9-]+)/i },
  { platform: 'ashby', host: 'ashbyhq.com', slugRegex: /ashbyhq\.com\/([a-z0-9-]+)/i },
];

const ATS_API = {
  greenhouse: (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
  lever: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
  ashby: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
};

const TITLE_KEYS = ['title', 'jobtitle', 'positiontitle'];
const ID_KEYS = ['jobid', 'requisitionid', 'jobrequisitionid', 'postingid'];
const LOCATION_KEYS = ['location', 'city', 'department', 'team'];
const MIN_JOB_ARRAY_LENGTH = 2;

// Third-party scripts (analytics, consent management, tag managers) commonly
// return JSON with generic id/name/title-shaped objects that otherwise pass
// the job-listing heuristic — exclude known non-job hosts outright.
const NON_JOB_HOSTS = [
  'cookielaw.org',
  'onetrust.com',
  'fullstory.com',
  'hotjar.com',
  'clarity.ms',
  'googletagmanager.com',
  'google-analytics.com',
  'doubleclick.net',
  'facebook.net',
  'facebook.com',
  'hubspot.com',
  'hs-analytics.net',
  'hs-banner.com',
  'adroll.com',
  'licdn.com',
  'bing.com',
  'segment.io',
  'segment.com',
  'amplitude.com',
  'mixpanel.com',
];

function isNonJobHost(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return NON_JOB_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
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

function matchAtsFromString(str) {
  if (!str) return null;
  for (const { platform, host, slugRegex } of ATS_PATTERNS) {
    if (str.includes(host)) {
      const match = str.match(slugRegex);
      if (match) return { platform, slug: match[1] };
    }
  }
  return null;
}

// Matches an ATS's *public API* URL shape specifically — distinct from
// ATS_PATTERNS, which match the careers-page/embed URL shape. A company's
// ATS integration can be invisible in static HTML (loaded async via JS) but
// still show up as an XHR call straight to the ATS's own API.
const ATS_API_URL_PATTERNS = [
  { platform: 'greenhouse', regex: /boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9-]+)/i },
  { platform: 'lever', regex: /api\.lever\.co\/v0\/postings\/([a-z0-9-]+)/i },
  { platform: 'ashby', regex: /api\.ashbyhq\.com\/posting-api\/job-board\/([a-z0-9-]+)/i },
];

function matchAtsFromApiUrl(url) {
  for (const { platform, regex } of ATS_API_URL_PATTERNS) {
    const match = url.match(regex);
    if (match) return { platform, slug: match[1] };
  }
  return null;
}

async function detectAts(careersUrl) {
  const fromUrl = matchAtsFromString(careersUrl);
  if (fromUrl) return fromUrl;

  let html;
  try {
    const res = await fetchWithTimeout(careersUrl);
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  const $ = cheerio.load(html);
  let found = null;

  $('script[src], a[href]').each((_, el) => {
    if (found) return;
    const src = $(el).attr('src') || $(el).attr('href');
    const candidate = matchAtsFromString(src);
    if (candidate) found = candidate;
  });

  if (!found) {
    found = matchAtsFromString(html);
  }

  return found;
}

async function confirmAtsApi(platform, slug) {
  const apiUrl = ATS_API[platform](slug);
  try {
    const res = await fetchWithTimeout(apiUrl);
    if (!res.ok) return false;
    const data = await res.json();
    if (platform === 'greenhouse') return Array.isArray(data?.jobs);
    if (platform === 'lever') return Array.isArray(data);
    if (platform === 'ashby') return Array.isArray(data?.jobs);
    return false;
  } catch {
    return false;
  }
}

function objectLooksLikeJob(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const keys = Object.keys(obj).map((k) => k.toLowerCase());
  const hasTitle = keys.some((k) => TITLE_KEYS.includes(k));
  const hasId = keys.some((k) => ID_KEYS.includes(k));
  const hasLocation = keys.some((k) => LOCATION_KEYS.includes(k));
  return hasTitle && (hasId || hasLocation);
}

function findJobArray(data, depth = 0) {
  if (depth > 4 || data == null || typeof data !== 'object') return false;

  if (Array.isArray(data)) {
    if (data.length >= MIN_JOB_ARRAY_LENGTH && data.every(objectLooksLikeJob)) {
      return true;
    }
    return data.some((item) => findJobArray(item, depth + 1));
  }

  return Object.values(data).some((value) => findJobArray(value, depth + 1));
}

function looksLikeJobListingJson(data) {
  return findJobArray(data);
}

async function detectXhr(careersUrl) {
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ userAgent: USER_AGENT });

    let found = null;
    page.on('response', async (response) => {
      if (found) return;
      if (isNonJobHost(response.url())) return;

      // A URL matching a known ATS's public API shape (e.g. api.lever.co/v0/postings/...)
      // is trustworthy on its own — skip the generic JSON-shape heuristic below, which
      // only recognizes generic title/id/location keys and misses ATS-specific schemas
      // (e.g. Lever posting objects use `text` for title and nest location under
      // `categories`, not top-level `title`/`location`).
      if (matchAtsFromApiUrl(response.url())) {
        found = {
          endpoint: response.url(),
          method: response.request().method(),
          headers: response.request().headers(),
        };
        return;
      }

      const contentType = response.headers()['content-type'] || '';
      if (!contentType.includes('application/json')) return;
      try {
        const json = await response.json();
        if (looksLikeJobListingJson(json)) {
          found = {
            endpoint: response.url(),
            method: response.request().method(),
            headers: response.request().headers(),
          };
        }
      } catch {
        // not JSON or already consumed
      }
    });

    await page.goto(careersUrl, { waitUntil: 'networkidle', timeout: REQUEST_TIMEOUT_MS * 2 }).catch(() => {});
    await page.waitForTimeout(XHR_LISTEN_MS);
    await browser.close();
    return found;
  } catch {
    if (browser) await browser.close().catch(() => {});
    return null;
  }
}

async function confirmXhrEndpoint(xhrInfo) {
  try {
    const res = await fetchWithTimeout(xhrInfo.endpoint, {
      method: xhrInfo.method,
      headers: xhrInfo.headers,
    });
    if (!res.ok) return false;
    const data = await res.json();
    return looksLikeJobListingJson(data);
  } catch {
    return false;
  }
}

async function detectDomStatic(careersUrl) {
  let html;
  let finalUrl;
  try {
    const res = await fetchWithTimeout(careersUrl);
    if (!res.ok) return null;
    // careersUrl may redirect to a different host (e.g. www.airbnb.com/careers
    // -> careers.airbnb.com/) — resolve relative hrefs and root-domain checks
    // against where the content actually came from, not the requested URL.
    finalUrl = res.url || careersUrl;
    html = await res.text();
  } catch {
    return null;
  }

  const $ = cheerio.load(html);
  const selectors = findJobSelectors($, finalUrl);
  if (!selectors) return null;

  // A static fetch can miss pagination entirely on sites that template their
  // "next page" control in via JS from embedded JSON (e.g. a FacetWP-style
  // pager) rather than emitting real markup — the control simply doesn't
  // exist anywhere in the raw HTML, so no amount of cheerio inspection of
  // *this* response can find it. Only worth the extra render when the static
  // HTML shows zero pagination signal at all — if it already has a plain
  // href-based "next" (Stripe-style), fetchStaticDomJobs handles that fine
  // without JS, and re-checking would misfire on every such normal page.
  const hasStaticPaginationSignal = !!findNextPageUrl($, finalUrl) || hasNextPageControl($);
  if (!hasStaticPaginationSignal && (await pageRequiresJsForPagination(finalUrl))) {
    selectors.requiresJs = 1;
  }

  return { ...selectors, finalUrl };
}

async function pageRequiresJsForPagination(url) {
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ userAgent: USER_AGENT });
    await page.goto(url, { waitUntil: 'networkidle', timeout: REQUEST_TIMEOUT_MS * 2 });
    const html = await page.content();
    await browser.close();

    const $ = cheerio.load(html);
    return !!findNextPageUrl($, url) || hasNextPageControl($);
  } catch {
    if (browser) await browser.close().catch(() => {});
    return false;
  }
}

const EXCLUDED_ANCESTORS = 'nav, header, footer';
const MIN_TITLE_LENGTH = 4;
const MAX_TITLE_LENGTH = 100;

// A repeated link-shaped group is only trusted as "the job list" if it also
// carries a job-specific signal — otherwise the highest-count repeated
// element on the page wins by default, which is often a nav/locale-switcher
// list rather than actual postings (e.g. Stripe's `a.Link`, used site-wide).
const JOB_KEYWORDS = ['job', 'career', 'position', 'opening', 'role', 'vacan'];
const MIN_URL_MATCH_RATIO = 0.4;
const CONTAINER_SEARCH_DEPTH = 6;

function classSelector(el, $) {
  const cls = ($(el).attr('class') || '').trim().split(/\s+/).filter(Boolean);
  if (!cls.length) return el.tagName.toLowerCase();
  return `${el.tagName.toLowerCase()}.${cls.join('.')}`;
}

// Naive eTLD+1 (last two labels) — matches the simplicity level already used
// by findCareersPage.js's own domain checks; doesn't handle multi-part TLDs
// like .co.uk, which is an accepted limitation elsewhere in this codebase too.
function rootDomain(hostname) {
  return hostname.split('.').slice(-2).join('.');
}

function hrefLooksLikeJobUrl(href, baseUrl) {
  if (!href) return false;

  let resolved;
  try {
    resolved = new URL(href, baseUrl);
  } catch {
    return false;
  }

  // Job postings live on the company's own site — possibly a different
  // subdomain than the careers page itself (careers.airbnb.com vs
  // www.airbnb.com) — but never a third-party domain (news coverage,
  // citations, etc.). Comparing root domains instead of exact hostnames
  // allows the former while still rejecting the latter.
  try {
    if (rootDomain(resolved.hostname) !== rootDomain(new URL(baseUrl).hostname)) return false;
  } catch {
    // baseUrl unparseable — fall through and judge on path alone
  }

  const path = resolved.pathname.toLowerCase();
  const segments = path.split('/').filter(Boolean);

  // A numeric job/requisition ID (6+ digits — 4 would also match a year
  // embedded in a blog path) is the strongest, least ambiguous signal.
  if (segments.some((seg) => /^\d{6,}$/.test(seg))) return true;

  // Otherwise require BOTH a job-section keyword AND a title-like trailing
  // slug (long, multi-hyphen). A bare keyword match alone is too weak on a
  // page whose own path already contains it — e.g. stripe.com/jobs links to
  // /jobs/culture and /jobs/life-at-stripe (content pages, not postings)
  // purely because they share the /jobs/ prefix, not because they're jobs.
  const hasSectionKeyword = segments.some((seg) => JOB_KEYWORDS.some((kw) => seg.includes(kw)));
  const lastSegment = segments[segments.length - 1] || '';
  const looksLikeTitleSlug = lastSegment.length >= 20 && (lastSegment.match(/-/g) || []).length >= 3;

  return hasSectionKeyword && looksLikeTitleSlug;
}

function containerLooksJobRelated($, container) {
  let node = $(container);
  for (let i = 0; i < CONTAINER_SEARCH_DEPTH && node.length; i++) {
    const attrs = `${node.attr('class') || ''} ${node.attr('id') || ''}`.toLowerCase();
    if (JOB_KEYWORDS.some((kw) => attrs.includes(kw))) return true;
    node = node.parent();
  }
  return false;
}

function findJobSelectors($, baseUrl) {
  const candidates = [];

  $('body')
    .find('*')
    .each((_, el) => {
      if ($(el).closest(EXCLUDED_ANCESTORS).length) return;

      const children = $(el).children().toArray();
      if (children.length < 3) return;

      const groups = new Map();
      for (const child of children) {
        const key = classSelector(child, $);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(child);
      }

      for (const [key, group] of groups) {
        if (group.length < 3) continue;

        const links = group.map((item) => {
          const $item = $(item);
          return $item.is('a') ? $item : $item.find('a').first();
        });

        // Judge title length from the link's own text, not the whole item's —
        // table-row layouts (title/team/location as separate cells) make the
        // row's combined text far exceed MAX_TITLE_LENGTH even though the
        // actual job title, inside the link, is a normal length.
        const withJobLikeContent = group.filter((item, i) => {
          const text = links[i].text().trim();
          return (
            links[i].length > 0 &&
            text.length >= MIN_TITLE_LENGTH &&
            text.length <= MAX_TITLE_LENGTH
          );
        });

        if (withJobLikeContent.length / group.length < 0.8) continue;

        const urlMatchRatio =
          links.filter((link) => hrefLooksLikeJobUrl(link.attr('href'), baseUrl)).length /
          links.length;
        const containerMatch = containerLooksJobRelated($, el);

        candidates.push({ selector: key, count: group.length, urlMatchRatio, containerMatch });
      }
    });

  if (!candidates.length) return null;

  const strongCandidates = candidates.filter(
    (c) => c.containerMatch || c.urlMatchRatio >= MIN_URL_MATCH_RATIO
  );

  if (!strongCandidates.length) return null;

  strongCandidates.sort((a, b) => b.count - a.count);
  const best = strongCandidates[0];

  return {
    selectorTitle: best.selector,
    selectorLocation: null,
    selectorLink: 'a',
    requiresJs: 0,
  };
}

async function detectDomJs(careersUrl) {
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ userAgent: USER_AGENT });
    await page.goto(careersUrl, { waitUntil: 'networkidle', timeout: REQUEST_TIMEOUT_MS * 2 });
    const finalUrl = page.url();
    const html = await page.content();
    await browser.close();

    const $ = cheerio.load(html);
    const selectors = findJobSelectors($, finalUrl);
    if (!selectors) return null;
    return { ...selectors, requiresJs: 1, finalUrl };
  } catch {
    if (browser) await browser.close().catch(() => {});
    return null;
  }
}

async function detectCategoryAtUrl(careersUrl) {
  const atsMatch = await detectAts(careersUrl);
  if (atsMatch) {
    const confirmed = await confirmAtsApi(atsMatch.platform, atsMatch.slug);
    if (confirmed) {
      return {
        category: 'ats',
        config: {
          atsPlatform: atsMatch.platform,
          atsSlug: atsMatch.slug,
        },
      };
    }
  }

  const xhrMatch = await detectXhr(careersUrl);
  if (xhrMatch) {
    const atsFromApi = matchAtsFromApiUrl(xhrMatch.endpoint);
    if (atsFromApi && (await confirmAtsApi(atsFromApi.platform, atsFromApi.slug))) {
      return {
        category: 'ats',
        config: {
          atsPlatform: atsFromApi.platform,
          atsSlug: atsFromApi.slug,
        },
      };
    }

    const confirmed = await confirmXhrEndpoint(xhrMatch);
    if (confirmed) {
      return {
        category: 'xhr',
        config: {
          xhrEndpoint: xhrMatch.endpoint,
          xhrHeaders: JSON.stringify(xhrMatch.headers),
          xhrParams: JSON.stringify({}),
        },
      };
    }
  }

  const staticDom = await detectDomStatic(careersUrl);
  if (staticDom) {
    const { finalUrl, ...config } = staticDom;
    return { category: 'dom', config, finalUrl };
  }

  const jsDom = await detectDomJs(careersUrl);
  if (jsDom) {
    const { finalUrl, ...config } = jsDom;
    return { category: 'dom', config, finalUrl };
  }

  return null;
}

// Many companies' careers URL is a marketing landing page, not the actual
// listings — the real jobs sit one click away behind a "See open roles" /
// "Explore open roles" style CTA (e.g. stripe.com/jobs -> stripe.com/jobs/search,
// anthropic.com/careers -> anthropic.com/careers/jobs). If detection finds
// nothing on the original URL, follow that CTA once and retry there before
// giving up — bounded to a single hop, not a general-purpose crawler.
// "Join the team/us" is also a common CTA phrasing (e.g. brightedge.com/careers'
// "Join the Team" button) distinct from the see/explore/view-style phrasing above —
// it doesn't pair a job-section noun with a discovery verb, so it needs its own branch.
// A bare "Open Positions" / "Current Openings" button (e.g. alarm.com/careers) is a
// third distinct shape — no discovery verb at all, just an adjective + job noun.
const OPEN_ROLES_LINK_REGEX =
  /\b(see|explore|view|browse|search)\b[\s\S]{0,20}\b(open\s+)?(role|job|position)s?\b|\bjoin\b[\s\S]{0,20}\b(the\s+|our\s+)?team\b|\b(open|current)\b[\s\S]{0,20}\b(role|job|position|opening)s?\b/i;
const MAX_LINK_TEXT_LENGTH = 60;

async function findOpenRolesLink(careersUrl) {
  let html;
  let finalUrl;
  try {
    const res = await fetchWithTimeout(careersUrl);
    if (!res.ok) return null;
    // Resolve against where the page actually ended up, not the requested
    // URL — careersUrl commonly redirects to a different host (e.g.
    // www.airbnb.com/careers -> careers.airbnb.com/), and a relative href
    // like "/positions" means something different on each host.
    finalUrl = res.url || careersUrl;
    html = await res.text();
  } catch {
    return null;
  }

  const $ = cheerio.load(html);
  let found = null;

  $('a[href]').each((_, el) => {
    if (found) return;
    const text = $(el).text().trim();
    if (!text || text.length > MAX_LINK_TEXT_LENGTH) return;
    if (!OPEN_ROLES_LINK_REGEX.test(text)) return;

    try {
      const resolved = new URL($(el).attr('href'), finalUrl).toString();
      if (resolved !== finalUrl) found = resolved;
    } catch {
      // ignore invalid href
    }
  });

  return found;
}

export async function detectCategory(careersUrl) {
  const direct = await detectCategoryAtUrl(careersUrl);
  if (direct) return { ...direct, resolvedUrl: direct.finalUrl || careersUrl };

  const openRolesUrl = await findOpenRolesLink(careersUrl);
  if (!openRolesUrl) return null;

  const hopped = await detectCategoryAtUrl(openRolesUrl);
  if (!hopped) return null;

  return { ...hopped, resolvedUrl: hopped.finalUrl || openRolesUrl };
}
