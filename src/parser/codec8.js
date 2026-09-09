/**
 * Teltonika Codec 8 (0x08) Binary Parser
 */

const { getAvlDefinition } = require('./avlDictionary');

function parseCodec8(buffer, offset = 0) {
  const startOffset = offset;
  const codecId = buffer.readUInt8(offset);
  offset += 1;

  if (codecId !== 0x08) {
    throw new Error(`Invalid Codec ID for Codec8: 0x${codecId.toString(16).toUpperCase()}`);
  }

  const recordCount = buffer.readUInt8(offset);
  offset += 1;

  const records = [];

  for (let r = 0; r < recordCount; r++) {
    // 1. Timestamp (8 bytes, Unix ms)
    const timestampBigInt = buffer.readBigUInt64BE(offset);
    offset += 8;
    const timestamp = new Date(Number(timestampBigInt));

    // 2. Priority (1 byte)
    const priority = buffer.readUInt8(offset);
    offset += 1;

    // 3. GPS Element (15 bytes)
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

    // 4. IO Element
    const eventIoId = buffer.readUInt8(offset);
    offset += 1;
    const totalIo = buffer.readUInt8(offset);
    offset += 1;

    const rawIos = {};
    const formattedParams = {};

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

    // Transform Raw IOs into Human-Readable fields
    for (const [idStr, val] of Object.entries(rawIos)) {
      const id = parseInt(idStr, 10);
      const def = getAvlDefinition(id);
      let calculatedVal = val;

      if (typeof val === 'number') {
        if (def.multiplier) calculatedVal = calculatedVal * def.multiplier;
        if (def.offset) calculatedVal = calculatedVal + def.offset;
        if (def.type === 'boolean') calculatedVal = val === 1;
      }

      formattedParams[def.name] = calculatedVal;
    }

    records.push({
      timestamp,
      priority,
      gps: {
        latitude,
        longitude,
        altitude,
        angle,
        satellites,
        speed,
        isValid: satellites > 0 || (latitude !== 0 && longitude !== 0)
      },
      eventIoId,
      totalIo,
      rawIos,
      telemetry: formattedParams
    });
  }

  const recordCount2 = buffer.readUInt8(offset);
  offset += 1;

  if (recordCount !== recordCount2) {
    throw new Error(`Record count mismatch: count1=${recordCount}, count2=${recordCount2}`);
  }

  return {
    codecId: 0x08,
    codecName: 'Codec 8',
    recordCount,
    records,
    bytesConsumed: offset - startOffset
  };
}

module.exports = {
  parseCodec8
};
