import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const runs = new Map();

export function startTailorRun(companyId, jobId) {
  const runId = randomUUID();
  const child = spawn(
    'node',
    ['resume/tailorResume.js', `--companyId=${companyId}`, `--jobId=${jobId}`],
    { cwd: rootDir }
  );
  const run = { id: runId, status: 'running', output: [], result: null, startedAt: new Date().toISOString(), finishedAt: null };
  runs.set(runId, run);

  child.stdout.on('data', (chunk) => run.output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => run.output.push(chunk.toString()));

  child.on('close', (code) => {
    run.status = code === 0 ? 'done' : 'failed';
    run.finishedAt = new Date().toISOString();
    if (run.status === 'done') {
      const text = run.output.join('');
      const lastLine = text.trim().split('\n').pop();
      try {
        run.result = JSON.parse(lastLine);
      } catch {
        run.status = 'failed';
      }
    }
  });

  child.on('error', (err) => {
    run.status = 'failed';
    run.output.push(String(err));
    run.finishedAt = new Date().toISOString();
  });

  return runId;
}

export function getTailorRun(runId) {
  return runs.get(runId);
}
