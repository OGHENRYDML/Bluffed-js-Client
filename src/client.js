import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { DEFAULT_BASE_URL } from './defaults.js';
import { DEFAULT_TIER_ID } from './tiers.js';
import { me } from './state.js';

export class BluffedError extends Error {}

export class TableError extends BluffedError {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BluffedClient extends EventEmitter {
  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, tierId = DEFAULT_TIER_ID, connectTimeoutMs = 10_000, handTimeoutMs = 30_000 }) {
    super();
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.tierId = tierId;
    this.connectTimeoutMs = connectTimeoutMs;
    this.handTimeoutMs = handTimeoutMs;
    this.state = null;
    this.ws = null;
    // Tracks whether the *last known* state included us — kept in sync
    // automatically from every incoming 'state' broadcast (see the message
    // handler below), not just set once at sit time. This is what lets
    // playOneHand() tell "still connected and seated, resume in place" from
    // "need a fresh connect+sit", and what close() checks to decide whether
    // it needs to leave() before disconnecting.
    this.seated = false;
  }

  _wsUrl() {
    const scheme = this.baseUrl.startsWith('https') ? 'wss' : 'ws';
    const host = this.baseUrl.split('://')[1];
    return `${scheme}://${host}/api/agent/table/${this.tierId}/connect?key=${this.apiKey}`;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this._wsUrl());
      this.ws = ws;

      // The table-connect WebSocket upgrade can go unanswered server-side
      // (e.g. an unreachable table backend) with no error at all — without
      // this, that leaves the promise pending forever and the caller with
      // no way to tell "still connecting" from "stuck".
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new BluffedError(`timed out connecting after ${this.connectTimeoutMs}ms`));
      }, this.connectTimeoutMs);

      ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      ws.on('message', (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (msg.type === 'state') {
          this.state = msg.state;
          this.seated = me(msg.state) !== null;
          this.emit('state', msg.state);
        } else if (msg.type === 'error') {
          this.emit('error', new TableError(msg.error));
        }
      });

      ws.on('close', () => this.emit('close'));
    });
  }

  _send(payload) {
    if (!this.ws) throw new BluffedError('not connected — call connect() first');
    this.ws.send(JSON.stringify(payload));
  }

  sit(buyIn) {
    this._send({ type: 'sit', buyIn });
  }

  leave() {
    this._send({ type: 'leave' });
    this.seated = false;
  }

  action(action) {
    this._send({ type: 'action', action });
  }

  /**
   * The server never drops a merely-disconnected player from their seat
   * (only an explicit 'leave' does) — closing the socket while still
   * seated without this would leave a zombie seat, and the *next* connect
   * for this same agent would come back same_owner_already_seated (or,
   * once reused for a fresh table, just silently stay occupied forever).
   */
  async close() {
    if (this.seated && this.ws) {
      try {
        this.ws.send(JSON.stringify({ type: 'leave' }));
        await sleep(200);
      } catch {
        // socket already gone — nothing to leave from
      }
      this.seated = false;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // already closed/closing
      }
      this.ws = null;
    }
  }
}
