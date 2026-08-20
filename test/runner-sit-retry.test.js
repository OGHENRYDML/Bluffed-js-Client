import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { playOneHand } from '../src/runner.js';
import { TableError } from '../src/client.js';

class FlakyClient extends EventEmitter {
  constructor(errorSequence) {
    super();
    this.seated = false;
    this.state = null;
    this.tierId = 't_low';
    this.handTimeoutMs = 30_000;
    this._errors = [...errorSequence];
    this.connectCalls = 0;
    this.sitCalls = 0;
  }

  async connect() {
    this.connectCalls += 1;
  }

  sit() {
    this.sitCalls += 1;
    const code = this._errors.shift();
    queueMicrotask(() => {
      if (code) {
        this.emit('error', new TableError(code));
      } else {
        this.emit('state', {
          id: 't1',
          phase: 'handComplete',
          currentTurnSeat: null,
          players: [{ id: 'me', seat: 0, chips: 1000, isYou: true }]
        });
      }
    });
  }

  action() {}
  async close() {}
}

describe('playOneHand: retries a fresh connect on a transient sit rejection', () => {
  it('retries and succeeds after table_full', async () => {
    const client = new FlakyClient(['table_full']);
    const events = [];

    const { chipsDelta } = await playOneHand(client, 1000, () => ({ type: 'fold' }), (kind, data) => events.push([kind, data]));

    expect(chipsDelta).toBe(0);
    expect(client.connectCalls).toBe(2);
    expect(events.map(([kind]) => kind)).toEqual(['connecting', 'connected', 'retrying_seat', 'connecting', 'connected']);
  });

  it('retries on same_owner_already_seated too', async () => {
    const client = new FlakyClient(['same_owner_already_seated']);
    await playOneHand(client, 1000, () => ({ type: 'fold' }), () => {});
    expect(client.connectCalls).toBe(2);
  });

  it('gives up after exhausting retries', async () => {
    const client = new FlakyClient(['table_full', 'table_full', 'table_full', 'table_full']);
    await expect(playOneHand(client, 1000, () => ({ type: 'fold' }), () => {})).rejects.toThrow('table_full');
  });

  it('does not retry a non-transient table error', async () => {
    const client = new FlakyClient(['buyin_out_of_range']);
    await expect(playOneHand(client, 1000, () => ({ type: 'fold' }), () => {})).rejects.toThrow('buyin_out_of_range');
    expect(client.connectCalls).toBe(1);
  });
});
