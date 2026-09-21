/**
 * Native Node.js Web Server & REST API Router for TimeBot
 * Powered by Node.js 24 (agy-node) and node:sqlite
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const db = require('./src/db');
const { getSetting, setSetting, getAllSettingsSafe } = require('./src/config');
const { getNow, normalizeDate, normalizeTime, formatDateVN, addMinutesToTime, computeReminderDateTime, calculateDurationMinutes, formatDurationText, computeScheduleStatus } = require('./src/timeUtils');
const syncEvents = require('./src/syncEvents');
const { startScheduler } = require('./src/scheduler');
const { startTelegramBot, sendTestMessage, getBotInfo } = require('./src/telegramBot');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// MIME types map
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml'
};

/**
 * Helper to parse JSON request body
 */
function parseJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            if (!body) return resolve({});
            try {
                resolve(JSON.parse(body));
            } catch (err) {
                reject(new Error('Invalid JSON payload'));
            }
        });
        req.on('error', reject);
    });
}

/**
 * Main HTTP Server Request Listener
 */
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const method = req.method.toUpperCase();

    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // ----------------------------------------------------
    // REST API ENDPOINTS
    // ----------------------------------------------------

    // 1. GET /api/schedules
    if (pathname === '/api/schedules' && method === 'GET') {
        const dateFilter = parsedUrl.query.date;
        const nowInfo = getNow();

        let query = 'SELECT * FROM schedules WHERE 1=1';
        const params = [];

        if (dateFilter) {
            query += ' AND date = ?';
            params.push(dateFilter);
        }

        query += ' ORDER BY date ASC, startTime ASC';

        try {
            const rows = db.prepare(query).all(...params);
            
            // Dynamically calculate dynamic status for each schedule
            const updatedRows = rows.map(r => {
                const computed = computeScheduleStatus(r, nowInfo);
                return {
                    ...r,
                    status: computed,
                    completed: r.completed === 1 || computed === 'completed'
                };
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(updatedRows));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // 2. POST /api/schedules
    if (pathname === '/api/schedules' && method === 'POST') {
        try {
            const body = await parseJsonBody(req);
            const title = (body.title || '').trim();
            const date = normalizeDate(body.date) || getNow().dateStr;
            const startTime = normalizeTime(body.startTime);
            let endTime = normalizeTime(body.endTime);
            const reminderMinutes = parseInt(body.reminderMinutes, 10) || 15;
            const source = body.source || 'web';

            if (!title) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Title is required' }));
                return;
            }

            if (!startTime) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Start time is required (HH:mm)' }));
                return;
            }

            if (!endTime) {
                const endObj = addMinutesToTime(date, startTime, 60);
                endTime = endObj ? endObj.time : startTime;
            }

            const duration = calculateDurationMinutes(startTime, endTime);
            const reminderTime = computeReminderDateTime(date, startTime, reminderMinutes);
            const nowIso = new Date().toISOString();

            const stmt = db.prepare(`
                INSERT INTO schedules (userId, title, date, startTime, endTime, duration, reminderMinutes, reminderTime, status, completed, source, createdAt, updatedAt)
                VALUES ('default_user', ?, ?, ?, ?, ?, ?, ?, 'upcoming', 0, ?, ?, ?)
            `);
            const result = stmt.run(title, date, startTime, endTime, duration, reminderMinutes, reminderTime, source, nowIso, nowIso);
            const insertedId = result.lastInsertRowid;

            const inserted = db.prepare('SELECT * FROM schedules WHERE id = ?').get(insertedId);

            // Trigger SSE Broadcast
            syncEvents.broadcast('schedule_change', { action: 'create', id: insertedId });

            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(inserted));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // 3. PATCH /api/schedules/:id
    if (pathname.startsWith('/api/schedules/') && method === 'PATCH') {
        const id = parseInt(pathname.replace('/api/schedules/', ''), 10);
        if (isNaN(id)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid schedule ID' }));
            return;
        }

        try {
            const body = await parseJsonBody(req);
            const existing = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id);
            if (!existing) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Schedule not found' }));
                return;
            }

            const title = body.title !== undefined ? body.title : existing.title;
            const date = body.date !== undefined ? (normalizeDate(body.date) || existing.date) : existing.date;
            const startTime = body.startTime !== undefined ? (normalizeTime(body.startTime) || existing.startTime) : existing.startTime;
            const endTime = body.endTime !== undefined ? (normalizeTime(body.endTime) || existing.endTime) : existing.endTime;
            const reminderMinutes = body.reminderMinutes !== undefined ? parseInt(body.reminderMinutes, 10) : existing.reminderMinutes;
            
            let completed = existing.completed;
            let status = existing.status;

            if (body.completed !== undefined) {
                completed = body.completed ? 1 : 0;
                if (completed) status = 'completed';
            }

            if (body.status !== undefined) {
                status = body.status;
                if (status === 'completed') completed = 1;
            }

            const duration = calculateDurationMinutes(startTime, endTime);
            const reminderTime = computeReminderDateTime(date, startTime, reminderMinutes);
            const nowIso = new Date().toISOString();

            db.prepare(`
                UPDATE schedules 
                SET title = ?, date = ?, startTime = ?, endTime = ?, duration = ?, reminderMinutes = ?, reminderTime = ?, status = ?, completed = ?, updatedAt = ?
                WHERE id = ?
            `).run(title, date, startTime, endTime, duration, reminderMinutes, reminderTime, status, completed, nowIso, id);

            const updated = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id);

            // Trigger SSE Broadcast
            syncEvents.broadcast('schedule_change', { action: 'update', id });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(updated));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // 4. DELETE /api/schedules/:id
    if (pathname.startsWith('/api/schedules/') && method === 'DELETE') {
        const id = parseInt(pathname.replace('/api/schedules/', ''), 10);
        if (isNaN(id)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid schedule ID' }));
            return;
        }

        try {
            db.prepare('DELETE FROM schedules WHERE id = ?').run(id);

            // Trigger SSE Broadcast
            syncEvents.broadcast('schedule_change', { action: 'delete', id });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, id }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // 5. GET /api/stats
    if (pathname === '/api/stats' && method === 'GET') {
        try {
            const totalRow = db.prepare('SELECT COUNT(*) as count FROM schedules').get();
            const compRow = db.prepare("SELECT COUNT(*) as count FROM schedules WHERE completed = 1 OR status = 'completed'").get();
            const durRow = db.prepare("SELECT SUM(duration) as totalMins FROM schedules WHERE status != 'cancelled'").get();

            const totalCount = totalRow ? totalRow.count : 0;
            const completedCount = compRow ? compRow.count : 0;
            const totalMins = durRow && durRow.totalMins ? durRow.totalMins : 0;

            const h = Math.floor(totalMins / 60);
            const m = totalMins % 60;
            const durationText = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                totalCount,
                completedCount,
                totalMinutes: totalMins,
                durationText
            }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // 6. GET /api/settings
    if (pathname === '/api/settings' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getAllSettingsSafe()));
        return;
    }

    // 7. POST /api/settings
    if (pathname === '/api/settings' && method === 'POST') {
        try {
            const body = await parseJsonBody(req);
            if (body.aiProvider !== undefined) setSetting('ai_provider', body.aiProvider);
            if (body.aiModel !== undefined) setSetting('ai_model', body.aiModel);
            if (body.aiApiKey !== undefined) setSetting('ai_api_key', body.aiApiKey);
            if (body.telegramBotToken !== undefined) {
                setSetting('telegram_bot_token', body.telegramBotToken);
                // Restart Telegram bot polling with new token
                startTelegramBot();
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, settings: getAllSettingsSafe() }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // 8. POST /api/telegram/test
    if (pathname === '/api/telegram/test' && method === 'POST') {
        const result = await sendTestMessage();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
    }

    // 8b. GET /api/telegram/info
    if (pathname === '/api/telegram/info' && method === 'GET') {
        const result = await getBotInfo();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
    }

    // 9. GET /api/events (Server-Sent Events)
    if (pathname === '/api/events' && method === 'GET') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        res.write('event: connected\ndata: {"status":"ok"}\n\n');
        syncEvents.addClient(res);
        return;
    }

    // ----------------------------------------------------
    // STATIC FILE SERVING
    // ----------------------------------------------------
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    const ext = path.extname(filePath).toLowerCase();

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                // Return index.html for SPA routing fallback
                fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, htmlContent) => {
                    if (err2) {
                        res.writeHead(404, { 'Content-Type': 'text/plain' });
                        res.end('404 Not Found');
                    } else {
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(htmlContent);
                    }
                });
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(`Server Error: ${err.code}`);
            }
        } else {
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

// Start Server & Background Workers
server.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(`🚀 TimeBot Server is running on http://localhost:${PORT}`);
    console.log(`=================================================`);
    
    // Start Background Scheduler worker
    startScheduler();

    // Start Telegram Bot polling
    startTelegramBot();
});
