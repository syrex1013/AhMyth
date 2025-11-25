# Build, sign, and install APK script
# Similar to electron-builder's automated signing process

$ErrorActionPreference = "Stop"

Write-Host "=== AhMyth Client Build & Install Script ===" -ForegroundColor Cyan

# Set ADB path
$adbPath = if ($env:ANDROID_HOME) { 
    Join-Path $env:ANDROID_HOME "platform-tools\adb.exe"
} elseif (Test-Path "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe") {
    "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
} else {
    Write-Host "ERROR: ADB not found. Please set ANDROID_HOME or install Android SDK." -ForegroundColor Red
    exit 1
}

$env:PATH += ";$(Split-Path $adbPath)"

# Check for connected device
Write-Host "`n[1/5] Checking for connected devices..." -ForegroundColor Yellow
$devices = & adb devices | Select-String "device$" | ForEach-Object { ($_ -split '\s+')[0] }
if (-not $devices) {
    Write-Host "ERROR: No devices connected. Please connect a device or start an emulator." -ForegroundColor Red
    exit 1
}
$device = $devices[0]
Write-Host "Found device: $device" -ForegroundColor Green

# Create keystore if it doesn't exist
Write-Host "`n[2/5] Checking signing keystore..." -ForegroundColor Yellow
if (-not (Test-Path "app\release.keystore")) {
    Write-Host "Creating keystore..." -ForegroundColor Yellow
    keytool -genkey -v -keystore app\release.keystore -alias release -keyalg RSA -keysize 2048 -validity 10000 -storepass android -keypass android -dname "CN=AhMyth, OU=Development, O=AhMyth, L=Unknown, ST=Unknown, C=US" 2>&1 | Out-Null
    Write-Host "Keystore created." -ForegroundColor Green
} else {
    Write-Host "Keystore exists." -ForegroundColor Green
}

# Clean and build
Write-Host "`n[3/5] Building APK..." -ForegroundColor Yellow
& .\gradlew.bat clean assembleRelease
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "Build successful!" -ForegroundColor Green

# Verify APK exists
$apkPath = "app\build\outputs\apk\release\app-release.apk"
if (-not (Test-Path $apkPath)) {
    Write-Host "ERROR: APK not found at $apkPath" -ForegroundColor Red
    exit 1
}

# Verify signature
Write-Host "`n[4/5] Verifying APK signature..." -ForegroundColor Yellow
$verifyOutput = jarsigner -verify -verbose -certs $apkPath 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "APK is properly signed." -ForegroundColor Green
} else {
    Write-Host "WARNING: Signature verification had issues (this may be normal for self-signed certs)" -ForegroundColor Yellow
}

# Uninstall existing app if needed
Write-Host "`n[5/5] Installing APK on device..." -ForegroundColor Yellow
& adb -s $device uninstall ahmyth.mine.king.ahmyth 2>&1 | Out-Null

# Install APK
& adb -s $device install -r $apkPath
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Installation failed!" -ForegroundColor Red
    exit 1
}
Write-Host "Installation successful!" -ForegroundColor Green

# Check logs for errors
Write-Host "`n[6/6] Checking for runtime errors..." -ForegroundColor Yellow
Start-Sleep -Seconds 2
$errors = & adb -s $device logcat -d *:E AndroidRuntime:F | Select-String -Pattern "ahmyth" | Select-Object -Last 10
if ($errors) {
    Write-Host "Found errors in logs:" -ForegroundColor Yellow
    $errors | ForEach-Object { Write-Host $_ -ForegroundColor Red }
} else {
    Write-Host "No fatal errors found in logs." -ForegroundColor Green
}

Write-Host "`n=== Build and Install Complete ===" -ForegroundColor Cyan
Write-Host "APK location: $apkPath" -ForegroundColor Cyan
Write-Host "Device: $device" -ForegroundColor Cyan
Write-Host "`nTo view logs: adb -s $device logcat | Select-String ahmyth" -ForegroundColor Cyan

