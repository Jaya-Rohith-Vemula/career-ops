# Job Tracking Pipeline — Claude Code Build Brief

## Overview

A self-configuring, locally-running job tracking pipeline built entirely in JavaScript (Node.js). It accepts a plain text list of company names, automatically discovers each company's career page, detects how that page works, stores the configuration, and runs a lightweight daily fetch to surface new job openings. All data is stored in SQLite.

**Two phases:**
- **Phase 1 (this brief):** Pipeline only — career page discovery, category detection, daily runner, SQLite storage, CLI interface
- **Phase 2 (separate brief):** Local web app at `localhost:3000` — view jobs, add companies, trigger discovery, mark jobs as reviewed/saved/applied

---

## Core Philosophy

- **Discovery is smart and one-time.** When a company is added, the agent finds its career page automatically, detects how it works, and stores the full config.
- **Daily execution is dumb and cheap.** A plain Node script reads the saved config and replays the appropriate fetch — no AI, no browser unless strictly necessary.
- **Failures are self-healing.** Zero results for 3 consecutive days triggers automatic re-discovery for that company only.
- **No cloud services, no paid APIs.** Everything runs locally. Playwright is used only for category detection (XHR interception) and JS-rendered DOM fetches — not for URL discovery.
- **One language end to end.** JavaScript (Node.js 20+) for everything in Phase 1, extended with Express and a browser UI in Phase 2.

---

## Runtime and Package Manager

- **Node.js v20+** (LTS) — built-in `fetch`, no polyfill needed
- **npm** for package management
- **ES Modules** — set `"type": "module"` in `package.json`, use `import`/`export` throughout

---

## Step 0 — Career Page Discovery (NEW — runs before everything else)

This step is the entry point for every new company. Given only a company name, the agent finds the correct careers page URL automatically using a two-strategy fallback chain. It stops as soon as one strategy succeeds; if both fail, the company is left for manual entry.

> **Revised from the original three-strategy design.** A Strategy 3 (headless web search via DuckDuckGo) was attempted and dropped: both DuckDuckGo and Bing actively serve CAPTCHA/bot-challenge pages to headless Playwright and plain HTTP requests alike (confirmed empirically, not a selector or user-agent issue). There is no reliable no-cost way to scrape either engine headlessly, so the fallback was removed rather than shipped flaky. Companies where Strategies 1–2 both fail are flagged for manual entry instead.

### Strategy 1 — Common URL pattern probing (instant, no browser)

Derive the likely domain from the company name (e.g. `Stripe` → `stripe.com`) and probe these patterns in order using HTTP HEAD requests. Stop at the first response that (a) returns 200 and (b) resolves — after following redirects — to a hostname that is still the derived domain or a subdomain of it:

```
https://careers.{domain}
https://{domain}/careers
https://{domain}/jobs
https://jobs.{domain}
https://{domain}/about/careers
https://{domain}/company/careers
https://{domain}/work-with-us
https://{domain}/join-us
```

Domain derivation: lowercase the company name, strip punctuation, append `.com`. For companies with known non-.com domains, Strategy 2 will catch them if a homepage link exists; otherwise discovery returns `null` and the company needs manual entry.

