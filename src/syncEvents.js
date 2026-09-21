/**
 * Real-time Sync & Event Broadcaster (SSE)
 */

const { EventEmitter } = require('events');

class SyncEvents extends EventEmitter {
    constructor() {
        super();
        this.clients = new Set();
    }

    addClient(res) {
        this.clients.add(res);
        res.on('close', () => {
            this.clients.delete(res);
        });
    }

    broadcast(type, data = {}) {
        const payload = JSON.stringify({ type, data, timestamp: Date.now() });
        const sseFormatted = `event: ${type}\ndata: ${payload}\n\n`;
        for (const client of this.clients) {
            try {
                client.write(sseFormatted);
            } catch (err) {
                this.clients.delete(client);
            }
        }
    }
}

const syncEvents = new SyncEvents();
module.exports = syncEvents;
