import { extractTags } from '../utils/keywords.js';
import { diffJobIds, recordSnapshot } from '../utils/diff.js';
import { getCompanyById, upsertJob, deactivateJobs, updateCompany } from '../db/client.js';

const REQUEST_TIMEOUT_MS = 10000;

const TITLE_KEYS = ['title', 'jobtitle', 'positiontitle'];
const ID_KEYS = ['jobid', 'requisitionid', 'jobrequisitionid', 'postingid', 'id'];
const LOCATION_KEYS = ['location', 'city', 'department', 'team'];
const URL_KEYS = ['url', 'applyurl', 'joburl', 'externalpath', 'canonicalpositionurl', 'hostedurl'];
const DESCRIPTION_KEYS = ['description', 'jobdescription', 'summary', 'descriptionplain'];

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function lowerKeyMap(obj) {
  const map = {};
  for (const key of Object.keys(obj)) map[key.toLowerCase()] = obj[key];
  return map;
}

function getField(map, keys) {
  for (const key of keys) {
    if (map[key] !== undefined && map[key] !== null) return map[key];
  }
  return undefined;
}

function objectLooksLikeJob(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const map = lowerKeyMap(obj);
  const hasTitle = TITLE_KEYS.some((k) => map[k] !== undefined);
  const hasIdOrLocation =
    ID_KEYS.some((k) => map[k] !== undefined) || LOCATION_KEYS.some((k) => map[k] !== undefined);
  return hasTitle && hasIdOrLocation;
}

function findJobArray(data, depth = 0) {
  if (depth > 4 || data == null || typeof data !== 'object') return null;

  if (Array.isArray(data)) {
    if (data.length > 0 && data.every(objectLooksLikeJob)) return data;
    for (const item of data) {
      const found = findJobArray(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  for (const value of Object.values(data)) {
    const found = findJobArray(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function stableFallbackId(title, url) {
  const base = `${title || ''}|${url || ''}`;
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    hash = (hash * 31 + base.charCodeAt(i)) | 0;
  }
  return `fallback-${Math.abs(hash)}`;
}

function resolveUrl(candidate, baseUrl) {
  if (!candidate) return '';
  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return String(candidate);
  }
}

function normalizeXhrJobs(data, endpoint) {
  const jobArray = findJobArray(data);
  if (!jobArray) return [];

  return jobArray.map((raw) => {
    const map = lowerKeyMap(raw);
    const title = getField(map, TITLE_KEYS) || '';
    const location = getField(map, LOCATION_KEYS) || '';
    const rawUrl = getField(map, URL_KEYS) || '';
    const description = getField(map, DESCRIPTION_KEYS) || '';
    const rawId = getField(map, ID_KEYS);

    return {
      jobId: rawId !== undefined ? String(rawId) : stableFallbackId(title, rawUrl),
      title,
      location: typeof location === 'object' ? JSON.stringify(location) : String(location),
      url: resolveUrl(rawUrl, endpoint),
      description: typeof description === 'object' ? JSON.stringify(description) : String(description),
    };
  });
}

async function fetchXhrJobs(company) {
  const headers = company.xhrHeaders ? JSON.parse(company.xhrHeaders) : {};
  const res = await fetchWithTimeout(company.xhrEndpoint, { method: 'GET', headers });
  if (!res.ok) {
    const err = new Error(`XHR endpoint returned ${res.status}`);
    err.httpStatus = res.status;
    throw err;
  }
  const data = await res.json();
  return normalizeXhrJobs(data, company.xhrEndpoint);
}

function syncCompanyJobs(companyId, jobs) {
  const now = new Date().toISOString();

  // Defensive: collapse any duplicate jobId entries so reported active/new
  // counts always reflect distinct postings, not raw row count.
  const uniqueJobs = [...new Map(jobs.map((job) => [job.jobId, job])).values()];
  const jobIds = uniqueJobs.map((job) => job.jobId);

  const { newIds } = diffJobIds(companyId, jobIds);

  for (const job of uniqueJobs) {
    upsertJob({
      companyId,
      jobId: job.jobId,
      title: job.title,
      location: job.location,
      url: job.url,
      description: job.description,
      techStackTags: JSON.stringify(extractTags(job.description)),
      dateFirstSeen: now,
      dateLastSeen: now,
      isActive: 1,
    });
  }

  deactivateJobs(companyId, jobIds);
  recordSnapshot(companyId, jobIds);

  return { activeCount: jobIds.length, newCount: newIds.length };
}

async function fetchAndSync(companyId) {
  const company = getCompanyById(companyId);
  if (!company) throw new Error(`company ${companyId} not found`);

  const jobs = await fetchXhrJobs(company);
  const result = syncCompanyJobs(companyId, jobs);

  updateCompany(companyId, { lastRunDate: new Date().toISOString() });

  return result;
}

export async function runInitialFetch(companyId) {
  return fetchAndSync(companyId);
}

export async function runDailyFetch(companyId) {
  return fetchAndSync(companyId);
}
