import { getAgentStatus } from './agent-self.js';
import { handOver, myTurn } from './state.js';

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

      await new Promise((resolve, reject) => {
        client.connect().then(() => client.sit(buyIn)).catch(reject);

        const onState = (state) => {
          if (handOver(state)) {
            client.off('state', onState);
            resolve();
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
