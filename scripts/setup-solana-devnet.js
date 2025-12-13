/**
 * Setup Solana Devnet C2 (PYUSD-style SPL mint)
 *
 * Generates fresh Solana keypairs for operator/client/channel,
 * creates a PYUSD-like mint on devnet, mints balances to operator/client,
 * and writes .blockchain-keys.env / .blockchain-contract.env.
 *
 * Usage:
 *   node scripts/setup-solana-devnet.js
 *
 * Notes:
 * - Runs on devnet only (airdrop based). Do NOT use mainnet keys here.
 * - Existing Ethereum values are backed up separately; this script overwrites
 *   the .blockchain-*.env files with Solana values.
 */

const fs = require('fs');
const path = require('path');
const bs58 = require('bs58');
const { encode: b58encode, decode: b58decode } = bs58.default || bs58;
const crypto = require('crypto');
const {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction
} = require('@solana/web3.js');
const {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintToChecked
} = require('@solana/spl-token');

const args = process.argv.slice(2);
const cliRpcFlagIndex = args.indexOf('--rpc');
const cliRpc = cliRpcFlagIndex >= 0 ? args[cliRpcFlagIndex + 1] : null;
const forceFlag = args.includes('--force');

const DEFAULT_ALCHEMY_KEY = 'iYpa8brgKRSbCQ9rb1tx8'; // provided by user
const alchemyKey = process.env.SOLANA_ALCHEMY_KEY || process.env.ALCHEMY_API_KEY || process.env.SOLANA_ALCHEMY_API_KEY || DEFAULT_ALCHEMY_KEY;
const heliusKey = process.env.SOLANA_HELIUS_KEY || process.env.HELIUS_API_KEY || process.env.SOLANA_HELIUS_API_KEY;
const shyftKey = process.env.SOLANA_SHYFT_KEY || process.env.SHYFT_API_KEY;

const keyedRpcs = [];
if (alchemyKey) keyedRpcs.push(`https://solana-devnet.g.alchemy.com/v2/${alchemyKey}`);
if (heliusKey) keyedRpcs.push(`https://devnet.helius-rpc.com/?api-key=${heliusKey}`);
if (shyftKey) keyedRpcs.push(`https://rpc.shyft.to/solana/devnet?api_key=${shyftKey}`);

