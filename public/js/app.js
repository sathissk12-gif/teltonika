/**
 * Traxen Telematics Suite - Main Mobile & Web Application Controller
 * Official Traxen Mobile App UI Experience with Complete CAN Diagnostics
 */

let currentDeviceImei = null;
let allDevices = [];
let filteredDevices = [];
let currentFleetFilter = 'ALL';
let searchQuery = '';
let selectedNewVehicleCategory = 'OPEN TRUCK';
let ws = null;

let clockTickerInterval = null;

document.addEventListener('DOMContentLoaded', () => {
  initWebSocket();
  loadDevices();
  initLiveClocks();
});

// Live Real-Time Clock & Telemetry Sync Ticker
function initLiveClocks() {
  if (clockTickerInterval) clearInterval(clockTickerInterval);

  function tick() {
    const now = new Date();
    // 1. Format Server Time in IST (Indian Standard Time)
    const serverTimeStr = now.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });

    const elServerTop = document.getElementById('liveServerTimeTop');
    const elServerSync = document.getElementById('syncServerTime');
    if (elServerTop) elServerTop.innerText = serverTimeStr;
    if (elServerSync) elServerSync.innerText = `${serverTimeStr} IST`;

    // 2. Format Selected Device GPS RTC Time & Age
    const dev = allDevices.find(d => d.imei === currentDeviceImei);
    const elDeviceTop = document.getElementById('liveDeviceTimeTop');
    const elAgeTop = document.getElementById('livePacketAgeTop');
    const elDeviceSync = document.getElementById('syncDeviceTime');
    const elAgeSync = document.getElementById('syncPacketAge');

    if (dev && dev.lastTelemetry) {
      const devTimestamp = dev.lastTelemetry.deviceTimestamp || dev.lastTelemetry.timestamp || dev.lastUpdated;
      if (devTimestamp) {
        const devDate = new Date(devTimestamp);
        const devTimeStr = !isNaN(devDate.getTime()) ? devDate.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        }) : '--:--:--';

        if (elDeviceTop) elDeviceTop.innerText = devTimeStr;
        if (elDeviceSync) elDeviceSync.innerText = `${devTimeStr} (GPS Atomic)`;

        // Calculate packet age in seconds
        const ageSec = Math.max(0, Math.floor((now.getTime() - devDate.getTime()) / 1000));
        let ageLabel = 'Just now';
        let ageClass = 'active';

        if (ageSec < 5) {
          ageLabel = '⚡ Just now';
          ageClass = 'active';
        } else if (ageSec < 60) {
          ageLabel = `⚡ ${ageSec}s ago`;
          ageClass = 'active';
        } else if (ageSec < 3600) {
          const m = Math.floor(ageSec / 60);
          const s = ageSec % 60;
          ageLabel = `⏱️ ${m}m ${s}s ago`;
          ageClass = 'highlight';
        } else {
          const h = Math.floor(ageSec / 3600);
          ageLabel = `⚪ ${h}h ago`;
          ageClass = 'inactive';
        }

        if (elAgeTop) {
          elAgeTop.innerText = ageLabel;
          elAgeTop.className = `live-clock-age ${ageClass}`;
        }
        if (elAgeSync) {
          elAgeSync.innerText = ageLabel;
          elAgeSync.className = `can-item-val ${ageClass}`;
        }
      }
    } else {
      if (elDeviceTop) elDeviceTop.innerText = '--:--:--';
      if (elAgeTop) elAgeTop.innerText = 'No Data';
      if (elDeviceSync) elDeviceSync.innerText = '--:--:--';
      if (elAgeSync) elAgeSync.innerText = '--';
    }
  }

  tick();
  clockTickerInterval = setInterval(tick, 1000);
}

// Switch Tab (Bottom Navigation & Desktop Tabs)
function switchTab(tabId) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.bottom-nav-item').forEach(btn => btn.classList.remove('active'));

  const targetPane = document.getElementById(tabId);
  if (targetPane) targetPane.classList.add('active');

  const navItem = document.querySelector(`.bottom-nav-item[data-tab="${tabId}"]`);
  if (navItem) navItem.classList.add('active');

  if (tabId === 'tabMap' && window.MapController) {
    setTimeout(() => {
      window.MapController.recenterMap();
    }, 150);
  }
}

