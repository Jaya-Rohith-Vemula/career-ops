import { useEffect, useState } from 'react';
import { getJobs, getCompanies, updateJobStatus } from '../api';

const STATUSES = [
  { value: 'yet_to_apply', label: 'Yet to Apply' },
  { value: 'applied', label: 'Applied' },
  { value: 'not_related', label: 'Not Related' },
];
const PAGE_SIZE = 25;

// legacy DBs may still have 'new'/'saved'/'dismissed' rows; treat them as their
// closest equivalent in the current taxonomy
function normalizeStatus(status) {
  if (status === 'dismissed') return 'not_related';
  if (!status || status === 'new' || status === 'saved') return 'yet_to_apply';
  return status;
}

function StatusCheckbox({ checked, onToggle, variant }) {
  return (
    <input
      type="checkbox"
      className={`status-checkbox status-checkbox-${variant}`}
      checked={checked}
      onChange={onToggle}
    />
  );
}

function JobsTable({ jobs, onStatusChange }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Title</th>
          <th>Company</th>
          <th>Location</th>
          <th>First seen</th>
          <th>Applied</th>
          <th>Not Related</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => {
          const current = normalizeStatus(job.status);
          return (
            <tr key={job.id}>
              <td><a href={job.url} target="_blank" rel="noreferrer">{job.title}</a></td>
              <td>{job.companyName}</td>
              <td>{job.location || '—'}</td>
              <td>{job.dateFirstSeen?.slice(0, 10)}</td>
              <td>
                <StatusCheckbox
                  variant="applied"
                  checked={current === 'applied'}
                  onToggle={() => onStatusChange(job, current === 'applied' ? 'yet_to_apply' : 'applied')}
                />
              </td>
              <td>
                <StatusCheckbox
                  variant="not_related"
                  checked={current === 'not_related'}
                  onToggle={() => onStatusChange(job, current === 'not_related' ? 'yet_to_apply' : 'not_related')}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function JobsPagination({ page, setPage, total }) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="pagination">
      <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</button>
      <span>Page {page + 1} of {totalPages} ({total} jobs)</span>
      <button disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
    </div>
  );
}

export default function Jobs() {
  const [companies, setCompanies] = useState([]);
  const [filters, setFilters] = useState({ companyId: '', status: '', tag: '', activeOnly: 'true', inactiveOnly: '', search: '' });

  // split view (default, no explicit status filter): two independently
  // paginated sections so applied jobs fall out of the way instead of
  // cluttering the top of the list
  const [toApply, setToApply] = useState({ jobs: [], total: 0 });
  const [applied, setApplied] = useState({ jobs: [], total: 0 });
  const [notRelated, setNotRelated] = useState({ jobs: [], total: 0 });
  const [toApplyPage, setToApplyPage] = useState(0);
  const [appliedPage, setAppliedPage] = useState(0);
  const [notRelatedPage, setNotRelatedPage] = useState(0);

  // single-list view, used when the status filter is set explicitly
  const [single, setSingle] = useState({ jobs: [], total: 0 });
  const [singlePage, setSinglePage] = useState(0);

  const [error, setError] = useState(null);

  useEffect(() => {
    getCompanies().then(setCompanies).catch(() => {});
  }, []);

  const splitView = filters.status === '';

  const load = () => {
    if (splitView) {
      getJobs({ ...filters, status: 'yet_to_apply', limit: PAGE_SIZE, offset: toApplyPage * PAGE_SIZE })
        .then(setToApply)
        .catch((e) => setError(e.message));
      getJobs({ ...filters, status: 'applied', limit: PAGE_SIZE, offset: appliedPage * PAGE_SIZE })
        .then(setApplied)
        .catch((e) => setError(e.message));
      getJobs({ ...filters, status: 'not_related', limit: PAGE_SIZE, offset: notRelatedPage * PAGE_SIZE })
        .then(setNotRelated)
        .catch((e) => setError(e.message));
    } else {
      getJobs({ ...filters, limit: PAGE_SIZE, offset: singlePage * PAGE_SIZE })
        .then(setSingle)
        .catch((e) => setError(e.message));
    }
  };

  useEffect(load, [filters, toApplyPage, appliedPage, notRelatedPage, singlePage]);

  const onFilterChange = (key, value) => {
    setToApplyPage(0);
    setAppliedPage(0);
    setNotRelatedPage(0);
    setSinglePage(0);
    setFilters((f) => ({ ...f, [key]: value }));
  };

  const onStatusChange = async (job, status) => {
    await updateJobStatus(job.companyId, job.jobId, status);
    load();
  };

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
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
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
            onChange={(e) => {
              onFilterChange('activeOnly', e.target.checked ? 'true' : '');
              if (e.target.checked) onFilterChange('inactiveOnly', '');
            }}
          />
          Active only
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.inactiveOnly === 'true'}
            onChange={(e) => {
              onFilterChange('inactiveOnly', e.target.checked ? 'true' : '');
              if (e.target.checked) onFilterChange('activeOnly', '');
            }}
          />
          Inactive only
        </label>
      </div>

      {error && <p className="error">{error}</p>}

      {splitView ? (
        <>
          <section>
            <h2>To Apply ({toApply.total})</h2>
            <JobsTable jobs={toApply.jobs} onStatusChange={onStatusChange} />
            <JobsPagination page={toApplyPage} setPage={setToApplyPage} total={toApply.total} />
          </section>

          <details className="collapsible-section">
            <summary>Applied ({applied.total})</summary>
            <JobsTable jobs={applied.jobs} onStatusChange={onStatusChange} />
            <JobsPagination page={appliedPage} setPage={setAppliedPage} total={applied.total} />
          </details>

          <details className="collapsible-section">
            <summary>Not Related ({notRelated.total})</summary>
            <JobsTable jobs={notRelated.jobs} onStatusChange={onStatusChange} />
            <JobsPagination page={notRelatedPage} setPage={setNotRelatedPage} total={notRelated.total} />
          </details>
        </>
      ) : (
        <section>
          <JobsTable jobs={single.jobs} onStatusChange={onStatusChange} />
          <JobsPagination page={singlePage} setPage={setSinglePage} total={single.total} />
        </section>
      )}
    </div>
  );
}
