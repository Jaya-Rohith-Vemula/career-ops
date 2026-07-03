// Central logging: each category writes to its own file (errors.log, daily.log,
// company.log) plus a combined activity.log, so you can tail one file to see
// everything, or grep one file to search a single category — both stay in sync
// because they're written from the same call, never duplicated per-caller.
import { appendFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { nowLocalIso } from './time.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = join(__dirname, '..', 'logs');

const LOG_FILES = {
  error: join(LOGS_DIR, 'errors.log'),
  daily: join(LOGS_DIR, 'daily.log'),
  company: join(LOGS_DIR, 'company.log'),
  all: join(LOGS_DIR, 'activity.log'),
};

function append(file, line) {
  try {
    appendFileSync(file, line + '\n');
  } catch {
    // logging is best-effort — never let a log write failure crash a run
  }
}

function write(category, tag, line) {
  append(LOG_FILES[category], line);
  append(LOG_FILES.all, `[${tag}] ${line}`);
}

export function logError(companyName, reason) {
  write('error', 'ERROR', `[${nowLocalIso()}] ${companyName} — ${reason}`);
}

export function logDaily(message) {
  write('daily', 'DAILY', `[${nowLocalIso()}] ${message}`);
}

export function logCompany(companyName, message) {
  write('company', 'COMPANY', `[${nowLocalIso()}] ${companyName} — ${message}`);
}
