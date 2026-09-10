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
  commandLogs: [],
  trips: []
};

// Maximum historical records to retain in memory/file (e.g. last 10,000 positions)
const MAX_HISTORY = 10000;

// Debounced Disk Persistence Queue
let saveTimer = null;
function triggerDebouncedSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveToFile();
  }, 1000);
}

// Normalize and re-evaluate telemetry from raw IOs
function normalizeTelemetry(rawTel = {}, rawIos = {}, calculatedLiters = null, mileageMetrics = {}, gps = {}) {
  const ios = rawIos || {};
  
  // Resolve Engine RPM (CAN IO 85 / OBD IO 32)
  let engineRpm = rawTel.engineRpm;
  if (engineRpm === undefined || engineRpm === null || engineRpm === 0) {
    if (ios[85] !== undefined) engineRpm = Number(ios[85]);
    else if (ios[32] !== undefined) engineRpm = Number(ios[32]);
    else engineRpm = 0;
  }

  // Resolve Coolant Temperature (CAN IO 86 / OBD IO 36)
  let coolantTemp = rawTel.coolantTemp;
  if (coolantTemp === undefined || coolantTemp === null || coolantTemp === 0) {
    if (ios[86] !== undefined) coolantTemp = parseFloat((Number(ios[86]) * 0.1).toFixed(1));
    else if (ios[36] !== undefined) coolantTemp = Number(ios[36]);
    else coolantTemp = 0;
  }

  // Resolve Direct CAN Liters (IO 84)
  let fuelLevelLiters = rawTel.fuelLevelLiters;
  if (fuelLevelLiters === undefined || fuelLevelLiters === null) {
    if (ios[84] !== undefined) fuelLevelLiters = parseFloat((Number(ios[84]) * 0.1).toFixed(1));
  }

  // Resolve Fuel Liters (Calibrated or Direct CAN)
  let fuelLiters = calculatedLiters || rawTel.fuelLiters;
  if (!fuelLiters && fuelLevelLiters) fuelLiters = fuelLevelLiters;

  // Resolve Total CAN Mileage (IO 87)
  let totalMileageCan = rawTel.totalMileageCan;
  if (totalMileageCan === undefined || totalMileageCan === null) {
    if (ios[87] !== undefined) totalMileageCan = parseFloat((Number(ios[87]) * 0.001).toFixed(1));
  }

  // Resolve Vehicle Range (IO 866)
  let vehicleRange = rawTel.vehicleRange;
  if (vehicleRange === undefined || vehicleRange === null) {
    if (ios[866] !== undefined) vehicleRange = Number(ios[866]);
  }

  // Resolve External Voltage (IO 66)
  let externalVoltage = rawTel.externalVoltage;
  if (!externalVoltage && ios[66] !== undefined) {
    externalVoltage = parseFloat((Number(ios[66]) * 0.001).toFixed(2));
  }

  // Resolve Internal Battery Voltage (IO 67)
  let batteryVoltage = rawTel.batteryVoltage;
  if (!batteryVoltage && ios[67] !== undefined) {
    batteryVoltage = parseFloat((Number(ios[67]) * 0.001).toFixed(2));
  }

  // Resolve Ignition (IO 239 / IO 1)
  let ignition = rawTel.ignition;
  if (ignition === undefined) {
    if (ios[239] !== undefined) ignition = Number(ios[239]) === 1;
    else if (ios[1] !== undefined) ignition = Number(ios[1]) === 1;
    else if (rawTel.DIN1 !== undefined) ignition = Boolean(rawTel.DIN1);
    else ignition = (gps.speed > 0);
  }

  // Resolve GSM Signal (IO 21)
  let gsmSignal = rawTel.gsmSignal;
  if (!gsmSignal && ios[21] !== undefined) gsmSignal = Number(ios[21]);

  return {
    ...rawTel,
    ...mileageMetrics,
    lat: gps.latitude || rawTel.lat || 0,
    lng: gps.longitude || rawTel.lng || 0,
    altitude: gps.altitude || rawTel.altitude || 0,
    angle: gps.angle || rawTel.angle || 0,
    speed: gps.speed || rawTel.speed || 0,
    satellites: gps.satellites !== undefined ? gps.satellites : (rawTel.satellites || 0),
    isValid: gps.isValid !== undefined ? gps.isValid : Boolean(rawTel.isValid),
    ignition: Boolean(ignition),
    engineRpm: Number(engineRpm || 0),
    coolantTemp: Number(coolantTemp || 0),
    fuelPercentage: rawTel.fuelLevelPercentage !== undefined ? rawTel.fuelLevelPercentage : (rawTel.fuelLevel !== undefined ? rawTel.fuelLevel : (fuelLevelLiters ? Math.round((fuelLevelLiters / 50) * 100) : 0)),
    fuelLiters: fuelLiters,
    fuelLevelLiters: fuelLevelLiters,
    totalMileageCan: totalMileageCan,
    vehicleRange: vehicleRange || mileageMetrics.estimatedRangeKm || null,
    externalVoltage: externalVoltage || 0,
    batteryVoltage: batteryVoltage || 0,
    gsmSignal: gsmSignal || 0,
    instantMileage: mileageMetrics.instantMileageKmPerLiter || rawTel.instantMileage || 0,
    avgMileage: mileageMetrics.avgMileageKmPerLiter || rawTel.avgMileage || 0,
    tripDistance: mileageMetrics.tripDistanceKm || rawTel.tripDistance || 0,
    tripFuel: mileageMetrics.tripFuelConsumedLiters || rawTel.tripFuel || 0,
    costPerKm: mileageMetrics.costPerKm || rawTel.costPerKm || 0,
    fuelRateLitersPerHour: mileageMetrics.fuelRateLitersPerHour !== undefined ? mileageMetrics.fuelRateLitersPerHour : (rawTel.fuelRateLitersPerHour || 0),
    ecmTotalFuelConsumed: mileageMetrics.ecmTotalFuelConsumed !== undefined ? mileageMetrics.ecmTotalFuelConsumed : (ios[88] !== undefined ? parseFloat((Number(ios[88]) * 0.1).toFixed(2)) : (rawTel.ecmTotalFuelConsumed || null)),
    injectionState: mileageMetrics.injectionState || rawTel.injectionState || (Number(engineRpm) > 0 ? 'ACTIVE_INJECTION' : 'ENGINE_OFF'),
    acceleratorPedal: mileageMetrics.acceleratorPedal !== undefined ? mileageMetrics.acceleratorPedal : (ios[82] !== undefined ? Number(ios[82]) : (ios[35] !== undefined ? Number(ios[35]) : (rawTel.acceleratorPedal || 0))),
    engineLoad: mileageMetrics.engineLoad !== undefined ? mileageMetrics.engineLoad : (ios[31] !== undefined ? Number(ios[31]) : (rawTel.engineLoad || 0)),
    engineWorktimeCounted: ios[103] !== undefined ? Number(ios[103]) : (rawTel.engineWorktimeCounted || null),
    oilPressure: ios[115] !== undefined ? parseFloat((Number(ios[115]) * 0.1).toFixed(1)) : (rawTel.oilPressure || null),
    gnssPdop: ios[181] !== undefined ? parseFloat((Number(ios[181]) * 0.1).toFixed(1)) : null,
    gnssHdop: ios[182] !== undefined ? parseFloat((Number(ios[182]) * 0.1).toFixed(1)) : null,
    sleepMode: ios[200] !== undefined ? Number(ios[200]) : 0,
    lvcanAdapterId: ios[388] || rawTel.lvcanAdapterId || null,
    rawIos: ios
  };
}

