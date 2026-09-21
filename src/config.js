/**
 * Configuration & Settings Management
 */

const db = require('./db');

function getSetting(key, defaultValue = '') {
    try {
        const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
        const row = stmt.get(key);
        return row ? row.value : defaultValue;
    } catch (err) {
        console.error(`Error getting setting ${key}:`, err);
        return defaultValue;
    }
}

function setSetting(key, value) {
    try {
        const now = new Date().toISOString();
        const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value, updatedAt) VALUES (?, ?, ?)');
        stmt.run(key, value || '', now);
        return true;
    } catch (err) {
        console.error(`Error setting ${key}:`, err);
        return false;
    }
}

function getAllSettingsSafe() {
    const aiProvider = getSetting('ai_provider', 'gemini');
    const aiApiKey = getSetting('ai_api_key', '');
    const aiModel = getSetting('ai_model', 'gemini-3.6-flash');
    const telegramBotToken = getSetting('telegram_bot_token', '');
    const telegramChatId = getSetting('telegram_chat_id', '');

    const maskKey = (key) => {
        if (!key || key.length < 8) return key ? '••••••••' : '';
        return '••••••••' + key.slice(-4);
    };

    return {
        aiProvider,
        aiApiKeyMasked: maskKey(aiApiKey),
        hasAiApiKey: !!aiApiKey,
        aiModel,
        telegramBotTokenMasked: maskKey(telegramBotToken),
        hasTelegramToken: !!telegramBotToken,
        telegramChatId
    };
}

module.exports = {
    getSetting,
    setSetting,
    getAllSettingsSafe
};
