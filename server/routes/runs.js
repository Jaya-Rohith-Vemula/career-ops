import { Router } from 'express';
import { startRun, getRun, stopRun, getActiveRun } from '../runManager.js';

const router = Router();

router.post('/daily', (req, res) => {
  try {
    const { companyIds } = req.body || {};
    const args = Array.isArray(companyIds) && companyIds.length > 0
      ? [`--ids=${companyIds.join(',')}`]
      : [];
    const runId = startRun('dailyRunner.js', args);
    res.status(202).json({ runId });
  } catch (err) {
    if (err.code === 'RUN_IN_PROGRESS') return res.status(409).json({ error: err.message });
    throw err;
  }
});

router.get('/active', (req, res) => {
  const run = getActiveRun();
  if (!run) return res.json(null);
  res.json({ id: run.id, status: run.status, output: run.output.join(''), startedAt: run.startedAt, finishedAt: run.finishedAt });
});

router.get('/:id', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'run not found' });
  res.json({ status: run.status, output: run.output.join(''), startedAt: run.startedAt, finishedAt: run.finishedAt });
});

router.post('/:id/stop', (req, res) => {
  try {
    const run = stopRun(req.params.id);
    res.json({ status: run.status });
  } catch (err) {
    if (err.code === 'RUN_NOT_FOUND') return res.status(404).json({ error: err.message });
    if (err.code === 'RUN_NOT_RUNNING') return res.status(409).json({ error: err.message });
    throw err;
  }
});

export default router;
