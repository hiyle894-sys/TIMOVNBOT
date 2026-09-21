/**
 * Telegram Bot Service - Instant Short Polling Engine (Response Time < 100ms)
 */

const db = require('./db');
const { getSetting, setSetting } = require('./config');
const { getNow, normalizeDate, normalizeTime, formatDateVN, addMinutesToTime, computeReminderDateTime, calculateDurationMinutes, formatDurationText, computeScheduleStatus } = require('./timeUtils');
const { parseSchedulesWithAI } = require('./aiService');
const { getRandomQuote } = require('./quotes');
const syncEvents = require('./syncEvents');

let isPolling = false;
let pollingOffset = 0;

/**
 * Session persistence helpers (SQLite backed)
 */
function getUserSession(chatId) {
    try {
        const row = db.prepare('SELECT * FROM user_sessions WHERE chatId = ?').get(String(chatId));
        if (!row) return null;
        const parsed = JSON.parse(row.draft || '{}');
        return {
            step: row.step,
            draft: parsed,
            pendingList: parsed.pendingList || null
        };
    } catch (e) {
        return null;
    }
}

function saveUserSession(chatId, session) {
    try {
        const nowIso = new Date().toISOString();
        const payload = JSON.stringify({
            ...(session.draft || {}),
            pendingList: session.pendingList || null
        });
        db.prepare('INSERT OR REPLACE INTO user_sessions (chatId, step, draft, updatedAt) VALUES (?, ?, ?, ?)')
          .run(String(chatId), session.step || 'UNKNOWN', payload, nowIso);
    } catch (e) {
        console.error('Error saving session:', e.message);
    }
}

function resetSession(chatId) {
    try {
        db.prepare('DELETE FROM user_sessions WHERE chatId = ?').run(String(chatId));
    } catch (e) {}
}

/**
 * Register persistent Telegram Chat Command Menu button
 */
async function setBotCommands() {
    const commands = [
        { command: 'start', description: '🏠 Menu chính TimeBot' },
        { command: 'them', description: '➕ Thêm lịch trình mới' },
        { command: 'homnay', description: '📅 Xem lịch hôm nay' },
        { command: 'theongay', description: '🗓️ Xem lịch theo ngày' },
        { command: 'saptot', description: '⏰ Xem lịch sắp tới' },
        { command: 'danlich', description: '🤖 AI dán lịch tự động' }
    ];

    const res = await callTelegramAPI('setMyCommands', { commands });
    if (res.ok) {
        console.log('Registered Telegram Chat Command Menu successfully.');
    } else {
        console.error('Failed to register Telegram Chat Command Menu:', res.error);
    }
}

/**
 * Fast HTTP fetch helper for Telegram Bot API
 */
async function callTelegramAPI(method, payload = {}) {
    const token = getSetting('telegram_bot_token', '');
    if (!token) return { ok: false, error: 'Telegram bot token is missing' };

    const url = `https://api.telegram.org/bot${token}/${method}`;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s abort timeout

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        const data = await res.json();
        return data;
    } catch (err) {
        console.error(`Telegram API Error (${method}):`, err.message);
        return { ok: false, error: err.message };
    }
}

/**
 * Test message endpoint
 */
async function sendTestMessage() {
    let chatId = getSetting('telegram_chat_id', '');
    
    if (!chatId) {
        const updatesRes = await callTelegramAPI('getUpdates', { limit: 10, timeout: 0 });
        if (updatesRes.ok && Array.isArray(updatesRes.result) && updatesRes.result.length > 0) {
            const lastUpdate = updatesRes.result[updatesRes.result.length - 1];
            if (lastUpdate.message && lastUpdate.message.chat) {
                chatId = String(lastUpdate.message.chat.id);
                setSetting('telegram_chat_id', chatId);
            }
        }
    }

    if (!chatId) return { ok: false, error: 'Chưa có Chat ID. Hãy mở Telegram tìm @TIMOVNBOT và bấm /start hoặc nhắn 1 tin nhắn bất kỳ cho Bot trước!' };

    const text = `━━━━━━━━━━━━━━━━━━\n🔔 <b>TEST THÀNH CÔNG!</b>\nTimeBot đã kết nối thành công với hệ thống.\n━━━━━━━━━━━━━━━━━━`;
    return await callTelegramAPI('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML'
    });
}

/**
 * Get bot profile info
 */
async function getBotInfo() {
    const res = await callTelegramAPI('getMe');
    if (res.ok) {
        return {
            ok: true,
            id: res.result.id,
            firstName: res.result.first_name,
            username: res.result.username
        };
    }
    return { ok: false, error: res.description || 'Không thể kết nối Telegram API' };
}

/**
 * Main Menu keyboard builder
 */
function buildMainMenuText() {
    const nowInfo = getNow();
    const todayCountRow = db.prepare('SELECT COUNT(*) as count FROM schedules WHERE date = ? AND completed = 0 AND status != "cancelled"').get(nowInfo.dateStr);
    const todayCount = todayCountRow ? todayCountRow.count : 0;

    return `━━━━━━━━━━━━━━━━━━\n🤖 <b>TIMEBOT ASSISTANT</b>\n⏰ <i>Trợ lý Quản Lý Thời Gian Thông Minh</i>\n━━━━━━━━━━━━━━━━━━\n📅 <b>Hôm nay:</b> ${formatDateVN(nowInfo.dateStr)}\n🕐 <b>Bây giờ:</b> ${nowInfo.timeStr} (UTC+7)\n📋 <b>Lịch trình hôm nay:</b> ${todayCount} lịch trình\n━━━━━━━━━━━━━━━━━━\n💡 <b>Vui lòng chọn chức năng dưới đây:</b>`;
}

function buildMainMenuKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '➕ Thêm lịch trình mới', callback_data: 'menu_add' }],
            [
                { text: '📅 Xem hôm nay', callback_data: 'menu_today' },
                { text: '🗓️ Lịch theo ngày', callback_data: 'menu_date' }
            ],
            [{ text: '⏰ Lịch sắp tới', callback_data: 'menu_upcoming' }],
            [{ text: '🤖 Dán lịch tự động (AI)', callback_data: 'menu_ai' }]
        ]
    };
}