const rpcFromEnv = cliRpc || process.env.BLOCKCHAIN_RPC_URL || process.env.SOLANA_RPC_URL;
const rpcFallbacks = (process.env.BLOCKCHAIN_RPC_FALLBACKS || process.env.SOLANA_RPC_FALLBACKS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const DEFAULT_RPCS = [
  'https://api.devnet.solana.com',
  'https://rpc.ankr.com/solana_devnet',
  'https://solana-devnet.g.alchemy.com/v2/demo',
  'https://devnet.helius-rpc.com/?api-key=demo',
  'https://rpc.shyft.to/solana/devnet',
  'https://solana-devnet.thelabs.gg',
  'https://api.devnet.solanacommunity.com'
];
const RPC_CANDIDATES = Array.from(new Set([...keyedRpcs, rpcFromEnv, ...rpcFallbacks, ...DEFAULT_RPCS].filter(Boolean)));

const AES_KEY = process.env.BLOCKCHAIN_C2_AES_KEY || crypto.randomBytes(32).toString('hex');

function makeConnection(rpc) {
  return new Connection(rpc, 'confirmed');
}

async function pickHealthyConnection() {
  let lastErr = null;
  for (const rpc of RPC_CANDIDATES) {
    try {
      const conn = makeConnection(rpc);
      await conn.getLatestBlockhash('confirmed');
      return { connection: conn, rpc };
    } catch (err) {
      lastErr = err;
      continue;
    }
  }
  throw lastErr || new Error('No RPC candidates available');
}

async function getBalanceWithFallback(pubkey) {
  let lastErr = null;
  for (const rpc of RPC_CANDIDATES) {
    const connection = makeConnection(rpc);
    try {
      const balance = await connection.getBalance(pubkey, 'confirmed');
      return { balance, connection, rpc };
    } catch (err) {
      lastErr = err;
      continue;
    }
  }
  throw lastErr || new Error('Failed to fetch balance on all RPCs');
}

async function ensureAirdropWithFallback(pubkey, minSol = 2, attempts = 3) {
  let lastErr = null;
  for (const rpc of RPC_CANDIDATES) {
    const connection = makeConnection(rpc);
    try {
      console.log(`- Checking balance via ${rpc}...`);
      const balance = await connection.getBalance(pubkey, 'confirmed');
      if (balance / LAMPORTS_PER_SOL >= minSol) {
        return { connection, rpc };
      }

      const lamportsNeeded = Math.ceil(minSol * LAMPORTS_PER_SOL) - balance;
      let remaining = lamportsNeeded;
      let attempt = 0;

      while (remaining > 0 && attempt < attempts) {
        const chunk = Math.min(remaining, 1 * LAMPORTS_PER_SOL); // request in 1 SOL chunks
        try {
          console.log(`- Requesting airdrop (${chunk / LAMPORTS_PER_SOL} SOL) via ${rpc} (attempt ${attempt + 1}/${attempts})`);
          const sig = await connection.requestAirdrop(pubkey, chunk);
          await connection.confirmTransaction(sig, 'confirmed');
          remaining -= chunk;
        } catch (err) {
          const msg = (err && err.message) || '';
          if (msg.includes('429') || msg.includes('Too Many Requests')) {
            console.warn(`  RPC ${rpc} rate-limited (429). Switching to next candidate...`);
            lastErr = err;
            break; // jump to next RPC candidate
          }
          attempt += 1;
          lastErr = err;
          if (attempt >= attempts) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }

      const finalBal = await connection.getBalance(pubkey, 'confirmed');
      if (finalBal / LAMPORTS_PER_SOL >= minSol) {
        return { connection, rpc };
      }
    } catch (err) {
      lastErr = err;
      // Try next RPC if rate limited or general failure
      continue;
    }
  }
  throw lastErr || new Error('Airdrop failed on all RPCs');
}

async function main() {
  const keysPath = path.join(process.cwd(), '.blockchain-keys.env');
  const contractPath = path.join(process.cwd(), '.blockchain-contract.env');
  if (!forceFlag && fs.existsSync(keysPath) && fs.existsSync(contractPath)) {
    console.log('Existing .blockchain-keys.env and .blockchain-contract.env found. Skipping regeneration (use --force to override).');
    return;
  }

  console.log('\n=== Solana Devnet C2 Setup (PYUSD) ===\n');
  const { connection: initialConnection, rpc: initialRpc } = await pickHealthyConnection();
  let connection = initialConnection;
  let rpcUsed = initialRpc;
  console.log(`Using RPC: ${rpcUsed}`);

  // Fresh identities
  const operator = Keypair.generate();
  const client = Keypair.generate();
  const channel = Keypair.generate();

  console.log('Funding operator/client via airdrop...');
  try {
    const resultOp = await ensureAirdropWithFallback(operator.publicKey, 2);
    if (resultOp) {
      connection = resultOp.connection;
      rpcUsed = resultOp.rpc;
    }
    const resultClient = await ensureAirdropWithFallback(client.publicKey, 2);
    if (resultClient) {
      connection = resultClient.connection;
      rpcUsed = resultClient.rpc;
    }
  } catch (err) {
    console.warn('Airdrop partially/fully failed (devnet may be throttling). Continuing with current balances.');
  }

  let operatorBalance = 0;
  let clientBalance = 0;
  try {
    const { balance: opBal, connection: connOp, rpc: rpcOp } = await getBalanceWithFallback(operator.publicKey);
    operatorBalance = opBal;
    connection = connOp;
    rpcUsed = rpcOp;
  } catch (err) {
    console.warn('Failed to get operator balance across RPCs', err.message || err);
  }
  try {
    const { balance: clBal, connection: connCl, rpc: rpcCl } = await getBalanceWithFallback(client.publicKey);
    clientBalance = clBal;
    connection = connCl;
    rpcUsed = rpcCl;
  } catch (err) {
    console.warn('Failed to get client balance across RPCs', err.message || err);
  }
  const minBalance = 0.3 * LAMPORTS_PER_SOL;
  if (operatorBalance < minBalance) {
    console.warn('Operator balance low; mint creation may fail. Fund the operator manually if this run aborts.');
  }

  let mintPubkey = null;
  let operatorAta = null;
  let clientAta = null;
  const decimals = 6;

  if (operatorBalance >= minBalance) {
    console.log('Creating PYUSD-like mint...');
    mintPubkey = await createMint(
      connection,
      operator, // payer
      operator.publicKey, // mint authority
      operator.publicKey, // freeze authority
      decimals
    );

    console.log('Creating token accounts and minting balances...');
    operatorAta = await getOrCreateAssociatedTokenAccount(connection, operator, mintPubkey, operator.publicKey);
    clientAta = await getOrCreateAssociatedTokenAccount(connection, operator, mintPubkey, client.publicKey);

    await mintToChecked(connection, operator, mintPubkey, operatorAta.address, operator, BigInt(1_000_000_000), decimals); // 1000 PYUSD
    await mintToChecked(connection, operator, mintPubkey, clientAta.address, operator, BigInt(50_000_000), decimals); // 50 PYUSD
  } else {
    console.warn('Skipping mint deployment/minting due to insufficient balance.');
  }

  // Send a tiny lamport to channel so it exists on-chain (if possible)
  if (operatorBalance > 0) {
    const touchTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: operator.publicKey,
        toPubkey: channel.publicKey,
        lamports: 1
      })
    );
    try {
      await sendAndConfirmTransaction(connection, touchTx, [operator]);
    } catch (err) {
      console.warn('Unable to pre-fund channel (ok on devnet, but transactions will include a transfer anyway).');
    }
  }

  const keysEnv = [
    '# Blockchain C2 Keys - Solana Devnet (PYUSD-style) - Generated ' + new Date().toISOString(),
    '# DO NOT COMMIT THIS FILE TO GIT!',
    '',
    `BLOCKCHAIN_RPC_URL=${rpcUsed}`,
    `BLOCKCHAIN_C2_AES_KEY=${AES_KEY}`,
    `BLOCKCHAIN_PRIVATE_KEY=${b58encode(operator.secretKey)}`,
    `BLOCKCHAIN_WALLET_ADDRESS=${operator.publicKey.toBase58()}`,
    `BLOCKCHAIN_CLIENT_PRIVATE_KEY=${b58encode(client.secretKey)}`,
    `BLOCKCHAIN_CLIENT_ADDRESS=${client.publicKey.toBase58()}`,
    `SOLANA_CHANNEL_SECRET=${b58encode(channel.secretKey)}`,
    ''
  ].join('\n');

  const mintAddress = mintPubkey ? mintPubkey.toBase58() : 'PENDING_FUNDING';
  const operatorAtaAddress = operatorAta ? operatorAta.address.toBase58() : 'PENDING_FUNDING';
  const clientAtaAddress = clientAta ? clientAta.address.toBase58() : 'PENDING_FUNDING';

  const contractEnv = [
    '# Blockchain Contract - Solana Devnet channel (PYUSD-style) - Generated ' + new Date().toISOString(),
    `BLOCKCHAIN_CONTRACT_ADDRESS=${channel.publicKey.toBase58()}`,
    `SOLANA_CHANNEL_ADDRESS=${channel.publicKey.toBase58()}`,
    `SOLANA_PYUSD_MINT=${mintAddress}`,
    `SOLANA_OPERATOR_PYUSD_ACCOUNT=${operatorAtaAddress}`,
    `SOLANA_CLIENT_PYUSD_ACCOUNT=${clientAtaAddress}`
  ].join('\n');

  fs.writeFileSync(path.join(process.cwd(), '.blockchain-keys.env'), keysEnv);
  fs.writeFileSync(path.join(process.cwd(), '.blockchain-contract.env'), contractEnv);

  console.log('\nWrote .blockchain-keys.env and .blockchain-contract.env with Solana devnet settings.');
  console.log('Operator wallet:', operator.publicKey.toBase58());
  console.log('Client wallet   :', client.publicKey.toBase58());
  console.log('Channel address :', channel.publicKey.toBase58());
  console.log('PYUSD mint      :', mintAddress);
  if (!mintPubkey) {
    console.warn('\nMint not created due to low balance. Fund the operator and rerun this script or set SOLANA_PYUSD_MINT manually.');
  }
  console.log('\nKeep the secret keys private. Do not commit the env files.\n');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Setup failed:', err);
    process.exit(1);
  });
}

module.exports = { main };
