/**
 * Live CAN Telemetry & Gauge Cluster Controller
 */

function updateGauges(telemetry, tankCapacity = 480) {
  if (!telemetry) return;

  // 1. Fuel Tank Liquid Gauge
  const fuelPct = telemetry.fuelPercentage !== null && telemetry.fuelPercentage !== undefined 
    ? telemetry.fuelPercentage 
    : 0;
  const fuelLiters = telemetry.fuelLiters !== null && telemetry.fuelLiters !== undefined 
    ? telemetry.fuelLiters 
    : ((fuelPct / 100) * tankCapacity).toFixed(1);

  const tankLiquid = document.getElementById('tankLiquid');
  const fuelLitersElem = document.getElementById('fuelLitersVal');
  const fuelPctElem = document.getElementById('fuelPercentVal');
  const fuelRangeElem = document.getElementById('fuelRangeVal');

  if (tankLiquid) {
    tankLiquid.style.height = `${Math.min(Math.max(fuelPct, 0), 100)}%`;
    tankLiquid.classList.toggle('low', fuelPct < 15);
    tankLiquid.classList.toggle('warning', fuelPct >= 15 && fuelPct < 30);
  }

  if (fuelLitersElem) fuelLitersElem.innerText = `${fuelLiters} L`;
  if (fuelPctElem) fuelPctElem.innerText = `${fuelPct}%`;
  if (fuelRangeElem) {
    // Estimated range at ~3.8 km/L average commercial truck efficiency
    const estRange = (parseFloat(fuelLiters) * 3.8).toFixed(0);
    fuelRangeElem.innerText = `~${estRange} km`;
  }

  // 2. Speedometer
  const speedElem = document.getElementById('kpiSpeed');
  if (speedElem) speedElem.innerHTML = `${telemetry.speed || 0} <small>km/h</small>`;

  // 3. Engine RPM
  const rpmElem = document.getElementById('kpiRpm');
  if (rpmElem) rpmElem.innerHTML = `${telemetry.engineRpm || 0} <small>RPM</small>`;

  // 4. Odometer
  const odoElem = document.getElementById('kpiOdometer');
  if (odoElem) {
    const odo = typeof telemetry.odometerKm === 'number' 
      ? telemetry.odometerKm.toLocaleString() 
      : (telemetry.odometerKm || '0');
    odoElem.innerHTML = `${odo} <small>km</small>`;
  }

  // 5. Coolant Temp
  const tempElem = document.getElementById('kpiCoolant');
  if (tempElem) {
    const temp = telemetry.coolantTemp || 0;
    tempElem.innerHTML = `${temp} <small>°C</small>`;
    tempElem.style.color = temp > 95 ? 'var(--accent-red)' : 'var(--text-primary)';
  }

  // 6. Battery Voltage
  const voltElem = document.getElementById('kpiBattery');
  if (voltElem) voltElem.innerHTML = `${telemetry.batteryVoltage || '24.0'} <small>V</small>`;

  // 7. AdBlue Level
  const adBlueElem = document.getElementById('kpiAdBlue');
  if (adBlueElem) {
    if (telemetry.adBlueLevel !== null && telemetry.adBlueLevel !== undefined) {
      adBlueElem.innerHTML = `${telemetry.adBlueLevel} <small>%</small>`;
      adBlueElem.parentElement.style.display = 'flex';
    } else {
      adBlueElem.parentElement.style.display = 'none';
    }
  }

  // 8. Ignition Status Pill
  const ignPill = document.getElementById('pillIgnition');
  if (ignPill) {
    const isIgnOn = telemetry.ignition === true || telemetry.ignition === 'ON' || telemetry.ignition === 1;
    ignPill.innerText = isIgnOn ? 'IGNITION ON' : 'IGNITION OFF';
    ignPill.className = `pill-status ${isIgnOn ? 'on' : 'off'}`;
  }

  // 9. Satellites Count
  const satsElem = document.getElementById('mapSatellites');
  if (satsElem) satsElem.innerText = `🛰️ ${telemetry.satellites || 0} Sats`;

  // 10. Update 2D Wireframe if available
  if (window.WireframeController) {
    window.WireframeController.updateWireframe(telemetry);
  }
}

window.GaugesController = {
  updateGauges
};
