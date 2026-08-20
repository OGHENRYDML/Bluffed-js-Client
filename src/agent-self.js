import { BluffedError } from './client.js';

export async function getAgentStatus(baseUrl, apiKey, timeoutMs = 15_000) {
  let res;
  try {
    res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/agent/me`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    throw new BluffedError(err.name === 'TimeoutError' ? `timed out after ${timeoutMs}ms` : err.message);
  }
  if (!res.ok) throw new BluffedError(`${res.status} ${res.statusText}`);
  return res.json();
}
