/**
 * Teltonika Telematics Suite - Main Application Entrypoint
 * Boots up the TCP Server (Port 5023), HTTP REST API & Web Dashboard (Port 3001),
 * and Real-Time WebSocket Broadcaster.
 */

const http = require('http');
const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const Database = require('./database/db');
const TeltonikaTcpServer = require('./tcp/server');
const TelematicsWebSocketServer = require('./api/websocket');
const apiRoutes = require('./api/routes');

async function bootstrap() {
  console.log('====================================================');
  console.log('  🛰️  TELTONIKA GPS & CAN TELEMATICS SUITE (FMX150)  ');
  console.log('====================================================\n');

  // 1. Initialize Database & Persistence
  Database.init();

  // 2. Initialize Express & HTTP Server
  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Serve Frontend Static Web App
  const publicDir = path.join(__dirname, '../public');
  app.use(express.static(publicDir));

  const httpServer = http.createServer(app);

  // 3. Initialize WebSocket Broadcaster
  const wsBroadcaster = new TelematicsWebSocketServer(httpServer);

  // 4. Initialize TCP Server for GPS Trackers
  const tcpServer = new TeltonikaTcpServer({ port: config.tcpPort });
  tcpServer.setBroadcaster(wsBroadcaster);

  // 5. Mount REST API Routes
  app.use('/api', apiRoutes(tcpServer, wsBroadcaster));

  // Fallback for SPA routing
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  // 6. Start TCP Server & HTTP Server
  try {
    await tcpServer.start();
    
    httpServer.listen(config.httpPort, () => {
      console.log(`[HTTP Server] 🌐 Dashboard & REST API listening on port ${config.httpPort}`);
      console.log(`[Dashboard]   👉 Open in browser: http://localhost:${config.httpPort}`);
      console.log(`[TCP Server]  👉 Teltonika Device Host:Port => <YOUR_VPS_IP>:${config.tcpPort}\n`);
    });
  } catch (err) {
    console.error('Fatal startup error:', err);
    process.exit(1);
  }

  // Graceful Shutdown
  const shutdown = () => {
    console.log('\n[App] Gracefully shutting down...');
    httpServer.close();
    if (tcpServer.server) tcpServer.server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap();
