/**
 * Advanced Driver Behavior & Eco-Driving Intelligence Engine
 * Evaluates harsh braking, rapid acceleration, aggressive cornering,
 * excessive idling, overspeeding, and generates a dynamic 0-100 Safety & Eco Score.
 */

class DriverBehaviorEngine {
  constructor(options = {}) {
    this.speedLimitKmH = options.speedLimitKmH || 80;
    this.harshAccelThresholdKmhPerSec = options.harshAccelThresholdKmhPerSec || 12; // ~3.3 m/s²
    this.harshBrakeThresholdKmhPerSec = options.harshBrakeThresholdKmhPerSec || 14; // ~3.9 m/s²
    this.harshTurnAnglePerSec = options.harshTurnAnglePerSec || 35; // degrees at speed > 30 km/h
    this.deviceStates = new Map(); // imei -> state
  }

  /**
   * Process a single telemetry point and evaluate driving events
   * @param {string} imei - Device IMEI
   * @param {object} telemetry - Normalized telemetry record
   * @returns {object} Driver behavior metrics & score
   */
  process(imei, telemetry) {
    let state = this.deviceStates.get(imei);
    const now = telemetry.timestamp ? new Date(telemetry.timestamp).getTime() : Date.now();
    const speed = Number(telemetry.speed || telemetry.canSpeed || 0);
    const angle = Number(telemetry.angle || 0);
    const engineRpm = Number(telemetry.engineRpm || 0);
    const isIgnOn = Boolean(telemetry.ignition || engineRpm > 300);
    const rawIos = telemetry.rawIos || {};

    if (!state) {
      state = {
        lastTime: now,
        lastSpeed: speed,
        lastAngle: angle,
        harshAccelCount: 0,
        harshBrakeCount: 0,
        harshCornerCount: 0,
        overspeedCount: 0,
        idleSeconds: 0,
        drivingSeconds: 0,
        totalDistanceKm: 0,
        events: []
      };
      this.deviceStates.set(imei, state);
    }

    const dtSec = Math.max(0.1, (now - state.lastTime) / 1000);
    state.lastTime = now;

    const deltaSpeed = speed - state.lastSpeed;
    const accelRate = deltaSpeed / dtSec; // km/h per second

    // Heading delta (taking 360 wrap-around into account)
    let angleDiff = Math.abs(angle - state.lastAngle);
    if (angleDiff > 180) angleDiff = 360 - angleDiff;
    const turnRate = angleDiff / dtSec;

    let eventDetected = null;

    // 1. Harsh Acceleration Detection
    if (accelRate >= this.harshAccelThresholdKmhPerSec && speed > 10) {
      state.harshAccelCount++;
      eventDetected = {
        type: 'HARSH_ACCELERATION',
        severity: accelRate > 20 ? 'HIGH' : 'MEDIUM',
        value: parseFloat(accelRate.toFixed(1)),
        unit: 'km/h/s',
        timestamp: new Date(now).toISOString(),
        lat: telemetry.lat,
        lng: telemetry.lng,
        speed
      };
      state.events.push(eventDetected);
    }
    // 2. Harsh Braking Detection
    else if (accelRate <= -this.harshBrakeThresholdKmhPerSec && state.lastSpeed > 15) {
      state.harshBrakeCount++;
      eventDetected = {
        type: 'HARSH_BRAKING',
        severity: accelRate < -22 ? 'HIGH' : 'MEDIUM',
        value: parseFloat(Math.abs(accelRate).toFixed(1)),
        unit: 'km/h/s',
        timestamp: new Date(now).toISOString(),
        lat: telemetry.lat,
        lng: telemetry.lng,
        speed
      };
      state.events.push(eventDetected);
    }
    // 3. Harsh Cornering Detection
    else if (turnRate >= this.harshTurnAnglePerSec && speed > 35) {
      state.harshCornerCount++;
      eventDetected = {
        type: 'HARSH_CORNERING',
        severity: turnRate > 50 ? 'HIGH' : 'MEDIUM',
        value: parseFloat(turnRate.toFixed(1)),
        unit: 'deg/s',
        timestamp: new Date(now).toISOString(),
        lat: telemetry.lat,
        lng: telemetry.lng,
        speed
      };
      state.events.push(eventDetected);
    }
    // 4. Over-speeding Detection
    else if (speed > this.speedLimitKmH) {
      state.overspeedCount++;
      if (state.overspeedCount % 5 === 1) {
        eventDetected = {
          type: 'OVERSPEEDING',
          severity: speed > (this.speedLimitKmH + 20) ? 'HIGH' : 'MEDIUM',
          value: speed,
          limit: this.speedLimitKmH,
          unit: 'km/h',
          timestamp: new Date(now).toISOString(),
          lat: telemetry.lat,
          lng: telemetry.lng,
          speed
        };
        state.events.push(eventDetected);
      }
    }

    // 5. Track Driving vs Idling Time
    if (isIgnOn) {
      if (speed < 3) {
        state.idleSeconds += dtSec;
      } else {
        state.drivingSeconds += dtSec;
        state.totalDistanceKm += (speed * (dtSec / 3600));
      }
    }

    state.lastSpeed = speed;
    state.lastAngle = angle;

    // 6. Calculate Dynamic Safety & Eco-Score (100 Base Points)
    let score = 100;
    score -= (state.harshAccelCount * 3.5);
    score -= (state.harshBrakeCount * 4.0);
    score -= (state.harshCornerCount * 3.0);
    score -= (state.overspeedCount * 2.0);

    // Penalty for excessive idling (> 10 mins with 0 speed)
    if (state.idleSeconds > 600) {
      const excessIdleMins = (state.idleSeconds - 600) / 60;
      score -= Math.min(15, excessIdleMins * 0.5);
    }

    score = Math.max(20, Math.min(100, Math.round(score)));

    // Rating Label
    let ratingLabel = 'EXEMPLARY';
    let ratingBadge = '🏆';
    if (score >= 90) {
      ratingLabel = 'EXEMPLARY';
      ratingBadge = '🏆';
    } else if (score >= 80) {
      ratingLabel = 'SAFE & SMOOTH';
      ratingBadge = '🟢';
    } else if (score >= 65) {
      ratingLabel = 'MODERATE';
      ratingBadge = '🟡';
    } else {
      ratingLabel = 'AGGRESSIVE / HIGH RISK';
      ratingBadge = '🔴';
    }

    // Keep event queue trimmed
    if (state.events.length > 50) state.events.shift();

    return {
      safetyScore: score,
      ratingLabel,
      ratingBadge,
      harshAccelCount: state.harshAccelCount,
      harshBrakeCount: state.harshBrakeCount,
      harshCornerCount: state.harshCornerCount,
      overspeedCount: state.overspeedCount,
      idleTimeMinutes: parseFloat((state.idleSeconds / 60).toFixed(1)),
      drivingTimeMinutes: parseFloat((state.drivingSeconds / 60).toFixed(1)),
      totalDistanceKm: parseFloat(state.totalDistanceKm.toFixed(2)),
      latestEvent: eventDetected
    };
  }

  getMetrics(imei) {
    return this.deviceStates.get(imei) || null;
  }

  reset(imei) {
    this.deviceStates.delete(imei);
  }
}

module.exports = DriverBehaviorEngine;
