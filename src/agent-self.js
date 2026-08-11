import { BluffedError } from './client.js';

export async function getAgentStatus(baseUrl, apiKey) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/agent/me`, {
    headers: { authorization: `Bearer ${apiKey}` }
  });
  if (!res.ok) throw new BluffedError(`${res.status} ${res.statusText}`);
  return res.json();
}
