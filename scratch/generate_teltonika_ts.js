const fs = require('fs');
const path = require('path');

const targetDir = 'C:/Users/sathi/Downloads/New folder/traxen-backend-main/traxen-backend-main/src/protocols/teltonika';

// 1. AVL Dictionary
const avlDictJs = fs.readFileSync('c:/Users/sathi/Desktop/projects/Master Code of Crm and APP/teltonika_telematics/src/parser/avlDictionary.js', 'utf8');
const dictBody = avlDictJs.substring(avlDictJs.indexOf('{'), avlDictJs.lastIndexOf('};') + 1);
const avlDictionaryContent = `/**
 * Teltonika AVL ID Parameter Dictionary (TypeScript)
 * Maps standard and CAN Bus AVL IDs to human-readable names, units, and conversion factors.
 */

export interface AvlDefinition {
  name: string;
  label: string;
  unit?: string;
  multiplier?: number;
  type?: string;
}

export const AVL_DICTIONARY: Record<number, AvlDefinition> = ${dictBody};

export function getAvlDefinition(avlId: number): AvlDefinition {
  return AVL_DICTIONARY[avlId] || {
    name: \`avl_\${avlId}\`,
    label: \`Custom Parameter \${avlId}\`,
    type: 'raw'
  };
}
`;
fs.writeFileSync(path.join(targetDir, 'avl-dictionary.ts'), avlDictionaryContent);

// 2. Codec 8 Parser (TypeScript)
const codec8Content = `/**
 * Teltonika Codec 8 (0x08) Binary Parser (TypeScript)
 */

import { getAvlDefinition } from './avl-dictionary.js';

export interface TeltonikaRecord {
  timestamp: Date;
  priority: number;
  latitude: number;
  longitude: number;
  altitude: number;
  angle: number;
  satellites: number;
  speed: number;
  eventIoId: number;
  totalIo: number;
  rawIos: Record<number, number | string>;
  formattedParams: Record<string, any>;
  engineRpm?: number;
  fuelRateLitersPerHour?: number;
  fuelLevelPercentage?: number;
  fuelLevelLiters?: number;
  totalMileageCan?: number;
  vehicleRange?: number;
  coolantTemp?: number;
  acceleratorPedal?: number;
  engineLoad?: number;
  externalVoltage?: number;
  batteryVoltage?: number;
  ignition?: boolean;
}

export function parseCodec8(buffer: Buffer, startOffset = 0): { codecId: number; recordCount: number; records: TeltonikaRecord[]; endOffset: number } {
  let offset = startOffset;
  const codecId = buffer.readUInt8(offset);
  offset += 1;

  if (codecId !== 0x08) {
    throw new Error(\`Invalid Codec ID for Codec8: 0x\${codecId.toString(16).toUpperCase()}\`);
  }

  const recordCount = buffer.readUInt8(offset);
  offset += 1;

  const records: TeltonikaRecord[] = [];

  for (let r = 0; r < recordCount; r++) {
    const timestampBigInt = buffer.readBigUInt64BE(offset);
    offset += 8;
    const timestamp = new Date(Number(timestampBigInt));

    const priority = buffer.readUInt8(offset);
    offset += 1;

    const longitude = buffer.readInt32BE(offset) / 10000000;
    offset += 4;
    const latitude = buffer.readInt32BE(offset) / 10000000;
    offset += 4;
    const altitude = buffer.readInt16BE(offset);
    offset += 2;
    const angle = buffer.readUInt16BE(offset);
    offset += 2;
    const satellites = buffer.readUInt8(offset);
    offset += 1;
    const speed = buffer.readUInt16BE(offset);
    offset += 2;

    const eventIoId = buffer.readUInt8(offset);
    offset += 1;
    const totalIo = buffer.readUInt8(offset);
    offset += 1;

    const rawIos: Record<number, number | string> = {};
    const formattedParams: Record<string, any> = {};

    // 1-Byte IOs
    const count1B = buffer.readUInt8(offset);
    offset += 1;
    for (let i = 0; i < count1B; i++) {
      const id = buffer.readUInt8(offset);
      offset += 1;
      const value = buffer.readUInt8(offset);
      offset += 1;
      rawIos[id] = value;
    }

    // 2-Byte IOs
    const count2B = buffer.readUInt8(offset);
    offset += 1;
    for (let i = 0; i < count2B; i++) {
      const id = buffer.readUInt8(offset);
      offset += 1;
      const value = buffer.readUInt16BE(offset);
      offset += 2;
      rawIos[id] = value;
    }

    // 4-Byte IOs
    const count4B = buffer.readUInt8(offset);
    offset += 1;
    for (let i = 0; i < count4B; i++) {
      const id = buffer.readUInt8(offset);
      offset += 1;
      const value = buffer.readUInt32BE(offset);
      offset += 4;
      rawIos[id] = value;
    }

    // 8-Byte IOs
    const count8B = buffer.readUInt8(offset);
    offset += 1;
    for (let i = 0; i < count8B; i++) {
      const id = buffer.readUInt8(offset);
      offset += 1;
      const value = buffer.readBigUInt64BE(offset);
      offset += 8;
      rawIos[id] = value.toString();
    }

    for (const [idStr, val] of Object.entries(rawIos)) {
      const id = parseInt(idStr, 10);
      const def = getAvlDefinition(id);
      let formattedVal: any = val;

      if (def.multiplier) {
        formattedVal = parseFloat((Number(val) * def.multiplier).toFixed(3));
      } else if (def.type === 'boolean') {
        formattedVal = Boolean(Number(val));
      }
      formattedParams[def.name] = formattedVal;
    }

    records.push({
      timestamp,
      priority,
      latitude,
      longitude,
      altitude,
      angle,
      satellites,
      speed,
      eventIoId,
      totalIo,
      rawIos,
      formattedParams,
      engineRpm: formattedParams.engineRpm !== undefined ? Number(formattedParams.engineRpm) : undefined,
      fuelRateLitersPerHour: formattedParams.instantFuelRate || formattedParams.fuelRateCan || formattedParams.fuelRateJ1939 || formattedParams.fuelRateObd,
      fuelLevelPercentage: formattedParams.fuelLevelPercentage || formattedParams.fuelLevel,
      fuelLevelLiters: formattedParams.fuelLevelLiters,
      totalMileageCan: formattedParams.totalMileageCan || formattedParams.odometer,
      vehicleRange: formattedParams.vehicleRange,
      coolantTemp: formattedParams.coolantTemp,
      acceleratorPedal: formattedParams.acceleratorPedal,
      engineLoad: formattedParams.engineLoad,
      externalVoltage: formattedParams.externalVoltage,
      batteryVoltage: formattedParams.batteryVoltage,
      ignition: formattedParams.ignition !== undefined ? Boolean(formattedParams.ignition) : (formattedParams.DIN1 !== undefined ? Boolean(formattedParams.DIN1) : (speed > 3 || (formattedParams.engineRpm && formattedParams.engineRpm > 300)))
    });
  }

  return {
    codecId,
    recordCount,
    records,
    endOffset: offset
  };
}
`;

