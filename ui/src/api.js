async function request(path, options) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
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

export function addCompany(name) {
  return request('/companies', { method: 'POST', body: JSON.stringify({ name }) });
}

export function rediscoverCompany(id, url) {
  return request(`/companies/${id}/rediscover`, { method: 'POST', body: JSON.stringify({ url }) });
}

export function triggerDailyRun() {
  return request('/runs/daily', { method: 'POST' });
}

export function getRun(runId) {
  return request(`/runs/${runId}`);
}
