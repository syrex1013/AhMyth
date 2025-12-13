/**
 * Create PYUSD-style SPL mint on Solana devnet using existing env keys.
 * - Uses aggressive/processed confirmation with retries.
 * - Writes SOLANA_PYUSD_MINT and ATA addresses to .blockchain-contract.env.
 *
 * Usage:
 *   node scripts/create-solana-mint.js
 */

const fs = require('fs');
const path = require('path');
const bs58mod = require('bs58');
const bs58 = bs58mod.default || bs58mod;
const {
  Connection,
  Keypair,
  PublicKey,
} = require('@solana/web3.js');
const {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintToChecked
} = require('@solana/spl-token');

const DECIMALS = 6;
const MINT_TO_OPERATOR = BigInt(1_000_000_000); // 1000
const MINT_TO_CLIENT = BigInt(100_000_000); // 100

function parseEnvFile(p) {
  if (!fs.existsSync(p)) return {};
  return fs.readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const m = line.trim().match(/^([^=#]+)=(.*)$/);
      if (m) acc[m[1].trim()] = m[2].trim();
      return acc;
    }, {});
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function withRetry(fn, label, attempts = 5) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1) break;
      await sleep(1200);
    }
  }
  throw lastErr;
}

async function main() {
  const root = process.cwd();
  const keysPath = path.join(root, '.blockchain-keys.env');
  const contractPath = path.join(root, '.blockchain-contract.env');
  const env = { ...parseEnvFile(keysPath), ...parseEnvFile(contractPath), ...process.env };

  const rpc = env.BLOCKCHAIN_RPC_URL || env.SOLANA_RPC_URL || 'https://solana-devnet.g.alchemy.com/v2/iYpa8brgKRSbCQ9rb1tx8';
  const operatorSecret = env.BLOCKCHAIN_PRIVATE_KEY;
  const operatorPub = env.BLOCKCHAIN_WALLET_ADDRESS;
  const clientPub = env.BLOCKCHAIN_CLIENT_ADDRESS;
  const channelAddr = env.SOLANA_CHANNEL_ADDRESS || env.BLOCKCHAIN_CONTRACT_ADDRESS;

  if (!operatorSecret || !operatorPub || !clientPub) {
    throw new Error('Missing operator/client keys in .blockchain-keys.env');
  }

  const operator = Keypair.fromSecretKey(bs58.decode(operatorSecret));
  const clientPk = new PublicKey(clientPub);

  const confirmOpts = { commitment: 'processed', skipPreflight: true, maxRetries: 10 };
  const connection = new Connection(rpc, confirmOpts.commitment);

  console.log('RPC:', rpc);
  console.log('Operator:', operator.publicKey.toBase58());
  console.log('Client  :', clientPk.toBase58());
  console.log('Channel :', channelAddr || 'not set');

  // Create mint
  const mintPubkey = await withRetry(
    () => createMint(
      connection,
      operator,
      operator.publicKey,
      operator.publicKey,
      DECIMALS,
      undefined,
      undefined,
      undefined,
      confirmOpts
    ),
    'createMint'
  );
  console.log('Mint created:', mintPubkey.toBase58());

  // ATAs
  const operatorAta = await withRetry(
    () => getOrCreateAssociatedTokenAccount(
      connection,
      operator,
      mintPubkey,
      operator.publicKey,
      false
    ),
    'operator ATA'
  );
  const clientAta = await withRetry(
    () => getOrCreateAssociatedTokenAccount(
      connection,
      operator,
      mintPubkey,
      clientPk,
      false
    ),
    'client ATA'
  );

  console.log('Operator ATA:', operatorAta.address.toBase58());
  console.log('Client ATA  :', clientAta.address.toBase58());

  // Mint balances
  await withRetry(
    () => mintToChecked(
      connection,
      operator,
      mintPubkey,
      operatorAta.address,
      operator,
      MINT_TO_OPERATOR,
      DECIMALS,
      [],
      confirmOpts
    ),
    'mint to operator'
  );
  await withRetry(
    () => mintToChecked(
      connection,
      operator,
      mintPubkey,
      clientAta.address,
      operator,
      MINT_TO_CLIENT,
      DECIMALS,
      [],
      confirmOpts
    ),
    'mint to client'
  );

  // Update contract env
  const contractLines = fs.readFileSync(contractPath, 'utf8').split(/\r?\n/);
  const upsert = (key, value) => {
    const idx = contractLines.findIndex((l) => l.startsWith(key + '='));
    if (idx >= 0) {
      contractLines[idx] = `${key}=${value}`;
    } else {
      contractLines.push(`${key}=${value}`);
    }
  };
  upsert('SOLANA_PYUSD_MINT', mintPubkey.toBase58());
  upsert('SOLANA_OPERATOR_PYUSD_ACCOUNT', operatorAta.address.toBase58());
  upsert('SOLANA_CLIENT_PYUSD_ACCOUNT', clientAta.address.toBase58());
  fs.writeFileSync(contractPath, contractLines.join('\n'));

  console.log('\nUpdated .blockchain-contract.env with mint and ATA addresses.');
  console.log('Mint:', mintPubkey.toBase58());
  console.log('Operator ATA:', operatorAta.address.toBase58());
  console.log('Client ATA  :', clientAta.address.toBase58());
}

main().catch((err) => {
  console.error('Mint setup failed:', err.message || err);
  process.exit(1);
});