/**
 * Process Telegram updates instantly
 */
async function handleUpdate(update) {
    try {
        if (update.message) {
            const msg = update.message;
            const chatId = msg.chat.id;
            const text = (msg.text || '').trim();

            // Save last active chat ID automatically
            setSetting('telegram_chat_id', String(chatId));

            // Command handlers
            const cmd = text.toLowerCase().split(' ')[0];

            if (cmd === '/start' || cmd === '/menu') {
                resetSession(chatId);
                await callTelegramAPI('sendMessage', {
                    chat_id: chatId,
                    text: buildMainMenuText(),
                    parse_mode: 'HTML',
                    reply_markup: buildMainMenuKeyboard()
                });
                return;
            }

            if (cmd === '/them' || cmd === '/add') {
                saveUserSession(chatId, { step: 'ADD_TITLE', draft: {} });
                await promptTitleStep(chatId);
                return;
            }

            if (cmd === '/homnay' || cmd === '/today') {
                resetSession(chatId);
                await sendTodaySchedules(chatId);
                return;
            }

            if (cmd === '/theongay' || cmd === '/date') {
                saveUserSession(chatId, { step: 'VIEW_DATE', draft: {} });
                await callTelegramAPI('sendMessage', {
                    chat_id: chatId,
                    text: `━━━━━━━━━━━━━━━━━━\n🗓️ <b>TRA CỨU LỊCH THEO NGÀY</b>\n━━━━━━━━━━━━━━━━━━\n💡 <i>Chức năng giúp bạn xem lại tất cả công việc của một ngày bất kỳ.</i>\n\n📅 <b>Vui lòng nhập ngày cần xem (dd/mm/yyyy):</b>\n<i>Ví dụ: <code>25/09/2026</code></i>\n━━━━━━━━━━━━━━━━━━`,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[{ text: '❌ Hủy thao tác', callback_data: 'menu_main' }]]
                    }
                });
                return;
            }

            if (cmd === '/saptot' || cmd === '/upcoming') {
                resetSession(chatId);
                await sendUpcomingSchedules(chatId);
                return;
            }

            if (cmd === '/danlich' || cmd === '/ai') {
                saveUserSession(chatId, { step: 'AI_PASTE', draft: {} });
                await callTelegramAPI('sendMessage', {
                    chat_id: chatId,
                    text: `━━━━━━━━━━━━━━━━━━\n🤖 <b>AI LÊN LỊCH TỰ ĐỘNG</b>\n━━━━━━━━━━━━━━━━━━\n🧠 <i>Công nghệ AI Gemini sẽ tự động đọc, phân tích và trích xuất danh sách lịch trình của bạn.</i>\n\n📝 <b>Hãy dán danh sách lịch trình của bạn vào đây:</b>\n\n<b>Ví dụ mẫu:</b>\n<i>Học giải phẫu 21/09/2026 17:00-18:00\nTập gym 21/09/2026 19:00-20:00\nHọp nhóm 22/09/2026 20:00-21:30</i>\n━━━━━━━━━━━━━━━━━━`,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[{ text: '❌ Hủy thao tác', callback_data: 'menu_main' }]]
                    }
                });
                return;
            }

            // Check active session wizard state
            const session = getUserSession(chatId);
            if (session) {
                await handleSessionStepInput(chatId, text, session);
                return;
            }

            // Fallback message
            await callTelegramAPI('sendMessage', {
                chat_id: chatId,
                text: `💡 Hãy chọn một chức năng từ Menu bên dưới hoặc gõ /start`,
                reply_markup: buildMainMenuKeyboard()
            });

        } else if (update.callback_query) {
            const cb = update.callback_query;
            const chatId = cb.message.chat.id;
            const messageId = cb.message.message_id;
            const data = cb.data;

            // Fast answer callback query to stop loading spinner on mobile
            callTelegramAPI('answerCallbackQuery', { callback_query_id: cb.id });

            // Menu navigation and Cancel handlers
            if (data === 'menu_main' || data === 'cancel_wizard') {
                resetSession(chatId);
                let deleted = false;
                if (messageId) {
                    const delRes = await callTelegramAPI('deleteMessage', {
                        chat_id: chatId,
                        message_id: messageId
                    });
                    if (delRes && delRes.ok) deleted = true;
                }

                if (!deleted && messageId) {
                    await callTelegramAPI('editMessageText', {
                        chat_id: chatId,
                        message_id: messageId,
                        text: buildMainMenuText(),
                        parse_mode: 'HTML',
                        reply_markup: buildMainMenuKeyboard()
                    });
                } else {
                    await callTelegramAPI('sendMessage', {
                        chat_id: chatId,
                        text: `━━━━━━━━━━━━━━━━━━\n❌ <b>ĐÃ HỦY THAO TÁC</b>\n━━━━━━━━━━━━━━━━━━\n\n${buildMainMenuText()}`,
                        parse_mode: 'HTML',
                        reply_markup: buildMainMenuKeyboard()
                    });
                }
                return;
            }

            if (data === 'menu_add') {
                saveUserSession(chatId, { step: 'ADD_TITLE', draft: {} });
                await callTelegramAPI('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: `━━━━━━━━━━━━━━━━━━\n➕ <b>THÊM LỊCH TRÌNH MỚI</b>\n━━━━━━━━━━━━━━━━━━\n📌 <b>Bước 1/5: Tên lịch trình</b>\n\n💡 <b>Hướng dẫn:</b> Nhập tên công việc, bài học hoặc sự kiện bạn cần nhắc nhở.\n<i>Ví dụ: Học giải phẫu, Tập gym, Họp nhóm dự án...</i>\n━━━━━━━━━━━━━━━━━━`,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[{ text: '❌ Hủy thao tác', callback_data: 'menu_main' }]]
                    }
                });
                return;
            }

            if (data === 'menu_today') {
                await sendTodaySchedules(chatId);
                return;
            }

            if (data === 'menu_date') {
                saveUserSession(chatId, { step: 'VIEW_DATE', draft: {} });
                await callTelegramAPI('sendMessage', {
                    chat_id: chatId,
                    text: `━━━━━━━━━━━━━━━━━━\n🗓️ <b>TRA CỨU LỊCH THEO NGÀY</b>\n━━━━━━━━━━━━━━━━━━\n💡 <i>Chức năng giúp bạn xem lại tất cả công việc của một ngày bất kỳ.</i>\n\n📅 <b>Vui lòng nhập ngày cần xem (dd/mm/yyyy):</b>\n<i>Ví dụ: <code>25/09/2026</code></i>\n━━━━━━━━━━━━━━━━━━`,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[{ text: '❌ Hủy thao tác', callback_data: 'menu_main' }]]
                    }
                });
                return;
            }

            if (data === 'menu_upcoming') {
                await sendUpcomingSchedules(chatId);
                return;
            }

            if (data === 'menu_ai') {
                saveUserSession(chatId, { step: 'AI_PASTE', draft: {} });
                await callTelegramAPI('sendMessage', {
                    chat_id: chatId,
                    text: `━━━━━━━━━━━━━━━━━━\n🤖 <b>AI LÊN LỊCH TỰ ĐỘNG</b>\n━━━━━━━━━━━━━━━━━━\n🧠 <i>Công nghệ AI Gemini sẽ tự động đọc, phân tích và trích xuất danh sách lịch trình của bạn.</i>\n\n📝 <b>Hãy dán danh sách lịch trình của bạn vào đây:</b>\n\n<b>Ví dụ mẫu:</b>\n<i>Học giải phẫu 21/09/2026 17:00-18:00\nTập gym 21/09/2026 19:00-20:00\nHọp nhóm 22/09/2026 20:00-21:30</i>\n━━━━━━━━━━━━━━━━━━`,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[{ text: '❌ Hủy thao tác', callback_data: 'menu_main' }]]
                    }
                });
                return;
            }

            // Wizard step callback handlers
            const session = getUserSession(chatId);
            await handleSessionCallback(chatId, messageId, data, session);

            // Schedule item quick actions (Extend +10m, Complete, Delete)
            if (data.startsWith('action_')) {
                await handleScheduleAction(chatId, messageId, data);
                return;
            }
        }
    } catch (err) {
        console.error('Unhandled Error in handleUpdate:', err);
    }
}

