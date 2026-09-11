/**
 * Advanced Mileage & Fuel Economy Calculation Engine
 * Computes Instantaneous Mileage (km/L), Average Trip Economy, Fuel Consumed,
 * Driving Distance, and Cost Per Kilometer for commercial fleets & passenger vehicles.
 */

// Earth radius in kilometers for Haversine distance
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

class MileageEngine {
  constructor(options = {}) {
    this.fuelPricePerLiter = options.fuelPricePerLiter || 102.50; // Default INR per Liter
    this.deviceTrips = new Map(); // imei -> trip state
  }

  /**
   * Process incoming telemetry and append rich mileage metrics with ECM Injection Data
   * @param {string} imei - Device IMEI
   * @param {object} telemetry - Current telemetry point
   * @param {object} deviceProfile - Device configuration (category, tankCapacity, etc.)
   * @returns {object} Calculated mileage & ECM fuel metrics
   */
  process(imei, telemetry, deviceProfile = {}) {
    let trip = this.deviceTrips.get(imei);
    const now = telemetry.timestamp ? new Date(telemetry.timestamp).getTime() : Date.now();
    const rawIos = telemetry.rawIos || {};

    const currentLat = parseFloat(telemetry.lat !== undefined ? telemetry.lat : (telemetry.latitude || 0));
    const currentLng = parseFloat(telemetry.lng !== undefined ? telemetry.lng : (telemetry.longitude || 0));

    // Odometer: if CAN total mileage is given (in km), use it; otherwise standard odometer
    let currentOdo = 0;
    if (telemetry.totalMileageCan && Number(telemetry.totalMileageCan) > 0) {
      currentOdo = Number(telemetry.totalMileageCan);
    } else if (telemetry.odometer && Number(telemetry.odometer) > 0) {
      currentOdo = Number(telemetry.odometer);
    } else if (telemetry.odometerKm && Number(telemetry.odometerKm) > 0) {
      currentOdo = Number(telemetry.odometerKm);
    }

    const currentFuel = (telemetry.fuelLevelLiters !== undefined && telemetry.fuelLevelLiters !== null) 
      ? Number(telemetry.fuelLevelLiters) 
      : Number(telemetry.fuelLiters || 0);

    const speed = Number(telemetry.speed || telemetry.canSpeed || 0);
    const engineRpm = Number(telemetry.engineRpm || (rawIos[85] !== undefined ? Number(rawIos[85]) : (rawIos[32] !== undefined ? Number(rawIos[32]) : 0)));
    const acceleratorPedal = telemetry.acceleratorPedal !== undefined ? Number(telemetry.acceleratorPedal) : (rawIos[82] !== undefined ? Number(rawIos[82]) : (rawIos[35] !== undefined ? Number(rawIos[35]) : 0));
    const engineLoad = telemetry.engineLoad !== undefined ? Number(telemetry.engineLoad) : (rawIos[31] !== undefined ? Number(rawIos[31]) : 0);

    // Direct ECM Total Fuel Consumed (AVL ID 88 / AVL ID 107 - Liters)
    let ecmTotalFuelConsumed = null;
    if (rawIos[88] !== undefined) {
      ecmTotalFuelConsumed = parseFloat((Number(rawIos[88]) * 0.1).toFixed(2));
    } else if (rawIos[107] !== undefined) {
      ecmTotalFuelConsumed = parseFloat((Number(rawIos[107]) * 0.1).toFixed(2));
    } else if (telemetry.totalFuelConsumed !== undefined && telemetry.totalFuelConsumed !== null) {
      ecmTotalFuelConsumed = parseFloat(Number(telemetry.totalFuelConsumed).toFixed(2));
    }

    // Direct ECM Instant Fuel Rate (L/h)
    let directEcmFuelRate = null;
    if (rawIos[89] !== undefined) {
      directEcmFuelRate = parseFloat((Number(rawIos[89]) * 0.1).toFixed(2));
    } else if (rawIos[108] !== undefined) {
      directEcmFuelRate = parseFloat((Number(rawIos[108]) * 0.1).toFixed(2));
    } else if (rawIos[244] !== undefined) {
      directEcmFuelRate = parseFloat((Number(rawIos[244]) * 0.05).toFixed(2));
    } else if (rawIos[49] !== undefined) {
      directEcmFuelRate = parseFloat((Number(rawIos[49]) * 0.05).toFixed(2));
    }

    const isIgnOn = Boolean(telemetry.ignition === true || telemetry.ignition === 'ON' || telemetry.ignition === 1 || engineRpm > 300 || speed > 3);

    // Detect if previous trip has ended (Ignition OFF for > 5 minutes or time gap > 10 mins)
    const timeGapMinutes = trip ? (now - trip.lastTime) / (1000 * 60) : 0;
    const shouldStartNewTrip = !trip || (trip.isStopped && isIgnOn && speed > 2) || (timeGapMinutes > 15);

    if (shouldStartNewTrip) {
      trip = {
        startTime: now,
        startOdometer: currentOdo,
        startFuel: currentFuel,
        startEcmFuel: ecmTotalFuelConsumed,
        lastTime: now,
        lastOdometer: currentOdo,
        lastFuel: currentFuel,
        lastEcmFuel: ecmTotalFuelConsumed,
        lastLat: currentLat,
        lastLng: currentLng,
        accumulatedDistanceKm: 0,
        accumulatedFuelLiters: 0,
        idleSeconds: 0,
        isStopped: !isIgnOn,
        samples: 0
      };
      this.deviceTrips.set(imei, trip);
    }

    if (trip.startEcmFuel === null && ecmTotalFuelConsumed !== null) {
      trip.startEcmFuel = ecmTotalFuelConsumed;
      trip.lastEcmFuel = ecmTotalFuelConsumed;
    }

    // Delta time in hours
    const dtHours = Math.max(0, (now - trip.lastTime) / (1000 * 3600));
    const dtSeconds = Math.max(0, (now - trip.lastTime) / 1000);
    trip.lastTime = now;

    // 1. High-Precision Distance Calculation
    let deltaDist = 0;

    // A) GPS Haversine Distance (High-Precision Point-to-Point)
    if (currentLat !== 0 && currentLng !== 0 && trip.lastLat !== 0 && trip.lastLng !== 0) {
      const gpsDistance = calculateHaversineKm(trip.lastLat, trip.lastLng, currentLat, currentLng);
      // Filter out stationary GPS noise (< 3 meters) and reject impossible velocity (> 180 km/h)
      if (gpsDistance >= 0.003 && (dtHours === 0 || (gpsDistance / Math.max(0.0001, dtHours)) < 180)) {
        deltaDist = gpsDistance;
      }
    }

    // B) Speed x Time Integration Fallback (if GPS coordinates didn't shift or in tunnel)
    if (deltaDist === 0 && speed > 2 && dtHours > 0 && dtHours < 0.05) {
      deltaDist = speed * dtHours;
    }

    // C) CAN Odometer Validation Check
    if (currentOdo > 0 && trip.lastOdometer > 0 && currentOdo > trip.lastOdometer) {
      const odoDelta = currentOdo - trip.lastOdometer;
      // If odometer delta is reasonable (e.g. 0.01 - 5 km)
      if (odoDelta > 0 && odoDelta < 10) {
        if (deltaDist === 0 || Math.abs(odoDelta - deltaDist) / Math.max(0.1, deltaDist) < 0.4) {
          deltaDist = Math.max(deltaDist, odoDelta);
        }
      }
    }

    trip.accumulatedDistanceKm += deltaDist;
    trip.lastOdometer = currentOdo > 0 ? currentOdo : trip.lastOdometer;
    if (currentLat !== 0 && currentLng !== 0) {
      trip.lastLat = currentLat;
      trip.lastLng = currentLng;
    }

    if (isIgnOn && speed <= 2) {
      trip.idleSeconds += dtSeconds;
    }
    trip.isStopped = !isIgnOn;

    // 2. Resolve Instant Fuel Rate (L/h) from ECM or Vehicle Physics Model
    let fuelRateLitersPerHour = 0;
    if (directEcmFuelRate !== null && directEcmFuelRate > 0) {
      fuelRateLitersPerHour = directEcmFuelRate;
    } else if (isIgnOn && engineRpm > 0) {
      if (speed > 5) {
        const baseFuelEconomy = (deviceProfile.category === 'BIKE') ? 45.0 : ((deviceProfile.category === 'CAR' || deviceProfile.category === 'CAR SUV') ? 14.8 : 4.5);
        const loadFactor = engineLoad > 0 ? (0.6 + (engineLoad / 100) * 0.8) : (1.0 + (acceleratorPedal / 100) * 0.6);
        fuelRateLitersPerHour = parseFloat(((speed / baseFuelEconomy) * loadFactor).toFixed(2));
      } else {
        const idleBase = (deviceProfile.category === 'BIKE') ? 0.2 : ((deviceProfile.category === 'CAR' || deviceProfile.category === 'CAR SUV') ? 0.75 : 1.8);
        const rpmFactor = Math.max(1.0, engineRpm / 800);
        fuelRateLitersPerHour = parseFloat((idleBase * rpmFactor).toFixed(2));
      }
    } else if (isIgnOn && speed > 5) {
      const baseFuelEconomy = (deviceProfile.category === 'BIKE') ? 45.0 : ((deviceProfile.category === 'CAR' || deviceProfile.category === 'CAR SUV') ? 14.8 : 4.5);
      fuelRateLitersPerHour = parseFloat((speed / baseFuelEconomy).toFixed(2));
    }

    // 3. Resolve Trip Fuel Consumed
    if (ecmTotalFuelConsumed !== null && trip.startEcmFuel !== null && ecmTotalFuelConsumed >= trip.startEcmFuel) {
      trip.accumulatedFuelLiters = parseFloat((ecmTotalFuelConsumed - trip.startEcmFuel).toFixed(2));
    } else if (dtHours > 0 && dtHours < 0.1 && fuelRateLitersPerHour > 0) {
      trip.accumulatedFuelLiters += (fuelRateLitersPerHour * dtHours);
    }
    trip.lastFuel = currentFuel;

    // 4. Determine ECM Fuel Injector Status
    let injectionState = 'OFF';
    if (!isIgnOn || engineRpm === 0) {
      injectionState = 'ENGINE_OFF';
    } else if (speed > 25 && acceleratorPedal === 0 && engineRpm > 1200) {
      injectionState = 'DECELERATION_CUTOFF'; // DFCO
    } else if (speed === 0 && engineRpm > 300) {
      injectionState = 'IDLE_INJECTION';
    } else if (acceleratorPedal > 40 || engineLoad > 60) {
      injectionState = 'HIGH_LOAD_BOOST';
    } else {
      injectionState = 'ACTIVE_INJECTION';
    }

    // 5. Instantaneous Mileage (km/L)
    let instantKmPerLiter = 0;
    if (speed > 3 && fuelRateLitersPerHour > 0.05) {
      instantKmPerLiter = parseFloat((speed / fuelRateLitersPerHour).toFixed(1));
    }

    // 6. Trip Distance & Economy Metrics
    let tripDistanceKm = parseFloat(trip.accumulatedDistanceKm.toFixed(2));
    let tripFuelLiters = parseFloat(trip.accumulatedFuelLiters.toFixed(2));
    
    const defaultEconomy = (deviceProfile.category === 'BIKE') ? 45.0 : ((deviceProfile.category === 'CAR' || deviceProfile.category === 'CAR SUV') ? 14.8 : 4.5);
    let avgKmPerLiter = defaultEconomy;

    if (tripDistanceKm > 0.1 && tripFuelLiters > 0.01) {
      avgKmPerLiter = parseFloat((tripDistanceKm / tripFuelLiters).toFixed(1));
    }

    // 7. Fuel Consumption per KM (L/km)
    const fuelPerKm = tripDistanceKm > 0.1 && tripFuelLiters > 0.01 
      ? parseFloat((tripFuelLiters / tripDistanceKm).toFixed(3))
      : parseFloat((1 / Math.max(1, avgKmPerLiter)).toFixed(3));

    // 8. Cost Per Kilometer (₹/km)
    const costPerKm = avgKmPerLiter > 0 ? parseFloat((this.fuelPricePerLiter / avgKmPerLiter).toFixed(2)) : 0;

    // 9. Estimated Remaining Driving Range (Dynamic DTE based on Remaining Fuel & Avg Mileage)
    const dynamicRangeKm = (currentFuel > 0 && avgKmPerLiter > 0) 
      ? Math.round(currentFuel * avgKmPerLiter) 
      : (telemetry.vehicleRange || 0);
    const estimatedRangeKm = dynamicRangeKm;

    // 10. Idle Fuel Waste (Liters)
    const idleWasteLiters = parseFloat(((trip.idleSeconds / 3600) * 0.8).toFixed(2));

    const instantLitersPerKm = (speed > 3 && fuelRateLitersPerHour > 0.05) 
      ? parseFloat((fuelRateLitersPerHour / speed).toFixed(4)) 
      : 0;
    const instantMlPerKm = parseFloat((instantLitersPerKm * 1000).toFixed(1));

    return {
      instantMileageKmPerLiter: instantKmPerLiter,
      avgMileageKmPerLiter: avgKmPerLiter,
      tripDistanceKm,
      tripFuelConsumedLiters: tripFuelLiters,
      fuelPerKm,
      instantLitersPerKm,
      instantMlPerKm,
      costPerKm,
      estimatedRangeKm,
      idleFuelConsumed: idleWasteLiters,
      fuelRateLitersPerHour: parseFloat(fuelRateLitersPerHour.toFixed(2)),
      injectionState,
      ecmTotalFuelConsumed,
      engineLoad,
      acceleratorPedal
    };
  }

  resetTrip(imei) {
    this.deviceTrips.delete(imei);
  }
}

module.exports = MileageEngine;

