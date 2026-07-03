import { findCareersPage } from './findCareersPage.js';
import { detectCategory } from './detectCategory.js';
import { insertCompany, updateCompany, getCompanyByName } from '../db/client.js';
import { nowLocalIso } from '../utils/time.js';
import { logError, logCompany } from '../utils/logger.js';

function upsertCompany(companyName, data) {
  const existing = getCompanyByName(companyName);
  if (existing) {
    updateCompany(existing.id, data);
    return existing.id;
  }
  return insertCompany({ name: companyName, ...data });
}

// Fetchers are added in a later build step (atsFetcher/xhrFetcher/domFetcher).
// Until then, the initial baseline fetch is skipped and logged rather than failing discovery.
async function runInitialFetch(companyId, category) {
  const fetcherPaths = {
    ats: '../fetchers/atsFetcher.js',
    xhr: '../fetchers/xhrFetcher.js',
    dom: '../fetchers/domFetcher.js',
  };

  try {
    const module = await import(fetcherPaths[category]);
    if (typeof module.runInitialFetch !== 'function') {
      return { ran: false, reason: 'fetcher module has no runInitialFetch export' };
    }
    await module.runInitialFetch(companyId);
    return { ran: true };
  } catch (err) {
    return { ran: false, reason: `fetcher not available yet (${err.code || err.message})` };
  }
}

export async function runDiscovery(companyName, { url: manualUrl } = {}) {
  const timestamp = nowLocalIso();
  logCompany(companyName, manualUrl ? `discovery requested (manual url: ${manualUrl})` : 'discovery requested');

  try {
    const found = manualUrl
      ? { url: manualUrl, method: 'manual' }
      : await findCareersPage(companyName);

    if (!found) {
      upsertCompany(companyName, {
        discoveryStatus: 'failed',
        lastDiscoveryDate: timestamp,
      });
      logError(companyName, 'careers page not found (both strategies failed)');
      logCompany(companyName, 'discovery failed — careers page not found');
      return { name: companyName, status: 'failed', reason: 'careers page not found' };
    }

    const detected = await detectCategory(found.url);

    if (!detected) {
      upsertCompany(companyName, {
        careersUrl: found.url,
        discoveryMethod: found.method,
        discoveryStatus: 'failed',
        lastDiscoveryDate: timestamp,
      });
      logError(companyName, `category not detected for ${found.url}`);
      logCompany(companyName, `discovery failed — category not detected for ${found.url}`);
      return { name: companyName, status: 'failed', reason: 'category not detected', url: found.url };
    }

    // detectCategory may have followed a "See open roles" style CTA to a
    // deeper listings page — store that resolved URL, not the original
    // landing page, so later DOM daily-fetches hit the page that actually
    // has the jobs.
    const careersUrl = detected.resolvedUrl || found.url;

    const companyId = upsertCompany(companyName, {
      careersUrl,
      discoveryMethod: found.method,
      discoveryStatus: 'active',
      category: detected.category,
      lastDiscoveryDate: timestamp,
      ...detected.config,
    });

    const fetchResult = await runInitialFetch(companyId, detected.category);
    if (!fetchResult.ran) {
      logError(companyName, `initial fetch skipped — ${fetchResult.reason}`);
    }

    logCompany(
      companyName,
      `discovery succeeded — found via ${found.method}, category ${detected.category}, url ${careersUrl}`
    );

    return {
      companyId,
      name: companyName,
      status: 'active',
      method: found.method,
      category: detected.category,
      url: careersUrl,
      initialFetch: fetchResult,
    };
  } catch (err) {
    upsertCompany(companyName, {
      discoveryStatus: 'failed',
      lastDiscoveryDate: timestamp,
    });
    logError(companyName, `unexpected error — ${err.message}`);
    logCompany(companyName, `discovery failed — unexpected error — ${err.message}`);
    return { name: companyName, status: 'failed', reason: err.message };
  }
}
