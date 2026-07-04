import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { DB_PATH, STACK_KEYWORDS } from '../config.js';
import { todayLocalDate, nowLocalIso } from '../utils/time.js';
import { US_SIGNALS, INTERNATIONAL_SIGNALS } from './locationSignalsSeed.js';
import { resolveLocationBucket } from '../utils/location.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../schema.sql'), 'utf8');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(schema);

const jobColumns = db.prepare('PRAGMA table_info(jobs)').all().map((c) => c.name);
if (!jobColumns.includes('status')) {
  db.exec("ALTER TABLE jobs ADD COLUMN status TEXT DEFAULT 'new'");
}
if (!jobColumns.includes('locationBucketOverride')) {
  db.exec('ALTER TABLE jobs ADD COLUMN locationBucketOverride TEXT');
}

// Matches a keyword as a whole token — bounded by non-alphanumeric characters
// or string edges — so "Go" doesn't match inside "negotiate" and "C++"/"C#"
// match on their exact punctuation rather than as a plain substring.
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenRegex(term) {
  return new RegExp(`(^|[^a-zA-Z0-9])${escapeRegex(term)}([^a-zA-Z0-9]|$)`, 'i');
}

export function matchesToken(text, term) {
  if (!text) return false;
  return tokenRegex(term).test(text);
}

const matchesKeyword = matchesToken;

db.function('keyword_match', (description, keyword) => (matchesKeyword(description, keyword) ? 1 : 0));

// --- Companies ---

