#!/usr/bin/env node
/**
 * Manual Blockchain RPC Test
 * Tests blockchain RPC connectivity and endpoint generation
 */

const http = require('http');
const https = require('https');

// Test RPC URLs (public endpoints that don't require API keys)
const RPC_ENDPOINTS = [
    'https://ethereum-sepolia-rpc.publicnode.com',
    'https://rpc.sepolia.org',
    'https://sepolia.infura.io/v3/YOUR_PROJECT_ID', // Placeholder - will fail
    'https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY' // Placeholder - will fail
];

// Colors for output
const colors = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    blue: "\x1b[34m"
};

function log(msg, type = 'info') {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    let color = colors.reset;
    switch(type) {
        case 'success': color = colors.green; break;
        case 'error': color = colors.red; break;
        case 'warn': color = colors.yellow; break;
        case 'header': color = colors.cyan; break;
        case 'debug': color = colors.blue; break;
    }
    console.log(`${color}[${timestamp}] ${msg}${colors.reset}`);
}

/**
 * Send JSON-RPC request to Ethereum node
 */
function sendRpcRequest(rpcUrl, method, params = []) {
    return new Promise((resolve, reject) => {
        const jsonRpc = JSON.stringify({
            jsonrpc: "2.0",
            method: method,
            params: params,
            id: 1
        });

        const url = new URL(rpcUrl);
        const isHttps = url.protocol === 'https:';
        const client = isHttps ? https : http;
        
        const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(jsonRpc)
            },
            timeout: 10000
        };

        const req = client.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.error) {
                        reject(new Error(`RPC Error: ${json.error.message || JSON.stringify(json.error)}`));
                    } else {
                        resolve(json);
                    }
                } catch (e) {
                    reject(new Error(`Failed to parse response: ${e.message}`));
                }
            });
        });

        req.on('error', (e) => {
            reject(new Error(`Request failed: ${e.message}`));
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.write(jsonRpc);
        req.end();
    });
}

/**
 * Test getting block number
 */
async function testGetBlockNumber(rpcUrl) {
    try {
        log(`Testing eth_blockNumber on ${rpcUrl}...`, 'debug');
        const response = await sendRpcRequest(rpcUrl, 'eth_blockNumber', []);
        
        if (response.result) {
            const blockNumber = parseInt(response.result, 16);
            log(`✓ Block number: ${blockNumber} (0x${response.result})`, 'success');
            return blockNumber;
        } else {
            throw new Error('No result in response');
        }
    } catch (e) {
        log(`✗ Failed to get block number: ${e.message}`, 'error');
        throw e;
    }
}

/**
 * Test getting block hash
 */
async function testGetBlockHash(rpcUrl, blockNumber) {
    try {
        const hexBlock = '0x' + blockNumber.toString(16);
        log(`Testing eth_getBlockByNumber for block ${blockNumber} (${hexBlock})...`, 'debug');
        const response = await sendRpcRequest(rpcUrl, 'eth_getBlockByNumber', [hexBlock, false]);
        
        if (response.result && response.result.hash) {
            const hash = response.result.hash;
            log(`✓ Block hash: ${hash}`, 'success');
            log(`  Block number: ${parseInt(response.result.number, 16)}`, 'debug');
            log(`  Timestamp: ${new Date(parseInt(response.result.timestamp, 16) * 1000).toISOString()}`, 'debug');
            return hash;
        } else {
            throw new Error('No hash in block result');
        }
    } catch (e) {
        log(`✗ Failed to get block hash: ${e.message}`, 'error');
        throw e;
    }
}

/**
 * Test endpoint generation logic (simulating Android client)
 */
function testEndpointGeneration(blockHash, blockStep, serverIp, serverPort) {
    try {
        log('Testing endpoint generation from block hash...', 'header');
        
        // Remove 0x prefix
        const hash = blockHash.startsWith('0x') ? blockHash.substring(2) : blockHash;
        
        // Convert hex to bytes
        const hashBytes = Buffer.from(hash, 'hex');
        
        // Generate port: 1024 + (hash % 60000)
        const portBase = 1024;
        const portRange = 60000;
        const port = portBase + (((hashBytes[3] & 0xFF) << 8 | (hashBytes[4] & 0xFF)) % portRange);
        
        // Use server IP with generated port
        const endpoint = `http://${serverIp}:${port}`;
        
        log(`✓ Generated endpoint: ${endpoint}`, 'success');
        log(`  Port derived from hash bytes [3:5]: ${port}`, 'debug');
        
        // Also show fallback endpoint
        const fallbackEndpoint = `http://${serverIp}:${serverPort}`;
        log(`  Fallback endpoint: ${fallbackEndpoint}`, 'debug');
        
        return { endpoint, fallbackEndpoint, port };
    } catch (e) {
        log(`✗ Failed to generate endpoint: ${e.message}`, 'error');
        throw e;
    }
}

