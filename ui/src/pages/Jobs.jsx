import { useEffect, useState } from 'react';
import { getJobs, getCompanies, updateJobStatus } from '../api';

const STATUSES = ['new', 'saved', 'applied', 'dismissed'];
const PAGE_SIZE = 25;

export default function Jobs() {
  const [companies, setCompanies] = useState([]);
  const [filters, setFilters] = useState({ companyId: '', status: '', tag: '', activeOnly: 'true', search: '' });
  const [data, setData] = useState({ jobs: [], total: 0 });
  const [page, setPage] = useState(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    getCompanies().then(setCompanies).catch(() => {});
  }, []);

  const load = () => {
    getJobs({ ...filters, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then(setData)
      .catch((e) => setError(e.message));
  };

  useEffect(load, [filters, page]);

  const onFilterChange = (key, value) => {
    setPage(0);
    setFilters((f) => ({ ...f, [key]: value }));
  };

  const onStatusChange = async (job, status) => {
    await updateJobStatus(job.companyId, job.jobId, status);
    load();
  };

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  return (
    <div>
      <div className="filters">
        <select value={filters.companyId} onChange={(e) => onFilterChange('companyId', e.target.value)}>
          <option value="">All companies</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select value={filters.status} onChange={(e) => onFilterChange('status', e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          placeholder="Tag (e.g. React)"
          value={filters.tag}
          onChange={(e) => onFilterChange('tag', e.target.value)}
        />
        <input
          placeholder="Search title…"
          value={filters.search}
          onChange={(e) => onFilterChange('search', e.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={filters.activeOnly === 'true'}
            onChange={(e) => onFilterChange('activeOnly', e.target.checked ? 'true' : '')}
          />
          Active only
        </label>
      </div>

      {error && <p className="error">{error}</p>}

      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Company</th>
            <th>Location</th>
            <th>First seen</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {data.jobs.map((job) => (
            <tr key={job.id}>
              <td><a href={job.url} target="_blank" rel="noreferrer">{job.title}</a></td>
              <td>{job.companyName}</td>
              <td>{job.location || '—'}</td>
              <td>{job.dateFirstSeen?.slice(0, 10)}</td>
              <td>
                <select value={job.status || 'new'} onChange={(e) => onStatusChange(job, e.target.value)}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="pagination">
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</button>
        <span>Page {page + 1} of {totalPages} ({data.total} jobs)</span>
        <button disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
      </div>
    </div>
  );
}
