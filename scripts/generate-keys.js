/**
 * Generate Private Key and AES Key for Blockchain C2
 * 
 * Generates:
 * - Ethereum private key (for Sepolia wallet)
 * - AES-256 key (for command encryption)
 * 
 * Usage:
 *   node generate-keys.js
 */

const crypto = require('crypto');
const { ethers } = require('ethers');

function generatePrivateKey() {
    // Generate random 32 bytes
    const privateKeyBytes = crypto.randomBytes(32);
    // Convert to hex with 0x prefix
    const privateKey = '0x' + privateKeyBytes.toString('hex');
    return privateKey;
}

function generateAesKey() {
    // Generate random 32 bytes (256 bits)
    const aesKeyBytes = crypto.randomBytes(32);
    // Convert to hex (64 characters)
    const aesKey = aesKeyBytes.toString('hex');
    return aesKey;
}

function main() {
    console.log('\n' + '='.repeat(60));
    console.log('Blockchain C2 Key Generator');
    console.log('='.repeat(60) + '\n');
    
    // Generate keys
    const privateKey = generatePrivateKey();
    const aesKey = generateAesKey();
    
    // Get wallet address from private key
    let walletAddress = 'N/A';
    try {
        if (typeof ethers !== 'undefined' && ethers.Wallet) {
            const wallet = new ethers.Wallet(privateKey);
            walletAddress = wallet.address;
        }
    } catch (e) {
        // ethers not available, skip address generation
    }
    
    // Display results
    console.log('Generated Keys:\n');
    console.log('Private Key (Ethereum Wallet):');
    console.log('  ' + privateKey);
    console.log('\nWallet Address:');
    console.log('  ' + walletAddress);
    console.log('\nAES Key (64 hex characters):');
    console.log('  ' + aesKey);
    
    // PowerShell commands
    console.log('\n' + '='.repeat(60));
    console.log('PowerShell Commands:');
    console.log('='.repeat(60));
    console.log('\n$env:BLOCKCHAIN_PRIVATE_KEY="' + privateKey + '"');
    console.log('$env:BLOCKCHAIN_C2_AES_KEY="' + aesKey + '"');
    
    // Bash commands
    console.log('\n' + '='.repeat(60));
    console.log('Bash Commands:');
    console.log('='.repeat(60));
    console.log('\nexport BLOCKCHAIN_PRIVATE_KEY="' + privateKey + '"');
    console.log('export BLOCKCHAIN_C2_AES_KEY="' + aesKey + '"');
    
    // Save to file
    const fs = require('fs');
    const keysFile = '.blockchain-keys.env';
    const envContent = `# Blockchain C2 Keys - Generated ${new Date().toISOString()}
# DO NOT COMMIT THIS FILE TO GIT!

BLOCKCHAIN_PRIVATE_KEY=${privateKey}
BLOCKCHAIN_C2_AES_KEY=${aesKey}
BLOCKCHAIN_WALLET_ADDRESS=${walletAddress}
`;
    
    fs.writeFileSync(keysFile, envContent);
    console.log('\n' + '='.repeat(60));
    console.log('Keys saved to: ' + keysFile);
    console.log('='.repeat(60));
    console.log('\n⚠️  WARNING: Keep these keys secure!');
    console.log('⚠️  Do not commit .blockchain-keys.env to git!');
    console.log('⚠️  Add it to .gitignore\n');
    
    return { privateKey, aesKey, walletAddress };
}

if (require.main === module) {
    main();
}

module.exports = { generatePrivateKey, generateAesKey };












