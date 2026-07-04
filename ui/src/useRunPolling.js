import { useEffect, useState } from 'react';
import { getRun } from './api';

export function useRunPolling(runId, fetchRun = getRun) {
  const [run, setRun] = useState(null);

  useEffect(() => {
    if (!runId) {
      setRun(null);
      return;
    }
    let cancelled = false;
    let failures = 0;
    const poll = async () => {
      try {
        const data = await fetchRun(runId);
        if (cancelled) return;
        failures = 0;
        setRun(data);
        if (data.status === 'running' || data.status === 'stopping') {
          setTimeout(poll, 2000);
        }
      } catch {
        if (cancelled) return;
        failures += 1;
        if (failures >= 3) {
          setRun({ status: 'failed', output: 'Lost track of run.' });
        } else {
          setTimeout(poll, 2000);
        }
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  return run;
}
