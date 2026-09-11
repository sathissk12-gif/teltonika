/**
 * REST API Routes for Teltonika Telematics Suite
 * Includes complete Traxen-compatible Admin Vehicle, User, and License endpoints.
 */

const express = require('express');
const router = express.Router();
const Database = require('../database/db');
const { calculateLiters, generateLinearPoints, TANK_PRESETS } = require('../engine/calibration');
const { buildCodec8ExtPacket } = require('../simulator/packetGenerator');

module.exports = (tcpServer, wsBroadcaster) => {
  // -------------------------------------------------------------
  // 1. LEGACY & LIVE DEVICE APIS
  // -------------------------------------------------------------
  router.get('/devices', (req, res) => {
    const devices = Database.getAllDevices();
    const result = devices.map(d => {
      const isOnline = tcpServer.isDeviceOnline(d.imei);
      const dailyData = Database.getDailySummaries(d.imei, 1);
      return {
        ...d,
        status: isOnline ? 'ONLINE' : (d.status || 'OFFLINE'),
        isSocketConnected: isOnline,
        todaySummary: dailyData.today || {
          distanceKm: 0.0,
          fuelUsedLiters: 0.0,
          mileageKmpl: 0.0,
          fuelPerKm: 0.0,
          fuelCost: 0.0,
          runningMinutes: 0,
          idleMinutes: 0
        }
      };
    });
    res.json({ success: true, count: result.length, data: result });
  });

  router.post('/devices', (req, res) => {
    try {
      const vehicle = Database.upsertVehicle(req.body);
      res.json({ success: true, message: 'Vehicle saved successfully', data: vehicle });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

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
        status: isOnline ? 'ONLINE' : (device.status || 'OFFLINE'),
        isSocketConnected: isOnline
      }
    });
  });

  router.put('/devices/:imei', (req, res) => {
    try {
      const updated = Database.upsertVehicle({ ...req.body, imei: req.params.imei });
      res.json({ success: true, data: updated });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.delete('/devices/:imei', (req, res) => {
    const deleted = Database.deleteVehicle(req.params.imei);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }
    res.json({ success: true, message: 'Device deleted successfully' });
  });

  // -------------------------------------------------------------
  // 2. ADMIN VEHICLES MANAGEMENT
  // -------------------------------------------------------------
  router.get('/admin/vehicles', (req, res) => {
    try {
      const { role, userId, status, vehicleType, search, offset, limit } = req.query;
      const result = Database.getAllVehicles({
        role,
        userId,
        status,
        vehicleType,
        search,
        offset: parseInt(offset, 10) || 0,
        limit: parseInt(limit, 10) || 50
      });

      // Inject socket online statuses
      result.vehicles = result.vehicles.map(v => {
        const isOnline = tcpServer.isDeviceOnline(v.imei);
        return {
          ...v,
          status: isOnline ? 'ONLINE' : (v.status || 'OFFLINE'),
          isSocketConnected: isOnline
        };
      });

      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/admin/vehicles/:id', (req, res) => {
    const vehicle = Database.getDevice(req.params.id);
    if (!vehicle) {
      return res.status(404).json({ success: false, error: 'Vehicle not found' });
    }
    const isOnline = tcpServer.isDeviceOnline(vehicle.imei);
    const license = vehicle.licenseId ? Database.getAllLicenses().licenses.find(l => l.id === vehicle.licenseId) : vehicle.license;
    const assignedUsers = (vehicle.userIds || []).map(uid => Database.getUser(uid)).filter(Boolean);

    res.json({
      success: true,
      data: {
        ...vehicle,
        license,
        assignedUsers,
        status: isOnline ? 'ONLINE' : (vehicle.status || 'OFFLINE'),
        isSocketConnected: isOnline
      }
    });
  });

  router.post('/admin/vehicles', (req, res) => {
    try {
      const {
        registrationNumber,
        numberPlate,
        vehicleType,
        imei,
        simNumber,
        simProvider,
        protocol,
        userIds,
        licenseId,
        licenseDurationDays,
        tankCapacity,
        fuelSource,
        acEnabled,
        callAlertEnabled,
        callAlertPhoneNumber,
        positionStoreIntervalSeconds,
        statusRetentionMonths,
        ownerName
      } = req.body;

      if (!imei) {
        return res.status(400).json({ success: false, error: 'Vehicle IMEI is required (15 digits)' });
      }

      const vehicle = Database.upsertVehicle({
        imei: imei.trim(),
        registrationNumber: (registrationNumber || numberPlate || `TN-${imei.slice(-4)}`).trim(),
        numberPlate: (registrationNumber || numberPlate || `TN-${imei.slice(-4)}`).trim(),
        vehicleType: vehicleType || 'CAR',
        ownerName: ownerName || '',
        simNumber: simNumber ? simNumber.trim() : '',
        simProvider: simProvider || 'Airtel',
        protocol: protocol || 'Teltonika Codec 8 Extended',
        userIds: userIds || ['usr_cust_01'],
        licenseId: licenseId || null,
        licenseDurationDays: licenseDurationDays ? parseInt(licenseDurationDays, 10) : null,
        tankCapacity: parseFloat(tankCapacity) || 480,
        fuelSource: fuelSource || 'CAN_PERCENT',
        acEnabled: Boolean(acEnabled),
        callAlertEnabled: Boolean(callAlertEnabled),
        callAlertPhoneNumber: callAlertPhoneNumber || '',
        positionStoreIntervalSeconds: parseInt(positionStoreIntervalSeconds, 10) || 10,
        statusRetentionMonths: parseInt(statusRetentionMonths, 10) || 12
      });

      res.json({ success: true, message: 'Vehicle created successfully', data: vehicle });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.put('/admin/vehicles/:id', (req, res) => {
    try {
      const existing = Database.getDevice(req.params.id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Vehicle not found' });
      }

      const updated = Database.upsertVehicle({
        ...existing,
        ...req.body,
        imei: existing.imei
      });

      res.json({ success: true, message: 'Vehicle updated successfully', data: updated });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.delete('/admin/vehicles/:id', (req, res) => {
    const deleted = Database.deleteVehicle(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Vehicle not found' });
    }
    res.json({ success: true, message: 'Vehicle deleted successfully' });
  });

  router.post('/admin/vehicles/:id/assign-users', (req, res) => {
    try {
      const { userIds } = req.body;
      if (!Array.isArray(userIds)) {
        return res.status(400).json({ success: false, error: 'userIds must be an array' });
      }
      const vehicle = Database.assignUsersToVehicle(req.params.id, userIds);
      res.json({ success: true, message: 'Users assigned successfully', data: vehicle });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/admin/vehicles/:id/manual-km', (req, res) => {
    try {
      const { addedKm, forever, date, notes } = req.body;
      const vehicle = Database.addManualKm(req.params.id, { addedKm, forever, date, notes });
      res.json({ success: true, message: 'Manual KM updated successfully', data: vehicle });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // -------------------------------------------------------------
  // 3. ADMIN USER MANAGEMENT
  // -------------------------------------------------------------
  router.get('/admin/users', (req, res) => {
    try {
      const { role, search, offset, limit } = req.query;
      const result = Database.getAllUsers({
        role,
        search,
        offset: parseInt(offset, 10) || 0,
        limit: parseInt(limit, 10) || 50
      });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/admin/users/:id', (req, res) => {
    const user = Database.getUser(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    // Get assigned vehicles
    const assignedVehicles = Database.getAllDevices().filter(v => (v.userIds && v.userIds.includes(user.id)) || v.primaryUserId === user.id);
    res.json({
      success: true,
      data: {
        ...user,
        assignedVehicles
      }
    });
  });

  router.post('/admin/users', (req, res) => {
    try {
      const { name, email, phone, role, address, supportPhone, supportPhone2, supportAddress, supportEmail, assignedVehicleIds } = req.body;
      if (!name) {
        return res.status(400).json({ success: false, error: 'User name is required' });
      }

      const user = Database.upsertUser({
        name: name.trim(),
        email: email ? email.trim() : null,
        phone: phone ? phone.trim() : null,
        role: role || 'CUSTOMER',
        address: address || null,
        supportPhone: supportPhone || null,
        supportPhone2: supportPhone2 || null,
        supportAddress: supportAddress || null,
        supportEmail: supportEmail || null,
        assignedVehicleIds: Array.isArray(assignedVehicleIds) ? assignedVehicleIds : []
      });

      res.json({ success: true, message: 'User account created successfully', data: user });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.put('/admin/users/:id', (req, res) => {
    try {
      const existing = Database.getUser(req.params.id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const updated = Database.upsertUser({
        ...existing,
        ...req.body,
        id: existing.id
      });

      res.json({ success: true, message: 'User updated successfully', data: updated });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.delete('/admin/users/:id', (req, res) => {
    const deleted = Database.deleteUser(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    res.json({ success: true, message: 'User deleted successfully' });
  });

  // -------------------------------------------------------------
  // 4. ADMIN LICENSES MANAGEMENT
  // -------------------------------------------------------------
  router.get('/admin/licenses', (req, res) => {
    try {
      const { status, dealerId, offset, limit } = req.query;
      const result = Database.getAllLicenses({
        status,
        dealerId,
        offset: parseInt(offset, 10) || 0,
        limit: parseInt(limit, 10) || 50
      });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/admin/licenses', (req, res) => {
    try {
      const { durationValue, durationUnit, count, dealerId, createdBy } = req.body;
      const created = Database.createLicense({
        durationValue: parseInt(durationValue, 10) || 1,
        durationUnit: durationUnit || 'years',
        count: parseInt(count, 10) || 1,
        dealerId: dealerId || null,
        createdBy: createdBy || 'Master Admin'
      });
      res.json({ success: true, message: `${created.length} licenses generated successfully`, data: created });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/admin/licenses/renew', (req, res) => {
    try {
      const { vehicleId, licenseId, durationDays } = req.body;
      if (!vehicleId) {
        return res.status(400).json({ success: false, error: 'vehicleId is required' });
      }
      const result = Database.renewLicense({ vehicleId, licenseId, durationDays });
      res.json({ success: true, message: 'License renewed successfully', data: result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // -------------------------------------------------------------
  // 5. ADMIN OVERVIEW & STATS
  // -------------------------------------------------------------
  router.get('/admin/stats', (req, res) => {
    try {
      const stats = Database.getAdminStats();
      res.json({ success: true, data: stats });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // -------------------------------------------------------------
  // 6. FUEL CALIBRATION & SENSORS
  // -------------------------------------------------------------
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

    const updated = Database.upsertVehicle({
      imei: req.params.imei,
      tankCapacity: tankCapacity ? parseFloat(tankCapacity) : existing.tankCapacity,
      calibrationPoints: sortedPoints,
      isCalibrated: true
    });

    if (updated.lastTelemetry && updated.lastTelemetry.fuelPercentage !== null) {
      const newLiters = calculateLiters(updated.lastTelemetry.fuelPercentage, sortedPoints);
      updated.lastTelemetry.fuelLiters = newLiters;
      Database.upsertVehicle({
        imei: req.params.imei,
        lastTelemetry: updated.lastTelemetry
      });
      if (wsBroadcaster) {
        wsBroadcaster.broadcast('telemetry', {
          imei: req.params.imei,
          vehicleNumber: updated.numberPlate || updated.vehicleNumber,
          data: updated.lastTelemetry
        });
      }
    }

    res.json({ success: true, message: 'Calibration saved successfully', data: updated });
  });

  // -------------------------------------------------------------
  // 7. TELEMETRY HISTORY, 3-MONTH CAN ANALYTICS & PLAYBACK
  // -------------------------------------------------------------
  router.get('/devices/:imei/history', (req, res) => {
    try {
      const { limit, from, to } = req.query;
      const history = Database.getHistory(req.params.imei, {
        limit: parseInt(limit, 10) || 500,
        from: from || null,
        to: to || null
      });
      res.json({ success: true, count: history.length, data: history });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/devices/:imei/can-analytics', (req, res) => {
    try {
      const { from, to, interval } = req.query;
      const analytics = Database.getCanAnalytics(req.params.imei, {
        from: from || null,
        to: to || null,
        interval: interval || 'hourly'
      });
      res.json({ success: true, data: analytics });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/devices/:imei/fuel-events', (req, res) => {
    try {
      const { from, to, minFillLiters, minDrainLiters } = req.query;
      const events = Database.getFuelEvents(req.params.imei, {
        from: from || null,
        to: to || null,
        minFillLiters: minFillLiters ? parseFloat(minFillLiters) : 5.0,
        minDrainLiters: minDrainLiters ? parseFloat(minDrainLiters) : 4.0
      });
      res.json({ success: true, data: events });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/devices/:imei/playback', (req, res) => {
    try {
      const { from, to, limit } = req.query;
      const playback = Database.getPlayback(req.params.imei, {
        from: from || null,
        to: to || null,
        limit: parseInt(limit, 10) || 5000
      });
      res.json({ success: true, data: playback });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/admin/database/stats', (req, res) => {
    try {
      const stats = Database.getDatabaseStats();
      res.json({ success: true, data: stats });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/admin/database/maintenance', (req, res) => {
    try {
      const { retentionDays } = req.body;
      const result = Database.purgeExpiredData(retentionDays);
      res.json({ success: true, message: 'Database retention maintenance executed successfully', data: result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

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

  router.get('/alerts', (req, res) => {
    const alerts = Database.getAlerts(parseInt(req.query.limit, 10) || 100);
    res.json({ success: true, count: alerts.length, data: alerts });
  });

  router.get('/command-logs', (req, res) => {
    const logs = Database.getCommandLogs(req.query.imei || null);
    res.json({ success: true, count: logs.length, data: logs });
  });

  router.get('/presets', (req, res) => {
    res.json({ success: true, data: TANK_PRESETS });
  });

  // -------------------------------------------------------------
  // 8. SIMULATOR INJECTION
  // -------------------------------------------------------------
  router.post('/simulator/inject', (req, res) => {
    const { imei, lat, lng, speed, rpm, fuelPercentage, ignition, coolantTemp, odometer } = req.body;
    const targetImei = imei || '353742372466615';
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
    const alert = tcpServer.theftDetector ? tcpServer.theftDetector.process(targetImei, saved) : null;
    if (alert) {
      const savedAlert = Database.saveAlert({
        imei: targetImei,
        vehicleNumber: device ? (device.numberPlate || device.vehicleNumber) : `VEH-${targetImei.slice(-4)}`,
        ...alert
      });
      if (wsBroadcaster) wsBroadcaster.broadcast('alert', savedAlert);
    }

    if (wsBroadcaster) {
      wsBroadcaster.broadcast('telemetry', {
        imei: targetImei,
        vehicleNumber: device ? (device.numberPlate || device.vehicleNumber) : `VEH-${targetImei.slice(-4)}`,
        data: saved
      });
    }

    res.json({ success: true, message: 'Telemetry injected successfully', data: saved });
  });

  router.get('/devices/:imei/trips', (req, res) => {
    const { from, to, limit } = req.query;
    const trips = Database.getTrips(req.params.imei, parseInt(limit, 10) || 50, from || null, to || null);
    res.json({ success: true, count: trips.length, data: trips });
  });

  router.get('/devices/:imei/daily-summary', (req, res) => {
    const days = parseInt(req.query.days, 10) || 7;
    const result = Database.getDailySummaries(req.params.imei, days);
    res.json({ success: true, data: result });
  });

  router.post('/devices/:imei/reset-simulation', (req, res) => {
    const { imei } = req.params;
    const result = Database.purgeSimulationData(imei);
    if (tcpServer.mileageEngine) tcpServer.mileageEngine.resetTrip(imei);
    if (tcpServer.tripEngine) tcpServer.tripEngine.resetTrips(imei);
    res.json({ success: true, message: `All simulation and test history cleared for vehicle ${imei}. Fresh 0.0 KM real tracking active.`, data: result });
  });

  router.post('/admin/purge-all-simulation', (req, res) => {
    const result = Database.purgeSimulationData(null);
    if (tcpServer.mileageEngine) {
      for (const imei of tcpServer.mileageEngine.deviceTrips.keys()) {
        tcpServer.mileageEngine.resetTrip(imei);
      }
    }
    if (tcpServer.tripEngine) {
      tcpServer.tripEngine.resetTrips(null);
    }
    res.json({ success: true, message: 'All simulation data across all devices cleared.', data: result });
  });

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

  router.get('/fleet/analytics', (req, res) => {
    const analytics = Database.getFleetAnalytics();
    res.json({ success: true, data: analytics });
  });

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