// Icon Helper: maps vehicle category and status to official Traxen icon asset path
function getVehicleIconPath(category = 'OPEN TRUCK', status = 'moving') {
  const validCategories = [
    'OPEN TRUCK', 'BIKE', 'CAR', 'CAR SUV', 'BUS', 
    'MINI TRUCK', 'CONTAINER', 'AUTO-RICKSHAW', 'TRACTOR', 'AMBULANCE', 'BULKER', 'PORTABLE TRACKER'
  ];
  const cat = validCategories.includes(category.toUpperCase()) ? category.toUpperCase() : 'OPEN TRUCK';
  const stat = ['moving', 'idle', 'parking', 'nodata'].includes(status) ? status : 'moving';
  return `assets/icons/vehicle/sideview/${stat}/${cat}.png`;
}

// Determine vehicle status mode
function getVehicleStatusMode(dev) {
  const isOnline = Boolean(dev && dev.status === 'ONLINE' && dev.isSocketConnected !== false);
  if (!isOnline) return 'OFFLINE';
  const tel = dev.lastTelemetry || {};
  if (tel.speed > 0) return 'MOVING';
  if (tel.ignition === true || tel.ignition === 'ON' || tel.ignition === 1 || Number(tel.engineRpm) > 300) return 'IDLE';
  return 'PARKED';
}

// Load Devices from Server
function loadDevices() {
  fetch('/api/devices')
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        allDevices = data.data || [];
        window.allDevices = allDevices;
        updateFleetCounters();
        applyFleetFilters();
        populateCanDeviceSelect();
        
        if (allDevices.length > 0 && !currentDeviceImei) {
          selectDevice(allDevices[0].imei);
        }
      }
    })
    .catch(err => console.error('Error loading devices:', err));
}

// Update Fleet Summary Counters
function updateFleetCounters() {
  let total = allDevices.length;
  let moving = 0;
  let idle = 0;
  let parked = 0;
  let offline = 0;

  allDevices.forEach(dev => {
    const mode = getVehicleStatusMode(dev);
    if (mode === 'MOVING') moving++;
    else if (mode === 'IDLE') idle++;
    else if (mode === 'PARKED') parked++;
    else offline++;
  });

  const elTotal = document.getElementById('statFleetTotal');
  const elMoving = document.getElementById('statFleetMoving');
  const elIdle = document.getElementById('statFleetIdle');
  const elParked = document.getElementById('statFleetParked');
  const elOffline = document.getElementById('statFleetOffline');

  if (elTotal) elTotal.innerText = total;
  if (elMoving) elMoving.innerText = moving;
  if (elIdle) elIdle.innerText = idle;
  if (elParked) elParked.innerText = parked;
  if (elOffline) elOffline.innerText = offline;
}

// Search Handler
function handleSearch(query) {
  searchQuery = query.toLowerCase().trim();
  applyFleetFilters();
}

// Filter fleet by status chip click
function filterFleet(type) {
  currentFleetFilter = type;
  document.querySelectorAll('.traxen-chip').forEach(c => c.classList.remove('active'));
  const activeChip = document.querySelector(`.traxen-chip.${type.toLowerCase()}`);
  if (activeChip) activeChip.classList.add('active');
  applyFleetFilters();
}

function applyFleetFilters() {
  filteredDevices = allDevices.filter(d => {
    const mode = getVehicleStatusMode(d);
    const matchesFilter = currentFleetFilter === 'ALL' || mode === currentFleetFilter;
    const matchesSearch = !searchQuery || 
      (d.vehicleNumber && d.vehicleNumber.toLowerCase().includes(searchQuery)) ||
      (d.model && d.model.toLowerCase().includes(searchQuery)) ||
      (d.imei && d.imei.includes(searchQuery));

    return matchesFilter && matchesSearch;
  });

  renderVehicleCards();
}

