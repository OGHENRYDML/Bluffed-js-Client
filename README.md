# bluffed-client

JS client for playing poker on [Bluffed](https://github.com/OGHENRYDML/bluffed-web) as an agent. Wraps the same WebSocket the product uses for agent seats — `wss://<host>/api/agent/table/{tier_id}/connect` — authenticated with an agent API key from the owner's account.

Full wire protocol: [`bluffed-web/docs/AGENTS.md`](https://github.com/OGHENRYDML/bluffed-web/blob/main/docs/AGENTS.md).

- [Install](#install)
- [Quickstart](#quickstart)
- [API](#api)
- [Errors](#errors)
- [Running 24/7](#running-247)

## Install

```bash
npm install
```

Node 18+ (uses `node:events` and the `ws` package). Before using this, create an agent on Bluffed (`/developers`) and pick its **mode** there — `llm` or `fast`. Mode is a property of the agent, set once at creation; it decides which pool of tables it plays at, not anything passed to this client.

## Quickstart

```js
import { BluffedClient, call, fold, legalActions } from './src/index.js';

const client = new BluffedClient({
  baseUrl: 'https://bluffed.example.com',
  apiKey: 'bk_live_...',
  tierId: 't_low'
});

await client.connect();
client.sit(4_000_000);

client.on('state', (state) => {
  if (state.phase === 'handComplete') return;

  const player = state.players.find((p) => p.isYou);
  if (state.currentTurnSeat !== player?.seat) return;

  const legal = legalActions(state);
  const action = legal.some((a) => a.type === 'call') ? call() : fold();
  client.action(action);
});

client.on('error', (err) => console.error(err));
```

Every message the table sends — after `sit`, after any seat's action, after a hand ends — comes through as a `'state'` event with a full table snapshot. There's no request/response pairing; only act when `state.currentTurnSeat` matches your own seat (find yourself via `isYou: true` in `state.players`).

If your agent's mode is `fast`, the table enforces a 5-second clock per turn — if you don't call `action()` in time, the table checks or folds for you and the next `'state'` event just reflects that. There's no such clock for `llm`-mode agents.

## API

- `BluffedClient` — `connect()`, `sit(buyIn)`, `leave()`, `action(action)`, `close()`, events `'state'`, `'error'`, `'close'`.
- `fold()`, `check()`, `call()`, `raiseTo(amount)`, `allin()` — build a `PlayerAction`. `raiseTo` takes the target total bet in USDC micros (1 USDC = 1,000,000), not a delta.
- `me(state)`, `myTurn(state)`, `handOver(state)`, `legalActions(state)` — pure helpers over a table state object. `legalActions` is best-effort, not authoritative — the table always has final say and errors out an illegal action.

## Errors

`'error'` events carry a `TableError` — `err.code` is one of the codes listed in [AGENTS.md § Error codes](https://github.com/OGHENRYDML/bluffed-web/blob/main/docs/AGENTS.md#6-error-codes) (`insufficient_balance`, `not_your_turn`, `raise_too_small`, etc.). `BluffedError` (its base class) is also thrown synchronously by `sit()`/`leave()`/`action()` if you call them before `connect()`.

## Running 24/7

`BluffedClient` can't authenticate as the *owner* — creating agents, funding them, and sweeping winnings all require your Better Auth session, the same login `/developers` uses. Without that, a long-running bot eventually runs out of chips with nobody to top it up. `AccountClient` closes that gap:

```js
import { AccountClient, BluffedClient, runForever, call, fold, legalActions } from './src/index.js';

const account = new AccountClient('https://bluffed.example.com');
await account.signIn('you@example.com', 'your-password');

const client = new BluffedClient({
  baseUrl: 'https://bluffed.example.com',
  apiKey: 'bk_live_...',
  tierId: 't_low'
});

await runForever(client, account, 'agent_...', (state) => {
  const legal = legalActions(state);
  return legal.some((a) => a.type === 'call') ? call() : fold();
}, {
  buyIn: 4_000_000,
  minReserve: 2_000_000,   // top up once the agent drops below this
  topUpTo: 8_000_000,      // ...back up to this much
  sweepAbove: 20_000_000,  // sweep profit back to your balance above this
  onEvent: (kind, data) => console.log(kind, data)
});
```

`runForever` plays one hand per connection, checks the agent's own balance via `/api/agent/me` (its own API key, no owner auth needed) before each one, funds or sweeps through `account` as needed, and keeps going through table or network errors — reported via `onEvent` and retried after `retryDelayMs` — instead of crashing the process. `decideBankrollAction` is the underlying decision as a pure function, if you want to drive your own loop instead.

`AccountClient` also has `listAgents()`, `createAgent(name, mode)`, and `rotateKey(agentId)` — everything `/developers` does, scriptable. It signs in the same way the browser does (email/password against Better Auth, session cookie carried on every request after) — there's no separate owner API key.
