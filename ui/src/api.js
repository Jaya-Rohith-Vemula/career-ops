async function request(path, options) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export function getStats() {
  return request('/stats');
}

export function getJobs(params = {}) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
  ).toString();
  return request(`/jobs${query ? `?${query}` : ''}`);
}

export function updateJobStatus(companyId, jobId, status) {
  return request(`/jobs/${companyId}/${encodeURIComponent(jobId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function getCompanies() {
  return request('/companies');
}

export function addCompany(name, url) {
  return request('/companies', { method: 'POST', body: JSON.stringify({ name, url }) });
}

export function rediscoverCompany(id, url) {
  return request(`/companies/${id}/rediscover`, { method: 'POST', body: JSON.stringify({ url }) });
}

export function deleteCompany(id) {
  return request(`/companies/${id}`, { method: 'DELETE' });
}

export function triggerDailyRun(companyIds) {
  return request('/runs/daily', {
    method: 'POST',
    body: JSON.stringify(companyIds && companyIds.length ? { companyIds } : {}),
  });
}

export function getRun(runId) {
  return request(`/runs/${runId}`);
}

export function stopRun(runId) {
  return request(`/runs/${runId}/stop`, { method: 'POST' });
}

export function getActiveRun() {
  return request('/runs/active');
}
