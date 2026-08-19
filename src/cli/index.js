import path from 'node:path';
import { pathToFileURL } from 'node:url';
import chalk from 'chalk';
import { Command, Option } from 'commander';
import prompts from 'prompts';
import { AccountClient, AccountError } from '../account.js';
import { BluffedClient } from '../client.js';
import { DEFAULT_BASE_URL } from '../defaults.js';
import { playOneHand, runForever } from '../runner.js';
import { DEFAULT_TIER_ID, getTier } from '../tiers.js';
import { Wallet } from '../wallet.js';
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

function requireTier(tierId) {
  const tier = getTier(tierId);
  if (!tier) {
    ui.error(`unknown tier ${JSON.stringify(tierId)}`);
    process.exit(1);
  }
  return tier;
}

// Loads a strategy function from MODULE:FUNCTION — MODULE is either an
// importable specifier (bare package name) or a path to a .js file. Lets
// `run`/`play` drive a model of your own (an ONNX export, a TF.js policy,
// whatever) while still getting the CLI's auto-topup/sweep/reconnect for
// free.
async function loadStrategyModule(spec) {
  const idx = spec.lastIndexOf(':');
  if (idx === -1) {
    ui.error('--strategy-module must be MODULE:FUNCTION, e.g. ./mybot.js:decide');
    process.exit(1);
  }
  const modPart = spec.slice(0, idx);
  const funcName = spec.slice(idx + 1);
  const specifier = modPart.startsWith('.') || modPart.startsWith('/') ? pathToFileURL(path.resolve(modPart)).href : modPart;

  let mod;
  try {
    mod = await import(specifier);
  } catch (err) {
    ui.error(`could not import ${modPart}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  const strategy = mod[funcName];
  if (typeof strategy !== 'function') {
    ui.error(`${modPart} has no export ${JSON.stringify(funcName)}`);
    process.exit(1);
  }
  return strategy;
}

program
  .command('login')
  .description('Sign in as the account owner — same login as the website, or a wallet.')
  .option('--base-url <url>', 'Bluffed URL')
  .option('--email <email>', 'sign in with email/password (default)')
  .option('--password <password>', 'required with --email')
  .option('--wallet', 'sign in with a Solana keypair instead — no email needed. Generates one at ~/.bluffed/wallet.key on first use.')
  .action(async (opts) => {
    const answers = await prompts([
      { type: opts.baseUrl ? null : 'text', name: 'baseUrl', message: 'Bluffed URL', initial: DEFAULT_BASE_URL },
      { type: !opts.wallet && !opts.email ? 'text' : null, name: 'email', message: 'Email' },
      { type: !opts.wallet && !opts.password ? 'password' : null, name: 'password', message: 'Password' }
    ]);
    const baseUrl = opts.baseUrl ?? answers.baseUrl;
    const account = new AccountClient(baseUrl);
    try {
      if (opts.wallet) {
        const wallet = Wallet.loadOrCreate();
        await account.signInWithWallet(wallet);
        ui.signedIn(baseUrl, wallet.address);
      } else {
        const email = opts.email ?? answers.email;
        const password = opts.password ?? answers.password;
        await account.signIn(email, password);
        ui.signedIn(baseUrl);
      }
    } catch (err) {
      ui.error(err instanceof AccountError ? err.message : err.message ?? String(err));
      process.exit(1);
    }
    config.saveSession(baseUrl, account.exportCookies());
  });

const account = program.command('account').description('Check your balance, deposit, and withdraw — the owner account, not an agent.');

account
  .command('balance')
  .description('Show your available balance and lifetime stats.')
  .action(async () => {
    const acct = accountFromSession();
    ui.accountBalance(await acct.balance());
  });

account
  .command('deposit-address')
  .description('Get your personal Solana address for depositing USDC.')
  .action(async () => {
    const acct = accountFromSession();
    ui.depositAddress(await acct.depositAddress());
  });

account
  .command('confirm-deposit <txSig>')
  .description('Credit a deposit immediately instead of waiting for it to be picked up automatically.')
  .action(async (txSig) => {
    const acct = accountFromSession();
    ui.depositConfirmed(await acct.confirmDeposit(txSig));
  });

account
  .command('withdraw <address> <amount>')
  .description('Withdraw USDC to a Solana address.')
  .action(async (address, amount) => {
    const acct = accountFromSession();
    ui.withdrawQueued(await acct.withdraw(address, toMicros(parseFloat(amount))));
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
  .description('Play a handful of hands with your strategy — a quick smoke test.')
  .option('--base-url <url>', 'Bluffed URL', DEFAULT_BASE_URL)
  .option('--agent <id>', 'agent id, to use a key saved by `agents create`')
  .option('--agent-key <key>', 'raw API key, if not using a saved one')
  .option('--tier <tier>', 'stake tier', DEFAULT_TIER_ID)
  .option('--buy-in <usdc>', 'buy-in, in USDC — defaults to the tier minimum')
  .option('--hands <n>', 'number of hands to play', '1')
  .requiredOption('--strategy-module <spec>', 'MODULE:FUNCTION or ./path/to/file.js:FUNCTION — your strategy, receives a TableState and returns a PlayerAction')
  .action(async (opts) => {
    const key = resolveKey(opts.agent, opts.agentKey);
    const tierInfo = requireTier(opts.tier);
    const client = new BluffedClient({ apiKey: key, baseUrl: opts.baseUrl, tierId: opts.tier });
    const strategy = await loadStrategyModule(opts.strategyModule);
    const buyIn = opts.buyIn !== undefined ? toMicros(parseFloat(opts.buyIn)) : tierInfo.minBuyIn;
    const hands = parseInt(opts.hands, 10);
    try {
      for (let i = 1; i <= hands; i++) {
        const { state, chipsDelta } = await playOneHand(client, buyIn, strategy, ui.event);
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
  .option('--base-url <url>', 'Bluffed URL', DEFAULT_BASE_URL)
  .requiredOption('--agent <id>', 'agent id — also used to load a saved key')
  .option('--agent-key <key>', 'raw API key, if not using a saved one')
  .option('--tier <tier>', 'stake tier', DEFAULT_TIER_ID)
  .option('--buy-in <usdc>', 'buy-in, in USDC — defaults to the tier minimum')
  .option('--min-reserve <usdc>', "top up once the agent's balance drops below this, in USDC — defaults to the tier minimum buy-in")
  .option('--top-up-to <usdc>', '...back up to this much, in USDC — defaults to 2x the tier minimum buy-in')
  .option('--sweep-above <usdc>', 'sweep profit back to your balance above this, in USDC — defaults to 2x the tier maximum buy-in')
  .option('--sweep-down-to <usdc>', '...down to this much, defaults to --top-up-to')
  .requiredOption('--strategy-module <spec>', 'MODULE:FUNCTION or ./path/to/file.js:FUNCTION — your strategy, receives a TableState and returns a PlayerAction')
  .option(
    '--auto-tier',
    "move to whichever stake tier the agent's current balance affords before every hand — up when winning, down when losing — instead of playing one fixed tier"
  )
  .action(async (opts) => {
    const key = resolveKey(opts.agent, opts.agentKey);
    const tierInfo = requireTier(opts.tier);
    const strategy = await loadStrategyModule(opts.strategyModule);
    const account = accountFromSession();
    const client = new BluffedClient({ apiKey: key, baseUrl: opts.baseUrl, tierId: opts.tier });
    process.on('SIGINT', () => {
      ui.stopped();
      client.close();
      process.exit(0);
    });

    const buyIn = opts.buyIn !== undefined ? toMicros(parseFloat(opts.buyIn)) : tierInfo.minBuyIn;
    const minReserve = opts.autoTier ? undefined : opts.minReserve !== undefined ? toMicros(parseFloat(opts.minReserve)) : tierInfo.minBuyIn;
    const topUpTo = opts.autoTier ? undefined : opts.topUpTo !== undefined ? toMicros(parseFloat(opts.topUpTo)) : tierInfo.minBuyIn * 2;
    const sweepAbove = opts.sweepAbove !== undefined ? toMicros(parseFloat(opts.sweepAbove)) : tierInfo.maxBuyIn * 2;
    const sweepDownTo = opts.sweepDownTo !== undefined ? toMicros(parseFloat(opts.sweepDownTo)) : topUpTo;

    await runForever(client, account, opts.agent, strategy, {
      buyIn,
      minReserve,
      topUpTo,
      sweepAbove,
      sweepDownTo,
      autoTier: opts.autoTier,
      onEvent: ui.event
    });
  });

export { program, loadStrategyModule };
