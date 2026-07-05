# Careers Scraper / Job Pipeline

Tracks job postings across a list of companies: discovers each company's careers
page and how it publishes jobs, then runs daily to fetch new postings, diff them
against what's already known, and store them in SQLite. Includes a dashboard
(Express API + React UI) for browsing jobs, managing companies, and triggering
runs, plus an AI-assisted resume tailoring tool.

## Requirements

- Node.js 23+ (needed for `better-sqlite3` native compilation and `process.loadEnvFile`)
- Xcode Command Line Tools (macOS) — required to compile `better-sqlite3`
- `pandoc` installed, if you want to use resume tailoring (used to convert the tailored Markdown to `.docx`)
- An agent CLI installed and authenticated, if you want to use resume tailoring — `resume/tailorResume.js` shells out to one non-interactively rather than calling a model API directly. Supported today: [Claude Code CLI](https://claude.com/claude-code) (`claude`, the default) and [Codex CLI](https://github.com/openai/codex) (`codex`); pick which one with `AGENT_CLI` (see below)

## Setup

```bash
npm install                # installs root deps; compiles better-sqlite3
npm --prefix ui install    # installs UI deps
```

Create a `.env` file in the project root:

```bash
PORT=3000                  # port for the Express server
YC_COMPANIES_URL=          # source URL for YC company directory import
BUILTIN_JOBS_URL=          # source URL for Built In company import
RESUME_DOCUMENT_NAME=      # output filename (no extension) for tailored resumes
AGENT_CLI=                 # which agent CLI to shell out to for resume tailoring: "claude" (default) or "codex"
```

`PORT` is required to start the server; the others are only needed if you use
those specific features (YC import, Built In import, resume tailoring).

The SQLite database (`jobs_pipeline.db`) and its tables are created
automatically on first run — no manual migration step needed.

## Running the pipeline (CLI)

Discovery is a one-time step per company; it figures out the careers page URL
and how the site publishes jobs (ATS API, XHR endpoint, or static/JS-rendered
DOM), then stores that config in the DB.

```bash
node discoveryAgent.js --name "Stripe"                     # discover one company
node discoveryAgent.js --batch companies.txt                # discover a list (one company name per line)
node discoveryAgent.js --name "Acme" --url "https://acme.com/careers" --rediscover
```

The daily runner replays each company's stored config, fetches current
postings, diffs against the last snapshot, and inserts new jobs:

```bash
node dailyRunner.js
```

Companies that return zero new jobs three days running are automatically
flagged and re-discovered on the next run.

Set up `node dailyRunner.js` as a daily cron job / scheduled task if you want
it to run unattended.

## Running the dashboard

```bash
npm run dev
```

This starts the Express API (`:3000`, or whatever `PORT` is set to) and the
Vite dev server (`:5173`, proxying `/api` to the Express server) together.
Open `http://localhost:5173`.

Individual pieces:

```bash
npm run server              # API only
npm --prefix ui run dev     # UI dev server only
```

For a production-style build, the Express server serves the built UI directly:

```bash
npm --prefix ui run build   # outputs to ui/dist
npm run server               # serves ui/dist + /api on PORT
```

From the dashboard you can:
- Trigger discovery/daily runs as background jobs (one at a time — a second
  trigger while one is running gets a 409, since both scripts write to the
  same SQLite file)
- Browse/filter jobs and update their status (new/saved/applied/dismissed)
- Manage companies, import from YC's directory or Built In, configure
  location/keyword filters
- Generate a tailored resume for a specific job listing

## Resume tailoring

Requires an agent CLI installed and authenticated (Claude Code CLI by default,
or Codex CLI — see `AGENT_CLI` above), `pandoc` installed, and
`RESUME_DOCUMENT_NAME` set in `.env`. Put your base resume at
`resume/base_resume.md` and a reference DOCX for formatting at
`resume/reference.docx`, then trigger tailoring from the UI's job detail view,
or run:

```bash
node resume/tailorResume.js --companyId=<id> --jobId=<jobId>
```

Output is written under `resume/output/`. To use Codex instead of Claude Code:

```bash
AGENT_CLI=codex node resume/tailorResume.js --companyId=<id> --jobId=<jobId>
```

`tailorResume.js` doesn't call any model API directly — it shells out to
whichever CLI is selected and reads its stdout as the tailored resume text.
Adding support for another non-interactive agent CLI just means adding an
entry to the `AGENT_CLIS` map at the top of `resume/tailorResume.js` with the
binary name and how it takes a prompt.

## Other scripts

```bash
node exportJobs.js          # export jobs to CSV (all_jobs_export.csv)
node scrapeBuiltin.js        # standalone Built In scrape
```

## Notes

- No test runner is configured — verify behavior by running the CLI entry
  points directly.
- `config.js` is the source of truth for `DB_PATH` and `STACK_KEYWORDS`
  (technologies flagged when matching jobs) — edit it before your first run.
- See `CLAUDE.md` for architecture details (discovery flow, fetcher
  categories, DB access patterns) if you're extending the pipeline.
