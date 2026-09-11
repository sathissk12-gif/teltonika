/**
 * Advanced Trip Segmentation & Journey Analytics Engine
 * Automatically breaks vehicle movements into distinct trips, calculating
 * origin/destination, distance, runtime, idle time, fuel consumed, average speed, and economy.
 */

const EARTH_RADIUS_KM = 6371.0;

function calculateHaversineKm(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

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
    const isIgnOn = Boolean(telemetry.ignition === true || telemetry.ignition === 'ON' || telemetry.ignition === 1 || engineRpm > 300 || speed > 3);
    const currentLat = parseFloat(telemetry.lat !== undefined ? telemetry.lat : (telemetry.latitude || 0));
    const currentLng = parseFloat(telemetry.lng !== undefined ? telemetry.lng : (telemetry.longitude || 0));

    let currentOdo = 0;
    if (telemetry.totalMileageCan && Number(telemetry.totalMileageCan) > 0) {
      currentOdo = Number(telemetry.totalMileageCan);
    } else if (telemetry.odometer && Number(telemetry.odometer) > 0) {
      currentOdo = Number(telemetry.odometer);
    }

    const currentFuel = Number(telemetry.fuelLevelLiters || telemetry.fuelLiters || 0);
    const ecmFuel = (telemetry.ecmTotalFuelConsumed !== undefined && telemetry.ecmTotalFuelConsumed !== null)
      ? Number(telemetry.ecmTotalFuelConsumed)
      : null;

    let activeTrip = this.activeTrips.get(imei);
    let completedTripSummary = null;

    // CASE 1: Vehicle is Running (Trip in progress or new trip starting)
    if (isIgnOn || speed > 3) {
      if (!activeTrip) {
        // Start a New Trip
        activeTrip = {
          tripId: `TRIP-${Date.now().toString(36).toUpperCase()}`,
          imei,
          startTime: new Date(now).toISOString(),
          startOdo: currentOdo,
          startFuel: currentFuel,
          startEcmFuel: ecmFuel,
          startLat: currentLat,
          startLng: currentLng,
          lastTime: now,
          lastOdo: currentOdo,
          lastFuel: currentFuel,
          lastEcmFuel: ecmFuel,
          lastLat: currentLat,
          lastLng: currentLng,
          accumulatedDistanceKm: 0,
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
        const dtHours = dtSec / 3600;
        activeTrip.lastTime = now;

        // Compute step distance (GPS Haversine preferred)
        let stepDist = 0;
        if (currentLat !== 0 && currentLng !== 0 && activeTrip.lastLat !== 0 && activeTrip.lastLng !== 0) {
          const gpsD = calculateHaversineKm(activeTrip.lastLat, activeTrip.lastLng, currentLat, currentLng);
          if (gpsD >= 0.003 && (dtHours === 0 || (gpsD / dtHours) < 180)) {
            stepDist = gpsD;
          }
        }

        if (stepDist === 0 && speed > 2 && dtHours > 0 && dtHours < 0.05) {
          stepDist = speed * dtHours;
        }

        if (currentOdo > 0 && activeTrip.lastOdo > 0 && currentOdo > activeTrip.lastOdo) {
          const odoDelta = currentOdo - activeTrip.lastOdo;
          if (odoDelta > 0 && odoDelta < 10) {
            if (stepDist === 0 || Math.abs(odoDelta - stepDist) / Math.max(0.1, stepDist) < 0.4) {
              stepDist = Math.max(stepDist, odoDelta);
            }
          }
        }

        activeTrip.accumulatedDistanceKm += stepDist;
        activeTrip.lastOdo = currentOdo > 0 ? currentOdo : activeTrip.lastOdo;
        activeTrip.lastFuel = currentFuel;
        if (currentLat !== 0 && currentLng !== 0) {
          activeTrip.lastLat = currentLat;
          activeTrip.lastLng = currentLng;
        }

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
      let distance = parseFloat(activeTrip.accumulatedDistanceKm.toFixed(2));
      const durationMins = (now - new Date(activeTrip.startTime).getTime()) / (1000 * 60);

      // Check CAN Odometer delta as backup
      if (distance <= 0.05 && currentOdo > 0 && activeTrip.startOdo > 0 && currentOdo > activeTrip.startOdo) {
        const odoD = currentOdo - activeTrip.startOdo;
        if (odoD > 0 && odoD < 1500) {
          distance = parseFloat(odoD.toFixed(2));
        }
      }

      // Only record trips longer than 0.1 km or 1 minute
      if (distance >= 0.1 || durationMins >= 1.0) {
        let fuelUsed = 0;
        if (ecmFuel !== null && activeTrip.startEcmFuel !== null && ecmFuel >= activeTrip.startEcmFuel) {
          fuelUsed = parseFloat((ecmFuel - activeTrip.startEcmFuel).toFixed(2));
        } else if (activeTrip.startFuel > currentFuel && (activeTrip.startFuel - currentFuel) <= (distance * 0.5)) {
          fuelUsed = parseFloat((activeTrip.startFuel - currentFuel).toFixed(2));
        } else {
          fuelUsed = parseFloat(((distance / 14.8) + (activeTrip.idleSeconds / 3600) * 0.8).toFixed(2));
        }
        fuelUsed = parseFloat(Math.max(0.02, fuelUsed).toFixed(2));

        const avgSpeed = activeTrip.speedSamples.length > 0
          ? Math.round(activeTrip.speedSamples.reduce((a, b) => a + b, 0) / activeTrip.speedSamples.length)
          : Math.round((distance / Math.max(0.01, durationMins / 60)));

        const economy = distance > 0.05 && fuelUsed > 0.01 ? parseFloat((distance / fuelUsed).toFixed(2)) : 14.8;
        const fuelPerKm = distance > 0.05 && fuelUsed > 0.01 ? parseFloat((fuelUsed / distance).toFixed(3)) : parseFloat((1 / economy).toFixed(3));
        const cost = parseFloat((fuelUsed * this.fuelPricePerLiter).toFixed(2));
        const costPerKm = parseFloat((fuelPerKm * this.fuelPricePerLiter).toFixed(2));

        completedTripSummary = {
          tripId: activeTrip.tripId,
          imei,
          startTime: activeTrip.startTime,
          endTime: new Date(now).toISOString(),
          durationMinutes: parseFloat(durationMins.toFixed(1)),
          drivingMinutes: parseFloat((activeTrip.drivingSeconds / 60).toFixed(1)),
          idleMinutes: parseFloat((activeTrip.idleSeconds / 60).toFixed(1)),
          distanceKm: distance,
          fuelConsumedLiters: fuelUsed,
          mileageKmPerLiter: economy,
          fuelPerKm: fuelPerKm,
          avgSpeedKmH: avgSpeed,
          maxSpeedKmH: activeTrip.maxSpeed,
          costTotal: cost,
          costPerKm: costPerKm,
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

