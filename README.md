# bluffed-client

JS client for playing poker on [Bluffed](https://github.com/OGHENRYDML/bluffed-web) as an agent. Wraps the same WebSocket the product uses for agent seats — `wss://<host>/api/agent/table/{tier_id}/connect` — authenticated with an agent API key from the owner's account.

Full wire protocol: [`bluffed-web/docs/AGENTS.md`](https://github.com/OGHENRYDML/bluffed-web/blob/main/docs/AGENTS.md).

- [Install](#install)
- [Quickstart](#quickstart)
- [Stake tiers](#stake-tiers)
- [API](#api)
- [Errors](#errors)
- [Running 24/7](#running-247)
- [CLI](#cli)

## Install

```bash
npm install
```

Node 18+ (uses `node:events` and the `ws` package). Before using this, create an agent on Bluffed (`/developers`) and pick its **mode** there — `llm` or `fast`. Mode is a property of the agent, set once at creation; it decides which pool of tables it plays at, not anything passed to this client.

`BluffedClient` only strictly needs an `apiKey` — `baseUrl` defaults to `https://bluffed.online` and `tierId` defaults to `t_low`, so `new BluffedClient({ apiKey })` is enough to get moving.

**Choosing a tier** happens once, at construction — `tierId` is fixed for the lifetime of that `BluffedClient`/connection, not something the agent switches hand to hand. To play a different tier, `client.close()` and construct a new `BluffedClient({ apiKey, tierId: 't_mid' })`. See [Stake tiers](#stake-tiers) below for the available ids.

## Quickstart

```js
import { BluffedClient, call, fold, legalActions, usdc } from './src/index.js';

const client = new BluffedClient({ apiKey: 'bk_live_...' });

await client.connect();
client.sit(usdc(4.00));

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

## Stake tiers

```js
import { STAKE_TIERS, getTier } from './src/index.js';

getTier('t_mid').minBuyIn; // 20_000_000 (micros) == $20.00
```

| id | blinds | buy-in range |
| --- | --- | --- |
| `t_micro` | $0.01 / $0.02 | $0.80 – $2.00 |
| `t_low` (default) | $0.05 / $0.10 | $4.00 – $10.00 |
| `t_mid` | $0.25 / $0.50 | $20.00 – $50.00 |
| `t_high` | $1 / $2 | $80.00 – $200.00 |

`STAKE_TIERS` is an array of `{ id, smallBlind, bigBlind, minBuyIn, maxBuyIn, maxSeats }`, all money in USDC micros; `getTier(tierId)` returns the matching one or `null`. This is what the CLI uses internally to fill in `--buy-in`/`--min-reserve`/`--top-up-to`/`--sweep-above` when you don't pass them explicitly — every table in a tier has 6 max seats.

## API

- `BluffedClient` — `connect()`, `sit(buyIn)`, `leave()`, `action(action)`, `close()`, events `'state'`, `'error'`, `'close'`.
- `fold()`, `check()`, `call()`, `allin()` — **discrete** actions, no parameters.
- `raiseTo(amount)` — the one **continuous** action. Builds a `PlayerAction` with `amount` as the target total bet for this street, in USDC micros — not a delta. Any integer in the legal range works, not just the min or max. `raiseTo(usdc(2.00))` reads better than `raiseTo(2_000_000)`.
- `me(state)`, `myTurn(state)`, `handOver(state)`, `legalActions(state)` — pure helpers over a table state object. `legalActions` is best-effort, not authoritative — the table always has final say and errors out an illegal action. For `raise` it only ever includes the *minimum* legal `to`, not the range.
- `raiseBounds(state)` — `{ min, max }`, the full range of legal `raiseTo` targets, or `null` if raising isn't legal right now (not your turn, already folded/all-in, or your stack behind is too short to meet the table's minimum raise — you can still `allin()` in that case, just not `raiseTo()`):
  ```js
  const bounds = raiseBounds(state);
  const action = bounds ? raiseTo(Math.min(bounds.max, bounds.min * 2)) : call();
  ```
- `usdc(dollars)` / `fmtUsdc(micros)` — convert between dollars and the micros every wire amount uses, exactly (rounds to the nearest micro, no float drift). `fmtUsdc(state.pot)` → `"$4.00"`.

## Errors

`'error'` events carry a `TableError` — `err.code` is one of the codes listed in [AGENTS.md § Error codes](https://github.com/OGHENRYDML/bluffed-web/blob/main/docs/AGENTS.md#6-error-codes) (`insufficient_balance`, `not_your_turn`, `raise_too_small`, etc.). `BluffedError` (its base class) is also thrown synchronously by `sit()`/`leave()`/`action()` if you call them before `connect()`.

## Running 24/7

`BluffedClient` can't authenticate as the *owner* — creating agents, funding them, and sweeping winnings all require your Better Auth session, the same login `/developers` uses. Without that, a long-running bot eventually runs out of chips with nobody to top it up. `AccountClient` closes that gap:

```js
import { AccountClient, BluffedClient, runForever, call, fold, legalActions, usdc } from './src/index.js';

const account = new AccountClient(); // defaults to https://bluffed.online
await account.signIn('you@example.com', 'your-password');

const client = new BluffedClient({ apiKey: 'bk_live_...' });

await runForever(client, account, 'agent_...', (state) => {
  const legal = legalActions(state);
  return legal.some((a) => a.type === 'call') ? call() : fold();
}, {
  buyIn: usdc(4.00),
  minReserve: usdc(2.00),   // top up once the agent drops below this
  topUpTo: usdc(8.00),      // ...back up to this much
  sweepAbove: usdc(20.00),  // sweep profit back to your balance above this
  onEvent: (kind, data) => console.log(kind, data)
});
```

`runForever` plays one hand per connection, checks the agent's own balance via `/api/agent/me` (its own API key, no owner auth needed) before each one, funds or sweeps through `account` as needed, and keeps going through table or network errors — reported via `onEvent` and retried after `retryDelayMs` — instead of crashing the process. `decideBankrollAction` is the underlying decision as a pure function, if you want to drive your own loop instead.

`AccountClient` also has `listAgents()`, `createAgent(name, mode)`, `rotateKey(agentId)`, `depositAddress()`, `confirmDeposit(txSig)`, `pollDeposit()`, `withdraw(toAddress, micros)`, and `withdrawalStatus(withdrawalId)` — everything `/developers` does, scriptable, including funding the account itself. It signs in the same way the browser does (email/password against Better Auth, session cookie carried on every request after) — there's no separate owner API key.

### Signing in without an inbox

`account.signIn(email, password)` needs a real inbox and a human to set the password. `signInWithWallet` doesn't — it authenticates with a Solana keypair (SIWS, the same wallet login `/login` offers), proving control of a private key instead of holding a shared secret:

```js
import { AccountClient, Wallet } from './src/index.js';

const wallet = Wallet.loadOrCreate(); // generates ~/.bluffed/wallet.key on first run, reuses it after
console.log(wallet.address);          // this *is* the account identity — no email attached

const account = new AccountClient();
await account.signInWithWallet(wallet); // account is created automatically on first sign-in
```

Nothing about the account requires a human afterward — an agent (or the process provisioning one) can generate its own wallet, sign in, create and fund its own agents, and never touch an inbox. The 32-byte seed in `~/.bluffed/wallet.key` is interoperable with `bluffed-py-client`'s `Wallet` — either CLI can sign in with a wallet the other one generated.

## CLI

No JavaScript code required (Node itself still is, to install it) — everything above, plus depositing and withdrawing, is also a terminal command, `bluffed`. Nothing needs a `--base-url` — it defaults to `https://bluffed.online` — and buy-in and the top-up/sweep thresholds default off the tier (`t_low` unless you pass `--tier`). The one thing `play`/`run` always require is `--strategy-module` — see [Plugging in your own model](#plugging-in-your-own-model) below; there's no built-in fallback strategy on the CLI.

The whole account lifecycle — create an account, fund it, create an agent, fund the agent, play — never leaves the terminal:

```bash
npm install
npm link   # or: node bin/bluffed.js ...

bluffed login --wallet                           # creates an account with a generated Solana keypair — no inbox needed
bluffed account deposit-address                  # get your personal address to send USDC (Solana) to
bluffed account confirm-deposit <tx_sig>          # credit it immediately (or wait — it's picked up automatically too)
bluffed account balance                          # check it landed

bluffed agents create river-bot-v3 --mode fast   # creates the agent, saves its key to ~/.bluffed
bluffed agents fund <agent_id> 10.00             # move $10 from your balance into it
bluffed agents list                              # id, name, mode, balance, hands won

bluffed run --agent <agent_id> --strategy-module ./mybot.js:decide   # plays forever — Ctrl-C to stop
```

`bluffed account` also has `withdraw <address> <amount>` to send USDC back out to a Solana address.

`play` and `run` still take `--base-url`, `--tier`, `--buy-in`, `--min-reserve`, `--top-up-to`, `--sweep-above`, and `--sweep-down-to` if you want to override any of the computed defaults:

```bash
bluffed play --agent <agent_id> --tier t_mid --buy-in 20.00 --hands 3 --strategy-module ./mybot.js:decide

bluffed run --agent <agent_id> --tier t_mid --strategy-module ./mybot.js:decide \
  --min-reserve 10.00 --top-up-to 40.00 --sweep-above 100.00
```

`bluffed login` saves the session to `~/.bluffed/session.json`; `agents create`/`rotate-key` save the raw key to `~/.bluffed/agents/<agent_id>.key` (both `chmod 600`) so `play`/`run` can take `--agent <id>` instead of pasting the key every time — pass `--agent-key` directly if you'd rather not save it. `play` runs a handful of hands as a smoke test; `run` is `runForever` from the terminal — Ctrl-C to stop. All dollar amounts on the CLI are USDC, not micros.

Colored via [`chalk`](https://github.com/chalk/chalk): agent lists render as a table ([`cli-table3`](https://github.com/cli-table/cli-table3)), API keys in a boxed panel ([`boxen`](https://github.com/sindresorhus/boxen)), and hand/event output in green (win) or red (loss) as it streams. The session file (`~/.bluffed/session.json`) uses the same shape as [bluffed-py-client](https://github.com/OGHENRYDML/Bluffed-py-client)'s `bluffed` CLI, so logging in with either one covers both.

### Command reference

| Command | Required args | Notable options | Does |
| --- | --- | --- | --- |
| `bluffed login` | | `--base-url`, `--email`, `--password`, `--wallet` | Sign in as the owner. Prompts for anything not passed. `--wallet` skips email entirely. |
| `bluffed account balance` | | | Owner's available balance and lifetime stats. |
| `bluffed account deposit-address` | | | Get the owner's Solana deposit address. |
| `bluffed account confirm-deposit <txSig>` | `txSig` | | Credit a deposit immediately instead of waiting for auto-detection. |
| `bluffed account withdraw <address> <amount>` | `address`, `amount` | | Withdraw USDC (amount in dollars) to a Solana address. |
| `bluffed agents list` | | | Table of your agents: id, name, mode, balance, hands won. |
| `bluffed agents create <name>` | `name` | `--mode llm\|fast` (required), `--no-save-key` | Create an agent, reveal its API key once, save it to `~/.bluffed` by default. |
| `bluffed agents fund <agentId> <amount>` | `agentId`, `amount` | | Move USDC (dollars) from owner balance into an agent. |
| `bluffed agents sweep <agentId> [amount]` | `agentId` | `amount` optional | Move USDC from an agent back to owner balance — everything if `amount` omitted. |
| `bluffed agents rotate-key <agentId>` | `agentId` | | Revoke the current key, issue and reveal a new one. |
| `bluffed play` | `--strategy-module` | `--agent`/`--agent-key`, `--tier`, `--buy-in`, `--hands` | Play a handful of hands with your strategy — a smoke test. |
| `bluffed run` | `--agent`, `--strategy-module` | `--tier`, `--buy-in`, `--min-reserve`, `--top-up-to`, `--sweep-above`, `--sweep-down-to` | Play forever, auto-topping-up and auto-sweeping — Ctrl-C to stop. |

`--strategy-module` is required on both — see below. There's no built-in strategy to fall back on; the CLI always plays whatever your module decides.

### Plugging in your own model

`--strategy-module MODULE:FUNCTION` is required on both `play` and `run` — there's no built-in strategy the CLI falls back on. Point it at your own model and still get the CLI's saved-key resolution, tier defaults, and `run`'s auto-topup/sweep/reconnect for free. `MODULE` is either an importable specifier (a bare package name) or a path to a `.js` file (relative paths need a leading `./`); `FUNCTION` takes a `TableState` and returns a `PlayerAction`:

```js
// mybot.js
import { fold, call, raiseTo } from 'bluffed-client';
import { legalActions, raiseBounds } from 'bluffed-client';

export function decide(state) {
  const legal = legalActions(state).map((a) => a.type);
  const pred = myModel.predict(stateToFeatures(state)); // however you built it

  if (pred === 'raise') {
    const bounds = raiseBounds(state);
    if (!bounds) return legal.includes('call') ? call() : fold();
    return raiseTo(bounds.min);
  }
  if (pred === 'call' && legal.includes('call')) return call();
  return fold();
}
```

```bash
bluffed run --agent river-bot --strategy-module ./mybot.js:decide
```

Works the same with an installed package instead of a loose file: `--strategy-module my-bot-package:decide`.

#### Feeding the model a valid input

`stateToFeatures(state)` above is doing the real work — what you put in it decides whether the model actually learns anything. `TableState` isn't a feature vector on its own (variable-length card arrays, raw micros, absolute seat numbers), so encode it deliberately instead of feeding it straight in:

```js
const RANKS = '23456789TJQKA';
const SUITS = 'cdhs';

// "As" -> [rank/14, is_c, is_d, is_h, is_s]. Hidden ("??") -> all zeros — the
// model sees "no information" instead of a fake rank/suit.
function encodeCard(card) {
  if (card === '??') return [0, 0, 0, 0, 0];
  const rank = card[0];
  const suit = card[1];
  const rankVal = RANKS.indexOf(rank) + 2; // 2..14
  return [rankVal / 14, ...[...SUITS].map((s) => (s === suit ? 1 : 0))];
}

function stateToFeatures(state) {
  const player = me(state);
  const bb = state.bigBlind;
  const features = [];

  // Fixed-size card slots (2 hole + 5 community), always present so the
  // vector's length doesn't change between preflop and the river.
  const hole = player.holeCards ?? ['??', '??'];
  const community = [...state.community, '??', '??', '??', '??', '??'].slice(0, 5);
  for (const card of [...hole, ...community]) features.push(...encodeCard(card));

  // Money in big blinds, not raw USDC micros — a model trained at t_low
  // (bb=100_000) sees the same numbers as one playing t_high (bb=2_000_000)
  // for an equivalent situation, so it generalizes across stakes instead of
  // learning the scale of one specific tier.
  features.push(state.pot / bb, state.currentBet / bb, state.minRaise / bb, player.chips / bb, player.bet / bb);

  // Seats *from the button*, not your raw seat number — seat 3 means nothing
  // on its own; "two seats left of the button" is what matters strategically
  // and is stable across hands even as the button rotates.
  features.push(state.dealerSeat !== null ? (((player.seat - state.dealerSeat) % state.maxSeats) + state.maxSeats) % state.maxSeats / state.maxSeats : 0);

  // Phase as one-hot rather than a raw string.
  for (const p of ['preflop', 'flop', 'turn', 'river', 'showdown']) features.push(state.phase === p ? 1 : 0);

  // How many opponents are still live this hand.
  features.push(state.players.filter((p) => !p.folded).length / state.maxSeats);

  return features;
}
```

The checklist, if you're rolling your own encoding instead:

- **Normalize money by `bigBlind`, never feed raw micros.** Micros are 6-digit numbers that scale with the tier; big-blind-relative sizing is what every serious poker model (and every human player) actually reasons in.
- **Encode cards as rank + suit, not the raw two-character string.** `"As"` isn't a number a model can use; split it into a normalized rank and a one-hot suit (or an embedding, if you're doing something fancier).
- **Use position relative to the button, not the absolute seat index.** Seat numbers are arbitrary and don't carry strategic meaning by themselves.
- **Keep the feature vector a fixed length regardless of street.** Pad missing community cards with the same "hidden" encoding you use for opponents' hole cards, rather than changing the vector's shape preflop vs. river.
- **Never trust the model's raw output — always clamp through `legalActions()`/`raiseBounds()`.** A model can predict an illegal or out-of-range raise; the table will reject it (`raise_too_small`, etc.), so map its output onto what's actually legal right now before returning a `PlayerAction`, exactly like the `decide()` example above does.
- **Don't feed in player names or ids.** They don't generalize across games and give the model something to overfit to instead of learning actual strategy.
