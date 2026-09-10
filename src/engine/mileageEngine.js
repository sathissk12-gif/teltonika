/**
 * Advanced Mileage & Fuel Economy Calculation Engine
 * Computes Instantaneous Mileage (km/L), Average Trip Economy, Fuel Consumed,
 * Driving Distance, and Cost Per Kilometer for commercial fleets & passenger vehicles.
 */

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
    const now = Date.now();
    const rawIos = telemetry.rawIos || {};

    const currentOdo = (telemetry.totalMileageCan && telemetry.totalMileageCan > 0) 
      ? telemetry.totalMileageCan 
      : (telemetry.odometer || telemetry.odometerKm || 0);

    const currentFuel = (telemetry.fuelLevelLiters !== undefined && telemetry.fuelLevelLiters !== null) 
      ? telemetry.fuelLevelLiters 
      : (telemetry.fuelLiters || 0);

    const speed = telemetry.speed || telemetry.canSpeed || 0;
    const engineRpm = telemetry.engineRpm || (rawIos[85] !== undefined ? Number(rawIos[85]) : (rawIos[32] !== undefined ? Number(rawIos[32]) : 0));
    const acceleratorPedal = telemetry.acceleratorPedal !== undefined ? telemetry.acceleratorPedal : (rawIos[82] !== undefined ? Number(rawIos[82]) : (rawIos[35] !== undefined ? Number(rawIos[35]) : 0));
    const engineLoad = telemetry.engineLoad !== undefined ? telemetry.engineLoad : (rawIos[31] !== undefined ? Number(rawIos[31]) : 0);

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

    const isIgnOn = Boolean(telemetry.ignition || engineRpm > 300);

    // Initialize Trip if not present
    if (!trip) {
      trip = {
        startTime: now,
        startOdometer: currentOdo,
        startFuel: currentFuel,
        startEcmFuel: ecmTotalFuelConsumed,
        lastTime: now,
        lastOdometer: currentOdo,
        lastFuel: currentFuel,
        lastEcmFuel: ecmTotalFuelConsumed,
        accumulatedDistanceKm: 0,
        accumulatedFuelLiters: 0,
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
    trip.lastTime = now;

    // 1. Distance Traveled
    let deltaDist = 0;
    if (currentOdo >= trip.lastOdometer && (currentOdo - trip.lastOdometer) < 500) {
      deltaDist = currentOdo - trip.lastOdometer;
    } else if (speed > 0 && dtHours > 0 && dtHours < 0.1) {
      deltaDist = speed * dtHours;
    }
    trip.accumulatedDistanceKm += deltaDist;
    trip.lastOdometer = currentOdo;

    // 2. Resolve Instant Fuel Rate (L/h) from ECM or High-Precision Model
    let fuelRateLitersPerHour = 0;
    if (directEcmFuelRate !== null && directEcmFuelRate > 0) {
      fuelRateLitersPerHour = directEcmFuelRate;
    } else if (isIgnOn && engineRpm > 0) {
      if (speed > 5) {
        // High precision load-based injection model
        const baseFuelEconomy = (deviceProfile.category === 'BIKE') ? 45.0 : (deviceProfile.category === 'CAR' ? 15.0 : 4.5);
        const loadFactor = engineLoad > 0 ? (0.6 + (engineLoad / 100) * 0.8) : (1.0 + (acceleratorPedal / 100) * 0.6);
        fuelRateLitersPerHour = parseFloat(((speed / baseFuelEconomy) * loadFactor).toFixed(2));
      } else {
        // Idling injection rate (0.6 - 1.2 L/h based on RPM)
        const idleBase = (deviceProfile.category === 'BIKE') ? 0.2 : (deviceProfile.category === 'CAR' ? 0.75 : 1.8);
        const rpmFactor = Math.max(1.0, engineRpm / 800);
        fuelRateLitersPerHour = parseFloat((idleBase * rpmFactor).toFixed(2));
      }
    } else if (isIgnOn && speed > 5) {
      const baseFuelEconomy = (deviceProfile.category === 'BIKE') ? 45.0 : (deviceProfile.category === 'CAR' ? 15.0 : 4.5);
      fuelRateLitersPerHour = parseFloat((speed / baseFuelEconomy).toFixed(2));
    }

    // 3. Resolve Trip Fuel Consumed (Prefer Direct ECM Counted Fuel)
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
      injectionState = 'DECELERATION_CUTOFF'; // DFCO (Decel Fuel Cut-Off)
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

    // 6. Trip Average Mileage (km/L)
    let tripDistanceKm = parseFloat(trip.accumulatedDistanceKm.toFixed(2));
    let tripFuelLiters = parseFloat(trip.accumulatedFuelLiters.toFixed(2));
    
    const defaultEconomy = (deviceProfile.category === 'BIKE') ? 45.0 : (deviceProfile.category === 'CAR' ? 14.8 : 4.2);
    let avgKmPerLiter = defaultEconomy;

    if (tripDistanceKm > 0.3 && tripFuelLiters > 0.02) {
      avgKmPerLiter = parseFloat((tripDistanceKm / tripFuelLiters).toFixed(1));
    }

    // 7. Fuel Economy in L/100km
    const lPer100Km = avgKmPerLiter > 0 ? parseFloat((100 / avgKmPerLiter).toFixed(1)) : 0;

    // 8. Cost Per Kilometer (₹/km)
    const costPerKm = avgKmPerLiter > 0 ? parseFloat((this.fuelPricePerLiter / avgKmPerLiter).toFixed(2)) : 0;

    // 9. Estimated Remaining Driving Range (km)
    let estimatedRangeKm = telemetry.vehicleRange || 0;
    if (!estimatedRangeKm || estimatedRangeKm === 0) {
      estimatedRangeKm = Math.round(currentFuel * avgKmPerLiter);
    }

    return {
      instantMileageKmPerLiter: instantKmPerLiter,
      avgMileageKmPerLiter: avgKmPerLiter,
      tripDistanceKm,
      tripFuelConsumedLiters: tripFuelLiters,
      fuelEconomyLPer100Km: lPer100Km,
      costPerKm,
      estimatedRangeKm,
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
