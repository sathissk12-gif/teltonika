/**
 * Enterprise Production-Grade SQLite Database Manager for Teltonika Telematics Suite
 * Powered by Node.js 24 Native C++ SQLite Engine (node:sqlite)
 * Features 3-Month (90-Day) High-Performance CAN Telemetry Time-Series Storage,
 * Multi-Index B-Trees, Automatic Data Retention Lifecycle, and Traxen Fleet Management.
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');
const { generateLinearPoints } = require('../engine/calibration');

const DATA_DIR = path.dirname(config.sqliteDbPath);
const DB_FILE = config.sqliteDbPath;
const LEGACY_JSON_FILE = path.join(DATA_DIR, 'telematics_store.json');
const RETENTION_DAYS = config.retentionDays || 90; // 3 Months Retention

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-Memory Fast-Access Cache for Low-Latency Lookup
const cache = {
  devices: new Map(),
  users: new Map(),
  licenses: new Map(),
  recentPositions: new Map(), // imei -> Array of last 50 points for instant UI feed
  alerts: [],
  commandLogs: [],
  trips: []
};

let sqliteDb = null;
let preparedStmts = {};
let cleanupInterval = null;

// Smart Transmission Gear Decoding & Virtual Gear Inference
function decodeTransmissionGear(rawGear, speed = 0, rpm = 0, ignition = false) {
  if (rawGear !== undefined && rawGear !== null) {
    const g = Number(rawGear);
    if (!isNaN(g)) {
      if (g === 0 || g === 125) return { currentGear: 0, gearLabel: 'N' };
      if (g === 251 || g === 124 || g === -1) return { currentGear: -1, gearLabel: 'R' };
      if (g === 252 || g === 126) return { currentGear: -2, gearLabel: 'P' };
      if (g === 253) return { currentGear: 100, gearLabel: 'D' };
      if (g >= 1 && g <= 16) return { currentGear: g, gearLabel: `${g}` };
      if (g >= 126 && g <= 140) {
        const fg = g - 125;
        return { currentGear: fg, gearLabel: `${fg}` };
      }
      return { currentGear: g, gearLabel: `Gear ${g}` };
    }
  }

  // Fallback: Smart Virtual Gear Calculation from Speed & Engine RPM
  if (!ignition || rpm < 350) return { currentGear: -2, gearLabel: 'P' };
  if (speed <= 2) return { currentGear: 0, gearLabel: 'N' };
  if (speed < 22) return { currentGear: 1, gearLabel: '1st' };
  if (speed < 42) return { currentGear: 2, gearLabel: '2nd' };
  if (speed < 62) return { currentGear: 3, gearLabel: '3rd' };
  if (speed < 85) return { currentGear: 4, gearLabel: '4th' };
  if (speed < 110) return { currentGear: 5, gearLabel: '5th' };
  return { currentGear: 6, gearLabel: '6th' };
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

  // Resolve Coolant Temperature (CAN IO 86 / CAN IO 115 / OBD IO 36)
  let coolantTemp = rawTel.coolantTemp;
  if (coolantTemp === undefined || coolantTemp === null || coolantTemp === 0) {
    if (ios[86] !== undefined) coolantTemp = parseFloat((Number(ios[86]) * 0.1).toFixed(1));
    else if (ios[115] !== undefined && Number(ios[115]) > 200 && Number(ios[115]) < 1500) coolantTemp = parseFloat((Number(ios[115]) * 0.1).toFixed(1));
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

  // Resolve Next Service Distance (IO 132)
  let nextServiceDistance = rawTel.nextServiceDistance;
  if (ios[132] !== undefined) {
    const raw132 = Number(ios[132]);
    if (!isNaN(raw132) && raw132 > 0 && raw132 < 500000) {
      nextServiceDistance = raw132;
    } else {
      nextServiceDistance = null;
    }
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

  // Resolve Ignition (Smart Multi-Source CAN & Hardware Arbitration)
  let ignition = false;
  if (Number(engineRpm) > 300) {
    ignition = true;
  } else if (ios[239] !== undefined) {
    ignition = Number(ios[239]) === 1;
  } else if (ios[1] !== undefined) {
    ignition = Number(ios[1]) === 1;
  } else if (rawTel.DIN1 !== undefined) {
    ignition = Boolean(rawTel.DIN1);
  } else if (externalVoltage >= 13.5) {
    ignition = true;
  } else {
    ignition = (gps.speed > 3);
  }

  // Resolve GSM Signal (IO 21)
  let gsmSignal = rawTel.gsmSignal;
  if (!gsmSignal && ios[21] !== undefined) gsmSignal = Number(ios[21]);

  // Resolve Transmission Gear (CAN IO 98 / OBD IO 163)
  const rawGear = rawTel.currentGear !== undefined ? rawTel.currentGear : (ios[98] !== undefined ? Number(ios[98]) : (ios[163] !== undefined ? Number(ios[163]) : null));
  const currentSpeed = gps.speed || rawTel.speed || 0;
  const { currentGear, gearLabel } = decodeTransmissionGear(rawGear, currentSpeed, Number(engineRpm || 0), Boolean(ignition));

  return {
    ...rawTel,
    ...mileageMetrics,
    lat: gps.latitude || rawTel.lat || 0,
    lng: gps.longitude || rawTel.lng || 0,
    altitude: gps.altitude || rawTel.altitude || 0,
    angle: gps.angle || rawTel.angle || 0,
    speed: currentSpeed,
    satellites: gps.satellites !== undefined ? gps.satellites : (rawTel.satellites || 0),
    isValid: gps.isValid !== undefined ? gps.isValid : Boolean(rawTel.isValid),
    ignition: Boolean(ignition),
    engineRpm: Number(engineRpm || 0),
    coolantTemp: Number(coolantTemp || 0),
    currentGear: currentGear,
    gearLabel: gearLabel,
    fuelPercentage: rawTel.fuelLevelPercentage !== undefined ? rawTel.fuelLevelPercentage : (rawTel.fuelLevel !== undefined ? rawTel.fuelLevel : (fuelLevelLiters ? Math.round((fuelLevelLiters / 50) * 100) : 0)),
    fuelLiters: fuelLiters,
    fuelLevelLiters: fuelLevelLiters,
    totalMileageCan: totalMileageCan,
    vehicleRange: vehicleRange || mileageMetrics.estimatedRangeKm || null,
    nextServiceDistance: nextServiceDistance,
    externalVoltage: externalVoltage || 0,
    batteryVoltage: batteryVoltage || 0,
    gsmSignal: gsmSignal || 0,
    instantMileage: mileageMetrics.instantMileageKmPerLiter || rawTel.instantMileage || 0,
    avgMileage: mileageMetrics.avgMileageKmPerLiter || rawTel.avgMileage || 0,
    tripDistance: mileageMetrics.tripDistanceKm || rawTel.tripDistance || 0,
    tripFuel: mileageMetrics.tripFuelConsumedLiters || rawTel.tripFuel || 0,
    costPerKm: mileageMetrics.costPerKm || rawTel.costPerKm || 0,
    fuelRateLitersPerHour: mileageMetrics.fuelRateLitersPerHour !== undefined ? mileageMetrics.fuelRateLitersPerHour : (rawTel.fuelRateLitersPerHour || 0),
    ecmTotalFuelConsumed: mileageMetrics.ecmTotalFuelConsumed !== undefined ? mileageMetrics.ecmTotalFuelConsumed : (ios[88] !== undefined ? parseFloat((Number(ios[88]) * 0.1).toFixed(2)) : (ios[107] !== undefined ? parseFloat((Number(ios[107]) * 0.1).toFixed(2)) : (rawTel.ecmTotalFuelConsumed || null))),
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

// Initialize Database Schema & Prepared Statements
function initSqlite() {
  sqliteDb = new DatabaseSync(DB_FILE);

  // Performance Tuning: Enable WAL (Write-Ahead Logging) & Normal Sync for High Throughput
  sqliteDb.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
    PRAGMA cache_size = -64000;
  `);

  // 1. CAN Telemetry Time-Series Table (Retained for 90 Days / 3 Months)
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS can_telemetry_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      imei TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      server_timestamp TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      altitude REAL,
      angle REAL,
      speed REAL,
      satellites INTEGER,
      is_valid INTEGER,
      ignition INTEGER,
      engine_rpm INTEGER,
      coolant_temp REAL,
      current_gear INTEGER,
      gear_label TEXT,
      fuel_percentage REAL,
      fuel_liters REAL,
      total_mileage_can REAL,
      odometer REAL,
      vehicle_range REAL,
      next_service_distance REAL,
      external_voltage REAL,
      battery_voltage REAL,
      gsm_signal INTEGER,
      instant_mileage REAL,
      avg_mileage REAL,
      trip_distance REAL,
      trip_fuel REAL,
      cost_per_km REAL,
      fuel_rate_liters_per_hour REAL,
      ecm_total_fuel_consumed REAL,
      engine_load REAL,
      accelerator_pedal REAL,
      oil_pressure REAL,
      gnss_pdop REAL,
      gnss_hdop REAL,
      sleep_mode INTEGER,
      lvcan_adapter_id TEXT,
      raw_ios_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_can_imei_timestamp ON can_telemetry_history (imei, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_can_timestamp ON can_telemetry_history (timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_can_imei ON can_telemetry_history (imei);
    CREATE INDEX IF NOT EXISTS idx_can_speed ON can_telemetry_history (speed);
    CREATE INDEX IF NOT EXISTS idx_can_ignition ON can_telemetry_history (ignition);
  `);

  // Safe Alter Table for existing SQLite files
  try {
    sqliteDb.exec(`ALTER TABLE can_telemetry_history ADD COLUMN current_gear INTEGER;`);
  } catch (_) {}
  try {
    sqliteDb.exec(`ALTER TABLE can_telemetry_history ADD COLUMN gear_label TEXT;`);
  } catch (_) {}

  // 2. Entities Tables: Devices, Users, Licenses, Alerts, Trips, Command Logs
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      imei TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      status TEXT DEFAULT 'OFFLINE',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      role TEXT,
      email TEXT,
      phone TEXT,
      data_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS licenses (
      id TEXT PRIMARY KEY,
      license_key TEXT UNIQUE,
      status TEXT,
      dealer_id TEXT,
      vehicle_id TEXT,
      data_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      imei TEXT NOT NULL,
      type TEXT,
      severity TEXT,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_imei ON alerts (imei, created_at DESC);

    CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY,
      imei TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_trips_imei ON trips (imei, created_at DESC);

    CREATE TABLE IF NOT EXISTS command_logs (
      id TEXT PRIMARY KEY,
      imei TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Prepare Synchronous Insertion Statements for Ultra-Fast Write Performance
  preparedStmts.insertTelemetry = sqliteDb.prepare(`
    INSERT INTO can_telemetry_history (
      imei, timestamp, server_timestamp,
      latitude, longitude, altitude, angle, speed, satellites, is_valid,
      ignition, engine_rpm, coolant_temp, current_gear, gear_label,
      fuel_percentage, fuel_liters,
      total_mileage_can, odometer, vehicle_range, next_service_distance,
      external_voltage, battery_voltage, gsm_signal,
      instant_mileage, avg_mileage, trip_distance, trip_fuel, cost_per_km,
      fuel_rate_liters_per_hour, ecm_total_fuel_consumed, engine_load,
      accelerator_pedal, oil_pressure, gnss_pdop, gnss_hdop,
      sleep_mode, lvcan_adapter_id, raw_ios_json
    ) VALUES (
      ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?
    )
  `);

  preparedStmts.upsertDevice = sqliteDb.prepare(`
    INSERT INTO devices (imei, data_json, status, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(imei) DO UPDATE SET
      data_json = excluded.data_json,
      status = excluded.status,
      updated_at = excluded.updated_at
  `);

  preparedStmts.upsertUser = sqliteDb.prepare(`
    INSERT INTO users (id, role, email, phone, data_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      role = excluded.role,
      email = excluded.email,
      phone = excluded.phone,
      data_json = excluded.data_json,
      updated_at = excluded.updated_at
  `);

  preparedStmts.upsertLicense = sqliteDb.prepare(`
    INSERT INTO licenses (id, license_key, status, dealer_id, vehicle_id, data_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      license_key = excluded.license_key,
      status = excluded.status,
      dealer_id = excluded.dealer_id,
      vehicle_id = excluded.vehicle_id,
      data_json = excluded.data_json,
      updated_at = excluded.updated_at
  `);

  preparedStmts.insertAlert = sqliteDb.prepare(`
    INSERT INTO alerts (id, imei, type, severity, data_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  preparedStmts.insertTrip = sqliteDb.prepare(`
    INSERT INTO trips (id, imei, data_json, created_at)
    VALUES (?, ?, ?, ?)
  `);

  preparedStmts.insertCommandLog = sqliteDb.prepare(`
    INSERT INTO command_logs (id, imei, data_json, created_at)
    VALUES (?, ?, ?, ?)
  `);

  // Hydrate In-Memory Caches from SQLite
  hydrateCachesFromSqlite();

  // Perform Legacy JSON Migration if necessary
  migrateFromLegacyJsonIfNeeded();

  // Setup Automated 24-Hour Retention Lifecycle (Purge > 90 Days)
  setupRetentionSchedule();
}

function hydrateCachesFromSqlite() {
  try {
    const devicesRows = sqliteDb.prepare(`SELECT data_json FROM devices`).all();
    for (const row of devicesRows) {
      const dev = JSON.parse(row.data_json);
      cache.devices.set(dev.imei, dev);
    }

    const usersRows = sqliteDb.prepare(`SELECT data_json FROM users`).all();
    for (const row of usersRows) {
      const u = JSON.parse(row.data_json);
      cache.users.set(u.id, u);
    }

    const licensesRows = sqliteDb.prepare(`SELECT data_json FROM licenses`).all();
    for (const row of licensesRows) {
      const l = JSON.parse(row.data_json);
      cache.licenses.set(l.id, l);
    }

    const alertsRows = sqliteDb.prepare(`SELECT data_json FROM alerts ORDER BY created_at DESC LIMIT 500`).all();
    cache.alerts = alertsRows.map(r => JSON.parse(r.data_json));

    const tripsRows = sqliteDb.prepare(`SELECT data_json FROM trips ORDER BY created_at DESC LIMIT 500`).all();
    cache.trips = tripsRows.map(r => JSON.parse(r.data_json));

    const cmdRows = sqliteDb.prepare(`SELECT data_json FROM command_logs ORDER BY created_at DESC LIMIT 200`).all();
    cache.commandLogs = cmdRows.map(r => JSON.parse(r.data_json));

    seedInitialUsers();
    seedInitialLicenses();
  } catch (err) {
    console.error('[DB] Error hydrating caches from SQLite:', err.message);
  }
}

function migrateFromLegacyJsonIfNeeded() {
  if (cache.devices.size === 0 && fs.existsSync(LEGACY_JSON_FILE)) {
    try {
      console.log('[DB] 📦 Migrating legacy JSON store into SQLite...');
      const raw = fs.readFileSync(LEGACY_JSON_FILE, 'utf-8');
      const data = JSON.parse(raw);

      if (data.devices) {
        for (const [imei, dev] of Object.entries(data.devices)) {
          Database.upsertVehicle(dev);
        }
      }
      if (data.users) {
        for (const [id, user] of Object.entries(data.users)) {
          Database.upsertUser(user);
        }
      }
      if (data.licenses) {
        for (const [id, lic] of Object.entries(data.licenses)) {
          preparedStmts.upsertLicense.run(
            lic.id, lic.licenseKey, lic.status || 'AVAILABLE',
            lic.dealerId || null, lic.vehicleId || null,
            JSON.stringify(lic), new Date().toISOString()
          );
          cache.licenses.set(lic.id, lic);
        }
      }
      if (data.positions && Array.isArray(data.positions)) {
        for (const pos of data.positions) {
          const rec = {
            timestamp: pos.timestamp || pos.deviceTimestamp,
            gps: {
              latitude: pos.lat || pos.latitude,
              longitude: pos.lng || pos.longitude,
              altitude: pos.altitude,
              angle: pos.angle,
              speed: pos.speed,
              satellites: pos.satellites,
              isValid: pos.isValid
            },
            rawIos: pos.rawIos || {},
            telemetry: pos
          };
          Database.saveTelemetry(pos.imei, rec, pos.fuelLiters);
        }
      }
      console.log('[DB] ✅ Legacy data migration to SQLite complete.');
    } catch (err) {
      console.error('[DB] Legacy migration error:', err.message);
    }
  }
}

// Seed Initial Users if collection is empty
function seedInitialUsers() {
  if (cache.users.size === 0) {
    const defaultUsers = [
      {
        id: 'usr_admin_01',
        name: 'Master Administrator',
        email: 'admin@traxen.io',
        phone: '+91 98765 43210',
        role: 'ADMIN',
        status: 'ACTIVE',
        address: 'Traxen Global Tech Park, Chennai',
        supportPhone: '+91 98765 43210',
        supportEmail: 'support@traxen.io',
        supportAddress: 'Tower 4, OMR, Chennai, India',
        assignedVehicleIds: [],
        createdAt: new Date().toISOString()
      },
      {
        id: 'usr_dealer_01',
        name: 'Apex Fleet Solutions (Dealer)',
        email: 'dealer@apextelematics.in',
        phone: '+91 94440 12345',
        role: 'DEALER',
        status: 'ACTIVE',
        address: 'Salem City Center, Tamil Nadu',
        supportPhone: '+91 94440 12345',
        supportPhone2: '+91 94440 67890',
        supportAddress: 'Opp. New Bus Stand, Salem - 636004',
        supportEmail: 'care@apextelematics.in',
        assignedVehicleIds: [],
        createdAt: new Date().toISOString()
      },
      {
        id: 'usr_cust_01',
        name: 'Rajesh Logistics & Transport',
        email: 'rajesh@logistics.com',
        phone: '+91 98421 55667',
        role: 'CUSTOMER',
        status: 'ACTIVE',
        address: '42 Bypass Road, Namakkal, TN',
        assignedVehicleIds: [],
        createdAt: new Date().toISOString()
      },
      {
        id: 'usr_driver_01',
        name: 'Murugan (Driver)',
        email: 'murugan.driver@traxen.io',
        phone: '+91 97890 22334',
        role: 'DRIVER',
        status: 'ACTIVE',
        address: 'Coimbatore, TN',
        assignedVehicleIds: [],
        createdAt: new Date().toISOString()
      }
    ];

    defaultUsers.forEach(u => Database.upsertUser(u));
  }
}

// Seed Default Licenses if empty
function seedInitialLicenses() {
  if (cache.licenses.size === 0) {
    const defaultLicenses = [
      {
        id: 'lic_001',
        licenseKey: 'TRX-1Y-9824-A1BC',
        durationValue: 1,
        durationUnit: 'years',
        durationInfo: '1 Year Full Telematics & CAN Suite',
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        activatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
        dealerId: 'usr_dealer_01',
        vehicleId: '353742372466615',
        vehicleNumberPlate: 'TN-30-AZ-1234',
        createdBy: 'Master Administrator'
      },
      {
        id: 'lic_002',
        licenseKey: 'TRX-2Y-5512-D4EF',
        durationValue: 2,
        durationUnit: 'years',
        durationInfo: '2 Years Premium Fleet License',
        status: 'AVAILABLE',
        createdAt: new Date().toISOString(),
        dealerId: 'usr_dealer_01',
        createdBy: 'Master Administrator'
      },
      {
        id: 'lic_003',
        licenseKey: 'TRX-6M-7731-X9YZ',
        durationValue: 6,
        durationUnit: 'months',
        durationInfo: '6 Months Standard Tracking',
        status: 'AVAILABLE',
        createdAt: new Date().toISOString(),
        dealerId: 'usr_dealer_01',
        createdBy: 'Master Administrator'
      }
    ];

    defaultLicenses.forEach(l => {
      preparedStmts.upsertLicense.run(
        l.id, l.licenseKey, l.status,
        l.dealerId || null, l.vehicleId || null,
        JSON.stringify(l), new Date().toISOString()
      );
      cache.licenses.set(l.id, l);
    });
  }
}

function setupRetentionSchedule() {
  if (cleanupInterval) clearInterval(cleanupInterval);
  // Run cleanup once every 24 hours
  cleanupInterval = setInterval(() => {
    Database.purgeExpiredData(RETENTION_DAYS);
  }, 24 * 60 * 60 * 1000);
}

// =================================================================
// Public Database Interface
// =================================================================
const Database = {
  init() {
    initSqlite();
    console.log(`[DB] 🗄️ SQLite CAN Engine Initialized.`);
    console.log(`[DB] 📅 Retention Policy: ${RETENTION_DAYS} Days (3 Months). Active vehicles: ${cache.devices.size}, Users: ${cache.users.size}, Licenses: ${cache.licenses.size}`);
  },

  // -------------------------------------------------------------
  // 1. HIGH-SPEED CAN & GPS TELEMETRY INGESTION (90-DAY RETENTION)
  // -------------------------------------------------------------
  saveTelemetry(imei, record, calculatedLiters, mileageMetrics = {}) {
    let device = cache.devices.get(imei);
    if (!device) {
      // Auto-register unknown device
      device = {
        id: imei,
        imei,
        numberPlate: `VEH-${imei.slice(-4)}`,
        registrationNumber: `VEH-${imei.slice(-4)}`,
        vehicleNumber: `VEH-${imei.slice(-4)}`,
        model: 'Teltonika Telematics Tracker',
        vehicleType: 'CAR',
        category: 'CAR',
        simProvider: 'Airtel',
        protocol: 'Teltonika Codec 8 Extended',
        userIds: ['usr_cust_01'],
        tankCapacity: 480,
        fuelSource: 'CAN_PERCENT',
        calibrationPoints: generateLinearPoints(480, 4),
        status: 'ONLINE',
        active: true,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
      };
      this.upsertVehicle(device);
    }

    const rawTel = record.telemetry || {};
    const deviceTimeIso = record.timestamp 
      ? (record.timestamp instanceof Date ? record.timestamp.toISOString() : new Date(record.timestamp).toISOString()) 
      : new Date().toISOString();
    const serverTimeIso = new Date().toISOString();

    const telemetry = {
      ...normalizeTelemetry(rawTel, record.rawIos, calculatedLiters, mileageMetrics, record.gps || {}),
      deviceTimestamp: deviceTimeIso,
      serverTimestamp: serverTimeIso
    };

    // Update Device State in Cache & SQLite
    device.status = 'ONLINE';
    device.lastUpdated = serverTimeIso;
    device.lastTelemetry = telemetry;
    cache.devices.set(imei, device);

    preparedStmts.upsertDevice.run(
      imei,
      JSON.stringify(device),
      'ONLINE',
      serverTimeIso
    );

    // Synchronously Insert into SQLite CAN Telemetry History (3 Months Retention)
    try {
      preparedStmts.insertTelemetry.run(
        imei,
        deviceTimeIso,
        serverTimeIso,
        telemetry.lat || 0,
        telemetry.lng || 0,
        telemetry.altitude || 0,
        telemetry.angle || 0,
        telemetry.speed || 0,
        telemetry.satellites || 0,
        telemetry.isValid ? 1 : 0,
        telemetry.ignition ? 1 : 0,
        telemetry.engineRpm || 0,
        telemetry.coolantTemp || 0,
        telemetry.currentGear !== undefined ? telemetry.currentGear : null,
        telemetry.gearLabel || 'N',
        telemetry.fuelPercentage || 0,
        telemetry.fuelLiters || 0,
        telemetry.totalMileageCan || 0,
        telemetry.odometer || 0,
        telemetry.vehicleRange || null,
        telemetry.nextServiceDistance || null,
        telemetry.externalVoltage || 0,
        telemetry.batteryVoltage || 0,
        telemetry.gsmSignal || 0,
        telemetry.instantMileage || 0,
        telemetry.avgMileage || 0,
        telemetry.tripDistance || 0,
        telemetry.tripFuel || 0,
        telemetry.costPerKm || 0,
        telemetry.fuelRateLitersPerHour || 0,
        telemetry.ecmTotalFuelConsumed || null,
        telemetry.engineLoad || 0,
        telemetry.acceleratorPedal || 0,
        telemetry.oilPressure || null,
        telemetry.gnssPdop || null,
        telemetry.gnssHdop || null,
        telemetry.sleepMode || 0,
        telemetry.lvcanAdapterId || null,
        JSON.stringify(record.rawIos || {})
      );
    } catch (dbErr) {
      console.error('[DB] SQLite CAN Telemetry Insert Failed:', dbErr.message);
    }

    // Keep Recent Live Tail in Memory for instant WebSocket/UI feeds
    if (!cache.recentPositions.has(imei)) {
      cache.recentPositions.set(imei, []);
    }
    const tail = cache.recentPositions.get(imei);
    const historyItem = {
      imei,
      timestamp: deviceTimeIso,
      serverTimestamp: serverTimeIso,
      ...telemetry
    };
    tail.push(historyItem);
    if (tail.length > 50) tail.shift();

    return historyItem;
  },

  // -------------------------------------------------------------
  // 2. TIME-SERIES CAN TELEMETRY & PLAYBACK QUERIES
  // -------------------------------------------------------------
  getHistory(imei, options = 500) {
    let limit = 500;
    let from = null;
    let to = null;

    if (typeof options === 'number') {
      limit = options;
    } else if (typeof options === 'object' && options !== null) {
      limit = parseInt(options.limit, 10) || 500;
      from = options.from || null;
      to = options.to || null;
    }

    try {
      let query = `SELECT * FROM can_telemetry_history WHERE imei = ?`;
      const params = [imei];

      if (from) {
        query += ` AND timestamp >= ?`;
        params.push(new Date(from).toISOString());
      }
      if (to) {
        query += ` AND timestamp <= ?`;
        params.push(new Date(to).toISOString());
      }

      query += ` ORDER BY timestamp DESC LIMIT ?`;
      params.push(limit);

      const rows = sqliteDb.prepare(query).all(...params);
      
      // Transform SQLite columns back into Traxen Telemetry object
      return rows.map(r => ({
        id: r.id,
        imei: r.imei,
        timestamp: r.timestamp,
        serverTimestamp: r.server_timestamp,
        lat: r.latitude,
        lng: r.longitude,
        altitude: r.altitude,
        angle: r.angle,
        speed: r.speed,
        satellites: r.satellites,
        isValid: Boolean(r.is_valid),
        ignition: Boolean(r.ignition),
        engineRpm: r.engine_rpm,
        coolantTemp: r.coolant_temp,
        currentGear: r.current_gear,
        gearLabel: r.gear_label || 'N',
        fuelPercentage: r.fuel_percentage,
        fuelLiters: r.fuel_liters,
        totalMileageCan: r.total_mileage_can,
        odometer: r.odometer,
        vehicleRange: r.vehicle_range,
        nextServiceDistance: r.next_service_distance,
        externalVoltage: r.external_voltage,
        batteryVoltage: r.battery_voltage,
        gsmSignal: r.gsm_signal,
        instantMileage: r.instant_mileage,
        avgMileage: r.avg_mileage,
        tripDistance: r.trip_distance,
        tripFuel: r.trip_fuel,
        costPerKm: r.cost_per_km,
        fuelRateLitersPerHour: r.fuel_rate_liters_per_hour,
        ecmTotalFuelConsumed: r.ecm_total_fuel_consumed,
        engineLoad: r.engine_load,
        acceleratorPedal: r.accelerator_pedal,
        oilPressure: r.oil_pressure,
        rawIos: r.raw_ios_json ? JSON.parse(r.raw_ios_json) : {}
      })).reverse(); // Return in chronological order
    } catch (err) {
      console.error('[DB] Error querying CAN history:', err.message);
      // Fallback to recent in-memory tail
      return (cache.recentPositions.get(imei) || []).slice(-limit);
    }
  },

  // CAN Analytics Aggregation over 3-Month Time Windows
  getCanAnalytics(imei, { from = null, to = null, interval = 'hourly' } = {}) {
    const fromTime = from ? new Date(from).toISOString() : new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const toTime = to ? new Date(to).toISOString() : new Date().toISOString();

    const timeFormat = interval === 'daily' ? '%Y-%m-%d' : '%Y-%m-%d %H:00:00';

    try {
      const sql = `
        SELECT 
          strftime('${timeFormat}', timestamp) as time_bucket,
          COUNT(*) as data_points,
          AVG(engine_rpm) as avg_rpm,
          MAX(engine_rpm) as max_rpm,
          AVG(speed) as avg_speed,
          MAX(speed) as max_speed,
          AVG(fuel_percentage) as avg_fuel_pct,
          MIN(fuel_percentage) as min_fuel_pct,
          MAX(fuel_percentage) as max_fuel_pct,
          AVG(coolant_temp) as avg_coolant_temp,
          MAX(coolant_temp) as max_coolant_temp,
          AVG(external_voltage) as avg_voltage,
          MIN(external_voltage) as min_voltage,
          SUM(trip_distance) as total_distance_km,
          SUM(trip_fuel) as total_fuel_liters
        FROM can_telemetry_history
        WHERE imei = ? AND timestamp >= ? AND timestamp <= ?
        GROUP BY time_bucket
        ORDER BY time_bucket ASC
      `;

      const rows = sqliteDb.prepare(sql).all(imei, fromTime, toTime);
      return {
        imei,
        from: fromTime,
        to: toTime,
        interval,
        totalBuckets: rows.length,
        buckets: rows
      };
    } catch (err) {
      console.error('[DB] Error computing CAN analytics:', err.message);
      return { imei, error: err.message, buckets: [] };
    }
  },

  // High-Density GPS Route Playback
  getPlayback(imei, { from, to, limit = 5000 } = {}) {
    const fromTime = from ? new Date(from).toISOString() : new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const toTime = to ? new Date(to).toISOString() : new Date().toISOString();

    const rows = sqliteDb.prepare(`
      SELECT 
        timestamp, latitude, longitude, altitude, angle, speed,
        ignition, engine_rpm, fuel_percentage, fuel_liters, coolant_temp,
        battery_voltage, external_voltage, odometer
      FROM can_telemetry_history
      WHERE imei = ? AND timestamp >= ? AND timestamp <= ? AND is_valid = 1
      ORDER BY timestamp ASC
      LIMIT ?
    `).all(imei, fromTime, toTime, limit);

    return {
      imei,
      from: fromTime,
      to: toTime,
      pointCount: rows.length,
      points: rows.map(r => ({
        timestamp: r.timestamp,
        lat: r.latitude,
        lng: r.longitude,
        alt: r.altitude,
        bearing: r.angle,
        speed: r.speed,
        ignition: Boolean(r.ignition),
        rpm: r.engine_rpm,
        fuelPct: r.fuel_percentage,
        fuelLiters: r.fuel_liters,
        temp: r.coolant_temp,
        extVolt: r.external_voltage,
        odo: r.odometer
      }))
    };
  },

  // -------------------------------------------------------------
  // Fuel Intelligence: Refuel (Fill) & Sudden Drop (Theft) Analysis
  // -------------------------------------------------------------
  getFuelEvents(imei, { from = null, to = null, minFillLiters = 5.0, minDrainLiters = 4.0 } = {}) {
    const fromTime = from ? new Date(from).toISOString() : new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
    const toTime = to ? new Date(to).toISOString() : new Date().toISOString();

    const fillThreshold = parseFloat(minFillLiters) || 5.0;
    const drainThreshold = parseFloat(minDrainLiters) || 4.0;

    try {
      const rows = sqliteDb.prepare(`
        SELECT 
          timestamp, latitude, longitude, speed, ignition,
          fuel_percentage, fuel_liters, total_mileage_can, odometer
        FROM can_telemetry_history
        WHERE imei = ? AND timestamp >= ? AND timestamp <= ? AND fuel_percentage IS NOT NULL
        ORDER BY timestamp ASC
      `).all(imei, fromTime, toTime);

      if (rows.length < 2) {
        return {
          imei,
          from: fromTime,
          to: toTime,
          totalRefueledLiters: 0,
          totalRefuelCount: 0,
          totalDrainedOrStolenLiters: 0,
          totalTheftCount: 0,
          events: []
        };
      }

      const events = [];
      let totalRefueledLiters = 0;
      let totalDrainedLiters = 0;

      let baseline = rows[0];

      for (let i = 1; i < rows.length; i++) {
        const current = rows[i];
        const currentTime = new Date(current.timestamp).getTime();
        const baseTime = new Date(baseline.timestamp).getTime();
        const elapsedMinutes = (currentTime - baseTime) / 60000;

        const currentLiters = current.fuel_liters !== null ? current.fuel_liters : (current.fuel_percentage * 4.8);
        const baseLiters = baseline.fuel_liters !== null ? baseline.fuel_liters : (baseline.fuel_percentage * 4.8);
        const diffLiters = currentLiters - baseLiters;

        // 1. REFUEL DETECTION: Positive fuel jump >= fillThreshold in <= 30 mins
        if (diffLiters >= fillThreshold && elapsedMinutes <= 30) {
          const added = parseFloat(diffLiters.toFixed(1));
          totalRefueledLiters += added;
          events.push({
            type: 'REFUEL',
            severity: 'INFO',
            title: `Fuel Refill (+${added} L)`,
            message: `Refueled +${added} Liters from ${baseLiters.toFixed(1)}L (${baseline.fuel_percentage}%) to ${currentLiters.toFixed(1)}L (${current.fuel_percentage}%)`,
            addedLiters: added,
            startLiters: parseFloat(baseLiters.toFixed(1)),
            endLiters: parseFloat(currentLiters.toFixed(1)),
            startPct: baseline.fuel_percentage,
            endPct: current.fuel_percentage,
            timestamp: current.timestamp,
            lat: current.latitude,
            lng: current.longitude,
            speed: current.speed,
            ignition: Boolean(current.ignition)
          });
          baseline = current;
          continue;
        }

        // 2. SUDDEN DECREASE / THEFT DETECTION: Negative drop >= drainThreshold while Ignition OFF, or impossible rapid drain (>50 L/h)
        const isIgnitionOff = !current.ignition || current.ignition === 0;
        if (diffLiters <= -drainThreshold && (isIgnitionOff || elapsedMinutes <= 5)) {
          const lost = parseFloat(Math.abs(diffLiters).toFixed(1));
          totalDrainedLiters += lost;
          events.push({
            type: 'FUEL_THEFT_OR_DRAIN',
            severity: 'CRITICAL',
            title: `⚠️ Sudden Fuel Drop (-${lost} L)`,
            message: `Critical fuel drop of ${lost} Liters detected ${isIgnitionOff ? 'while ignition is OFF' : 'rapidly'}! (${baseLiters.toFixed(1)}L ➔ ${currentLiters.toFixed(1)}L)`,
            lostLiters: lost,
            theftType: isIgnitionOff ? 'IGNITION_OFF_SIPHON' : 'ABNORMAL_RAPID_DRAIN',
            startLiters: parseFloat(baseLiters.toFixed(1)),
            endLiters: parseFloat(currentLiters.toFixed(1)),
            startPct: baseline.fuel_percentage,
            endPct: current.fuel_percentage,
            timestamp: current.timestamp,
            lat: current.latitude,
            lng: current.longitude,
            speed: current.speed,
            ignition: Boolean(current.ignition)
          });
          baseline = current;
          continue;
        }

        // Shift baseline if window exceeds 15 minutes without sudden event
        if (elapsedMinutes > 15) {
          baseline = current;
        }
      }

      return {
        imei,
        from: fromTime,
        to: toTime,
        totalRefueledLiters: parseFloat(totalRefueledLiters.toFixed(1)),
        totalRefuelCount: events.filter(e => e.type === 'REFUEL').length,
        totalDrainedOrStolenLiters: parseFloat(totalDrainedLiters.toFixed(1)),
        totalTheftCount: events.filter(e => e.type === 'FUEL_THEFT_OR_DRAIN').length,
        events: events.reverse() // Most recent first
      };
    } catch (err) {
      console.error('[DB] Error computing fuel events:', err.message);
      return { imei, error: err.message, events: [] };
    }
  },

  // -------------------------------------------------------------
  // 3. VEHICLE / FLEET MANAGEMENT
  // -------------------------------------------------------------
  getDevice(imeiOrId) {
    if (!imeiOrId) return null;
    if (cache.devices.has(imeiOrId)) return cache.devices.get(imeiOrId);
    for (const dev of cache.devices.values()) {
      if (dev.id === imeiOrId || dev.numberPlate === imeiOrId || dev.registrationNumber === imeiOrId) {
        return dev;
      }
    }
    return null;
  },

  getAllDevices() {
    return Array.from(cache.devices.values());
  },

  getAllVehicles({ role = null, userId = null, status = null, vehicleType = null, search = '', offset = 0, limit = 50 } = {}) {
    let list = Array.from(cache.devices.values());

    if (role === 'CUSTOMER' && userId) {
      list = list.filter(v => (v.userIds && v.userIds.includes(userId)) || v.primaryUserId === userId);
    } else if (role === 'DEALER' && userId) {
      list = list.filter(v => v.dealerId === userId || (v.userIds && v.userIds.includes(userId)));
    }

    if (status) {
      const s = status.toUpperCase();
      if (s === 'ONLINE') list = list.filter(v => v.status === 'ONLINE');
      else if (s === 'OFFLINE') list = list.filter(v => v.status === 'OFFLINE');
      else if (s === 'MOVING') list = list.filter(v => v.status === 'ONLINE' && v.lastTelemetry && v.lastTelemetry.speed > 0);
      else if (s === 'IDLE') list = list.filter(v => v.status === 'ONLINE' && v.lastTelemetry && v.lastTelemetry.speed === 0 && v.lastTelemetry.ignition);
    }

    if (vehicleType) {
      list = list.filter(v => (v.vehicleType || '').toUpperCase() === vehicleType.toUpperCase());
    }

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(v => 
        (v.numberPlate && v.numberPlate.toLowerCase().includes(q)) ||
        (v.registrationNumber && v.registrationNumber.toLowerCase().includes(q)) ||
        (v.imei && v.imei.toLowerCase().includes(q)) ||
        (v.simNumber && v.simNumber.toLowerCase().includes(q)) ||
        (v.ownerName && v.ownerName.toLowerCase().includes(q)) ||
        (v.vehicleType && v.vehicleType.toLowerCase().includes(q))
      );
    }

    const total = list.length;
    const paginated = list.slice(offset, offset + limit).map(v => {
      const license = v.licenseId ? cache.licenses.get(v.licenseId) || v.license : (v.license || null);
      const assignedUsers = (v.userIds || []).map(uid => {
        const u = cache.users.get(uid);
        return u ? { id: u.id, name: u.name, role: u.role, phone: u.phone, email: u.email } : { id: uid, name: 'Unknown User' };
      });
      return {
        ...v,
        license,
        assignedUsers,
        primaryUser: assignedUsers[0] || null
      };
    });

    return {
      vehicles: paginated,
      pagination: {
        total,
        offset,
        limit,
        count: paginated.length,
        hasNext: offset + limit < total
      }
    };
  },

  upsertVehicle(vehicleData) {
    const imei = (vehicleData.imei || '').trim();
    if (!imei) throw new Error('Vehicle IMEI is required');

    const existing = cache.devices.get(imei) || {};
    const plate = vehicleData.registrationNumber || vehicleData.numberPlate || vehicleData.vehicleNumber || existing.numberPlate || `TN-${imei.slice(-4)}`;
    const capacity = parseFloat(vehicleData.tankCapacity) || existing.tankCapacity || 480;

    let license = existing.license || null;
    let licenseId = vehicleData.licenseId !== undefined ? vehicleData.licenseId : existing.licenseId;

    if (vehicleData.licenseDurationDays) {
      const days = parseInt(vehicleData.licenseDurationDays, 10);
      const licId = `lic_${Date.now().toString(36)}`;
      license = {
        id: licId,
        licenseKey: `TRX-${days >= 365 ? Math.round(days/365)+'Y' : days+'D'}-${Math.floor(1000 + Math.random() * 9000)}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
        durationValue: days >= 365 ? Math.round(days/365) : days,
        durationUnit: days >= 365 ? 'years' : 'days',
        durationInfo: `${days >= 365 ? Math.round(days/365)+' Year(s)' : days+' Days'} License`,
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        activatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + days * 24 * 3600 * 1000).toISOString(),
        vehicleId: imei,
        vehicleNumberPlate: plate,
        createdBy: vehicleData.createdBy || 'Admin'
      };
      cache.licenses.set(licId, license);
      preparedStmts.upsertLicense.run(
        license.id, license.licenseKey, license.status,
        license.dealerId || null, license.vehicleId || null,
        JSON.stringify(license), new Date().toISOString()
      );
      licenseId = licId;
    } else if (licenseId && cache.licenses.has(licenseId)) {
      const lic = cache.licenses.get(licenseId);
      lic.status = 'ACTIVE';
      lic.vehicleId = imei;
      lic.vehicleNumberPlate = plate;
      if (!lic.activatedAt) lic.activatedAt = new Date().toISOString();
      if (!lic.expiresAt) {
        const d = (lic.durationUnit === 'years' ? lic.durationValue * 365 : (lic.durationUnit === 'months' ? lic.durationValue * 30 : lic.durationValue || 365));
        lic.expiresAt = new Date(Date.now() + d * 24 * 3600 * 1000).toISOString();
      }
      license = lic;
      preparedStmts.upsertLicense.run(
        lic.id, lic.licenseKey, lic.status,
        lic.dealerId || null, lic.vehicleId || null,
        JSON.stringify(lic), new Date().toISOString()
      );
    }

    const updated = {
      ...existing,
      id: existing.id || imei,
      imei: imei,
      numberPlate: plate,
      registrationNumber: plate,
      vehicleNumber: plate,
      ownerName: vehicleData.ownerName || existing.ownerName || '',
      vehicleType: vehicleData.vehicleType || vehicleData.category || existing.vehicleType || 'CAR',
      category: vehicleData.vehicleType || vehicleData.category || existing.vehicleType || 'CAR',
      model: vehicleData.model || existing.model || 'Teltonika Telematics Tracker',
      simNumber: vehicleData.simNumber !== undefined ? vehicleData.simNumber : (existing.simNumber || ''),
      simProvider: vehicleData.simProvider || existing.simProvider || 'Airtel',
      protocol: vehicleData.protocol || existing.protocol || 'Teltonika Codec 8 Extended',
      userIds: vehicleData.userIds !== undefined ? (Array.isArray(vehicleData.userIds) ? vehicleData.userIds : [vehicleData.userIds]) : (existing.userIds || ['usr_cust_01']),
      licenseId: licenseId || null,
      license: license,
      tankCapacity: capacity,
      fuelSource: vehicleData.fuelSource || existing.fuelSource || 'CAN_PERCENT',
      calibrationPoints: vehicleData.calibrationPoints || existing.calibrationPoints || generateLinearPoints(capacity, 4),
      acEnabled: vehicleData.acEnabled !== undefined ? Boolean(vehicleData.acEnabled) : (existing.acEnabled || false),
      callAlertEnabled: vehicleData.callAlertEnabled !== undefined ? Boolean(vehicleData.callAlertEnabled) : (existing.callAlertEnabled || false),
      callAlertPhoneNumber: vehicleData.callAlertPhoneNumber !== undefined ? vehicleData.callAlertPhoneNumber : (existing.callAlertPhoneNumber || ''),
      positionStoreIntervalSeconds: parseInt(vehicleData.positionStoreIntervalSeconds, 10) || existing.positionStoreIntervalSeconds || 10,
      statusRetentionMonths: parseInt(vehicleData.statusRetentionMonths, 10) || existing.statusRetentionMonths || 3,
      status: existing.status || 'OFFLINE',
      active: true,
      lastUpdated: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdAt: existing.createdAt || new Date().toISOString()
    };

    cache.devices.set(imei, updated);
    preparedStmts.upsertDevice.run(
      imei,
      JSON.stringify(updated),
      updated.status,
      updated.updatedAt
    );

    return updated;
  },

  upsertDevice(deviceData) {
    return this.upsertVehicle(deviceData);
  },

  deleteVehicle(idOrImei) {
    const dev = this.getDevice(idOrImei);
    if (!dev) return false;
    cache.devices.delete(dev.imei);
    cache.recentPositions.delete(dev.imei);

    sqliteDb.prepare(`DELETE FROM devices WHERE imei = ?`).run(dev.imei);
    sqliteDb.prepare(`DELETE FROM can_telemetry_history WHERE imei = ?`).run(dev.imei);

    // Release attached license
    if (dev.licenseId && cache.licenses.has(dev.licenseId)) {
      const lic = cache.licenses.get(dev.licenseId);
      lic.status = 'AVAILABLE';
      lic.vehicleId = null;
      lic.vehicleNumberPlate = null;
      preparedStmts.upsertLicense.run(
        lic.id, lic.licenseKey, lic.status,
        lic.dealerId || null, null,
        JSON.stringify(lic), new Date().toISOString()
      );
    }
    return true;
  },

  deleteDevice(imei) {
    return this.deleteVehicle(imei);
  },

  assignUsersToVehicle(vehicleId, userIds) {
    const vehicle = this.getDevice(vehicleId);
    if (!vehicle) throw new Error('Vehicle not found');
    vehicle.userIds = Array.isArray(userIds) ? userIds : [];
    vehicle.updatedAt = new Date().toISOString();
    this.upsertVehicle(vehicle);
    return vehicle;
  },

  addManualKm(vehicleId, { addedKm = 0, forever = false, date = null, notes = '' } = {}) {
    const vehicle = this.getDevice(vehicleId);
    if (!vehicle) throw new Error('Vehicle not found');
    const km = parseFloat(addedKm) || 0;
    if (!vehicle.manualKmSchedule) vehicle.manualKmSchedule = { totalAddedKm: 0, forever: false, history: [] };
    
    vehicle.manualKmSchedule.totalAddedKm += km;
    vehicle.manualKmSchedule.forever = Boolean(forever);
    vehicle.manualKmSchedule.history.unshift({
      date: date || new Date().toISOString(),
      addedKm: km,
      forever,
      notes,
      appliedAt: new Date().toISOString()
    });

    if (vehicle.lastTelemetry) {
      if (vehicle.lastTelemetry.odometer) vehicle.lastTelemetry.odometer += km;
      if (vehicle.lastTelemetry.totalMileageCan) vehicle.lastTelemetry.totalMileageCan += km;
    }

    this.upsertVehicle(vehicle);
    return vehicle;
  },

  // -------------------------------------------------------------
  // 4. USER MANAGEMENT & RBAC
  // -------------------------------------------------------------
  getAllUsers({ role = null, search = '', offset = 0, limit = 50 } = {}) {
    let list = Array.from(cache.users.values());

    if (role && role !== 'ALL') {
      list = list.filter(u => (u.role || '').toUpperCase() === role.toUpperCase());
    }

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(u => 
        (u.name && u.name.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q)) ||
        (u.phone && u.phone.toLowerCase().includes(q)) ||
        (u.address && u.address.toLowerCase().includes(q))
      );
    }

    const total = list.length;
    const paginated = list.slice(offset, offset + limit).map(u => {
      const assignedCount = Array.from(cache.devices.values()).filter(v => (v.userIds && v.userIds.includes(u.id)) || v.primaryUserId === u.id).length;
      return {
        ...u,
        assignedVehicleCount: assignedCount
      };
    });

    return {
      users: paginated,
      pagination: {
        total,
        offset,
        limit,
        count: paginated.length,
        hasNext: offset + limit < total
      }
    };
  },

  getUser(id) {
    if (!id) return null;
    if (cache.users.has(id)) return cache.users.get(id);
    for (const u of cache.users.values()) {
      if (u.email === id || u.phone === id) return u;
    }
    return null;
  },

  upsertUser(userData) {
    const id = userData.id || `usr_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 4)}`;
    const existing = cache.users.get(id) || {};

    const updated = {
      ...existing,
      id,
      name: userData.name || existing.name || 'New User',
      email: userData.email !== undefined ? userData.email : existing.email,
      phone: userData.phone !== undefined ? userData.phone : existing.phone,
      role: userData.role || existing.role || 'CUSTOMER',
      status: userData.status || existing.status || 'ACTIVE',
      address: userData.address !== undefined ? userData.address : existing.address,
      supportPhone: userData.supportPhone !== undefined ? userData.supportPhone : existing.supportPhone,
      supportPhone2: userData.supportPhone2 !== undefined ? userData.supportPhone2 : existing.supportPhone2,
      supportAddress: userData.supportAddress !== undefined ? userData.supportAddress : existing.supportAddress,
      supportEmail: userData.supportEmail !== undefined ? userData.supportEmail : existing.supportEmail,
      assignedVehicleIds: userData.assignedVehicleIds || existing.assignedVehicleIds || [],
      updatedAt: new Date().toISOString(),
      createdAt: existing.createdAt || new Date().toISOString()
    };

    cache.users.set(id, updated);
    preparedStmts.upsertUser.run(
      id,
      updated.role,
      updated.email || null,
      updated.phone || null,
      JSON.stringify(updated),
      updated.updatedAt
    );

    // Sync user assignments with vehicles
    if (Array.isArray(userData.assignedVehicleIds)) {
      for (const dev of cache.devices.values()) {
        const shouldHave = userData.assignedVehicleIds.includes(dev.imei) || userData.assignedVehicleIds.includes(dev.id);
        if (shouldHave) {
          if (!dev.userIds) dev.userIds = [];
          if (!dev.userIds.includes(id)) {
            dev.userIds.push(id);
            this.upsertVehicle(dev);
          }
        } else if (dev.userIds && dev.userIds.includes(id)) {
          dev.userIds = dev.userIds.filter(uid => uid !== id);
          this.upsertVehicle(dev);
        }
      }
    }

    return updated;
  },

  deleteUser(id) {
    const user = this.getUser(id);
    if (!user) return false;
    cache.users.delete(user.id);
    sqliteDb.prepare(`DELETE FROM users WHERE id = ?`).run(user.id);

    // Remove user from vehicles
    for (const dev of cache.devices.values()) {
      if (dev.userIds && dev.userIds.includes(user.id)) {
        dev.userIds = dev.userIds.filter(uid => uid !== user.id);
        this.upsertVehicle(dev);
      }
    }
    return true;
  },

  // -------------------------------------------------------------
  // 5. LICENSE INVENTORY & BATCH GENERATION
  // -------------------------------------------------------------
  getAllLicenses({ status = null, dealerId = null, offset = 0, limit = 50 } = {}) {
    let list = Array.from(cache.licenses.values());

    if (status && status !== 'ALL') {
      list = list.filter(l => (l.status || '').toUpperCase() === status.toUpperCase());
    }

    if (dealerId) {
      list = list.filter(l => l.dealerId === dealerId);
    }

    const total = list.length;
    const paginated = list.slice(offset, offset + limit);

    return {
      licenses: paginated,
      pagination: {
        total,
        offset,
        limit,
        count: paginated.length,
        hasNext: offset + limit < total
      }
    };
  },

  createLicense({ durationValue = 1, durationUnit = 'years', count = 1, dealerId = null, createdBy = 'Admin' } = {}) {
    const created = [];
    const val = parseInt(durationValue, 10) || 1;
    const unit = durationUnit || 'years';
    const num = Math.min(Math.max(parseInt(count, 10) || 1, 1), 50);

    for (let i = 0; i < num; i++) {
      const id = `lic_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 4)}`;
      const prefix = unit === 'years' ? `${val}Y` : `${val}M`;
      const code = `TRX-${prefix}-${Math.floor(1000 + Math.random() * 9000)}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
      
      const lic = {
        id,
        licenseKey: code,
        durationValue: val,
        durationUnit: unit,
        durationInfo: `${val} ${unit === 'years' ? (val === 1 ? 'Year' : 'Years') : (val === 1 ? 'Month' : 'Months')} License`,
        status: 'AVAILABLE',
        createdAt: new Date().toISOString(),
        dealerId: dealerId || null,
        createdBy
      };

      cache.licenses.set(id, lic);
      preparedStmts.upsertLicense.run(
        lic.id, lic.licenseKey, lic.status,
        lic.dealerId || null, null,
        JSON.stringify(lic), new Date().toISOString()
      );
      created.push(lic);
    }

    return created;
  },

  renewLicense({ vehicleId, licenseId = null, durationDays = 365 } = {}) {
    const vehicle = this.getDevice(vehicleId);
    if (!vehicle) throw new Error('Vehicle not found');

    let lic = null;
    if (licenseId && cache.licenses.has(licenseId)) {
      lic = cache.licenses.get(licenseId);
      lic.status = 'ACTIVE';
      lic.vehicleId = vehicle.imei;
      lic.vehicleNumberPlate = vehicle.numberPlate;
      lic.activatedAt = new Date().toISOString();
      const d = (lic.durationUnit === 'years' ? lic.durationValue * 365 : (lic.durationUnit === 'months' ? lic.durationValue * 30 : lic.durationValue || 365));
      lic.expiresAt = new Date(Date.now() + d * 24 * 3600 * 1000).toISOString();
    } else {
      const days = parseInt(durationDays, 10) || 365;
      const id = `lic_${Date.now().toString(36)}`;
      lic = {
        id,
        licenseKey: `TRX-${days >= 365 ? Math.round(days/365)+'Y' : days+'D'}-${Math.floor(1000 + Math.random() * 9000)}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
        durationValue: days >= 365 ? Math.round(days/365) : days,
        durationUnit: days >= 365 ? 'years' : 'days',
        durationInfo: `${days >= 365 ? Math.round(days/365)+' Year(s)' : days+' Days'} License Renewal`,
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        activatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + days * 24 * 3600 * 1000).toISOString(),
        vehicleId: vehicle.imei,
        vehicleNumberPlate: vehicle.numberPlate,
        createdBy: 'Admin Renewal'
      };
      cache.licenses.set(id, lic);
    }

    preparedStmts.upsertLicense.run(
      lic.id, lic.licenseKey, lic.status,
      lic.dealerId || null, lic.vehicleId || null,
      JSON.stringify(lic), new Date().toISOString()
    );

    vehicle.licenseId = lic.id;
    vehicle.license = lic;
    this.upsertVehicle(vehicle);

    return { vehicle, license: lic };
  },

  // -------------------------------------------------------------
  // 6. ALERTS, TRIPS & COMMAND LOGS
  // -------------------------------------------------------------
  saveAlert(alert) {
    const alertRecord = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      createdAt: new Date().toISOString(),
      ...alert
    };
    cache.alerts.unshift(alertRecord);
    if (cache.alerts.length > 500) cache.alerts.pop();

    try {
      preparedStmts.insertAlert.run(
        alertRecord.id,
        alertRecord.imei,
        alertRecord.type || 'ALERT',
        alertRecord.severity || 'MEDIUM',
        JSON.stringify(alertRecord),
        alertRecord.createdAt
      );
    } catch (err) {
      console.error('[DB] Error storing alert in SQLite:', err.message);
    }

    return alertRecord;
  },

  getAlerts(limit = 100) {
    return cache.alerts.slice(0, limit);
  },

  saveCommandLog(log) {
    const record = {
      id: Date.now().toString(36),
      timestamp: new Date().toISOString(),
      ...log
    };
    cache.commandLogs.unshift(record);
    if (cache.commandLogs.length > 200) cache.commandLogs.pop();

    try {
      preparedStmts.insertCommandLog.run(
        record.id,
        record.imei || 'UNKNOWN',
        JSON.stringify(record),
        record.timestamp
      );
    } catch (err) {
      console.error('[DB] Error storing command log in SQLite:', err.message);
    }

    return record;
  },

  getCommandLogs(imei = null) {
    if (imei) {
      return cache.commandLogs.filter(c => c.imei === imei);
    }
    return cache.commandLogs;
  },

  saveTrip(trip) {
    const tripRecord = {
      id: trip.tripId || `TRIP-${Date.now().toString(36).toUpperCase()}`,
      createdAt: new Date().toISOString(),
      ...trip
    };
    cache.trips.unshift(tripRecord);
    if (cache.trips.length > 500) cache.trips.pop();

    try {
      preparedStmts.insertTrip.run(
        tripRecord.id,
        tripRecord.imei,
        JSON.stringify(tripRecord),
        tripRecord.createdAt
      );
    } catch (err) {
      console.error('[DB] Error storing trip in SQLite:', err.message);
    }

    return tripRecord;
  },

  getTrips(imei = null, limit = 50) {
    if (imei) {
      return cache.trips.filter(t => t.imei === imei).slice(0, limit);
    }
    return cache.trips.slice(0, limit);
  },

  // -------------------------------------------------------------
  // 7. 3-MONTH (90-DAY) DATA RETENTION & MAINTENANCE
  // -------------------------------------------------------------
  purgeExpiredData(retentionDays = RETENTION_DAYS) {
    try {
      const days = parseInt(retentionDays, 10) || 90;
      console.log(`[DB] 🧹 Running automated CAN retention cleanup (> ${days} days)...`);
      
      const resTelemetry = sqliteDb.prepare(`
        DELETE FROM can_telemetry_history 
        WHERE datetime(timestamp) < datetime('now', '-' || ? || ' days')
      `).run(days);

      const resAlerts = sqliteDb.prepare(`
        DELETE FROM alerts 
        WHERE datetime(created_at) < datetime('now', '-' || ? || ' days')
      `).run(days);

      const resTrips = sqliteDb.prepare(`
        DELETE FROM trips 
        WHERE datetime(created_at) < datetime('now', '-' || ? || ' days')
      `).run(days);

      console.log(`[DB] 🧹 Retention cleanup complete. Purged: ${resTelemetry.changes || 0} CAN packets, ${resAlerts.changes || 0} alerts, ${resTrips.changes || 0} trips.`);
      
      // Periodic WAL checkpoint to keep file compact
      sqliteDb.exec(`PRAGMA wal_checkpoint(PASSIVE);`);
      
      return {
        success: true,
        retentionDays: days,
        purgedTelemetryCount: resTelemetry.changes || 0,
        purgedAlertsCount: resAlerts.changes || 0,
        purgedTripsCount: resTrips.changes || 0
      };
    } catch (err) {
      console.error('[DB] Error during retention cleanup:', err.message);
      return { success: false, error: err.message };
    }
  },

  // Database Storage Metrics & CAN Records Statistics
  getDatabaseStats() {
    try {
      const countRow = sqliteDb.prepare(`SELECT COUNT(*) as total FROM can_telemetry_history`).get();
      const minMaxRow = sqliteDb.prepare(`
        SELECT 
          MIN(timestamp) as oldest_record,
          MAX(timestamp) as newest_record,
          COUNT(DISTINCT imei) as active_devices_count
        FROM can_telemetry_history
      `).get();

      const perDeviceRows = sqliteDb.prepare(`
        SELECT imei, COUNT(*) as count, MAX(timestamp) as last_seen
        FROM can_telemetry_history
        GROUP BY imei
        ORDER BY count DESC
      `).all();

      let dbFileSizeBytes = 0;
      let walFileSizeBytes = 0;
      if (fs.existsSync(DB_FILE)) {
        dbFileSizeBytes = fs.statSync(DB_FILE).size;
      }
      if (fs.existsSync(`${DB_FILE}-wal`)) {
        walFileSizeBytes = fs.statSync(`${DB_FILE}-wal`).size;
      }

      const totalSizeMb = ((dbFileSizeBytes + walFileSizeBytes) / (1024 * 1024)).toFixed(2);

      return {
        databaseType: 'SQLite Native (WAL Mode)',
        databaseFilePath: DB_FILE,
        retentionPolicy: `${RETENTION_DAYS} Days (3 Months)`,
        totalCanTelemetryRecords: countRow.total || 0,
        totalDatabaseSizeMb: `${totalSizeMb} MB`,
        dbFileSizeBytes,
        walFileSizeBytes,
        oldestRecordTimestamp: minMaxRow.oldest_record || 'None',
        newestRecordTimestamp: minMaxRow.newest_record || 'None',
        activeDevicesTracked: minMaxRow.active_devices_count || 0,
        deviceRecordBreakdown: perDeviceRows
      };
    } catch (err) {
      console.error('[DB] Error fetching database stats:', err.message);
      return { error: err.message };
    }
  },

  // -------------------------------------------------------------
  // 8. STATS & FLEET ANALYTICS
  // -------------------------------------------------------------
  getFleetAnalytics() {
    const devices = Array.from(cache.devices.values());
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
      totalTripsCompleted: cache.trips.length,
      totalAlerts: cache.alerts.length
    };
  },

  getAdminStats() {
    const vehicles = Array.from(cache.devices.values());
    const users = Array.from(cache.users.values());
    const licenses = Array.from(cache.licenses.values());

    const onlineVehicles = vehicles.filter(v => v.status === 'ONLINE').length;
    const movingVehicles = vehicles.filter(v => v.status === 'ONLINE' && v.lastTelemetry && v.lastTelemetry.speed > 0).length;
    const idleVehicles = vehicles.filter(v => v.status === 'ONLINE' && v.lastTelemetry && v.lastTelemetry.speed === 0 && v.lastTelemetry.ignition).length;
    const activeLicenses = licenses.filter(l => l.status === 'ACTIVE').length;
    const availableLicenses = licenses.filter(l => l.status === 'AVAILABLE').length;

    const adminCount = users.filter(u => u.role === 'ADMIN').length;
    const dealerCount = users.filter(u => u.role === 'DEALER').length;
    const customerCount = users.filter(u => u.role === 'CUSTOMER').length;
    const driverCount = users.filter(u => u.role === 'DRIVER').length;

    const vehicleTypeCounts = {};
    vehicles.forEach(v => {
      const type = (v.vehicleType || 'CAR').toUpperCase();
      vehicleTypeCounts[type] = (vehicleTypeCounts[type] || 0) + 1;
    });

    return {
      totalVehicles: vehicles.length,
      onlineVehicles,
      offlineVehicles: vehicles.length - onlineVehicles,
      movingVehicles,
      idleVehicles,
      totalUsers: users.length,
      adminCount,
      dealerCount,
      customerCount,
      driverCount,
      totalLicenses: licenses.length,
      activeLicenses,
      availableLicenses,
      vehicleTypeCounts
    };
  }
};

module.exports = Database;
