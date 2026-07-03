import { useEffect, useState } from 'react';
import { getRun } from './api';

export function useRunPolling(runId) {
  const [run, setRun] = useState(null);

  useEffect(() => {
    if (!runId) {
      setRun(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await getRun(runId);
        if (cancelled) return;
        setRun(data);
        if (data.status === 'running') {
          setTimeout(poll, 2000);
        }
      } catch {
        if (!cancelled) setRun({ status: 'failed', output: 'Lost track of run.' });
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  return run;
}
