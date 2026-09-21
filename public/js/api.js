/**
 * API Client & Real-time Event Listener for TimeBot
 */

const API_BASE = '/api';

class TimeBotAPI {
    static async fetchSchedules(filters = {}) {
        const queryParams = new URLSearchParams(filters).toString();
        const res = await fetch(`${API_BASE}/schedules?${queryParams}`);
        if (!res.ok) throw new Error('Failed to fetch schedules');
        return await res.json();
    }

    static async fetchStats() {
        const res = await fetch(`${API_BASE}/stats`);
        if (!res.ok) throw new Error('Failed to fetch stats');
        return await res.json();
    }

    static async createSchedule(data) {
        const res = await fetch(`${API_BASE}/schedules`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to create schedule');
        }
        return await res.json();
    }

    static async updateSchedule(id, updates) {
        const res = await fetch(`${API_BASE}/schedules/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        if (!res.ok) throw new Error('Failed to update schedule');
        return await res.json();
    }

    static async deleteSchedule(id) {
        const res = await fetch(`${API_BASE}/schedules/${id}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error('Failed to delete schedule');
        return await res.json();
    }

    static async fetchSettings() {
        const res = await fetch(`${API_BASE}/settings`);
        if (!res.ok) throw new Error('Failed to fetch settings');
        return await res.json();
    }

    static async saveSettings(settings) {
        const res = await fetch(`${API_BASE}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        if (!res.ok) throw new Error('Failed to save settings');
        return await res.json();
    }

    static async testTelegram() {
        const res = await fetch(`${API_BASE}/telegram/test`, { method: 'POST' });
        return await res.json();
    }

    static async fetchTelegramInfo() {
        const res = await fetch(`${API_BASE}/telegram/info`);
        return await res.json();
    }

    /**
     * Subscribe to Realtime Server-Sent Events (SSE)
     */
    static subscribeRealtime(onEvent) {
        const evtSource = new EventSource(`${API_BASE}/events`);
        
        evtSource.addEventListener('schedule_change', (e) => {
            const data = JSON.parse(e.data);
            onEvent('schedule_change', data);
        });

        evtSource.addEventListener('schedule_status_change', (e) => {
            const data = JSON.parse(e.data);
            onEvent('schedule_status_change', data);
        });

        evtSource.onopen = () => {
            document.getElementById('sync-status').classList.remove('error');
        };

        evtSource.onerror = () => {
            document.getElementById('sync-status').classList.add('error');
        };

        return evtSource;
    }
}
