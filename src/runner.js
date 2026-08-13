import { getAgentStatus } from './agent-self.js';
import { handOver, me, myTurn } from './state.js';

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Connect, sit with `buyIn`, and play a single hand with `strategy` —
 * resolves with the final table state and this seat's chip change once the
 * hand ends. Shared by `runForever` and the CLI's `play` command.
 */
export function playOneHand(client, buyIn, strategy) {
  return new Promise((resolve, reject) => {
    let startingChips = null;
    client.connect().then(() => client.sit(buyIn)).catch(reject);

    const onState = (state) => {
      const player = me(state);
      if (startingChips === null && player) startingChips = player.chips;
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
 * pushing to the owner's balance through `account`. Reconnects for every
 * hand; a table or network error pauses `retryDelayMs` and tries again
 * rather than throwing.
 */
export async function runForever(client, account, agentId, strategy, options) {
  const { buyIn, minReserve, topUpTo, sweepAbove, sweepDownTo, maxHands, retryDelayMs = 5000, onEvent } = options;
  const emit = onEvent ?? (() => {});
  let hands = 0;

  while (maxHands === undefined || hands < maxHands) {
    try {
      const status = await getAgentStatus(client.baseUrl, client.apiKey);
      const { kind, micros } = decideBankrollAction(status.availableMicros, {
        minReserve,
        topUpTo,
        sweepAbove,
        sweepDownTo
      });
      if (kind === 'fund') {
        await account.fund(agentId, micros);
        emit('funded', { micros });
      } else if (kind === 'sweep') {
        await account.sweep(agentId, micros);
        emit('swept', { micros });
      }

      await playOneHand(client, buyIn, strategy);
      client.leave();
      hands += 1;
      emit('hand_complete', { hands });
    } catch (err) {
      emit('error', { error: err instanceof Error ? err.message : String(err) });
      await sleep(retryDelayMs);
    } finally {
      client.close();
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
  const emit = onEvent ?? (() => {});
  return Promise.all(
    configs.map((config) =>
      runForever(config.client, config.account, config.agentId, config.strategy, {
        ...config.options,
        onEvent: (kind, data) => emit(kind, { ...data, agentId: config.agentId })
      })
    )
  );
}
