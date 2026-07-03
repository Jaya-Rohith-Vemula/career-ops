import { Router } from 'express';
import { getCompanies, getCompanyById } from '../../db/client.js';
import { startRun } from '../runManager.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(getCompanies());
});

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const runId = startRun('discoveryAgent.js', ['--name', name]);
    res.status(202).json({ runId });
  } catch (err) {
    if (err.code === 'RUN_IN_PROGRESS') return res.status(409).json({ error: err.message });
    throw err;
  }
});

router.post('/:id/rediscover', (req, res) => {
  const company = getCompanyById(Number(req.params.id));
  if (!company) return res.status(404).json({ error: 'company not found' });
  const url = req.body.url || company.careersUrl;
  if (!url) return res.status(400).json({ error: 'url is required (company has no known careersUrl)' });
  try {
    const runId = startRun('discoveryAgent.js', ['--name', company.name, '--url', url, '--rediscover']);
    res.status(202).json({ runId });
  } catch (err) {
    if (err.code === 'RUN_IN_PROGRESS') return res.status(409).json({ error: err.message });
    throw err;
  }
});

export default router;