// Clean initial load without hardcoded demo vehicles
function loadFromFile() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.devices) {
        db.devices = new Map(Object.entries(parsed.devices));
        // Auto-normalize lastTelemetry on load
        for (const [imei, dev] of db.devices) {
          if (dev.lastTelemetry) {
            dev.lastTelemetry = normalizeTelemetry(
              dev.lastTelemetry,
              dev.lastTelemetry.rawIos || {},
              dev.lastTelemetry.fuelLiters,
              {},
              {
                latitude: dev.lastTelemetry.lat,
                longitude: dev.lastTelemetry.lng,
                speed: dev.lastTelemetry.speed,
                satellites: dev.lastTelemetry.satellites,
                angle: dev.lastTelemetry.angle,
                altitude: dev.lastTelemetry.altitude,
                isValid: dev.lastTelemetry.isValid
              }
            );
          }
        }
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

  saveTelemetry(imei, record, calculatedLiters, mileageMetrics = {}) {
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
    const telemetry = normalizeTelemetry(rawTel, record.rawIos, calculatedLiters, mileageMetrics, record.gps || {});

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
    triggerDebouncedSave();
    return record;
  },

  getCommandLogs(imei = null) {
    if (imei) {
      return db.commandLogs.filter(c => c.imei === imei);
    }
    return db.commandLogs;
  },

  saveTrip(trip) {
    const tripRecord = {
      id: trip.tripId || `TRIP-${Date.now().toString(36).toUpperCase()}`,
      createdAt: new Date().toISOString(),
      ...trip
    };
    db.trips.unshift(tripRecord);
    if (db.trips.length > 1000) db.trips.pop();
    triggerDebouncedSave();
    return tripRecord;
  },

  getTrips(imei = null, limit = 50) {
    if (imei) {
      return db.trips.filter(t => t.imei === imei).slice(0, limit);
    }
    return db.trips.slice(0, limit);
  },

  getFleetAnalytics() {
    const devices = Array.from(db.devices.values());
    let totalKm = 0;
    let totalFuelLiters = 0;
    let onlineCount = 0;
    let movingCount = 0;
    let idleCount = 0;

    devices.forEach(d => {
      if (d.status === 'ONLINE') onlineCount++;
      const tel = d.lastTelemetry || {};
      if (tel.speed > 0) movingCount++;
      else if (tel.ignition) idleCount++;

      if (tel.totalMileageCan) totalKm += tel.totalMileageCan;
      else if (tel.odometer) totalKm += tel.odometer;

      if (tel.tripFuel) totalFuelLiters += tel.tripFuel;
    });

    return {
      totalVehicles: devices.length,
      onlineVehicles: onlineCount,
      movingVehicles: movingCount,
      idleVehicles: idleCount,
      parkedVehicles: Math.max(0, onlineCount - movingCount - idleCount),
      totalFleetOdometerKm: parseFloat(totalKm.toFixed(1)),
      totalFuelConsumedLiters: parseFloat(totalFuelLiters.toFixed(2)),
      totalTripsCompleted: db.trips.length,
      totalAlerts: db.alerts.length
    };
  }
};

module.exports = Database;
