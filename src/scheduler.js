/**
 * Persistent Background Scheduler Engine for TimeBot
 * Runs automatically, survives server restarts, and dispatches automated Telegram alerts
 */

const db = require('./db');
const { getNow, formatDateVN, formatDurationText, computeScheduleStatus } = require('./timeUtils');
const { callTelegramAPI } = require('./telegramBot');
const { getSetting } = require('./config');
const { getRandomQuote } = require('./quotes');
const syncEvents = require('./syncEvents');

let schedulerInterval = null;

/**
 * Check and process all active schedules against current time
 */
async function processScheduleTick() {
    const nowInfo = getNow();
    const currentFullStr = `${nowInfo.dateStr} ${nowInfo.timeStr}`;
    const chatId = getSetting('telegram_chat_id', '');

    try {
        // Query active (uncompleted, uncancelled) schedules
        const schedules = db.prepare(`
            SELECT * FROM schedules 
            WHERE completed = 0 AND status != 'cancelled'
        `).all();

        for (const s of schedules) {
            const currentStatus = computeScheduleStatus(s, nowInfo);
            const startFullStr = `${s.date} ${s.startTime}`;
            const endFullStr = `${s.date} ${s.endTime}`;
            const reminderFullStr = s.reminderTime || startFullStr;

            let updated = false;

            // Update status in DB if changed
            if (s.status !== currentStatus) {
                db.prepare('UPDATE schedules SET status = ?, updatedAt = ? WHERE id = ?')
                  .run(currentStatus, new Date().toISOString(), s.id);
                s.status = currentStatus;
                updated = true;
            }

            // 1. Check Reminder Notification (🔔 SẮP ĐẾN GIỜ)
            if (!s.reminderNotified && currentFullStr >= reminderFullStr && currentFullStr < startFullStr) {
                db.prepare('UPDATE schedules SET reminderNotified = 1, updatedAt = ? WHERE id = ?')
                  .run(new Date().toISOString(), s.id);
                s.reminderNotified = 1;
                updated = true;

                if (chatId) {
                    const durationText = formatDurationText(s.duration);
                    const quote = getRandomQuote();
                    await callTelegramAPI('sendMessage', {
                        chat_id: chatId,
                        text: `━━━━━━━━━━━━━━━━━━\n🔔 <b>SẮP ĐẾN GIỜ THỰC HIỆN!</b>\n━━━━━━━━━━━━━━━━━━\n📌 <b>Lịch trình:</b> <b>${s.title}</b>\n📅 <b>Ngày thực hiện:</b> ${formatDateVN(s.date)}\n🕐 <b>Khung giờ:</b> <b>${s.startTime} → ${s.endTime}</b> (${durationText})\n⏳ <b>Còn lại:</b> <b>${s.reminderMinutes} phút</b> nữa đến giờ!\n🟢 <b>Trạng thái:</b> Sắp tới\n━━━━━━━━━━━━━━━━━━\n${quote}\n━━━━━━━━━━━━━━━━━━`,
                        parse_mode: 'HTML'
                    });
                }
            }

            // 2. Check Start Time Notification (🚨 ĐÃ ĐẾN GIỜ THỰC HIỆN!)
            if (!s.startNotified && currentFullStr >= startFullStr && currentFullStr < endFullStr) {
                db.prepare('UPDATE schedules SET startNotified = 1, updatedAt = ? WHERE id = ?')
                  .run(new Date().toISOString(), s.id);
                s.startNotified = 1;
                updated = true;

                if (chatId) {
                    const durationText = formatDurationText(s.duration);
                    const quote = getRandomQuote();
                    await callTelegramAPI('sendMessage', {
                        chat_id: chatId,
                        text: `━━━━━━━━━━━━━━━━━━\n🚨 <b>ĐÃ ĐẾN GIỜ THỰC HIỆN!</b>\n━━━━━━━━━━━━━━━━━━\n📌 <b>Lịch trình:</b> <b>${s.title}</b>\n📅 <b>Ngày thực hiện:</b> ${formatDateVN(s.date)}\n🕐 <b>Khung giờ:</b> <b>${s.startTime} → ${s.endTime}</b>\n⏱️ <b>Thời lượng làm việc:</b> ${durationText}\n🔔 <b>Nhắc trước:</b> ${s.reminderMinutes} phút\n🔵 <b>Trạng thái:</b> Đang diễn ra\n━━━━━━━━━━━━━━━━━━\n${quote}\n━━━━━━━━━━━━━━━━━━\n⏰ <b>Hãy bắt đầu công việc ngay bây giờ!</b>`,
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '✅ Hoàn thành lịch trình', callback_data: `action_complete_${s.id}` }],
                                [
                                    { text: '➕ Gia hạn +10 phút', callback_data: `action_extend_${s.id}` },
                                    { text: '🗑️ Hủy lịch', callback_data: `action_delete_${s.id}` }
                                ]
                            ]
                        }
                    });
                }
            }

            // 3. Check End Time Notification (✅ LỊCH ĐÃ KẾT THÚC)
            if (!s.endNotified && currentFullStr >= endFullStr) {
                db.prepare('UPDATE schedules SET endNotified = 1, updatedAt = ? WHERE id = ?')
                  .run(new Date().toISOString(), s.id);
                s.endNotified = 1;
                updated = true;

                if (chatId) {
                    const durationText = formatDurationText(s.duration);
                    const quote = getRandomQuote();
                    await callTelegramAPI('sendMessage', {
                        chat_id: chatId,
                        text: `━━━━━━━━━━━━━━━━━━\n✅ <b>LỊCH ĐÃ KẾT THÚC KHUNG GIỜ</b>\n━━━━━━━━━━━━━━━━━━\n📌 <b>Lịch trình:</b> <b>${s.title}</b>\n📅 <b>Ngày:</b> ${formatDateVN(s.date)}\n🕐 <b>Khung giờ:</b> <b>${s.startTime} → ${s.endTime}</b> (${durationText})\n⚪ <b>Trạng thái:</b> Đã hết giờ làm việc\n━━━━━━━━━━━━━━━━━━\n${quote}\n━━━━━━━━━━━━━━━━━━`,
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '✅ Hoàn thành lịch trình', callback_data: `action_complete_${s.id}` }],
                                [
                                    { text: '➕ Gia hạn +10 phút', callback_data: `action_extend_${s.id}` },
                                    { text: '🗑️ Hủy lịch', callback_data: `action_delete_${s.id}` }
                                ]
                            ]
                        }
                    });
                }
            }

            if (updated) {
                syncEvents.broadcast('schedule_status_change', { id: s.id, status: currentStatus });
            }
        }
    } catch (err) {
        console.error('Scheduler Tick Error:', err.message);
    }
}

/**
 * Start Scheduler loop
 */
function startScheduler() {
    if (schedulerInterval) return;
    console.log('Starting Background Scheduler (Checking every 10 seconds)...');
    processScheduleTick(); // Run immediately on startup
    schedulerInterval = setInterval(processScheduleTick, 10000);
}

function stopScheduler() {
    if (schedulerInterval) {
        clearInterval(schedulerInterval);
        schedulerInterval = null;
    }
}

module.exports = {
    startScheduler,
    stopScheduler,
    processScheduleTick
};
