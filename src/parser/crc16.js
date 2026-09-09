/**
 * Teltonika CRC-16/IBM Checksum Validator
 * Polynomial: 0xA001 (reversed 0x8005), Initial: 0x0000
 */

function calculateCRC16(buffer) {
  let crc = 0x0000;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x0001) !== 0) {
        crc = (crc >> 1) ^ 0xa001;
      } else {
        crc = crc >> 1;
      }
    }
  }
  return crc & 0xffff;
}

function verifyCRC16(dataBuffer, expectedCrc) {
  const calculated = calculateCRC16(dataBuffer);
  return calculated === (expectedCrc & 0xffff);
}

module.exports = {
  calculateCRC16,
  verifyCRC16
};
