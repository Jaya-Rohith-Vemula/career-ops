// Built In's engineering job listing renders fully server-side (no client-side
// XHR powers it — confirmed by inspecting the live page: the only network
// request on load is an unrelated Google avatar image, and the job list is
// present verbatim in the raw HTML from a plain fetch). Pagination is a `page`
// query param on the same URL; company names sit on `[data-id="company-title"]`
// inside each `[data-id="job-card"]`. Plain fetch + cheerio is enough — no
// Playwright required.
import * as cheerio from 'cheerio';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { logDaily, logError } from '../utils/logger.js';

// process.env isn't populated from .env by anything else in this codebase —
// load it directly so BUILTIN_JOBS_URL takes effect when set there.
try {
  process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), '..', '.env'));
} catch {
  // .env is optional — real env vars (e.g. in production) take precedence anyway
}

const BASE_URL = process.env.BUILTIN_JOBS_URL

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const REQUEST_TIMEOUT_MS = 10000;
const PAGE_DELAY_MS = 500;
const MAX_PAGES = 300;

function urlForPage(page) {
  const url = new URL(BASE_URL);
  if (page > 1) url.searchParams.set('page', String(page));
  return url.toString();
}

async function fetchPage(page) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(urlForPage(page), {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) return null;
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

function extractCompanyNames(html) {
  const $ = cheerio.load(html);
  return $('[data-id="job-card"] [data-id="company-title"]')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default async function fetchBuiltinCompanies() {
  const companies = new Set();

  try {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const html = await fetchPage(page);
      if (!html) break;

      const names = extractCompanyNames(html);
      if (names.length === 0) break;

      for (const name of names) companies.add(name);

      if (page < MAX_PAGES) await delay(PAGE_DELAY_MS);
    }
  } catch (err) {
    logError('Builtin', `scrape failed: ${err.message}`);
  }

  logDaily(`Builtin scrape complete: ${companies.size} companies found`);
  return Array.from(companies);
}
