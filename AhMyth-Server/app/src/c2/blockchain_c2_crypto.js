/**
 * AES-GCM Encryption/Decryption for Blockchain C2
 */

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