/**
 * Handle wizard step text inputs
 */
async function handleSessionStepInput(chatId, text, session) {
    const nowInfo = getNow();

    if (session.step === 'ADD_TITLE') {
        session.draft.title = text;
        session.step = 'ADD_DATE';
        saveUserSession(chatId, session);

        await callTelegramAPI('sendMessage', {
            chat_id: chatId,
            text: `━━━━━━━━━━━━━━━━━━\n➕ <b>THÊM LỊCH TRÌNH MỚI</b>\n━━━━━━━━━━━━━━━━━━\n📅 <b>Bước 2/5: Ngày thực hiện</b>\n\n📌 <b>Lịch trình:</b> <b>${text}</b>\n📆 <b>Hôm nay là:</b> ${formatDateVN(nowInfo.dateStr)}\n\n💡 <b>Hướng dẫn:</b> Chọn nút nhanh bên dưới hoặc tự nhập ngày theo định dạng <code>dd/mm/yyyy</code> (Ví dụ: <code>21/09/2026</code>).\n━━━━━━━━━━━━━━━━━━`,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📅 Hôm nay', callback_data: 'add_date_today' },
                        { text: '➡️ Ngày mai', callback_data: 'add_date_tomorrow' }
                    ],
                    [{ text: '🗓️ Nhập thủ công (dd/mm/yyyy)', callback_data: 'add_date_manual' }],
                    [{ text: '❌ Hủy thao tác', callback_data: 'menu_main' }]
                ]
            }
        });
        return;
    }

    if (session.step === 'ADD_DATE') {
        const normDate = normalizeDate(text);
        if (!normDate) {
            await callTelegramAPI('sendMessage', {
                chat_id: chatId,
                text: `⚠️ <b>Định dạng ngày chưa hợp lệ!</b>\nVui lòng nhập theo dạng <b>dd/mm/yyyy</b> (Ví dụ: <code>21/09/2026</code>):`,
                parse_mode: 'HTML'
            });
            return;
        }
        session.draft.date = normDate;
        session.step = 'ADD_START_TIME';
        saveUserSession(chatId, session);
        await promptStartTimeStep(chatId, session);
        return;
    }

    if (session.step === 'ADD_START_TIME') {
        const normTime = normalizeTime(text);
        if (!normTime) {
            await callTelegramAPI('sendMessage', {
                chat_id: chatId,
                text: `⚠️ <b>Định dạng giờ chưa hợp lệ!</b>\nVui lòng nhập chuẩn dạng <b>14:30</b> hoặc gõ nhanh <b>1430</b>:`,
                parse_mode: 'HTML'
            });
            return;
        }
        session.draft.startTime = normTime;
        session.step = 'ADD_END_TIME';
        saveUserSession(chatId, session);
        await promptEndTimeStep(chatId, session);
        return;
    }

    if (session.step === 'ADD_END_TIME') {
        const normTime = normalizeTime(text);
        if (!normTime) {
            await callTelegramAPI('sendMessage', {
                chat_id: chatId,
                text: `⚠️ <b>Định dạng giờ chưa hợp lệ!</b>\nVui lòng nhập chuẩn dạng <b>15:30</b> hoặc gõ nhanh <b>1530</b>:`,
                parse_mode: 'HTML'
            });
            return;
        }
        session.draft.endTime = normTime;
        session.step = 'ADD_REMINDER';
        saveUserSession(chatId, session);
        await promptReminderStep(chatId, session);
        return;
    }

    if (session.step === 'VIEW_DATE') {
        const normDate = normalizeDate(text);
        resetSession(chatId);
        if (!normDate) {
            await callTelegramAPI('sendMessage', {
                chat_id: chatId,
                text: `⚠️ Ngày nhập vào không đúng định dạng dd/mm/yyyy!`,
                reply_markup: buildMainMenuKeyboard()
            });
            return;
        }
        await sendDateSchedules(chatId, normDate);
        return;
    }

    if (session.step === 'AI_PASTE') {
        await callTelegramAPI('sendMessage', {
            chat_id: chatId,
            text: `⏳ <b>AI đang đọc và phân tích văn bản...</b>\nVui lòng chờ trong giây lát.`,
            parse_mode: 'HTML'
        });

        const aiRes = await parseSchedulesWithAI(text);
        if (!aiRes.success || !aiRes.schedules || aiRes.schedules.length === 0) {
            resetSession(chatId);
            await callTelegramAPI('sendMessage', {
                chat_id: chatId,
                text: `⚠️ <b>Không thể phân tích lịch trình</b>\nVui lòng kiểm tra lại nội dung dán và thử lại.`,
                parse_mode: 'HTML',
                reply_markup: buildMainMenuKeyboard()
            });
            return;
        }

        // Filter and clean schedules (auto-fill missing start time with default 08:00 if title valid)
        const validSchedules = [];
        for (const s of aiRes.schedules) {
            const titleLower = (s.title || '').toLowerCase();
            // Ignore header / table titles
            if (titleLower.includes('thứ / ngày') || titleLower.includes('lịch học tối ưu') || titleLower.includes('buổi sáng') || titleLower.includes('buổi chiều') || titleLower.includes('buổi đêm')) {
                continue;
            }
            if (!s.startTime) {
                s.startTime = '08:00';
                s.endTime = '09:00';
                s.missingInfo = null;
            }
            validSchedules.push(s);
        }

        if (validSchedules.length === 0) {
            resetSession(chatId);
            await callTelegramAPI('sendMessage', {
                chat_id: chatId,
                text: `⚠️ <b>Không tìm thấy lịch trình hợp lệ trong văn bản!</b>\nVui lòng kiểm tra lại nội dung và dán lại.`,
                parse_mode: 'HTML',
                reply_markup: buildMainMenuKeyboard()
            });
            return;
        }

        // Save AI pending batch to session
        saveUserSession(chatId, { step: 'AI_CONFIRM', draft: {}, pendingList: validSchedules });
        await sendAiConfirmMessage(chatId, validSchedules);
        return;
    }
}

