# AhMyth Test Runner
# Runs all tests for Android client and Node.js server

Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║          AhMyth Comprehensive Test Suite                ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

$exitCode = 0

# Android Client Tests
Write-Host "[1/3] Android Unit Tests" -ForegroundColor Yellow
Write-Host "─────────────────────────────────────────────────────────" -ForegroundColor Gray
cd "$PSScriptRoot\AhMyth-Client"

Write-Host "Running unit tests..." -ForegroundColor White
$result = & .\gradlew test --console=plain 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "[✓] Unit tests passed" -ForegroundColor Green
} else {
    Write-Host "[✗] Unit tests failed" -ForegroundColor Red
    $exitCode = 1
}

Write-Host ""

# Android Instrumented Tests
Write-Host "[2/3] Android Instrumented Tests" -ForegroundColor Yellow
Write-Host "─────────────────────────────────────────────────────────" -ForegroundColor Gray

# Check if device is connected
$devices = & adb devices 2>&1 | Select-String "device$"
if ($devices) {
    Write-Host "Running instrumented tests on connected device..." -ForegroundColor White
    $result = & .\gradlew connectedAndroidTest --console=plain 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[✓] Instrumented tests passed" -ForegroundColor Green
    } else {
        Write-Host "[✗] Instrumented tests failed" -ForegroundColor Red
        $exitCode = 1
    }
} else {
    Write-Host "[!] No Android device connected - skipping instrumented tests" -ForegroundColor Yellow
    Write-Host "    Connect device with 'adb devices' to run instrumented tests" -ForegroundColor Gray
}

Write-Host ""

# Server Tests
Write-Host "[3/3] Server Tests" -ForegroundColor Yellow
Write-Host "─────────────────────────────────────────────────────────" -ForegroundColor Gray
cd "$PSScriptRoot\AhMyth-Server"

# Check if node_modules exists
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing test dependencies..." -ForegroundColor White
    npm install --silent
}

Write-Host "Running server tests..." -ForegroundColor White
$result = & npm test 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "[✓] Server tests passed" -ForegroundColor Green
} else {
    Write-Host "[✗] Server tests failed" -ForegroundColor Red
    $exitCode = 1
}

Write-Host ""
Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor Cyan

# Summary
if ($exitCode -eq 0) {
    Write-Host "✓ All tests passed!" -ForegroundColor Green
} else {
    Write-Host "✗ Some tests failed - check output above" -ForegroundColor Red
}

Write-Host ""

# Test reports
Write-Host "Test Reports:" -ForegroundColor Yellow
Write-Host "  Android Unit: AhMyth-Client\app\build\reports\tests\testDebugUnitTest\index.html" -ForegroundColor Gray
Write-Host "  Android Instrumented: AhMyth-Client\app\build\reports\androidTests\connected\index.html" -ForegroundColor Gray
Write-Host "  Server: Console output above" -ForegroundColor Gray

exit $exitCode
