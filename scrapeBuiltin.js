import fetchBuiltinCompanies from './sources/builtin.js';
import { logDaily } from './utils/logger.js';

async function main() {
  const header = 'Scraping Built In engineering job listings...';
  console.log(header);
  logDaily(header);

  const names = await fetchBuiltinCompanies();

  // Emitted as a single line so the run-output panel can parse the full
  // company list once the subprocess finishes, same as the summary line below.
  console.log(`RESULT_JSON:${JSON.stringify(names)}`);

  const summary = `Done. ${names.length} companies found.`;
  console.log(summary);
  logDaily(summary);
}

main();
