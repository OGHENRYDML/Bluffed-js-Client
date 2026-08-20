import { BluffedClient, BluffedError, TableError } from './client.js';
import { getAgentStatus } from './agent-self.js';
import { fmtUsdc } from './money.js';
import { handOver, me, myTurn } from './state.js';
import { STAKE_TIERS } from './tiers.js';

/**
 * Plain-text fallback for `onEvent` — used whenever a caller (a hand-rolled
 * script, `runForever`, whichever) doesn't wire up its own handler, so
 * connecting/playing is never silent by default. A caller that wants quiet
 * can still pass `onEvent: () => {}` explicitly.
 */
export function defaultEventLog(kind, data) {
  switch (kind) {
    case 'connecting':
      console.log('Connecting...');
      break;
    case 'connected':
      console.log('Connected.');
      break;
    case 'waiting_for_players':
      console.log(`Waiting for other players (${data.seats}/${data.maxSeats} seated)...`);
      break;
    case 'retrying_seat':
      console.log(`Table was full or already occupied (attempt ${data.attempt}) — trying a different one...`);
      break;
    case 'busted_out':
      console.log(`Busted out at ${data.tableId} — the table removed you (0 chips, no rebuy).`);
      break;
    case 'hand_complete': {
      const outcome = data.chipsDelta > 0 ? 'won' : data.chipsDelta < 0 ? 'lost' : 'pushed';
      console.log(`Hand #${data.hands}: ${outcome} ${fmtUsdc(Math.abs(data.chipsDelta))}`);
      break;
    }
    case 'funded':
      console.log(`Funded agent with ${fmtUsdc(data.micros)}`);
      break;
    case 'swept':
      console.log(`Swept ${fmtUsdc(data.micros ?? 0)} back to owner`);
      break;
    case 'tier_changed':
      console.log(`Moved from tier ${data.from} to ${data.to}`);
      break;
    case 'table_hopped':
      console.log(`Left the table after ${data.afterLosses} losing hands in a row — finding new opponents...`);
      break;
    case 'error':
      console.error(`Error: ${data.error}`);
      break;
    default:
      console.log(kind, data);
  }
}

export function decideBankrollAction(availableMicros, { minReserve, topUpTo, sweepAbove, sweepDownTo }) {
  if (availableMicros < minReserve) {
    return { kind: 'fund', micros: topUpTo - availableMicros };
  }
  if (sweepAbove !== undefined && availableMicros > sweepAbove) {
    const target = sweepDownTo ?? sweepAbove;
    return { kind: 'sweep', micros: availableMicros - target };
  }
  return { kind: null, micros: 0 };
}

/**
 * The richest tier this balance can cover the minimum buy-in for — or, if
 * it can't even cover the smallest tier's minimum, the smallest tier
 * anyway (there's nowhere lower to go).
 */
