import { Router } from 'express';
import { getJobs, countJobs, updateJobStatus } from '../../db/client.js';

const router = Router();

function parseFilters(query) {
  return {
    companyId: query.companyId ? Number(query.companyId) : undefined,
    status: query.status || undefined,
    tag: query.tag || undefined,
    activeOnly: query.activeOnly === 'true',
    search: query.search || undefined,
    limit: query.limit ? Number(query.limit) : 50,
    offset: query.offset ? Number(query.offset) : 0,
  };
}

router.get('/', (req, res) => {
  const filters = parseFilters(req.query);
  const jobs = getJobs(filters);
  const total = countJobs(filters);
  res.json({ jobs, total, limit: filters.limit, offset: filters.offset });
});

router.patch('/:companyId/:jobId/status', (req, res) => {
  const { companyId, jobId } = req.params;
  const { status } = req.body;
  const allowed = ['new', 'saved', 'applied', 'dismissed'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${allowed.join(', ')}` });
  }
  updateJobStatus(Number(companyId), jobId, status);
  res.json({ ok: true });
});

export default router;
