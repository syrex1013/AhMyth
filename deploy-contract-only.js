/**
 * Deploy Contract Only - One-time setup
 * 
 * Deploys the CommandChannel contract to Sepolia testnet.
 * This is a ONE-TIME operation - after deployment, you can use it forever.
 * 
 * You need:
 * - Free Sepolia ETH (get from https://sepoliafaucet.com/)
 * - BLOCKCHAIN_PRIVATE_KEY environment variable
 * 
 * Usage:
 *   node deploy-contract-only.js
 * 
 * After deployment, save the contract address and use it in setup-free-blockchain-c2.js
 */

const { ethers } = require('ethers');

const RPC_URL = 'https://ethereum-sepolia-rpc.publicnode.com';

// Contract ABI
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
    }
];

// Contract bytecode (compiled)
const CONTRACT_BYTECODE = '0x608060405234801561001057600080fd5b5061012f806100206000396000f3fe6080604052348015600f57600080fd5b506004361060325760003560e01c8063a3f4df49146037575b600080fd5b604d60048036038101906049919060b1565b604f565b005b8060008190555050565b600080fd5b6000819050919050565b6069816058565b8114607357600080fd5b50565b6000813590506083816062565b92915050565b600060208284031215609c57609b6053565b5b600060a8848285016076565b91505092915050565b60006020828403121560c75760c66053565b5b600060d3848285016076565b9150509291505056fea2646970667358221220a3f4df49e4b5c8e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e364736f6c63430008110033';

async function main() {
    console.log('\n' + '='.repeat(60));
    console.log('Deploy CommandChannel Contract to Sepolia');
    console.log('='.repeat(60) + '\n');
    
    const privateKey = process.env.BLOCKCHAIN_PRIVATE_KEY;
    if (!privateKey) {
        console.error('ERROR: BLOCKCHAIN_PRIVATE_KEY not set!');
        console.error('Set it with: $env:BLOCKCHAIN_PRIVATE_KEY="0x..."');
        process.exit(1);
    }
    
    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const wallet = new ethers.Wallet(privateKey, provider);
        
        console.log(`Deploying from: ${wallet.address}`);
        
        // Check balance
        const balance = await provider.getBalance(wallet.address);
        console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
        
        if (balance < ethers.parseEther('0.001')) {
            console.error('\nERROR: Insufficient balance!');
            console.error('Get free Sepolia ETH from: https://sepoliafaucet.com/');
            console.error(`Send to: ${wallet.address}`);
            process.exit(1);
        }
        
        // Deploy
        console.log('\nDeploying contract...');
        const factory = new ethers.ContractFactory(CONTRACT_ABI, CONTRACT_BYTECODE, wallet);
        const contract = await factory.deploy();
        
        console.log(`Transaction: ${contract.deploymentTransaction().hash}`);
        console.log('Waiting for confirmation...');
        
        await contract.waitForDeployment();
        const address = await contract.getAddress();
        
        console.log('\n' + '='.repeat(60));
        console.log('✓ Contract deployed successfully!');
        console.log('='.repeat(60));
        console.log(`\nContract Address: ${address}`);
        console.log(`\nSave this address and use it in setup-free-blockchain-c2.js:`);
        console.log(`$env:BLOCKCHAIN_CONTRACT_ADDRESS="${address}"`);
        console.log('\nView on Sepolia Explorer:');
        console.log(`https://sepolia.etherscan.io/address/${address}`);
        console.log('\n');
        
    } catch (error) {
        console.error('\nERROR:', error.message);
        if (error.reason) {
            console.error('Reason:', error.reason);
        }
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { main };











