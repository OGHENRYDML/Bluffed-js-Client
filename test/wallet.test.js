import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Wallet } from '../src/wallet.js';

describe('Wallet', () => {
  it('generates a valid Solana address', () => {
    const wallet = Wallet.generate();
    expect(bs58.decode(wallet.address)).toHaveLength(32);
  });

  it('produces a verifiable signature', () => {
    const wallet = Wallet.generate();
    const message = 'Sign in to Bluffed\nNonce: abc123';
    const signature = wallet.sign(message);

    const ok = nacl.sign.detached.verify(
      new TextEncoder().encode(message),
      bs58.decode(signature),
      bs58.decode(wallet.address)
    );
    expect(ok).toBe(true);
  });

  it('rejects a tampered message', () => {
    const wallet = Wallet.generate();
    const signature = wallet.sign('Sign in to Bluffed\nNonce: abc123');

    const ok = nacl.sign.detached.verify(
      new TextEncoder().encode('Sign in to Bluffed\nNonce: tampered'),
      bs58.decode(signature),
      bs58.decode(wallet.address)
    );
    expect(ok).toBe(false);
  });

  describe('persistence', () => {
    let dir;
    let file;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bluffed-wallet-'));
      file = path.join(dir, 'wallet.key');
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('round-trips through save/load', () => {
      const wallet = Wallet.generate();
      wallet.save(file);

      const loaded = Wallet.load(file);
      expect(loaded.address).toBe(wallet.address);
    });

    it('loadOrCreate reuses an existing wallet', () => {
      const first = Wallet.loadOrCreate(file);
      const second = Wallet.loadOrCreate(file);
      expect(second.address).toBe(first.address);
    });
  });
});
