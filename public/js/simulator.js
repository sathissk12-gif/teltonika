/**
 * Built-In Device Simulator & Packet Inspector
 */

let simulationInterval = null;
let simStep = 0;

const TN_ROUTE = [
  { lat: 13.0827, lng: 80.2707, speed: 0, rpm: 800, fuelPct: 80.0, ign: true, name: 'Chennai Port Container Terminal' },
  { lat: 13.0458, lng: 80.1985, speed: 42, rpm: 1450, fuelPct: 79.8, ign: true, name: 'Maduravoyal Flyover' },
  { lat: 12.9810, lng: 80.0520, speed: 68, rpm: 1850, fuelPct: 79.2, ign: true, name: 'Sriperumbudur Industrial Corridor' },
  { lat: 12.8342, lng: 79.7036, speed: 74, rpm: 1980, fuelPct: 78.4, ign: true, name: 'Kanchipuram Toll Plaza' },
  { lat: 12.9165, lng: 79.1325, speed: 70, rpm: 1900, fuelPct: 77.6, ign: true, name: 'Vellore Bypass' },
  { lat: 12.5200, lng: 78.5700, speed: 78, rpm: 2050, fuelPct: 76.5, ign: true, name: 'Ambur Highway' },
  { lat: 12.1900, lng: 78.2200, speed: 72, rpm: 1920, fuelPct: 75.3, ign: true, name: 'Dharmapuri Thoppur Ghat' },
  { lat: 11.6643, lng: 78.1460, speed: 45, rpm: 1400, fuelPct: 74.0, ign: true, name: 'Salem Logistics Hub' }
];

function toggleSimulation(imei) {
  const btn = document.getElementById('btnSimulateTrip');
  if (simulationInterval) {
    clearInterval(simulationInterval);
    simulationInterval = null;
    if (btn) {
      btn.innerHTML = '▶️ Start Live Highway Trip Simulation';
      btn.className = 'btn-primary';
    }
    logTerminal(`[Simulator] ⏹️ Simulation paused.`);
  } else {
    simStep = 0;
    if (btn) {
      btn.innerHTML = '⏸️ Stop Live Simulation';
      btn.className = 'btn-secondary';
    }
    logTerminal(`[Simulator] 🚀 Starting simulated highway trip from Chennai to Salem for IMEI: ${imei}...`);
    sendSimulatedPoint(imei);
    simulationInterval = setInterval(() => sendSimulatedPoint(imei), 3500);
  }
}

function sendSimulatedPoint(imei) {
  if (simStep >= TN_ROUTE.length) {
    simStep = 0; // loop
  }

  const point = TN_ROUTE[simStep];
  simStep++;

  fetch('/api/simulator/inject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imei,
      lat: point.lat,
      lng: point.lng,
      speed: point.speed,
      rpm: point.rpm,
      fuelPercentage: point.fuelPct,
      ignition: point.ign,
      coolantTemp: 86,
      odometer: 142580 + (simStep * 12)
    })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      logTerminal(`[Packet Injected] 📍 ${point.name} | Lat: ${point.lat}, Lng: ${point.lng} | Speed: ${point.speed} km/h | Fuel: ${point.fuelPct}%`);
      updateHexInspector(point);
    }
  })
  .catch(err => logTerminal(`[Simulator Error] ${err.message}`));
}

function triggerTheftSimulation(imei) {
  logTerminal(`[Theft Simulator] 🚨 Simulating illegal fuel siphoning (-20 Liters) with Ignition OFF...`);
  
  fetch('/api/simulator/inject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imei,
      lat: 11.6643,
      lng: 78.1460,
      speed: 0,
      rpm: 0,
      fuelPercentage: 62.0, // Sudden drop
      ignition: false,
      coolantTemp: 35
    })
  })
  .then(res => res.json())
  .then(data => {
    logTerminal(`[Theft Simulator] ✅ Injected sudden fuel drop packet. Check alert banner above!`);
  });
}

function updateHexInspector(point) {
  const hexElem = document.getElementById('hexInspector');
  if (!hexElem) return;

  // Render dummy Teltonika raw hex structure
  const rawHex = `00000000 0000004A 8E 01 0000018DF438C2A0 01 ` +
    `${Math.round(point.lng*10000000).toString(16).padStart(8,'0').toUpperCase()} ` +
    `${Math.round(point.lat*10000000).toString(16).padStart(8,'0').toUpperCase()} ` +
    `0116 00B4 0E ${point.speed.toString(16).padStart(4,'0').toUpperCase()} 0001 0007 ` +
    `0004 0053 ${Math.round(point.fuelPct).toString(16).padStart(2,'0').toUpperCase()} ` +
    `00EF ${point.ign ? '01' : '00'} 0024 56 0066 56 ` +
    `0002 0020 ${point.rpm.toString(16).padStart(4,'0').toUpperCase()} 0042 5E8A ` +
    `0001 0010 087E2C88 01 0000B42A`;

  hexElem.innerText = rawHex;
}

function logTerminal(msg, type = 'cmd') {
  const terminal = document.getElementById('commandTerminal');
  if (!terminal) return;

  const line = document.createElement('div');
  line.className = `terminal-line ${type}`;
  const time = new Date().toLocaleTimeString();
  line.innerText = `[${time}] ${msg}`;
  terminal.appendChild(line);
  terminal.scrollTop = terminal.scrollHeight;
}

window.SimulatorController = {
  toggleSimulation,
  triggerTheftSimulation,
  logTerminal
};
