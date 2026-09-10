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
   * Process incoming telemetry and append rich mileage metrics
   * @param {string} imei - Device IMEI
   * @param {object} telemetry - Current telemetry point
   * @param {object} deviceProfile - Device configuration (category, tankCapacity, etc.)
   * @returns {object} Calculated mileage metrics
   */
  process(imei, telemetry, deviceProfile = {}) {
    let trip = this.deviceTrips.get(imei);
    const now = Date.now();

    const currentOdo = (telemetry.totalMileageCan && telemetry.totalMileageCan > 0) 
      ? telemetry.totalMileageCan 
      : (telemetry.odometer || telemetry.odometerKm || 0);

    const currentFuel = (telemetry.fuelLevelLiters !== undefined && telemetry.fuelLevelLiters !== null) 
      ? telemetry.fuelLevelLiters 
      : (telemetry.fuelLiters || 0);

    const speed = telemetry.speed || telemetry.canSpeed || 0;
    const isIgnOn = Boolean(telemetry.ignition);

    // Initialize Trip if not present or after reset
    if (!trip) {
      trip = {
        startTime: now,
        startOdometer: currentOdo,
        startFuel: currentFuel,
        lastTime: now,
        lastOdometer: currentOdo,
        lastFuel: currentFuel,
        accumulatedDistanceKm: 0,
        accumulatedFuelLiters: 0,
        samples: 0,
        lastSpeed: speed
      };
      this.deviceTrips.set(imei, trip);
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

    // 2. Fuel Consumption Rate (L/h)
    let fuelRateLitersPerHour = telemetry.fuelRate || 0;
    if (!fuelRateLitersPerHour || fuelRateLitersPerHour === 0) {
      if (isIgnOn) {
        if (speed > 5) {
          // Estimated based on vehicle category & speed
          const baseFuelEconomy = (deviceProfile.category === 'BIKE') ? 45.0 : (deviceProfile.category === 'CAR' ? 15.0 : 4.5);
          fuelRateLitersPerHour = parseFloat((speed / baseFuelEconomy).toFixed(2));
        } else {
          // Idling consumption (0.8 - 1.5 L/h)
          fuelRateLitersPerHour = (deviceProfile.category === 'BIKE') ? 0.2 : (deviceProfile.category === 'CAR' ? 0.8 : 1.8);
        }
      }
    }

    // Fuel consumed in delta time
    if (dtHours > 0 && dtHours < 0.1 && fuelRateLitersPerHour > 0) {
      trip.accumulatedFuelLiters += (fuelRateLitersPerHour * dtHours);
    }
    trip.lastFuel = currentFuel;

    // 3. Instantaneous Mileage (km/L)
    let instantKmPerLiter = 0;
    if (speed > 3 && fuelRateLitersPerHour > 0.05) {
      instantKmPerLiter = parseFloat((speed / fuelRateLitersPerHour).toFixed(1));
    }

    // 4. Trip Average Mileage (km/L)
    let tripDistanceKm = parseFloat(trip.accumulatedDistanceKm.toFixed(2));
    let tripFuelLiters = parseFloat(trip.accumulatedFuelLiters.toFixed(2));
    
    // Default fallback based on vehicle category
    const defaultEconomy = (deviceProfile.category === 'BIKE') ? 45.0 : (deviceProfile.category === 'CAR' ? 14.8 : 4.2);
    let avgKmPerLiter = defaultEconomy;

    if (tripDistanceKm > 0.5 && tripFuelLiters > 0.05) {
      avgKmPerLiter = parseFloat((tripDistanceKm / tripFuelLiters).toFixed(1));
    }

    // 5. Fuel Economy in L/100km
    const lPer100Km = avgKmPerLiter > 0 ? parseFloat((100 / avgKmPerLiter).toFixed(1)) : 0;

    // 6. Cost Per Kilometer (₹/km)
    const costPerKm = avgKmPerLiter > 0 ? parseFloat((this.fuelPricePerLiter / avgKmPerLiter).toFixed(2)) : 0;

    // 7. Estimated Remaining Driving Range (km)
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
      fuelRateLitersPerHour: parseFloat(fuelRateLitersPerHour.toFixed(2))
    };
  }

  resetTrip(imei) {
    this.deviceTrips.delete(imei);
  }
}

module.exports = MileageEngine;
