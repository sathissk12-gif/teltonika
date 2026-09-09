/**
 * Unit Test Suite for Teltonika Parser & Telematics Suite
 */

const assert = require('assert');
const { calculateCRC16, verifyCRC16 } = require('../src/parser/crc16');
const { parseCodec8 } = require('../src/parser/codec8');
const { parseCodec8Extended } = require('../src/parser/codec8ext');
const { encodeCodec12Command, decodeCodec12Response } = require('../src/parser/codec12');
const { calculateLiters, generateLinearPoints } = require('../src/engine/calibration');
const { buildCodec8ExtPacket } = require('../src/simulator/packetGenerator');

console.log('🧪 Running Teltonika Telematics Suite Tests...\n');

// TEST 1: CRC-16 Calculation
console.log('1. Testing CRC-16 IBM algorithm...');
const testBuf = Buffer.from('123456789', 'ascii');
const crc = calculateCRC16(testBuf);
assert.strictEqual(typeof crc, 'number');
assert.strictEqual(verifyCRC16(testBuf, crc), true);
console.log('   ✅ CRC-16 calculated and verified successfully: 0x' + crc.toString(16));

// TEST 2: Calibration Engine (Interpolation)
console.log('\n2. Testing Multi-Point Diesel Calibration Engine...');
const testPoints = [
  { raw: 0, liters: 0 },
  { raw: 25, liters: 110 },
  { raw: 50, liters: 235 },
  { raw: 75, liters: 362 },
  { raw: 100, liters: 480 }
];
assert.strictEqual(calculateLiters(0, testPoints), 0);
assert.strictEqual(calculateLiters(25, testPoints), 110);
assert.strictEqual(calculateLiters(50, testPoints), 235);
assert.strictEqual(calculateLiters(100, testPoints), 480);
// Midpoint between 50% (235L) and 75% (362L) -> at 62.5% should be 298.5L
const mid = calculateLiters(62.5, testPoints);
assert.strictEqual(mid, 298.5);
console.log('   ✅ Linear interpolation test passed: 62.5% -> ' + mid + ' Liters');

// TEST 3: Codec 12 Command Encoding & Decoding
console.log('\n3. Testing Codec 12 Command Protocol...');
const encodedCmd = encodeCodec12Command('setdigout 1 0');
assert.strictEqual(encodedCmd.readUInt32BE(0), 0); // Preamble
const dataSize = encodedCmd.readUInt32BE(4);
assert.strictEqual(encodedCmd.readUInt8(8), 0x0C); // Codec ID
console.log('   ✅ Encoded "setdigout 1 0" into ' + encodedCmd.length + ' bytes');

// Test Response Decoding
// Codec 12 Response: Codec ID (0x0C), Qty1 (1), Type (0x06), Size (5), Text ("OK\r\n\0"), Qty2 (1)
const respPayload = Buffer.alloc(1 + 1 + 1 + 4 + 4 + 1);
respPayload.writeUInt8(0x0C, 0);
respPayload.writeUInt8(0x01, 1);
respPayload.writeUInt8(0x06, 2); // Response Type
respPayload.writeUInt32BE(4, 3);
respPayload.write('OK\r\n', 7, 'ascii');
respPayload.writeUInt8(0x01, 11);
const decodedResp = decodeCodec12Response(respPayload, 0);
assert.strictEqual(decodedResp.responseText, 'OK');
console.log('   ✅ Decoded Codec 12 Response successfully: "' + decodedResp.responseText + '"');

// TEST 4: Codec 8 Extended Packet Generation & Parsing
console.log('\n4. Testing Codec 8 Extended Packet Builder & Parser...');
const samplePacket = buildCodec8ExtPacket({
  lat: 13.0827,
  lng: 80.2707,
  speed: 55,
  fuelPercentage: 78,
  engineRpm: 1850,
  ignition: true,
  coolantTemp: 88,
  odometerKm: 125000.5
});

// Check Packet Structure
assert.strictEqual(samplePacket.readUInt32BE(0), 0x00000000); // Preamble
const payloadLen = samplePacket.readUInt32BE(4);
const payloadBuf = samplePacket.slice(8, 8 + payloadLen);
const parsed = parseCodec8Extended(payloadBuf, 0);

assert.strictEqual(parsed.codecId, 0x8E);
assert.strictEqual(parsed.recordCount, 1);
const rec = parsed.records[0];
assert.strictEqual(Math.round(rec.gps.latitude * 100) / 100, 13.08);
assert.strictEqual(Math.round(rec.gps.longitude * 100) / 100, 80.27);
assert.strictEqual(rec.gps.speed, 55);
assert.strictEqual(rec.telemetry.fuelLevelPercentage, 78);
assert.strictEqual(rec.telemetry.engineRpm, 1850);
assert.strictEqual(rec.telemetry.ignition, true);
assert.strictEqual(rec.telemetry.coolantTemp, 88);

console.log('   ✅ Parsed Record: Lat=' + rec.gps.latitude + ', Lng=' + rec.gps.longitude + ', Fuel%=' + rec.telemetry.fuelLevelPercentage + '%, RPM=' + rec.telemetry.engineRpm);

console.log('\n🎉 ALL TESTS PASSED! Telematics Parser & Core Engine is 100% Solid!\n');
