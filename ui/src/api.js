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
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0))
      .map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v])
  ).toString();
  return request(`/jobs${query ? `?${query}` : ''}`);
}

export function updateJobStatus(companyId, jobId, status) {
  return request(`/jobs/${companyId}/${encodeURIComponent(jobId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function setJobLocationBucket(companyId, jobId, bucket) {
  return request(`/jobs/${companyId}/${encodeURIComponent(jobId)}/location-bucket`, {
    method: 'PATCH',
    body: JSON.stringify({ bucket }),
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

export function getYcCompanies() {
  return request('/yc/companies');
}

export function importYcCompanies(companies) {
  return request('/yc/companies/import', {
    method: 'POST',
    body: JSON.stringify({ companies }),
  });
}

export function triggerBuiltinScrape() {
  return request('/sourcing/builtin', { method: 'POST' });
}

export function getBuiltinActiveRun() {
  return request('/sourcing/builtin/active');
}

export function getBuiltinRun(runId) {
  return request(`/sourcing/builtin/${runId}`);
}

export function importBuiltinCompanies(companies) {
  return request('/sourcing/builtin/import', {
    method: 'POST',
    body: JSON.stringify({ companies }),
  });
}

export function getKeywords() {
  return request('/keywords');
}

export function addKeyword(keyword) {
  return request('/keywords', { method: 'POST', body: JSON.stringify({ keyword }) });
}

export function updateKeyword(id, enabled) {
  return request(`/keywords/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
}

export function deleteKeyword(id) {
  return request(`/keywords/${id}`, { method: 'DELETE' });
}

export function getLocationSignals() {
  return request('/location-signals');
}

export function addLocationSignal(signal, bucket) {
  return request('/location-signals', { method: 'POST', body: JSON.stringify({ signal, bucket }) });
}

export function updateLocationSignal(id, enabled) {
  return request(`/location-signals/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
}

export function deleteLocationSignal(id) {
  return request(`/location-signals/${id}`, { method: 'DELETE' });
}

export function tailorResume(companyId, jobId) {
  return request('/resume/tailor', {
    method: 'POST',
    body: JSON.stringify({ companyId, jobId }),
  });
}

export function getTailorRun(runId) {
  return request(`/resume/tailor/${runId}`);
}

export function getTailorDownloadUrl(runId) {
  return `/api/resume/tailor/${runId}/download`;
}
