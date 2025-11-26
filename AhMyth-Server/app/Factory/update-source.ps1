# Update Factory/Ahmyth from latest client source
# Run this script to sync the decompiled APK with the latest client code

param(
    [switch]$Force,
    [switch]$Debug
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$clientDir = Join-Path $scriptDir ".." ".." ".." "AhMyth-Client"
$factoryDir = $scriptDir
$ahmythDir = Join-Path $factoryDir "Ahmyth"

Write-Host "=== AhMyth Factory Source Updater ===" -ForegroundColor Cyan

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

