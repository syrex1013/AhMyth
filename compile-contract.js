/**
 * Compile CommandChannel.sol to get correct bytecode
 * Requires: npm install solc
 */

const fs = require('fs');
const path = require('path');

// Try to use solc if available
let solc;
try {
    solc = require('solc');
} catch (e) {
    console.error('ERROR: solc not installed!');
    console.error('Install with: npm install solc');
    console.error('');
    console.error('OR use Remix IDE to compile CommandChannel.sol:');
    console.error('1. Go to https://remix.ethereum.org/');
    console.error('2. Create new file: CommandChannel.sol');
    console.error('3. Paste the contract code');
    console.error('4. Compile with Solidity 0.8.0+');
    console.error('5. Copy the bytecode from compilation artifacts');
    process.exit(1);
}

const contractSource = fs.readFileSync(path.join(__dirname, 'CommandChannel.sol'), 'utf8');

const input = {
    language: 'Solidity',
    sources: {
        'CommandChannel.sol': {
            content: contractSource
        }
    },
    settings: {
        outputSelection: {
            '*': {
                '*': ['abi', 'evm.bytecode']
            }
        }
    }
};

console.log('Compiling CommandChannel.sol...');
const output = JSON.parse(solc.compile(JSON.stringify(input)));

if (output.errors) {
    const errors = output.errors.filter(e => e.severity === 'error');
    if (errors.length > 0) {
        console.error('Compilation errors:');
        errors.forEach(e => console.error(e.formattedMessage));
        process.exit(1);
    }
}

const contract = output.contracts['CommandChannel.sol']['CommandChannel'];
const bytecode = contract.evm.bytecode.object;
const abi = contract.abi;

console.log('\n✓ Compilation successful!');
console.log('\nBytecode:');
console.log('0x' + bytecode);
console.log('\nABI:');
console.log(JSON.stringify(abi, null, 2));

// Save to file
const outputFile = path.join(__dirname, 'contract-bytecode.json');
fs.writeFileSync(outputFile, JSON.stringify({
    bytecode: '0x' + bytecode,
    abi: abi
}, null, 2));

console.log(`\n✓ Saved to: ${outputFile}`);
