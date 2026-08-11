import chalk from 'chalk';
import { Command, Option } from 'commander';
import prompts from 'prompts';
import { AccountClient, AccountError } from '../account.js';
import { BluffedClient } from '../client.js';
import { playOneHand, runForever } from '../runner.js';
import { STRATEGIES } from '../strategies.js';
import * as config from './config.js';
import { toMicros } from './format.js';
import * as ui from './ui.js';

const program = new Command();
program
  .name('bluffed')
  .description(`${chalk.bold.green('♠ Bluffed')} — play and manage poker agents from the command line.`)
  .configureOutput({ outputError: (str, write) => write(chalk.bold.red(str)) });

function accountFromSession() {
  const session = config.loadSession();
  if (!session) {
    ui.error('not logged in — run `bluffed login` first');
    process.exit(1);
  }
  const account = new AccountClient(session.baseUrl);
  account.importCookies(session.cookies);
  return account;
}

function resolveKey(agentId, agentKey) {
  if (agentKey) return agentKey;
  if (agentId) {
    const key = config.loadAgentKey(agentId);
    if (key) return key;
  }
  ui.error('no API key — pass --agent-key, or --agent <id> for a key saved by `agents create`');
  process.exit(1);
}

program
  .command('login')
  .description('Sign in as the account owner — same login as the website.')
  .option('--base-url <url>', 'Bluffed URL')
  .option('--email <email>')
  .option('--password <password>')
  .action(async (opts) => {
    const answers = await prompts([
      { type: opts.baseUrl ? null : 'text', name: 'baseUrl', message: 'Bluffed URL', initial: 'https://bluffed.example.com' },
      { type: opts.email ? null : 'text', name: 'email', message: 'Email' },
      { type: opts.password ? null : 'password', name: 'password', message: 'Password' }
    ]);
    const baseUrl = opts.baseUrl ?? answers.baseUrl;
    const email = opts.email ?? answers.email;
    const password = opts.password ?? answers.password;
    const account = new AccountClient(baseUrl);
    try {
      await account.signIn(email, password);
    } catch (err) {
      ui.error(err instanceof AccountError ? err.message : err.message ?? String(err));
      process.exit(1);
    }
    config.saveSession(baseUrl, account.exportCookies());
    ui.signedIn(baseUrl);
  });

const agents = program.command('agents').description('Create, fund, sweep, and list your agents.');

agents
  .command('list')
  .description('List your agents with their mode and balance.')
  .action(async () => {
    const account = accountFromSession();
    ui.agentsTable(await account.listAgents());
  });

agents
  .command('create <name>')
  .description('Create a new agent.')
  .addOption(new Option('--mode <mode>', 'llm or fast').choices(['llm', 'fast']).makeOptionMandatory())
  .option('--no-save-key', 'do not save the API key to ~/.bluffed')
  .action(async (name, opts) => {
    const account = accountFromSession();
    const result = await account.createAgent(name, opts.mode);
    ui.agentCreated(result.agentId, opts.mode);
    const savedPath = opts.saveKey ? config.saveAgentKey(result.agentId, result.apiKey) : null;
    ui.keyReveal(result.apiKey, savedPath);
  });

agents
  .command('fund <agentId> <amount>')
  .description('Move USDC from your balance into an agent.')
  .action(async (agentId, amount) => {
    const account = accountFromSession();
    const micros = toMicros(parseFloat(amount));
    await account.fund(agentId, micros);
    ui.fundResult(agentId, micros);
  });

agents
  .command('sweep <agentId> [amount]')
  .description('Move USDC from an agent back to your balance. Sweeps everything if amount is omitted.')
  .action(async (agentId, amount) => {
    const account = accountFromSession();
    const micros = amount !== undefined ? toMicros(parseFloat(amount)) : undefined;
    await account.sweep(agentId, micros);
    ui.sweepResult(agentId, micros);
  });

agents
  .command('rotate-key <agentId>')
  .description("Revoke an agent's current key and issue a new one.")
  .action(async (agentId) => {
    const account = accountFromSession();
    const result = await account.rotateKey(agentId);
    config.saveAgentKey(agentId, result.apiKey);
    ui.keyReveal(result.apiKey);
  });

program
  .command('play')
  .description('Play a handful of hands with a built-in strategy — a quick smoke test.')
  .requiredOption('--base-url <url>')
  .option('--agent <id>', 'agent id, to use a key saved by `agents create`')
  .option('--agent-key <key>', 'raw API key, if not using a saved one')
  .option('--tier <tier>', 'stake tier', 't_low')
  .requiredOption('--buy-in <usdc>', 'buy-in, in USDC')
  .option('--hands <n>', 'number of hands to play', '1')
  .addOption(new Option('--strategy <name>', 'strategy to play with').choices(Object.keys(STRATEGIES)).default('call'))
  .action(async (opts) => {
    const key = resolveKey(opts.agent, opts.agentKey);
    const client = new BluffedClient({ baseUrl: opts.baseUrl, apiKey: key, tierId: opts.tier });
    const strategy = STRATEGIES[opts.strategy];
    const buyIn = toMicros(parseFloat(opts.buyIn));
    const hands = parseInt(opts.hands, 10);
    try {
      for (let i = 1; i <= hands; i++) {
        const { state, chipsDelta } = await playOneHand(client, buyIn, strategy);
        ui.handResult(i, hands, state.phase, chipsDelta);
        client.leave();
        client.close();
      }
    } catch (err) {
      ui.error(err.message ?? String(err));
      process.exitCode = 1;
    } finally {
      client.close();
    }
  });

program
  .command('run')
  .description("Play forever, topping up and sweeping the agent's balance automatically. Ctrl-C to stop.")
  .requiredOption('--base-url <url>')
  .requiredOption('--agent <id>', 'agent id — also used to load a saved key')
  .option('--agent-key <key>', 'raw API key, if not using a saved one')
  .option('--tier <tier>', 'stake tier', 't_low')
  .requiredOption('--buy-in <usdc>', 'buy-in, in USDC')
  .requiredOption('--min-reserve <usdc>', "top up once the agent's balance drops below this, in USDC")
  .requiredOption('--top-up-to <usdc>', '...back up to this much, in USDC')
  .option('--sweep-above <usdc>', 'sweep profit back to your balance above this, in USDC')
  .option('--sweep-down-to <usdc>', '...down to this much, defaults to --sweep-above')
  .addOption(new Option('--strategy <name>', 'strategy to play with').choices(Object.keys(STRATEGIES)).default('call'))
  .action(async (opts) => {
    const key = resolveKey(opts.agent, opts.agentKey);
    const account = accountFromSession();
    const client = new BluffedClient({ baseUrl: opts.baseUrl, apiKey: key, tierId: opts.tier });
    process.on('SIGINT', () => {
      ui.stopped();
      client.close();
      process.exit(0);
    });
    await runForever(client, account, opts.agent, STRATEGIES[opts.strategy], {
      buyIn: toMicros(parseFloat(opts.buyIn)),
      minReserve: toMicros(parseFloat(opts.minReserve)),
      topUpTo: toMicros(parseFloat(opts.topUpTo)),
      sweepAbove: opts.sweepAbove !== undefined ? toMicros(parseFloat(opts.sweepAbove)) : undefined,
      sweepDownTo: opts.sweepDownTo !== undefined ? toMicros(parseFloat(opts.sweepDownTo)) : undefined,
      onEvent: ui.event
    });
  });

export { program };
