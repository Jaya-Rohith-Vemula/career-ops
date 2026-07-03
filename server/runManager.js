import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const runs = new Map();
let activeRunId = null;

export function getActiveRun() {
  return activeRunId ? runs.get(activeRunId) : null;
}

export function getRun(runId) {
  return runs.get(runId);
}

export function startRun(script, args = []) {
  if (activeRunId) {
    const active = runs.get(activeRunId);
    if (active.status === 'running') {
      const err = new Error('Another run is already in progress');
      err.code = 'RUN_IN_PROGRESS';
      throw err;
    }
  }

  const runId = randomUUID();
  const child = spawn('node', [script, ...args], { cwd: rootDir });
  const run = { id: runId, script, args, status: 'running', output: [], startedAt: new Date().toISOString(), finishedAt: null };
  runs.set(runId, run);
  activeRunId = runId;

  child.stdout.on('data', (chunk) => run.output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => run.output.push(chunk.toString()));

  child.on('close', (code) => {
    run.status = code === 0 ? 'done' : 'failed';
    run.finishedAt = new Date().toISOString();
    if (activeRunId === runId) activeRunId = null;
  });

  child.on('error', (err) => {
    run.status = 'failed';
    run.output.push(String(err));
    run.finishedAt = new Date().toISOString();
    if (activeRunId === runId) activeRunId = null;
  });

  return runId;
}
