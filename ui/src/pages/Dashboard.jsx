import { useEffect, useState } from 'react';
import { getStats, getCompanies, addCompany, rediscoverCompany, triggerDailyRun, deleteCompany } from '../api';
import { useRunPolling } from '../useRunPolling';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState(null);
  const [runId, setRunId] = useState(null);
  const [urlDrafts, setUrlDrafts] = useState({});
  const run = useRunPolling(runId);

  const load = () => {
    getStats().then(setStats).catch((e) => setError(e.message));
    getCompanies().then(setCompanies).catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (run && run.status !== 'running') load();
  }, [run?.status]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const { runId } = await addCompany(newName.trim());
      setRunId(runId);
      setNewName('');
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
      const { runId } = await triggerDailyRun();
      setRunId(runId);
    } catch (err) {
      setError(err.message);
    }
  };

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
        <button type="submit" disabled={run?.status === 'running'}>Add company</button>
        <button type="button" onClick={handleDailyRun} disabled={run?.status === 'running'}>
          Run daily now
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {run && (
        <div className="run-output">
          <strong>Run status: {run.status}</strong>
          <pre>{run.output}</pre>
        </div>
      )}

      <h2>Companies</h2>
      <table>
        <thead>
          <tr>
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
                  <button onClick={() => handleRediscover(c)} disabled={run?.status === 'running'}>
                    Rediscover
                  </button>
                  <button
                    className="button-danger"
                    onClick={() => handleDelete(c)}
                    disabled={run?.status === 'running'}
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