export function pickTierForBalance(availableMicros) {
  const affordable = STAKE_TIERS.filter((t) => t.minBuyIn <= availableMicros);
  if (affordable.length > 0) {
    return affordable.reduce((richest, t) => (t.minBuyIn > richest.minBuyIn ? t : richest));
  }
  return STAKE_TIERS.reduce((poorest, t) => (t.minBuyIn < poorest.minBuyIn ? t : poorest));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Errors worth a fresh connect+sit retry — both are inherent to table
// assignment being a soft, racy index rather than an outright "you can
// never do this" rejection. See playOneHand()'s retry loop.
const TRANSIENT_SIT_ERRORS = new Set(['table_full', 'same_owner_already_seated']);
const MAX_SIT_ATTEMPTS = 4;

/**
 * Connect (or, if `client` is already connected and seated, resume in
 * place) and play a single hand with `strategy` — resolves with the final
 * table state and this seat's chip change once the hand ends. Shared by
 * `runForever` and the CLI's `play` command.
 *
 * Every mutation on the server broadcasts to every connected socket,
 * including ones unrelated to the current hand (another player sitting
 * down elsewhere, a disconnect-grace-period tick). A client mid-turn,
 * already waiting on the response to an action it just sent, can't tell
 * that kind of rebroadcast apart from a genuine fresh turn on `myTurn`
 * alone — `phase`/`pot`/`currentBet` all still read exactly as they did
 * before the action was sent, because the action hasn't been processed by
 * the server yet. `hasActed` is the one field that actually flips once
 * it's processed: "still my turn, still haven't acted" is recognized here
 * as necessarily stale and skipped, instead of being mistaken for a fresh
 * decision point and resent — which would collide with `not_your_turn`
 * once the original action finally lands and the turn has actually moved
 * on.
 *
 * `onEvent(kind, data)` — optional — reports connection lifecycle:
 * 'connecting', 'connected', 'waiting_for_players' (once, the first time
 * the table reports phase 'waiting'), 'retrying_seat' (a transient sit
 * rejection is being retried against a fresh table), and 'busted_out' (the
 * server removed us from the table entirely — 0 chips, no rebuy — rather
 * than this hand just ending normally). Never the raw table state —
 * callers that want that already get it via the resolved value or the
 * client's own 'state' event.
 */
export function playOneHand(client, buyIn, strategy, onEvent) {
  const emit = onEvent ?? defaultEventLog;
  return new Promise((resolve, reject) => {
    let startingChips = null;
    let announcedWaiting = false;
    let actionPending = false;
    let haveSeenOwnState = false;
    let settled = false;
    let timer = null;
    let attempt = 0;

    // If resuming an already-seated client, the cached state might be a
    // rebroadcast of the hand that just ended — the very reason a prior
    // playOneHand() call on this same client already resolved. Without
    // this, replaying that cached state below would resolve this call
    // immediately too, reporting the same hand twice and never actually
    // waiting for the next one. Only matters when resuming from exactly a
    // handComplete state; a mid-hand resume (recovering from a truncated
    // previous attempt) has no such stale state to skip.
    const afterHandNumber = client.seated && client.state?.phase === 'handComplete' ? client.state.handNumber : null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      client.off('state', onState);
      client.off('error', onError);
    };
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const resetTimer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        finish(reject, new BluffedError(`timed out waiting for the table after ${client.handTimeoutMs}ms`));
      }, client.handTimeoutMs);
    };

    const onState = (state) => {
      resetTimer();
      const player = me(state);
      if (player) haveSeenOwnState = true;
      if (startingChips === null && player) startingChips = player.chips;
      if (state.phase === 'waiting' && !announcedWaiting) {
        announcedWaiting = true;
        emit('waiting_for_players', { seats: state.players.length, maxSeats: state.maxSeats });
      }
      if (afterHandNumber !== null && state.handNumber === afterHandNumber) return;
      if (handOver(state)) {
        const endingChips = player ? player.chips : startingChips;
        finish(resolve, { state, chipsDelta: (endingChips ?? 0) - (startingChips ?? 0) });
        return;
      }
      if (haveSeenOwnState && !player) {
        // The server removed us from the table without an explicit leave()
        // on our end — busting out (0 chips, no rebuy) is the only way
        // that happens today. Reject instead of waiting: nothing here will
        // ever satisfy handOver for a hand we're no longer part of, and a
        // caller reading `me(state)` would eventually hit a null anyway.
        emit('busted_out', { tableId: state.id });
        finish(reject, new BluffedError('removed_from_table'));
        return;
      }
      if (!myTurn(state)) {
        // Turn moved to someone else — if we had an action pending, this
        // is confirmation it landed.
        actionPending = false;
        return;
      }
      if (actionPending && !player?.hasActed) return;
      try {
        actionPending = true;
        client.action(strategy(state));
      } catch (err) {
        finish(reject, err);
      }
    };

    const trySit = async () => {
      attempt += 1;
      try {
        emit('connecting', { tierId: client.tierId });
        await client.close();
        await client.connect();
        emit('connected', {});
        resetTimer();
        client.sit(buyIn);
      } catch (err) {
        finish(reject, err);
      }
    };

    const onError = (err) => {
      if (!haveSeenOwnState && err instanceof TableError && TRANSIENT_SIT_ERRORS.has(err.code) && attempt < MAX_SIT_ATTEMPTS) {
        // Table assignment is a soft, best-effort index — several connects
        // landing in the same instant can all get routed to the same table
        // before any of their seats actually commit, so the losers see
        // table_full (or, rarely, the anti-collusion check) even though a
        // different table has room. A fresh connect re-runs assignment
        // from scratch, which is usually enough to land somewhere that
        // actually fits.
        emit('retrying_seat', { attempt, error: err.code });
        setTimeout(trySit, 500);
        return;
      }
      finish(reject, err);
    };

    client.on('state', onState);
    client.on('error', onError);

    if (client.seated) {
      resetTimer();
      if (client.state) queueMicrotask(() => !settled && onState(client.state));
    } else {
      trySit();
    }
  });
}