// Render Traxen Vehicle Cards in Tab 1
function renderVehicleCards() {
  const container = document.getElementById('vehiclesCardsFeed');
  if (!container) return;

  if (filteredDevices.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px 20px; background: var(--bg-card); border-radius: var(--radius-xl); border: 1px solid var(--border-glass);">
        <div style="font-size: 2.5rem; margin-bottom: 12px;">🚗</div>
        <div style="font-size: 1.1rem; font-weight: 800; color: #fff;">No Vehicles Found</div>
        <div style="font-size: 0.84rem; color: var(--text-muted); margin-top: 4px;">Click "+ Add Vehicle" above to register a tracker.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = filteredDevices.map(dev => {
    const isOnline = (dev.status === 'ONLINE' && dev.isSocketConnected !== false);
    const mode = getVehicleStatusMode(dev);
    const tel = dev.lastTelemetry || {};
    const speed = isOnline ? (tel.speed || 0) : 0;
    const isIgnOn = isOnline && (tel.ignition === true || tel.ignition === 'ON' || tel.ignition === 1 || Number(tel.engineRpm) > 300 || Number(tel.speed) > 3);
    const isSelected = dev.imei === currentDeviceImei;

    const statusModeLower = mode === 'MOVING' ? 'moving' : (mode === 'IDLE' ? 'idle' : (mode === 'PARKED' ? 'parking' : 'nodata'));
    const iconSrc = getVehicleIconPath(dev.category || 'OPEN TRUCK', statusModeLower);

    const fuelPct = tel.fuelPercentage !== undefined && tel.fuelPercentage !== null ? tel.fuelPercentage : 0;
    const fuelLiters = tel.fuelLiters !== undefined && tel.fuelLiters !== null 
      ? tel.fuelLiters 
      : ((fuelPct / 100) * (dev.tankCapacity || 480)).toFixed(1);

    const speedDisplay = mode === 'MOVING' ? `MOVING ${speed} km/h` : mode;
    const displayRpm = isOnline ? (tel.engineRpm || 0) : 0;

    // Trip & Fuel per KM calculation for vehicle card
    const tripDist = (tel.tripDistanceKm !== undefined && tel.tripDistanceKm !== null && !isNaN(tel.tripDistanceKm))
      ? parseFloat(tel.tripDistanceKm).toFixed(1)
      : (tel.tripDistance !== undefined && !isNaN(tel.tripDistance) ? parseFloat(tel.tripDistance).toFixed(1) : (tel.tripOdometerKm ? parseFloat(tel.tripOdometerKm).toFixed(1) : '0.0'));

    const tripFuel = (tel.tripFuelConsumedLiters !== undefined && tel.tripFuelConsumedLiters !== null && !isNaN(tel.tripFuelConsumedLiters))
      ? parseFloat(tel.tripFuelConsumedLiters).toFixed(1)
      : (tel.tripFuel !== undefined && !isNaN(tel.tripFuel) ? parseFloat(tel.tripFuel).toFixed(1) : '0.0');

    const numTripDist = parseFloat(tripDist) || 0;
    const numTripFuel = parseFloat(tripFuel) || 0;
    const avgMileage = (tel.avgMileageKmPerLiter && tel.avgMileageKmPerLiter > 0) 
      ? parseFloat(tel.avgMileageKmPerLiter).toFixed(1)
      : (tel.avgMileage ? parseFloat(tel.avgMileage).toFixed(1) : (numTripDist > 0 && numTripFuel > 0 ? (numTripDist / numTripFuel).toFixed(1) : '15.4'));

    const fuelPerKm = (numTripDist > 0.05 && numTripFuel > 0.01)
      ? (numTripFuel / numTripDist).toFixed(3)
      : (parseFloat(avgMileage) > 0 ? (1 / parseFloat(avgMileage)).toFixed(3) : '0.200');

    // Per-Day Today's Performance Metrics
    const today = dev.todaySummary || {};
    const todayDist = (today.distanceKm !== undefined && today.distanceKm !== null) ? parseFloat(today.distanceKm).toFixed(1) : '0.0';
    const todayFuel = (today.fuelUsedLiters !== undefined && today.fuelUsedLiters !== null) ? parseFloat(today.fuelUsedLiters).toFixed(2) : '0.00';
    const todayMileage = (today.mileageKmpl && today.mileageKmpl > 0) ? parseFloat(today.mileageKmpl).toFixed(1) : (parseFloat(todayDist) > 0 && parseFloat(todayFuel) > 0 ? (parseFloat(todayDist)/parseFloat(todayFuel)).toFixed(1) : '0.0');
    const todayFuelPerKm = (today.fuelPerKm && today.fuelPerKm > 0) ? parseFloat(today.fuelPerKm).toFixed(3) : (parseFloat(todayMileage) > 0 ? (1/parseFloat(todayMileage)).toFixed(3) : '0.000');
    const todayCost = (today.fuelCost !== undefined && today.fuelCost !== null) ? parseFloat(today.fuelCost).toFixed(1) : '0.0';

    return `
      <div class="traxen-vehicle-card ${isSelected ? 'selected' : ''}" onclick="App.selectDevice('${dev.imei}')">
        <!-- Top Info Row -->
        <div class="card-top-row">
          <div class="card-vehicle-info">
            <div class="card-vehicle-icon-box">
              <img src="${iconSrc}" class="card-vehicle-icon-img" alt="${dev.category}">
            </div>
            <div>
              <div class="card-plate-number">${dev.vehicleNumber}</div>
              <div class="card-model-text">${dev.model || 'Traxen Tracker'} • ${dev.category || 'Vehicle'}</div>
            </div>
          </div>
          <div class="traxen-status-badge ${mode}">
            <span>${mode === 'MOVING' ? '🟢' : (mode === 'IDLE' ? '🟡' : (mode === 'PARKED' ? '🅿️' : '⚪'))}</span>
            <span>${speedDisplay}</span>
          </div>
        </div>

        <!-- Ignition Status -->
        <div class="ignition-row">
          <div class="ignition-pill">
            <div class="ignition-led ${isIgnOn ? 'on' : 'off'}"></div>
            <span style="color: ${isIgnOn ? 'var(--status-moving)' : 'var(--text-muted)'};">${isIgnOn ? 'IGNITION ON' : (isOnline ? 'IGNITION OFF' : 'DEVICE OFFLINE')}</span>
          </div>
          <span style="font-family: var(--font-mono); color: var(--traxen-amber); font-size: 0.75rem;">IMEI: ${dev.imei.slice(-6)}</span>
        </div>

        <!-- Fuel Progress Bar -->
        <div class="card-fuel-section">
          <div class="fuel-bar-labels">
            <span style="color: var(--text-secondary);">Fuel Level</span>
            <span style="font-family: var(--font-mono); color: var(--traxen-primary-light);">${fuelPct}% • ${fuelLiters} L</span>
          </div>
          <div class="fuel-progress-track">
            <div class="fuel-progress-fill" style="width: ${Math.min(Math.max(fuelPct, 0), 100)}%;"></div>
          </div>
        </div>

        <!-- TODAY'S DAILY RUN & FUEL PERFORMANCE BOX -->
        <div class="card-today-summary-box">
          <div class="today-box-header">
            <span class="today-box-title">📅 Today's Run & Fuel Mileage</span>
            <span class="today-date-badge">${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
          </div>
          <div class="today-metrics-grid">
            <div class="today-metric-cell">
              <span class="tm-lbl">KM Run</span>
              <span class="tm-val highlight">${todayDist} <small>km</small></span>
            </div>
            <div class="today-metric-cell">
              <span class="tm-lbl">Fuel Used</span>
              <span class="tm-val" style="color: var(--traxen-primary-light);">${todayFuel} <small>L</small></span>
            </div>
            <div class="today-metric-cell">
              <span class="tm-lbl">Avg Mileage</span>
              <span class="tm-val" style="color: var(--status-moving);">${todayMileage} <small>km/L</small></span>
            </div>
            <div class="today-metric-cell highlight-cell">
              <span class="tm-lbl">💧 Fuel / KM</span>
              <span class="tm-val" style="color: var(--traxen-amber-light); font-weight: 800;">${todayFuelPerKm} <small>L/km</small></span>
            </div>
            <div class="today-metric-cell">
              <span class="tm-lbl">Est. Cost</span>
              <span class="tm-val" style="color: #38BDF8;">₹ ${todayCost}</span>
            </div>
          </div>
        </div>

        <!-- Live Trip Economy & Fuel / KM Strip -->
        <div class="card-trip-economy-strip">
          <div class="econ-box">
            <span class="econ-lbl">Current Trip</span>
            <span class="econ-val">${tripDist} km</span>
          </div>
          <div class="econ-box">
            <span class="econ-lbl">Trip Fuel</span>
            <span class="econ-val" style="color: var(--traxen-primary-light);">${tripFuel} L</span>
          </div>
          <div class="econ-box econ-green">
            <span class="econ-lbl">Trip Mileage</span>
            <span class="econ-val">${avgMileage} <small>km/L</small></span>
          </div>
          <div class="econ-box econ-amber">
            <span class="econ-lbl">💧 Fuel / KM</span>
            <span class="econ-val">${fuelPerKm} <small>L/km</small></span>
          </div>
        </div>

        <!-- Key CAN Metrics Grid -->
        <div class="card-metrics-grid" style="grid-template-columns: repeat(5, 1fr);">
          <div class="card-metric-box">
            <div class="card-metric-label">RPM</div>
            <div class="card-metric-val">${displayRpm}</div>
          </div>
          <div class="card-metric-box">
            <div class="card-metric-label">Gear</div>
            <div class="card-metric-val" style="color: var(--traxen-amber-light); font-weight: 800;">${isOnline ? (tel.gearLabel || (tel.currentGear ? `${tel.currentGear}` : 'N')) : 'P'}</div>
          </div>
          <div class="card-metric-box">
            <div class="card-metric-label">Coolant</div>
            <div class="card-metric-val">${tel.coolantTemp || 0}°C</div>
          </div>
          <div class="card-metric-box">
            <div class="card-metric-label">Battery</div>
            <div class="card-metric-val">${tel.externalVoltage ? `${tel.externalVoltage}V` : (tel.batteryVoltage ? `${tel.batteryVoltage}V` : '0V')}</div>
          </div>
          <div class="card-metric-box">
            <div class="card-metric-label">CAN ODO</div>
            <div class="card-metric-val">${(tel.totalMileageCan && tel.totalMileageCan > 0) ? (tel.totalMileageCan > 1000 ? `${(tel.totalMileageCan / 1000).toFixed(1)}k` : `${tel.totalMileageCan}`) : (tel.odometer ? `${tel.odometer}k` : '0')}</div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="card-actions-row">
          <button class="btn-card-action primary" onclick="event.stopPropagation(); App.trackVehicleOnMap('${dev.imei}')">
            <span>📍</span> Live
          </button>
          <button class="btn-card-action" style="color: var(--traxen-amber-light);" onclick="event.stopPropagation(); HistoryStudio.openHistoryModal('${dev.imei}')">
            <span>📅</span> History
          </button>
          <button class="btn-card-action" onclick="event.stopPropagation(); App.openVehicleCan('${dev.imei}')">
            <span>📊</span> CAN
          </button>
          <button class="btn-card-action" style="color: var(--status-theft);" onclick="event.stopPropagation(); App.sendRemoteCommand('setdigout 1 0', '${dev.imei}')">
            <span>🛑</span> Lock
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function selectDevice(imei) {
  currentDeviceImei = imei;
  window.currentDeviceImei = imei;
  const dev = allDevices.find(d => d.imei === imei);
  if (!dev) return;

  renderVehicleCards();

  const isOnline = (dev.status === 'ONLINE' && dev.isSocketConnected !== false);

  // Update CAN tab dropdown & labels
  const canSelect = document.getElementById('canDeviceSelect');
  if (canSelect && canSelect.value !== imei) canSelect.value = imei;

  const canPlate = document.getElementById('canSelectedPlate');
  const canModel = document.getElementById('canSelectedModel');
  if (canPlate) canPlate.innerText = `${dev.vehicleNumber} (${dev.category || 'Vehicle'})`;
  if (canModel) {
    if (isOnline) {
      canModel.innerHTML = `<span style="color: var(--status-moving);">🟢 LIVE CAN BUS (Codec 8 Extended)</span> • IMEI: ${dev.imei}`;
    } else {
      const lastSeenStr = dev.lastUpdated ? new Date(dev.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recently';
      canModel.innerHTML = `<span style="color: var(--text-muted);">⚪ OFFLINE (Last Recorded CAN Snapshot • ${lastSeenStr})</span> • IMEI: ${dev.imei}`;
    }
  }

  // Update Fuel Source Badge
  const sourceBadge = document.getElementById('fuelSourceBadge');
  if (sourceBadge) {
    sourceBadge.innerText = dev.fuelSource === 'ANALOG_AIN1' 
      ? 'Analog Float (AIN1)' 
      : (dev.fuelSource === 'CAN_LITERS' ? 'Direct CAN Liters (AVL 84)' : 'CAN Bus % (AVL 83)');
  }

  // Update Slide-up Map Drawer
  const mapDrawer = document.getElementById('mapVehicleDrawer');
  if (mapDrawer) mapDrawer.style.display = 'block';

  const drawerPlate = document.getElementById('drawerPlateNumber');
  const drawerModel = document.getElementById('drawerModelText');
  const drawerBadge = document.getElementById('drawerStatusBadge');
  const drawerIcon = document.getElementById('drawerVehicleIcon');

  const mode = getVehicleStatusMode(dev);
  if (drawerPlate) drawerPlate.innerText = dev.vehicleNumber;
  if (drawerModel) drawerModel.innerText = `${dev.model} • ${dev.tankCapacity}L Tank`;
  if (drawerBadge) {
    drawerBadge.className = `traxen-status-badge ${mode}`;
    drawerBadge.innerText = mode;
  }
  if (drawerIcon) {
    const statusModeLower = mode === 'MOVING' ? 'moving' : (mode === 'IDLE' ? 'idle' : (mode === 'PARKED' ? 'parking' : 'nodata'));
    drawerIcon.src = getVehicleIconPath(dev.category || 'OPEN TRUCK', statusModeLower);
  }

  // Update Telemetry & Gauges
  if (dev.lastTelemetry) {
    if (window.MapController) {
      window.MapController.updateVehicleLocation(
        dev.lastTelemetry.lat || 11.6643,
        dev.lastTelemetry.lng || 78.1460,
        dev.lastTelemetry.angle || 0,
        isOnline ? (dev.lastTelemetry.speed || 0) : 0,
        dev.category || 'OPEN TRUCK'
      );
    }
    if (window.GaugesController) {
      window.GaugesController.updateGauges(dev.lastTelemetry, dev.tankCapacity, isOnline);
    }
  }

  // Initialize Calibration Studio
  if (window.CalibrationStudio) {
    window.CalibrationStudio.initCalibrationStudio(dev);
  }

  // Fetch and update Daily Ledger in Tab 3
  fetchDailySummaries(imei);
}

function trackVehicleOnMap(imei) {
  selectDevice(imei);
  switchTab('tabMap');
}

function openVehicleCan(imei) {
  selectDevice(imei);
  switchTab('tabCan');
}

function populateCanDeviceSelect() {
  const canSelect = document.getElementById('canDeviceSelect');
  if (!canSelect) return;

  canSelect.innerHTML = '';
  allDevices.forEach(dev => {
    const opt = document.createElement('option');
    opt.value = dev.imei;
    opt.innerText = `${dev.vehicleNumber} (${dev.model || 'Tracker'})`;
    canSelect.appendChild(opt);
  });

  if (currentDeviceImei) {
    canSelect.value = currentDeviceImei;
  }
}

// Modal Management
function openAddDeviceModal() {
  const modal = document.getElementById('addDeviceModal');
  if (modal) modal.style.display = 'flex';
}

function closeAddDeviceModal() {
  const modal = document.getElementById('addDeviceModal');
  if (modal) modal.style.display = 'none';
}

function selectCategory(cat, elem) {
  selectedNewVehicleCategory = cat;
  document.querySelectorAll('#categoryPicker .category-option').forEach(el => el.classList.remove('selected'));
  if (elem) elem.classList.add('selected');

  // Sensible default tank capacity
  const tankInput = document.getElementById('inputTankCap');
  if (tankInput) {
    if (cat === 'BIKE') tankInput.value = 15;
    else if (cat === 'CAR' || cat === 'CAR SUV') tankInput.value = 60;
    else if (cat === 'AUTO-RICKSHAW') tankInput.value = 8;
    else if (cat === 'MINI TRUCK') tankInput.value = 80;
    else if (cat === 'BUS' || cat === 'TRACTOR') tankInput.value = 160;
    else tankInput.value = 480;
  }
}

function saveNewDevice() {
  const imeiInput = document.getElementById('inputImei');
  const plateInput = document.getElementById('inputPlate');
  const modelInput = document.getElementById('inputModel');
  const tankInput = document.getElementById('inputTankCap');
  const sensorInput = document.getElementById('inputFuelSource');

  const imei = imeiInput ? imeiInput.value.trim() : '';
  const vehicleNumber = plateInput ? plateInput.value.trim() : '';
  const model = modelInput ? modelInput.value.trim() : '';
  const tankCapacity = tankInput ? parseFloat(tankInput.value) : 480;
  const fuelSource = sensorInput ? sensorInput.value : 'CAN_PERCENT';

  if (!imei || !vehicleNumber) {
    alert('Please enter Device IMEI and Vehicle Registration Number!');
    return;
  }

  fetch('/api/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imei,
      vehicleNumber,
      category: selectedNewVehicleCategory,
      model: model || `Traxen ${selectedNewVehicleCategory}`,
      tankCapacity,
      fuelSource
    })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      closeAddDeviceModal();
      if (imeiInput) imeiInput.value = '';
      if (plateInput) plateInput.value = '';
      if (modelInput) modelInput.value = '';
      loadDevices();
    } else {
      alert('Error registering device: ' + data.error);
    }
  })
  .catch(err => alert('Network error: ' + err.message));
}

// WebSocket Listener & Real-Time Sync
let wsPingInterval = null;

function updateWsBadge(status, text) {
  const badge = document.getElementById('wsConnectionBadge');
  const txt = document.getElementById('wsStatusText');
  if (!badge) return;

  badge.className = `ws-status-badge ${status}`;
  if (txt) txt.innerText = text;
}

function initWebSocket() {
  if (wsPingInterval) clearInterval(wsPingInterval);

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  updateWsBadge('connecting', 'Connecting...');
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    updateWsBadge('online', 'WS Live ⚡');
    console.log('[WS] Connected to live Telematics stream');

    // Keep alive ping every 20s
    wsPingInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'ping' }));
      }
    }, 20000);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWebSocketMessage(msg);
    } catch (err) {
      console.error('[WS] Parse error:', err);
    }
  };

  ws.onclose = () => {
    updateWsBadge('offline', 'Reconnecting...');
    if (wsPingInterval) clearInterval(wsPingInterval);
    setTimeout(initWebSocket, 3000);
  };

  ws.onerror = (err) => {
    console.warn('[WS] Error:', err);
    updateWsBadge('offline', 'WS Error');
  };
}

function handleWebSocketMessage(msg) {
  if (msg.event === 'telemetry') {
    const { imei, data } = msg.data;
    
    let dev = allDevices.find(d => d.imei === imei);
    if (dev) {
      dev.lastTelemetry = data;
      dev.status = 'ONLINE';
      dev.isSocketConnected = true;
      dev.lastUpdated = new Date().toISOString();
    } else {
      // Auto-add new live device if not present
      loadDevices();
    }
    updateFleetCounters();
    renderVehicleCards();

    if (imei === currentDeviceImei) {
      if (window.MapController) {
        window.MapController.updateVehicleLocation(data.lat, data.lng, data.angle, data.speed, dev ? dev.category : 'CAR');
      }
      if (window.GaugesController) {
        window.GaugesController.updateGauges(data, dev ? dev.tankCapacity : 50, true);
      }
    }
  } else if (msg.event === 'device_status') {
    const { imei, status } = msg.data;
    const dev = allDevices.find(d => d.imei === imei);
    if (dev) {
      dev.status = status;
      if (status === 'OFFLINE') dev.isSocketConnected = false;
      updateFleetCounters();
      renderVehicleCards();

      if (imei === currentDeviceImei) {
        selectDevice(imei);
      }
    }
  } else if (msg.event === 'alert') {
    showAlertBanner(msg.data);
  } else if (msg.event === 'command_response') {
    if (window.SimulatorController) {
      window.SimulatorController.logTerminal(`[Device Response] 💬 "${msg.data.response}"`, 'resp');
    }
  }
}

function showAlertBanner(alert) {
  const container = document.getElementById('alertBannerContainer');
  if (!container) return;

  const isTheft = alert.type === 'THEFT';
  const banner = document.createElement('div');
  banner.className = `alert-banner ${isTheft ? 'THEFT' : 'REFUEL'}`;
  banner.innerHTML = `
    <div style="display: flex; align-items: center; gap: 10px; font-size: 0.88rem; font-weight: 700;">
      <span style="font-size: 1.3rem;">${isTheft ? '🚨' : '⛽'}</span>
      <div>
        <span style="color: ${isTheft ? 'var(--status-theft)' : 'var(--status-moving)'}; text-transform: uppercase;">${alert.title} [${alert.vehicleNumber}]</span>
        <div style="font-size: 0.78rem; opacity: 0.9; margin-top: 1px;">${alert.message}</div>
      </div>
    </div>
    <button class="btn-secondary" style="padding: 3px 8px; font-size: 0.75rem;" onclick="this.closest('.alert-banner').remove()">✕</button>
  `;

  container.innerHTML = '';
  container.appendChild(banner);

  setTimeout(() => {
    if (banner.parentElement) banner.remove();
  }, 15000);
}

// Remote Codec 12 Command Dispatcher
function sendRemoteCommand(cmdText, targetImei = null) {
  const imei = targetImei || currentDeviceImei;
  if (!imei) return;

  const input = document.getElementById('customCommandInput');
  const command = cmdText || (input ? input.value : '');
  if (!command) return;

  if (window.SimulatorController) {
    window.SimulatorController.logTerminal(`[Dispatching Codec 12] ➡️ "${command}" to ${imei}...`, 'cmd');
  }

  fetch(`/api/devices/${imei}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      if (window.SimulatorController) {
        window.SimulatorController.logTerminal(`[Success] Packet transmitted to device socket.`, 'resp');
      }
    } else {
      if (window.SimulatorController) {
        window.SimulatorController.logTerminal(`[Command Error] ${data.error}`, 'err');
      }
    }
  })
  .catch(err => {
    if (window.SimulatorController) {
      window.SimulatorController.logTerminal(`[Network Error] ${err.message}`, 'err');
    }
  });

  if (input && !cmdText) input.value = '';
}

