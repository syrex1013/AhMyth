#!/usr/bin/env node

/**
 * AhMyth Android Emulator Manager
 * Handles Android emulator operations for development and testing
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class EmulatorManager {
    constructor() {
        this.isWindows = os.platform() === 'win32';
        this.packageName = 'ahmyth.mine.king.ahmyth';
        this.mainActivity = 'ahmyth.mine.king.ahmyth.MainActivity';
        this.adbPath = null;
        this.emulatorPath = null;
        this.emulatorProcess = null;  // Keep reference to emulator process
    }

    findADB() {
        if (this.adbPath) {
            return this.adbPath;
        }
        
        try {
            // Try to find ADB in PATH
            execSync('adb version', { stdio: 'ignore' });
            this.adbPath = 'adb';
            return this.adbPath;
        } catch (e) {
            // Try common Android SDK locations
            const sdkPaths = [
                process.env.ANDROID_HOME,
                process.env.ANDROID_SDK_ROOT,
                path.join(os.homedir(), 'Android', 'Sdk'),
                path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
                '/opt/android-sdk',
                '/usr/local/android-sdk',
                '/Library/Android/sdk'
            ].filter(Boolean);

            for (const sdkPath of sdkPaths) {
                const adbPath = path.join(sdkPath, 'platform-tools', this.isWindows ? 'adb.exe' : 'adb');
                if (fs.existsSync(adbPath)) {
                    this.adbPath = adbPath;
                    return this.adbPath;
                }
            }
            throw new Error('ADB not found. Please install Android SDK or add ADB to PATH');
        }
    }

    findEmulator() {
        if (this.emulatorPath) {
            return this.emulatorPath;
        }
        
        try {
            // Try to find emulator in PATH
            execSync('emulator -version', { stdio: 'ignore' });
            this.emulatorPath = 'emulator';
            return this.emulatorPath;
        } catch (e) {
            // Try common Android SDK locations
            const sdkPaths = [
                process.env.ANDROID_HOME,
                process.env.ANDROID_SDK_ROOT,
                path.join(os.homedir(), 'Android', 'Sdk'),
                path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
                '/opt/android-sdk',
                '/usr/local/android-sdk',
                '/Library/Android/sdk'
            ].filter(Boolean);

            for (const sdkPath of sdkPaths) {
                const emulatorPath = path.join(sdkPath, 'emulator', this.isWindows ? 'emulator.exe' : 'emulator');
                if (fs.existsSync(emulatorPath)) {
                    this.emulatorPath = emulatorPath;
                    return this.emulatorPath;
                }
            }
            throw new Error('Android emulator not found. Please install Android SDK');
        }
    }

    runCommand(command, options = {}) {
        console.log(`[EXEC] ${command}`);
        try {
            const result = execSync(command, {
                stdio: options.silent ? 'pipe' : 'inherit',
                encoding: 'utf8',
                ...options
            });
            return result;
        } catch (error) {
            if (!options.ignoreErrors) {
                console.error(`Command failed: ${command}`);
                console.error(error.message);
                process.exit(1);
            }
            return error.stdout || '';
        }
    }

    ensureADBServer() {
        try {
            const adbPath = this.findADB();
            // Start ADB server if not running
            execSync(`${adbPath} start-server`, { stdio: 'ignore' });
        } catch (e) {
            // ADB server might already be running, ignore errors
        }
    }

    getConnectedDevices(quiet = false) {
        try {
            const adbPath = this.findADB();
            // Ensure ADB server is running
            this.ensureADBServer();
            
            // Use a quiet version that doesn't log [EXEC] for repeated checks
            const output = execSync(`${adbPath} devices`, {
                stdio: quiet ? 'pipe' : 'inherit',
                encoding: 'utf8'
            });
            const lines = output.trim().split('\n').slice(1); // Skip "List of devices attached"
            const devices = lines
                .map(line => line.trim().split('\t'))
                .filter(([id, status]) => id && status === 'device')
                .map(([id]) => id);

            return devices;
        } catch (e) {
            return [];
        }
    }

    waitForDevice(timeout = 180000) {
        console.log('Waiting for device to be ready...');
        console.log('(This can take 1-2 minutes for the emulator to boot)');
        
        // Ensure ADB server is running
        this.ensureADBServer();
        
        const startTime = Date.now();
        let lastProgressTime = startTime;
        const progressInterval = 10000; // Show progress every 10 seconds
        let lastDeviceCount = 0;

        while (Date.now() - startTime < timeout) {
            try {
                const devices = this.getConnectedDevices(true); // Quiet mode for repeated checks
                
                // Check all connected devices (including offline ones)
                const adbPath = this.findADB();
                const allDevicesOutput = execSync(`${adbPath} devices`, {
                    stdio: 'pipe',
                    encoding: 'utf8'
                });
                const allDevices = allDevicesOutput.trim().split('\n').slice(1)
                    .map(line => line.trim().split('\t'))
                    .filter(([id]) => id && id.length > 0);
                
                if (allDevices.length > lastDeviceCount) {
                    console.log(`Device detected: ${allDevices.map(([id, status]) => `${id} (${status})`).join(', ')}`);
                    lastDeviceCount = allDevices.length;
                }
                
                if (devices.length > 0) {
                    // Check if device is actually ready (not just "offline")
                    const deviceStatus = this.getDeviceStatus(devices[0]);
                    if (deviceStatus === 'device') {
                        console.log(`Device ready: ${devices[0]}`);
                        return devices[0];
                    } else if (deviceStatus === 'offline') {
                        // Device is connected but not ready yet
                        if (Date.now() - lastProgressTime >= progressInterval) {
                            console.log(`Device ${devices[0]} is offline, waiting for it to become ready...`);
                        }
                    }
                }
            } catch (e) {
                // Continue waiting even if there's an error checking devices
            }
            
            // Show progress every 10 seconds
            const elapsed = Date.now() - lastProgressTime;
            if (elapsed >= progressInterval) {
                const totalElapsed = Math.floor((Date.now() - startTime) / 1000);
                const remaining = Math.floor((timeout - (Date.now() - startTime)) / 1000);
                console.log(`Still waiting... (${totalElapsed}s elapsed, ${remaining}s remaining)`);
                lastProgressTime = Date.now();
            }
            
            // Wait 2 seconds before checking again (cross-platform)
            try {
                if (this.isWindows) {
                    execSync('timeout /t 2 /nobreak >nul 2>&1', { stdio: 'ignore' });
                } else {
                    execSync('sleep 2', { stdio: 'ignore' });
                }
            } catch (e) {
                // Fallback to busy wait if sleep commands fail
                const sleepStart = Date.now();
                while (Date.now() - sleepStart < 2000) {
                    // Busy wait for 2 seconds
                }
            }
        }

        console.error(`\nNo device found within ${timeout / 1000} seconds.`);
        console.error('The emulator may still be booting. You can:');
        console.error('1. Wait a bit longer and check status with: bun run devices');
        console.error('2. Check if the emulator window is open');
        console.error('3. Try starting the emulator manually and then run: bun run emulator:build');
        return null;
    }

    getDeviceStatus(deviceId) {
        try {
            const adbPath = this.findADB();
            const output = execSync(`${adbPath} devices`, {
                stdio: 'pipe',
                encoding: 'utf8'
            });
            const lines = output.trim().split('\n').slice(1);
            for (const line of lines) {
                const [id, status] = line.trim().split('\t');
                if (id === deviceId) {
                    return status || 'unknown';
                }
            }
            return 'unknown';
        } catch (e) {
            return 'unknown';
        }
    }

    killExistingEmulators() {
        console.log('Killing any existing emulator processes...');
        
        try {
            if (this.isWindows) {
                // Kill emulator processes on Windows
                try {
                    execSync('taskkill /F /IM emulator.exe /T 2>nul', { stdio: 'ignore' });
                } catch (e) {
                    // No emulator processes running, that's fine
                }
                // Also kill qemu processes (emulator backend)
                try {
                    execSync('taskkill /F /IM qemu-system-x86_64.exe /T 2>nul', { stdio: 'ignore' });
                } catch (e) {}
                try {
                    execSync('taskkill /F /IM qemu-system-arm.exe /T 2>nul', { stdio: 'ignore' });
                } catch (e) {}
            } else {
                // Kill emulator processes on Unix
                try {
                    execSync('pkill -f emulator 2>/dev/null', { stdio: 'ignore' });
                } catch (e) {}
                try {
                    execSync('pkill -f qemu-system 2>/dev/null', { stdio: 'ignore' });
                } catch (e) {}
            }
            
            // Wait a moment for processes to terminate
            const sleepStart = Date.now();
            while (Date.now() - sleepStart < 2000) {
                // Wait 2 seconds
            }
            
            // Kill any devices via ADB
            try {
                const adbPath = this.findADB();
                execSync(`${adbPath} kill-server`, { stdio: 'ignore' });
            } catch (e) {}
            
            console.log('Existing emulator processes terminated');
        } catch (e) {
            // Continue anyway
        }
    }

    startEmulator(avd = null) {
        console.log('Starting Android emulator...');

        const emulatorPath = this.findEmulator();
        
        // Always kill existing emulators to start fresh
        this.killExistingEmulators();
        
        // Ensure ADB server is running before starting emulator
        this.ensureADBServer();

        // If no AVD specified, try to find one
        if (!avd) {
            try {
                const avdList = this.runCommand(`${emulatorPath} -list-avds`, { silent: true });
                const avds = avdList.trim().split('\n').filter(line => line.trim());
                if (avds.length === 0) {
                    throw new Error('No AVDs found. Please create an Android Virtual Device first.');
                }
                avd = avds[0];
                console.log(`Using AVD: ${avd}`);
            } catch (e) {
                console.error('Error listing AVDs:', e.message);
                console.log('Please specify an AVD with --avd option');
                process.exit(1);
            }
        }

        // Start emulator in background with proper flags to keep it running
        console.log(`Starting fresh emulator: ${emulatorPath} -avd ${avd}`);
        const emulatorArgs = [
            '-avd', avd,
            '-no-audio',
            '-no-snapshot-load'  // Don't load snapshots, start fresh (but don't wipe data)
        ];
        
        console.log(`Emulator command: ${emulatorPath} ${emulatorArgs.join(' ')}`);
        
        // Use detached: true to run independently, but keep reference
        const emulatorProcess = spawn(emulatorPath, emulatorArgs, {
            detached: true,
            stdio: 'ignore',
            windowsHide: false
        });

        // Check if process started successfully
        if (!emulatorProcess.pid) {
            throw new Error('Failed to start emulator process');
        }
        
        console.log(`Emulator process started (PID: ${emulatorProcess.pid})`);

        // Store process reference to prevent garbage collection
        this.emulatorProcess = emulatorProcess;

        // Handle process events
        emulatorProcess.on('error', (error) => {
            console.error('Emulator process error:', error.message);
        });

        emulatorProcess.on('exit', (code, signal) => {
            if (code !== 0 && code !== null) {
                console.error(`\nEmulator process exited unexpectedly with code ${code}`);
                if (signal) {
                    console.error(`Killed by signal: ${signal}`);
                }
                console.error('This might indicate an issue with the AVD or emulator configuration.');
            }
            this.emulatorProcess = null;
        });

        // Don't unref immediately - keep the process reference
        // This ensures the emulator stays running even if the script continues

        console.log(`Emulator starting with AVD: ${avd}`);
        console.log('This may take a few minutes...');
        console.log('(The emulator window should appear and stay open)');

        // Wait for device to be ready
        const deviceId = this.waitForDevice();
        if (deviceId) {
            console.log('Emulator is ready!');
            // Now we can safely unref since it's running
            // But keep a reference so it doesn't get garbage collected
        } else {
            console.log('Emulator may still be starting. Continuing anyway...');
            console.log('Check if the emulator window is open.');
        }
    }

    buildAPK() {
        console.log('Building APK...');
        const clientDir = path.join(__dirname, '..', 'AhMyth-Client');

        if (!fs.existsSync(clientDir)) {
            throw new Error('AhMyth-Client directory not found');
        }

        process.chdir(clientDir);

        // Clean and build
        if (this.isWindows) {
            this.runCommand('gradlew.bat clean assembleDebug');
        } else {
            this.runCommand('./gradlew clean assembleDebug');
        }

        const apkPath = path.join(clientDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
        if (!fs.existsSync(apkPath)) {
            throw new Error('APK build failed - file not found');
        }

        console.log(`APK built: ${apkPath}`);
        return apkPath;
    }

    installAPK(apkPath = null) {
        console.log('Installing APK...');

        if (!apkPath) {
            // Look for built APK
            apkPath = path.join(__dirname, '..', 'AhMyth-Client', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
        }

        if (!fs.existsSync(apkPath)) {
            throw new Error(`APK not found: ${apkPath}`);
        }

        const deviceId = this.waitForDevice();
        if (!deviceId) {
            throw new Error('No device available for APK installation');
        }

        const adbPath = this.findADB();

        // Uninstall first if exists
        console.log('Uninstalling existing app...');
        this.runCommand(`${adbPath} uninstall ${this.packageName}`, { ignoreErrors: true });

        // Install with grants
        this.runCommand(`${adbPath} install -r -g "${apkPath}"`);

        console.log('APK installed successfully');
    }

    launchApp() {
        console.log('Launching app...');
        const deviceId = this.waitForDevice();
        if (!deviceId) {
            throw new Error('No device available to launch app');
        }

        const adbPath = this.findADB();
        this.runCommand(`${adbPath} shell am start -n ${this.packageName}/${this.mainActivity}`);
        console.log('App launched');
    }

    grantPermissions() {
        console.log('Granting permissions...');
        const deviceId = this.waitForDevice();
        if (!deviceId) {
            throw new Error('No device available to grant permissions');
        }

        const adbPath = this.findADB();

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
            'android.permission.READ_EXTERNAL_STORAGE',
            'android.permission.WRITE_EXTERNAL_STORAGE',
            'android.permission.POST_NOTIFICATIONS'
        ];

        for (const perm of permissions) {
            try {
                this.runCommand(`${adbPath} shell pm grant ${this.packageName} ${perm}`, { ignoreErrors: true });
            } catch (e) {
                // Some permissions might not be grantable via ADB
            }
        }

        // Special permissions via appops
        const appops = [
            'SYSTEM_ALERT_WINDOW allow',
            'GET_USAGE_STATS allow',
            'WRITE_SETTINGS allow',
            'MANAGE_EXTERNAL_STORAGE allow',
            'RUN_IN_BACKGROUND allow',
            'RUN_ANY_IN_BACKGROUND allow'
        ];

        for (const op of appops) {
            try {
                this.runCommand(`${adbPath} shell appops set ${this.packageName} ${op}`, { ignoreErrors: true });
            } catch (e) {
                // Some appops might not be settable
            }
        }

        // Battery optimization exemption
        try {
            this.runCommand(`${adbPath} shell cmd deviceidle whitelist +${this.packageName}`, { ignoreErrors: true });
        } catch (e) {}

        console.log('Permissions granted');
    }

    showDevices() {
        console.log('Connected devices:');
        const devices = this.getConnectedDevices();
        if (devices.length === 0) {
            console.log('No devices connected');
        } else {
            devices.forEach(device => console.log(`  ${device}`));
        }
    }

    showLogcat() {
        console.log('Starting logcat... (Press Ctrl+C to stop)');
        const deviceId = this.waitForDevice();
        if (!deviceId) {
            throw new Error('No device available for logcat');
        }

        const adbPath = this.findADB();
        const logcat = spawn(adbPath, ['logcat', '-v', 'time'], {
            stdio: 'inherit'
        });

        logcat.on('close', () => {
            console.log('Logcat stopped');
        });
    }

    clean() {
        console.log('Cleaning build artifacts...');
        const clientDir = path.join(__dirname, '..', 'AhMyth-Client');

        if (fs.existsSync(clientDir)) {
            process.chdir(clientDir);
            if (this.isWindows) {
                this.runCommand('gradlew.bat clean', { ignoreErrors: true });
            } else {
                this.runCommand('./gradlew clean', { ignoreErrors: true });
            }
        }

        // Remove any APK files in root
        const rootDir = path.join(__dirname, '..');
        const files = fs.readdirSync(rootDir);
        files.forEach(file => {
            if (file.endsWith('.apk')) {
                const filePath = path.join(rootDir, file);
                try {
                    fs.unlinkSync(filePath);
                    console.log(`Removed: ${file}`);
                } catch (e) {}
            }
        });

        console.log('Clean completed');
    }

    main() {
        const args = process.argv.slice(2);
        const command = args[0];

        switch (command) {
            case '--avd':
                const avdName = args[1];
                this.startEmulator(avdName);
                break;

            case '--launch-app':
                this.launchApp();
                break;

            case '--devices':
                this.showDevices();
                break;

            case '--logcat':
                this.showLogcat();
                break;

            case '--clean':
                this.clean();
                break;

            case '--build':
                this.buildAPK();
                break;

            case '--install':
                const apkPath = args[1];
                this.installAPK(apkPath);
                break;

            case '--grant':
                this.grantPermissions();
                break;

            default:
                // Default: start emulator, build, install, grant permissions, launch
                console.log('AhMyth Android Emulator Manager');
                console.log('================================');
                console.log('');

                try {
                    this.startEmulator();
                    const apkPath = this.buildAPK();
                    this.installAPK(apkPath);
                    this.grantPermissions();
                    this.launchApp();

                    console.log('');
                    console.log('Setup complete! The app should now be running on the emulator.');
                    console.log('Use "bun run logcat" to view device logs');
                    console.log('Press Ctrl+C to exit this script.');
                    
                    // Keep the process alive
                    process.stdin.resume();
                } catch (error) {
                    console.error('\nSetup failed:', error.message);
                    console.error('The emulator may still be starting. Check status with: bun run devices');
                    console.error('Press Ctrl+C to exit this script.');
                    
                    // Keep the process alive instead of exiting
                    process.stdin.resume();
                }
                break;
        }
    }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('\n\n=== UNCAUGHT EXCEPTION ===');
    console.error('Error:', error.message);
    if (error.stack) {
        console.error('\nStack trace:');
        console.error(error.stack);
    }
    console.error('\nScript will continue running. Press Ctrl+C to exit.');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('\n\n=== UNHANDLED REJECTION ===');
    console.error('Reason:', reason);
    console.error('\nScript will continue running. Press Ctrl+C to exit.');
});

// Run the manager
try {
    const manager = new EmulatorManager();
    manager.main();
} catch (error) {
    console.error('\n\n=== FATAL ERROR ===');
    console.error('Error:', error.message);
    if (error.stack) {
        console.error('\nStack trace:');
        console.error(error.stack);
    }
    console.error('\nScript encountered an error but will keep running.');
    console.error('You can check device status with: bun run devices');
    console.error('Press Ctrl+C to exit.');
    
    // Keep the process alive
    process.stdin.resume();
}














