import express from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import jobsRouter from './routes/jobs.js';
import companiesRouter from './routes/companies.js';
import runsRouter from './routes/runs.js';
import statsRouter from './routes/stats.js';
import ycRouter from './routes/yc.js';
import builtinRouter from './routes/builtin.js';
import keywordsRouter from './routes/keywords.js';
import locationSignalsRouter from './routes/location-signals.js';
import resumeRouter from './routes/resume.js';
import { seedStackKeywordsIfEmpty, seedLocationSignalsIfEmpty } from '../db/client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// process.env isn't populated from .env by anything else in this codebase —
// load it directly so PORT takes effect when set there.
try {
  process.loadEnvFile(join(__dirname, '..', '.env'));
} catch {
  // .env is optional — real env vars (e.g. in production) take precedence anyway
}

const PORT = process.env.PORT;
if (!PORT) {
  console.error('PORT must be set in .env or the environment');
  process.exit(1);
}

seedStackKeywordsIfEmpty();
seedLocationSignalsIfEmpty();

const app = express();
app.use(express.json());

app.use('/api/jobs', jobsRouter);
app.use('/api/companies', companiesRouter);
app.use('/api/runs', runsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/yc', ycRouter);
app.use('/api/sourcing/builtin', builtinRouter);
app.use('/api/keywords', keywordsRouter);
app.use('/api/location-signals', locationSignalsRouter);
app.use('/api/resume', resumeRouter);

const uiDist = join(__dirname, '..', 'ui', 'dist');
app.use(express.static(uiDist));
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(join(uiDist, 'index.html'), (err) => {
    if (err) res.status(404).send('UI not built yet — run `npm run build` in ui/, or use `npm run dev` in ui/ for local development.');
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
