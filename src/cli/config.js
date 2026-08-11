import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CONFIG_DIR = path.join(os.homedir(), '.bluffed');
const SESSION_FILE = path.join(CONFIG_DIR, 'session.json');
const AGENTS_DIR = path.join(CONFIG_DIR, 'agents');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
}

// Field names match bluffed-py-client's ~/.bluffed/session.json so either
// CLI can pick up a session the other one created.
export function saveSession(baseUrl, cookies) {
  ensureDir(CONFIG_DIR);
  fs.writeFileSync(SESSION_FILE, JSON.stringify({ base_url: baseUrl, cookies }), { mode: 0o600 });
  fs.chmodSync(SESSION_FILE, 0o600);
}

export function loadSession() {
  if (!fs.existsSync(SESSION_FILE)) return null;
  const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  return { baseUrl: data.base_url, cookies: data.cookies };
}

export function saveAgentKey(agentId, apiKey) {
  ensureDir(AGENTS_DIR);
  const file = path.join(AGENTS_DIR, `${agentId}.key`);
  fs.writeFileSync(file, apiKey, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

export function loadAgentKey(agentId) {
  const file = path.join(AGENTS_DIR, `${agentId}.key`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : null;
}
