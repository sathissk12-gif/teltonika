const WebSocket = require('ws');
const Database = require('../database/db');

class TelematicsWebSocketServer {
  constructor(server) {
    this.wss = new WebSocket.Server({ server, path: '/ws' });
    this.clients = new Set();
    this.init();
    this.startHeartbeat();
  }

  init() {
    this.wss.on('connection', (ws, req) => {
      ws.isAlive = true;
      this.clients.add(ws);
      console.log(`[WebSocket] 🖥️ Dashboard client connected (Total: ${this.clients.size})`);

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      // Send initial welcome message and fleet snapshot
      const devices = Database.getAllDevices();
      ws.send(JSON.stringify({
        event: 'connected',
        data: {
          message: 'Connected to Teltonika Live Telematics Stream',
          time: new Date().toISOString(),
          activeDevices: devices.length,
          devices
        }
      }));

      ws.on('message', (message) => {
        try {
          const parsed = JSON.parse(message);
          if (parsed.action === 'ping') {
            ws.send(JSON.stringify({ event: 'pong', time: Date.now() }));
          }
        } catch (e) {}
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log(`[WebSocket] Dashboard client disconnected (Total: ${this.clients.size})`);
      });

      ws.on('error', (err) => {
        console.warn('[WebSocket] Client error:', err.message);
      });
    });
  }

  startHeartbeat() {
    setInterval(() => {
      for (const ws of this.clients) {
        if (!ws.isAlive) {
          this.clients.delete(ws);
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }, 25000);
  }

  broadcast(event, data) {
    const payload = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }
}

module.exports = TelematicsWebSocketServer;

