import { useEffect, useState } from 'react';
import { getCompanies, addCompany, rediscoverCompany, triggerDailyRun } from '../api';
import { useRunPolling } from '../useRunPolling';

export default function Companies() {
  const [companies, setCompanies] = useState([]);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState(null);
  const [runId, setRunId] = useState(null);
  const run = useRunPolling(runId);

  const load = () => getCompanies().then(setCompanies).catch((e) => setError(e.message));

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
    try {
      const { runId } = await rediscoverCompany(company.id, company.careersUrl);
      setRunId(runId);
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

  return (
    <div>
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

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Category</th>
            <th>Discovery status</th>
            <th>Careers URL</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {companies.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.category || '—'}</td>
              <td>{c.discoveryStatus}</td>
              <td>{c.careersUrl ? <a href={c.careersUrl} target="_blank" rel="noreferrer">{c.careersUrl}</a> : '—'}</td>
              <td>
                <button onClick={() => handleRediscover(c)} disabled={run?.status === 'running'}>
                  Rediscover
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
