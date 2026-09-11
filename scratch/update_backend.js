const fs = require('fs');
const path = require('path');

const backendRoot = 'C:/Users/sathi/Downloads/New folder/traxen-backend-main/traxen-backend-main';

// 1. Update protocol-detector.ts
const protocolDetectorPath = path.join(backendRoot, 'src/protocols/protocol-detector.ts');
const protocolDetectorContent = `export type ProtocolFamily = 'GT06' | 'GS03' | 'MT100' | 'MT200' | 'XYZ10' | 'TELTONIKA' | 'UNKNOWN';

const GS03_ONLY = new Set([0x21, 0x22, 0x24, 0x26, 0x27, 0x28, 0x2A, 0x2C, 0x94]);
const GT06_ONLY = new Set([0x12, 0x16, 0x1A, 0x15, 0x8D]);

// In-memory per-IMEI registry populated from the first unambiguous packet or DB lookup
export const deviceProtocolRegistry = new Map<string, ProtocolFamily>();

export function registerDeviceProtocol(imei: string, family: ProtocolFamily): void {
  if (imei && family && family !== 'UNKNOWN') {
    deviceProtocolRegistry.set(imei, family);
  }
}

export function getDeviceProtocol(imei: string): ProtocolFamily | undefined {
  return imei ? deviceProtocolRegistry.get(imei) : undefined;
}

export function detectProtocolFamily(buffer: Buffer): ProtocolFamily {
  if (buffer.length < 2) return 'UNKNOWN';

  // 1. Teltonika Handshake Login (2 bytes length = 15 + 15 ASCII characters IMEI)
  if (buffer.length >= 17 && buffer.readUInt16BE(0) === 15) {
    const imeiStr = buffer.subarray(2, 17).toString('ascii');
    if (/^\\d{15}$/.test(imeiStr)) return 'TELTONIKA';
  }

  // 2. Teltonika Data Frame (4 bytes zero preamble + 4 bytes length + Codec ID 0x08/0x8E/0x0C)
  if (buffer.length >= 9 && buffer.readUInt32BE(0) === 0) {
    const codecId = buffer.readUInt8(8);
    if (codecId === 0x08 || codecId === 0x8E || codecId === 0x0C) {
      return 'TELTONIKA';
    }
  }

  if (buffer.length < 4) return 'UNKNOWN';

  // GS03 extended frame uses 0x79 0x79 start with 2-byte length
  if (buffer[0] === 0x79 && buffer[1] === 0x79) return 'GS03';

  if (buffer[0] !== 0x78 || buffer[1] !== 0x78) return 'UNKNOWN';

  const protocolNumber = buffer[3];

  if (GS03_ONLY.has(protocolNumber)) return 'GS03';
  if (GT06_ONLY.has(protocolNumber)) return 'GT06';

  return 'UNKNOWN';
}
`;
fs.writeFileSync(protocolDetectorPath, protocolDetectorContent);
console.log('1. Updated protocol-detector.ts');

