import boxen from 'boxen';
import chalk from 'chalk';
import Table from 'cli-table3';
import { fmtUsdc } from './format.js';

const MODE_COLOR = { llm: chalk.bold.cyan, fast: chalk.bold.yellow };
const EVENT_COLOR = { funded: chalk.cyan, swept: chalk.green, hand_complete: chalk.dim, error: chalk.bold.red };

export function signedIn(baseUrl) {
  console.log(`${chalk.bold.green('♠')} Signed in to ${chalk.bold(baseUrl)}.`);
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
  const color = EVENT_COLOR[kind] ?? chalk.white;
  console.log(`${color(`▸ ${kind}`)}  ${JSON.stringify(data)}`);
}

export function stopped() {
  console.log(chalk.dim('stopped.'));
}

export function error(message) {
  console.error(chalk.bold.red('Error:'), message);
}
