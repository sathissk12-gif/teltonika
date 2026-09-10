/**
 * Traxen Telematics Suite - CAN Bus Diagnostics & Gauge Engine
 * Updates All 85+ Live CAN Bus Telemetry Parameters
 */

function updateGauges(telemetry, tankCapacity = 480) {
  if (!telemetry) return;

  // 1. Fuel Calculations
  let fuelLiters = '0.0';
  let fuelPct = 0;

  if (telemetry.fuelLevelLiters !== undefined && telemetry.fuelLevelLiters !== null && telemetry.fuelLevelLiters > 0) {
    fuelLiters = parseFloat(telemetry.fuelLevelLiters).toFixed(1);
    fuelPct = Math.min(100, Math.max(0, Math.round((parseFloat(fuelLiters) / (tankCapacity || 50)) * 100)));
  } else if (telemetry.fuelLiters !== null && telemetry.fuelLiters !== undefined && telemetry.fuelLiters > 0) {
    fuelLiters = parseFloat(telemetry.fuelLiters).toFixed(1);
    fuelPct = telemetry.fuelPercentage || Math.round((parseFloat(fuelLiters) / (tankCapacity || 50)) * 100);
  } else if (telemetry.fuelPercentage !== null && telemetry.fuelPercentage !== undefined && telemetry.fuelPercentage > 0) {
    fuelPct = telemetry.fuelPercentage;
    fuelLiters = ((fuelPct / 100) * (tankCapacity || 50)).toFixed(1);
  }

  // Liquid Tank Graphic
  const tankLiquid = document.getElementById('tankLiquid');
  const fuelLitersElem = document.getElementById('fuelLitersVal');
  const fuelPctElem = document.getElementById('fuelPercentVal');
  const fuelRangeElem = document.getElementById('fuelRangeVal');

  if (tankLiquid) {
    tankLiquid.style.height = `${Math.min(Math.max(fuelPct, 0), 100)}%`;
    tankLiquid.classList.toggle('low', fuelPct < 15);
  }

  if (fuelLitersElem) fuelLitersElem.innerText = `${fuelLiters} L`;
  if (fuelPctElem) fuelPctElem.innerText = `${fuelPct}% Full`;
  if (fuelRangeElem) {
    const estRange = telemetry.vehicleRange ? `${telemetry.vehicleRange} km` : `~${(parseFloat(fuelLiters) * 3.8).toFixed(0)} km`;
    fuelRangeElem.innerText = estRange;
  }

  // 2. Engine & Powertrain CAN Cluster
  setCanVal('canRpm', telemetry.engineRpm ? `${telemetry.engineRpm.toLocaleString()} RPM` : '0 RPM');
  setCanVal('canEngineLoad', `${telemetry.engineLoad || 0} %`);
  setCanVal('canCoolant', `${telemetry.coolantTemp || 0} °C`);
  setCanVal('canPedal', `${telemetry.acceleratorPedal || 0} %`);
  setCanVal('canOilPressure', telemetry.oilPressure !== undefined && telemetry.oilPressure !== 0 ? `${telemetry.oilPressure} bar` : '-- bar');
  setCanVal('canOilTemp', telemetry.engineOilTemp ? `${telemetry.engineOilTemp} °C` : '-- °C');
  setCanVal('canEngineHours', telemetry.engineHours ? `${telemetry.engineHours.toFixed(1)} h` : '0.0 h');
  setCanVal('canGear', telemetry.currentGear !== undefined && telemetry.currentGear !== 0 ? `Gear ${telemetry.currentGear}` : 'N');
  setCanVal('canPto', telemetry.ptoState ? 'ENGAGED 🟢' : 'OFF', telemetry.ptoState ? 'active' : 'inactive');

  // 3. Fuel, DEF & Emissions CAN Cluster
  setCanVal('canFuelLiters', `${fuelLiters} L`);
  setCanVal('canFuelPct', `${fuelPct} %`);
  setCanVal('canDirectLiters', (telemetry.fuelLevelLiters !== undefined && telemetry.fuelLevelLiters !== null) ? `${parseFloat(telemetry.fuelLevelLiters).toFixed(1)} L` : '-- L');
  
  const ecmCounted = telemetry.ecmTotalFuelConsumed !== undefined && telemetry.ecmTotalFuelConsumed !== null
    ? `${parseFloat(telemetry.ecmTotalFuelConsumed).toFixed(1)} L`
    : (telemetry.rawIos && telemetry.rawIos[88] ? `${(Number(telemetry.rawIos[88]) * 0.1).toFixed(1)} L` : '-- L');
  setCanVal('canEcmCountedFuel', ecmCounted);

  const injState = telemetry.injectionState || (telemetry.engineRpm > 0 ? 'ACTIVE_INJECTION' : 'ENGINE_OFF');
  let injLabel = 'OFF';
  let injClass = 'inactive';
  if (injState === 'ACTIVE_INJECTION' || injState === 'INJECTING_POWER') {
    injLabel = '⚡ INJECTING';
    injClass = 'active';
  } else if (injState === 'IDLE_INJECTION') {
    injLabel = '🟢 IDLE PULSE';
    injClass = 'active';
  } else if (injState === 'HIGH_LOAD_BOOST') {
    injLabel = '🔥 BOOST INJECT';
    injClass = 'highlight';
  } else if (injState === 'DECELERATION_CUTOFF') {
    injLabel = '🛑 DFCO CUTOFF';
    injClass = 'inactive';
  }
  setCanVal('canInjectorStatus', injLabel, injClass);

  const fRate = (telemetry.fuelRateLitersPerHour !== undefined && telemetry.fuelRateLitersPerHour > 0)
    ? parseFloat(telemetry.fuelRateLitersPerHour).toFixed(2)
    : (telemetry.fuelRate ? parseFloat(telemetry.fuelRate).toFixed(2) : '0.00');
  setCanVal('canFuelRate', `${fRate} L/h`);
  setCanVal('canTotalMileage', (telemetry.totalMileageCan !== undefined && telemetry.totalMileageCan !== null) ? `${parseFloat(telemetry.totalMileageCan).toLocaleString()} km` : (telemetry.odometer ? `${parseFloat(telemetry.odometer).toLocaleString()} km` : '-- km'));
  setCanVal('canVehicleRange', telemetry.vehicleRange ? `${telemetry.vehicleRange} km` : '-- km');
  setCanVal('canAdBlue', telemetry.adBlueLevel !== null && telemetry.adBlueLevel !== undefined ? `${telemetry.adBlueLevel} %` : '-- %');
  setCanVal('canServiceDist', telemetry.nextServiceDistance ? `${telemetry.nextServiceDistance.toLocaleString()} km` : '-- km');

  // Real-Time Mileage & Economy Hub
  const instantM = (telemetry.instantMileageKmPerLiter && telemetry.instantMileageKmPerLiter > 0) 
    ? parseFloat(telemetry.instantMileageKmPerLiter).toFixed(1) 
    : (telemetry.speed > 5 ? (parseFloat(telemetry.speed) / Math.max(0.5, (telemetry.fuelRate || 3.2))).toFixed(1) : '--');
  
  const avgM = (telemetry.avgMileageKmPerLiter && telemetry.avgMileageKmPerLiter > 0)
    ? parseFloat(telemetry.avgMileageKmPerLiter).toFixed(1)
    : (telemetry.avgMileage ? parseFloat(telemetry.avgMileage).toFixed(1) : '15.4');

  const tripDist = (telemetry.tripDistanceKm !== undefined && telemetry.tripDistanceKm !== null && telemetry.tripDistanceKm > 0)
    ? parseFloat(telemetry.tripDistanceKm).toFixed(1)
    : (telemetry.tripDistance ? parseFloat(telemetry.tripDistance).toFixed(1) : (telemetry.tripOdometerKm ? parseFloat(telemetry.tripOdometerKm).toFixed(1) : '0.0'));

  const tripFuel = (telemetry.tripFuelConsumedLiters !== undefined && telemetry.tripFuelConsumedLiters !== null && telemetry.tripFuelConsumedLiters > 0)
    ? parseFloat(telemetry.tripFuelConsumedLiters).toFixed(1)
    : (telemetry.tripFuel ? parseFloat(telemetry.tripFuel).toFixed(1) : '0.0');

  const costKm = (telemetry.costPerKm && telemetry.costPerKm > 0)
    ? `₹ ${parseFloat(telemetry.costPerKm).toFixed(2)}`
    : `₹ ${(102.5 / parseFloat(avgM || 15.4)).toFixed(2)}`;

  const estRange = telemetry.vehicleRange 
    ? `${telemetry.vehicleRange} km` 
    : `${(parseFloat(fuelLiters || 25) * parseFloat(avgM || 15.4)).toFixed(0)} km`;

  setCanVal('mileageInstantVal', instantM);
  setCanVal('mileageAvgVal', avgM);
  setCanVal('mileageTripDist', `${tripDist} km`);
  setCanVal('mileageTripFuel', `${tripFuel} L`);
  setCanVal('mileageCostPerKm', costKm);
  setCanVal('mileageRangeVal', estRange);

  // 4. Electrical, Body & Comfort CAN Cluster
  const isIgnOn = telemetry.ignition === true || telemetry.ignition === 'ON' || telemetry.ignition === 1;
  setCanVal('canIgnition', isIgnOn ? 'IGNITION ON 🟢' : 'IGNITION OFF', isIgnOn ? 'active' : 'inactive');
  setCanVal('canExtVolt', (telemetry.externalVoltage !== undefined && telemetry.externalVoltage !== null && telemetry.externalVoltage > 0) ? `${parseFloat(telemetry.externalVoltage).toFixed(1)} V` : '-- V');
  setCanVal('canIntVolt', (telemetry.batteryVoltage !== undefined && telemetry.batteryVoltage !== null && telemetry.batteryVoltage > 0) ? `${parseFloat(telemetry.batteryVoltage).toFixed(2)} V` : '-- V');
  setCanVal('canAc', telemetry.acStatus ? 'ON ❄️' : 'OFF', telemetry.acStatus ? 'active' : 'inactive');
  setCanVal('canHandbrake', telemetry.handbrake ? 'ENGAGED 🛑' : 'RELEASED', telemetry.handbrake ? 'active' : 'inactive');
  setCanVal('canFootBrake', telemetry.footBrake ? 'ACTIVE 🦶' : 'OFF', telemetry.footBrake ? 'active' : 'inactive');
  setCanVal('canCruise', telemetry.cruiseControl ? 'ACTIVE 🚗' : 'OFF', telemetry.cruiseControl ? 'active' : 'inactive');
  setCanVal('canSeatbelt', telemetry.seatbeltMask ? 'UNFASTENED ⚠️' : 'FASTENED 🟢', telemetry.seatbeltMask ? 'inactive' : 'active');
  setCanVal('canAmbientTemp', telemetry.ambientTemp ? `${telemetry.ambientTemp} °C` : '-- °C');

  // 5. Axle Load CAN Cluster
  setCanVal('canAxle1', telemetry.axleWeight1 ? `${telemetry.axleWeight1.toLocaleString()} kg` : '-- kg');
  setCanVal('canAxle2', telemetry.axleWeight2 ? `${telemetry.axleWeight2.toLocaleString()} kg` : '-- kg');
  setCanVal('canAxle3', telemetry.axleWeight3 ? `${telemetry.axleWeight3.toLocaleString()} kg` : '-- kg');
  setCanVal('canAirSuspension', telemetry.airSuspensionPressure ? `${telemetry.airSuspensionPressure} bar` : '-- bar');
  setCanVal('canRetarder', telemetry.retarderTorque ? `${telemetry.retarderTorque} %` : '-- %');

  // 6. EV Electric Vehicle CAN Cluster
  setCanVal('canEvSoc', telemetry.evBatterySoc !== null && telemetry.evBatterySoc !== undefined ? `${telemetry.evBatterySoc} %` : '-- %');
  setCanVal('canEvVolt', telemetry.evBatteryVoltage ? `${telemetry.evBatteryVoltage} V` : '-- V');
  setCanVal('canEvCurrent', telemetry.evBatteryCurrent ? `${telemetry.evBatteryCurrent} A` : '-- A');
  setCanVal('canEvMotorTemp', telemetry.evMotorTemp ? `${telemetry.evMotorTemp} °C` : '-- °C');
  setCanVal('canEvRange', telemetry.evRangeKm ? `${telemetry.evRangeKm} km` : '-- km');

  // 7. Diagnostics & Alarms
  setCanVal('canDtc', telemetry.dtcCount > 0 ? `${telemetry.dtcCount} Fault Codes ⚠️` : '0 Codes (Healthy)', telemetry.dtcCount > 0 ? 'inactive' : 'active');
  setCanVal('canSats', `🛰️ ${telemetry.satellites || 0} Sats`);
  setCanVal('canGsm', telemetry.gsmSignal ? `${telemetry.gsmSignal} CSQ` : '-- CSQ');
  setCanVal('canTamper', telemetry.unplugAlert ? 'POWER TAMPER 🚨' : 'Secure 🟢', telemetry.unplugAlert ? 'inactive' : 'active');
  setCanVal('canTowing', telemetry.towingAlert ? 'TOWING DETECTED 🚨' : 'Normal 🟢', telemetry.towingAlert ? 'inactive' : 'active');
  setCanVal('canVin', telemetry.vinChassis || 'Auto-Detected');

  // 8. Update Map Slide-up Drawer
  const drawerSpeed = document.getElementById('drawerSpeed');
  const drawerFuel = document.getElementById('drawerFuel');
  const drawerRpm = document.getElementById('drawerRpm');
  const drawerBattery = document.getElementById('drawerBattery');

  if (drawerSpeed) drawerSpeed.innerText = `${telemetry.speed || 0} km/h`;
  if (drawerFuel) drawerFuel.innerText = `${fuelLiters} L (${fuelPct}%)`;
  if (drawerRpm) drawerRpm.innerText = `${telemetry.engineRpm || 0} RPM`;
  if (drawerBattery) drawerBattery.innerText = `${telemetry.externalVoltage || telemetry.batteryVoltage || 0} V`;
}

function setCanVal(elementId, text, stateClass = null) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.innerText = text;
  if (stateClass) {
    el.classList.remove('active', 'inactive', 'highlight');
    el.classList.add(stateClass);
  }
}

window.GaugesController = {
  updateGauges
};
