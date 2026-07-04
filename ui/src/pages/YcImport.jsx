import { useState } from 'react';
import { getYcCompanies, importYcCompanies } from '../api';

export default function YcImport() {
  const [companies, setCompanies] = useState([]);
  const [selectedIndexes, setSelectedIndexes] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const handleScrape = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const list = await getYcCompanies();
      setCompanies(list);
      setSelectedIndexes(new Set(list.map((_, i) => i)));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelected = (index) => {
    setSelectedIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIndexes((prev) =>
      prev.size === companies.length ? new Set() : new Set(companies.map((_, i) => i))
    );
  };

  const handleImport = async () => {
    const selected = companies.filter((_, i) => selectedIndexes.has(i));
    if (selected.length === 0) return;
    if (!window.confirm(`Add ${selected.length} companies to your companies list?`)) return;

    setImporting(true);
    setError(null);
    try {
      const res = await importYcCompanies(selected);
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      <h2>Import from YC Directory</h2>
      <p className="tile-label">
        Pulls US/Remote companies with 50+ employees from ycombinator.com/companies,
        then lets you add the ones you want to your companies list.
      </p>

      <div className="filters">
        <button type="button" onClick={handleScrape} disabled={loading}>
          {loading ? 'Scraping…' : 'Scrape YC companies'}
        </button>
        {companies.length > 0 && (
          <button type="button" onClick={handleImport} disabled={importing || selectedIndexes.size === 0}>
            {importing
              ? 'Adding…'
              : `Add ${selectedIndexes.size} selected to companies list`}
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {result && (
        <div className="run-output">
          <strong>
            Added {result.added} new companies{result.skipped > 0 ? `, skipped ${result.skipped} already tracked` : ''}.
          </strong>
        </div>
      )}

      {companies.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={selectedIndexes.size === companies.length}
                  onChange={toggleSelectAll}
                />
              </th>
              <th>Name</th>
              <th>Website</th>
              <th>Batch</th>
              <th>Team size</th>
              <th>Industry</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c, i) => (
              <tr key={`${c.ycUrl}-${i}`}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedIndexes.has(i)}
                    onChange={() => toggleSelected(i)}
                  />
                </td>
                <td>
                  <a href={c.ycUrl} target="_blank" rel="noreferrer">{c.name}</a>
                </td>
                <td>{c.website || '—'}</td>
                <td>{c.batch || '—'}</td>
                <td>{c.teamSize ?? '—'}</td>
                <td>{c.industry || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
