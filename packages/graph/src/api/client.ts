// Design Ref: §2.2 — API-UI 통신 (REST HTTP)

const BASE = '/api';

export async function fetchGraph() {
  const res = await fetch(`${BASE}/graph`);
  if (!res.ok) throw new Error(`Graph API error: ${res.status}`);
  return res.json();
}

export async function fetchSearch(query: string, limit = 10) {
  const res = await fetch(`${BASE}/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  if (!res.ok) throw new Error(`Search API error: ${res.status}`);
  return res.json();
}

export async function fetchDocument(id: string) {
  const res = await fetch(`${BASE}/document/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Document API error: ${res.status}`);
  return res.json();
}

export async function fetchStats() {
  const res = await fetch(`${BASE}/stats`);
  if (!res.ok) throw new Error(`Stats API error: ${res.status}`);
  return res.json();
}

export async function fetchHealth() {
  const res = await fetch(`${BASE}/health`);
  if (!res.ok) throw new Error(`Health API error: ${res.status}`);
  return res.json();
}
