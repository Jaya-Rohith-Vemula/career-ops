import { extractTags } from '../utils/keywords.js';
import { diffJobIds, recordSnapshot } from '../utils/diff.js';
import { getCompanyById, upsertJob, deactivateJobs, updateCompany } from '../db/client.js';

const REQUEST_TIMEOUT_MS = 10000;

const ATS_API = {
  greenhouse: (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
  lever: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
  ashby: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
};

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeGreenhouse(data) {
  return (data.jobs || []).map((job) => ({
    jobId: String(job.id),
    title: job.title,
    location: job.location?.name || '',
    url: job.absolute_url,
    description: job.content || '',
  }));
}

function normalizeLever(data) {
  return (data || []).map((job) => ({
    jobId: String(job.id),
    title: job.text,
    location: job.categories?.location || '',
    url: job.hostedUrl,
    description: job.descriptionPlain || job.description || '',
  }));
}

function normalizeAshby(data) {
  return (data.jobs || []).map((job) => ({
    jobId: String(job.id),
    title: job.title,
    location: job.location || '',
    url: job.jobUrl || job.applyUrl || '',
    description: job.descriptionPlain || job.description || '',
  }));
}

const NORMALIZERS = {
  greenhouse: normalizeGreenhouse,
  lever: normalizeLever,
  ashby: normalizeAshby,
};

async function fetchAtsJobs(platform, slug) {
  const res = await fetchWithTimeout(ATS_API[platform](slug));
  if (!res.ok) {
    const err = new Error(`ATS API returned ${res.status}`);
    err.httpStatus = res.status;
    throw err;
  }
  const data = await res.json();
  return NORMALIZERS[platform](data);
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

  const jobs = await fetchAtsJobs(company.atsPlatform, company.atsSlug);
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
