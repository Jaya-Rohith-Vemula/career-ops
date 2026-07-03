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
- **No cloud services, no paid APIs.** Everything runs locally. Playwright is used for web search fallback and browser-dependent scraping.
- **One language end to end.** JavaScript (Node.js 20+) for everything in Phase 1, extended with Express and a browser UI in Phase 2.

---

## Runtime and Package Manager

- **Node.js v20+** (LTS) — built-in `fetch`, no polyfill needed
- **npm** for package management
- **ES Modules** — set `"type": "module"` in `package.json`, use `import`/`export` throughout

---

## Step 0 — Career Page Discovery (NEW — runs before everything else)

This step is the entry point for every new company. Given only a company name, the agent finds the correct careers page URL automatically using a three-strategy fallback chain. It stops as soon as one strategy succeeds.

### Strategy 1 — Common URL pattern probing (instant, no browser)

Derive the likely domain from the company name (e.g. `Stripe` → `stripe.com`) and probe these patterns in order using HTTP HEAD requests. Stop at the first 200 response:

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

Domain derivation: lowercase the company name, strip punctuation, append `.com`. For companies with known non-.com domains, Strategy 2 or 3 will catch them.

If a HEAD request returns 200 → store that URL, mark discovery method as `pattern`, move to category detection.

### Strategy 2 — Homepage link scraping (one page fetch, no browser)

Fetch the company's main homepage (`https://{domain}`) using built-in `fetch`. Parse the HTML with `cheerio`. Look for anchor tags whose `href` or inner text contains any of:

```
careers, jobs, hiring, join us, join our team, we're hiring, work with us, work here, open roles, open positions
```

If a matching link is found → follow it (handle redirects), confirm it resolves to a valid page, store the URL, mark discovery method as `homepage_link`.

### Strategy 3 — Web search via Playwright (browser, fallback only)

Only runs if Strategies 1 and 2 both fail. Launch a headless Chromium instance via Playwright, navigate to `https://duckduckgo.com`, search for:

```
"{company name}" careers jobs
```

Extract the first 3 result URLs. For each, check if it looks like a careers page (contains `careers`, `jobs`, `greenhouse`, `lever`, `ashby`, `workday` in the URL or page title). Take the best match, store the URL, mark discovery method as `web_search`.

If no result looks like a careers page → mark company as `discovery_failed`, log it, skip to the next company. Never crash the batch run.

### Discovery result stored in DB

After any successful strategy, store:
- The confirmed careers page URL
- The discovery method used (`pattern`, `homepage_link`, `web_search`)
- The timestamp

Then immediately pass the URL to Step 1 (category detection).

---

## Step 1 — Category Detection

Given the confirmed careers page URL, detect which of the three categories it belongs to.

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
    discoveryMethod TEXT,          -- 'pattern', 'homepage_link', 'web_search'
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
| Headless browser | `playwright` | Discovery, XHR interception, JS-rendered pages, web search fallback |
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
  - `insertJob(data)`, `getJobsByCompany(companyId)`
  - `saveSnapshot(companyId, date, jobIds)`, `getLastSnapshot(companyId)`
  - `incrementZeroDays(companyId)`, `resetZeroDays(companyId)`, `flagForRediscovery(companyId)`
- On first import, auto-create the DB file and run `schema.sql` if tables don't exist

**Step 2 — Career page discovery (`discovery/findCareersPage.js`)**
- Implement all three strategies as described in Step 0 above
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
  Vercel        → found via web_search      → dom/js           ✓
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
- Playwright only runs during: Strategy 3 URL discovery, XHR interception, `requiresJs = true` DOM fetches — never for ATS or XHR daily runs
- All timestamps: ISO 8601 strings (`2026-07-02T08:00:00`)
- Deduplication key: always `(companyId, jobId)` — never title or URL
- Store full raw job description text in `description` wherever available
- `config.js` is the single source of truth for keywords, DB path, and constants
- Batch mode processes companies sequentially, not in parallel — keeps Playwright usage predictable and avoids hammering servers
