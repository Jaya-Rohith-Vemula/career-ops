# Features

## Discovery (`discoveryAgent.js`, `discovery/`)
- Single-company discovery (`--name`) and batch discovery from a file (`--batch companies.txt`)
- Careers-page URL discovery, two strategies (`findCareersPage.js`):
  1. URL pattern probing (`careers.{domain}`, `{domain}/jobs`, `{domain}/work-with-us`, etc.)
  2. Homepage link scraping (keyword match on link text: "careers", "hiring", "join us", etc.)
  - Both strategies verify the resolved URL still points at the target company's domain (anti-squatting check)
  - No web-search fallback by design; unresolved companies flagged for manual entry
- Careers page category detection (`detectCategory.js`) into one of three types:
  - `ats` — Greenhouse / Lever / Ashby, detected via embed script / API URL pattern, fetched through public JSON APIs
  - `xhr` — Workday/iCIMS-style boards, detected by intercepting XHR calls during a headless page load, replayed by URL on subsequent runs
  - `dom` — proprietary/static pages, scraped via fetch+cheerio, or Playwright if the page requires JS rendering
  - Filters out known non-job third-party JSON responses (OneTrust, FullStory, Hotjar, GTM, etc.) so they aren't misdetected as job APIs
  - Pagination detection (`utils/pagination.js`) for DOM sources with "next page" controls
- `--rediscover` flag to re-run discovery against a company that already exists, optionally supplying a new `--url`
- Stores per-company config in SQLite: category, ATS platform/slug, XHR endpoint, JS-rendering requirement, discovery status

## Daily pipeline (`dailyRunner.js`, `fetchers/`)
- Reads each company's stored config and replays the matching fetcher (`atsFetcher.js` / `xhrFetcher.js` / `domFetcher.js`)
- Diffs newly fetched job IDs against the last saved snapshot to detect new/removed postings
- Inserts new jobs, deactivates jobs no longer listed, keyed by `(companyId, jobId)` (never title/URL)
- Tech-stack tagging: matches job titles/descriptions against configurable keywords (`STACK_KEYWORDS` in `config.js`)
- Self-healing: after 3 consecutive zero-result days, flags a company `flaggedForRediscovery` and automatically re-runs discovery for it, resetting the counter on success
- Can be scoped to a subset of companies via `--ids`
- Sequential (non-parallel) batch execution to keep Playwright usage predictable
- Logs daily run activity and errors (`utils/logger.js`)

## Data layer (`db/client.js`, SQLite via `better-sqlite3`)
- Companies: insert/get/update/delete, lookup by id or name
- Jobs: insert, upsert, list by company, filtered/paginated listing (`getJobs`/`countJobs` — filter by company, status, tag, active/inactive, text search), status updates
- Snapshots: save/retrieve last known job-ID set per company (for diffing)
- Zero-day tracking: increment/reset counter, flag for rediscovery
- Dashboard aggregate stats (`getDashboardStats`)
- All timestamps stored as ISO 8601 strings

## CSV export (`exportJobs.js`)
- Dumps all companies' jobs to `all_jobs_export.csv` (company, jobId, title, location, tech tags, url, active flag, first/last seen dates)

## Company sourcing imports (`server/routes/yc.js`, `server/routes/builtin.js`, `sources/builtin.js`)
Two independent scrapers feed candidate companies into the same review-and-import UI flow (see **Import Companies** below); neither trigger discovery directly — imported companies land as `pending` and go through the normal add/rediscover flow afterward.

**YC directory import** (`discovery/scrapeYC.js`, `server/routes/yc.js`)
- Fetches the YC company directory (ycombinator.com/companies) by calling the same Algolia search endpoint the site's own frontend uses — no DOM scraping or headless browser
- Single request (`hitsPerPage: 1000`) returns the full filtered result set (default filter: US/Remote regions, team size 50+)
- `GET /api/yc/companies` — run the scrape, return the list (name, website, batch, team size, industry, YC profile URL)
- `POST /api/yc/companies/import` — insert selected companies into the `companies` table as `pending` (deduped by name against existing companies)
- Also runnable standalone: `node discovery/scrapeYC.js > yc_companies.json`