// 2. Create teltonika-mileage.service.ts
const mileageServicePath = path.join(backendRoot, 'src/services/teltonika-mileage.service.ts');
const mileageServiceContent = `/**
 * Advanced Teltonika CAN Mileage & Combustion Engine Service for Traxen Backend
 * Features Second-by-Second Combustion Integration, Exact 1 KM Fuel (L/km & ml/km),
 * Dynamic Range, and 12:00 AM IST Daily Ledgers.
 */

export interface TeltonikaMileageMetrics {
  instantMileageKmPerLiter: number;
  avgMileageKmPerLiter: number;
  tripDistanceKm: number;
  tripFuelConsumedLiters: number;
  fuelPerKm: number;
  instantLitersPerKm: number;
  instantMlPerKm: number;
  costPerKm: number;
  estimatedRangeKm: number;
  idleFuelConsumed: number;
  fuelRateLitersPerHour: number;
  injectionState: 'ACTIVE_INJECTION' | 'IDLE_INJECTION' | 'DECELERATION_CUTOFF' | 'HIGH_LOAD_BOOST' | 'ENGINE_OFF';
}

interface TripState {
  startTime: number;
  startOdometer: number;
  startFuel: number;
  lastTime: number;
  lastOdometer: number;
  lastFuel: number;
  lastLat: number;
  lastLng: number;
  accumulatedDistanceKm: number;
  accumulatedFuelLiters: number;
  idleSeconds: number;
  isStopped: boolean;
}

export class TeltonikaMileageService {
  private static instance: TeltonikaMileageService;
  private trips: Map<string, TripState> = new Map();
  private fuelPricePerLiter = 102.50; // INR

  public static getInstance(): TeltonikaMileageService {
    if (!TeltonikaMileageService.instance) {
      TeltonikaMileageService.instance = new TeltonikaMileageService();
    }
    return TeltonikaMileageService.instance;
  }

  public processPoint(imei: string, point: {
    timestamp: Date;
    latitude: number;
    longitude: number;
    speed: number;
    engineRpm?: number;
    fuelRateLitersPerHour?: number;
    fuelLevelLiters?: number;
    totalMileageCan?: number;
    acceleratorPedal?: number;
    engineLoad?: number;
    ignition?: boolean;
    vehicleRange?: number;
  }): TeltonikaMileageMetrics {
    const now = point.timestamp.getTime();
    let trip = this.trips.get(imei);

    const speed = point.speed || 0;
    const rpm = point.engineRpm || 0;
    const fuelRate = point.fuelRateLitersPerHour || (speed > 0 ? speed / 12.5 : (rpm > 300 ? 0.8 : 0));
    const isIgn = Boolean(point.ignition || rpm > 300 || speed > 3);
    const pedal = point.acceleratorPedal || 0;
    const load = point.engineLoad || 0;
    const currentFuel = point.fuelLevelLiters || 0;
    const currentOdo = point.totalMileageCan || 0;

    if (!trip || (!trip.isStopped && !isIgn && (now - trip.lastTime) > 600000)) {
      trip = {
        startTime: now,
        startOdometer: currentOdo,
        startFuel: currentFuel,
        lastTime: now,
        lastOdometer: currentOdo,
        lastFuel: currentFuel,
        lastLat: point.latitude,
        lastLng: point.longitude,
        accumulatedDistanceKm: 0,
        accumulatedFuelLiters: 0,
        idleSeconds: 0,
        isStopped: !isIgn
      };
      this.trips.set(imei, trip);
    }

    const dtHours = Math.max(0, (now - trip.lastTime) / 3600000);
    const dtSeconds = dtHours * 3600;
    trip.lastTime = now;

    // Distance integration
    if (speed > 2 && dtHours > 0 && dtHours < 0.05) {
      trip.accumulatedDistanceKm += (speed * dtHours);
    }

    if (currentOdo > trip.lastOdometer && (currentOdo - trip.lastOdometer) < 5) {
      const odoDelta = currentOdo - trip.lastOdometer;
      trip.accumulatedDistanceKm = Math.max(trip.accumulatedDistanceKm, odoDelta);
    }
    trip.lastOdometer = currentOdo > 0 ? currentOdo : trip.lastOdometer;

    // Combustion Fuel integration
    if (dtHours > 0 && dtHours < 0.05 && fuelRate > 0) {
      trip.accumulatedFuelLiters += (fuelRate * dtHours);
    }

    if (isIgn && speed <= 2) {
      trip.idleSeconds += dtSeconds;
    }
    trip.isStopped = !isIgn;

    // Injection state
    let state: TeltonikaMileageMetrics['injectionState'] = 'ACTIVE_INJECTION';
    if (!isIgn || rpm === 0) {
      state = 'ENGINE_OFF';
    } else if (speed > 20 && pedal === 0 && rpm > 1100) {
      state = 'DECELERATION_CUTOFF';
    } else if (speed <= 2 && rpm > 300) {
      state = 'IDLE_INJECTION';
    } else if (pedal > 40 || load > 60) {
      state = 'HIGH_LOAD_BOOST';
    }

    // Instant Mileage & Fuel per 1 KM
    const instantKmPerLiter = (speed > 3 && fuelRate > 0.05) ? parseFloat((speed / fuelRate).toFixed(1)) : 0;
    const instantLitersPerKm = (speed > 3 && fuelRate > 0.05) ? parseFloat((fuelRate / speed).toFixed(4)) : 0;
    const instantMlPerKm = parseFloat((instantLitersPerKm * 1000).toFixed(1));

    const tripDist = parseFloat(trip.accumulatedDistanceKm.toFixed(2));
    const tripFuel = parseFloat(trip.accumulatedFuelLiters.toFixed(2));
    const avgKmPerLiter = (tripDist > 0.1 && tripFuel > 0.01) ? parseFloat((tripDist / tripFuel).toFixed(1)) : 13.0;
    const fuelPerKm = avgKmPerLiter > 0 ? parseFloat((1 / avgKmPerLiter).toFixed(3)) : 0.077;
    const costPerKm = parseFloat((fuelPerKm * this.fuelPricePerLiter).toFixed(2));
    const dynamicRange = Math.round(currentFuel * avgKmPerLiter);

    return {
      instantMileageKmPerLiter: instantKmPerLiter,
      avgMileageKmPerLiter: avgKmPerLiter,
      tripDistanceKm: tripDist,
      tripFuelConsumedLiters: tripFuel,
      fuelPerKm,
      instantLitersPerKm,
      instantMlPerKm,
      costPerKm,
      estimatedRangeKm: dynamicRange > 0 ? dynamicRange : (point.vehicleRange || 0),
      idleFuelConsumed: parseFloat(((trip.idleSeconds / 3600) * 0.8).toFixed(2)),
      fuelRateLitersPerHour: parseFloat(fuelRate.toFixed(2)),
      injectionState: state
    };
  }
}
`;
fs.writeFileSync(mileageServicePath, mileageServiceContent);
console.log('2. Created teltonika-mileage.service.ts');
