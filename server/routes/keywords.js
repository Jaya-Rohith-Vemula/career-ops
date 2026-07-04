import { Router } from 'express';
import { getKeywords, addKeyword, updateKeywordEnabled, deleteKeyword } from '../../db/client.js';

const router = Router();

router.get('/', (req, res) => {
  try {
    res.json(getKeywords());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const { keyword } = req.body;
    if (!keyword || !keyword.trim()) {
      return res.status(400).json({ error: 'keyword is required' });
    }
    res.status(201).json(addKeyword(keyword.trim()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', (req, res) => {
  try {
    const { enabled } = req.body;
    updateKeywordEnabled(Number(req.params.id), Boolean(enabled));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    deleteKeyword(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
