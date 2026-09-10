/**
 * REST API Routes for Teltonika Telematics Suite
 */

const express = require('express');
const router = express.Router();
const Database = require('../database/db');
const { calculateLiters, generateLinearPoints, TANK_PRESETS } = require('../engine/calibration');
const { buildCodec8ExtPacket } = require('../simulator/packetGenerator');

module.exports = (tcpServer, wsBroadcaster) => {
  // 1. Get all devices with live state
  router.get('/devices', (req, res) => {
    const devices = Database.getAllDevices();
    // Inject real-time TCP socket connection status
    const result = devices.map(d => {
      const isOnline = tcpServer.isDeviceOnline(d.imei);
      return {
        ...d,
        status: isOnline ? 'ONLINE' : 'OFFLINE',
        isSocketConnected: isOnline
      };
    });
    res.json({ success: true, count: result.length, data: result });
  });

  // 2. Register New Device manually
  router.post('/devices', (req, res) => {
    const { imei, vehicleNumber, model, category, tankCapacity, fuelSource } = req.body;
    if (!imei || !vehicleNumber) {
      return res.status(400).json({ success: false, error: 'IMEI and Vehicle Number are required' });
    }

    const capacity = parseFloat(tankCapacity) || 480;
    const newDevice = Database.upsertDevice({
      imei: imei.trim(),
      vehicleNumber: vehicleNumber.trim(),
      model: model ? model.trim() : 'Teltonika Tracker',
      category: category || 'Vehicle',
      tankCapacity: capacity,
      fuelSource: fuelSource || 'CAN_PERCENT',
      calibrationPoints: generateLinearPoints(capacity, 4),
      status: 'OFFLINE',
      lastUpdated: new Date().toISOString()
    });

    res.json({ success: true, message: 'Device registered successfully', data: newDevice });
  });

  // 3. Delete Device
  router.delete('/devices/:imei', (req, res) => {
    const deleted = Database.deleteDevice(req.params.imei);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }
    res.json({ success: true, message: 'Device deleted successfully' });
  });

  // 4. Get single device
  router.get('/devices/:imei', (req, res) => {
    const device = Database.getDevice(req.params.imei);
    if (!device) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }
    const isOnline = tcpServer.isDeviceOnline(device.imei);
    res.json({
      success: true,
      data: {
        ...device,
        status: isOnline ? 'ONLINE' : 'OFFLINE',
        isSocketConnected: isOnline
      }
    });
  });

  // 3. Update device metadata
  router.put('/devices/:imei', (req, res) => {
    const { vehicleNumber, model, category, tankCapacity, fuelSource } = req.body;
    const existing = Database.getDevice(req.params.imei);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }

    const updated = Database.upsertDevice({
      imei: req.params.imei,
      vehicleNumber: vehicleNumber || existing.vehicleNumber,
      model: model || existing.model,
      category: category || existing.category,
      tankCapacity: tankCapacity ? parseFloat(tankCapacity) : existing.tankCapacity,
      fuelSource: fuelSource || existing.fuelSource
    });

    res.json({ success: true, data: updated });
  });

  // 4. Save Fuel Calibration Table
  router.post('/devices/:imei/calibration', (req, res) => {
    const { points, tankCapacity } = req.body;
    const existing = Database.getDevice(req.params.imei);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }

    if (!Array.isArray(points) || points.length === 0) {
      return res.status(400).json({ success: false, error: 'Points array required' });
    }

    const sortedPoints = points.map(p => ({
      raw: parseFloat(p.raw),
      liters: parseFloat(p.liters)
    })).sort((a, b) => a.raw - b.raw);

    const updated = Database.upsertDevice({
      imei: req.params.imei,
      tankCapacity: tankCapacity ? parseFloat(tankCapacity) : existing.tankCapacity,
      calibrationPoints: sortedPoints,
      isCalibrated: true
    });

    // Recalculate latest telemetry liters with new calibration
    if (updated.lastTelemetry && updated.lastTelemetry.fuelPercentage !== null) {
      const newLiters = calculateLiters(updated.lastTelemetry.fuelPercentage, sortedPoints);
      updated.lastTelemetry.fuelLiters = newLiters;
      Database.upsertDevice({
        imei: req.params.imei,
        lastTelemetry: updated.lastTelemetry
      });
      if (wsBroadcaster) {
        wsBroadcaster.broadcast('telemetry', {
          imei: req.params.imei,
          vehicleNumber: updated.vehicleNumber,
          data: updated.lastTelemetry
        });
      }
    }

    res.json({ success: true, message: 'Calibration saved successfully', data: updated });
  });

  // 5. Get Telemetry History (for route playback)
  router.get('/devices/:imei/history', (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 500;
    const history = Database.getHistory(req.params.imei, limit);
    res.json({ success: true, count: history.length, data: history });
  });

  // 6. Send Remote GPRS Command (Codec 12)
  router.post('/devices/:imei/command', (req, res) => {
    const { command } = req.body;
    if (!command) {
      return res.status(400).json({ success: false, error: 'Command string is required' });
    }

    try {
      const result = tcpServer.sendCommand(req.params.imei, command.trim());
      res.json({ success: true, message: `Command "${command}" queued and sent to device`, data: result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // 7. Get Recent Alerts
  router.get('/alerts', (req, res) => {
    const alerts = Database.getAlerts(parseInt(req.query.limit, 10) || 100);
    res.json({ success: true, count: alerts.length, data: alerts });
  });

  // 8. Get Command Logs
  router.get('/command-logs', (req, res) => {
    const logs = Database.getCommandLogs(req.query.imei || null);
    res.json({ success: true, count: logs.length, data: logs });
  });

  // 9. Get Tank Presets
  router.get('/presets', (req, res) => {
    res.json({ success: true, data: TANK_PRESETS });
  });

  // 10. Simulator Endpoint: Inject simulated packet directly
  router.post('/simulator/inject', (req, res) => {
    const { imei, lat, lng, speed, rpm, fuelPercentage, ignition, coolantTemp, odometer } = req.body;
    const targetImei = imei || '864032059281726';
    const device = Database.getDevice(targetImei);

    const telemetryRecord = {
      timestamp: new Date(),
      gps: {
        latitude: parseFloat(lat) || 11.6643,
        longitude: parseFloat(lng) || 78.1460,
        altitude: 278,
        angle: 180,
        satellites: 14,
        speed: parseInt(speed, 10) || 45,
        isValid: true
      },
      rawIos: {
        32: parseInt(rpm, 10) || 1600,
        83: parseFloat(fuelPercentage) || 75,
        239: ignition !== undefined ? (ignition ? 1 : 0) : 1,
        36: parseInt(coolantTemp, 10) || 85,
        16: (parseInt(odometer, 10) || 142580) * 1000
      },
      telemetry: {
        engineRpm: parseInt(rpm, 10) || 1600,
        fuelLevelPercentage: parseFloat(fuelPercentage) || 75,
        ignition: ignition !== undefined ? Boolean(ignition) : true,
        coolantTemp: parseInt(coolantTemp, 10) || 85,
        odometer: parseFloat(odometer) || 142580
      }
    };

    const calculatedLiters = calculateLiters(
      telemetryRecord.telemetry.fuelLevelPercentage,
      device ? device.calibrationPoints : null
    );

    const saved = Database.saveTelemetry(targetImei, telemetryRecord, calculatedLiters);

    // Theft / Refuel Analysis
    const alert = tcpServer.theftDetector.process(targetImei, saved);
    if (alert) {
      const savedAlert = Database.saveAlert({
        imei: targetImei,
        vehicleNumber: device ? device.vehicleNumber : `VEH-${targetImei.slice(-4)}`,
        ...alert
      });
      if (wsBroadcaster) wsBroadcaster.broadcast('alert', savedAlert);
    }

    if (wsBroadcaster) {
      wsBroadcaster.broadcast('telemetry', {
        imei: targetImei,
        vehicleNumber: device ? device.vehicleNumber : `VEH-${targetImei.slice(-4)}`,
        data: saved
      });
    }

    res.json({ success: true, message: 'Telemetry injected successfully', data: saved });
  });

  // 10. Get Device Completed Trips
  router.get('/devices/:imei/trips', (req, res) => {
    const trips = Database.getTrips(req.params.imei, parseInt(req.query.limit, 10) || 50);
    res.json({ success: true, count: trips.length, data: trips });
  });

  // 11. Get Driver Behavior & Eco Score
  router.get('/devices/:imei/driver-score', (req, res) => {
    const metrics = tcpServer.driverBehaviorEngine ? tcpServer.driverBehaviorEngine.getMetrics(req.params.imei) : null;
    const device = Database.getDevice(req.params.imei);
    const lastTel = device ? device.lastTelemetry : {};
    res.json({
      success: true,
      data: {
        imei: req.params.imei,
        safetyScore: lastTel.safetyScore || (metrics ? metrics.safetyScore : 95),
        ratingLabel: lastTel.ratingLabel || (metrics ? metrics.ratingLabel : 'EXEMPLARY'),
        ratingBadge: lastTel.ratingBadge || (metrics ? metrics.ratingBadge : '🏆'),
        harshAccelCount: lastTel.harshAccelCount || (metrics ? metrics.harshAccelCount : 0),
        harshBrakeCount: lastTel.harshBrakeCount || (metrics ? metrics.harshBrakeCount : 0),
        harshCornerCount: lastTel.harshCornerCount || (metrics ? metrics.harshCornerCount : 0),
        overspeedCount: lastTel.overspeedCount || (metrics ? metrics.overspeedCount : 0),
        idleTimeMinutes: lastTel.idleTimeMinutes || (metrics ? metrics.idleTimeMinutes : 0),
        drivingTimeMinutes: lastTel.drivingTimeMinutes || (metrics ? metrics.drivingTimeMinutes : 0)
      }
    });
  });

  // 12. Fleet Overview & Aggregated Analytics
  router.get('/fleet/analytics', (req, res) => {
    const analytics = Database.getFleetAnalytics();
    res.json({ success: true, data: analytics });
  });

  // 13. System Health & Diagnostics
  router.get('/health', (req, res) => {
    res.json({
      success: true,
      service: 'Traxen Teltonika Telematics Hub',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      activeSocketsCount: tcpServer.activeSockets.size,
      connectedImeis: Array.from(tcpServer.activeSockets.keys()),
      memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    });
  });

  return router;
};
