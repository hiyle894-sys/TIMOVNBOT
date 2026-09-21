/**
 * Settings Page Controller for AI Provider and Telegram Bot Configuration
 */

class SettingsController {
    static async loadSettings() {
        try {
            const data = await TimeBotAPI.fetchSettings();
            
            // AI Fields
            const providerEl = document.getElementById('setting-ai-provider');
            const modelEl = document.getElementById('setting-ai-model');
            const aiKeyBadge = document.getElementById('ai-key-status');

            if (providerEl) providerEl.value = data.aiProvider || 'gemini';
            if (modelEl) modelEl.value = data.aiModel || 'gemini-1.5-flash';
            if (aiKeyBadge) {
                if (data.hasAiApiKey) {
                    aiKeyBadge.textContent = data.aiApiKeyMasked;
                    aiKeyBadge.classList.add('active');
                } else {
                    aiKeyBadge.textContent = 'Chưa cấu hình';
                    aiKeyBadge.classList.remove('active');
                }
            }

            // Telegram Fields
            const teleTokenBadge = document.getElementById('tele-token-status');
            const botInfoBox = document.getElementById('bot-info-box');
            const botNameEl = document.getElementById('bot-name');
            const botUserEl = document.getElementById('bot-username');

            if (teleTokenBadge) {
                if (data.hasTelegramToken) {
                    teleTokenBadge.textContent = data.telegramBotTokenMasked;
                    teleTokenBadge.classList.add('active');

                    // Fetch Bot Info
                    try {
                        const botInfo = await TimeBotAPI.fetchTelegramInfo();
                        if (botInfo.ok) {
                            if (botInfoBox) botInfoBox.classList.remove('hidden');
                            if (botNameEl) botNameEl.textContent = botInfo.firstName || 'TimeBot';
                            if (botUserEl) botUserEl.textContent = `@${botInfo.username}` || '@username';
                        } else {
                            if (botInfoBox) botInfoBox.classList.add('hidden');
                        }
                    } catch (e) {
                        if (botInfoBox) botInfoBox.classList.add('hidden');
                    }

                } else {
                    teleTokenBadge.textContent = 'Chưa cấu hình';
                    teleTokenBadge.classList.remove('active');
                    if (botInfoBox) botInfoBox.classList.add('hidden');
                }
            }
        } catch (err) {
            console.error('Error loading settings:', err);
        }
    }

    static initEvents(showToast) {
        // Save AI Settings
        const btnSaveAI = document.getElementById('btn-save-ai-settings');
        if (btnSaveAI) {
            btnSaveAI.addEventListener('click', async () => {
                const provider = document.getElementById('setting-ai-provider').value;
                const model = document.getElementById('setting-ai-model').value.trim();
                const apiKey = document.getElementById('setting-ai-key').value.trim();

                try {
                    const payload = { aiProvider: provider, aiModel: model };
                    if (apiKey) payload.aiApiKey = apiKey;

                    await TimeBotAPI.saveSettings(payload);
                    document.getElementById('setting-ai-key').value = '';
                    showToast('✅ Đã lưu cấu hình AI thành công!', 'success');
                    await this.loadSettings();
                } catch (err) {
                    showToast('❌ Lỗi khi lưu AI settings: ' + err.message, 'error');
                }
            });
        }

        // Save Telegram Settings
        const btnSaveTele = document.getElementById('btn-save-tele-settings');
        if (btnSaveTele) {
            btnSaveTele.addEventListener('click', async () => {
                const token = document.getElementById('setting-tele-token').value.trim();
                if (!token) {
                    showToast('⚠️ Vui lòng nhập Bot Token!', 'warning');
                    return;
                }

                try {
                    await TimeBotAPI.saveSettings({ telegramBotToken: token });
                    document.getElementById('setting-tele-token').value = '';
                    showToast('✅ Đã lưu Telegram Bot Token!', 'success');
                    await this.loadSettings();
                } catch (err) {
                    showToast('❌ Lỗi khi lưu Bot Token: ' + err.message, 'error');
                }
            });
        }

        // Test Telegram Message
        const btnTestTele = document.getElementById('btn-test-tele-msg');
        if (btnTestTele) {
            btnTestTele.addEventListener('click', async () => {
                try {
                    showToast('⏳ Đang gửi tin nhắn thử nghiệm...', 'info');
                    const res = await TimeBotAPI.testTelegram();
                    if (res.ok) {
                        showToast('🔔 Test thành công! Đã gửi tin nhắn tới Telegram Bot.', 'success');
                    } else {
                        showToast(`⚠️ Không thể kết nối Bot: ${res.error}`, 'error');
                    }
                } catch (err) {
                    showToast('⚠️ Lỗi kết nối Telegram: ' + err.message, 'error');
                }
            });
        }
    }
}
