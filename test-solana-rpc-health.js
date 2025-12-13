const { Connection } = require('@solana/web3.js');
const fetch = require('node-fetch');

const ALCHEMY_KEY = process.env.SOLANA_ALCHEMY_KEY || 'iYpa8brgKRSbCQ9rb1tx8';

const RPC_CANDIDATES = [
    process.env.BLOCKCHAIN_RPC_URL,
    process.env.SOLANA_RPC_URL,
    `https://solana-devnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
    'https://api.devnet.solana.com',
    'https://rpc.ankr.com/solana_devnet/60fcedc56f29eab1f0c4e040224603b5bad3b8e3d9e409302d2d10ff02a5624c',
    'https://api.devnet.solana.com?no-rate-limit=true'
].filter(Boolean);

async function checkRpc(url) {
    const start = Date.now();
    try {
        const connection = new Connection(url, 'confirmed');
        const { blockhash } = await connection.getLatestBlockhash();
        const duration = Date.now() - start;
        console.log(`[OK]   ${url} (${duration}ms) - Blockhash: ${blockhash.substring(0, 10)}...`);
        return true;
    } catch (e) {
        const duration = Date.now() - start;
        console.log(`[FAIL] ${url} (${duration}ms) - Error: ${e.message}`);
        return false;
    }
}

async function main() {
    console.log('Testing Solana Devnet RPC Endpoints...');
    console.log('----------------------------------------');
    
    const results = await Promise.all(RPC_CANDIDATES.map(checkRpc));
    
    const passed = results.filter(r => r).length;
    console.log('----------------------------------------');
    console.log(`Summary: ${passed}/${RPC_CANDIDATES.length} endpoints responding.`);
    
    if (passed === 0) {
        console.error('All RPC endpoints failed. Check internet connection or rate limits.');
        process.exit(1);
    }
}

main().catch(console.error);








