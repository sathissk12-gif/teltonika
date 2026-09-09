/**
 * Realistic Trip Simulator CLI
 * Simulates a Teltonika FMX150 tracker sending real TCP packets to the telematics server.
 */

const net = require('net');
const { buildHandshakePacket, buildCodec8ExtPacket } = require('./packetGenerator');
const config = require('../config');

const SIMULATED_IMEI = process.argv[2] || '864032059281726';
const PORT = config.tcpPort;
const HOST = '127.0.0.1';

console.log(`[Simulator] 🚚 Starting vehicle simulation for IMEI: ${SIMULATED_IMEI}`);
console.log(`[Simulator] Connecting to TCP Server at ${HOST}:${PORT}...`);

// Tamil Nadu Highway Waypoints (Chennai to Salem NH48/NH44 route)
const WAYPOINTS = [
  { lat: 13.0827, lng: 80.2707, speed: 0, rpm: 800, fuelPct: 80.0, ignition: true, name: 'Chennai Central' },
  { lat: 13.0458, lng: 80.1985, speed: 35, rpm: 1400, fuelPct: 79.8, ignition: true, name: 'Koyambedu Toll' },
  { lat: 12.9810, lng: 80.0520, speed: 65, rpm: 1850, fuelPct: 79.2, ignition: true, name: 'Sriperumbudur' },
  { lat: 12.8342, lng: 79.7036, speed: 72, rpm: 1950, fuelPct: 78.5, ignition: true, name: 'Kanchipuram Bypass' },
  { lat: 12.9165, lng: 79.1325, speed: 68, rpm: 1800, fuelPct: 77.8, ignition: true, name: 'Vellore' },
  { lat: 12.5200, lng: 78.5700, speed: 75, rpm: 2000, fuelPct: 76.9, ignition: true, name: 'Ambur' },
  { lat: 12.1900, lng: 78.2200, speed: 70, rpm: 1900, fuelPct: 75.8, ignition: true, name: 'Dharmapuri' },
  { lat: 11.6643, lng: 78.1460, speed: 50, rpm: 1550, fuelPct: 74.5, ignition: true, name: 'Salem Outer' },
  { lat: 11.6500, lng: 78.1600, speed: 0, rpm: 0, fuelPct: 74.2, ignition: false, name: 'Salem Logistics Hub' }
];

const client = new net.Socket();
let step = 0;
let isHandshakeComplete = false;
let odometer = 142580.0;

client.connect(PORT, HOST, () => {
  console.log(`[Simulator] 🔌 Connected to server! Sending Handshake (IMEI)...`);
  const handshakeBuf = buildHandshakePacket(SIMULATED_IMEI);
  client.write(handshakeBuf);
});

client.on('data', (data) => {
  if (!isHandshakeComplete) {
    if (data.length >= 1 && data[0] === 0x01) {
      console.log(`[Simulator] ✅ Handshake accepted by server (0x01 ACK)! Starting GPS stream...\n`);
      isHandshakeComplete = true;
      sendNextWaypoint();
    } else {
      console.error(`[Simulator] ❌ Handshake rejected by server!`, data);
      client.destroy();
    }
    return;
  }

  // Handle ACK response for data packets
  if (data.length >= 4) {
    const acceptedRecords = data.readUInt32BE(0);
    console.log(`[Simulator] 📥 Server acknowledged ${acceptedRecords} record(s).`);
  }
});

function sendNextWaypoint() {
  if (step >= WAYPOINTS.length) {
    console.log(`\n[Simulator] 🎉 Completed full trip simulation (${WAYPOINTS.length} points sent).`);
    console.log(`[Simulator] Keeping connection alive for 15s to test commands...`);
    setTimeout(() => {
      client.destroy();
      console.log(`[Simulator] Disconnected.`);
      process.exit(0);
    }, 15000);
    return;
  }

  const wp = WAYPOINTS[step];
  odometer += (wp.speed * (5 / 3600)); // calculate distance added in 5s

  console.log(`[Simulator] 📍 Point [${step + 1}/${WAYPOINTS.length}]: ${wp.name} | Lat: ${wp.lat}, Lng: ${wp.lng} | Speed: ${wp.speed} km/h | Fuel: ${wp.fuelPct}% | RPM: ${wp.rpm}`);

  const packet = buildCodec8ExtPacket({
    lat: wp.lat,
    lng: wp.lng,
    speed: wp.speed,
    angle: 180,
    engineRpm: wp.rpm,
    fuelPercentage: wp.fuelPct,
    ignition: wp.ignition,
    coolantTemp: wp.ignition ? 88 : 40,
    odometerKm: parseFloat(odometer.toFixed(2)),
    batteryVoltage: 24.2,
    adBlueLevel: 86
  });

  client.write(packet);
  step++;

  // Send next waypoint every 3 seconds
  setTimeout(sendNextWaypoint, 3000);
}

client.on('close', () => {
  console.log('[Simulator] Connection closed.');
});

client.on('error', (err) => {
  console.error('[Simulator] Connection error:', err.message);
});
