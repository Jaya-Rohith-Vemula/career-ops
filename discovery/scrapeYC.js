// Fetches the YC company directory (https://www.ycombinator.com/companies) without
// scraping the DOM. The directory page itself doesn't hit any ycombinator.com API —
// it queries Algolia directly from the browser. Found by inspecting the Network tab
// while loading the directory with filters applied: every request for company data
// goes to Algolia's REST search endpoint with an application id and a public,
// read-only search key that ships in the page's own JS bundle (safe to reuse; it's
// scoped to `ycdc_public`-tagged records only, same as what any visitor's browser sends).
//
// One query with a high `hitsPerPage` returns the full result set in a single
// request — no pagination or headless browser required.

const ALGOLIA_APP_ID = '45BWZJ1SGC';
const ALGOLIA_API_KEY =
  'NzllNTY5MzJiZGM2OTY2ZTQwMDEzOTNhYWZiZGRjODlhYzVkNjBmOGRjNzJiMWM4ZTU0ZDlhYTZjOTJiMjlhMWFuYWx5dGljc1RhZ3M9eWNkYyZyZXN0cmljdEluZGljZXM9WUNDb21wYW55X3Byb2R1Y3Rpb24lMkNZQ0NvbXBhbnlfQnlfTGF1bmNoX0RhdGVfcHJvZHVjdGlvbiZ0YWdGaWx0ZXJzPSU1QiUyMnljZGNfcHVibGljJTIyJTVE';
const ALGOLIA_URL = `https://${ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries`;
const INDEX_NAME = 'YCCompany_By_Launch_Date_production';

/**
 * @param {object} [options]
 * @param {string[]} [options.regions] - matches YC's "Region" filter, OR'd together
 * @param {number} [options.minTeamSize] - matches YC's "Team size" filter lower bound
 * @returns {Promise<Array<{name, website, oneLiner, batch, teamSize, industry, ycUrl}>>}
 */
export async function scrapeYcCompanies({
  regions = ['United States of America', 'Remote'],
  minTeamSize = 50,
} = {}) {
  const params = new URLSearchParams({
    hitsPerPage: '1000',
    page: '0',
    facetFilters: JSON.stringify([regions.map((r) => `regions:${r}`)]),
    numericFilters: JSON.stringify([`team_size>=${minTeamSize}`]),
  }).toString();

  const res = await fetch(ALGOLIA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-algolia-agent': 'Algolia for JavaScript (3.35.1); Browser; JS Helper (3.16.1)',
      'x-algolia-application-id': ALGOLIA_APP_ID,
      'x-algolia-api-key': ALGOLIA_API_KEY,
    },
    body: JSON.stringify({ requests: [{ indexName: INDEX_NAME, params }] }),
  });

  if (!res.ok) {
    throw new Error(`YC Algolia search failed: HTTP ${res.status}`);
  }

  const data = await res.json();
  const hits = data.results?.[0]?.hits ?? [];

  return hits.map((h) => ({
    name: h.name,
    website: h.website,
    oneLiner: h.one_liner,
    batch: h.batch,
    teamSize: h.team_size,
    industry: h.industry,
    ycUrl: `https://www.ycombinator.com/companies/${h.slug}`,
  }));
}

// CLI usage: node discovery/scrapeYC.js > yc_companies.json
if (import.meta.url === `file://${process.argv[1]}`) {
  scrapeYcCompanies()
    .then((companies) => {
      console.log(JSON.stringify(companies, null, 2));
      console.error(`\n${companies.length} companies fetched.`);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
