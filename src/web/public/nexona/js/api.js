/**
 * Nexona API client.
 * Handles base URL, JSON, session cookies, and error normalization.
 */

export class ApiError extends Error {
  constructor(status, body, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Called when any API request returns 401 (session expired / not authenticated).
 * The router sets this to redirect to login. Views can also catch ApiError locally
 * for granular handling (e.g., inline form errors vs. hard redirect).
 */
export let onUnauthorized;

const BASE = '/api';

function parseJSON(text) {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function request(path, init = {}) {
  const res = await fetch(BASE + path, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });
  const text = await res.text();
  const body = parseJSON(text);
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    const msg = body?.error ?? text ?? res.statusText;
    throw new ApiError(res.status, body, msg);
  }
  return body;
}

// ── Auth ──────────────────────────────────────
async function session() {
  return request('/me');
}
async function signup(data) {
  return request('/auth/signup', { method: 'POST', body: JSON.stringify(data) });
}
async function login(data) {
  return request('/auth/login', { method: 'POST', body: JSON.stringify(data) });
}
async function logout() {
  await request('/auth/logout', { method: 'POST' });
}
async function forgot(data) {
  return request('/auth/forgot', { method: 'POST', body: JSON.stringify(data) });
}
async function forgotVerify(data) {
  return request('/auth/forgot/verify', { method: 'POST', body: JSON.stringify(data) });
}
async function reset(data) {
  return request('/auth/reset', { method: 'POST', body: JSON.stringify(data) });
}

// ── Account ───────────────────────────────────
async function changePassword(data) {
  return request('/account/password', { method: 'POST', body: JSON.stringify(data) });
}
async function listSessions() {
  return request('/account/sessions');
}
async function revokeOtherSessions() {
  return request('/account/sessions/revoke-others', { method: 'POST' });
}
async function updateProfile(data) {
  return request('/account/profile', { method: 'POST', body: JSON.stringify(data) });
}
async function updatePreferences(prefs) {
  return request('/account/preferences', { method: 'POST', body: JSON.stringify(prefs) });
}
async function getPreferences() {
  return request('/account/preferences');
}

// ── Authenticator ─────────────────────────────
async function authenticatorStatus() {
  return request('/account/authenticator');
}
async function setupAuthenticator(currentPassword) {
  return request('/account/authenticator/setup', { method: 'POST', body: JSON.stringify({ currentPassword }) });
}
async function enableAuthenticator(code) {
  return request('/account/authenticator/enable', { method: 'POST', body: JSON.stringify({ code }) });
}
async function disableAuthenticator(code) {
  return request('/account/authenticator/disable', { method: 'POST', body: JSON.stringify({ code }) });
}

// ── Security events ───────────────────────────
async function securityEvents() {
  return request('/account/security-events');
}

// ── Projects ──────────────────────────────────
async function listProjects() {
  return request('/projects');
}
async function createProject(data) {
  return request('/projects', { method: 'POST', body: JSON.stringify(data) });
}
async function getProject(id) {
  return request(`/projects/${encodeURIComponent(id)}`);
}
async function deleteProject(id) {
  await request(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
async function updateProject(id, data) {
  return request(`/projects/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) });
}

// ── Pipeline ──────────────────────────────────
async function runStage(projectId, stageId) {
  return request(`/projects/${encodeURIComponent(projectId)}/run/${stageId}`, { method: 'POST' });
}
async function approveBlueprint(projectId) {
  return request(`/projects/${encodeURIComponent(projectId)}/approve`, { method: 'POST' });
}

// ── Providers ─────────────────────────────────
async function listModels(params = {}) {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.availableOnly) qs.set('availableOnly', 'true');
  return request(`/models?${qs.toString()}`);
}
async function getModel(providerId, modelId) {
  return request(`/models/${encodeURIComponent(providerId)}/${encodeURIComponent(modelId)}`);
}
async function getSelection() {
  return request('/models/selection');
}
async function selectModel(providerId, modelId) {
  return request('/models/select', { method: 'POST', body: JSON.stringify({ providerId, modelId }) });
}
async function listCredentials() {
  return request('/credentials');
}
async function addCredential(providerId, secret) {
  return request('/credentials', { method: 'POST', body: JSON.stringify({ providerId, secret }) });
}
async function removeCredential(id) {
  await request(`/credentials/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
async function verifyCredential(id) {
  return request(`/credentials/${encodeURIComponent(id)}/verify`, { method: 'POST' });
}

// ── Documents ───────────────────────────────
async function uploadDocument(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/documents/upload', {
    method: 'POST',
    credentials: 'same-origin',
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    throw new ApiError(res.status, body, body?.error ?? text);
  }
  return await res.json();
}
async function listDocuments() {
  return request('/documents');
}
async function getDocument(id) {
  return request(`/documents/${encodeURIComponent(id)}?full=true`);
}
async function deleteDocument(id) {
  await request(`/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
async function chatIngest(text) {
  return request('/chat/ingest', { method: 'POST', body: JSON.stringify({ text }) });
}

// ── Summary (engine showcase) ───────────────
async function summary() {
  return request('/summary');
}

// ── Activity ────────────────────────────────
async function activity() {
  return request('/activity');
}

// ── Pipeline stages (Stage 8) ─────────────────────
async function getDiscovery() {
  return request('/discovery');
}
async function getDesign() {
  return request('/design');
}
async function getCouncil() {
  return request('/council');
}
async function getVerification() {
  return request('/verification');
}
async function getTesting() {
  return request('/testing');
}
async function getDeployment() {
  return request('/deployment');
}
async function getTelemetry() {
  return request('/telemetry');
}
async function getContinuous() {
  return request('/continuous');
}

export const api = {
  session, signup, login, logout, forgot, forgotVerify, reset,
  changePassword, listSessions, revokeOtherSessions,
  updateProfile, updatePreferences, getPreferences,
  authenticatorStatus, setupAuthenticator, enableAuthenticator, disableAuthenticator,
  securityEvents,
  listProjects, createProject, getProject, deleteProject, updateProject,
  runStage, approveBlueprint,
  listModels, getModel, getSelection, selectModel,
  listCredentials, addCredential, removeCredential, verifyCredential,
  uploadDocument, listDocuments, getDocument, deleteDocument, chatIngest,
  summary, activity,
  getDiscovery, getDesign, getCouncil, getVerification, getTesting,
  getDeployment, getTelemetry, getContinuous,
};
