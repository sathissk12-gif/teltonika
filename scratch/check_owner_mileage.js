const { DatabaseSync } = require('node:sqlite');
const sqlite = new DatabaseSync('data/telematics.db');

const rows = sqlite.prepare(`
  SELECT speed, engine_rpm, fuel_rate_liters_per_hour, fuel_liters, fuel_percentage, timestamp, total_mileage_can
  FROM can_telemetry_history
  WHERE imei = '353742372466615' AND timestamp >= '2026-09-10T18:30:00.000Z'
  ORDER BY timestamp ASC
`).all();

let totalBurnLiters = 0;
let movingRows = 0;
let sumInstantMileage = 0;
let speedSum = 0;
let idleSeconds = 0;

for (let i = 1; i < rows.length; i++) {
  const p1 = rows[i-1];
  const p2 = rows[i];
  const dtHours = Math.max(0, (new Date(p2.timestamp) - new Date(p1.timestamp)) / 3600000);
  const dtSec = dtHours * 3600;
  const fr = (p2.fuel_rate_liters_per_hour !== null && p2.fuel_rate_liters_per_hour !== undefined) 
    ? p2.fuel_rate_liters_per_hour 
    : (p2.speed > 0 ? p2.speed / 12.5 : 0.8);
  
  if (dtHours < 0.05) {
    totalBurnLiters += fr * dtHours;
  }
  if (p2.speed > 5) {
    movingRows++;
    speedSum += p2.speed;
    const instM = p2.speed / Math.max(0.1, fr);
    sumInstantMileage += instM;
  } else if (p2.engine_rpm > 300) {
    idleSeconds += dtSec;
  }
}

console.log('Total Rows Today:', rows.length);
console.log('First Point:', rows[0].timestamp, 'Odo:', rows[0].total_mileage_can, 'Fuel Level:', rows[0].fuel_liters);
console.log('Last Point:', rows[rows.length-1].timestamp, 'Odo:', rows[rows.length-1].total_mileage_can, 'Fuel Level:', rows[rows.length-1].fuel_liters);
console.log('Integrated Total Combustion Fuel Burned:', totalBurnLiters.toFixed(2), 'Liters');
console.log('Moving Avg Speed:', (speedSum / Math.max(1, movingRows)).toFixed(1), 'km/h');
console.log('Moving Avg Instant Mileage:', (sumInstantMileage / Math.max(1, movingRows)).toFixed(1), 'km/L');
const totalOdoDiff = (rows[rows.length-1].total_mileage_can || 109832) - (rows[0].total_mileage_can || 109616);
console.log('Odometer Difference (Total Run):', totalOdoDiff, 'km');
if (totalBurnLiters > 0) {
  console.log('Combustion-based Mileage (Odo / Fuel Burned):', (totalOdoDiff / totalBurnLiters).toFixed(1), 'km/L');
}
console.log('Idle Minutes:', (idleSeconds / 60).toFixed(1), 'mins (Idle Fuel:', ((idleSeconds / 3600) * 0.8).toFixed(2), 'L)');