**Built In directory import** (`scrapeBuiltin.js`, `sources/builtin.js`, `server/routes/builtin.js`)
- Scrapes company names off Built In's engineering job listings (`builtin.com`) — the list renders fully server-side, so it's plain `fetch` + cheerio, no Playwright; paginates via a `page` query param until a page returns no job cards (capped at `MAX_PAGES`)
- Reads company names from `[data-id="job-card"] [data-id="company-title"]`, deduped via a `Set`
- Runs as a background subprocess (like discovery/daily runs) through the shared `runManager.js`, so it's start/poll/stop just like other runs — one at a time app-wide
- `POST /api/sourcing/builtin` — start a scrape run (background subprocess, 409 if one's already active)
- `GET /api/sourcing/builtin/active`, `GET /api/sourcing/builtin/:id` — poll run status/output
- `POST /api/sourcing/builtin/import` — insert selected companies as `pending` (deduped by name)
- Also runnable standalone: `node scrapeBuiltin.js`

## Resume tailoring (`resume/tailorResume.js`, `server/routes/resume.js`, `server/resumeManager.js`)
- Rewrites a base resume (`resume/base_resume.md`) into a job-specific version for a given `(companyId, jobId)`, driven by a detailed prompt covering formatting, keyword coverage, and plausibility rules
- Agent-CLI agnostic: shells out to whichever non-interactive agent CLI is selected via `AGENT_CLI` (`claude` by default, or `codex`) rather than being hardcoded to one harness — new CLIs can be added to the `AGENT_CLIS` map in `tailorResume.js`
- Converts the tailored Markdown to `.docx` via `pandoc`, using `resume/reference.docx` for formatting if present
- Runnable standalone (`node resume/tailorResume.js --companyId=<id> --jobId=<jobId>`) or triggered from the UI, which runs it as a background subprocess via `resumeManager.js`
- `POST /api/resume/tailor` — start a tailor run; `GET /api/resume/tailor/:runId` — poll status/output; `GET /api/resume/tailor/:runId/download` — download the resulting `.docx`

## Dashboard web app (`server/`, `ui/`)
Express API (`server/index.js`, serves built `ui/dist` in production) + React/Vite SPA.

**API routes:**
- `GET/POST /api/companies` — list companies; add a company (triggers a background discovery run)
- `POST /api/companies/:id/rediscover` — re-run discovery for an existing company
- `DELETE /api/companies/:id` — remove a company and its jobs (blocked while a run is active)
- `GET /api/jobs` — filtered/paginated job listing (company, status, tag, active/inactive, search, limit/offset)
- `PATCH /api/jobs/:companyId/:jobId/status` — set job status (`yet_to_apply` / `applied` / `not_related`)
- `POST /api/runs/daily` — trigger a daily run (optionally scoped to selected company IDs)
- `GET /api/runs/active`, `GET /api/runs/:id` — poll run status/output
- `POST /api/runs/:id/stop` — cancel a running job
- `GET /api/stats` — dashboard tiles + per-company health summary

**Run management (`server/runManager.js`):**
- Spawns `discoveryAgent.js` / `dailyRunner.js` as background subprocesses
- Enforces one run at a time across the whole app (second trigger gets HTTP 409) since both scripts share the same SQLite file
- Streams run output; supports stopping an in-progress run

**UI pages:**
- **Dashboard** — stat tiles (new jobs today, companies tracked, needs attention, active jobs); add-company form (name + optional URL); per-company table (category, discovery status, last run, zero-days, flagged state, careers URL) with inline rediscover and delete; multi-select companies + "run daily now" for a subset; live run output panel with stop/dismiss; auto-refreshes when a run finishes
- **Jobs** — filter by company, status, tag, search text, active-only/inactive-only; default split view (To Apply / Applied / Not Related as collapsible sections, each independently paginated) or single filtered/paginated list when a status filter is chosen; per-row checkboxes to mark a job Applied or Not Related; legacy status values (`new`/`saved`/`dismissed`) normalized to the current taxonomy
- **Import Companies** (`/import`, was `/yc-import`) — tabbed page hosting both sourcing scrapers side by side: "YC Import" and "Built In" tabs, each with its own scrape/poll/select/import flow. Both tabs share a `RunOutputPanel` component (run status line, dismiss button, live output `<pre>`) factored out for reuse across background-run UIs
