import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { DEFAULT_BASE_URL } from './defaults.js';
import { DEFAULT_TIER_ID } from './tiers.js';

export class BluffedError extends Error {}

export class TableError extends BluffedError {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export class BluffedClient extends EventEmitter {
  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, tierId = DEFAULT_TIER_ID }) {
    super();
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.tierId = tierId;
    this.state = null;
    this.ws = null;
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

      ws.once('open', () => resolve());
      ws.once('error', (err) => reject(err));

      ws.on('message', (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (msg.type === 'state') {
          this.state = msg.state;
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
  }

  action(action) {
    this._send({ type: 'action', action });
  }

  close() {
    this.ws?.close();
    this.ws = null;
  }
}
