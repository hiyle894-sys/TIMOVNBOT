/**
 * AI Service for schedule parsing using Google Gemini / OpenAI / Custom endpoints
 */

const { getSetting } = require('./config');
const { getNow, normalizeDate, normalizeTime, addMinutesToTime } = require('./timeUtils');

/**
 * Fallback heuristic parser when AI key is missing or AI request fails
 */
function heuristicParse(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const nowInfo = getNow();
    const results = [];

    for (const line of lines) {
        // Look for date pattern (dd/mm/yyyy or yyyy-mm-dd)
        let dateStr = nowInfo.dateStr;
        const dateMatch = line.match(/(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
            dateStr = normalizeDate(dateMatch[0]) || nowInfo.dateStr;
        } else if (line.toLowerCase().includes('ngày mai')) {
            const tmr = addMinutesToTime(nowInfo.dateStr, '00:00', 24 * 60);
            if (tmr) dateStr = tmr.date;
        }

        // Look for time range e.g. 17:00-18:00 or 17h-18h or 1700-1800
        let startTime = null;
        let endTime = null;
        
        const rangeMatch = line.match(/(\d{1,2}(?::\d{2}|h\d{2}|00)?)\s*(?:-|->|đến|to)\s*(\d{1,2}(?::\d{2}|h\d{2}|00)?)/i);
        if (rangeMatch) {
            startTime = normalizeTime(rangeMatch[1].replace('h', ':'));
            endTime = normalizeTime(rangeMatch[2].replace('h', ':'));
        } else {
            // Single time match
            const singleTime = line.match(/(\d{1,2}:\d{2}|\d{4})/);
            if (singleTime) {
                startTime = normalizeTime(singleTime[0]);
            }
        }

        // Clean title
        let title = line
            .replace(/(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/, '')
            .replace(/(\d{1,2}(?::\d{2}|h\d{2}|00)?)\s*(?:-|->|đến|to)\s*(\d{1,2}(?::\d{2}|h\d{2}|00)?)/gi, '')
            .replace(/(\d{1,2}:\d{2}|\d{4})/, '')
            .replace(/(hôm nay|ngày mai)/gi, '')
            .trim();

        if (!title) title = line;

        if (startTime && !endTime) {
            const endObj = addMinutesToTime(dateStr, startTime, 60);
            endTime = endObj ? endObj.time : startTime;
        }

        const missingInfo = !startTime ? 'Thiếu thời gian bắt đầu' : null;

        results.push({
            title,
            date: dateStr,
            startTime,
            endTime,
            reminderMinutes: 15,
            missingInfo
        });
    }

    return results;
}

/**
 * Main AI Parse function calling Gemini or OpenAI API
 */
async function parseSchedulesWithAI(text) {
    const provider = getSetting('ai_provider', 'gemini');
    const apiKey = getSetting('ai_api_key', '');
    const model = getSetting('ai_model', 'gemini-3.6-flash');

    if (!apiKey) {
        console.log('No AI API Key configured. Using heuristic fallback parser.');
        return {
            success: true,
            isFallback: true,
            schedules: heuristicParse(text)
        };
    }

    const nowInfo = getNow();
    const currentYear = nowInfo.dateStr.split('-')[0];

    const systemPrompt = `Bạn là trợ lý AI phân tích lịch trình thời gian chuyên nghiệp cho ứng dụng TimeBot.
Mục tiêu của bạn là nhận vào một đoạn văn bản (có thể là danh sách, bảng lịch học, thời khóa biểu nhiều cột) và chuyển đổi thành danh sách cấu trúc JSON các lịch trình.

Thông tin thời gian hiện tại (Timezone: Asia/Ho_Chi_Minh):
- Ngày hiện tại: ${nowInfo.dateStr} (Định dạng YYYY-MM-DD)
- Năm hiện tại: ${currentYear}
- Thứ / Giờ hiện tại: ${nowInfo.fullStr}

Quy tắc phân tích:
1. Trả về DUY NHẤT một mã JSON array hợp lệ (không kèm markdown format, không bọc trong \`\`\`json).
2. TÁCH RỜI TỪNG MỤC CÔNG VIỆC: Nếu trong 1 ngày hoặc 1 dòng có nhiều ca/buổi (Sáng, Chiều, Đêm, 8:00-11:00, 13:00-17:30, 21:30-22:30...), tạo MỖI CA HỌC/CÔNG VIỆC thành 1 object JSON riêng.
3. NGÀY THÁNG: Khi gặp ngày dạng "14/09", "15/09", "01/10", kết hợp với năm hiện tại (${currentYear}) để tạo ra ngày chuẩn YYYY-MM-DD (Ví dụ: "2026-09-14", "2026-10-01").
4. Mỗi phần tử trong array phải có các trường:
   - "title": Tên công việc / môn học ngắn gọn, rõ ràng (string, vd: "Ôn Toán online", "Giải phẫu I", "Học ĐGNL")
   - "date": Ngày thực hiện (string YYYY-MM-DD).
   - "startTime": Thời gian bắt đầu (string HH:mm, vd: "08:00", "13:00", "21:30"). Nếu không tìm thấy giờ, để null.
   - "endTime": Thời gian kết thúc (string HH:mm, vd: "11:00", "17:30", "22:30"). Nếu thiếu, tự động bằng startTime + 60 phút.
   - "reminderMinutes": Báo trước bao nhiêu phút (integer, mặc định 15).
   - "missingInfo": Nếu thiếu startTime, ghi "Thiếu thời gian bắt đầu", ngược lại để null.

Ví dụ Output JSON:
[
  {
    "title": "Ôn Toán online",
    "date": "2026-09-14",
    "startTime": "08:00",
    "endTime": "11:00",
    "reminderMinutes": 15,
    "missingInfo": null
  },
  {
    "title": "Giải phẫu I (Trường)",
    "date": "2026-09-14",
    "startTime": "13:00",
    "endTime": "17:30",
    "reminderMinutes": 15,
    "missingInfo": null
  }
]`;

    try {
        let jsonText = '';

        if (provider === 'gemini') {
            const modelsToTry = [model || 'gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-3.5-flash'];
            let lastErr = null;

            for (const m of modelsToTry) {
                try {
                    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
                    const res = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{
                                parts: [
                                    { text: systemPrompt },
                                    { text: `Dưới đây là danh sách lịch trình cần phân tích:\n\n${text}` }
                                ]
                            }],
                            generationConfig: {
                                temperature: 0.1,
                                responseMimeType: "application/json"
                            }
                        })
                    });

                    if (res.ok) {
                        const data = await res.json();
                        jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
                        if (jsonText) {
                            console.log(`Gemini API succeeded using model: ${m}`);
                            break;
                        }
                    } else {
                        const errBody = await res.text();
                        lastErr = new Error(`Gemini (${m}) ${res.status}: ${errBody}`);
                    }
                } catch (e) {
                    lastErr = e;
                }
            }

            if (!jsonText) {
                throw lastErr || new Error('All Gemini models failed');
            }
        } else {
            // OpenAI or OpenAI-compatible
            const endpoint = provider === 'custom' ? getSetting('ai_custom_endpoint', 'https://api.openai.com/v1') : 'https://api.openai.com/v1';
            const res = await fetch(`${endpoint}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: model || 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: text }
                    ],
                    temperature: 0.1
                })
            });

            if (!res.ok) {
                const errBody = await res.text();
                throw new Error(`OpenAI API Error ${res.status}: ${errBody}`);
            }

            const data = await res.json();
            jsonText = data.choices?.[0]?.message?.content || '';
        }

        // Clean json output markdown wrappers if present
        jsonText = jsonText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
        const parsed = JSON.parse(jsonText);

        // Normalize fields
        const finalSchedules = parsed.map(item => {
            const date = normalizeDate(item.date) || nowInfo.dateStr;
            const startTime = normalizeTime(item.startTime);
            let endTime = normalizeTime(item.endTime);
            if (startTime && !endTime) {
                const endObj = addMinutesToTime(date, startTime, 60);
                endTime = endObj ? endObj.time : startTime;
            }
            return {
                title: item.title || 'Lịch trình mới',
                date,
                startTime,
                endTime,
                reminderMinutes: parseInt(item.reminderMinutes, 10) || 15,
                missingInfo: !startTime ? (item.missingInfo || 'Thiếu thời gian bắt đầu') : null
            };
        });

        return {
            success: true,
            isFallback: false,
            schedules: finalSchedules
        };
    } catch (err) {
        console.error('AI parsing failed, reverting to heuristic parse:', err.message);
        return {
            success: true,
            isFallback: true,
            error: err.message,
            schedules: heuristicParse(text)
        };
    }
}

module.exports = {
    parseSchedulesWithAI,
    heuristicParse
};
