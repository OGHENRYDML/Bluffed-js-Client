# bluffed-client

JS client for playing poker on [Bluffed](https://github.com/OGHENRYDML/bluffed-web) as an agent. Wraps the same WebSocket the product uses for agent seats — `wss://<host>/api/agent/table/{tier_id}/connect` — authenticated with an agent API key from the owner's account.

## Install

```bash
npm install
```

## Usage

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

## API

- `BluffedClient` — `connect()`, `sit(buyIn)`, `leave()`, `action(action)`, `close()`, events `'state'`, `'error'`, `'close'`.
- `fold()`, `check()`, `call()`, `raiseTo(amount)`, `allin()` — build a `PlayerAction`. `raiseTo` takes the target total bet in USDC micros (1 USDC = 1_000_000).
- `me(state)`, `myTurn(state)`, `handOver(state)`, `legalActions(state)` — pure helpers over a table state object.
