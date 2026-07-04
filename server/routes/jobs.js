import { Router } from 'express';
import { getJobs, countJobs, updateJobStatus, setJobLocationBucketOverride } from '../../db/client.js';

const router = Router();

function parseFilters(query) {
  return {
    companyId: query.companyId
      ? String(query.companyId).split(',').filter(Boolean).map(Number)
      : undefined,
    status: query.status || undefined,
    tag: query.tag || undefined,
    activeOnly: query.activeOnly === 'true',
    inactiveOnly: query.inactiveOnly === 'true',
    search: query.search || undefined,
    keywordFilter: query.keywordFilter === 'true',
    keywordMatch: query.keywordMatch === 'false' ? false : query.keywordMatch === 'true' ? true : undefined,
    locationFilter: query.locationFilter === 'true',
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
  const allowed = ['yet_to_apply', 'applied', 'not_related'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${allowed.join(', ')}` });
  }
  updateJobStatus(Number(companyId), jobId, status);
  res.json({ ok: true });
});

router.patch('/:companyId/:jobId/location-bucket', (req, res) => {
  const { companyId, jobId } = req.params;
  const { bucket } = req.body;
  const allowed = ['us', 'international', null];
  if (!allowed.includes(bucket)) {
    return res.status(400).json({ error: "bucket must be 'us', 'international', or null" });
  }
  setJobLocationBucketOverride(Number(companyId), jobId, bucket);
  res.json({ ok: true });
});

export default router;
