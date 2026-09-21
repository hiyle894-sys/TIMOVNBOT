/**
 * Database module using Node.js native `node:sqlite`
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'timebot.db');
const db = new DatabaseSync(dbPath);

// Initialize schema
function initDatabase() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schedules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId TEXT DEFAULT 'default_user',
            title TEXT NOT NULL,
            date TEXT NOT NULL,
            startTime TEXT NOT NULL,
            endTime TEXT NOT NULL,
            duration INTEGER NOT NULL,
            reminderMinutes INTEGER DEFAULT 15,
            reminderTime TEXT,
            status TEXT DEFAULT 'upcoming',
            completed INTEGER DEFAULT 0,
            source TEXT DEFAULT 'web',
            telegramMessageId TEXT,
            reminderNotified INTEGER DEFAULT 0,
            startNotified INTEGER DEFAULT 0,
            endNotified INTEGER DEFAULT 0,
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updatedAt TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS user_sessions (
            chatId TEXT PRIMARY KEY,
            step TEXT NOT NULL,
            draft TEXT NOT NULL,
            updatedAt TEXT NOT NULL
        );
    `);
    
    // Insert default settings if not exists
    const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    const setSettingStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value, updatedAt) VALUES (?, ?, ?)');
    const nowIso = new Date().toISOString();

    const defaults = {
        'ai_provider': 'gemini',
        'ai_api_key': '',
        'ai_model': 'gemini-3.6-flash',
        'telegram_bot_token': '',
        'telegram_chat_id': ''
    };

    for (const [k, v] of Object.entries(defaults)) {
        const row = getSettingStmt.get(k);
        if (!row) {
            setSettingStmt.run(k, v, nowIso);
        }
    }
}

initDatabase();

module.exports = db;