/**
 * Handle wizard callbacks
 */
async function handleSessionCallback(chatId, messageId, data, session) {
    try {
        const nowInfo = getNow();

        if (data === 'add_date_today') {
            if (!session) session = { step: 'ADD_START_TIME', draft: {} };
            session.draft.date = nowInfo.dateStr;
            session.step = 'ADD_START_TIME';
            saveUserSession(chatId, session);
            await promptStartTimeStep(chatId, session);
            return;
        }

        if (data === 'add_date_tomorrow') {
            if (!session) session = { step: 'ADD_START_TIME', draft: {} };
            const tmr = addMinutesToTime(nowInfo.dateStr, '00:00', 24 * 60);
            session.draft.date = tmr.date;
            session.step = 'ADD_START_TIME';
            saveUserSession(chatId, session);
            await promptStartTimeStep(chatId, session);
            return;
        }

        if (data.startsWith('add_duration_')) {
            if (!session) return;
            const mins = parseInt(data.replace('add_duration_', ''), 10);
            const endDate = session.draft.date || nowInfo.dateStr;
            const startT = session.draft.startTime || '17:00';
            const endObj = addMinutesToTime(endDate, startT, mins);
            session.draft.endTime = endObj ? endObj.time : startT;
            session.step = 'ADD_REMINDER';
            saveUserSession(chatId, session);
            await promptReminderStep(chatId, session);
            return;
        }

        if (data.startsWith('add_reminder_')) {
            if (!session) return;
            const mins = parseInt(data.replace('add_reminder_', ''), 10);
            session.draft.reminderMinutes = mins;
            session.step = 'ADD_CONFIRM';
            saveUserSession(chatId, session);
            await sendScheduleConfirmMessage(chatId, messageId, session);
            return;
        }

        if (data === 'confirm_create_schedule') {
            let d = session ? session.draft : null;

            if (!d || !d.title) {
                // Fetch last session from DB if memory session is empty
                const lastRow = db.prepare('SELECT * FROM user_sessions WHERE chatId = ?').get(String(chatId));
                if (lastRow) {
                    try {
                        d = JSON.parse(lastRow.draft || '{}');
                    } catch (e) {}
                }
            }

            if (!d || !d.title) {
                await callTelegramAPI('sendMessage', {
                    chat_id: chatId,
                    text: `⚠️ <b>Lịch trình đã hết hạn hoặc không tồn tại!</b>\nVui lòng bấm /them để tạo lại lịch mới.`,
                    parse_mode: 'HTML',
                    reply_markup: buildMainMenuKeyboard()
                });
                return;
            }

            // Safe robust fallbacks for all fields
            const title = d.title || 'Lịch trình mới';
            const date = normalizeDate(d.date) || nowInfo.dateStr;
            const startTime = normalizeTime(d.startTime) || '17:00';
            let endTime = normalizeTime(d.endTime);
            if (!endTime) {
                const endObj = addMinutesToTime(date, startTime, 60);
                endTime = endObj ? endObj.time : startTime;
            }
            const reminderMinutes = parseInt(d.reminderMinutes, 10) || 15;

            const duration = calculateDurationMinutes(startTime, endTime);
            const durationText = formatDurationText(duration);
            const reminderTime = computeReminderDateTime(date, startTime, reminderMinutes);
            const reminderTimeOnly = reminderTime ? reminderTime.split(' ')[1] : '';
            const nowIso = new Date().toISOString();

            // Insert into SQLite database
            const stmt = db.prepare(`
                INSERT INTO schedules (userId, title, date, startTime, endTime, duration, reminderMinutes, reminderTime, status, completed, source, createdAt, updatedAt)
                VALUES ('default_user', ?, ?, ?, ?, ?, ?, ?, 'upcoming', 0, 'telegram', ?, ?)
            `);
            const result = stmt.run(title, date, startTime, endTime, duration, reminderMinutes, reminderTime, nowIso, nowIso);
            const insertedId = result.lastInsertRowid;

            resetSession(chatId);

            // Notify SSE broadcast to Web Clients
            syncEvents.broadcast('schedule_change', { action: 'create', id: insertedId });

            // Create SUCCESS card message
            const successText = `━━━━━━━━━━━━━━━━━━\n🎉 <b>ĐÃ TẠO LỊCH THÀNH CÔNG!</b>\n━━━━━━━━━━━━━━━━━━\n📌 <b>Tên lịch:</b> <b>${title}</b>\n📅 <b>Ngày thực hiện:</b> ${formatDateVN(date)}\n🕐 <b>Khung giờ:</b> <b>${startTime} → ${endTime}</b>\n⏱️ <b>Thời lượng làm việc:</b> ${durationText}\n🔔 <b>Báo trước:</b> ${reminderMinutes} phút\n⏰ <b>Thời gian thông báo:</b> <b>${reminderTimeOnly}</b>\n🟢 <b>Trạng thái:</b> Sắp tới\n⚡ <b>Đồng bộ:</b> Đã đồng bộ Realtime ↔ Website\n━━━━━━━━━━━━━━━━━━`;

            // Always send direct notification message to guarantee delivery
            await callTelegramAPI('sendMessage', {
                chat_id: chatId,
                text: successText,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '➕ Gia hạn +10 phút', callback_data: `action_extend_${insertedId}` },
                            { text: '🗑️ Hủy lịch trình', callback_data: `action_delete_${insertedId}` }
                        ],
                        [{ text: '🏠 Menu chính TimeBot', callback_data: 'menu_main' }]
                    ]
                }
            });

            // Also attempt to update the old confirmation card if messageId exists
            if (messageId) {
                callTelegramAPI('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: `━━━━━━━━━━━━━━━━━━\n✅ <b>ĐÃ XÁC NHẬN LỊCH TRÌNH!</b>\n📌 <b>Lịch trình:</b> <b>${title}</b> (${startTime} → ${endTime})\n━━━━━━━━━━━━━━━━━━`,
                    parse_mode: 'HTML'
                });
            }

            return;
        }

        if (data === 'confirm_ai_all') {
            const pending = (session ? session.pendingList : null) || [];
            const nowIso = new Date().toISOString();
            let createdCount = 0;

            const stmt = db.prepare(`
                INSERT INTO schedules (userId, title, date, startTime, endTime, duration, reminderMinutes, reminderTime, status, completed, source, createdAt, updatedAt)
                VALUES ('default_user', ?, ?, ?, ?, ?, ?, ?, 'upcoming', 0, 'ai', ?, ?)
            `);

            for (const item of pending) {
                const duration = calculateDurationMinutes(item.startTime, item.endTime);
                const reminderTime = computeReminderDateTime(item.date, item.startTime, item.reminderMinutes);
                stmt.run(item.title, item.date, item.startTime, item.endTime, duration, item.reminderMinutes, reminderTime, nowIso, nowIso);
                createdCount++;
            }

            resetSession(chatId);

            // Notify SSE broadcast
            syncEvents.broadcast('schedule_change', { action: 'batch_create', count: createdCount });

            const aiSuccessText = `━━━━━━━━━━━━━━━━━━\n🎉 <b>ĐÃ TẠO ${createdCount} LỊCH TRÌNH THÀNH CÔNG!</b>\n━━━━━━━━━━━━━━━━━━\n🤖 <b>Nguồn:</b> Phân tích AI tự động\n⚡ <b>Đồng bộ:</b> Đã tạo và bật thông báo nhắc nhở tự động trên hệ thống.\n━━━━━━━━━━━━━━━━━━`;

            await callTelegramAPI('sendMessage', {
                chat_id: chatId,
                text: aiSuccessText,
                parse_mode: 'HTML',
                reply_markup: buildMainMenuKeyboard()
            });
            return;
        }
    } catch (err) {
        console.error('Error in handleSessionCallback:', err);
    }
}

