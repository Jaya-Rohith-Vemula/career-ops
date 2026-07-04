export default function RunOutputPanel({ run, onDismiss }) {
  if (!run) return null;
  const isBusy = run.status === 'running' || run.status === 'stopping';

  return (
    <div className="run-output">
      <strong>Run status: {run.status}</strong>
      {!isBusy && (
        <button type="button" className="pl-4" onClick={onDismiss}>
          Dismiss
        </button>
      )}
      <pre>{run.output}</pre>
    </div>
  );
}
