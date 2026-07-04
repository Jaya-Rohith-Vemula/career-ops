import { Router } from 'express';
import { startRun, getRun, getActiveRun } from '../runManager.js';
import { insertCompany, getCompanyByName } from '../../db/client.js';

const router = Router();

router.post('/import', (req, res) => {
  const { companies } = req.body;
  if (!Array.isArray(companies) || companies.length === 0) {
    return res.status(400).json({ error: 'companies array is required' });
  }

  let added = 0;
  let skipped = 0;
  for (const name of companies) {
    if (!name) continue;
    if (getCompanyByName(name)) {
      skipped++;
      continue;
    }
    insertCompany({ name });
    added++;
  }

  res.json({ added, skipped });
});

router.post('/', (req, res) => {
  try {
    const runId = startRun('scrapeBuiltin.js');
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

export default router;
