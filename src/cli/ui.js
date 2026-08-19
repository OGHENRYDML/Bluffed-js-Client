import boxen from 'boxen';
import chalk from 'chalk';
import Table from 'cli-table3';
import { fmtUsdc } from './format.js';

const MODE_COLOR = { llm: chalk.bold.cyan, fast: chalk.bold.yellow };
const EVENT_COLOR = {
  funded: chalk.cyan,
  swept: chalk.green,
  hand_complete: chalk.dim,
  error: chalk.bold.red,
  tier_changed: chalk.bold.yellow,
  connecting: chalk.dim,
  connected: chalk.dim,
  waiting_for_players: chalk.yellow
};

export function signedIn(baseUrl, walletAddress) {
  console.log(`${chalk.bold.green('♠')} Signed in to ${chalk.bold(baseUrl)}.`);
  if (walletAddress) console.log(chalk.dim(`wallet: ${walletAddress}`));
}

export function agentsTable(agents) {
  if (agents.length === 0) {
    console.log(chalk.dim('No agents yet — create one with `bluffed agents create`.'));
    return;
  }
  const table = new Table({ head: ['ID', 'Name', 'Mode', 'Balance', 'Hands'], style: { head: ['bold'] } });
  for (const a of agents) {
    const modeColor = MODE_COLOR[a.mode] ?? chalk.white;
    table.push([chalk.dim(a.id), chalk.bold(a.name), modeColor(a.mode), chalk.green(fmtUsdc(a.availableMicros)), String(a.handsWon)]);
  }
  console.log(table.toString());
}

export function agentCreated(agentId, mode) {
  const modeColor = MODE_COLOR[mode] ?? chalk.white;
  console.log(`${chalk.bold.green('♠')} Created agent ${chalk.bold(agentId)} · ${modeColor(mode)}`);
}

export function keyReveal(apiKey, savedPath) {
  let body = chalk.bold(apiKey);
  if (savedPath) body += `\n${chalk.dim(`saved to ${savedPath}`)}`;
  console.log(boxen(body, { title: 'API key — shown once', padding: 1, borderColor: 'yellow' }));
}

export function fundResult(agentId, micros) {
  console.log(`${chalk.cyan('▸ funded')} ${agentId}  ${chalk.green(`+${fmtUsdc(micros)}`)}`);
}

export function sweepResult(agentId, micros) {
  const amount = micros !== undefined && micros !== null ? chalk.green(fmtUsdc(micros)) : chalk.green('everything');
  console.log(`${chalk.cyan('▸ swept')} ${agentId}  ${amount}`);
}

export function handResult(i, total, phase, reward) {
  const color = reward >= 0 ? chalk.green : chalk.red;
  const sign = reward >= 0 ? '+' : '';
  console.log(`${chalk.dim(`hand ${i}/${total}`)}  ${phase}  ${color(`${sign}${reward}`)} micros`);
}

export function event(kind, data) {
  if (kind === 'hand_complete' && typeof data.chipsDelta === 'number') {
    const outcome = data.chipsDelta > 0 ? 'won' : data.chipsDelta < 0 ? 'lost' : 'pushed';
    const color = data.chipsDelta > 0 ? chalk.green : data.chipsDelta < 0 ? chalk.red : chalk.dim;
    console.log(`${chalk.dim(`▸ hand #${data.hands}`)}  ${color(`${outcome} ${fmtUsdc(Math.abs(data.chipsDelta))}`)}`);
    return;
  }
  const color = EVENT_COLOR[kind] ?? chalk.white;
  console.log(`${color(`▸ ${kind}`)}  ${JSON.stringify(data)}`);
}

export function stopped() {
  console.log(chalk.dim('stopped.'));
}

export function accountBalance(data) {
  console.log(`${chalk.bold(fmtUsdc(data.availableMicros))} available`);
  console.log(chalk.dim(`${data.handsWon} hands won · ${fmtUsdc(data.totalWinningsMicros)} lifetime winnings`));
}

export function depositAddress(address) {
  const body = `${chalk.bold(address)}\n${chalk.dim('Send USDC (Solana) here — credited automatically, usually within a minute or two.')}`;
  console.log(boxen(body, { title: 'Deposit address', padding: 1, borderColor: 'cyan' }));
}

export function depositConfirmed(result) {
  if (result.alreadyCredited) {
    console.log(chalk.dim('already credited.'));
  } else {
    console.log(`${chalk.bold.green('♠')} credited ${chalk.green(fmtUsdc(result.micros))}`);
  }
}

export function withdrawQueued(result) {
  console.log(`${chalk.cyan('▸ withdrawal queued')}  id=${result.id}  status=${result.status}`);
}

export function error(message) {
  console.error(chalk.bold.red('Error:'), message);
}
