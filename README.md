<p align="center">
  <a href="https://github.com/syrex1013/AhMyth" rel="noopener">
    <img width=200px height=200px src="https://i.imgur.com/6wj0hh6.jpg" alt="AhMyth Logo">
  </a>
</p>

<h3 align="center">AhMyth Android RAT - Modern Edition</h3>

<div align="center">

[![Version](https://img.shields.io/badge/version-2.6.0-blue.svg)](https://github.com/syrex1013/AhMyth/releases)
[![License](https://img.shields.io/badge/license-GPL--3.0-green.svg)](LICENSE.md)
[![Node](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen.svg)](https://nodejs.org/)
[![Bun](https://img.shields.io/badge/bun-%3E%3D1.0.0-yellow.svg)](https://bun.sh/)
[![Android](https://img.shields.io/badge/android-5.0%2B-orange.svg)](https://www.android.com/)

</div>

---

<p align="center">
  <b>AhMyth</b> is a modern Android Remote Administration Tool (RAT) featuring advanced forensic capabilities, 
  dual C2 communication modes (TCP/IP and Blockchain), and a professional Electron-based GUI. 
  Designed for security research, digital forensics, and authorized penetration testing.
  <br>
  <br>
  <b>⚠️ WARNING:</b> This tool is for authorized security testing and educational purposes only. 
  Unauthorized access to computer systems is illegal.
</p>

## 📝 Table of Contents

- [About](#-about)
- [Features](#-features)
- [Architecture](#-architecture)
- [Prerequisites](#-prerequisites)
- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [Usage](#-usage)
- [Command & Control (C2)](#-command--control-c2)
- [Building APKs](#-building-apks)
- [Testing](#-testing)
- [Project Structure](#-project-structure)
- [Built With](#-built-with)
- [Security & Legal](#-security--legal)
- [Contributing](#-contributing)
- [License](#-license)
- [Authors](#-authors)
- [Acknowledgments](#-acknowledgments)

## 🧐 About

AhMyth is a comprehensive Android Remote Administration Tool that provides security researchers, digital forensics experts, and authorized penetration testers with powerful capabilities for remote device management and data collection. The tool features a modern Electron-based GUI, supports both traditional TCP/IP and cutting-edge blockchain-based command and control, and includes advanced stealth features for forensic investigations.

### Key Highlights

- **Dual C2 Modes**: Traditional Socket.IO TCP/IP and decentralized Solana blockchain-based communication
- **Modern GUI**: Professional Electron-based interface with real-time monitoring and control
- **Advanced Stealth**: Transparent overlay service, hide from recents, persistent background operation
- **Comprehensive Features**: Camera, microphone, file system, SMS, calls, location, and more
- **Cross-Platform**: Windows, Linux, and macOS support for the server component
- **Android 5.0+ Support**: Compatible with Android versions from Lollipop (5.0) through Android 14+

## ✨ Features

### Core Capabilities

- **📷 Camera Control**: Remote camera capture (front/back), live streaming, foreground/background control
- **🎤 Audio Recording**: Live microphone streaming with real-time transcription
- **📁 File Management**: Browse, upload, download files with chunked transfer for large files
- **💬 SMS Management**: View, send SMS messages with conversation-style interface
- **📞 Call Management**: View call logs, make calls remotely
- **📇 Contacts**: Access and manage device contacts
- **📍 Location Tracking**: GPS location monitoring
- **📋 Clipboard**: Monitor and manage clipboard content
- **📶 WiFi Management**: View WiFi networks and saved passwords
- **📱 Device Information**: Comprehensive system information, CPU usage, battery status
- **📲 App Management**: List installed apps, install/uninstall applications
- **🖥️ Screen Sharing**: Real-time screen streaming with remote input control (VNC-like)
- **⌨️ Remote Input**: Inject touch events, key presses, navigation controls
- **📊 Keylogger**: Monitor keyboard input
- **🌐 Browser History**: Access browser history
- **🔔 Notifications**: View device notifications
- **📝 System Logs**: Access device logs and system information

### Advanced Features

- **Stealth Mode**: Transparent overlay, hide from recents, persistent service
- **Foreground Service**: Maintains connection even when app is backgrounded
- **Wake Lock**: Prevents device sleep during operations
- **Permission Auto-Grant**: Automated permission handling
- **Chunked File Transfer**: Efficient handling of large files
- **Real-time Transcription**: Live audio-to-text conversion
- **Blockchain C2**: Decentralized command and control via Solana blockchain
- **AES-256-GCM Encryption**: Secure command encryption for blockchain mode
- **SQLite Logging**: Persistent logging of all operations

## 🏗️ Architecture

### Components

```
AhMyth/
├── AhMyth-Server/          # Electron GUI Server
│   ├── app/
│   │   ├── main.js        # Main Electron process
│   │   ├── blockchain-*.js # Blockchain C2 handlers
│   │   └── app/           # AngularJS frontend
│   └── Factory/           # APK build factory
├── AhMyth-Client/          # Android Client (TCP/IP)
├── AhMyth-Client-Blockchain/ # Android Client (Blockchain C2)
└── scripts/               # Build and deployment scripts
```

### Communication Flow

**TCP/IP Mode:**
```
Android Client ←→ Socket.IO ←→ Electron Server
```

**Blockchain Mode:**
```
Android Client ←→ Solana Blockchain ←→ Electron Server
  (Polls memos)    (Memo instructions)   (Sends commands)
```

## 📋 Prerequisites

### Server Requirements

- **Node.js** >= 16.0.0 or **Bun** >= 1.0.0
- **npm** or **bun** package manager
- **Electron** (installed automatically)
- **Windows 10+**, **Linux**, or **macOS**

### Android Development

- **Android SDK** (API 21+)
- **Java JDK** 11 or higher
- **Gradle** (included via wrapper)
- **Android Studio** (optional, for development)

### Blockchain C2 (Optional)

- **Solana CLI** (for contract deployment)
- **Solana Devnet Account** (for blockchain mode)
- **RPC Endpoint** (Solana devnet or mainnet)

## 🚀 Installation

### 1. Clone the Repository

```bash
git clone https://github.com/syrex1013/AhMyth.git
cd AhMyth
```

### 2. Install Dependencies

**Using Bun (Recommended):**
```bash
bun install
bun run install:all
```

**Using npm:**
```bash
npm install
cd AhMyth-Server && npm install
cd app && npm install
cd ../..
```

### 3. Configure Android SDK

Set your Android SDK path in `local.properties`:

```properties
sdk.dir=/path/to/Android/Sdk
```

Or set the `ANDROID_HOME` environment variable:

```bash
# Windows
set ANDROID_HOME=C:\Users\YourName\AppData\Local\Android\Sdk

# Linux/macOS
export ANDROID_HOME=/path/to/Android/Sdk
```

## 🏁 Quick Start

### Start the Server

```bash
# Using Bun
bun run start

# Using npm
npm run server
```

The Electron GUI will launch automatically.

### Build and Install APK

**TCP/IP Mode:**
1. Open the Electron GUI
2. Navigate to "APK Builder" tab
3. Enter your server IP address and port
4. Click "Build APK"
5. Install the generated APK on target device

**Blockchain Mode:**
1. Generate blockchain keys:
   ```bash
   npm run generate:keys
   ```

2. Setup blockchain C2:
   ```bash
   npm run setup:blockchain
   ```

3. Build APK with blockchain configuration in the GUI

## 📖 Usage

### TCP/IP Mode

1. **Start Server**: Launch the Electron GUI
2. **Build APK**: Use APK Builder with your server IP:PORT
3. **Install APK**: Install on target Android device
4. **Connect**: Device will automatically connect when APK is launched
5. **Control**: Use GUI tabs to access device features

### Blockchain Mode

1. **Setup Blockchain**:
   ```bash
   npm run setup:blockchain
   ```

2. **Deploy Contract** (if needed):
   ```bash
   npm run deploy:contract
   ```

3. **Build Blockchain APK**: Use APK Builder with blockchain configuration
4. **Install & Connect**: APK will poll blockchain for commands

### GUI Features

- **Dashboard**: Overview of connected devices
- **Camera**: Remote camera control and capture
- **File Manager**: Browse and manage device files
- **SMS**: View and send SMS messages
- **Calls**: View call logs and make calls
- **Microphone**: Live audio streaming with transcription
- **Location**: GPS tracking
- **Screen**: Real-time screen sharing
- **System Info**: Device information and statistics
- **Logs**: Request/response logging panel

## 🔌 Command & Control (C2)

### TCP/IP Mode (Socket.IO)

- **Protocol**: Socket.IO over TCP/IP
- **Encryption**: Optional (configure in server)
- **Latency**: Low (direct connection)
- **Setup**: Simple (IP:PORT configuration)

### Blockchain Mode (Solana)

- **Protocol**: Solana blockchain memo instructions
- **Encryption**: AES-256-GCM
- **Latency**: Higher (blockchain confirmation time)
- **Setup**: Requires Solana keys and contract deployment
- **Advantages**: Decentralized, no central server, resilient

**Blockchain Setup:**
```bash
# Generate keys
npm run generate:keys

# Setup free blockchain C2
npm run setup:free

# Deploy contract
npm run deploy:contract

# Test connection
npm run test:blockchain:connection
```

See [BLOCKCHAIN_C2_IMPLEMENTATION.md](BLOCKCHAIN_C2_IMPLEMENTATION.md) and [FREE_BLOCKCHAIN_C2_GUIDE.md](FREE_BLOCKCHAIN_C2_GUIDE.md) for detailed documentation.

## 🔨 Building APKs

### Using GUI

1. Open Electron GUI
2. Navigate to "APK Builder"
3. Select connection type (TCP/IP or Blockchain)
4. Enter configuration
5. Click "Build APK"

### Using Command Line

**Debug Build:**
```bash
npm run build:apk:debug
```

**Release Build:**
```bash
npm run build:apk
```

**Build and Install:**
```bash
npm run build:test
```

### APK Output

Built APKs are located in:
- `AhMyth-Server/app/Factory/` (timestamped)
- `Output/` (root directory)

## 🧪 Testing

### Run Test Suite

```bash
# Comprehensive tests
npm run test:comprehensive

# Automated tests
npm run test:auto

# Full build and test
npm run test:full

# Blockchain tests
npm run test:blockchain
```

### Test Individual Components

```bash
# Server tests
cd AhMyth-Server
npm test

# Connection tests
npm run test:blockchain:connection
```

### GUI Test Suite

The Electron GUI includes a built-in test suite:
1. Open GUI
2. Navigate to "Test Suite" tab
3. Select device and configuration
4. Run automated tests

## 📁 Project Structure

```
AhMyth/
├── AhMyth-Server/              # Electron server application
│   ├── app/
│   │   ├── main.js            # Main Electron process
│   │   ├── blockchain-*.js    # Blockchain C2 implementation
│   │   ├── app/               # AngularJS frontend
│   │   │   └── assets/js/
│   │   │       └── controllers/
│   │   │           ├── AppCtrl.js    # Main controller
│   │   │           ├── LabCtrl.js    # Lab features
│   │   │           └── NotifiCtrl.js # Notifications
│   │   └── Factory/           # APK build factory
│   └── package.json
├── AhMyth-Client/              # Android client (TCP/IP)
│   ├── app/
│   │   └── src/main/java/
│   │       └── ahmyth/mine/king/ahmyth/
│   │           ├── MainService.java
│   │           ├── ConnectionManager.java
│   │           └── ...
│   └── build.gradle
├── AhMyth-Client-Blockchain/   # Android client (Blockchain)
│   └── (similar structure)
├── scripts/                    # Build and setup scripts
│   ├── build-blockchain-apk.js
│   ├── setup-solana-devnet.js
│   └── ...
├── .blockchain-keys.env        # Blockchain keys (gitignored)
├── .blockchain-contract.env    # Contract address (gitignored)
├── package.json
└── README.md
```

## 🛠️ Built With

### Server

- **[Electron](https://www.electronjs.org/)** - Cross-platform desktop framework
- **[Node.js](https://nodejs.org/)** / **[Bun](https://bun.sh/)** - JavaScript runtime
- **[Socket.IO](https://socket.io/)** - Real-time communication
- **[AngularJS](https://angularjs.org/)** - Frontend framework
- **[SQLite3](https://www.sqlite.org/)** - Local database

### Android Client

- **[Java](https://www.java.com/)** - Android development
- **[Gradle](https://gradle.org/)** - Build system
- **[Android SDK](https://developer.android.com/studio)** - Android development tools

### Blockchain C2

- **[Solana Web3.js](https://solana-labs.github.io/solana-web3.js/)** - Solana blockchain integration
- **[Solidity](https://soliditylang.org/)** - Smart contract language (for EVM chains)
- **[AES-256-GCM](https://en.wikipedia.org/wiki/Galois/Counter_Mode)** - Encryption

## ⚠️ Security & Legal

### ⚠️ IMPORTANT DISCLAIMER

**This software is provided for educational and authorized security testing purposes only.**

- **Unauthorized access to computer systems is illegal** and may result in criminal prosecution
- Only use this tool on devices you own or have explicit written permission to test
- The authors and contributors are not responsible for misuse of this software
- Users are solely responsible for compliance with applicable laws and regulations

### Security Best Practices

- Keep sensitive files (`.blockchain-keys.env`, keystores) secure and never commit them
- Use strong encryption for production deployments
- Regularly update dependencies for security patches
- Follow responsible disclosure practices for vulnerabilities

## 🤝 Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### Development Guidelines

- Follow existing code style and conventions
- Add tests for new features
- Update documentation as needed
- Ensure all tests pass before submitting PR

## 📄 License

This project is licensed under the **GNU General Public License v3.0** - see the [LICENSE.md](LICENSE.md) file for details.

## 👥 Authors

- **AhMyth Team** - *Original work* - [AhMyth](https://github.com/AhMyth)
- **syrex1013** - *Modern Edition & Blockchain C2* - [@syrex1013](https://github.com/syrex1013)

See also the list of [contributors](https://github.com/syrex1013/AhMyth/contributors) who participated in this project.

## 🙏 Acknowledgments

- Original AhMyth project by [AhMyth Team](https://github.com/AhMyth/AhMyth-Android-RAT)
- Solana Labs for blockchain infrastructure
- Electron team for the excellent framework
- All contributors and testers

---

<p align="center">
  <b>⚠️ Use Responsibly</b> | 
  <a href="LICENSE.md">License</a> | 
  <a href="CHANGELOG.md">Changelog</a> | 
  <a href="https://github.com/syrex1013/AhMyth/issues">Issues</a>
</p>
