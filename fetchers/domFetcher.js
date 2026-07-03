import * as cheerio from 'cheerio';
import { chromium } from 'playwright';
import { extractTags } from '../utils/keywords.js';
import { diffJobIds, recordSnapshot } from '../utils/diff.js';
import {
  getCompanyById,
  upsertJob,
  deactivateJobs,
  updateCompany,
  getJobDescriptions,
} from '../db/client.js';
import {
  MAX_PAGES,
  STALE_PAGE_LIMIT,
  findNextPageUrl,
  hasClickOnlyNextControl,
  findClickableNextHandle,
} from '../utils/pagination.js';
import { nowLocalIso } from '../utils/time.js';

const REQUEST_TIMEOUT_MS = 10000;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal, headers: { 'User-Agent': USER_AGENT } });
  } finally {
    clearTimeout(timeout);
  }
}

const DESCRIPTION_FETCH_CONCURRENCY = 5;
const MAX_DESCRIPTION_LENGTH = 20000;

// Job detail pages, even on sites whose *listing* page needs JS (Airbnb), have
// consistently rendered statically in testing — plain fetch + cheerio is
// enough, no Playwright required for this step.
function extractDescriptionText(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript, nav, header, footer').remove();
  const main = $('main');
  const text = (main.length ? main : $('body')).text();
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPTION_LENGTH);
}

async function fetchJobDescription(url) {
  if (!url) return '';
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return '';
    return extractDescriptionText(await res.text());
  } catch {
    return '';
  }
}

async function mapWithConcurrency(items, limit, fn) {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      await fn(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// Descriptions rarely change once a posting is up, so postings already
// carrying a saved description (from an earlier run) reuse it instead of
// re-fetching their detail page every single day.
async function enrichJobDescriptions(jobs, existingDescriptions) {
  await mapWithConcurrency(jobs, DESCRIPTION_FETCH_CONCURRENCY, async (job) => {
    const cached = existingDescriptions.get(job.jobId);
    job.description = cached || (await fetchJobDescription(job.url));
  });
}

function stableFallbackId(title, url) {
  const base = `${title || ''}|${url || ''}`;
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    hash = (hash * 31 + base.charCodeAt(i)) | 0;
  }
  return `dom-${Math.abs(hash)}`;
}

function extractJobs($, company, baseUrl) {
  const jobs = [];

  $(company.selectorTitle).each((_, el) => {
    const $el = $(el);
    const $link = $el.is(company.selectorLink) ? $el : $el.find(company.selectorLink).first();

    // Title comes from the link's own text, not the whole matched element —
    // table-row layouts (title/team/location as separate cells) make the
    // element's combined text include every column, not just the title.
    const title = $link.text().trim();
    if (!title) return;

    const href = $link.attr('href') || '';
    let url = '';
    if (href) {
      try {
        url = new URL(href, baseUrl).toString();
      } catch {
        url = href;
      }
    }

    const location = company.selectorLocation
      ? $el.find(company.selectorLocation).first().text().trim()
      : '';

    jobs.push({
      jobId: stableFallbackId(title, url || location),
      title,
      location,
      url,
      description: '',
    });
  });

  return jobs;
}

async function fetchStaticDomJobs(company) {
  const jobs = [];
  const seenIds = new Set();
  const visited = new Set();
  let currentUrl = company.careersUrl;
  let needsJsPagination = false;
  let staleStreak = 0;

  for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
    if (visited.has(currentUrl)) break;
    visited.add(currentUrl);

    const res = await fetchWithTimeout(currentUrl);
    if (!res.ok) {
      if (pageNum === 0) {
        const err = new Error(`careers page returned ${res.status}`);
        err.httpStatus = res.status;
        throw err;
      }
      break; // a later page failing shouldn't discard jobs already collected
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const pageJobs = extractJobs($, company, currentUrl);
    jobs.push(...pageJobs);

    // The real "we've reached the last page" signal: a page that contributes
    // nothing we haven't already seen (whether that's a genuinely empty last
    // page, a duplicate of the previous one, or a pager looping back to page
    // 1). A couple of consecutive stale pages are tolerated before giving up,
    // so one flaky page doesn't cut pagination short.
    const hasNewJob = pageJobs.some((job) => !seenIds.has(job.jobId));
    for (const job of pageJobs) seenIds.add(job.jobId);
    staleStreak = hasNewJob ? 0 : staleStreak + 1;
    if (staleStreak >= STALE_PAGE_LIMIT) break;

    const nextUrl = findNextPageUrl($, currentUrl);
    if (!nextUrl) {
      // No plain href to follow, but a click-only ("data-page"/AJAX) control
      // exists — a static fetch can't drive it, so hand off to Playwright.
      if (hasClickOnlyNextControl($)) needsJsPagination = true;
      break;
    }
    if (nextUrl === currentUrl) break;
    currentUrl = nextUrl;
  }

  return { jobs, needsJsPagination };
}

async function fetchJsDomJobs(company) {
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ userAgent: USER_AGENT });

    const jobs = [];
    const seenIds = new Set();
    const visited = new Set();
    let currentUrl = company.careersUrl;
    let staleStreak = 0;

    await page.goto(currentUrl, { waitUntil: 'networkidle', timeout: REQUEST_TIMEOUT_MS * 2 });

    for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
      const html = await page.content();
      const $ = cheerio.load(html);
      const pageJobs = extractJobs($, company, page.url());
      jobs.push(...pageJobs);

      // Same "stop once a page adds nothing new" signal as the static path —
      // this is what actually detects the last page (Airbnb never tells us
      // its page count is 23; we just notice page 24 repeats page 23, or
      // comes back empty, and stop there). Tolerates a couple of stale
      // pages in a row before giving up, since an occasional click not
      // fully landing looks identical to "no new content" for one page.
      const hasNewJob = pageJobs.some((job) => !seenIds.has(job.jobId));
      for (const job of pageJobs) seenIds.add(job.jobId);
      staleStreak = hasNewJob ? 0 : staleStreak + 1;
      if (staleStreak >= STALE_PAGE_LIMIT) { console.error('BREAK stale limit'); break; }

      const nextUrl = findNextPageUrl($, page.url());
      if (nextUrl && !visited.has(nextUrl)) {
        visited.add(nextUrl);
        await page.goto(nextUrl, { waitUntil: 'networkidle', timeout: REQUEST_TIMEOUT_MS * 2 });
        continue;
      }

      // No href to follow — look for an AJAX-driven "next" control (e.g. a
      // FacetWP-style pager with data-page + a click handler, no href) and
      // click it, waiting for the DOM to actually change before extracting
      // the next page. This is the JS-required counterpart of the href path
      // above, and the reason this loop lives in the Playwright fetcher.
      //
      // Waiting on overall document length (or just networkidle) is too
      // loose: a transient loading-state swap can flip the length and
      // resolve the wait before the real content has arrived, and some
      // AJAX pagers (FacetWP included) delay firing their request past the
      // point networkidle already reports zero in-flight requests. Instead
      // wait for the thing we actually care about — the first listing's own
      // text — to change.
      const nextHandle = await findClickableNextHandle(page);
      if (!nextHandle) break;

      const prevFirstTitle = $(company.selectorTitle).first().text().trim();
      await nextHandle.click().catch(() => {});
      await page
        .waitForFunction(
          ({ sel, prevText }) => {
            const el = document.querySelector(sel);
            return !!el && el.innerText.trim() !== prevText;
          },
          { sel: company.selectorTitle, prevText: prevFirstTitle },
          { timeout: 10000 }
        )
        .catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {});

      // Some AJAX pagers patch the listing container progressively (first
      // item flips, then the rest stream in over the following moment) —
      // page.content() taken right when the above resolves can still catch
      // it mid-patch, even though networkidle has already gone quiet. A
      // short settle buffer avoids reading a half-updated page.
      await page.waitForTimeout(1000);
    }

    await browser.close();
    return jobs;
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    throw err;
  }
}