/**
 * Prompt steps helpers
 */
async function promptTitleStep(chatId) {
    await callTelegramAPI('sendMessage', {
        chat_id: chatId,
        text: `━━━━━━━━━━━━━━━━━━\n➕ <b>THÊM LỊCH TRÌNH MỚI</b>\n━━━━━━━━━━━━━━━━━━\n📌 <b>Bước 1/5: Tên lịch trình</b>\n\n💡 <b>Hướng dẫn:</b> Nhập tên công việc, bài học hoặc sự kiện bạn muốn đặt lịch.\n<i>Ví dụ: Học giải phẫu, Tập gym, Họp nhóm dự án...</i>\n━━━━━━━━━━━━━━━━━━`,
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [[{ text: '❌ Hủy thao tác', callback_data: 'menu_main' }]]
        }
    });
}

async function promptStartTimeStep(chatId, session) {
    const nowInfo = getNow();
    await callTelegramAPI('sendMessage', {
        chat_id: chatId,
        text: `━━━━━━━━━━━━━━━━━━\n➕ <b>THÊM LỊCH TRÌNH MỚI</b>\n━━━━━━━━━━━━━━━━━━\n🕐 <b>Bước 3/5: Giờ bắt đầu</b>\n\n📌 <b>Tên lịch:</b> <b>${session.draft.title}</b>\n📅 <b>Ngày:</b> ${formatDateVN(session.draft.date)}\n🕐 <b>Giờ hiện tại:</b> ${nowInfo.timeStr} (Asia/Ho_Chi_Minh)\n\n💡 <b>Hướng dẫn:</b> Nhập giờ bắt đầu (Ví dụ: <b>14:30</b> hoặc gõ nhanh <b>1430</b>):\n━━━━━━━━━━━━━━━━━━`,
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [[{ text: '❌ Hủy thao tác', callback_data: 'menu_main' }]]
        }
    });
}

