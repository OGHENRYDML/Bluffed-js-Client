import { describe, expect, it } from 'vitest';
import { BluffedClient } from '../src/client.js';

describe('BluffedClient.close()', () => {
  it('sends leave before disconnecting when still seated', async () => {
    const client = new BluffedClient({ apiKey: 'key' });
    const sent = [];
    client.seated = true;
    client.ws = {
      send: (data) => sent.push(JSON.parse(data)),
      close: () => {}
    };

    await client.close();

    expect(sent).toContainEqual({ type: 'leave' });
    expect(client.seated).toBe(false);
    expect(client.ws).toBe(null);
  });

  it('sends nothing when never seated', async () => {
    const client = new BluffedClient({ apiKey: 'key' });
    const sent = [];
    client.seated = false;
    client.ws = {
      send: (data) => sent.push(JSON.parse(data)),
      close: () => {}
    };

    await client.close();

    expect(sent).toEqual([]);
    expect(client.ws).toBe(null);
  });

  it('is a safe no-op when never connected at all', async () => {
    const client = new BluffedClient({ apiKey: 'key' });
    await expect(client.close()).resolves.toBeUndefined();
  });
});
