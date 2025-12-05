# AhMyth Comprehensive Test Suite Launcher (PowerShell)
# Automatically checks prerequisites and runs tests

Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     AhMyth Comprehensive Test Suite                       ║" -ForegroundColor Cyan
Write-Host "║     Testing ConnectionManager & Stealth Options          ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
Write-Host "[1/3] Checking Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ Node.js: $nodeVersion" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Node.js not found. Please install Node.js." -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "  ✗ Node.js not found. Please install Node.js." -ForegroundColor Red
    exit 1
}

# Check ADB
Write-Host "[2/3] Checking ADB..." -ForegroundColor Yellow
try {
    $adbVersion = adb version 2>&1 | Select-Object -First 1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ ADB: $adbVersion" -ForegroundColor Green
    } else {
        Write-Host "  ✗ ADB not found. Please install Android SDK Platform Tools." -ForegroundColor Red
        Write-Host "    Download from: https://developer.android.com/studio/releases/platform-tools" -ForegroundColor Gray
        exit 1
    }
} catch {
    Write-Host "  ✗ ADB not found. Please install Android SDK Platform Tools." -ForegroundColor Red
    Write-Host "    Download from: https://developer.android.com/studio/releases/platform-tools" -ForegroundColor Gray
    exit 1
}

# Check socket.io
Write-Host "[3/3] Checking dependencies..." -ForegroundColor Yellow
try {
    $null = require socket.io 2>&1
    Write-Host "  ✓ socket.io installed" -ForegroundColor Green
} catch {
    Write-Host "  Installing socket.io..." -ForegroundColor Yellow
    npm install socket.io --silent
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ socket.io installed" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Failed to install socket.io" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "All prerequisites met!" -ForegroundColor Green
Write-Host ""

# Check for connected devices
Write-Host "Checking for connected devices..." -ForegroundColor Yellow
$devices = adb devices 2>&1 | Select-String "device$"
if ($devices) {
    Write-Host "  ✓ Found device(s)" -ForegroundColor Green
    $devices | ForEach-Object {
        Write-Host "    - $_" -ForegroundColor Gray
    }
} else {
    Write-Host "  ⚠ No devices found. Please connect a device or start an emulator." -ForegroundColor Yellow
    Write-Host "    Run 'adb devices' to check" -ForegroundColor Gray
    Write-Host ""
    $continue = Read-Host "Continue anyway? (y/n)"
    if ($continue -ne "y" -and $continue -ne "Y") {
        exit 0
    }
}

Write-Host ""
Write-Host "Starting comprehensive test suite..." -ForegroundColor Cyan
Write-Host ""

# Run the test suite
node test-comprehensive-suite.js

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Test suite completed with errors. Check output above." -ForegroundColor Red
    exit $LASTEXITCODE
} else {
    Write-Host ""
    Write-Host "Test suite completed successfully!" -ForegroundColor Green
}