// 3. Codec 8 Extended Parser (TypeScript)
const codec8ExtContent = `/**
 * Teltonika Codec 8 Extended (0x8E) Binary Parser (TypeScript)
 */

import { getAvlDefinition } from './avl-dictionary.js';
import { TeltonikaRecord } from './codec8.js';

export function parseCodec8Extended(buffer: Buffer, startOffset = 0): { codecId: number; recordCount: number; records: TeltonikaRecord[]; endOffset: number } {
  let offset = startOffset;
  const codecId = buffer.readUInt8(offset);
  offset += 1;

  if (codecId !== 0x8e) {
    throw new Error(\`Invalid Codec ID for Codec8Extended: 0x\${codecId.toString(16).toUpperCase()}\`);
  }

  const recordCount = buffer.readUInt8(offset);
  offset += 1;

  const records: TeltonikaRecord[] = [];

  for (let r = 0; r < recordCount; r++) {
    const timestampBigInt = buffer.readBigUInt64BE(offset);
    offset += 8;
    const timestamp = new Date(Number(timestampBigInt));

    const priority = buffer.readUInt8(offset);
    offset += 1;

    const longitude = buffer.readInt32BE(offset) / 10000000;
    offset += 4;
    const latitude = buffer.readInt32BE(offset) / 10000000;
    offset += 4;
    const altitude = buffer.readInt16BE(offset);
    offset += 2;
    const angle = buffer.readUInt16BE(offset);
    offset += 2;
    const satellites = buffer.readUInt8(offset);
    offset += 1;
    const speed = buffer.readUInt16BE(offset);
    offset += 2;

    const eventIoId = buffer.readUInt16BE(offset);
    offset += 2;
    const totalIo = buffer.readUInt16BE(offset);
    offset += 2;

    const rawIos: Record<number, number | string> = {};
    const formattedParams: Record<string, any> = {};

    // 1-Byte IOs
    const count1B = buffer.readUInt16BE(offset);
    offset += 2;
    for (let i = 0; i < count1B; i++) {
      const id = buffer.readUInt16BE(offset);
      offset += 2;
      const value = buffer.readUInt8(offset);
      offset += 1;
      rawIos[id] = value;
    }

    // 2-Byte IOs
    const count2B = buffer.readUInt16BE(offset);
    offset += 2;
    for (let i = 0; i < count2B; i++) {
      const id = buffer.readUInt16BE(offset);
      offset += 2;
      const value = buffer.readUInt16BE(offset);
      offset += 2;
      rawIos[id] = value;
    }

    // 4-Byte IOs
    const count4B = buffer.readUInt16BE(offset);
    offset += 2;
    for (let i = 0; i < count4B; i++) {
      const id = buffer.readUInt16BE(offset);
      offset += 2;
      const value = buffer.readUInt32BE(offset);
      offset += 4;
      rawIos[id] = value;
    }

    // 8-Byte IOs
    const count8B = buffer.readUInt16BE(offset);
    offset += 2;
    for (let i = 0; i < count8B; i++) {
      const id = buffer.readUInt16BE(offset);
      offset += 2;
      const value = buffer.readBigUInt64BE(offset);
      offset += 8;
      rawIos[id] = value.toString();
    }

    for (const [idStr, val] of Object.entries(rawIos)) {
      const id = parseInt(idStr, 10);
      const def = getAvlDefinition(id);
      let formattedVal: any = val;

      if (def.multiplier) {
        formattedVal = parseFloat((Number(val) * def.multiplier).toFixed(3));
      } else if (def.type === 'boolean') {
        formattedVal = Boolean(Number(val));
      }
      formattedParams[def.name] = formattedVal;
    }

    records.push({
      timestamp,
      priority,
      latitude,
      longitude,
      altitude,
      angle,
      satellites,
      speed,
      eventIoId,
      totalIo,
      rawIos,
      formattedParams,
      engineRpm: formattedParams.engineRpm !== undefined ? Number(formattedParams.engineRpm) : undefined,
      fuelRateLitersPerHour: formattedParams.instantFuelRate || formattedParams.fuelRateCan || formattedParams.fuelRateJ1939 || formattedParams.fuelRateObd,
      fuelLevelPercentage: formattedParams.fuelLevelPercentage || formattedParams.fuelLevel,
      fuelLevelLiters: formattedParams.fuelLevelLiters,
      totalMileageCan: formattedParams.totalMileageCan || formattedParams.odometer,
      vehicleRange: formattedParams.vehicleRange,
      coolantTemp: formattedParams.coolantTemp,
      acceleratorPedal: formattedParams.acceleratorPedal,
      engineLoad: formattedParams.engineLoad,
      externalVoltage: formattedParams.externalVoltage,
      batteryVoltage: formattedParams.batteryVoltage,
      ignition: formattedParams.ignition !== undefined ? Boolean(formattedParams.ignition) : (formattedParams.DIN1 !== undefined ? Boolean(formattedParams.DIN1) : (speed > 3 || (formattedParams.engineRpm && formattedParams.engineRpm > 300)))
    });
  }

  return {
    codecId,
    recordCount,
    records,
    endOffset: offset
  };
}
`;

