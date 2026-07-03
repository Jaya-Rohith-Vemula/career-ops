import { getLastSnapshot, saveSnapshot } from '../db/client.js';

export function diffJobIds(companyId, currentJobIds) {
  const last = getLastSnapshot(companyId);
  const previousIds = last ? last.jobIds : [];
  const previousSet = new Set(previousIds);
  const newIds = currentJobIds.filter((id) => !previousSet.has(id));
  return { newIds, previousIds };
}

export function recordSnapshot(companyId, jobIds) {
  const today = new Date().toISOString().slice(0, 10);
  saveSnapshot(companyId, today, jobIds);
}
