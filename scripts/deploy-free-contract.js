/**
 * Deploy Free Contract - Uses Sepolia Testnet
 * 
 * This deploys a contract to Sepolia testnet using FREE testnet ETH.
 * Sepolia is a testnet - no real money needed!
 * 
 * To get FREE Sepolia ETH (testnet, not real money):
 * 1. https://sepoliafaucet.com/ (Alchemy - may need account)
 * 2. https://faucet.quicknode.com/ethereum/sepolia (QuickNode)
 * 3. https://www.infura.io/faucet/sepolia (Infura - needs account)
 * 4. https://sepolia-faucet.pk910.de/ (PoW faucet - mine for ETH)
 * 
 * Usage:
 *   node deploy-free-contract.js
 * 
 * Requirements:
 *   BLOCKCHAIN_PRIVATE_KEY - Your wallet private key
 */

const { ethers } = require('ethers');

// Use free public RPC - no API key needed
// Multiple fallback RPCs for reliability
const RPC_URLS = [
    'https://ethereum-sepolia-rpc.publicnode.com',
    'https://rpc.sepolia.org',
    'https://sepolia.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161', // Public Infura endpoint
    'https://sepolia.gateway.tenderly.co'
];

let RPC_URL = process.env.BLOCKCHAIN_RPC_URL || RPC_URLS[0];

// Contract ABI (bidirectional - commands and responses)
const CONTRACT_ABI = [
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "bytes",
                "name": "encrypted",
                "type": "bytes"
            }
        ],
        "name": "Command",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "bytes",
                "name": "encrypted",
                "type": "bytes"
            }
        ],
        "name": "Response",
        "type": "event"
    },
    {
        "inputs": [
            {
                "internalType": "bytes",
                "name": "encrypted",
                "type": "bytes"
            }
        ],
        "name": "pushCommand",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes",
                "name": "encrypted",
                "type": "bytes"
            }
        ],
        "name": "pushResponse",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
];

// Contract bytecode (compiled CommandChannel.sol with solc 0.8.20)
// Source: pragma solidity ^0.8.0;
// contract CommandChannel {
//     event Command(bytes encrypted);
//     event Response(bytes encrypted);
//     function pushCommand(bytes calldata encrypted) external {
//         emit Command(encrypted);
//     }
//     function pushResponse(bytes calldata encrypted) external {
//         emit Response(encrypted);
//     }
// }
// This bytecode is verified - no require statements, always succeeds
// Supports bidirectional communication: commands (operator->client) and responses (client->operator)
const CONTRACT_BYTECODE = '0x6080604052348015600e575f5ffd5b506102508061001c5f395ff3fe608060405234801561000f575f5ffd5b5060043610610034575f3560e01c80635eb57f5714610038578063ec16c66a14610054575b5f5ffd5b610052600480360381019061004d9190610153565b610070565b005b61006e60048036038101906100699190610153565b6100ad565b005b7f93864668e00bfeb0cafee67ab7145a622ae39e8045304432e9a0bfb97cc04d4682826040516100a19291906101f8565b60405180910390a15050565b7f9a9997702e0d8a6c06aa6502535647ba3647a06f6df41071c06783c0b8e3dd0882826040516100de9291906101f8565b60405180910390a15050565b5f5ffd5b5f5ffd5b5f5ffd5b5f5ffd5b5f5ffd5b5f5f83601f840112610113576101126100f2565b5b8235905067ffffffffffffffff8111156101305761012f6100f6565b5b60208301915083600182028301111561014c5761014b6100fa565b5b9250929050565b5f5f60208385031215610169576101686100ea565b5b5f83013567ffffffffffffffff811115610186576101856100ee565b5b610192858286016100fe565b92509250509250929050565b5f82825260208201905092915050565b828183375f83830152505050565b5f601f19601f8301169050919050565b5f6101d7838561019e565b93506101e48385846101ae565b6101ed836101bc565b840190509392505050565b5f6020820190508181035f8301526102118184866101cc565b9050939250505056fea26469706673582212209e81c1e30c537ed2dbc106e067fb23158c8c8576a03ce9e1d209137fcec9c21364736f6c634300081f0033';

function log(msg, type = 'info') {
    const colors = {
        info: '\x1b[36m', success: '\x1b[32m', error: '\x1b[31m', 
        warn: '\x1b[33m', header: '\x1b[35m', reset: '\x1b[0m'
    };
    const icon = { info: 'ℹ', success: '✓', error: '✗', warn: '⚠', header: '▶' };
    console.log(`${colors[type]}[${new Date().toLocaleTimeString()}] ${icon[type] || ''} ${msg}${colors.reset}`);
}

