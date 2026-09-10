/**
 * Advanced Trip Segmentation & Journey Analytics Engine
 * Automatically breaks vehicle movements into distinct trips, calculating
 * origin/destination, distance, runtime, idle time, fuel consumed, average speed, and economy.
 */

class TripEngine {
  constructor(options = {}) {
    this.fuelPricePerLiter = options.fuelPricePerLiter || 102.50;
    this.activeTrips = new Map(); // imei -> active trip
    this.completedTrips = new Map(); // imei -> Array<completedTrip>
  }

  /**
   * Process telemetry point for trip lifecycle management
   * @param {string} imei - Device IMEI
   * @param {object} telemetry - Normalized telemetry
   * @returns {object|null} Completed trip summary or null
   */
  process(imei, telemetry) {
    const now = telemetry.timestamp ? new Date(telemetry.timestamp).getTime() : Date.now();
    const speed = Number(telemetry.speed || telemetry.canSpeed || 0);
    const engineRpm = Number(telemetry.engineRpm || 0);
    const isIgnOn = Boolean(telemetry.ignition || engineRpm > 300);
    const currentOdo = Number(telemetry.totalMileageCan || telemetry.odometer || 0);
    const currentFuel = Number(telemetry.fuelLevelLiters || telemetry.fuelLiters || 0);
    const ecmFuel = (telemetry.ecmTotalFuelConsumed !== undefined && telemetry.ecmTotalFuelConsumed !== null)
      ? Number(telemetry.ecmTotalFuelConsumed)
      : null;

    let activeTrip = this.activeTrips.get(imei);
    let completedTripSummary = null;

    // CASE 1: Vehicle is Running (Trip in progress or new trip starting)
    if (isIgnOn || speed > 5) {
      if (!activeTrip) {
        // Start a New Trip
        activeTrip = {
          tripId: `TRIP-${Date.now().toString(36).toUpperCase()}`,
          imei,
          startTime: new Date(now).toISOString(),
          startOdo: currentOdo,
          startFuel: currentFuel,
          startEcmFuel: ecmFuel,
          startLat: telemetry.lat,
          startLng: telemetry.lng,
          lastTime: now,
          lastOdo: currentOdo,
          lastFuel: currentFuel,
          lastEcmFuel: ecmFuel,
          lastLat: telemetry.lat,
          lastLng: telemetry.lng,
          maxSpeed: speed,
          speedSamples: speed > 0 ? [speed] : [],
          drivingSeconds: speed > 3 ? 1 : 0,
          idleSeconds: speed <= 3 ? 1 : 0,
          fuelConsumed: 0,
          status: 'IN_PROGRESS'
        };
        this.activeTrips.set(imei, activeTrip);
      } else {
        // Update ongoing trip
        const dtSec = Math.max(0.1, (now - activeTrip.lastTime) / 1000);
        activeTrip.lastTime = now;
        activeTrip.lastOdo = currentOdo;
        activeTrip.lastFuel = currentFuel;
        activeTrip.lastLat = telemetry.lat;
        activeTrip.lastLng = telemetry.lng;

        if (speed > activeTrip.maxSpeed) {
          activeTrip.maxSpeed = speed;
        }

        if (speed > 3) {
          activeTrip.drivingSeconds += dtSec;
          activeTrip.speedSamples.push(speed);
        } else {
          activeTrip.idleSeconds += dtSec;
        }

        // Keep speed sample size bounded
        if (activeTrip.speedSamples.length > 500) {
          activeTrip.speedSamples = activeTrip.speedSamples.filter((_, idx) => idx % 2 === 0);
        }
      }
    }
    // CASE 2: Vehicle is Stopped / Ignition Turned OFF (End Trip)
    else if (!isIgnOn && activeTrip) {
      const distance = Math.max(0, currentOdo - activeTrip.startOdo);
      const durationMins = (now - new Date(activeTrip.startTime).getTime()) / (1000 * 60);

      // Only record trips longer than 0.2 km or 1 minute
      if (distance >= 0.1 || durationMins >= 1.0) {
        let fuelUsed = 0;
        if (ecmFuel !== null && activeTrip.startEcmFuel !== null && ecmFuel >= activeTrip.startEcmFuel) {
          fuelUsed = parseFloat((ecmFuel - activeTrip.startEcmFuel).toFixed(2));
        } else if (activeTrip.startFuel > currentFuel) {
          fuelUsed = parseFloat((activeTrip.startFuel - currentFuel).toFixed(2));
        } else {
          fuelUsed = parseFloat(((distance / 15.0) + (activeTrip.idleSeconds / 3600) * 0.8).toFixed(2));
        }

        const avgSpeed = activeTrip.speedSamples.length > 0
          ? Math.round(activeTrip.speedSamples.reduce((a, b) => a + b, 0) / activeTrip.speedSamples.length)
          : Math.round((distance / Math.max(0.01, durationMins / 60)));

        const economy = fuelUsed > 0.05 ? parseFloat((distance / fuelUsed).toFixed(1)) : 14.8;
        const cost = parseFloat((fuelUsed * this.fuelPricePerLiter).toFixed(2));

        completedTripSummary = {
          tripId: activeTrip.tripId,
          imei,
          startTime: activeTrip.startTime,
          endTime: new Date(now).toISOString(),
          durationMinutes: parseFloat(durationMins.toFixed(1)),
          drivingMinutes: parseFloat((activeTrip.drivingSeconds / 60).toFixed(1)),
          idleMinutes: parseFloat((activeTrip.idleSeconds / 60).toFixed(1)),
          distanceKm: parseFloat(distance.toFixed(2)),
          fuelConsumedLiters: fuelUsed,
          avgEconomyKmPerLiter: economy,
          avgSpeedKmH: avgSpeed,
          maxSpeedKmH: activeTrip.maxSpeed,
          estimatedCostInr: cost,
          startLocation: { lat: activeTrip.startLat, lng: activeTrip.startLng },
          endLocation: { lat: activeTrip.lastLat, lng: activeTrip.lastLng }
        };

        let deviceTrips = this.completedTrips.get(imei) || [];
        deviceTrips.unshift(completedTripSummary);
        if (deviceTrips.length > 100) deviceTrips.pop();
        this.completedTrips.set(imei, deviceTrips);
      }

      this.activeTrips.delete(imei);
    }

    return completedTripSummary;
  }

  getActiveTrip(imei) {
    return this.activeTrips.get(imei) || null;
  }

  getCompletedTrips(imei, limit = 20) {
    const list = this.completedTrips.get(imei) || [];
    return list.slice(0, limit);
  }
}

module.exports = TripEngine;
