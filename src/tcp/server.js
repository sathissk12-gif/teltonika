/**
 * High-Performance Teltonika TCP Server (Port 5023)
 * Handles IMEI authentication, Codec 8 / Codec 8 Extended parsing, ACK management,
 * and Codec 12 remote GPRS command execution.
 */

const net = require('net');
const config = require('../config');
const { verifyCRC16 } = require('../parser/crc16');
const { parseCodec8 } = require('../parser/codec8');
const { parseCodec8Extended } = require('../parser/codec8ext');
const { decodeCodec12Response, encodeCodec12Command } = require('../parser/codec12');
const { calculateLiters } = require('../engine/calibration');
const FuelTheftDetector = require('../engine/theftDetector');
const MileageEngine = require('../engine/mileageEngine');
const Database = require('../database/db');

class TeltonikaTcpServer {
  constructor(options = {}) {
    this.port = options.port || config.tcpPort;
    this.activeSockets = new Map(); // imei -> net.Socket
    this.theftDetector = new FuelTheftDetector({
      theftThresholdLiters: config.defaultTheftThresholdLiters,
      theftWindowMinutes: config.defaultTheftWindowMinutes,
      refuelThresholdLiters: config.defaultRefuelThresholdLiters
    });
    this.mileageEngine = new MileageEngine();
    this.wsBroadcaster = null; // Injected WebSocket broadcaster
    this.server = null;
  }

