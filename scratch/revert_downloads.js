import fs from 'fs';
import path from 'path';

const target = 'C:/Users/sathi/Downloads/New folder/traxen-backend-main/traxen-backend-main';
const pdPath = path.join(target, 'src/protocols/protocol-detector.ts');

const orig = `export type ProtocolFamily = 'GT06' | 'GS03' | 'MT100' | 'MT200' | 'XYZ10' | 'UNKNOWN';

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

fs.writeFileSync(pdPath, orig, 'utf8');
console.log('Reverted protocol-detector.ts cleanly');
