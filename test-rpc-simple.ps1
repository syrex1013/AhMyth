# Simple RPC Test Script
$rpcUrl = "https://ethereum-sepolia-rpc.publicnode.com"
$jsonBody = '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

Write-Host "Testing RPC endpoint: $rpcUrl" -ForegroundColor Cyan
Write-Host "Request: $jsonBody" -ForegroundColor Gray

try {
    $response = Invoke-RestMethod -Uri $rpcUrl -Method Post -Body $jsonBody -ContentType "application/json"
    
    Write-Host ""
    Write-Host "Response:" -ForegroundColor Green
    $response | ConvertTo-Json -Depth 10
    
    if ($response.result) {
        $blockHexValue = $response.result
        $blockDecimal = [Convert]::ToInt64($blockHexValue, 16)
        Write-Host ""
        Write-Host "SUCCESS - Block Number (hex): $blockHexValue" -ForegroundColor Green
        Write-Host "SUCCESS - Block Number (decimal): $blockDecimal" -ForegroundColor Green
        Write-Host ""
        Write-Host "RPC endpoint is working correctly!" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "ERROR - No result in response" -ForegroundColor Red
    }
} catch {
    Write-Host ""
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
}

