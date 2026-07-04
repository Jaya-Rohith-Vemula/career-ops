import { useEffect, useState } from 'react';
import {
  getKeywords, addKeyword, updateKeyword, deleteKeyword,
  getLocationSignals, addLocationSignal, updateLocationSignal, deleteLocationSignal,
} from '../api';

function ChipList({ items, getLabel, onToggle, onDelete }) {
  return (
    <div className="keyword-chips">
      {items.map((item) => (
        <div key={item.id} className={`keyword-chip${item.enabled ? '' : ' keyword-chip-disabled'}`}>
          <label>
            <input type="checkbox" checked={!!item.enabled} onChange={() => onToggle(item)} />
            {getLabel(item)}
          </label>
          <button className="button-danger keyword-chip-delete" onClick={() => onDelete(item)}>×</button>
        </div>
      ))}
    </div>
  );
}

function TechKeywordsSection({ setError }) {
  const [keywords, setKeywords] = useState([]);
  const [newKeyword, setNewKeyword] = useState('');

  const load = () => {
    getKeywords().then(setKeywords).catch((e) => setError(e.message));
  };

  useEffect(load, []);

  const onAdd = async (e) => {
    e.preventDefault();
    if (!newKeyword.trim()) return;
    try {
      await addKeyword(newKeyword.trim());
      setNewKeyword('');
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const onToggle = async (kw) => {
    try {
      await updateKeyword(kw.id, kw.enabled ? 0 : 1);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const onDelete = async (kw) => {
    if (!window.confirm(`Delete keyword "${kw.keyword}"?`)) return;
    try {
      await deleteKeyword(kw.id);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <section>
      <h2>Tech Keywords</h2>
      <p className="tile-label" style={{ marginBottom: 20 }}>
        Keywords used by the "Filter by tech keywords" toggle on the Jobs page to match against job descriptions.
      </p>

      <form className="filters" onSubmit={onAdd}>
        <input
          placeholder="Add a keyword…"
          value={newKeyword}
          onChange={(e) => setNewKeyword(e.target.value)}
        />
        <button type="submit">Add</button>
      </form>

      <ChipList items={keywords} getLabel={(kw) => kw.keyword} onToggle={onToggle} onDelete={onDelete} />
    </section>
  );
}

function LocationSignalsSection({ setError }) {
  const [signals, setSignals] = useState([]);
  const [newSignal, setNewSignal] = useState('');
  const [newBucket, setNewBucket] = useState('us');

  const load = () => {
    getLocationSignals().then(setSignals).catch((e) => setError(e.message));
  };

  useEffect(load, []);

  const onAdd = async (e) => {
    e.preventDefault();
    if (!newSignal.trim()) return;
    try {
      await addLocationSignal(newSignal.trim(), newBucket);
      setNewSignal('');
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const onToggle = async (signal) => {
    try {
      await updateLocationSignal(signal.id, signal.enabled ? 0 : 1);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const onDelete = async (signal) => {
    if (!window.confirm(`Delete location signal "${signal.signal}"?`)) return;
    try {
      await deleteLocationSignal(signal.id);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const us = signals.filter((s) => s.bucket === 'us');
  const international = signals.filter((s) => s.bucket === 'international');

  return (
    <section>
      <h2>Location Signals</h2>
      <p className="tile-label" style={{ marginBottom: 20 }}>
        Location terms used by the "Filter by location" toggle on the Jobs page to bucket jobs as US-based or international.
      </p>

      <form className="filters" onSubmit={onAdd}>
        <input
          placeholder="Add a location signal…"
          value={newSignal}
          onChange={(e) => setNewSignal(e.target.value)}
        />
        <select value={newBucket} onChange={(e) => setNewBucket(e.target.value)}>
          <option value="us">US</option>
          <option value="international">International</option>
        </select>
        <button type="submit">Add</button>
      </form>

      <h3>US</h3>
      <ChipList items={us} getLabel={(s) => s.signal} onToggle={onToggle} onDelete={onDelete} />

      <h3>International</h3>
      <ChipList items={international} getLabel={(s) => s.signal} onToggle={onToggle} onDelete={onDelete} />
    </section>
  );
}

export default function JobFilters() {
  const [error, setError] = useState(null);

  return (
    <div>
      <h1>Job Filters</h1>
      {error && <p className="error">{error}</p>}
      <TechKeywordsSection setError={setError} />
      <LocationSignalsSection setError={setError} />
    </div>
  );
}
