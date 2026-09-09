/**
 * Realistic Teltonika Codec 8 Extended Packet Generator
 * Builds valid binary packets for FMX150 / FMB150 GPS & CAN trackers
 */

const { calculateCRC16 } = require('../parser/crc16');

/**
 * Builds a Handshake packet containing IMEI
 * @param {string} imei - 15-digit IMEI
 * @returns {Buffer} Handshake binary buffer
 */
function buildHandshakePacket(imei) {
  const imeiBuf = Buffer.from(imei, 'ascii');
  const buf = Buffer.alloc(2 + imeiBuf.length);
  buf.writeUInt16BE(imeiBuf.length, 0);
  imeiBuf.copy(buf, 2);
  return buf;
}

/**
 * Builds a Codec 8 Extended AVL binary packet
 * @param {object} params - Telemetry parameters
 * @returns {Buffer} Full Teltonika binary packet with Preamble, Payload, and CRC-16
 */
function buildCodec8ExtPacket(params = {}) {
  const lat = params.lat || 11.6643;
  const lng = params.lng || 78.1460;
  const speed = params.speed || 45;
  const angle = params.angle || 180;
  const altitude = params.altitude || 278;
  const satellites = params.satellites || 14;
  const timestamp = params.timestamp ? new Date(params.timestamp).getTime() : Date.now();

  const fuelPct = Math.round(params.fuelPercentage !== undefined ? params.fuelPercentage : 75);
  const rpm = Math.round(params.engineRpm || 1650);
  const ignition = params.ignition !== undefined ? (params.ignition ? 1 : 0) : 1;
  const coolantTemp = Math.round(params.coolantTemp || 86);
  const odometerMeters = Math.round((params.odometerKm || 142580) * 1000);
  const batteryMv = Math.round((params.batteryVoltage || 24.2) * 1000);
  const adBluePct = Math.round(params.adBlueLevel || 88);

  // IO Elements Buffer Layout:
  // 1-Byte IOs (4 elements):
  //   - 83 (0x0053): Fuel %
  //   - 239 (0x00EF): Ignition
  //   - 36 (0x0024): Coolant Temp
  //   - 102 (0x0066): AdBlue Level %
  // 2-Byte IOs (2 elements):
  //   - 32 (0x0020): Engine RPM
  //   - 66 (0x0042): External Voltage (mV)
  // 4-Byte IOs (1 element):
  //   - 16 (0x0010): Total Odometer (m)

  // Construct AVL Record
  const avlRecordBuf = Buffer.alloc(8 + 1 + 15 + 2 + 2 + (2 + 4 * 3) + (2 + 2 * 4) + (2 + 1 * 6) + 2 + 2);
  let offset = 0;

  // 1. Timestamp (8B)
  avlRecordBuf.writeBigUInt64BE(BigInt(timestamp), offset);
  offset += 8;

  // 2. Priority (1B)
  avlRecordBuf.writeUInt8(0x01, offset);
  offset += 1;

  // 3. GPS Element (15B)
  avlRecordBuf.writeInt32BE(Math.round(lng * 10000000), offset);
  offset += 4;
  avlRecordBuf.writeInt32BE(Math.round(lat * 10000000), offset);
  offset += 4;
  avlRecordBuf.writeInt16BE(altitude, offset);
  offset += 2;
  avlRecordBuf.writeUInt16BE(angle, offset);
  offset += 2;
  avlRecordBuf.writeUInt8(satellites, offset);
  offset += 1;
  avlRecordBuf.writeUInt16BE(speed, offset);
  offset += 2;

  // 4. IO Elements
  avlRecordBuf.writeUInt16BE(0x0001, offset); // Event IO ID (DIN1 changed)
  offset += 2;
  avlRecordBuf.writeUInt16BE(7, offset); // Total IOs = 7
  offset += 2;

  // 1-Byte IOs (Count = 4)
  avlRecordBuf.writeUInt16BE(4, offset);
  offset += 2;
  // IO 83: Fuel %
  avlRecordBuf.writeUInt16BE(83, offset);
  offset += 2;
  avlRecordBuf.writeUInt8(fuelPct, offset);
  offset += 1;
  // IO 239: Ignition
  avlRecordBuf.writeUInt16BE(239, offset);
  offset += 2;
  avlRecordBuf.writeUInt8(ignition, offset);
  offset += 1;
  // IO 36: Coolant Temp
  avlRecordBuf.writeUInt16BE(36, offset);
  offset += 2;
  avlRecordBuf.writeUInt8(coolantTemp, offset);
  offset += 1;
  // IO 102: AdBlue %
  avlRecordBuf.writeUInt16BE(102, offset);
  offset += 2;
  avlRecordBuf.writeUInt8(adBluePct, offset);
  offset += 1;

  // 2-Byte IOs (Count = 2)
  avlRecordBuf.writeUInt16BE(2, offset);
  offset += 2;
  // IO 32: RPM
  avlRecordBuf.writeUInt16BE(32, offset);
  offset += 2;
  avlRecordBuf.writeUInt16BE(rpm, offset);
  offset += 2;
  // IO 66: External Voltage (mV)
  avlRecordBuf.writeUInt16BE(66, offset);
  offset += 2;
  avlRecordBuf.writeUInt16BE(batteryMv, offset);
  offset += 2;

  // 4-Byte IOs (Count = 1)
  avlRecordBuf.writeUInt16BE(1, offset);
  offset += 2;
  // IO 16: Odometer (m)
  avlRecordBuf.writeUInt16BE(16, offset);
  offset += 2;
  avlRecordBuf.writeUInt32BE(odometerMeters, offset);
  offset += 4;

  // 8-Byte IOs (Count = 0)
  avlRecordBuf.writeUInt16BE(0, offset);
  offset += 2;

  // Variable IOs (Count = 0)
  avlRecordBuf.writeUInt16BE(0, offset);
  offset += 2;

  const actualRecordLen = offset;
  const trimmedRecordBuf = avlRecordBuf.slice(0, actualRecordLen);

  // Payload: Codec ID (1B) + Count1 (1B) + AVL Record + Count2 (1B)
  const payloadSize = 1 + 1 + actualRecordLen + 1;
  const payloadBuf = Buffer.alloc(payloadSize);
  payloadBuf.writeUInt8(0x8e, 0); // Codec 8 Extended
  payloadBuf.writeUInt8(0x01, 1); // 1 Record
  trimmedRecordBuf.copy(payloadBuf, 2);
  payloadBuf.writeUInt8(0x01, 2 + actualRecordLen); // Count 2

  // Calculate CRC-16
  const crc = calculateCRC16(payloadBuf);

  // Full Packet: Preamble (4B) + Data Length (4B) + Payload + CRC-16 (4B)
  const packet = Buffer.alloc(4 + 4 + payloadSize + 4);
  packet.writeUInt32BE(0x00000000, 0);
  packet.writeUInt32BE(payloadSize, 4);
  payloadBuf.copy(packet, 8);
  packet.writeUInt32BE(crc, 8 + payloadSize);

  return packet;
}

module.exports = {
  buildHandshakePacket,
  buildCodec8ExtPacket
};