  setBroadcaster(broadcaster) {
    this.wsBroadcaster = broadcaster;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.listen(this.port, () => {
        console.log(`[TCP Server] 🚀 Teltonika TCP Server listening on port ${this.port}`);
        resolve();
      });

      this.server.on('error', (err) => {
        console.error(`[TCP Server] Error on port ${this.port}:`, err.message);
        reject(err);
      });
    });
  }

  handleConnection(socket) {
    const remoteAddr = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[TCP Server] 🔌 New connection from ${remoteAddr}`);

    let authenticatedImei = null;
    let buffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      try {
        // STEP 1: Handshake (IMEI Authentication)
        if (!authenticatedImei) {
          if (buffer.length >= 2) {
            const imeiLength = buffer.readUInt16BE(0);
            if (buffer.length >= 2 + imeiLength) {
              authenticatedImei = buffer.toString('ascii', 2, 2 + imeiLength).trim();
              buffer = buffer.slice(2 + imeiLength);

              console.log(`[TCP Server] 📱 Handshake successful for IMEI: ${authenticatedImei}`);
              this.activeSockets.set(authenticatedImei, socket);

              // Update device online status in database
              Database.upsertDevice({
                imei: authenticatedImei,
                status: 'ONLINE'
              });

              // Send 1-Byte Handshake Accept Confirmation (0x01)
              const acceptBuf = Buffer.from([0x01]);
              socket.write(acceptBuf);
            }
          }
          return;
        }

        // STEP 2: Process AVL Data Packets (Preamble 4 Zero Bytes + Length 4 Bytes)
        while (buffer.length >= 8) {
          const preamble = buffer.readUInt32BE(0);
          if (preamble !== 0x00000000) {
            // Out of sync, scan for next preamble or clear
            const nextPreamble = buffer.indexOf(Buffer.from([0x00, 0x00, 0x00, 0x00]));
            if (nextPreamble !== -1) {
              buffer = buffer.slice(nextPreamble);
            } else {
              buffer = Buffer.alloc(0);
              break;
            }
          }

          const dataLength = buffer.readUInt32BE(4);
          const fullPacketLength = 4 + 4 + dataLength + 4; // Preamble (4) + Length (4) + Payload + CRC (4)

          if (buffer.length < fullPacketLength) {
            // Awaiting full packet chunk
            break;
          }

          // Extract Data Payload & CRC
          const payloadBuffer = buffer.slice(8, 8 + dataLength);
          const expectedCrc = buffer.readUInt32BE(8 + dataLength);
          buffer = buffer.slice(fullPacketLength);

          // Verify CRC-16
          const isCrcValid = verifyCRC16(payloadBuffer, expectedCrc);
          if (!isCrcValid) {
            console.warn(`[TCP Server] ⚠️ CRC-16 mismatch from IMEI ${authenticatedImei}. Processing payload anyway.`);
          }

          // Parse Payload by Codec ID
          const codecId = payloadBuffer.readUInt8(0);
          let parsedResult = null;

          if (codecId === 0x08) {
            parsedResult = parseCodec8(payloadBuffer, 0);
          } else if (codecId === 0x8e) {
            parsedResult = parseCodec8Extended(payloadBuffer, 0);
          } else if (codecId === 0x0c) {
            // Codec 12 GPRS Command Response
            const cmdResponse = decodeCodec12Response(payloadBuffer, 0);
            console.log(`[TCP Server] 💬 Codec 12 Response from ${authenticatedImei}: "${cmdResponse.responseText}"`);

            Database.saveCommandLog({
              imei: authenticatedImei,
              type: 'RESPONSE',
              response: cmdResponse.responseText
            });

            if (this.wsBroadcaster) {
              this.wsBroadcaster.broadcast('command_response', {
                imei: authenticatedImei,
                response: cmdResponse.responseText,
                timestamp: new Date().toISOString()
              });
            }
            continue;
          } else {
            console.warn(`[TCP Server] Unsupported Codec ID: 0x${codecId.toString(16)} from ${authenticatedImei}`);
            continue;
          }

          if (parsedResult && parsedResult.records) {
            const device = Database.getDevice(authenticatedImei);
            const calibrationPoints = device ? device.calibrationPoints : null;

            for (const record of parsedResult.records) {
              // 1. Calculate Fuel in Liters
              const rawFuel = record.telemetry.fuelLevelPercentage !== undefined 
                ? record.telemetry.fuelLevelPercentage 
                : record.telemetry.fuelLevel;
              
              const calculatedLiters = calculateLiters(rawFuel, calibrationPoints);

              // 2. Compute Mileage & Fuel Economy Metrics
              const mileageMetrics = this.mileageEngine.process(authenticatedImei, record.telemetry, device || {});

              // 3. Save Telemetry into Database
              const savedItem = Database.saveTelemetry(authenticatedImei, record, calculatedLiters, mileageMetrics);

              // 3. Fuel Theft / Refuel Analysis
              const alert = this.theftDetector.process(authenticatedImei, savedItem);
              if (alert) {
                const savedAlert = Database.saveAlert({
                  imei: authenticatedImei,
                  vehicleNumber: device ? device.vehicleNumber : `VEH-${authenticatedImei.slice(-4)}`,
                  ...alert
                });

                if (this.wsBroadcaster) {
                  this.wsBroadcaster.broadcast('alert', savedAlert);
                }
              }

              // 4. Real-Time Broadcast via WebSocket
              if (this.wsBroadcaster) {
                this.wsBroadcaster.broadcast('telemetry', {
                  imei: authenticatedImei,
                  vehicleNumber: device ? device.vehicleNumber : `VEH-${authenticatedImei.slice(-4)}`,
                  data: savedItem
                });
              }
            }

            // 5. Send ACK with Number of Accepted Records (4 Bytes Big Endian integer)
            const ackBuf = Buffer.alloc(4);
            ackBuf.writeUInt32BE(parsedResult.recordCount, 0);
            socket.write(ackBuf);
            console.log(`[TCP Server] 📤 Sent ACK (${parsedResult.recordCount} records) to IMEI: ${authenticatedImei}`);
          }
        }
      } catch (err) {
        console.error(`[TCP Server] Error processing data from ${authenticatedImei || remoteAddr}:`, err.message);
      }
    });

    socket.on('close', () => {
      if (authenticatedImei) {
        console.log(`[TCP Server] 🔌 Connection closed for IMEI: ${authenticatedImei}`);
        this.activeSockets.delete(authenticatedImei);
        Database.upsertDevice({
          imei: authenticatedImei,
          status: 'OFFLINE'
        });
        if (this.wsBroadcaster) {
          this.wsBroadcaster.broadcast('device_status', {
            imei: authenticatedImei,
            status: 'OFFLINE'
          });
        }
      }
    });

    socket.on('error', (err) => {
      console.warn(`[TCP Server] Socket error (${authenticatedImei || remoteAddr}):`, err.message);
    });
  }

  /**
   * Dispatches a remote Codec 12 GPRS command to a connected Teltonika device
   * @param {string} imei - Target device IMEI
   * @param {string} commandText - e.g. "setdigout 1 0" or "getinfo"
   */
  sendCommand(imei, commandText) {
    const socket = this.activeSockets.get(imei);
    if (!socket || socket.destroyed) {
      throw new Error(`Device ${imei} is currently OFFLINE or TCP socket is not connected.`);
    }

    const commandPacket = encodeCodec12Command(commandText);
    socket.write(commandPacket);

    Database.saveCommandLog({
      imei,
      type: 'COMMAND',
      command: commandText
    });

    console.log(`[TCP Server] 📨 Sent Codec 12 Command "${commandText}" to IMEI: ${imei}`);
    return { success: true, command: commandText };
  }

  isDeviceOnline(imei) {
    const socket = this.activeSockets.get(imei);
    return Boolean(socket && !socket.destroyed);
  }
}

module.exports = TeltonikaTcpServer;