async function main() {
    log('\n' + '='.repeat(60), 'header');
    log('Deploy Free Contract to Sepolia Testnet', 'header');
    log('='.repeat(60) + '\n', 'header');
    
    log('NOTE: Sepolia is a TESTNET - no real money needed!', 'info');
    log('Get FREE testnet ETH from faucets (see below)\n', 'info');
    
    const privateKey = process.env.BLOCKCHAIN_PRIVATE_KEY;
    if (!privateKey) {
        log('ERROR: BLOCKCHAIN_PRIVATE_KEY not set!', 'error');
        log('Generate keys: npm run generate:keys', 'info');
        log('Then set: $env:BLOCKCHAIN_PRIVATE_KEY="0x..."', 'info');
        process.exit(1);
    }
    
    try {
        // Try multiple RPC endpoints
        let provider = null;
        let lastError = null;
        
        for (const rpcUrl of RPC_URLS) {
            try {
                log(`Trying RPC: ${rpcUrl}`, 'info');
                
                // Create provider with explicit Sepolia network
                provider = new ethers.JsonRpcProvider(rpcUrl, {
                    name: 'sepolia',
                    chainId: 11155111
                }, {
                    staticNetwork: true // Prevent auto-detection issues
                });
                
                // Test connection with timeout
                const testPromise = provider.getBlockNumber();
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout')), 10000)
                );
                
                await Promise.race([testPromise, timeoutPromise]);
                RPC_URL = rpcUrl;
                log(`✓ Connected to: ${rpcUrl}`, 'success');
                break;
            } catch (error) {
                lastError = error;
                log(`✗ Failed: ${rpcUrl} - ${error.message}`, 'warn');
                continue;
            }
        }
        
        if (!provider) {
            throw new Error(`All RPC endpoints failed. Last error: ${lastError?.message || 'Unknown'}`);
        }
        
        const wallet = new ethers.Wallet(privateKey, provider);
        
        log(`Deploying from: ${wallet.address}`, 'info');
        
        // Check balance
        const balance = await provider.getBalance(wallet.address);
        const balanceEth = ethers.formatEther(balance);
        log(`Balance: ${balanceEth} Sepolia ETH`, 'info');
        
        if (parseFloat(balanceEth) < 0.001) {
            log('\n⚠️  Insufficient balance!', 'warn');
            log('Get FREE Sepolia ETH from these faucets:', 'header');
            log('', 'info');
            log('1. QuickNode (usually works):', 'info');
            log('   https://faucet.quicknode.com/ethereum/sepolia', 'info');
            log(`   Send to: ${wallet.address}`, 'info');
            log('', 'info');
            log('2. PoW Faucet (mine for ETH):', 'info');
            log('   https://sepolia-faucet.pk910.de/', 'info');
            log(`   Send to: ${wallet.address}`, 'info');
            log('', 'info');
            log('3. Alchemy (may need account):', 'info');
            log('   https://sepoliafaucet.com/', 'info');
            log('', 'info');
            log('4. Infura (needs account):', 'info');
            log('   https://www.infura.io/faucet/sepolia', 'info');
            log('', 'info');
            log('After getting ETH, run this script again.', 'info');
            process.exit(1);
        }
        
        // Deploy
        log('\nDeploying contract...', 'info');
        log('Using minimal contract that only emits events (no require statements)...', 'info');
        
        // Try to deploy with gas estimation
        const factory = new ethers.ContractFactory(CONTRACT_ABI, CONTRACT_BYTECODE, wallet);
        
        // Estimate gas first
        let address;
        try {
            const deployTx = factory.getDeployTransaction();
            const gasEstimate = await provider.estimateGas(deployTx);
            log(`Estimated gas: ${gasEstimate.toString()}`, 'info');
            
            const contract = await factory.deploy({
                gasLimit: gasEstimate * BigInt(3) // Add 200% buffer
            });
            
            log(`Transaction hash: ${contract.deploymentTransaction().hash}`, 'info');
            log('Waiting for confirmation (this may take 30-60 seconds)...', 'info');
            
            await contract.waitForDeployment();
            address = await contract.getAddress();
            
            // Verify the contract was deployed correctly by calling a view function
            log('Verifying contract deployment...', 'info');
            // Contract has no view functions, so we'll just check it exists
            const code = await provider.getCode(address);
            if (code === '0x' || code.length < 10) {
                throw new Error('Contract deployment verification failed - no code at address');
            }
            log('Contract verified - code deployed successfully', 'success');
            
        } catch (error) {
            log(`Deployment error: ${error.message}`, 'error');
            if (error.message.includes('bytecode') || error.message.includes('invalid')) {
                log('ERROR: Contract bytecode is invalid!', 'error');
                log('The bytecode in deploy-free-contract.js may be incorrect.', 'error');
                log('Please compile CommandChannel.sol and update the bytecode.', 'error');
            }
            throw error;
        }
        
        log('\n' + '='.repeat(60), 'header');
        log('✓ Contract deployed successfully!', 'success');
        log('='.repeat(60), 'header');
        log(`\nContract Address: ${address}`, 'success');
        log('\nSave this address:', 'header');
        log(`$env:BLOCKCHAIN_CONTRACT_ADDRESS="${address}"`, 'info');
        log('\nView on Sepolia Explorer:', 'header');
        log(`https://sepolia.etherscan.io/address/${address}`, 'info');
        log('\nNow you can use this contract forever!', 'success');
        log('Run: npm run setup:free', 'info');
        log('', 'info');
        
        // Save to file
        const fs = require('fs');
        const contractFile = '.blockchain-contract.env';
        const content = `# Blockchain Contract - Deployed ${new Date().toISOString()}
BLOCKCHAIN_CONTRACT_ADDRESS=${address}
`;
        fs.writeFileSync(contractFile, content);
        log(`Contract address saved to: ${contractFile}`, 'info');
        log('', 'info');
        
    } catch (error) {
        log(`\nERROR: ${error.message}`, 'error');
        if (error.reason) {
            log(`Reason: ${error.reason}`, 'error');
        }
        if (error.message.includes('insufficient funds')) {
            log('\nGet free Sepolia ETH from:', 'header');
            log('  https://faucet.quicknode.com/ethereum/sepolia', 'info');
            log('  https://sepolia-faucet.pk910.de/', 'info');
        }
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(error => {
        log(`Unhandled error: ${error.message}`, 'error');
        process.exit(1);
    });
}

module.exports = { main };

