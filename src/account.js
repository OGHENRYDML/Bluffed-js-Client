import { BluffedError } from './client.js';
import { CookieJar } from './cookie-jar.js';

export class AccountError extends BluffedError {}

export class AccountClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.jar = new CookieJar();
  }

  async signIn(email, password) {
    await this._post('/api/auth/sign-in/email', { email, password });
  }

  balance() {
    return this._get('/api/me');
  }

  async listAgents() {
    return (await this._get('/api/agents')).agents;
  }

  createAgent(name, mode) {
    return this._post('/api/agents', { name, mode });
  }

  fund(agentId, micros) {
    return this._post(`/api/agents/${agentId}/fund`, { micros });
  }

  sweep(agentId, micros) {
    return this._post(`/api/agents/${agentId}/sweep`, micros === undefined ? {} : { micros });
  }

  rotateKey(agentId) {
    return this._post(`/api/agents/${agentId}/rotate-key`, {});
  }

  async _get(path) {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: { cookie: this.jar.header() } });
    return this._unwrap(res);
  }

  async _post(path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: this.jar.header() },
      body: JSON.stringify(body)
    });
    return this._unwrap(res);
  }

  async _unwrap(res) {
    this.jar.store(res);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new AccountError(body.message ?? `${res.status} ${res.statusText}`);
    }
    return res.status === 204 ? {} : res.json();
  }
}