async function promptEndTimeStep(chatId, session) {
    await callTelegramAPI('sendMessage', {
        chat_id: chatId,
        text: `━━━━━━━━━━━━━━━━━━\n➕ <b>THÊM LỊCH TRÌNH MỚI</b>\n━━━━━━━━━━━━━━━━━━\n⏰ <b>Bước 4/5: Giờ kết thúc</b>\n\n📌 <b>Tên lịch:</b> <b>${session.draft.title}</b>\n📅 <b>Ngày:</b> ${formatDateVN(session.draft.date)}\n🕐 <b>Bắt đầu lúc:</b> <b>${session.draft.startTime}</b>\n\n💡 <b>Hướng dẫn:</b> Tự nhập giờ kết thúc (Ví dụ: <b>15:30</b> hoặc <b>1530</b>), hoặc chạm nhanh vào các nút cộng thời lượng bên dưới:\n━━━━━━━━━━━━━━━━━━`,
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '➕ 15 phút', callback_data: 'add_duration_15' },
                    { text: '➕ 30 phút', callback_data: 'add_duration_30' }
                ],
                [
                    { text: '➕ 45 phút', callback_data: 'add_duration_45' },
                    { text: '➕ 1 giờ', callback_data: 'add_duration_60' }
                ],
                [
                    { text: '➕ 1h30', callback_data: 'add_duration_90' },
                    { text: '➕ 2 giờ', callback_data: 'add_duration_120' }
                ],
                [{ text: '❌ Hủy thao tác', callback_data: 'menu_main' }]
            ]
        }
    });
}

async function promptReminderStep(chatId, session) {
    const duration = calculateDurationMinutes(session.draft.startTime, session.draft.endTime);
    const durationText = formatDurationText(duration);

    await callTelegramAPI('sendMessage', {
        chat_id: chatId,
        text: `━━━━━━━━━━━━━━━━━━\n➕ <b>THÊM LỊCH TRÌNH MỚI</b>\n━━━━━━━━━━━━━━━━━━\n🔔 <b>Bước 5/5: Thời gian nhắc trước</b>\n\n📌 <b>Tên lịch:</b> <b>${session.draft.title}</b>\n📅 <b>Ngày:</b> ${formatDateVN(session.draft.date)}\n🕐 <b>Khung giờ:</b> <b>${session.draft.startTime} → ${session.draft.endTime}</b>\n⏱️ <b>Thời lượng làm việc:</b> ${durationText}\n\n💡 <b>Hướng dẫn:</b> Chọn khoảng thời gian hệ thống sẽ tự động gửi thông báo Telegram trước khi công việc bắt đầu:\n━━━━━━━━━━━━━━━━━━`,
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '🔔 +5 phút', callback_data: 'add_reminder_5' },
                    { text: '🔔 +10 phút', callback_data: 'add_reminder_10' }
                ],
                [
                    { text: '🔔 +15 phút', callback_data: 'add_reminder_15' },
                    { text: '🔔 +20 phút', callback_data: 'add_reminder_20' }
                ],
                [
                    { text: '🔔 +30 phút', callback_data: 'add_reminder_30' },
                    { text: '🔔 +45 phút', callback_data: 'add_reminder_45' }
                ],
                [{ text: '🔔 +1 giờ', callback_data: 'add_reminder_60' }],
                [{ text: '❌ Hủy thao tác', callback_data: 'menu_main' }]
            ]
        }
    });
}

async function sendScheduleConfirmMessage(chatId, messageId, session) {
    const d = session.draft || {};
    const duration = calculateDurationMinutes(d.startTime, d.endTime);
    const durationText = formatDurationText(duration);
    const reminderTime = computeReminderDateTime(d.date, d.startTime, d.reminderMinutes);
    const reminderTimeOnly = reminderTime ? reminderTime.split(' ')[1] : '';

    const text = `━━━━━━━━━━━━━━━━━━\n📋 <b>XÁC NHẬN LỊCH TRÌNH</b>\n━━━━━━━━━━━━━━━━━━\n📌 <b>Tên lịch:</b> <b>${d.title || 'Lịch mới'}</b>\n📅 <b>Ngày thực hiện:</b> ${formatDateVN(d.date)}\n🕐 <b>Khung giờ:</b> <b>${d.startTime} → ${d.endTime}</b>\n⏱️ <b>Thời lượng làm việc:</b> ${durationText}\n🔔 <b>Báo trước:</b> ${d.reminderMinutes} phút\n⏰ <b>Thời gian thông báo:</b> <b>${reminderTimeOnly}</b>\n📱 <b>Nguồn tạo:</b> Telegram Bot\n━━━━━━━━━━━━━━━━━━\n💡 <b>Kiểm tra lại thông tin và bấm nút Xác nhận bên dưới để hoàn tất:</b>`;

    await callTelegramAPI('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '✅ Xác nhận tạo lịch', callback_data: 'confirm_create_schedule' }],
                [
                    { text: '✏️ Chỉnh sửa', callback_data: 'menu_add' },
                    { text: '❌ Hủy lịch trình', callback_data: 'menu_main' }
                ]
            ]
        }
    });
}

