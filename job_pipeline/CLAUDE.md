# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                        # install deps (better-sqlite3 compiles natively — Node 23 + CLT required)
node discoveryAgent.js --name "Stripe"          # discover single company
node discoveryAgent.js --batch companies.txt    # discover from file
node discoveryAgent.js --name "Acme" --url "https://acme.com/careers" --rediscover
node dailyRunner.js                             # run daily pipeline
```

No test runner is configured yet. Verify behavior by running the CLI entry points directly.

## Architecture

Two CLI entry points orchestrate the pipeline:

- **`discoveryAgent.js`** — one-time setup per company: finds the careers page URL, detects how it works, stores config in SQLite
- **`dailyRunner.js`** — daily execution: reads stored config, replays the appropriate fetch, diffs against the last snapshot, inserts new jobs

**Discovery flow** (`discovery/`):
1. `findCareersPage.js` — two-strategy URL discovery (URL pattern probing → homepage link scraping). Both strategies verify the resolved URL still resolves to the target company's domain before accepting a match, to avoid false positives from squatted/unrelated domains. Companies where both strategies fail return `null` and should be flagged for manual entry — there is no web-search fallback (search engines block headless scraping).
2. `detectCategory.js` — classifies the careers page into one of three categories
3. `runDiscovery.js` — chains steps 1→2→DB insert→initial fetch

**Three company categories** determine how daily fetches work:
- `ats` — Greenhouse/Lever/Ashby: call their public JSON API directly (`fetchers/atsFetcher.js`)
- `xhr` — Workday/iCIMS/etc: replay a saved XHR endpoint via `fetch` (`fetchers/xhrFetcher.js`)
- `dom` — proprietary pages: `fetch`+cheerio for static, Playwright for JS-rendered (`fetchers/domFetcher.js`)

**Playwright** is used only for: XHR interception during category detection and `requiresJs=true` DOM fetches. Never for ATS or XHR daily runs, and never for URL discovery.

**`db/client.js`** — all SQLite access goes through this module. `better-sqlite3` is synchronous; never wrap its calls in async/await. The DB and tables are auto-created on first import.

**`config.js`** — single source of truth for `DB_PATH` and `STACK_KEYWORDS`. Edit keywords here before first run.

**Self-healing:** `consecutiveZeroDays >= 3` triggers `flaggedForRediscovery = 1` on a company; `dailyRunner.js` re-runs discovery for that company and resets the counter.

## Key Constraints

- ES Modules throughout (`"type": "module"` in package.json) — use `import`/`export`, not `require`
- `better-sqlite3` is synchronous — no `async/await` in DB calls
- Batch runs process companies sequentially (not parallel) to keep Playwright predictable
- Deduplication key is always `(companyId, jobId)` — never title or URL
- All timestamps are ISO 8601 strings
- Phase 2 (Express server + UI) will add a `status` column to `jobs` and read the same DB — don't break that forward-compatibility
