/**
 * Traxen Telematics Suite - CAN Bus Diagnostics & Gauge Engine
 * Updates All 85+ Live CAN Bus Telemetry Parameters
 */

function updateGauges(telemetry, tankCapacity = 480, isOnline = true) {
  if (!telemetry) return;

  // 1. Fuel Calculations (Preserved Cumulative)
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

  // 2. Engine & Powertrain CAN Cluster (Dynamic Gauges vs Offline Safe State)
  if (isOnline) {
    setCanVal('canRpm', telemetry.engineRpm ? `${telemetry.engineRpm.toLocaleString()} RPM` : '0 RPM', telemetry.engineRpm > 0 ? 'active' : 'inactive');
    setCanVal('canEngineLoad', `${telemetry.engineLoad || 0} %`);
    setCanVal('canCoolant', `${telemetry.coolantTemp || 0} °C`);
    setCanVal('canPedal', `${telemetry.acceleratorPedal || 0} %`);
    setCanVal('canOilPressure', telemetry.oilPressure !== undefined && telemetry.oilPressure !== 0 ? `${telemetry.oilPressure} bar` : '-- bar');
    setCanVal('canOilTemp', telemetry.engineOilTemp ? `${telemetry.engineOilTemp} °C` : '-- °C');
    setCanVal('canEngineHours', telemetry.engineHours ? `${telemetry.engineHours.toFixed(1)} h` : '0.0 h');
    setCanVal('canGear', telemetry.gearLabel || (telemetry.currentGear !== undefined && telemetry.currentGear !== 0 ? `Gear ${telemetry.currentGear}` : 'N'));
    setCanVal('canPto', telemetry.ptoState ? 'ENGAGED 🟢' : 'OFF', telemetry.ptoState ? 'active' : 'inactive');
  } else {
    // Offline Safe Mode: Zero dynamic motion gauges, preserve static readings
    setCanVal('canRpm', '0 RPM', 'inactive');
    setCanVal('canEngineLoad', '0 %');
    setCanVal('canCoolant', `${telemetry.coolantTemp || 0} °C`);
    setCanVal('canPedal', '0 %');
    setCanVal('canOilPressure', telemetry.oilPressure !== undefined && telemetry.oilPressure !== 0 ? `${telemetry.oilPressure} bar` : '-- bar');
    setCanVal('canOilTemp', telemetry.engineOilTemp ? `${telemetry.engineOilTemp} °C` : '-- °C');
    setCanVal('canEngineHours', telemetry.engineHours ? `${telemetry.engineHours.toFixed(1)} h` : '0.0 h');
    setCanVal('canGear', telemetry.gearLabel || 'P');
    setCanVal('canPto', 'OFF', 'inactive');
  }

  // 3. Fuel, DEF & Emissions CAN Cluster
  setCanVal('canFuelLiters', `${fuelLiters} L`);
  setCanVal('canFuelPct', `${fuelPct} %`);
  setCanVal('canDirectLiters', (telemetry.fuelLevelLiters !== undefined && telemetry.fuelLevelLiters !== null) ? `${parseFloat(telemetry.fuelLevelLiters).toFixed(1)} L` : '-- L');
  
  const ecmCounted = telemetry.ecmTotalFuelConsumed !== undefined && telemetry.ecmTotalFuelConsumed !== null
    ? `${parseFloat(telemetry.ecmTotalFuelConsumed).toFixed(1)} L`
    : (telemetry.rawIos && telemetry.rawIos[88] ? `${(Number(telemetry.rawIos[88]) * 0.1).toFixed(1)} L` : (telemetry.rawIos && telemetry.rawIos[107] ? `${(Number(telemetry.rawIos[107]) * 0.1).toFixed(1)} L` : '-- L'));
  setCanVal('canEcmCountedFuel', ecmCounted);

  if (isOnline) {
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
  } else {
    setCanVal('canInjectorStatus', 'OFFLINE ⚪', 'inactive');
    setCanVal('canFuelRate', '0.00 L/h');
  }

  const dynamicRange = (telemetry.fuelLiters > 0 && (telemetry.avgMileage || telemetry.avgMileageKmPerLiter))
    ? Math.round(telemetry.fuelLiters * (telemetry.avgMileage || telemetry.avgMileageKmPerLiter))
    : (telemetry.estimatedRangeKm || telemetry.vehicleRange || null);
  setCanVal('canVehicleRange', dynamicRange ? `${dynamicRange} km` : (telemetry.vehicleRange ? `${telemetry.vehicleRange} km` : '-- km'));
  setCanVal('canAdBlue', telemetry.adBlueLevel !== null && telemetry.adBlueLevel !== undefined ? `${telemetry.adBlueLevel} %` : '-- %');
  
  const svcRaw = Number(telemetry.nextServiceDistance);
  const svcDist = (!isNaN(svcRaw) && svcRaw > 0 && svcRaw < 500000)
    ? `${svcRaw.toLocaleString()} km`
    : '-- km';
  setCanVal('canServiceDist', svcDist);

  // Real-Time Mileage & Economy Hub
  const instantM = isOnline && (telemetry.instantMileageKmPerLiter && telemetry.instantMileageKmPerLiter > 0) 
    ? parseFloat(telemetry.instantMileageKmPerLiter).toFixed(1) 
    : (isOnline && telemetry.speed > 5 ? (parseFloat(telemetry.speed) / Math.max(0.5, (telemetry.fuelRate || 3.2))).toFixed(1) : '--');
  
  const avgM = (telemetry.avgMileageKmPerLiter && telemetry.avgMileageKmPerLiter > 0)
    ? parseFloat(telemetry.avgMileageKmPerLiter).toFixed(1)
    : (telemetry.avgMileage ? parseFloat(telemetry.avgMileage).toFixed(1) : '15.4');

  const tripDist = (telemetry.tripDistanceKm !== undefined && telemetry.tripDistanceKm !== null && !isNaN(telemetry.tripDistanceKm))
    ? parseFloat(telemetry.tripDistanceKm).toFixed(1)
    : (telemetry.tripDistance !== undefined && !isNaN(telemetry.tripDistance) ? parseFloat(telemetry.tripDistance).toFixed(1) : (telemetry.tripOdometerKm ? parseFloat(telemetry.tripOdometerKm).toFixed(1) : '0.0'));

  const tripFuel = (telemetry.tripFuelConsumedLiters !== undefined && telemetry.tripFuelConsumedLiters !== null && !isNaN(telemetry.tripFuelConsumedLiters))
    ? parseFloat(telemetry.tripFuelConsumedLiters).toFixed(1)
    : (telemetry.tripFuel !== undefined && !isNaN(telemetry.tripFuel) ? parseFloat(telemetry.tripFuel).toFixed(1) : '0.0');

  const costKm = (telemetry.costPerKm && telemetry.costPerKm > 0)
    ? `₹ ${parseFloat(telemetry.costPerKm).toFixed(2)}`
    : `₹ ${(102.5 / parseFloat(avgM || 15.4)).toFixed(2)}`;

  const estRange = telemetry.vehicleRange 
    ? `${telemetry.vehicleRange} km` 
    : `${(parseFloat(fuelLiters || 25) * parseFloat(avgM || 15.4)).toFixed(0)} km`;

  const numTripDist = parseFloat(tripDist) || 0;
  const numTripFuel = parseFloat(tripFuel) || 0;
  const fuelPerKm = (numTripDist > 0.05 && numTripFuel > 0.01) 
    ? (numTripFuel / numTripDist).toFixed(3) 
    : (parseFloat(avgM) > 0 ? (1 / parseFloat(avgM)).toFixed(3) : '0.200');

  const idleWasteLiters = telemetry.idleFuelConsumed !== undefined 
    ? parseFloat(telemetry.idleFuelConsumed).toFixed(1) 
    : (telemetry.idleSeconds ? (telemetry.idleSeconds / 3600 * 1.2).toFixed(1) : '0.0');

  setCanVal('mileageInstantVal', instantM);
  setCanVal('mileageAvgVal', avgM);
  setCanVal('mileageTripDist', `${tripDist} km`);
  setCanVal('mileageTripFuel', `${tripFuel} L`);
  setCanVal('mileageFuelPerKm', `${fuelPerKm} L/km`);
  setCanVal('mileageIdleWaste', `${idleWasteLiters} L`);
  setCanVal('mileageCostPerKm', costKm);
  setCanVal('mileageRangeVal', estRange);

  // Update Top Stream Average 1 KM Banner
  const numFpk = parseFloat(fuelPerKm) || 0.054;
  const numMpk = (numFpk * 1000).toFixed(1);
  const elStreamLkm = document.getElementById('liveStreamAvgFuelPerKm');
  const elStreamMlk = document.getElementById('liveStreamAvgMlPerKm');
  const elStreamAvgM = document.getElementById('liveStreamAvgMileage');
  const elStreamCost = document.getElementById('liveStreamCostPerKm');
  if (elStreamLkm) elStreamLkm.innerText = numFpk.toFixed(3);
  if (elStreamMlk) elStreamMlk.innerText = `(${numMpk} ml)`;
  if (elStreamAvgM) elStreamAvgM.innerText = avgM;
  if (elStreamCost) elStreamCost.innerText = costKm;

  // 4. Electrical, Body & Comfort CAN Cluster
  const isIgnOn = isOnline && (telemetry.ignition === true || telemetry.ignition === 'ON' || telemetry.ignition === 1 || Number(telemetry.engineRpm) > 300 || Number(telemetry.speed) > 3);
  setCanVal('canIgnition', isIgnOn ? 'IGNITION ON 🟢' : (isOnline ? 'IGNITION OFF' : 'IGNITION OFF (OFFLINE) ⚪'), isIgnOn ? 'active' : 'inactive');
  setCanVal('canExtVolt', (telemetry.externalVoltage !== undefined && telemetry.externalVoltage !== null && telemetry.externalVoltage > 0) ? `${parseFloat(telemetry.externalVoltage).toFixed(1)} V` : '-- V');
  setCanVal('canIntVolt', (telemetry.batteryVoltage !== undefined && telemetry.batteryVoltage !== null && telemetry.batteryVoltage > 0) ? `${parseFloat(telemetry.batteryVoltage).toFixed(2)} V` : '-- V');
  setCanVal('canAc', isOnline && telemetry.acStatus ? 'ON ❄️' : 'OFF', isOnline && telemetry.acStatus ? 'active' : 'inactive');
  setCanVal('canHandbrake', telemetry.handbrake ? 'ENGAGED 🛑' : (isOnline ? 'RELEASED' : 'PARKED 🛑'), telemetry.handbrake || !isOnline ? 'active' : 'inactive');
  setCanVal('canFootBrake', isOnline && telemetry.footBrake ? 'ACTIVE 🦶' : 'OFF', isOnline && telemetry.footBrake ? 'active' : 'inactive');
  setCanVal('canCruise', isOnline && telemetry.cruiseControl ? 'ACTIVE 🚗' : 'OFF', isOnline && telemetry.cruiseControl ? 'active' : 'inactive');
  setCanVal('canSeatbelt', isOnline && telemetry.seatbeltMask ? 'UNFASTENED ⚠️' : (isOnline ? 'FASTENED 🟢' : 'OFF'), isOnline && !telemetry.seatbeltMask ? 'active' : 'inactive');
  setCanVal('canAmbientTemp', telemetry.ambientTemp ? `${telemetry.ambientTemp} °C` : '-- °C');

  // 5. Axle Load CAN Cluster (Preserved static)
  setCanVal('canAxle1', telemetry.axleWeight1 ? `${telemetry.axleWeight1.toLocaleString()} kg` : '-- kg');
  setCanVal('canAxle2', telemetry.axleWeight2 ? `${telemetry.axleWeight2.toLocaleString()} kg` : '-- kg');
  setCanVal('canAxle3', telemetry.axleWeight3 ? `${telemetry.axleWeight3.toLocaleString()} kg` : '-- kg');
  setCanVal('canAirSuspension', telemetry.airSuspensionPressure ? `${telemetry.airSuspensionPressure} bar` : '-- bar');
  setCanVal('canRetarder', isOnline && telemetry.retarderTorque ? `${telemetry.retarderTorque} %` : '-- %');

  // 6. EV Electric Vehicle CAN Cluster
  setCanVal('canEvSoc', telemetry.evBatterySoc !== null && telemetry.evBatterySoc !== undefined ? `${telemetry.evBatterySoc} %` : '-- %');
  setCanVal('canEvVolt', telemetry.evBatteryVoltage ? `${telemetry.evBatteryVoltage} V` : '-- V');
  setCanVal('canEvCurrent', isOnline && telemetry.evBatteryCurrent ? `${telemetry.evBatteryCurrent} A` : '-- A');
  setCanVal('canEvMotorTemp', telemetry.evMotorTemp ? `${telemetry.evMotorTemp} °C` : '-- °C');
  setCanVal('canEvRange', telemetry.evRangeKm ? `${telemetry.evRangeKm} km` : '-- km');

  // 7. Diagnostics & Alarms
  setCanVal('canDtc', telemetry.dtcCount > 0 ? `${telemetry.dtcCount} Fault Codes ⚠️` : '0 Codes (Healthy)', telemetry.dtcCount > 0 ? 'inactive' : 'active');
  setCanVal('canSats', `🛰️ ${telemetry.satellites || 0} Sats`);
  setCanVal('canGsm', telemetry.gsmSignal ? `${telemetry.gsmSignal} CSQ` : '-- CSQ');
  setCanVal('canTamper', telemetry.unplugAlert ? 'POWER TAMPER 🚨' : 'Secure 🟢', telemetry.unplugAlert ? 'inactive' : 'active');
  setCanVal('canTowing', telemetry.towingAlert ? 'TOWING DETECTED 🚨' : 'Normal 🟢', telemetry.towingAlert ? 'inactive' : 'active');
  
  const rawVin = telemetry.vinChassis || (telemetry.rawIos && telemetry.rawIos[107]);
  const formattedVin = (rawVin && String(rawVin).length >= 10) 
    ? String(rawVin) 
    : (window.allDevices && window.currentDeviceImei 
        ? `CAN-VIN-${(window.allDevices.find(d => d.imei === window.currentDeviceImei)?.vehicleNumber || window.currentDeviceImei.slice(-6))}`
        : 'Auto-Detecting CAN...');
  setCanVal('canVin', formattedVin);

  // 8. Live Clock & Sync Cluster
  const satsCount = telemetry.satellites || 0;
  setCanVal('syncSatLock', satsCount >= 4 ? `${satsCount} Sats Locked 🟢` : (satsCount > 0 ? `${satsCount} Sats (Searching 🟡)` : '0 Sats ⚪'), satsCount >= 4 ? 'active' : 'inactive');
  setCanVal('syncProtocol', telemetry.lvcanAdapterId ? 'Teltonika Codec 8 Extended (CAN Direct)' : 'Teltonika Codec 8 Extended');
  setCanVal('syncWsStatus', isOnline ? 'WebSocket Broadcast (Port 3001) 🟢' : 'WebSocket Broadcast (Standby ⚪)', isOnline ? 'active' : 'inactive');

  // 8. Update Map Slide-up Drawer
  const drawerSpeed = document.getElementById('drawerSpeed');
  const drawerGear = document.getElementById('drawerGear');
  const drawerFuel = document.getElementById('drawerFuel');
  const drawerRpm = document.getElementById('drawerRpm');
  const drawerBattery = document.getElementById('drawerBattery');

  if (drawerSpeed) drawerSpeed.innerText = isOnline ? `${telemetry.speed || 0} km/h` : '0 km/h (Offline)';
  if (drawerGear) drawerGear.innerText = isOnline ? (telemetry.gearLabel || (telemetry.currentGear !== undefined && telemetry.currentGear !== 0 ? `Gear ${telemetry.currentGear}` : 'N')) : 'P';
  if (drawerFuel) drawerFuel.innerText = `${fuelLiters} L (${fuelPct}%)`;
  if (drawerRpm) drawerRpm.innerText = isOnline ? `${telemetry.engineRpm || 0} RPM` : '0 RPM';
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