async function sendAiConfirmMessage(chatId, schedules) {
    if (schedules.length <= 10) {
        let msgText = `━━━━━━━━━━━━━━━━━━\n🤖 <b>AI ĐÃ PHÂN TÍCH THÀNH CÔNG</b>\nTìm thấy <b>${schedules.length} lịch trình</b> trong văn bản:\n━━━━━━━━━━━━━━━━━━\n\n`;
        const numbers = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

        schedules.forEach((s, idx) => {
            const num = numbers[idx] || `${idx + 1}.`;
            const durationText = formatDurationText(calculateDurationMinutes(s.startTime, s.endTime));
            msgText += `${num} 📚 <b>${s.title}</b>\n📅 <b>Ngày:</b> ${formatDateVN(s.date)}\n🕐 <b>Khung giờ:</b> ${s.startTime} → ${s.endTime} (${durationText})\n🔔 <b>Báo trước:</b> ${s.reminderMinutes} phút\n\n`;
        });
        msgText += `━━━━━━━━━━━━━━━━━━`;

        await callTelegramAPI('sendMessage', {
            chat_id: chatId,
            text: msgText,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `✅ Xác nhận tạo tất cả ${schedules.length} lịch trình`, callback_data: 'confirm_ai_all' }],
                    [
                        { text: '✏️ Làm lại', callback_data: 'menu_ai' },
                        { text: '❌ Hủy thao tác', callback_data: 'menu_main' }
                    ]
                ]
            }
        });
    } else {
        // Large batch summary card
        const dates = schedules.map(s => s.date).sort();
        const minDate = formatDateVN(dates[0]);
        const maxDate = formatDateVN(dates[dates.length - 1]);

        let msgText = `━━━━━━━━━━━━━━━━━━\n🤖 <b>AI ĐÃ PHÂN TÍCH THÀNH CÔNG BẢNG LỊCH TRÌNH!</b>\n━━━━━━━━━━━━━━━━━━\n📊 <b>Tổng số lịch tìm thấy:</b> <b>${schedules.length} lịch trình</b>\n📅 <b>Khoảng thời gian:</b> ${minDate} → ${maxDate}\n⚡ <b>Trạng thái:</b> Sẵn sàng đưa vào hệ thống & tự động báo giờ\n━━━━━━━━━━━━━━━━━━\n📌 <b>Xem trước một số lịch mẫu:</b>\n\n`;

        schedules.slice(0, 5).forEach((s, idx) => {
            msgText += `${idx + 1}. 📚 <b>${s.title}</b>\n   📅 ${formatDateVN(s.date)} | 🕐 <b>${s.startTime} → ${s.endTime}</b>\n`;
        });

        if (schedules.length > 5) {
            msgText += `...\n<i>và ${schedules.length - 5} lịch trình khác.</i>\n`;
        }

        msgText += `━━━━━━━━━━━━━━━━━━\n💡 <b>Bấm nút bên dưới để tạo toàn bộ ${schedules.length} lịch trình ngay lập tức:</b>`;

        await callTelegramAPI('sendMessage', {
            chat_id: chatId,
            text: msgText,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `✅ Xác nhận tạo tất cả ${schedules.length} lịch trình`, callback_data: 'confirm_ai_all' }],
                    [
                        { text: '✏️ Dán lại', callback_data: 'menu_ai' },
                        { text: '❌ Hủy thao tác', callback_data: 'menu_main' }
                    ]
                ]
            }
        });
    }
}

/**
 * Handle quick actions on schedule items
 */
async function handleScheduleAction(chatId, messageId, data) {
    if (data.startsWith('action_extend_')) {
        const id = parseInt(data.replace('action_extend_', ''), 10);
        const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id);
        if (!row) return;

        const newEndObj = addMinutesToTime(row.date, row.endTime, 10);
        const newDuration = calculateDurationMinutes(row.startTime, newEndObj.time);
        const durationText = formatDurationText(newDuration);
        const nowIso = new Date().toISOString();

        db.prepare('UPDATE schedules SET endTime = ?, duration = ?, updatedAt = ? WHERE id = ?')
          .run(newEndObj.time, newDuration, nowIso, id);

        syncEvents.broadcast('schedule_change', { action: 'update', id });

        await callTelegramAPI('sendMessage', {
            chat_id: chatId,
            text: `━━━━━━━━━━━━━━━━━━\n➕ <b>ĐÃ GIA HẠN LỊCH TRÌNH +10 PHÚT!</b>\n━━━━━━━━━━━━━━━━━━\n📌 <b>Lịch trình:</b> <b>${row.title}</b>\n🕐 <b>Khung giờ mới:</b> <b>${row.startTime} → ${newEndObj.time}</b>\n⏱️ <b>Tổng thời lượng:</b> ${durationText}\n⚡ <b>Đồng bộ:</b> Đã cập nhật ngay lên Website\n━━━━━━━━━━━━━━━━━━`,
            parse_mode: 'HTML',
            reply_markup: buildMainMenuKeyboard()
        });
        return;
    }

    if (data.startsWith('action_complete_')) {
        const id = parseInt(data.replace('action_complete_', ''), 10);
        const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id);
        const nowIso = new Date().toISOString();
        const nowInfo = getNow();

        db.prepare('UPDATE schedules SET completed = 1, status = "completed", updatedAt = ? WHERE id = ?')
          .run(nowIso, id);

        syncEvents.broadcast('schedule_change', { action: 'complete', id });

        const title = row ? row.title : 'Lịch trình';
        const date = row ? formatDateVN(row.date) : formatDateVN(nowInfo.dateStr);
        const startTime = row ? row.startTime : '';
        const endTime = row ? row.endTime : '';
        const durationText = row ? formatDurationText(row.duration) : '';
        const quote = getRandomQuote();

        const completedCardText = `━━━━━━━━━━━━━━━━━━\n🎉 <b>BẢNG THỐNG KÊ HOÀN THÀNH LỊCH TRÌNH</b>\n━━━━━━━━━━━━━━━━━━\n📌 <b>Lịch trình:</b> <b>${title}</b>\n📅 <b>Ngày thực hiện:</b> ${date}\n🕐 <b>Khung giờ:</b> <b>${startTime} → ${endTime}</b>\n⏱️ <b>Thời lượng làm việc:</b> ${durationText}\n✅ <b>Trạng thái:</b> Đã hoàn thành lúc ${nowInfo.timeStr}\n🏆 <b>Thành tích:</b> +1 lịch trình hoàn thành!\n⚡ <b>Đồng bộ:</b> Đã cập nhật realtime lên Website & 3 Card thống kê\n━━━━━━━━━━━━━━━━━━\n${quote}\n━━━━━━━━━━━━━━━━━━`;

        let editRes = { ok: false };
        if (messageId) {
            editRes = await callTelegramAPI('editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: completedCardText,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🏠 Menu chính TimeBot', callback_data: 'menu_main' }]
                    ]
                }
            });
        }

        if (!editRes.ok) {
            await callTelegramAPI('sendMessage', {
                chat_id: chatId,
                text: completedCardText,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🏠 Menu chính TimeBot', callback_data: 'menu_main' }]
                    ]
                }
            });
        }
        return;
    }

    if (data.startsWith('action_delete_')) {
        const id = parseInt(data.replace('action_delete_', ''), 10);
        const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id);
        db.prepare('DELETE FROM schedules WHERE id = ?').run(id);

        syncEvents.broadcast('schedule_change', { action: 'delete', id });

        await callTelegramAPI('sendMessage', {
            chat_id: chatId,
            text: `━━━━━━━━━━━━━━━━━━\n🗑️ <b>ĐÃ HỦY LỊCH TRÌNH!</b>\n━━━━━━━━━━━━━━━━━━\n📌 <b>Lịch trình:</b> <b>${row ? row.title : ''}</b>\nĐã xóa thành công khỏi hệ thống & Website.\n━━━━━━━━━━━━━━━━━━`,
            parse_mode: 'HTML',
            reply_markup: buildMainMenuKeyboard()
        });
        return;
    }
}

