/**
 * Time and Date Utilities for TimeBot
 * Timezone enforced: Asia/Ho_Chi_Minh (UTC+7)
 */

const TIMEZONE = 'Asia/Ho_Chi_Minh';

/**
 * Returns current Date object shifted to Asia/Ho_Chi_Minh
 */
function getNow() {
    const now = new Date();
    // Convert to ISO string in Asia/Ho_Chi_Minh
    const options = { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    const formatter = new Intl.DateTimeFormat('en-CA', options);
    const parts = formatter.formatToParts(now);
    const dateObj = {};
    parts.forEach(p => { if (p.type !== 'literal') dateObj[p.type] = p.value; });
    
    // Construct Date object with exact timezone values
    const dateStr = `${dateObj.year}-${dateObj.month}-${dateObj.day}T${dateObj.hour}:${dateObj.minute}:${dateObj.second}`;
    return {
        year: dateObj.year,
        month: dateObj.month,
        day: dateObj.day,
        hour: dateObj.hour,
        minute: dateObj.minute,
        second: dateObj.second,
        dateStr: `${dateObj.year}-${dateObj.month}-${dateObj.day}`,
        timeStr: `${dateObj.hour}:${dateObj.minute}`,
        fullStr: `${dateObj.day}/${dateObj.month}/${dateObj.year} ${dateObj.hour}:${dateObj.minute}`,
        timestamp: new Date(dateStr).getTime()
    };
}

/**
 * Normalize time string like "1700", "930", "17:0", "17:00" to "HH:mm"
 */
function normalizeTime(input) {
    if (!input) return null;
    let str = input.toString().trim();
    if (str.includes(':')) {
        const parts = str.split(':');
        let h = parseInt(parts[0], 10);
        let m = parseInt(parts[1] || '0', 10);
        if (isNaN(h) || isNaN(m)) return null;
        if (h < 0 || h > 23 || m < 0 || m > 59) return null;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    } else if (/^\d{3,4}$/.test(str)) {
        let h, m;
        if (str.length === 3) {
            h = parseInt(str.substring(0, 1), 10);
            m = parseInt(str.substring(1), 10);
        } else {
            h = parseInt(str.substring(0, 2), 10);
            m = parseInt(str.substring(2), 10);
        }
        if (isNaN(h) || isNaN(m)) return null;
        if (h < 0 || h > 23 || m < 0 || m > 59) return null;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    return null;
}

/**
 * Format date input (dd/mm/yyyy or yyyy-mm-dd) to standard YYYY-MM-DD
 */
function normalizeDate(input) {
    if (!input) return null;
    let str = input.toString().trim();
    
    // Check YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    
    // Match DD/MM or DD/MM/YYYY or D/M/YY
    const dateMatch = str.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    if (dateMatch) {
        let d = parseInt(dateMatch[1], 10);
        let m = parseInt(dateMatch[2], 10);
        let y = dateMatch[3] ? parseInt(dateMatch[3], 10) : getNow().year;
        if (y < 100) y += 2000;
        if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
            return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        }
    }
    return null;
}

/**
 * Convert YYYY-MM-DD to DD/MM/YYYY
 */
function formatDateVN(dateStr) {
    if (!dateStr) return '';
    const norm = normalizeDate(dateStr);
    if (!norm) return dateStr;
    const [y, m, d] = norm.split('-');
    return `${d}/${m}/${y}`;
}

/**
 * Add minutes to time string "HH:mm" on date YYYY-MM-DD
 * Returns { date: "YYYY-MM-DD", time: "HH:mm" }
 */
function addMinutesToTime(dateStr, timeStr, minutesToAdd) {
    const normDate = normalizeDate(dateStr);
    const normTime = normalizeTime(timeStr);
    if (!normDate || !normTime) return null;
    
    const [y, m, d] = normDate.split('-').map(Number);
    const [hh, mm] = normTime.split(':').map(Number);
    
    const dt = new Date(Date.UTC(y, m - 1, d, hh, mm));
    dt.setUTCMinutes(dt.getUTCMinutes() + minutesToAdd);
    
    const resY = dt.getUTCFullYear();
    const resM = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const resD = String(dt.getUTCDate()).padStart(2, '0');
    const resH = String(dt.getUTCHours()).padStart(2, '0');
    const resMin = String(dt.getUTCMinutes()).padStart(2, '0');
    
    return {
        date: `${resY}-${resM}-${resD}`,
        time: `${resH}:${resMin}`
    };
}

/**
 * Subtract minutes from date "YYYY-MM-DD" and time "HH:mm"
 * Returns "YYYY-MM-DD HH:mm" string
 */
function computeReminderDateTime(dateStr, startTimeStr, reminderMinutes) {
    const normDate = normalizeDate(dateStr);
    const normTime = normalizeTime(startTimeStr);
    if (!normDate || !normTime) return null;
    
    const mins = parseInt(reminderMinutes, 10) || 0;
    const [y, m, d] = normDate.split('-').map(Number);
    const [hh, mm] = normTime.split(':').map(Number);
    
    const dt = new Date(Date.UTC(y, m - 1, d, hh, mm));
    dt.setUTCMinutes(dt.getUTCMinutes() - mins);
    
    const resY = dt.getUTCFullYear();
    const resM = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const resD = String(dt.getUTCDate()).padStart(2, '0');
    const resH = String(dt.getUTCHours()).padStart(2, '0');
    const resMin = String(dt.getUTCMinutes()).padStart(2, '0');
    
    return `${resY}-${resM}-${resD} ${resH}:${resMin}`;
}

/**
 * Calculate duration in minutes between startTime and endTime on dateStr
 */
function calculateDurationMinutes(startTimeStr, endTimeStr) {
    const t1 = normalizeTime(startTimeStr);
    const t2 = normalizeTime(endTimeStr);
    if (!t1 || !t2) return 0;
    
    const [h1, m1] = t1.split(':').map(Number);
    const [h2, m2] = t2.split(':').map(Number);
    
    let total1 = h1 * 60 + m1;
    let total2 = h2 * 60 + m2;
    
    if (total2 < total1) {
        total2 += 24 * 60; // Crosses midnight
    }
    return total2 - total1;
}

/**
 * Format duration minutes to human friendly Vietnamese (e.g., "1 giờ 30 phút", "45 phút", "2 giờ")
 */
function formatDurationText(minutes) {
    const mins = parseInt(minutes, 10) || 0;
    if (mins <= 0) return '0 phút';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m} phút`;
    if (m === 0) return `${h} giờ`;
    return `${h} giờ ${m} phút`;
}

/**
 * Calculate dynamic status for a schedule object
 * Returns: 'completed' | 'upcoming' | 'running' | 'ended'
 */
function computeScheduleStatus(schedule, nowInfo = getNow()) {
    if (schedule.completed || schedule.status === 'completed') {
        return 'completed';
    }
    if (schedule.status === 'cancelled') {
        return 'cancelled';
    }
    
    const normDate = normalizeDate(schedule.date);
    const normStart = normalizeTime(schedule.startTime);
    const normEnd = normalizeTime(schedule.endTime);
    
    if (!normDate || !normStart || !normEnd) return schedule.status || 'upcoming';
    
    const currentFullStr = `${nowInfo.dateStr} ${nowInfo.timeStr}`;
    const startFullStr = `${normDate} ${normStart}`;
    const endFullStr = `${normDate} ${normEnd}`;
    
    if (currentFullStr < startFullStr) {
        return 'upcoming';
    } else if (currentFullStr >= startFullStr && currentFullStr <= endFullStr) {
        return 'running';
    } else {
        return 'ended';
    }
}

module.exports = {
    TIMEZONE,
    getNow,
    normalizeTime,
    normalizeDate,
    formatDateVN,
    addMinutesToTime,
    computeReminderDateTime,
    calculateDurationMinutes,
    formatDurationText,
    computeScheduleStatus
};
