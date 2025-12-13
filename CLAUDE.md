# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AhMyth is an Android Remote Administration Tool (RAT) with dual C2 modes: traditional Socket.IO TCP/IP and blockchain-based (Solana) communication. The project consists of an Electron-based GUI server and Android client applications with advanced stealth and forensic capabilities.

**CRITICAL**: This is a security research tool. Code modifications must maintain responsible disclosure standards and should only enable authorized security testing. Never enhance malicious capabilities beyond educational/research scope.

## Architecture

### Three-Tier System

1. **AhMyth-Server/** - Electron GUI application (main controller)
   - `app/main.js` - Main Electron process, Socket.IO server initialization
   - `app/blockchain-*.js` - Blockchain C2 server components (listener, operator, response poller)
   - `app/transcription-service.js` - Live audio transcription using Vosk
   - `app/app/` - AngularJS frontend (controllers in `assets/js/controllers/`)
   - `app/Factory/` - APK build factory with templates and injection scripts

2. **AhMyth-Client/** - Android client (TCP/IP mode)
   - `MainService.java` - Core foreground service with wake lock and overlay persistence
   - `ConnectionManager.java` - Socket.IO connection handling
   - `IOSocket.java` - Socket event handler and command dispatcher
   - Feature managers: `CameraManager`, `MicManager`, `FileManager`, `SMSManager`, etc.
   - `StealthConfig.java` - Configuration for stealth features (hide from recents, transparent overlay)

3. **AhMyth-Client-Blockchain/** - Android client (Blockchain C2 mode)
   - Similar structure to TCP/IP client
   - `BlockchainC2Manager.java` - Manages blockchain polling and command execution
   - `BlockchainCrypto.java` - AES-256-GCM encryption/decryption
   - `BlockchainEventPoller.java` - Polls Solana blockchain for memo instructions
   - `IOSocketBlockchain.java` - Blockchain-specific command handler

### Communication Flow

**TCP/IP Mode:**
- Client connects via Socket.IO to server (IP:PORT)
- Real-time bidirectional communication
- Events emitted: `x0000` (victim info), camera capture, file transfer, etc.

**Blockchain Mode:**
- Server writes encrypted commands to Solana blockchain transaction memos
- Client polls blockchain for new memos addressed to its public key
- Client decrypts commands using shared AES key
- Client responds by writing encrypted results to blockchain
- Server polls for client responses

### Key Design Patterns

- **Victim Model** (`app/assets/js/model/Victim.js`): Server-side victim state management with persistence
- **Manager Pattern**: Android client uses separate managers for each feature (Camera, Mic, Files, SMS, etc.)
- **Foreground Service Persistence**: Uses 1px transparent overlay + wake lock to prevent Android from killing the service
- **Chunked File Transfer**: Large files split into chunks for reliable transfer over Socket.IO/blockchain
- **ProGuard/R8 Obfuscation**: Release builds use aggressive obfuscation with custom dictionaries

## Build System

### Development Setup

**Prerequisites:**
- Node.js >= 16.0.0 or Bun >= 1.0.0
- Android SDK (API 21+) with `ANDROID_HOME` environment variable set
- Java JDK 11+
- Gradle (via wrapper: `AhMyth-Client/gradlew.bat` on Windows)

**Install dependencies:**
```bash
bun install              # Root dependencies
bun run install:all      # Server + app dependencies
```

### Building APKs

**Debug build (no obfuscation, for testing):**
```bash
npm run build:apk:debug
# Output: AhMyth-Client/app/build/outputs/apk/debug/app-debug.apk
```

**Release build (obfuscated):**
```bash
npm run build:apk
# Output: AhMyth-Client/app/build/outputs/apk/release/app-release.apk
```

**Build + Install to connected device:**
```bash
npm run build:test
```

**Clean build artifacts:**
```bash
npm run clean
```

### Gradle Build Configuration

- `AhMyth-Client/app/build.gradle` - Main build config
- Randomizes version code/name to look less suspicious
- ProGuard rules in `proguard-rules.pro` (aggressive obfuscation)
- Custom obfuscation dictionary in `proguard-dict.txt`
- R8 full mode enabled for maximum optimization

### APK Factory System

The server includes an APK factory (`AhMyth-Server/app/Factory/`) that:
1. Decompiles base APK with apktool
2. Injects server IP:PORT or blockchain config into smali code
3. Recompiles and signs APK
4. Scripts: `update-source.ps1` (PowerShell) for automated builds

**Blockchain APK injection:**
```bash
node AhMyth-Server/app/Factory/inject_blockchain.js
```

## Running the Server

**Start Electron GUI:**
```bash
bun run start           # or: npm run server
# Launches Electron app on default port (or AHMYTH_AUTO_LISTEN_PORT env var)
```

**Server creates:**
- Socket.IO server on configured port
- Victims persistence file in Electron userData directory
- Log files in `userData/logs/`

## Testing

**Comprehensive test suite:**
```bash
npm run test:comprehensive     # All tests including blockchain
npm run test:auto              # Automated test suite
npm run test:full              # Build + install + test
```

**Blockchain-specific tests:**
```bash
npm run test:blockchain                    # Full blockchain C2 test suite
npm run test:blockchain:connection         # Connection test
npm run test:blockchain:connection:emulator # Test with emulator
```

**Android Emulator testing:**
```bash
npm run emulator               # Launch emulator
npm run emulator:build         # Build debug APK
npm run emulator:install       # Install to emulator
npm run emulator:run           # Launch app on emulator
npm run logcat                 # View Android logs
```

## Blockchain C2 System

### Setup Process

1. **Generate keypairs:**
```bash
npm run generate:keys
# Creates .blockchain-keys.env with server and client keys
```

2. **Deploy Solana contract (optional):**
```bash
npm run deploy:contract
# Deploys CommandChannel.sol to Solana devnet
# Saves contract address to .blockchain-contract.env
```

3. **Setup free blockchain C2:**
```bash
npm run setup:free             # Completely free setup (no contract deployment)
npm run setup:blockchain       # Standard setup with contract
```

### Blockchain Configuration Files

- `.blockchain-keys.env` - Server/client keypairs (NEVER commit)
- `.blockchain-contract.env` - Contract address (NEVER commit)
- `blockchain-build-config.json` - Build configuration for blockchain APK

### How It Works

1. Server generates encrypted command: `{"type":"camera","action":"capture"}`
2. Server creates Solana transaction with memo containing encrypted JSON
3. Client polls blockchain, finds memo addressed to its pubkey
4. Client decrypts command with shared AES key
5. Client executes command and writes encrypted result to blockchain
6. Server polls for client response and decrypts

**Key Files:**
- `AhMyth-Server/app/blockchain-operator.js` - Server command sender
- `AhMyth-Server/app/blockchain-listener.js` - Server listener for new clients
- `AhMyth-Server/app/blockchain-response-poller.js` - Server response reader
- `AhMyth-Client/*/BlockchainC2Manager.java` - Client coordinator
- `AhMyth-Client/*/BlockchainEventPoller.java` - Client command poller

## File System Conventions

### Important Paths

- **Server victim persistence:** `<Electron userData>/victims.json`
- **Server logs:** `<Electron userData>/logs/ahmyth-YYYY-MM-DD.log`
- **APK output:** `AhMyth-Server/app/Factory/<timestamp>/` and `Output/`
- **Android signing keystore:** `AhMyth-Client/app/release.keystore`

### Ignored Files (Never Commit)

- `.blockchain-keys.env` - Blockchain private keys
- `.blockchain-contract.env` - Contract addresses
- `.env` - Environment variables
- `AhMyth-Server/app/Factory/Ahmyth-test/` - Test builds
- `AhMyth-Client/.gradle/` - Gradle cache
- `AhMyth-Client/app/build/` - Build outputs

## Code Modification Guidelines

### When Modifying Server (Electron/Node.js)

- Server uses Socket.IO event names that match client event handlers
- Victim model is persistent - use `victimsList.save()` after modifications
- Log using the custom logger: `log.info()`, `log.error()`, `log.success()`
- Main process IPC communication with renderer uses `ipcMain` and `@electron/remote`

### When Modifying Android Client

- **CRITICAL**: Changes to core service lifecycle in `MainService.java` can break persistence
- All feature managers follow pattern: static `getInstance()` + command handlers
- Socket events must match server expectations (e.g., `x0000` for victim info)
- Stealth features depend on:
  - Foreground notification with `FOREGROUND_SERVICE_TYPE_MICROPHONE` (Android 14+)
  - `SYSTEM_ALERT_WINDOW` permission for overlay
  - Wake lock to prevent sleep
- ProGuard rules must allow Socket.IO reflection - check `proguard-rules.pro`

### When Modifying Blockchain Components

- AES-256-GCM is used with 96-bit IV and 128-bit auth tag
- Solana memo instructions are limited to 566 bytes (encrypted payload must fit)
- Polling intervals are configurable but affect command latency
- Always test with `npm run test:blockchain:connection` before deployment

## Common Development Tasks

**Add new command to TCP/IP client:**
1. Add handler in `IOSocket.java` event listener
2. Create/modify feature manager class
3. Update server controller to emit the new event
4. Test with GUI or manual Socket.IO emit

**Add new command to blockchain client:**
1. Add handler in `IOSocketBlockchain.java`
2. Implement in feature manager
3. Update `blockchain-operator.js` to send new command type
4. Test encryption/decryption flow

**Modify APK stealth features:**
1. Edit `StealthConfig.java` for configuration
2. Update `MainService.java` for service behavior
3. Modify `AndroidManifest.xml` for permissions/receivers
4. Rebuild with `npm run build:apk:debug` for testing

**Debug Android client:**
1. Build debug APK: `npm run build:apk:debug`
2. Install on device/emulator: `npm run emulator:install`
3. View logs: `npm run logcat` or `adb logcat -s AhMythService IOSocket MainService`
4. Check ProGuard mapping: `app/build/outputs/mapping/release/mapping.txt`

## Security Considerations

- This tool is designed for authorized security testing only
- Server does not include authentication by default - add your own
- Blockchain mode uses AES-256-GCM but keys are stored in env files
- ProGuard obfuscation helps evade static analysis but is not foolproof
- Android permissions are requested at runtime for dangerous permissions
- Stealth features (hide from recents, overlay) may trigger Play Protect

## Package Manager Notes

- Project supports both **npm** and **Bun**
- Bun is faster and recommended: `bun run <script>`
- Server dependencies include Electron, Socket.IO, Solana Web3.js, ethers
- Android client uses Gradle with Maven Central for dependencies
- Lock files: `package-lock.json`, `bun.lock`, `AhMyth-Server/package-lock.json`

## Environment Variables

**Optional server configuration:**
- `AHMYTH_AUTO_LISTEN_PORT` - Auto-start server on this port
- See `.env` file (create from template if needed)

**Blockchain configuration (auto-generated):**
- `.blockchain-keys.env` - Contains `SERVER_PRIVATE_KEY`, `CLIENT_PUBLIC_KEY`, etc.
- `.blockchain-contract.env` - Contains `CONTRACT_ADDRESS`, `RPC_URL`

## Known Issues and Workarounds

- **Android 14+ foreground service restrictions**: Must specify service type (`FOREGROUND_SERVICE_TYPE_MICROPHONE`)
- **ProGuard breaking Socket.IO**: Keep rules ensure reflection works
- **Blockchain memo size limit**: Commands must be compact (<566 bytes encrypted)
- **Emulator connection**: Use `10.0.2.2` instead of `localhost` for emulator to reach host
