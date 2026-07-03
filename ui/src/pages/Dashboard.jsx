import { useEffect, useState } from 'react';
import { getStats } from '../api';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getStats().then(setStats).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
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

      <h2>Company health</h2>
      <table>
        <thead>
          <tr>
            <th>Company</th>
            <th>Category</th>
            <th>Discovery status</th>
            <th>Last run</th>
            <th>Zero-days</th>
            <th>Flagged</th>
          </tr>
        </thead>
        <tbody>
          {stats.companies.map((c) => (
            <tr key={c.id} className={c.flaggedForRediscovery ? 'row-flagged' : ''}>
              <td>{c.name}</td>
              <td>{c.category || '—'}</td>
              <td>{c.discoveryStatus}</td>
              <td>{c.lastRunDate ? new Date(c.lastRunDate).toLocaleString() : '—'}</td>
              <td>{c.consecutiveZeroDays}</td>
              <td>{c.flaggedForRediscovery ? 'Yes' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
