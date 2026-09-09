/**
 * Teltonika Codec 12 (0x0C) GPRS Command Protocol
 * Handles encoding commands (e.g. 'setdigout 1', 'getinfo', 'getio') and decoding responses.
 */

const { calculateCRC16 } = require('./crc16');

/**
 * Encodes a text command into a complete Codec 12 binary packet ready to send over TCP
 * @param {string} commandText - Text command, e.g. "setdigout 1 0" or "getinfo"
 * @returns {Buffer} Raw binary packet
 */
function encodeCodec12Command(commandText) {
  const cmdBuf = Buffer.from(commandText, 'ascii');
  const cmdSize = cmdBuf.length;

  // Data payload (from Codec ID to Command Quantity 2)
  // Codec ID (1B) + Qty1 (1B) + Type 0x05 (1B) + Size (4B) + Cmd (N) + Qty2 (1B)
  const dataSize = 1 + 1 + 1 + 4 + cmdSize + 1;
  const payloadBuf = Buffer.alloc(dataSize);

  let offset = 0;
  payloadBuf.writeUInt8(0x0c, offset); // Codec ID
  offset += 1;
  payloadBuf.writeUInt8(0x01, offset); // Qty 1
  offset += 1;
  payloadBuf.writeUInt8(0x05, offset); // Type = Command (0x05)
  offset += 1;
  payloadBuf.writeUInt32BE(cmdSize, offset); // Command Size
  offset += 4;
  cmdBuf.copy(payloadBuf, offset); // Command ASCII
  offset += cmdSize;
  payloadBuf.writeUInt8(0x01, offset); // Qty 2

  // Calculate CRC-16 of the payload
  const crc = calculateCRC16(payloadBuf);

  // Full packet: Preamble (4B) + Data Size (4B) + Payload + CRC (4B)
  const packet = Buffer.alloc(4 + 4 + dataSize + 4);
  packet.writeUInt32BE(0x00000000, 0); // Preamble (4 Zero Bytes)
  packet.writeUInt32BE(dataSize, 4); // Data Size
  payloadBuf.copy(packet, 8); // Payload
  packet.writeUInt32BE(crc, 8 + dataSize); // CRC-16 padded to 4 bytes

  return packet;
}

/**
 * Decodes a Codec 12 response received from a device
 * @param {Buffer} buffer - Buffer starting from Codec ID (0x0C)
 * @returns {object} Decoded response
 */
function decodeCodec12Response(buffer, offset = 0) {
  const codecId = buffer.readUInt8(offset);
  offset += 1;

  if (codecId !== 0x0c) {
    throw new Error(`Invalid Codec ID for Codec12: 0x${codecId.toString(16)}`);
  }

  const responseQty1 = buffer.readUInt8(offset);
  offset += 1;
  const messageType = buffer.readUInt8(offset);
  offset += 1;

  const isResponse = messageType === 0x06;
  const responseSize = buffer.readUInt32BE(offset);
  offset += 4;

  const responseText = buffer.toString('ascii', offset, offset + responseSize);
  offset += responseSize;

  const responseQty2 = buffer.readUInt8(offset);
  offset += 1;

  return {
    codecId: 0x0c,
    codecName: 'Codec 12',
    isResponse,
    messageType,
    responseSize,
    responseText: responseText.trim(),
    bytesConsumed: offset
  };
}

module.exports = {
  encodeCodec12Command,
  decodeCodec12Response
};
