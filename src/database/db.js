/**
 * Embedded Database Manager for Teltonika Telematics Suite
 * Lightweight, fast, JSON-file-backed persistent storage with full query helper methods.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { generateLinearPoints, TANK_PRESETS } = require('../engine/calibration');

const DATA_DIR = path.dirname(config.sqliteDbPath);
const DB_FILE = path.join(DATA_DIR, 'telematics_store.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-Memory Database State
const db = {
  devices: new Map(),
  positions: [],
  alerts: [],
  commandLogs: []
};

// Maximum historical records to retain in memory/file (e.g. last 10,000 positions)
const MAX_HISTORY = 10000;

// Clean initial load without hardcoded demo vehicles
function loadFromFile() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.devices) {
        db.devices = new Map(Object.entries(parsed.devices));
      }
      db.positions = parsed.positions || [];
      db.alerts = parsed.alerts || [];
      db.commandLogs = parsed.commandLogs || [];
    }
  } catch (err) {
    console.error('[DB] Error reading persistence file, initializing fresh:', err.message);
  }
}

// Save to Disk (debounced)
let saveTimeout = null;
function saveToFile() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      const serialized = {
        devices: Object.fromEntries(db.devices),
        positions: db.positions.slice(-MAX_HISTORY),
        alerts: db.alerts.slice(-1000),
        commandLogs: db.commandLogs.slice(-500)
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(serialized, null, 2), 'utf-8');
    } catch (err) {
      console.error('[DB] Error saving to disk:', err.message);
    }
  }, 1000);
}

// Public API
const Database = {
  init() {
    loadFromFile();
    console.log(`[DB] Database ready. Active devices: ${db.devices.size}`);
  },

  getDevice(imei) {
    return db.devices.get(imei) || null;
  },

  getAllDevices() {
    return Array.from(db.devices.values());
  },

  upsertDevice(deviceData) {
    const existing = db.devices.get(deviceData.imei) || {};
    const updated = {
      ...existing,
      ...deviceData,
      lastUpdated: new Date().toISOString()
    };
    db.devices.set(deviceData.imei, updated);
    saveToFile();
    return updated;
  },

  saveTelemetry(imei, record, calculatedLiters) {
    let device = db.devices.get(imei);
    if (!device) {
      // Auto-register unknown device
      device = {
        imei,
        vehicleNumber: `VEH-${imei.slice(-4)}`,
        model: 'Teltonika Tracker',
        category: 'Vehicle',
        tankCapacity: 480,
        fuelSource: 'CAN_PERCENT',
        calibrationPoints: generateLinearPoints(480, 4),
        status: 'ONLINE',
        lastUpdated: new Date().toISOString()
      };
      db.devices.set(imei, device);
    }

    const rawTel = record.telemetry || {};
    const telemetry = {
      ...rawTel,
      lat: record.gps.latitude,
      lng: record.gps.longitude,
      altitude: record.gps.altitude,
      angle: record.gps.angle,
      speed: record.gps.speed,
      satellites: record.gps.satellites,
      isValid: record.gps.isValid,
      ignition: rawTel.ignition !== undefined 
        ? Boolean(rawTel.ignition) 
        : (rawTel.DIN1 !== undefined 
            ? Boolean(rawTel.DIN1) 
            : (record.gps.speed > 0)),
      fuelPercentage: rawTel.fuelLevelPercentage !== undefined ? rawTel.fuelLevelPercentage : (rawTel.fuelLevel !== undefined ? rawTel.fuelLevel : 0),
      fuelLiters: calculatedLiters,
      engineRpm: rawTel.engineRpm || 0,
      engineLoad: rawTel.engineLoad || 0,
      engineHours: rawTel.engineHours || 0,
      oilPressure: rawTel.oilPressure || 0,
      engineOilTemp: rawTel.engineOilTemp || 0,
      acceleratorPedal: rawTel.acceleratorPedal || 0,
      currentGear: rawTel.currentGear !== undefined ? rawTel.currentGear : 0,
      fuelRate: rawTel.fuelRate || 0,
      totalFuelConsumed: rawTel.totalFuelConsumed || 0,
      cngRate: rawTel.cngRate || 0,
      totalCngUsed: rawTel.totalCngUsed || 0,
      evBatterySoc: rawTel.evBatterySoc !== undefined ? rawTel.evBatterySoc : null,
      evBatteryVoltage: rawTel.evBatteryVoltage !== undefined ? rawTel.evBatteryVoltage : null,
      evBatteryCurrent: rawTel.evBatteryCurrent !== undefined ? rawTel.evBatteryCurrent : null,
      evMotorTemp: rawTel.evMotorTemp !== undefined ? rawTel.evMotorTemp : null,
      evRangeKm: rawTel.evRangeKm !== undefined ? rawTel.evRangeKm : null,
      axleWeight1: rawTel.axleWeight1 !== undefined ? rawTel.axleWeight1 : null,
      axleWeight2: rawTel.axleWeight2 !== undefined ? rawTel.axleWeight2 : null,
      axleWeight3: rawTel.axleWeight3 !== undefined ? rawTel.axleWeight3 : null,
      airSuspensionPressure: rawTel.airSuspensionPressure !== undefined ? rawTel.airSuspensionPressure : null,
      acStatus: Boolean(rawTel.acStatus),
      handbrake: Boolean(rawTel.handbrake),
      footBrake: Boolean(rawTel.footBrake),
      clutch: Boolean(rawTel.clutch),
      cruiseControl: Boolean(rawTel.cruiseControl),
      doorMask: rawTel.doorStatusMask || 0,
      seatbeltMask: rawTel.seatbeltMask || 0,
      lightsMask: rawTel.lightsMask || 0,
      dtcCount: rawTel.dtcCount || 0,
      nextServiceDistance: rawTel.nextServiceDistance !== undefined ? rawTel.nextServiceDistance : null,
      vinChassis: rawTel.vinChassis || null,
      externalVoltage: rawTel.externalVoltage || 0,
      batteryVoltage: rawTel.batteryVoltage || rawTel.externalVoltage || 0,
      gsmSignal: rawTel.gsmSignal || 0,
      odometerKm: rawTel.odometer || 0,
      tripOdometerKm: rawTel.tripOdometer || 0,
      coolantTemp: rawTel.coolantTemp || 0,
      adBlueLevel: rawTel.adBlueLevel !== undefined ? rawTel.adBlueLevel : null,
      rawIos: record.rawIos
    };

    // Update Device State
    device.status = 'ONLINE';
    device.lastUpdated = new Date().toISOString();
    device.lastTelemetry = telemetry;
    db.devices.set(imei, device);

    // Append to Position History
    const historyItem = {
      imei,
      timestamp: record.timestamp ? record.timestamp.toISOString() : new Date().toISOString(),
      ...telemetry
    };
    db.positions.push(historyItem);
    if (db.positions.length > MAX_HISTORY) db.positions.shift();

    saveToFile();
    return historyItem;
  },

  deleteDevice(imei) {
    const deleted = db.devices.delete(imei);
    db.positions = db.positions.filter(p => p.imei !== imei);
    saveToFile();
    return deleted;
  },

  getHistory(imei, limit = 500) {
    return db.positions
      .filter(p => p.imei === imei)
      .slice(-limit);
  },

  saveAlert(alert) {
    const alertRecord = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      createdAt: new Date().toISOString(),
      ...alert
    };
    db.alerts.unshift(alertRecord);
    if (db.alerts.length > 1000) db.alerts.pop();
    saveToFile();
    return alertRecord;
  },

  getAlerts(limit = 100) {
    return db.alerts.slice(0, limit);
  },

  saveCommandLog(log) {
    const record = {
      id: Date.now().toString(36),
      timestamp: new Date().toISOString(),
      ...log
    };
    db.commandLogs.unshift(record);
    if (db.commandLogs.length > 500) db.commandLogs.pop();
    saveToFile();
    return record;
  },

  getCommandLogs(imei = null) {
    if (imei) {
      return db.commandLogs.filter(c => c.imei === imei);
    }
    return db.commandLogs;
  }
};

module.exports = Database;