/**
 * Test all RPC endpoints
 */
async function testAllEndpoints() {
    log('\n' + '='.repeat(60), 'header');
    log('Blockchain RPC Manual Test', 'header');
    log('='.repeat(60), 'header');
    
    let workingEndpoint = null;
    let blockNumber = null;
    let blockHash = null;
    
    // Test each endpoint
    for (const rpcUrl of RPC_ENDPOINTS) {
        log(`\nTesting endpoint: ${rpcUrl}`, 'header');
        
        // Skip placeholders
        if (rpcUrl.includes('YOUR_PROJECT_ID') || rpcUrl.includes('YOUR_API_KEY')) {
            log('Skipping placeholder endpoint', 'warn');
            continue;
        }
        
        try {
            blockNumber = await testGetBlockNumber(rpcUrl);
            blockHash = await testGetBlockHash(rpcUrl, blockNumber);
            workingEndpoint = rpcUrl;
            log(`\n✓ Endpoint ${rpcUrl} is working!`, 'success');
            break;
        } catch (e) {
            log(`✗ Endpoint ${rpcUrl} failed`, 'error');
            continue;
        }
    }
    
    if (!workingEndpoint) {
        log('\n✗ No working RPC endpoints found!', 'error');
        log('You may need to:', 'warn');
        log('  1. Set up an Infura account and get a project ID', 'warn');
        log('  2. Set up an Alchemy account and get an API key', 'warn');
        log('  3. Use a local Ethereum node', 'warn');
        log('  4. Use a different public RPC endpoint', 'warn');
        process.exit(1);
    }
    
    // Test endpoint generation
    log('\n' + '='.repeat(60), 'header');
    log('Testing Endpoint Generation', 'header');
    log('='.repeat(60), 'header');
    
    const blockStep = 10;
    const refBlock = blockNumber - (blockNumber % blockStep);
    log(`Reference block (rounded to step ${blockStep}): ${refBlock}`, 'info');
    
    // Get server IP (same logic as test script)
    const os = require('os');
    function getServerIP() {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    if (iface.address.startsWith('192.168.') || iface.address.startsWith('10.')) {
                        return iface.address;
                    }
                }
            }
        }
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
        return '192.168.0.180';
    }
    
    const serverIp = getServerIP();
    const serverPort = 1234;
    
    log(`Server IP: ${serverIp}`, 'info');
    log(`Server Port: ${serverPort}`, 'info');
    
    // Get hash for reference block
    try {
        const hexRefBlock = '0x' + refBlock.toString(16);
        log(`\nGetting hash for reference block ${refBlock}...`, 'info');
        const refBlockResponse = await sendRpcRequest(workingEndpoint, 'eth_getBlockByNumber', [hexRefBlock, false]);
        
        if (refBlockResponse.result && refBlockResponse.result.hash) {
            const refBlockHash = refBlockResponse.result.hash;
            log(`Reference block hash: ${refBlockHash}`, 'success');
            
            const endpointResult = testEndpointGeneration(refBlockHash, blockStep, serverIp, serverPort);
            
            log('\n' + '='.repeat(60), 'header');
            log('Test Summary', 'header');
            log('='.repeat(60), 'header');
            log(`✓ Working RPC Endpoint: ${workingEndpoint}`, 'success');
            log(`✓ Current Block: ${blockNumber}`, 'success');
            log(`✓ Reference Block: ${refBlock}`, 'success');
            log(`✓ Reference Block Hash: ${refBlockHash}`, 'success');
            log(`✓ Generated Endpoint: ${endpointResult.endpoint}`, 'success');
            log(`✓ Fallback Endpoint: ${endpointResult.fallbackEndpoint}`, 'success');
            log('='.repeat(60), 'header');
            
            log('\nTo use this RPC endpoint in your test, set:', 'info');
            log(`  BLOCKCHAIN_RPC_URL=${workingEndpoint}`, 'info');
            log('Or update test-blockchain-c2-suite.js with this URL', 'info');
            
        } else {
            throw new Error('Could not get reference block hash');
        }
    } catch (e) {
        log(`✗ Failed to get reference block: ${e.message}`, 'error');
        process.exit(1);
    }
}

// Run tests
testAllEndpoints().catch(error => {
    log(`Fatal error: ${error.message}`, 'error');
    process.exit(1);
});











