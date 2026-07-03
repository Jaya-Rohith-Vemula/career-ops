import {
  getCompanies,
  getCompanyById,
  incrementZeroDays,
  resetZeroDays,
  flagForRediscovery,
} from './db/client.js';
import { runDiscovery } from './discovery/runDiscovery.js';
import { todayLocalDate } from './utils/time.js';
import { logError, logDaily } from './utils/logger.js';

const FETCHER_PATHS = {
  ats: './fetchers/atsFetcher.js',
  xhr: './fetchers/xhrFetcher.js',
  dom: './fetchers/domFetcher.js',
};

const ZERO_DAY_THRESHOLD = 3;

function categoryDetail(company) {
  if (company.category === 'ats') return `ats/${company.atsPlatform}`;
  if (company.category === 'xhr') return 'xhr';
  if (company.category === 'dom') return `dom/${company.requiresJs ? 'js' : 'static'}`;
  return 'unknown';
}

async function runCompany(company) {
  const path = FETCHER_PATHS[company.category];
  const module = await import(path);
  if (typeof module.runDailyFetch !== 'function') {
    throw new Error('fetcher has no runDailyFetch export');
  }
  return module.runDailyFetch(company.id);
}

async function handleZeroDayTracking(company, activeCount) {
  if (activeCount > 0) {
    resetZeroDays(company.id);
    return;
  }

  incrementZeroDays(company.id);
  const updated = getCompanyById(company.id);

  if (updated.consecutiveZeroDays < ZERO_DAY_THRESHOLD) return;

  flagForRediscovery(company.id);
  const warning = `  ${company.name.padEnd(14)}⚠ ${updated.consecutiveZeroDays} consecutive zero-result days — re-running discovery`;
  console.log(warning);
  logDaily(warning);

  const rediscovered = await runDiscovery(company.name, { url: company.careersUrl });
  if (rediscovered.status === 'active') {
    resetZeroDays(company.id);
    const success = `  ${company.name.padEnd(14)}re-discovery succeeded — category now ${rediscovered.category}`;
    console.log(success);
    logDaily(success);
  } else {
    logError(company.name, 're-discovery after zero-day threshold failed');
  }
}

async function main() {
  const companies = getCompanies().filter(
    (c) =>
      (c.category === 'ats' || c.category === 'xhr' || c.category === 'dom') &&
      c.discoveryStatus === 'active'
  );

  const today = todayLocalDate();
  const header = `[${today}] Running pipeline for ${companies.length} compan${companies.length === 1 ? 'y' : 'ies'}...`;
  console.log(header);
  logDaily(header);

  let totalNew = 0;

  for (const company of companies) {
    const detail = categoryDetail(company);
    try {
      const result = await runCompany(company);
      totalNew += result.newCount;
      const line = `  ${company.name.padEnd(14)}(${detail.padEnd(16)}) ${result.activeCount} active, ${result.newCount} new`;
      console.log(line);
      logDaily(line);

      await handleZeroDayTracking(company, result.activeCount);
    } catch (err) {
      if (err.httpStatus) {
        // HTTP errors count as a zero-result day, not a crash — brief's Error Handling Rules
        logError(company.name, `daily fetch failed — HTTP ${err.httpStatus}`);
        const line = `  ${company.name.padEnd(14)}(${detail.padEnd(16)}) 0 active, 0 new (HTTP ${err.httpStatus})`;
        console.log(line);
        logDaily(line);
        await handleZeroDayTracking(company, 0);
        continue;
      }

      const reason =
        err.code === 'ERR_MODULE_NOT_FOUND'
          ? 'fetcher not available yet'
          : err.message;
      logError(company.name, `daily fetch failed — ${reason}`);
      const line = `  ${company.name.padEnd(14)}(${detail.padEnd(16)}) skipped — ${reason}`;
      console.log(line);
      logDaily(line);
    }
  }

  console.log('');
  const summary = `Done. ${totalNew} new job${totalNew === 1 ? '' : 's'} found today.`;
  console.log(summary);
  logDaily(summary);
}

main();
