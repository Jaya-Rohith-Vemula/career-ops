import { Router } from 'express';
import {
  getLocationSignals,
  addLocationSignal,
  updateLocationSignalEnabled,
  deleteLocationSignal,
} from '../../db/client.js';

const router = Router();

router.get('/', (req, res) => {
  try {
    res.json(getLocationSignals());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const { signal, bucket } = req.body;
    if (!signal || !signal.trim()) {
      return res.status(400).json({ error: 'signal is required' });
    }
    if (bucket !== 'us' && bucket !== 'international') {
      return res.status(400).json({ error: "bucket must be 'us' or 'international'" });
    }
    res.status(201).json(addLocationSignal(signal.trim(), bucket));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', (req, res) => {
  try {
    const { enabled } = req.body;
    updateLocationSignalEnabled(Number(req.params.id), Boolean(enabled));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    deleteLocationSignal(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
