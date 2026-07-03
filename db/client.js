import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { DB_PATH } from '../config.js';
import { todayLocalDate } from '../utils/time.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../schema.sql'), 'utf8');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(schema);

const jobColumns = db.prepare('PRAGMA table_info(jobs)').all().map((c) => c.name);
if (!jobColumns.includes('status')) {
  db.exec("ALTER TABLE jobs ADD COLUMN status TEXT DEFAULT 'new'");
}

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
  if (filters.status) {
    clauses.push('jobs.status = @status');
    params.status = filters.status;
  }
  if (filters.tag) {
    clauses.push('jobs.techStackTags LIKE @tag');
    params.tag = `%"${filters.tag}"%`;
  }
  if (filters.activeOnly) {
    clauses.push('jobs.isActive = 1');
  }
  if (filters.search) {
    clauses.push('jobs.title LIKE @search');
    params.search = `%${filters.search}%`;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return { where, params };
}

export function getJobs(filters = {}) {
  const { where, params } = buildJobFilterClause(filters);
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  return db.prepare(
    `SELECT jobs.*, companies.name AS companyName
     FROM jobs JOIN companies ON companies.id = jobs.companyId
     ${where}
     ORDER BY jobs.dateFirstSeen DESC
     LIMIT @limit OFFSET @offset`
  ).all({ ...params, limit, offset });
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