async function fetchDailySummaries(imei = currentDeviceImei) {
  if (!imei) return;
  try {
    const res = await fetch(`/api/devices/${imei}/daily-summary?days=7`);
    const data = await res.json();
    if (data.success && data.data) {
      renderDailySummaries(data.data);
    }
  } catch (err) {
    console.error('[App] Error fetching daily summary:', err);
  }
}

function renderDailySummaries(dailyData) {
  if (!dailyData) return;
  const today = dailyData.today || {};
  const todayKmEl = document.getElementById('dailyTodayKm');
  const todayFuelEl = document.getElementById('dailyTodayFuel');
  const todayMileageEl = document.getElementById('dailyTodayMileage');
  const todayFuelPerKmEl = document.getElementById('dailyTodayFuelPerKm');
  const todayCostEl = document.getElementById('dailyTodayCost');
  const tbody = document.getElementById('dailySummaryTableBody');

  const dist = (today.distanceKm !== undefined && today.distanceKm !== null) ? parseFloat(today.distanceKm).toFixed(1) : '0.0';
  const fuel = (today.fuelUsedLiters !== undefined && today.fuelUsedLiters !== null) ? parseFloat(today.fuelUsedLiters).toFixed(2) : '0.00';
  const mileage = (today.mileageKmpl && today.mileageKmpl > 0) ? parseFloat(today.mileageKmpl).toFixed(1) : (parseFloat(dist) > 0 && parseFloat(fuel) > 0 ? (parseFloat(dist)/parseFloat(fuel)).toFixed(1) : '0.0');
  const fuelPerKm = (today.fuelPerKm && today.fuelPerKm > 0) ? parseFloat(today.fuelPerKm).toFixed(3) : (parseFloat(mileage) > 0 ? (1/parseFloat(mileage)).toFixed(3) : '0.000');
  const cost = (today.fuelCost !== undefined && today.fuelCost !== null) ? parseFloat(today.fuelCost).toFixed(1) : '0.0';

  if (todayKmEl) todayKmEl.innerHTML = `${dist} <small style="font-size: 0.72rem; color: var(--text-muted);">km</small>`;
  if (todayFuelEl) todayFuelEl.innerHTML = `${fuel} <small style="font-size: 0.72rem; color: var(--text-muted);">L</small>`;
  if (todayMileageEl) todayMileageEl.innerHTML = `${mileage} <small style="font-size: 0.72rem; color: var(--text-muted);">km/L</small>`;
  if (todayFuelPerKmEl) todayFuelPerKmEl.innerHTML = `${fuelPerKm} <small style="font-size: 0.72rem;">L/km</small>`;
  if (todayCostEl) todayCostEl.innerHTML = `₹ ${cost}`;

  if (tbody && Array.isArray(dailyData.summaries)) {
    tbody.innerHTML = dailyData.summaries.map(s => {
      const isToday = s.dayIndex === 0;
      const dKm = parseFloat(s.distanceKm || 0).toFixed(1);
      const dFuel = parseFloat(s.fuelUsedLiters || 0).toFixed(2);
      const dMil = parseFloat(s.mileageKmpl || 0).toFixed(1);
      const dFpk = parseFloat(s.fuelPerKm || 0).toFixed(3);
      const dCost = parseFloat(s.fuelCost || 0).toFixed(1);

      return `
        <tr style="${isToday ? 'background: rgba(56, 189, 248, 0.08); font-weight: 700;' : ''}">
          <td>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span>${isToday ? '🟢' : '📅'}</span>
              <span>${s.label}</span>
            </div>
          </td>
          <td style="color: #fff; font-family: var(--font-mono);">${dKm} km</td>
          <td style="color: var(--traxen-primary-light); font-family: var(--font-mono);">${dFuel} L</td>
          <td style="color: var(--status-moving); font-family: var(--font-mono);">${dMil} km/L</td>
          <td style="color: var(--traxen-amber-light); font-family: var(--font-mono);">${dFpk} L/km</td>
          <td style="color: #38BDF8; font-family: var(--font-mono);">₹ ${dCost}</td>
        </tr>
      `;
    }).join('');
  }
}

window.App = {
  switchTab,
  selectDevice,
  filterFleet,
  handleSearch,
  trackVehicleOnMap,
  openVehicleCan,
  selectCategory,
  sendRemoteCommand,
  openAddDeviceModal,
  closeAddDeviceModal,
  saveNewDevice,
  fetchDailySummaries,
  renderDailySummaries
};
