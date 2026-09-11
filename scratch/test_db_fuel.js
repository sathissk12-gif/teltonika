const { DatabaseSync } = require('node:sqlite');
const sqliteDb = new DatabaseSync('data/telematics.db');
const rows = sqliteDb.prepare(`
  SELECT 
    timestamp, speed, ignition, engine_rpm,
    fuel_rate_liters_per_hour, ecm_total_fuel_consumed, fuel_liters
  FROM can_telemetry_history
  WHERE imei = '353742372466615' AND timestamp >= '2026-09-10T18:30:00.000Z' AND timestamp <= '2026-09-11T18:29:59.999Z' AND is_valid = 1
  ORDER BY timestamp ASC
`).all();

let combustionFuelBurn = 0;
for (let i = 1; i < rows.length; i++) {
  const p1 = rows[i - 1];
  const p2 = rows[i];
  const dtHours = Math.max(0.0001, (new Date(p2.timestamp) - new Date(p1.timestamp)) / 3600000);
  if (dtHours < 0.05) {
    const fr = (p2.fuel_rate_liters_per_hour !== null && p2.fuel_rate_liters_per_hour !== undefined && p2.fuel_rate_liters_per_hour > 0)
      ? p2.fuel_rate_liters_per_hour
      : (p2.speed > 0 ? (p2.speed / 12.5) : (p2.ignition || p2.engine_rpm > 300 ? 0.8 : 0));
    combustionFuelBurn += (fr * dtHours);
  }
}
console.log('CombustionFuelBurn calculated:', combustionFuelBurn);
console.log('StartPt:', rows[0]);
console.log('EndPt:', rows[rows.length-1]);