/**
 * Send Today's schedules
 */
async function sendTodaySchedules(chatId) {
    const nowInfo = getNow();
    const rows = db.prepare('SELECT * FROM schedules WHERE date = ? AND completed = 0 AND status != "cancelled" ORDER BY startTime ASC').all(nowInfo.dateStr);

    let text = `━━━━━━━━━━━━━━━━━━\n📅 <b>DANH SÁCH LỊCH HÔM NAY</b>\n🗓️ <b>Ngày:</b> ${formatDateVN(nowInfo.dateStr)}\n━━━━━━━━━━━━━━━━━━\n\n`;

    if (rows.length === 0) {
        text += `🗓️ <i>Chưa có lịch trình nào cho hôm nay.</i>`;
    } else {
        rows.forEach(r => {
            const status = computeScheduleStatus(r, nowInfo);
            const statusIcon = status === 'running' ? '🔵' : status === 'ended' ? '⚪' : '🟢';
            const statusLabel = status === 'running' ? 'Đang diễn ra' : status === 'ended' ? 'Đã kết thúc' : 'Sắp tới';
            const durationText = formatDurationText(r.duration);

            text += `${statusIcon} <b>${r.startTime} — ${r.endTime}</b> (${durationText})\n📚 <b>Lịch:</b> <b>${r.title}</b>\n🔔 <b>Thông báo:</b> Báo trước ${r.reminderMinutes} phút\n📊 <b>Trạng thái:</b> ${statusLabel}\n\n━━━━━━━━━━━━━━━━━━\n\n`;
        });
    }

    await callTelegramAPI('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        reply_markup: buildMainMenuKeyboard()
    });
}

/**
 * Send date schedules
 */
async function sendDateSchedules(chatId, dateStr) {
    const nowInfo = getNow();
    const rows = db.prepare('SELECT * FROM schedules WHERE date = ? ORDER BY startTime ASC').all(dateStr);

    let text = `━━━━━━━━━━━━━━━━━━\n📅 <b>LỊCH NGÀY ${formatDateVN(dateStr)}</b>\n━━━━━━━━━━━━━━━━━━\n\n`;

    if (rows.length === 0) {
        text += `🗓️ <i>Chưa có lịch trình nào cho ngày này.</i>`;
    } else {
        rows.forEach(r => {
            const status = computeScheduleStatus(r, nowInfo);
            const statusIcon = r.completed ? '✅' : status === 'running' ? '🔵' : status === 'ended' ? '⚪' : '🟢';
            const statusLabel = r.completed ? 'Đã hoàn thành' : status === 'running' ? 'Đang diễn ra' : status === 'ended' ? 'Đã kết thúc' : 'Sắp tới';
            const durationText = formatDurationText(r.duration);

            text += `${statusIcon} <b>${r.startTime} — ${r.endTime}</b> (${durationText})\n📚 <b>Lịch:</b> <b>${r.title}</b>\n📊 <b>Trạng thái:</b> ${statusLabel}\n\n━━━━━━━━━━━━━━━━━━\n\n`;
        });
    }

    await callTelegramAPI('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        reply_markup: buildMainMenuKeyboard()
    });
}

/**
 * Send upcoming schedules
 */
async function sendUpcomingSchedules(chatId) {
    const nowInfo = getNow();
    const rows = db.prepare('SELECT * FROM schedules WHERE completed = 0 AND status != "cancelled" AND date >= ? ORDER BY date ASC, startTime ASC LIMIT 10').all(nowInfo.dateStr);

    let text = `━━━━━━━━━━━━━━━━━━\n⏰ <b>DANH SÁCH LỊCH SẮP TỚI</b>\n━━━━━━━━━━━━━━━━━━\n\n`;

    if (rows.length === 0) {
        text += `🗓️ <i>Hiện không có lịch trình sắp tới.</i>`;
    } else {
        rows.forEach(r => {
            const dateLabel = formatDateVN(r.date);
            const durationText = formatDurationText(r.duration);
            text += `🟢 <b>${dateLabel} — ${r.startTime}</b>\n📚 <b>Tên lịch:</b> <b>${r.title}</b>\n🕐 <b>Khung giờ:</b> ${r.startTime} → ${r.endTime} (${durationText})\n\n━━━━━━━━━━━━━━━━━━\n\n`;
        });
    }

    await callTelegramAPI('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        reply_markup: buildMainMenuKeyboard()
    });
}

/**
 * Instant Polling Engine (timeout: 0, 100ms interval for INSTANT response < 50ms)
 */
function startTelegramBot() {
    if (isPolling) return;
    isPolling = true;
    console.log('Starting Telegram Bot Polling (Instant Mode - 100ms)...');

    // Register persistent Telegram Chat Command Menu button
    setBotCommands();

    async function poll() {
        if (!isPolling) return;
        const token = getSetting('telegram_bot_token', '');
        if (!token) {
            setTimeout(poll, 2000);
            return;
        }

        try {
            // Short polling with timeout: 0 for instant non-blocking check
            const res = await callTelegramAPI('getUpdates', {
                offset: pollingOffset,
                timeout: 0
            });

            if (res.ok && Array.isArray(res.result) && res.result.length > 0) {
                for (const update of res.result) {
                    pollingOffset = update.update_id + 1;
                    // Process update asynchronously without blocking polling loop
                    handleUpdate(update).catch(err => console.error('Update handling error:', err));
                }
            }
        } catch (err) {
            console.error('Telegram Polling Error:', err.message);
        }

        // Poll again in 100ms for INSTANT responsiveness
        setTimeout(poll, 100);
    }

    poll();
}

function stopTelegramBot() {
    isPolling = false;
}

module.exports = {
    callTelegramAPI,
    sendTestMessage,
    getBotInfo,
    setBotCommands,
    startTelegramBot,
    stopTelegramBot
};