The redirect-target check exists because naive `.com` guessing can land on a domain owned by an unrelated company (e.g. `linear.com` is Analog Devices' domain, not Linear the software company, and returns a 200 after redirecting off-domain) — without verifying the final hostname, this produces a confidently wrong careers URL rather than a clean failure.

If a HEAD request returns 200 and passes the domain check → store the final (post-redirect) URL, mark discovery method as `pattern`, move to category detection.

### Strategy 2 — Homepage link scraping (one page fetch, no browser)

Fetch the company's main homepage (`https://{domain}`) using built-in `fetch`. Parse the HTML with `cheerio`. Look for anchor tags whose `href` or inner text contains any of:

```
careers, jobs, hiring, join us, join our team, we're hiring, work with us, work here, open roles, open positions
```

If a matching link is found → follow it (handle redirects), confirm it resolves to a valid page, store the URL, mark discovery method as `homepage_link`. (Unlike Strategy 1, the resolved link is not required to stay on the derived domain — legitimate careers pages commonly live on an ATS's own domain, e.g. `boards.greenhouse.io` or `jobs.lever.co`.)

### Discovery result stored in DB

After any successful strategy, store:
- The confirmed careers page URL
- The discovery method used (`pattern`, `homepage_link`)
- The timestamp

If both strategies fail, mark the company `discoveryStatus = 'failed'`, log it, and move to the next company — do not crash the batch run. Manual entry (`--url` + `--rediscover`) is the recovery path.

Then immediately pass the URL to Step 1 (category detection).

---

## Step 1 — Category Detection

Given the confirmed careers page URL, detect which of the three categories it belongs to.

> **Added: one-hop "open roles" CTA follow.** Many companies' careers URL (found in Step 0) is a
> marketing landing page, not the actual listings — the real jobs sit one click away behind a
> "See open roles" / "Explore open roles" style link (e.g. `stripe.com/jobs` → `stripe.com/jobs/search`,
> `anthropic.com/careers` → `anthropic.com/careers/jobs`). If none of Category 1–3 detection
> matches on the original URL, look for an anchor whose text matches a CTA pattern like
> "see/explore/view/browse/search ... (open) role(s)/job(s)/position(s)", follow it once, and
> retry detection there before giving up. Bounded to a single hop (not a general crawler) to avoid
> unbounded traversal. If a hop succeeds, the *resolved* URL — not the original landing page — is
> what gets stored as the company's `careersUrl`, since that's the page later daily fetches
> actually need to hit.

### Category 1 — Known ATS Platforms (Greenhouse, Lever, Ashby)

**Detection:**
- Check if the URL itself contains `greenhouse.io`, `lever.co`, or `ashby.com`
- If not, fetch the page source and look for these strings in `<script src>`, `<a href>`, or redirect URLs
- Extract the company slug from the URL pattern

**Discovery action:**
- Call the ATS public API with the extracted slug to confirm it returns data
- Store platform name, slug, and category in the `companies` table
- Run an initial job fetch immediately as the baseline snapshot

**Public API endpoints:**
- Greenhouse: `https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true`
- Lever: `https://api.lever.co/v0/postings/{slug}?mode=json`
- Ashby: `https://api.ashbyhq.com/posting-api/job-board/{slug}`

---

### Category 2 — Hidden XHR APIs (Workday, iCIMS, SmartRecruiters, etc.)

**Detection:**
- Launch Playwright, visit the careers page
- Intercept all network requests using `page.on('request')` and `page.on('response')`
- Identify responses returning JSON that resembles job listings (look for keys like `title`, `jobId`, `location`, `requisitionId`, `jobRequisitionId`)
- If such a response is found, this is a Category 2 company

**Discovery action:**
- Save the XHR endpoint URL, headers, and query parameters to the `companies` table as JSON strings
- Replay the saved call once using `fetch` to confirm it works independently of the browser
- Run an initial job fetch as the baseline snapshot

**Daily runner:**
- Replay the saved endpoint with `fetch` — no browser needed
- Parse the JSON, run keyword filtering, diff against previous snapshot

---

### Category 3 — Proprietary DOM-Based Pages

**Detection:**
- Reached if no ATS indicators and no XHR job data is found
- Check if job listings are visible in the raw HTML (static) or only after JS executes (dynamic)
- Static: `fetch` the page, parse with `cheerio`, look for repeated DOM structures containing job titles
- Dynamic: if `cheerio` finds nothing, use Playwright to render the page and inspect the live DOM

**Discovery action:**
- Identify CSS selectors that reliably target job title, location, and apply link
- Store selectors and `requiresJs` flag in the `companies` table
- Run an initial fetch as the baseline snapshot

**Daily runner:**
- `requiresJs = false`: `fetch` + `cheerio` + saved selectors
- `requiresJs = true`: Playwright + saved selectors
- Diff against previous snapshot, insert new roles

> **Added: pagination follow.** A single-page fetch silently misses every job past page 1 on
> sites whose listings are paginated (e.g. Stripe's `?skip=100` pattern). After extracting jobs
> from a page, look for an anchor whose text matches a "next page" pattern ("next", "load more",
> "show more", "»", "›", ">"), follow it, and repeat — generically, not by guessing site-specific
> query param shapes. Applies to both the static and JS-rendered fetch paths.
>
> **How pagination actually stops** isn't a fixed page count — no site tells us up front how many
> pages exist. Instead, each fetched page's jobs are checked against every job id seen so far on
> this run; a page that contributes zero *new* ids is treated as "we've reached the end" (whether
> that's a genuinely empty/short last page, a duplicate re-render, or a pager looping back to page
> 1). A couple of consecutive stale pages (`STALE_PAGE_LIMIT`, `utils/pagination.js`) are tolerated
> before giving up, since an occasional click that doesn't fully land looks identical, for one
> page, to having reached the end. `MAX_PAGES` still exists as a circuit breaker (large — 200, not
> a real limit in practice) purely to bound worst-case runtime if a site's pagination is broken in
> a way that keeps manufacturing "new" ids forever.
>
> **Added: click-only (AJAX) pagination.** Some pagers (e.g. a FacetWP-style widget, seen on
> Airbnb's careers page) have no `href` at all — just a `data-page` attribute and a click handler
> that triggers an AJAX refresh, so a plain `fetch` + `cheerio` pass can never follow them. Worse,
> on some of these sites the pager markup doesn't exist anywhere in the raw static HTML — it's
> templated in from an embedded JSON blob only after JS runs — so even a static-HTML pass
> specifically looking for a click-only control can miss it entirely. To catch this class of site:
> - **At discovery time** (`detectCategory.js`), if the static HTML shows *zero* pagination signal
>   at all (no href-based next, no click-only control either), render the page once via Playwright
>   and re-check there. If pagination shows up only post-render, mark the company `requiresJs = 1`
>   even though page 1 itself fetched fine statically — pagination, not page 1, is what needs JS.
> - **At fetch time** (`domFetcher.js`), if a static fetch mid-run hits a click-only control it
>   can't follow, it escalates to a full Playwright re-fetch and persists `requiresJs = 1` so future
>   runs skip straight to it.
> - **In the Playwright path**, once href-based paging is exhausted, look for a visible/enabled
>   `next`-shaped `<a>`/`<button>`/`[role=button]` with no href, click it, and wait for the page's
>   own selector-matched content to change (not just `networkidle` or a raw HTML-length check —
>   both resolve too early against AJAX pagers whose container patches in progressively; a short
>   fixed settle delay after the content-change signal further guards against reading a
>   half-patched page).
> Shared detection/click helpers for both the href and click-only cases live in
> `utils/pagination.js`, used by both `detectCategory.js` and `domFetcher.js`.
>
> **Added: per-job description fetch.** `extractJobs()` only ever produces `title`/`location`/`url`
> from the listing page's own markup — there is no description text on the listing page to scrape.
> Since every DOM-scraped job carries a link to its own detail page, `domFetcher.js` now fetches
> each job's `url` (plain `fetch` + `cheerio`, not Playwright — job detail pages have rendered
> statically in testing even for companies whose *listing* page needs JS, e.g. Airbnb) and takes
> the page's `<main>` (or `<body>` if no `<main>`) text, with `script`/`style`/`noscript`/`nav`/
> `header`/`footer` stripped first, as `description`. Fetches run concurrency-limited (5 at a time)
> to avoid hammering the target site. Since descriptions rarely change once a posting is live,
> `db/client.js` exposes `getJobDescriptions(companyId)` to look up already-saved descriptions by
> `jobId`, and jobs that already have one reuse it instead of re-fetching their detail page on
> every daily run — only genuinely new postings pay the fetch cost.

**Re-discovery trigger:**
- `consecutiveZeroDays >= 3` → set `flaggedForRediscovery = 1`, log a warning
- Re-run discovery for that company only, update stored selectors, reset counter

---

## Database Schema (SQLite via `better-sqlite3`)

Database file: `jobs_pipeline.db`

```sql
CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    careersUrl TEXT,
    discoveryMethod TEXT,          -- 'pattern', 'homepage_link'
    discoveryStatus TEXT DEFAULT 'pending',  -- 'pending', 'active', 'failed'
    category TEXT CHECK(category IN ('ats', 'xhr', 'dom')),

    -- ATS fields
    atsPlatform TEXT,
    atsSlug TEXT,

    -- XHR fields
    xhrEndpoint TEXT,
    xhrHeaders TEXT,               -- JSON string
    xhrParams TEXT,                -- JSON string

    -- DOM fields
    selectorTitle TEXT,
    selectorLocation TEXT,
    selectorLink TEXT,
    requiresJs INTEGER DEFAULT 0,

    -- Health tracking
    lastDiscoveryDate TEXT,
    lastRunDate TEXT,
    consecutiveZeroDays INTEGER DEFAULT 0,
    flaggedForRediscovery INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    companyId INTEGER NOT NULL,
    jobId TEXT NOT NULL,
    title TEXT,
    location TEXT,
    url TEXT,
    description TEXT,
    techStackTags TEXT,            -- JSON array e.g. ["Python","Kafka","k8s"]
    dateFirstSeen TEXT,
    dateLastSeen TEXT,
    isActive INTEGER DEFAULT 1,
    UNIQUE(companyId, jobId),
    FOREIGN KEY(companyId) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS daily_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    companyId INTEGER NOT NULL,
    snapshotDate TEXT NOT NULL,
    jobIds TEXT NOT NULL,          -- JSON array of all active job IDs that day
    FOREIGN KEY(companyId) REFERENCES companies(id)
);
```

Note: Phase 2 will add a `status` column to `jobs` (`new`, `saved`, `applied`, `dismissed`) and a `reviews` table. Design with this in mind but do not implement in Phase 1.

---

## Tech Stack

| Purpose | Library | Notes |
|---|---|---|
| Database | `better-sqlite3` | Synchronous SQLite driver |
| HTML parsing | `cheerio` | jQuery-like API for static pages |
| Headless browser | `playwright` | XHR interception (category detection), JS-rendered DOM fetches — not used for URL discovery |
| HTTP requests | Node built-in `fetch` | Node 20+ built-in, no package needed |
| Scheduling | `cron` (system) | Set up after scripts are stable |

```bash
npm install better-sqlite3 cheerio playwright
npx playwright install chromium
```

---

## Keyword Filter List

Edit this before the first run. Jobs are tagged and surfaced only if the full description contains at least one of these (case-insensitive).

```js
// config.js
export const STACK_KEYWORDS = [
  "Python", "Kafka", "Kubernetes", "k8s", "Spark",
  "dbt", "Airflow", "PostgreSQL", "Redis", "Go", "Rust",
  "Flink", "Snowflake", "BigQuery", "Databricks", "Terraform",
  "FastAPI", "Django", "React", "TypeScript", "GraphQL"
];
```

---

## Batch Input File Format

Plain text file, one company name per line, no headers, no formatting:

```
# companies.txt
Stripe
Notion
Retool
Linear
Vercel
Anthropic
PlanetScale
Figma
```

Lines starting with `#` are treated as comments and skipped. Blank lines are skipped.

---

## File Structure

```
job_pipeline/
├── package.json
├── config.js                        # Keywords, DB path, constants
├── schema.sql                       # SQL to create all three tables
├── jobs_pipeline.db                 # SQLite DB (auto-created on first run)
├── companies.txt                    # Your input list of company names
│
├── db/
│   └── client.js                    # better-sqlite3 connection + all query helpers
│
├── discovery/
│   ├── findCareersPage.js           # Step 0: 3-strategy URL discovery
│   ├── detectCategory.js            # Step 1: ATS / XHR / DOM detection
│   └── runDiscovery.js              # Orchestrates Step 0 → Step 1 → store config
│
├── fetchers/
│   ├── atsFetcher.js                # Greenhouse, Lever, Ashby API calls
│   ├── xhrFetcher.js                # Replays saved XHR endpoints via fetch
│   └── domFetcher.js                # Static (fetch + cheerio) and JS (Playwright)
│
├── utils/
│   ├── keywords.js                  # Keyword matching and tag extraction
│   └── diff.js                      # Job ID diffing and snapshot management
│
├── discoveryAgent.js                # CLI entry point for discovery
├── dailyRunner.js                   # CLI entry point for daily runs
└── logs/
    ├── daily.log
    └── errors.log
```

Phase 2 adds:
```
├── server/
│   ├── index.js                     # Express server
│   └── routes/
│       ├── jobs.js
│       └── companies.js
└── ui/
    └── index.html                   # Single-page UI
```

---

## Build Order (Phase 1)

Build and verify each step before moving to the next.

**Step 1 — Schema and DB client**
- Create `schema.sql`
- Create `db/client.js` with `better-sqlite3` and these helpers:
  - `insertCompany(data)`, `getCompanies()`, `getCompanyById(id)`, `updateCompany(id, data)`
  - `insertJob(data)`, `getJobsByCompany(companyId)`, `getJobDescriptions(companyId)` — returns a
    `Map<jobId, description>` of already-saved, non-empty descriptions, used by `domFetcher.js` to
    skip re-fetching a job's detail page once its description is already known
  - `saveSnapshot(companyId, date, jobIds)`, `getLastSnapshot(companyId)`
  - `incrementZeroDays(companyId)`, `resetZeroDays(companyId)`, `flagForRediscovery(companyId)`
- On first import, auto-create the DB file and run `schema.sql` if tables don't exist

**Step 2 — Career page discovery (`discovery/findCareersPage.js`)**
- Implement both strategies as described in Step 0 above
- Export a single function: `findCareersPage(companyName)` → returns `{ url, method }` or `null`
- Test with 5–6 companies of varying types before moving on

**Step 3 — Category detection (`discovery/detectCategory.js`)**
- Export a single function: `detectCategory(careersUrl)` → returns `{ category, config }` where config contains all the fields needed to populate the `companies` table for that category
- Test ATS detection first, then XHR, then DOM

**Step 4 — Discovery orchestrator (`discovery/runDiscovery.js`) + CLI**
- Chains `findCareersPage` → `detectCategory` → `insertCompany` → initial fetch
- `discoveryAgent.js` CLI:
  - `node discoveryAgent.js --name "Stripe"` — single company
  - `node discoveryAgent.js --batch companies.txt` — process entire file
  - `node discoveryAgent.js --name "Acme" --url "https://acme.com/careers" --rediscover` — force re-discovery with known URL
- Batch mode: process companies sequentially, log progress, never stop on a single failure
- Print a clear summary at the end: how many succeeded, failed, and what category each was assigned

**Step 5 — ATS fetcher + daily runner (ATS only)**
- Implement `fetchers/atsFetcher.js` for Greenhouse, Lever, Ashby
- Implement `dailyRunner.js` for ATS companies only
- Wire in keyword filtering (`utils/keywords.js`) and diffing (`utils/diff.js`)
- Get this stable before adding XHR and DOM

**Step 6 — XHR fetcher**
- Implement `fetchers/xhrFetcher.js`
- Extend `dailyRunner.js` to handle XHR companies

**Step 7 — DOM fetcher**
- Implement `fetchers/domFetcher.js` with both static and JS-rendered paths
- Add zero-day counter logic and re-discovery flagging to `dailyRunner.js`

**Step 8 — Cron setup**
- Once daily runner is stable across all three categories:
```bash
0 8 * * * cd /path/to/job_pipeline && node dailyRunner.js >> logs/daily.log 2>&1
```

---

## CLI Usage Reference

```bash
# Add a single company (agent finds the careers page automatically)
node discoveryAgent.js --name "Stripe"

# Process a full list of company names
node discoveryAgent.js --batch companies.txt

# Force re-discovery for a broken company (URL already known)
node discoveryAgent.js --name "Acme Corp" --url "https://acme.com/careers" --rediscover

# Run the daily pipeline
node dailyRunner.js
```

**Expected batch discovery output:**
```
[2026-07-02] Processing 6 companies...
  Stripe        → found via pattern         → ats/greenhouse   ✓
  Notion        → found via pattern         → ats/notion       ✓
  Retool        → found via homepage_link   → xhr              ✓
  Linear        → found via pattern         → ats/ashby        ✓
  Vercel        → found via pattern         → dom/js           ✓
  Acme Corp     → discovery failed          → skipped          ✗

Done. 5 succeeded, 1 failed. See logs/errors.log for details.
```

**Expected daily runner output:**
```
[2026-07-02] Running pipeline for 5 companies...
  Stripe        (ats/greenhouse)   47 active, 2 new
  Notion        (ats/lever)        23 active, 0 new
  Retool        (xhr)              31 active, 1 new
  Linear        (ats/ashby)        18 active, 0 new
  Vercel        (dom/js)           12 active, 0 new

Done. 3 new jobs found today.
```

---

## Error Handling Rules

- Never let one company failure crash a batch run — wrap each in try/catch, log and continue
- Log all errors with timestamp and company name to `logs/errors.log`
- HTTP errors (4xx, 5xx) count as a zero-result day, not a crash
- Playwright launch failures: log and skip that company for the day
- Discovery failures: mark `discoveryStatus = 'failed'` in DB, log reason, move on

---

## Phase 2 Preview (Do Not Build Yet)

Phase 2 adds a local web app at `localhost:3000`:
- Filterable job table (by company, tech stack tag, date, status)
- Add companies and trigger discovery from the UI
- Mark jobs as `saved`, `applied`, or `dismissed`
- Dashboard: new jobs today, companies tracked, health status per company

Requires: adding `status TEXT DEFAULT 'new'` column to `jobs` table, an Express server, and a single-page UI. Phase 1 pipeline scripts are unchanged — the server reads and writes to the same SQLite DB.

---

## Constraints and Notes

- ES Modules throughout — `"type": "module"` in `package.json`
- `better-sqlite3` is synchronous — do not wrap in Promises or async/await
- Playwright only runs during: XHR interception during category detection and `requiresJs = true` DOM fetches — never for ATS or XHR daily runs, and never for URL discovery
- All timestamps: ISO 8601 strings (`2026-07-02T08:00:00`)
- Deduplication key: always `(companyId, jobId)` — never title or URL
- Store full raw job description text in `description` wherever available. For ATS/XHR companies
  this comes from the platform's own API response; for DOM companies it's fetched from each job's
  own detail-page URL (see the "per-job description fetch" note under Category 3) since listing
  pages don't carry description text themselves.
- `config.js` is the single source of truth for keywords, DB path, and constants
- Batch mode processes companies sequentially, not in parallel — keeps Playwright usage predictable and avoids hammering servers