// 4. Codec 12 GPRS Commands Parser & Builder (TypeScript)
const codec12Content = `/**
 * Teltonika Codec 12 (0x0C) Parser & Command Builder (TypeScript)
 */

export function buildCodec12Command(commandString: string): Buffer {
  const cmdBytes = Buffer.from(commandString, 'ascii');
  const cmdLength = cmdBytes.length;

  const dataLength = 1 + 1 + 1 + 4 + cmdLength + 1;
  const buffer = Buffer.alloc(4 + 4 + dataLength + 4);

  let offset = 0;
  buffer.writeUInt32BE(0, offset);
  offset += 4;
  buffer.writeUInt32BE(dataLength, offset);
  offset += 4;

  buffer.writeUInt8(0x0C, offset);
  offset += 1;
  buffer.writeUInt8(0x05, offset);
  offset += 1;
  buffer.writeUInt8(0x01, offset);
  offset += 1;
  buffer.writeUInt32BE(cmdLength, offset);
  offset += 4;
  cmdBytes.copy(buffer, offset);
  offset += cmdLength;
  buffer.writeUInt8(0x01, offset);
  offset += 1;

  buffer.writeUInt32BE(0, offset);

  return buffer;
}
`;

// 5. Main Teltonika Index (TypeScript)
const indexContent = `/**
 * Teltonika Protocol Module for Traxen Enterprise Backend
 */

import { parseCodec8, TeltonikaRecord } from './codec8.js';
import { parseCodec8Extended } from './codec8ext.js';
import { buildCodec12Command } from './codec12.js';
import { getAvlDefinition, AVL_DICTIONARY } from './avl-dictionary.js';

export { parseCodec8, parseCodec8Extended, buildCodec12Command, getAvlDefinition, AVL_DICTIONARY, TeltonikaRecord };

export function isTeltonikaCandidate(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 2) return false;

  // 1. Handshake Packet (2 bytes length + 15 bytes ASCII IMEI)
  if (buffer.length >= 17) {
    const imeiLen = buffer.readUInt16BE(0);
    if (imeiLen === 15) {
      const imeiStr = buffer.subarray(2, 17).toString('ascii');
      if (/^\\d{15}$/.test(imeiStr)) {
        return true;
      }
    }
  }

  // 2. Data Packet (4 bytes zeros preamble + 4 bytes length + Codec ID)
  if (buffer.length >= 9) {
    const preamble = buffer.readUInt32BE(0);
    const codecId = buffer.readUInt8(8);
    if (preamble === 0x00000000 && (codecId === 0x08 || codecId === 0x8E || codecId === 0x0C)) {
      return true;
    }
  }

  return false;
}

export function parseTeltonika(buffer: Buffer): {
  type: 'LOGIN' | 'DATA' | 'COMMAND_RESPONSE' | 'UNKNOWN';
  imei?: string;
  codecId?: number;
  recordCount?: number;
  records?: TeltonikaRecord[];
} {
  // Check Login Handshake
  if (buffer.length >= 17 && buffer.readUInt16BE(0) === 15) {
    const imei = buffer.subarray(2, 17).toString('ascii');
    if (/^\\d{15}$/.test(imei)) {
      return { type: 'LOGIN', imei };
    }
  }

  // Check Data Packet
  if (buffer.length >= 9 && buffer.readUInt32BE(0) === 0) {
    const dataLen = buffer.readUInt32BE(4);
    const codecId = buffer.readUInt8(8);

    if (codecId === 0x08) {
      const res = parseCodec8(buffer, 8);
      return { type: 'DATA', codecId, recordCount: res.recordCount, records: res.records };
    } else if (codecId === 0x8E) {
      const res = parseCodec8Extended(buffer, 8);
      return { type: 'DATA', codecId, recordCount: res.recordCount, records: res.records };
    }
  }

  return { type: 'UNKNOWN' };
}

export function generateTeltonikaResponse(parsed: { type: string; recordCount?: number }): Buffer {
  if (parsed.type === 'LOGIN') {
    // 1-Byte Handshake Accept
    return Buffer.from([0x01]);
  } else if (parsed.type === 'DATA') {
    // 4-Byte Record Count Acknowledgment
    const count = parsed.recordCount || 1;
    const ack = Buffer.alloc(4);
    ack.writeUInt32BE(count, 0);
    return ack;
  }
  return Buffer.from([0x01]);
}
`;

fs.writeFileSync(path.join(targetDir, 'codec8.ts'), codec8Content);
fs.writeFileSync(path.join(targetDir, 'codec8ext.ts'), codec8ExtContent);
fs.writeFileSync(path.join(targetDir, 'codec12.ts'), codec12Content);
fs.writeFileSync(path.join(targetDir, 'index.ts'), indexContent);
console.log('Successfully generated all Teltonika TypeScript protocol files.');
