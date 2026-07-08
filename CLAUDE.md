# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                        # install deps (better-sqlite3 compiles natively — Node 23 + CLT required)
node discoveryAgent.js --name "Stripe"          # discover single company
node discoveryAgent.js --batch companies.txt    # discover from file
node discoveryAgent.js --name "Acme" --url "https://acme.com/careers" --rediscover
node dailyRunner.js                             # run daily pipeline

# Phase 2 — dashboard (Express API + React UI), served at localhost:3000
npm run dev                        # server (:3000) + Vite dev server (:5173, proxies /api) together
npm run server                     # API only
npm --prefix ui run build          # production build; server/index.js then serves ui/dist

# Resume tailoring — full-time (DB-driven, from a discovered job)
node resume/FT/tailorResume.js --companyId=<id> --jobId=<id>

# Resume tailoring — full-time (manual JD, no DB): paste the raw JD into resume/FT/current-jd.txt, then:
npm run resume:ft
# title/company are read from "Job Title:"/"Company:" lines if present, else inferred from the JD text via the agent CLI; override with: npm run resume:ft -- --title="..." --company="..."

# Resume tailoring — C2C (manual JD, no DB, no client name yet): paste JD (with a "Job Title:" line) into resume/C2C/current-jd.txt, then:
npm run resume:c2c
# title is auto-extracted from the "Job Title:" line in the JD; override with: npm run resume:c2c -- --title="..."
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

**Phase 2 dashboard** (`server/`, `ui/`): `server/index.js` is an Express app serving `/api/*`
(routes in `server/routes/`: `jobs.js`, `companies.js`, `runs.js`, `stats.js`) plus the built
`ui/dist` static files. `server/runManager.js` spawns `discoveryAgent.js`/`dailyRunner.js` as
background subprocesses and enforces one run at a time. `ui/` is a separate Vite + React app
(own `package.json`) with pages for Dashboard/Jobs/Companies; `npm run dev` in `ui/` proxies
`/api` to the Express server for local development.

**Self-healing:** `consecutiveZeroDays >= 3` triggers `flaggedForRediscovery = 1` on a company; `dailyRunner.js` re-runs discovery for that company and resets the counter.

**Resume tailoring** (`resume/`): three independent pipelines under two folders (`resume/FT/` for full-time, `resume/C2C/` for corp-to-corp), all call out to an agent CLI (`AGENT_CLI` env, default `claude`) with a single prompt and pipe the markdown response through `pandoc` to `.docx`.
- **Full-time, DB-driven** (`resume/FT/tailorResume.js`): takes `--companyId`/`--jobId`, pulls the job description via `getJob()`, rewrites `resume/FT/base_resume.md` (a fully-written resume) to fit that JD, styled with `resume/FT/reference.docx`. Triggered from the UI via `server/resumeManager.js` (`startTailorRun`/`getTailorRun`). Output goes to `resume/FT/output/<companySlug>-<titleSlug>-<jobIdSlug>/`.
- **Full-time, manual JD** (`resume/FT/tailorResumeFromJD.js`): same base resume/prompt/rules as the DB-driven version, but no DB lookup — paste a raw job description into the fixed inbox file `resume/FT/current-jd.txt`, then run `npm run resume:ft` with no args. Title/company are regex-extracted from "Job Title:"/"Company:" lines if present; if absent, the single tailoring prompt also asks the model to infer them from the JD text and emit a `<<<JOB_META>>>` trailer after the resume, which is parsed out and stripped before saving (one agent call total, not two). Override either with `--title="..."`/`--company="..."`. Requires `RESUME_DOCUMENT_NAME` in `.env` like the DB-driven version. Output goes to `resume/FT/output/<companySlug>-<titleSlug>-<local-timestamp>/`.
- **C2C** (`resume/C2C/tailorResumeC2C.js`): manual/no-DB, no client name required — you paste a job description (with a "Job Title:" line) into the fixed inbox file `resume/C2C/current-jd.txt`, then run the script with no args; the title is regex-extracted from that line (override with `--title="..."` if the JD has no such line). It fills the curly-brace placeholders in `resume/C2C/base_resume_c2c.md` (a template, not a filled-in resume — different contact info/name than the full-time resume) fresh from that JD each run, styled with `resume/C2C/reference.docx`. Output is always named `Jaya Senior Developer.md`/`.docx`, written to `resume/C2C/output/<local-timestamp>/` (folder named by local run time, e.g. `2026-07-05_14-32-05`).

## Key Constraints

- ES Modules throughout (`"type": "module"` in package.json) — use `import`/`export`, not `require`
- `better-sqlite3` is synchronous — no `async/await` in DB calls
- Batch runs process companies sequentially (not parallel) to keep Playwright predictable
- Deduplication key is always `(companyId, jobId)` — never title or URL
- All timestamps are ISO 8601 strings
- Phase 2 (Express server + UI, `server/` + `ui/`) is now built: `status` column (`new`/`saved`/`applied`/`dismissed`) added to `jobs`, `db/client.js` gained `getJobs`/`countJobs`/`updateJobStatus`/`getDashboardStats`. The server reads/writes the same `jobs_pipeline.db` — Phase 1 CLI scripts are unchanged. Discovery/daily runs are triggered from the UI as background subprocesses (`server/runManager.js`), one at a time (second trigger while one is active gets a 409) since both scripts write to the same SQLite file and aren't safe to run concurrently.
