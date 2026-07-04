import { Router } from 'express';
import { scrapeYcCompanies } from '../../discovery/scrapeYC.js';
import { insertCompany, getCompanyByName } from '../../db/client.js';

const router = Router();

router.get('/companies', async (req, res) => {
  try {
    const companies = await scrapeYcCompanies();
    res.json(companies);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/companies/import', (req, res) => {
  const { companies } = req.body;
  if (!Array.isArray(companies) || companies.length === 0) {
    return res.status(400).json({ error: 'companies array is required' });
  }

  let added = 0;
  let skipped = 0;
  for (const c of companies) {
    if (!c.name) continue;
    if (getCompanyByName(c.name)) {
      skipped++;
      continue;
    }
    insertCompany({ name: c.name });
    added++;
  }

  res.json({ added, skipped });
});

export default router;
