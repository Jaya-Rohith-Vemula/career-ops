import { readFileSync } from 'fs';
import { runDiscovery } from './discovery/runDiscovery.js';
import { getCompanyById } from './db/client.js';
import { todayLocalDate } from './utils/time.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--name' || arg === '--url' || arg === '--batch') {
      args[arg.slice(2)] = argv[i + 1];
      i++;
    } else if (arg === '--rediscover') {
      args.rediscover = true;
    }
  }
  return args;
}

function readCompanyNames(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function categoryDetail(company) {
  if (!company) return 'unknown';
  if (company.category === 'ats') return `ats/${company.atsPlatform}`;
  if (company.category === 'dom') return `dom/${company.requiresJs ? 'js' : 'static'}`;
  if (company.category === 'xhr') return 'xhr';
  return 'unknown';
}

function formatResultLine(result) {
  const name = result.name.padEnd(14);
  if (result.status !== 'active') {
    return `  ${name}→ discovery failed         → skipped           ✗`;
  }
  const company = getCompanyById(result.companyId);
  const methodLabel = `found via ${result.method}`.padEnd(26);
  const detail = categoryDetail(company).padEnd(18);
  return `  ${name}→ ${methodLabel}→ ${detail}✓`;
}

async function processCompanies(names, { url, rediscover } = {}) {
  const results = [];
  for (const name of names) {
    try {
      const options = url ? { url } : {};
      const result = await runDiscovery(name, options);
      results.push(result);
    } catch (err) {
      results.push({ name, status: 'failed', reason: err.message });
    }
    console.log(formatResultLine(results[results.length - 1]));
  }
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.rediscover && (!args.name || !args.url)) {
    console.error('--rediscover requires both --name and --url');
    process.exit(1);
  }

  let names = [];
  if (args.batch) {
    names = readCompanyNames(args.batch);
  } else if (args.name) {
    names = [args.name];
  } else {
    console.error(
      'Usage:\n' +
        '  node discoveryAgent.js --name "Company"\n' +
        '  node discoveryAgent.js --batch companies.txt\n' +
        '  node discoveryAgent.js --name "Company" --url "https://..." --rediscover'
    );
    process.exit(1);
  }

  const today = todayLocalDate();
  console.log(`[${today}] Processing ${names.length} compan${names.length === 1 ? 'y' : 'ies'}...`);

  const results = await processCompanies(names, { url: args.url, rediscover: args.rediscover });

  const succeeded = results.filter((r) => r.status === 'active').length;
  const failed = results.length - succeeded;

  console.log('');
  if (failed === 0) {
    console.log(`Done. ${succeeded} succeeded.`);
  } else {
    console.log(`Done. ${succeeded} succeeded, ${failed} failed. See logs/errors.log for details.`);
  }
}

main();
