/**
 * Check Solana devnet balances for operator/client + PYUSD mint (if set).
 * Usage: node wallet-check.js
 */

const fs = require('fs');
const path = require('path');
const bs58Mod = require('bs58');
const { Connection, PublicKey } = require('@solana/web3.js');
const { getAssociatedTokenAddress, getAccount, getMint } = require('@solana/spl-token');

const bs58 = bs58Mod.default || bs58Mod;
const { decode: b58decode } = bs58;

const ROOT = __dirname;
const keysPath = path.join(ROOT, '.blockchain-keys.env');
const contractPath = path.join(ROOT, '.blockchain-contract.env');

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

const RPC = env.BLOCKCHAIN_RPC_URL || env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const channel = env.SOLANA_CHANNEL_ADDRESS || env.BLOCKCHAIN_CONTRACT_ADDRESS;
const mintAddr = env.SOLANA_PYUSD_MINT;

function resolvePubkey(envKey, envAddrKey) {
  if (env[envAddrKey]) return new PublicKey(env[envAddrKey]);
  if (env[envKey]) {
    const kp = require('@solana/web3.js').Keypair.fromSecretKey(b58decode(env[envKey]));
    return kp.publicKey;
  }
  return null;
}

async function main() {
  const conn = new Connection(RPC, 'confirmed');
  const operatorPk = resolvePubkey('BLOCKCHAIN_PRIVATE_KEY', 'BLOCKCHAIN_WALLET_ADDRESS');
  const clientPk = resolvePubkey('BLOCKCHAIN_CLIENT_PRIVATE_KEY', 'BLOCKCHAIN_CLIENT_ADDRESS');

  if (!operatorPk || !clientPk) {
    console.error('Missing operator/client public keys. Populate BLOCKCHAIN_WALLET_ADDRESS and BLOCKCHAIN_CLIENT_ADDRESS.');
    process.exit(1);
  }

  const [opBal, clientBal] = await Promise.all([
    conn.getBalance(operatorPk, 'confirmed'),
    conn.getBalance(clientPk, 'confirmed')
  ]);

  console.log('RPC:', RPC);
  console.log('Channel:', channel || 'not set');
  console.log('Operator:', operatorPk.toBase58(), '-', (opBal / 1_000_000_000).toFixed(9), 'SOL');
  console.log('Client  :', clientPk.toBase58(), '-', (clientBal / 1_000_000_000).toFixed(9), 'SOL');

  if (mintAddr && mintAddr !== 'PENDING_FUNDING') {
    const mint = new PublicKey(mintAddr);
    const opAta = env.SOLANA_OPERATOR_PYUSD_ACCOUNT && env.SOLANA_OPERATOR_PYUSD_ACCOUNT !== 'PENDING_FUNDING'
      ? new PublicKey(env.SOLANA_OPERATOR_PYUSD_ACCOUNT)
      : await getAssociatedTokenAddress(mint, operatorPk);
    const clientAta = env.SOLANA_CLIENT_PYUSD_ACCOUNT && env.SOLANA_CLIENT_PYUSD_ACCOUNT !== 'PENDING_FUNDING'
      ? new PublicKey(env.SOLANA_CLIENT_PYUSD_ACCOUNT)
      : await getAssociatedTokenAddress(mint, clientPk);

    const [mintInfo, opAtaInfo, clientAtaInfo] = await Promise.all([
      getMint(conn, mint),
      getAccount(conn, opAta),
      getAccount(conn, clientAta)
    ]);

    const divider = 10 ** mintInfo.decimals;
    console.log('PYUSD Mint:', mint.toBase58(), `(decimals=${mintInfo.decimals})`);
    console.log('  Operator ATA:', opAta.toBase58(), '-', (Number(opAtaInfo.amount) / divider).toFixed(mintInfo.decimals), 'PYUSD');
    console.log('  Client ATA  :', clientAta.toBase58(), '-', (Number(clientAtaInfo.amount) / divider).toFixed(mintInfo.decimals), 'PYUSD');
  } else {
    console.log('PYUSD mint not set (SOLANA_PYUSD_MINT=PENDING_FUNDING). Fund and rerun setup.');
  }
}

main().catch((err) => {
  console.error('wallet:check failed:', err.message || err);
  process.exit(1);
});
