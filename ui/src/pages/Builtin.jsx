import { useEffect, useState } from 'react';
import {
  triggerBuiltinScrape,
  getBuiltinActiveRun,
  getBuiltinRun,
  importBuiltinCompanies,
} from '../api';
import { useRunPolling } from '../useRunPolling';
import RunOutputPanel from '../RunOutputPanel';

const SUMMARY_REGEX = /(\d+)\s+companies found/;
const RESULT_LINE_REGEX = /^RESULT_JSON:(.*)$/m;

function parseCompanies(output) {
  const match = output?.match(RESULT_LINE_REGEX);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export default function Builtin() {
  const [runId, setRunId] = useState(null);
  const [error, setError] = useState(null);
  const [lastRun, setLastRun] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [selectedIndexes, setSelectedIndexes] = useState(new Set());
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const run = useRunPolling(runId, getBuiltinRun);

  useEffect(() => {
    getBuiltinActiveRun()
      .then((active) => {
        if (active?.status === 'running' || active?.status === 'stopping') setRunId(active.id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (run && run.status !== 'running' && run.status !== 'stopping') {
      const match = run.output.match(SUMMARY_REGEX);
      setLastRun({
        finishedAt: run.finishedAt,
        companyCount: match ? Number(match[1]) : null,
      });

      if (run.status === 'done') {
        const names = parseCompanies(run.output) || [];
        setCompanies(names);
        setSelectedIndexes(new Set(names.map((_, i) => i)));
        setResult(null);
      }
    }
  }, [run?.status]);

  const handleScrape = async () => {
    setError(null);
    setCompanies([]);
    setSelectedIndexes(new Set());
    setResult(null);
    try {
      const { runId } = await triggerBuiltinScrape();
      setRunId(runId);
    } catch (err) {
      setError(err.message);
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
      const res = await importBuiltinCompanies(selected);
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const isBusy = run?.status === 'running' || run?.status === 'stopping';
  const displayRun = run && {
    ...run,
    output: run.output.replace(RESULT_LINE_REGEX, '').replace(/\n{3,}/g, '\n\n'),
  };

  let statusLine = 'Idle.';
  if (isBusy) {
    statusLine = 'Running…';
  } else if (lastRun) {
    statusLine = `Last run: ${new Date(lastRun.finishedAt).toLocaleString()}${
      lastRun.companyCount !== null ? ` — ${lastRun.companyCount} companies found` : ''
    }`;
  }

  return (
    <div>
      <h2>Built In Scrape</h2>
      <p className="tile-label">
        Scrapes company names from Built In's engineering job listings, then lets you
        add the ones you want to your companies list.
      </p>

      <div className="filters">
        <button type="button" onClick={handleScrape} disabled={isBusy}>
          {isBusy ? 'Scraping…' : 'Scrape Now'}
        </button>
        {companies.length > 0 && (
          <button type="button" onClick={handleImport} disabled={importing || selectedIndexes.size === 0}>
            {importing
              ? 'Adding…'
              : `Add ${selectedIndexes.size} selected to companies list`}
          </button>
        )}
      </div>

      <p>{statusLine}</p>

      {error && <p className="error">{error}</p>}

      {result && (
        <div className="run-output">
          <strong>
            Added {result.added} new companies{result.skipped > 0 ? `, skipped ${result.skipped} already tracked` : ''}.
          </strong>
        </div>
      )}

      <RunOutputPanel run={displayRun} onDismiss={() => setRunId(null)} />

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
            </tr>
          </thead>
          <tbody>
            {companies.map((name, i) => (
              <tr key={`${name}-${i}`}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedIndexes.has(i)}
                    onChange={() => toggleSelected(i)}
                  />
                </td>
                <td>{name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
