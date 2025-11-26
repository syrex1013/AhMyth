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
};


class Victims {
    constructor() {
        this.victimList = {};
        this.instance = this;
    }

    addVictim(socket, ip, port, country, manf, model, release, id, extra) {
        var victim = new Victim(socket, ip, port, country, manf, model, release, extra || {});
        this.victimList[id] = victim;
    }
    
    updateVictim(id, updates) {
        if (this.victimList[id]) {
            Object.assign(this.victimList[id], updates);
        }
    }

    getVictim(id) {
        if (this.victimList[id] != null)
            return this.victimList[id];

        return -1;
    }

    rmVictim(id) {
        delete this.victimList[id];
    }

    getVictimList() {
        return this.victimList;
    }

}



module.exports = new Victims();
