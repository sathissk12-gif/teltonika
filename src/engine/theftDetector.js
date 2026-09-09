/**
 * Fuel Theft and Refuel Event Detection Engine
 */

class FuelTheftDetector {
  constructor(options = {}) {
    this.theftThresholdLiters = options.theftThresholdLiters || 5.0;
    this.theftWindowMinutes = options.theftWindowMinutes || 10;
    this.refuelThresholdLiters = options.refuelThresholdLiters || 10.0;
    
    // In-memory sliding window cache per device: imei -> Array<{ liters, timestamp, ignition, lat, lng }>
    this.history = new Map();
  }

  /**
   * Evaluates incoming telemetry point for fuel theft or refueling
   * @param {string} imei - Device IMEI
   * @param {object} telemetry - Current parsed telemetry with { fuelLiters, ignition, lat, lng, timestamp }
   * @returns {object|null} Alert event or null
   */
  process(imei, currentPoint) {
    if (currentPoint.fuelLiters === null || currentPoint.fuelLiters === undefined) {
      return null;
    }

    const now = new Date(currentPoint.timestamp || Date.now());
    let deviceHistory = this.history.get(imei);

    if (!deviceHistory) {
      deviceHistory = [];
      this.history.set(imei, deviceHistory);
    }

    // Add current point
    deviceHistory.push({
      liters: currentPoint.fuelLiters,
      ignition: currentPoint.ignition,
      lat: currentPoint.lat,
      lng: currentPoint.lng,
      timestamp: now
    });

    // Prune points older than the detection window (e.g. 15 minutes)
    const cutoffTime = new Date(now.getTime() - (this.theftWindowMinutes + 5) * 60 * 1000);
    deviceHistory = deviceHistory.filter(p => p.timestamp >= cutoffTime);
    this.history.set(imei, deviceHistory);

    if (deviceHistory.length < 2) {
      return null;
    }

    const oldestPoint = deviceHistory[0];
    const diff = currentPoint.fuelLiters - oldestPoint.liters;

    // 1. Check for Refuel (+10L jump)
    if (diff >= this.refuelThresholdLiters) {
      // Clear history after event to avoid double-triggering
      this.history.set(imei, [deviceHistory[deviceHistory.length - 1]]);
      return {
        type: 'REFUEL',
        severity: 'INFO',
        title: 'Fuel Refill Detected',
        message: `Vehicle refueled by +${diff.toFixed(1)} Liters (${oldestPoint.liters}L ➔ ${currentPoint.fuelLiters}L)`,
        diffLiters: parseFloat(diff.toFixed(2)),
        startLiters: oldestPoint.liters,
        endLiters: currentPoint.fuelLiters,
        lat: currentPoint.lat,
        lng: currentPoint.lng,
        timestamp: now
      };
    }

    // 2. Check for Theft (-5L drop while Ignition is OFF)
    // If ignition is OFF (or false) and fuel drops rapidly
    if (diff <= -this.theftThresholdLiters && (!currentPoint.ignition || currentPoint.ignition === 'OFF')) {
      const litersLost = Math.abs(diff);
      this.history.set(imei, [deviceHistory[deviceHistory.length - 1]]);
      return {
        type: 'FUEL_THEFT',
        severity: 'CRITICAL',
        title: '⚠️ Fuel Theft Alert!',
        message: `Critical fuel drop of ${litersLost.toFixed(1)} Liters detected while ignition is OFF! (${oldestPoint.liters}L ➔ ${currentPoint.fuelLiters}L)`,
        diffLiters: parseFloat(litersLost.toFixed(2)),
        startLiters: oldestPoint.liters,
        endLiters: currentPoint.fuelLiters,
        lat: currentPoint.lat,
        lng: currentPoint.lng,
        timestamp: now
      };
    }

    return null;
  }
}

module.exports = FuelTheftDetector;
