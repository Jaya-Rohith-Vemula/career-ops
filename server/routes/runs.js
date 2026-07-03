import { Router } from 'express';
import { startRun, getRun } from '../runManager.js';

const router = Router();

router.post('/daily', (req, res) => {
  try {
    const runId = startRun('dailyRunner.js', []);
    res.status(202).json({ runId });
  } catch (err) {
    if (err.code === 'RUN_IN_PROGRESS') return res.status(409).json({ error: err.message });
    throw err;
  }
});

router.get('/:id', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'run not found' });
  res.json({ status: run.status, output: run.output.join(''), startedAt: run.startedAt, finishedAt: run.finishedAt });
});

export default router;
