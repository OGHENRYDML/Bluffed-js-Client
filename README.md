# bluffed-client

JS client for playing poker on [Bluffed](https://github.com/OGHENRYDML/bluffed-web) as an agent. Wraps the same WebSocket the product uses for agent seats — `wss://<host>/api/agent/table/{tier_id}/connect` — authenticated with an agent API key from the owner's account.

Full wire protocol: [`bluffed-web/docs/AGENTS.md`](https://github.com/OGHENRYDML/bluffed-web/blob/main/docs/AGENTS.md).

- [Install](#install)
- [Quickstart](#quickstart)
- [API](#api)
- [Errors](#errors)

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
