import { writeFileSync } from 'fs';
import { getCompanies, getJobsByCompany } from './db/client.js';

const OUTPUT_PATH = new URL('./all_jobs_export.csv', import.meta.url);

function csvEscape(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function toRow(fields) {
  return fields.map(csvEscape).join(',');
}

function main() {
  const companies = getCompanies();
  const rows = [toRow(['company', 'jobId', 'title', 'location', 'tags', 'url', 'isActive', 'dateFirstSeen', 'dateLastSeen'])];

  let totalJobs = 0;
  for (const company of companies) {
    const jobs = getJobsByCompany(company.id);
    for (const job of jobs) {
      let tags = [];
      try {
        tags = JSON.parse(job.techStackTags || '[]');
      } catch {
        tags = [];
      }
      rows.push(
        toRow([
          company.name,
          job.jobId,
          job.title,
          job.location,
          JSON.stringify(tags),
          job.url,
          job.isActive,
          job.dateFirstSeen,
          job.dateLastSeen,
        ])
      );
      totalJobs++;
    }
  }

  writeFileSync(OUTPUT_PATH, rows.join('\n') + '\n');
  console.log(`Exported ${totalJobs} jobs across ${companies.length} companies to ${OUTPUT_PATH.pathname}`);
}

main();
