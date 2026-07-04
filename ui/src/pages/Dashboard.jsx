import { useEffect, useState } from 'react';
import { getStats, getCompanies, addCompany, rediscoverCompany, triggerDailyRun, deleteCompany, stopRun, getActiveRun } from '../api';
import { useRunPolling } from '../useRunPolling';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [error, setError] = useState(null);
  const [runId, setRunId] = useState(null);
  const [urlDrafts, setUrlDrafts] = useState({});
  const [selectedIds, setSelectedIds] = useState(new Set());
  const run = useRunPolling(runId);

  const load = () => {
    getStats().then(setStats).catch((e) => setError(e.message));
    getCompanies().then(setCompanies).catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
    getActiveRun()
      .then((active) => {
        if (active?.status === 'running' || active?.status === 'stopping') setRunId(active.id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (run && run.status !== 'running' && run.status !== 'stopping') load();
  }, [run?.status]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const { runId } = await addCompany(newName.trim(), newUrl.trim() || undefined);
      setRunId(runId);
      setNewName('');
      setNewUrl('');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRediscover = async (company) => {
    const url = (urlDrafts[company.id] ?? company.careersUrl ?? '').trim();
    if (!url) {
      setError(`Enter a careers URL for ${company.name} before rediscovering.`);
      return;
    }
    try {
      const { runId } = await rediscoverCompany(company.id, url);
      setRunId(runId);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (company) => {
    if (!window.confirm(`Delete ${company.name} and all its jobs? This can't be undone.`)) return;
    try {
      await deleteCompany(company.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDailyRun = async () => {
    try {
      const { runId } = await triggerDailyRun(Array.from(selectedIds));
      setRunId(runId);
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleSelected = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) =>
      prev.size === companies.length ? new Set() : new Set(companies.map((c) => c.id))
    );
  };

  const handleStopRun = async () => {
    if (!runId) return;
    try {
      await stopRun(runId);
    } catch (err) {
      setError(err.message);
    }
  };

  const isBusy = run?.status === 'running' || run?.status === 'stopping';

  if (!stats) return <p>Loading…</p>;

  return (
    <div>
      <div className="tiles">
        <div className="tile">
          <div className="tile-value">{stats.newToday}</div>
          <div className="tile-label">New jobs today</div>
        </div>
        <div className="tile">
          <div className="tile-value">{stats.totalCompanies}</div>
          <div className="tile-label">Companies tracked</div>
        </div>
        <div className="tile">
          <div className="tile-value">{stats.needsAttention}</div>
          <div className="tile-label">Need attention</div>
        </div>
        <div className="tile">
          <div className="tile-value">{stats.activeJobs}</div>
          <div className="tile-label">Active jobs</div>
        </div>
      </div>

      <form className="filters" onSubmit={handleAdd}>
        <input
          placeholder="Company name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <input
          placeholder="Careers URL (optional)…"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
        />
        <button type="submit" disabled={isBusy}>Add company</button>
        <button type="button" onClick={handleDailyRun} disabled={isBusy}>
          Run daily now{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {run && (
        <div className="run-output">
          <strong>Run status: {run.status}</strong>
          {run.status === 'running' && (
            <button type="button" className="button-danger pl-4" onClick={handleStopRun}>
              Stop run
            </button>
          )}
          {run.status !== 'running' && run.status !== 'stopping' && (
            <button type="button" className="pl-4" onClick={() => setRunId(null)}>
              Dismiss
            </button>
          )}
          <pre>{run.output}</pre>
        </div>
      )}

      <h2>Companies</h2>
      <table>
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                checked={companies.length > 0 && selectedIds.size === companies.length}
                onChange={toggleSelectAll}
              />
            </th>
            <th>Name</th>
            <th>Category</th>
            <th>Discovery status</th>
            <th>Last run</th>
            <th>Zero-days</th>
            <th>Flagged</th>
            <th>Careers URL</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {companies.map((c) => (
            <tr key={c.id} className={c.flaggedForRediscovery || c.discoveryStatus === 'failed' ? 'row-flagged' : undefined}>
              <td>
                <input
                  type="checkbox"
                  checked={selectedIds.has(c.id)}
                  onChange={() => toggleSelected(c.id)}
                />
              </td>
              <td>{c.name}</td>
              <td>{c.category || '—'}</td>
              <td>{c.discoveryStatus}</td>
              <td>{c.lastRunDate ? new Date(c.lastRunDate).toLocaleString() : '—'}</td>
              <td>{c.consecutiveZeroDays}</td>
              <td>{c.flaggedForRediscovery ? 'Yes' : ''}</td>
              <td>
                <input
                  className="careers-url-input"
                  placeholder="https://company.com/careers"
                  value={urlDrafts[c.id] ?? c.careersUrl ?? ''}
                  onChange={(e) => setUrlDrafts((prev) => ({ ...prev, [c.id]: e.target.value }))}
                />
              </td>
              <td>
                <div className="row-actions">
                  <button onClick={() => handleRediscover(c)} disabled={isBusy}>
                    Rediscover
                  </button>
                  <button
                    className="button-danger"
                    onClick={() => handleDelete(c)}
                    disabled={isBusy}
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
