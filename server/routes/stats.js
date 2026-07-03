import { Router } from 'express';
import { getDashboardStats, getCompanies } from '../../db/client.js';

const router = Router();

router.get('/', (req, res) => {
  const stats = getDashboardStats();
  const companies = getCompanies().map((c) => ({
    id: c.id,
    name: c.name,
    category: c.category,
    discoveryStatus: c.discoveryStatus,
    lastRunDate: c.lastRunDate,
    consecutiveZeroDays: c.consecutiveZeroDays,
    flaggedForRediscovery: c.flaggedForRediscovery,
  }));
  res.json({ ...stats, companies });
});

export default router;
