import { BluffedError } from './client.js';
import { CookieJar } from './cookie-jar.js';
import { DEFAULT_BASE_URL } from './defaults.js';

export class AccountError extends BluffedError {}

const DEFAULT_CHAIN_ID = 103; // Solana devnet — matches the server's siws.ts default

export class AccountClient {
  constructor(baseUrl = DEFAULT_BASE_URL, { timeoutMs = 15_000 } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.jar = new CookieJar();
  }

  async signIn(email, password) {
    await this._post('/api/auth/sign-in/email', { email, password });
  }

  /**
   * Sign in with a Solana keypair instead of email/password — no inbox
   * required. Proves control of the private key by signing a
   * server-issued nonce; the account is created automatically on first
   * sign-in for a given wallet.
   */
  async signInWithWallet(wallet, chainId = DEFAULT_CHAIN_ID) {
    const { nonce } = await this._post('/api/auth/siws/nonce', { walletAddress: wallet.address, chainId });
    const message = `Sign in to Bluffed\nNonce: ${nonce}`;
    await this._post('/api/auth/siws/verify', {
      message,
      signature: wallet.sign(message),
      walletAddress: wallet.address,
      chainId
    });
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

  async depositAddress() {
    return (await this._get('/api/deposit')).address;
  }

  confirmDeposit(txSig) {
    return this._post('/api/deposit', { txSig });
  }

  pollDeposit() {
    return this._get('/api/deposit/poll');
  }

  withdraw(toAddress, micros) {
    return this._post('/api/withdraw', { toAddress, micros });
  }

  withdrawalStatus(withdrawalId) {
    return this._get(`/api/withdraw/${withdrawalId}`);
  }

  exportCookies() {
    return Object.fromEntries(this.jar.cookies);
  }

  importCookies(cookies) {
    for (const [k, v] of Object.entries(cookies)) this.jar.cookies.set(k, v);
  }

  async _fetch(path, init) {
    try {
      return await fetch(`${this.baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      // A network failure or timeout throws the raw fetch/DOMException,
      // not an AccountError — every other failure mode from this class
      // (4xx/5xx, bad JSON) already comes back as one, so callers only
      // have to handle one exception type instead of two.
      const reason = err.name === 'TimeoutError' ? `timed out after ${this.timeoutMs}ms` : err.message;
      throw new AccountError(reason);
    }
  }

  async _get(path) {
    const res = await this._fetch(path, { headers: { cookie: this.jar.header() } });
    return this._unwrap(res);
  }

  async _post(path, body) {
    const res = await this._fetch(path, {
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
