#!/usr/bin/env node
/**
 * Quick launcher for comprehensive test suite
 * Automatically checks prerequisites and runs tests
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

async function checkPrerequisites() {
    console.log('Checking prerequisites...\n');
    
    // Check Node.js
    try {
        const { stdout } = await execAsync('node --version');
        console.log(`✓ Node.js: ${stdout.trim()}`);
    } catch (error) {
        console.error('✗ Node.js not found. Please install Node.js.');
        process.exit(1);
    }
    
    // Check ADB
    try {
        const { stdout } = await execAsync('adb version');
        console.log(`✓ ADB: ${stdout.split('\n')[0]}`);
    } catch (error) {
        console.error('✗ ADB not found. Please install Android SDK Platform Tools.');
        console.error('  Download from: https://developer.android.com/studio/releases/platform-tools');
        process.exit(1);
    }
    
    // Check socket.io
    try {
        require('socket.io');
        console.log('✓ socket.io installed');
    } catch (error) {
        console.log('Installing socket.io...');
        await execAsync('npm install socket.io');
        console.log('✓ socket.io installed');
    }
    
    console.log('\nAll prerequisites met!\n');
}

async function main() {
    await checkPrerequisites();
    
    console.log('Starting comprehensive test suite...\n');
    
    // Run the test suite
    require('./test-comprehensive-suite.js');
}

main().catch(error => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
});












