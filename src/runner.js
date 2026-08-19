import { BluffedClient } from './client.js';
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

/**
 * Connect, sit with `buyIn`, and play a single hand with `strategy` —
 * resolves with the final table state and this seat's chip change once the
 * hand ends. Shared by `runForever` and the CLI's `play` command.
 *
 * `onEvent(kind, data)` — optional — reports connection lifecycle: 'connecting',
 * 'connected', and 'waiting_for_players' (once, the first time the table
 * reports phase 'waiting' — normal when nobody else has sat down yet, but
 * indistinguishable from a stuck connection without this). Never the raw
 * table state — callers that want that already get it via the resolved
 * value or the client's own 'state' event.
 */
export function playOneHand(client, buyIn, strategy, onEvent) {
  const emit = onEvent ?? defaultEventLog;
  return new Promise((resolve, reject) => {
    let startingChips = null;
    let announcedWaiting = false;
    emit('connecting', {});
    client
      .connect()
      .then(() => {
        emit('connected', {});
        client.sit(buyIn);
      })
      .catch(reject);

    const onState = (state) => {
      const player = me(state);
      if (startingChips === null && player) startingChips = player.chips;
      if (state.phase === 'waiting' && !announcedWaiting) {
        announcedWaiting = true;
        emit('waiting_for_players', { seats: state.players.length, maxSeats: state.maxSeats });
      }
      if (handOver(state)) {
        client.off('state', onState);
        const endingChips = player ? player.chips : startingChips;
        resolve({ state, chipsDelta: (endingChips ?? 0) - (startingChips ?? 0) });
        return;
      }
      if (!myTurn(state)) return;
      try {
        client.action(strategy(state));
      } catch (err) {
        client.off('state', onState);
        reject(err);
      }
    };
    client.on('state', onState);
    client.once('error', reject);
  });
}

/**
 * Play hands back to back, forever (or until `maxHands`), keeping the
 * agent's own balance within [minReserve, sweepAbove] by pulling from and
 * pushing to the owner's balance through `account` — skipped entirely if
 * `minReserve`/`topUpTo` are left unset. Reconnects for every hand; a
 * table or network error pauses `retryDelayMs` and tries again rather
 * than throwing.
 *
 * `options.autoTier: true` moves the agent to whichever stake tier its
 * *current* balance actually affords before every hand — up when it's
 * winning, down when it's losing — instead of playing one fixed tier
 * until it can't afford the buy-in anymore. Opt-in: this changes which
 * table the agent is at, out from under whatever `tierId` `client` was
 * built with, and it's a real behavior change someone should choose, not
 * one silently applied.
 */
export async function runForever(client, account, agentId, strategy, options) {
  const { buyIn, minReserve, topUpTo, sweepAbove, sweepDownTo, maxHands, retryDelayMs = 5000, onEvent, autoTier = false } = options;
  const emit = onEvent ?? defaultEventLog;
  let hands = 0;
  let currentClient = client;

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

      if (autoTier) {
        const target = pickTierForBalance(available);
        if (target.id !== currentClient.tierId) {
          const fromTier = currentClient.tierId;
          currentClient.close();
          currentClient = new BluffedClient({ apiKey: currentClient.apiKey, baseUrl: currentClient.baseUrl, tierId: target.id });
          emit('tier_changed', { from: fromTier, to: target.id });
        }
      }

      const { chipsDelta } = await playOneHand(currentClient, buyIn, strategy, emit);
      currentClient.leave();
      hands += 1;
      emit('hand_complete', { hands, chipsDelta, won: chipsDelta > 0 });
    } catch (err) {
      emit('error', { error: err instanceof Error ? err.message : String(err) });
      await sleep(retryDelayMs);
    } finally {
      currentClient.close();
    }
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
