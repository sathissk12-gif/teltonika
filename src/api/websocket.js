/**
 * WebSocket Real-time Broadcaster for Live Telematics Dashboard
 */

const WebSocket = require('ws');

class TelematicsWebSocketServer {
  constructor(server) {
    this.wss = new WebSocket.Server({ server, path: '/ws' });
    this.clients = new Set();
    this.init();
  }

  init() {
    this.wss.on('connection', (ws, req) => {
      this.clients.add(ws);
      console.log(`[WebSocket] 🖥️ Dashboard client connected (Total: ${this.clients.size})`);

      // Send initial welcome message
      ws.send(JSON.stringify({
        event: 'connected',
        data: { message: 'Connected to Teltonika Live Telematics Stream', time: new Date().toISOString() }
      }));

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log(`[WebSocket] Dashboard client disconnected (Total: ${this.clients.size})`);
      });

      ws.on('error', (err) => {
        console.warn('[WebSocket] Client error:', err.message);
      });
    });
  }

  broadcast(event, data) {
    const payload = JSON.stringify({ event, data });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }
}

module.exports = TelematicsWebSocketServer;