function syncCompanyJobs(companyId, jobs) {
  const now = nowLocalIso();

  // Some sources render duplicate rows for the same posting (e.g. Stripe's
  // paginated table repeats ~1/3 of rows) — collapse by jobId so reported
  // active/new counts reflect real distinct postings, not raw row count.
  const uniqueJobs = [...new Map(jobs.map((job) => [job.jobId, job])).values()];
  const jobIds = uniqueJobs.map((job) => job.jobId);

  const { newIds } = diffJobIds(companyId, jobIds);

  for (const job of uniqueJobs) {
    upsertJob({
      companyId,
      jobId: job.jobId,
      title: job.title,
      location: job.location,
      url: job.url,
      description: job.description,
      techStackTags: JSON.stringify(extractTags(job.description)),
      dateFirstSeen: now,
      dateLastSeen: now,
      isActive: 1,
    });
  }

  deactivateJobs(companyId, jobIds);
  recordSnapshot(companyId, jobIds);

  return { activeCount: jobIds.length, newCount: newIds.length };
}

async function fetchAndSync(companyId) {
  const company = getCompanyById(companyId);
  if (!company) throw new Error(`company ${companyId} not found`);

  let jobs;
  if (company.requiresJs) {
    jobs = await fetchJsDomJobs(company);
  } else {
    const staticResult = await fetchStaticDomJobs(company);
    if (staticResult.needsJsPagination) {
      // Page 1 rendered statically, but later pages are behind a click-only
      // AJAX pager a plain fetch can't drive — redo the whole fetch through
      // Playwright, and persist requiresJs so tomorrow's run skips straight
      // to it instead of re-discovering the same wall.
      jobs = await fetchJsDomJobs(company);
      updateCompany(companyId, { requiresJs: 1 });
    } else {
      jobs = staticResult.jobs;
    }
  }

  const existingDescriptions = getJobDescriptions(companyId);
  await enrichJobDescriptions(jobs, existingDescriptions);

  const result = syncCompanyJobs(companyId, jobs);

  updateCompany(companyId, { lastRunDate: nowLocalIso() });

  return result;
}

export async function runInitialFetch(companyId) {
  return fetchAndSync(companyId);
}

export async function runDailyFetch(companyId) {
  return fetchAndSync(companyId);
}
