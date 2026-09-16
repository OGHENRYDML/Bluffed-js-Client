import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BluffedClient, BluffedError } from './client.js';
import { DEFAULT_BASE_URL } from './defaults.js';
import { DEFAULT_TIER_ID, getTier } from './tiers.js';
import { me, myTurn, handOver, legalActions } from './state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

const server = new McpServer({ name: 'bluffed-poker', version });

// A single table session at a time, same as bluffed_client.mcp_server on
// the Python side — sit_down() replaces whatever was here before.
let client = null;

function requireClient() {
  if (!client) throw new BluffedError('not seated — call sit_down first');
  return client;
}

function requireObservation() {
  const c = requireClient();
  if (!c.state) throw new BluffedError('no table state yet');
  return c.state;
}

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

// BluffedClient's sit()/action()/leave() are fire-and-forget sends — the
// actual effect only shows up later as a fresh 'state' broadcast. Every
// tool that changes the table (sit_down, take_action) needs to wait for
// the *next* broadcast that means "back to you" (myTurn) or "the hand is
// done" (handOver) before it can answer, the same way env.py's
// _await_turn_or_terminal blocks reset()/step() on the Python side. This
// deliberately never short-circuits on the client's already-cached state:
// take_action() is only reachable while it's already our turn (that's the
// state that satisfies myTurn right now, before the action even lands), so
// checking the cached state here would resolve immediately with the stale
// pre-action snapshot instead of waiting for what the action produced.
function awaitTurnOrOver(c, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new BluffedError(`timed out after ${timeoutMs}ms waiting for the table`));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      c.off('state', onState);
      c.off('error', onError);
      c.off('close', onClose);
    }
    function onState(state) {
      if (myTurn(state) || handOver(state)) {
        cleanup();
        resolve(state);
      }
    }
    function onError(err) {
      cleanup();
      reject(err);
    }
    function onClose() {
      cleanup();
      reject(new BluffedError('connection closed while waiting for the table'));
    }
    c.on('state', onState);
    c.on('error', onError);
    c.on('close', onClose);
  });
}

server.registerTool(
  'sit_down',
  {
    description:
      "Connect to a Bluffed table and sit down. buyIn is in USDC micros; omit it to use the tier's minimum.",
    inputSchema: {
      apiKey: z.string(),
      baseUrl: z.string().optional(),
      tierId: z.string().optional(),
      buyIn: z.number().int().optional()
    }
  },
  async ({ apiKey, baseUrl, tierId, buyIn }) => {
    if (client) {
      await client.close();
      client = null;
    }
    const resolvedTierId = tierId ?? DEFAULT_TIER_ID;
    const tier = getTier(resolvedTierId);
    if (!tier) throw new BluffedError(`unknown tierId "${resolvedTierId}"`);
    const resolvedBuyIn = buyIn ?? tier.minBuyIn;

    const c = new BluffedClient({ apiKey, baseUrl: baseUrl ?? DEFAULT_BASE_URL, tierId: resolvedTierId });
    await c.connect();
    c.sit(resolvedBuyIn);
    const state = await awaitTurnOrOver(c);
    client = c;
    return textResult({ observation: state, info: { myId: me(state)?.id ?? null } });
  }
);

server.registerTool(
  'get_observation',
  { description: 'Return the last known table state without taking an action.' },
  async () => textResult(requireObservation())
);

server.registerTool(
  'legal_actions',
  { description: 'List the actions currently legal for this agent.' },
  async () => textResult(legalActions(requireObservation()))
);

const ACTION_TYPES = ['fold', 'check', 'call', 'raise', 'allin'];

server.registerTool(
  'take_action',
  {
    description: 'Take one action on the agent\'s turn: fold, check, call, raise (with `to`), or allin.',
    inputSchema: {
      actionType: z.enum(ACTION_TYPES),
      to: z.number().int().optional()
    }
  },
  async ({ actionType, to }) => {
    const c = requireClient();
    c.action(to !== undefined ? { type: actionType, to } : { type: actionType });
    const state = await awaitTurnOrOver(c);
    return textResult({ observation: state });
  }
);

server.registerTool(
  'leave_table',
  { description: 'Stand up from the table and close the connection.' },
  async () => {
    if (client) {
      try {
        client.leave();
      } catch {
        // already disconnected — nothing to leave from
      }
      await client.close();
      client = null;
    }
    return textResult({ ok: true });
  }
);

export async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export { server };
