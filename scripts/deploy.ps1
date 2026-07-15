# Deploy script for StellarFund contracts on Stellar Testnet

$deployerSource = "deployer"
$deployerAddress = "GCYMLCJTY6KNGGWRXHNMPDVQIPJZDQKHU45W4TA3QUELIPCFKY3ARHF5"
$tokenAddress = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC" # Native XLM on Testnet

Write-Host "=========================================="
Write-Host "1. Installing Campaign WASM on-chain..."
Write-Host "=========================================="
$campaignWasmPath = "target/wasm32-unknown-unknown/release/stellarfund_campaign.optimized.wasm"
$installCmd = "stellar contract install --wasm $campaignWasmPath --source $deployerSource --network testnet"
Write-Host "Running: $installCmd"
$campaignWasmHash = Invoke-Expression $installCmd
$campaignWasmHash = $campaignWasmHash.Trim()
Write-Host "Campaign WASM Hash: $campaignWasmHash"

Write-Host "=========================================="
Write-Host "2. Deploys Factory Contract on-chain..."
Write-Host "=========================================="
$factoryWasmPath = "target/wasm32-unknown-unknown/release/stellarfund_factory.optimized.wasm"
$deployCmd = "stellar contract deploy --wasm $factoryWasmPath --source $deployerSource --network testnet"
Write-Host "Running: $deployCmd"
$factoryId = Invoke-Expression $deployCmd
$factoryId = $factoryId.Trim()
Write-Host "Factory Contract ID: $factoryId"

Write-Host "=========================================="
Write-Host "3. Initializing Factory Contract..."
Write-Host "=========================================="
$initCmd = "stellar contract invoke --id $factoryId --source $deployerSource --network testnet -- init --campaign_wasm_hash $campaignWasmHash --token_address $tokenAddress"
Write-Host "Running: $initCmd"
$initRes = Invoke-Expression $initCmd
Write-Host "Initialization Result: $initRes"

Write-Host "=========================================="
Write-Host "4. Creating a Test Campaign..."
Write-Host "=========================================="
$deadline = [DateTimeOffset]::Now.AddDays(7).ToUnixTimeSeconds()
$goal = "10000000000" # 1000 XLM
$title = "Save the Oceans"
$description = "Crowdfunding for cleaning marine plastic on Stellar Testnet"

$createCampaignCmd = "stellar contract invoke --id $factoryId --source $deployerSource --network testnet -- create_campaign --creator $deployerAddress --goal $goal --deadline $deadline --title `"$title`" --description `"$description`""
Write-Host "Running: $createCampaignCmd"
$campaignAddress = Invoke-Expression $createCampaignCmd
$campaignAddress = $campaignAddress.Trim()
# Strip quotes if CLI returns string with quotes
$campaignAddress = $campaignAddress.Replace('"', '')
Write-Host "New Campaign Contract Address: $campaignAddress"

Write-Host "=========================================="
Write-Host "5. Making a 10 XLM Pledge Transaction..."
Write-Host "=========================================="
$pledgeAmount = "100000000" # 10 XLM
$pledgeCmd = "stellar contract invoke --id $campaignAddress --source $deployerSource --network testnet -- pledge --contributor $deployerAddress --amount $pledgeAmount"
Write-Host "Running: $pledgeCmd"
$pledgeRes = Invoke-Expression $pledgeCmd
Write-Host "Pledge Result: $pledgeRes"

# Save the details to a JSON file for the frontend
$deployData = @{
    network = "testnet"
    deployer = $deployerAddress
    token = $tokenAddress
    campaignWasmHash = $campaignWasmHash
    factoryContractId = $factoryId
    testCampaignAddress = $campaignAddress
    deadline = $deadline
} | ConvertTo-Json

$outputDir = "frontend/src"
if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}
$deployData | Out-File -FilePath "$outputDir/deployed_addresses.json" -Encoding utf8
Write-Host "Saved deployment data to $outputDir/deployed_addresses.json"
Write-Host "=========================================="
Write-Host "Deployment Completed Successfully!"
Write-Host "=========================================="
