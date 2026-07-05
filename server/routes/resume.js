import { Router } from 'express';
import { startTailorRun, getTailorRun } from '../resumeManager.js';

const router = Router();

router.post('/tailor', (req, res) => {
  const { companyId, jobId } = req.body || {};
  if (!companyId || !jobId) {
    return res.status(400).json({ error: 'companyId and jobId are required' });
  }
  const runId = startTailorRun(companyId, jobId);
  res.status(202).json({ runId });
});

router.get('/tailor/:runId', (req, res) => {
  const run = getTailorRun(req.params.runId);
  if (!run) return res.status(404).json({ error: 'run not found' });
  res.json({
    status: run.status,
    output: run.output.join(''),
    result: run.result,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  });
});

router.get('/tailor/:runId/download', (req, res) => {
  const run = getTailorRun(req.params.runId);
  if (!run || run.status !== 'done' || !run.result) {
    return res.status(404).json({ error: 'result not available' });
  }
  res.download(run.result.docxPath, `${run.result.slug}.docx`);
});

export default router;
