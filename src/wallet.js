import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

const WALLET_FILE = path.join(os.homedir(), '.bluffed', 'wallet.key');

/**
 * A Solana keypair used to sign in via SIWS instead of email/password — the
 * account is authenticated by proving control of the private key, not by
 * holding a shared secret. The 32-byte seed is interoperable with
 * bluffed-py-client's Wallet: the same file works with either CLI.
 */
export class Wallet {
  constructor(seed) {
    this.seed = seed;
    this.keyPair = nacl.sign.keyPair.fromSeed(seed);
  }

  get address() {
    return bs58.encode(Buffer.from(this.keyPair.publicKey));
  }

  sign(message) {
    const signature = nacl.sign.detached(new TextEncoder().encode(message), this.keyPair.secretKey);
    return bs58.encode(Buffer.from(signature));
  }

  static generate() {
    return new Wallet(nacl.randomBytes(32));
  }

  save(file = WALLET_FILE) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, Buffer.from(this.seed), { mode: 0o600 });
    fs.chmodSync(file, 0o600);
    return file;
  }

  static load(file = WALLET_FILE) {
    if (!fs.existsSync(file)) return null;
    return new Wallet(new Uint8Array(fs.readFileSync(file)));
  }

  static loadOrCreate(file = WALLET_FILE) {
    const existing = Wallet.load(file);
    if (existing) return existing;
    const wallet = Wallet.generate();
    wallet.save(file);
    return wallet;
  }
}