export function insertCompany(data) {
  const cols = Object.keys(data);
  const placeholders = cols.map(c => `@${c}`).join(', ');
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO companies (${cols.join(', ')}) VALUES (${placeholders})`
  );
  const result = stmt.run(data);
  if (result.lastInsertRowid) return result.lastInsertRowid;
  return db.prepare('SELECT id FROM companies WHERE name = @name').get({ name: data.name })?.id;
}

export function getCompanies() {
  return db.prepare('SELECT * FROM companies').all();
}

export function getCompanyById(id) {
  return db.prepare('SELECT * FROM companies WHERE id = ?').get(id);
}

export function getCompanyByName(name) {
  return db.prepare('SELECT * FROM companies WHERE name = ?').get(name);
}

export function updateCompany(id, data) {
  const cols = Object.keys(data);
  const setClause = cols.map(c => `${c} = @${c}`).join(', ');
  db.prepare(`UPDATE companies SET ${setClause} WHERE id = @id`).run({ ...data, id });
}

export const deleteCompany = db.transaction((id) => {
  db.prepare('DELETE FROM jobs WHERE companyId = ?').run(id);
  db.prepare('DELETE FROM daily_snapshots WHERE companyId = ?').run(id);
  db.prepare('DELETE FROM companies WHERE id = ?').run(id);
});

// --- Jobs ---

export function insertJob(data) {
  const cols = Object.keys(data);
  const placeholders = cols.map(c => `@${c}`).join(', ');
  db.prepare(
    `INSERT OR IGNORE INTO jobs (${cols.join(', ')}) VALUES (${placeholders})`
  ).run(data);
}

export function getJobsByCompany(companyId) {
  return db.prepare('SELECT * FROM jobs WHERE companyId = ?').all(companyId);
}

export function getJobDescriptions(companyId) {
  const rows = db.prepare(
    "SELECT jobId, description FROM jobs WHERE companyId = ? AND description IS NOT NULL AND description != ''"
  ).all(companyId);
  return new Map(rows.map((r) => [r.jobId, r.description]));
}

export function upsertJob(data) {
  const cols = Object.keys(data);
  const placeholders = cols.map(c => `@${c}`).join(', ');
  const updateCols = cols.filter((c) => c !== 'companyId' && c !== 'jobId' && c !== 'dateFirstSeen');
  const updateClause = updateCols.map((c) => `${c} = excluded.${c}`).join(', ');
  db.prepare(
    `INSERT INTO jobs (${cols.join(', ')}) VALUES (${placeholders})
     ON CONFLICT(companyId, jobId) DO UPDATE SET ${updateClause}`
  ).run(data);
}

function buildJobFilterClause(filters) {
  const clauses = [];
  const params = {};
  if (filters.companyId) {
    clauses.push('jobs.companyId = @companyId');
    params.companyId = filters.companyId;
  }
  if (filters.status === 'yet_to_apply') {
    clauses.push("(jobs.status IS NULL OR jobs.status IN ('new', 'saved', 'yet_to_apply'))");
  } else if (filters.status === 'not_related') {
    clauses.push("jobs.status IN ('dismissed', 'not_related')");
  } else if (filters.status) {
    clauses.push('jobs.status = @status');
    params.status = filters.status;
  } else {
    // default view: jobs marked not related stay in the DB (so they aren't
    // re-detected as "new" on the next run) but are hidden unless filtered for
    clauses.push("(jobs.status IS NULL OR jobs.status NOT IN ('dismissed', 'not_related'))");
  }
  if (filters.tag) {
    clauses.push('jobs.techStackTags LIKE @tag');
    params.tag = `%"${filters.tag}"%`;
  }
  if (filters.activeOnly) {
    clauses.push('jobs.isActive = 1');
  }
  if (filters.inactiveOnly) {
    clauses.push('jobs.isActive = 0');
  }
  if (filters.search) {
    clauses.push('jobs.title LIKE @search');
    params.search = `%${filters.search}%`;
  }
  if (filters.keywordFilter) {
    const enabled = getEnabledKeywords();
    if (enabled.length > 0) {
      const kwClauses = enabled.map((kw, i) => {
        params[`kw${i}`] = kw.keyword;
        return `keyword_match(jobs.description, @kw${i}) = 1`;
      });
      const clause = `(${kwClauses.join(' OR ')})`;
      clauses.push(filters.keywordMatch === false ? `NOT ${clause}` : clause);
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return { where, params };
}

function computeMatchedKeywords(description, keywords) {
  if (!description) return [];
  return keywords.filter((kw) => matchesKeyword(description, kw.keyword)).map((kw) => kw.keyword);
}

export function getJobs(filters = {}) {
  const { where, params } = buildJobFilterClause(filters);
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  const rows = db.prepare(
    `SELECT jobs.*, companies.name AS companyName
     FROM jobs JOIN companies ON companies.id = jobs.companyId
     ${where}
     ORDER BY jobs.dateFirstSeen DESC
     LIMIT @limit OFFSET @offset`
  ).all({ ...params, limit, offset });
  const enabledKeywords = getEnabledKeywords();
  const enabledSignals = filters.locationFilter ? getEnabledLocationSignals() : null;
  return rows.map((row) => ({
    ...row,
    matchedKeywords: computeMatchedKeywords(row.description, enabledKeywords),
    ...(enabledSignals ? {
      locationBucket: row.locationBucketOverride || resolveLocationBucket(row.location, row.description, enabledSignals),
    } : {}),
  }));
}

export function countJobs(filters = {}) {
  const { where, params } = buildJobFilterClause(filters);
  const row = db.prepare(
    `SELECT COUNT(*) AS count FROM jobs ${where}`
  ).get(params);
  return row.count;
}

export function updateJobStatus(companyId, jobId, status) {
  db.prepare(
    'UPDATE jobs SET status = ? WHERE companyId = ? AND jobId = ?'
  ).run(status, companyId, jobId);
}

export function setJobLocationBucketOverride(companyId, jobId, bucket) {
  db.prepare(
    'UPDATE jobs SET locationBucketOverride = ? WHERE companyId = ? AND jobId = ?'
  ).run(bucket, companyId, jobId);
}

export function getDashboardStats() {
  const today = todayLocalDate();
  const newToday = db.prepare(
    "SELECT COUNT(*) AS count FROM jobs WHERE dateFirstSeen LIKE ?"
  ).get(`${today}%`).count;
  const totalCompanies = db.prepare('SELECT COUNT(*) AS count FROM companies').get().count;
  const needsAttention = db.prepare(
    'SELECT COUNT(*) AS count FROM companies WHERE flaggedForRediscovery = 1 OR consecutiveZeroDays > 0'
  ).get().count;
  const activeJobs = db.prepare('SELECT COUNT(*) AS count FROM jobs WHERE isActive = 1').get().count;
  return { newToday, totalCompanies, needsAttention, activeJobs };
}

export function deactivateJobs(companyId, activeJobIds) {
  if (activeJobIds.length === 0) {
    db.prepare('UPDATE jobs SET isActive = 0 WHERE companyId = ?').run(companyId);
    return;
  }
  const placeholders = activeJobIds.map(() => '?').join(', ');
  db.prepare(
    `UPDATE jobs SET isActive = 0 WHERE companyId = ? AND jobId NOT IN (${placeholders})`
  ).run(companyId, ...activeJobIds);
}

// --- Snapshots ---

export function saveSnapshot(companyId, date, jobIds) {
  db.prepare(
    'INSERT INTO daily_snapshots (companyId, snapshotDate, jobIds) VALUES (?, ?, ?)'
  ).run(companyId, date, JSON.stringify(jobIds));
}

export function getLastSnapshot(companyId) {
  const row = db.prepare(
    'SELECT * FROM daily_snapshots WHERE companyId = ? ORDER BY snapshotDate DESC LIMIT 1'
  ).get(companyId);
  if (!row) return null;
  return { ...row, jobIds: JSON.parse(row.jobIds) };
}

// --- Health tracking ---

export function incrementZeroDays(companyId) {
  db.prepare(
    'UPDATE companies SET consecutiveZeroDays = consecutiveZeroDays + 1 WHERE id = ?'
  ).run(companyId);
}

export function resetZeroDays(companyId) {
  db.prepare('UPDATE companies SET consecutiveZeroDays = 0 WHERE id = ?').run(companyId);
}

export function flagForRediscovery(companyId) {
  db.prepare('UPDATE companies SET flaggedForRediscovery = 1 WHERE id = ?').run(companyId);
}

// --- Stack keywords ---

function insertKeywords(keywords) {
  const createdAt = nowLocalIso();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO stack_keywords (keyword, enabled, createdAt) VALUES (?, 1, ?)'
  );
  const insertMany = db.transaction((kws) => {
    for (const keyword of kws) insert.run(keyword, createdAt);
  });
  insertMany(keywords);
}

export function seedStackKeywordsIfEmpty() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM stack_keywords').get();
  if (count > 0) return;
  insertKeywords(STACK_KEYWORDS);
}

export function getKeywords() {
  return db.prepare('SELECT * FROM stack_keywords ORDER BY keyword ASC').all();
}

export function getEnabledKeywords() {
  return db.prepare('SELECT * FROM stack_keywords WHERE enabled = 1').all();
}

export function addKeyword(keyword) {
  const result = db.prepare(
    'INSERT OR IGNORE INTO stack_keywords (keyword, enabled, createdAt) VALUES (?, 1, ?)'
  ).run(keyword, nowLocalIso());
  if (result.lastInsertRowid) return db.prepare('SELECT * FROM stack_keywords WHERE id = ?').get(result.lastInsertRowid);
  return db.prepare('SELECT * FROM stack_keywords WHERE keyword = ?').get(keyword);
}

export function updateKeywordEnabled(id, enabled) {
  db.prepare('UPDATE stack_keywords SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
}

export function deleteKeyword(id) {
  db.prepare('DELETE FROM stack_keywords WHERE id = ?').run(id);
}

// --- Location signals ---

export function seedLocationSignalsIfEmpty() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM location_signals').get();
  if (count > 0) return;
  const createdAt = nowLocalIso();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO location_signals (signal, bucket, enabled, createdAt) VALUES (?, ?, 1, ?)'
  );
  const insertMany = db.transaction((signals, bucket) => {
    for (const signal of signals) insert.run(signal, bucket, createdAt);
  });
  insertMany(US_SIGNALS, 'us');
  insertMany(INTERNATIONAL_SIGNALS, 'international');
}

export function getLocationSignals() {
  return db.prepare('SELECT * FROM location_signals ORDER BY bucket ASC, signal ASC').all();
}

export function getEnabledLocationSignals() {
  return db.prepare('SELECT * FROM location_signals WHERE enabled = 1').all();
}

export function addLocationSignal(signal, bucket) {
  const result = db.prepare(
    'INSERT OR IGNORE INTO location_signals (signal, bucket, enabled, createdAt) VALUES (?, ?, 1, ?)'
  ).run(signal, bucket, nowLocalIso());
  if (result.lastInsertRowid) return db.prepare('SELECT * FROM location_signals WHERE id = ?').get(result.lastInsertRowid);
  return db.prepare('SELECT * FROM location_signals WHERE signal = ?').get(signal);
}

export function updateLocationSignalEnabled(id, enabled) {
  db.prepare('UPDATE location_signals SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
}

export function deleteLocationSignal(id) {
  db.prepare('DELETE FROM location_signals WHERE id = ?').run(id);
}
