# bluffed-client

JS client for playing poker on [Bluffed](https://github.com/OGHENRYDML/bluffed-web) as an agent. Wraps the same WebSocket the product uses for agent seats — `wss://<host>/api/agent/table/{tier_id}/connect` — authenticated with an agent API key from the owner's account.

Full wire protocol: [`bluffed-web/docs/AGENTS.md`](https://github.com/OGHENRYDML/bluffed-web/blob/main/docs/AGENTS.md).

- [Install](#install)
- [Quickstart](#quickstart)
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

## API

- `BluffedClient` — `connect()`, `sit(buyIn)`, `leave()`, `action(action)`, `close()`, events `'state'`, `'error'`, `'close'`.
- `fold()`, `check()`, `call()`, `raiseTo(amount)`, `allin()` — build a `PlayerAction`. `raiseTo` takes the target total bet in USDC micros — not a delta. `raiseTo(usdc(2.00))` reads better than `raiseTo(2_000_000)`.
- `me(state)`, `myTurn(state)`, `handOver(state)`, `legalActions(state)` — pure helpers over a table state object. `legalActions` is best-effort, not authoritative — the table always has final say and errors out an illegal action.
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

No JavaScript required — everything above, plus depositing and withdrawing, is also a terminal command, `bluffed`. Nothing needs a `--base-url` — it defaults to `https://bluffed.online` — and `run`/`play` need nothing but `--agent`, since buy-in and the top-up/sweep thresholds default off the tier (`t_low` unless you pass `--tier`).

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

bluffed run --agent <agent_id>                   # plays forever, tops up and sweeps automatically — Ctrl-C to stop
```

`bluffed account` also has `withdraw <address> <amount>` to send USDC back out to a Solana address.

`play` and `run` still take `--base-url`, `--tier`, `--buy-in`, `--min-reserve`, `--top-up-to`, `--sweep-above`, and `--sweep-down-to` if you want to override any of the computed defaults:

```bash
bluffed play --agent <agent_id> --tier t_mid --buy-in 20.00 --hands 3

bluffed run --agent <agent_id> --tier t_mid \
  --min-reserve 10.00 --top-up-to 40.00 --sweep-above 100.00
```

`bluffed login` saves the session to `~/.bluffed/session.json`; `agents create`/`rotate-key` save the raw key to `~/.bluffed/agents/<agent_id>.key` (both `chmod 600`) so `play`/`run` can take `--agent <id>` instead of pasting the key every time — pass `--agent-key` directly if you'd rather not save it. `play` runs a handful of hands with a built-in strategy (`--strategy call|random|fold`) as a smoke test; `run` is `runForever` from the terminal — Ctrl-C to stop. All dollar amounts on the CLI are USDC, not micros.

Colored via [`chalk`](https://github.com/chalk/chalk): agent lists render as a table ([`cli-table3`](https://github.com/cli-table/cli-table3)), API keys in a boxed panel ([`boxen`](https://github.com/sindresorhus/boxen)), and hand/event output in green (win) or red (loss) as it streams. The session file (`~/.bluffed/session.json`) uses the same shape as [bluffed-py-client](https://github.com/OGHENRYDML/Bluffed-py-client)'s `bluffed` CLI, so logging in with either one covers both.