/**
 * Play hands back to back, forever (or until `maxHands`), keeping the
 * agent's own balance within [minReserve, sweepAbove] by pulling from and
 * pushing to the owner's balance through `account` — skipped entirely if
 * `minReserve`/`topUpTo` are left unset. Stays connected and seated across
 * hands (playOneHand resumes in place rather than reconnecting) — a table
 * or network error closes the connection, pauses `retryDelayMs`, and
 * reconnects on the next attempt rather than throwing.
 *
 * `options.autoTier` (on by default) moves the agent to whatever stake
 * tier its *current* balance actually affords before every hand — up when
 * it's winning, down when it's losing — instead of playing a fixed tier
 * until it can't afford the buy-in anymore. Pass `autoTier: false` to keep
 * a fixed tier (whatever `tierId` `client` was built with) regardless of
 * balance.
 *
 * `options.hopAfterLosses` (default 5) leaves the current table for a
 * fresh one at the same tier — different opponents — after that many
 * consecutive losing hands (a push or a win resets the count). A losing
 * streak that hasn't dropped the balance enough for autoTier to react on
 * its own isn't a bankroll problem, but it's still worth trying different
 * opponents rather than grinding against the same table indefinitely.
 * Skipped for whichever hand autoTier already reconnected on, so the two
 * never both fire off the same streak. Pass `hopAfterLosses: null` to
 * disable. Best-effort, not a guarantee — table assignment can still land
 * back on the table just left if it's genuinely the best-available slot.
 */
export async function runForever(client, account, agentId, strategy, options) {
  const {
    buyIn,
    minReserve,
    topUpTo,
    sweepAbove,
    sweepDownTo,
    maxHands,
    retryDelayMs = 5000,
    onEvent,
    autoTier = true,
    hopAfterLosses = 5
  } = options;
  const emit = onEvent ?? defaultEventLog;
  let hands = 0;
  let consecutiveLosses = 0;
  let currentClient = client;

  try {
    while (maxHands === undefined || hands < maxHands) {
      try {
        const status = await getAgentStatus(currentClient.baseUrl, currentClient.apiKey);
        let available = status.availableMicros;

        if (minReserve !== undefined && topUpTo !== undefined) {
          const { kind, micros } = decideBankrollAction(available, { minReserve, topUpTo, sweepAbove, sweepDownTo });
          if (kind === 'fund') {
            await account.fund(agentId, micros);
            emit('funded', { micros });
            available += micros;
          } else if (kind === 'sweep') {
            await account.sweep(agentId, micros);
            emit('swept', { micros });
            available -= micros;
          }
        }

        let reconnected = false;
        if (autoTier) {
          const target = pickTierForBalance(available);
          if (target.id !== currentClient.tierId) {
            const fromTier = currentClient.tierId;
            await currentClient.close();
            currentClient = new BluffedClient({
              apiKey: currentClient.apiKey,
              baseUrl: currentClient.baseUrl,
              tierId: target.id
            });
            emit('tier_changed', { from: fromTier, to: target.id });
            reconnected = true;
            consecutiveLosses = 0;
          }
        }

        if (!reconnected && hopAfterLosses !== null && hopAfterLosses !== undefined && consecutiveLosses >= hopAfterLosses) {
          const tierId = currentClient.tierId;
          await currentClient.close();
          currentClient = new BluffedClient({ apiKey: currentClient.apiKey, baseUrl: currentClient.baseUrl, tierId });
          emit('table_hopped', { tier: tierId, afterLosses: consecutiveLosses });
          consecutiveLosses = 0;
        }

        const { chipsDelta } = await playOneHand(currentClient, buyIn, strategy, emit);
        hands += 1;
        consecutiveLosses = chipsDelta < 0 ? consecutiveLosses + 1 : 0;
        emit('hand_complete', { hands, chipsDelta, won: chipsDelta > 0 });
      } catch (err) {
        emit('error', { error: err instanceof Error ? err.message : String(err) });
        // Force a real reconnect on the next playOneHand() rather than
        // trying to keep waiting on a connection that just failed.
        await currentClient.close();
        await sleep(retryDelayMs);
      }
    }
  } finally {
    currentClient.leave();
    await currentClient.close();
  }
}

/**
 * Multi-table: runForever() for each config, all running concurrently —
 * resolves once every one of them stops (which, with maxHands unset, is
 * never; Ctrl-C stops the process instead).
 *
 * Give each table its own agentId/account rather than reusing one agent
 * across tables — runForever's fund/sweep decisions read-then-write an
 * agent's balance with no locking, so two tables sharing an agent can race
 * each other into over-funding or duplicate sweeps. Separate agents means
 * separate balances, so there's nothing to race.
 *
 * @param {{ client: import('./client.js').BluffedClient, account: import('./account.js').AccountClient, agentId: string, strategy: Function, options: object }[]} configs
 * @param {(kind: string, data: object) => void} [onEvent]
 */
export function runForeverMulti(configs, onEvent) {
  const emit = onEvent ?? defaultEventLog;
  return Promise.all(
    configs.map((config) =>
      runForever(config.client, config.account, config.agentId, config.strategy, {
        ...config.options,
        onEvent: (kind, data) => emit(kind, { ...data, agentId: config.agentId })
      })
    )
  );
}
