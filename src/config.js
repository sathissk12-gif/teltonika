const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

module.exports = {
  tcpPort: parseInt(process.env.TCP_PORT, 10) || 5023,
  httpPort: parseInt(process.env.HTTP_PORT, 10) || 3001,
  dbType: process.env.DB_TYPE || 'sqlite',
  sqliteDbPath: path.resolve(__dirname, '../data/telematics.db'),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  defaultTheftThresholdLiters: parseFloat(process.env.DEFAULT_THEFT_THRESHOLD_LITERS) || 5.0,
  defaultTheftWindowMinutes: parseInt(process.env.DEFAULT_THEFT_WINDOW_MINUTES, 10) || 10,
  defaultRefuelThresholdLiters: parseFloat(process.env.DEFAULT_REFUEL_THRESHOLD_LITERS) || 10.0,
  retentionDays: parseInt(process.env.DATA_RETENTION_DAYS, 10) || 90, // 3 Months CAN Retention
};
