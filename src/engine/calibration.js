/**
 * Diesel / Fuel Calibration Engine
 * Performs piecewise linear interpolation for multi-point calibration tables.
 */

// Default Presets for common commercial vehicles
const TANK_PRESETS = {
  'ashok_leyland_480': {
    name: 'Ashok Leyland 480L Tank',
    capacity: 480,
    points: [
      { raw: 0, liters: 0 },
      { raw: 25, liters: 110 },
      { raw: 50, liters: 235 },
      { raw: 75, liters: 362 },
      { raw: 100, liters: 480 }
    ]
  },
  'bharatbenz_300': {
    name: 'BharatBenz 300L Tank',
    capacity: 300,
    points: [
      { raw: 0, liters: 0 },
      { raw: 25, liters: 70 },
      { raw: 50, liters: 148 },
      { raw: 75, liters: 226 },
      { raw: 100, liters: 300 }
    ]
  },
  'tata_160': {
    name: 'Tata Ultra 160L Tank',
    capacity: 160,
    points: [
      { raw: 0, liters: 0 },
      { raw: 25, liters: 38 },
      { raw: 50, liters: 79 },
      { raw: 75, liters: 120 },
      { raw: 100, liters: 160 }
    ]
  },
  'bolero_60': {
    name: 'Mahindra Bolero / Pickup 60L',
    capacity: 60,
    points: [
      { raw: 0, liters: 0 },
      { raw: 25, liters: 14 },
      { raw: 50, liters: 29 },
      { raw: 75, liters: 44 },
      { raw: 100, liters: 60 }
    ]
  }
};

/**
 * Computes calibrated liters from raw sensor value (percentage 0-100 or analog voltage)
 * @param {number} rawValue - Raw % or Volts
 * @param {Array<{raw: number, liters: number}>} points - Sorted calibration points
 * @returns {number} Calibrated volume in Liters
 */
function calculateLiters(rawValue, points) {
  if (rawValue === null || rawValue === undefined || isNaN(rawValue)) {
    return null;
  }

  // If no points provided, assume raw is direct percentage of 100L default
  if (!points || !Array.isArray(points) || points.length === 0) {
    return parseFloat(rawValue.toFixed(2));
  }

  // Ensure points are sorted by raw value ascending
  const sorted = [...points].sort((a, b) => a.raw - b.raw);

  // Value below minimum calibration point
  if (rawValue <= sorted[0].raw) {
    return sorted[0].liters;
  }

  // Value above maximum calibration point
  if (rawValue >= sorted[sorted.length - 1].raw) {
    return sorted[sorted.length - 1].liters;
  }

  // Linear Interpolation between two matching points
  for (let i = 0; i < sorted.length - 1; i++) {
    const p1 = sorted[i];
    const p2 = sorted[i + 1];

    if (rawValue >= p1.raw && rawValue <= p2.raw) {
      if (p2.raw === p1.raw) return p1.liters;
      const ratio = (rawValue - p1.raw) / (p2.raw - p1.raw);
      const liters = p1.liters + ratio * (p2.liters - p1.liters);
      return parseFloat(liters.toFixed(2));
    }
  }

  return 0;
}

/**
 * Generates an evenly spaced linear calibration table for a given tank capacity
 */
function generateLinearPoints(capacityLiters, steps = 5) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const raw = (i / steps) * 100;
    const liters = parseFloat(((i / steps) * capacityLiters).toFixed(2));
    points.push({ raw, liters });
  }
  return points;
}

module.exports = {
  calculateLiters,
  generateLinearPoints,
  TANK_PRESETS
};
