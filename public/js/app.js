/**
 * Traxen Telematics Suite - Main Application Controller
 * Official Traxen Fleet & Vehicle Tracking Architecture
 */

let currentDeviceImei = null;
let allDevices = [];
let filteredDevices = [];
let currentFleetFilter = 'ALL';
let selectedNewVehicleCategory = 'OPEN TRUCK';
let ws = null;

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initWebSocket();
  loadDevices();
});

// Tab Switching
function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add('active');

      // Trigger map resize when switching to map tab
      if (targetId === 'tabMap' && window.MapController) {
        setTimeout(() => {
          if (window.map) window.map.invalidateSize();
        }, 150);
      }
    });
  });
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

// Load Devices from Server
function loadDevices() {
  fetch('/api/devices')
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        allDevices = data.data || [];
        updateFleetCounters();
        applyFleetFilter(currentFleetFilter);
      }
    })
    .catch(err => console.error('Error loading devices:', err));
}

// Update Traxen Fleet Overview Counters (Total, Moving, Idle, Parked, Offline)
function updateFleetCounters() {
  let total = allDevices.length;
  let moving = 0;
  let idle = 0;
  let parked = 0;
  let offline = 0;

  allDevices.forEach(dev => {
    const isOnline = dev.status === 'ONLINE';
    const tel = dev.lastTelemetry || {};
    const speed = tel.speed || 0;
    const ignition = tel.ignition === true || tel.ignition === 'ON' || tel.ignition === 1;

    if (!isOnline) {
      offline++;
    } else if (speed > 0) {
      moving++;
    } else if (ignition) {
      idle++;
    } else {
      parked++;
    }
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

// Filter fleet by status pill click
function filterFleet(type) {
  currentFleetFilter = type;
  document.querySelectorAll('.fleet-stat-pill').forEach(pill => pill.classList.remove('active'));
  const activePill = document.querySelector(`.fleet-stat-pill.${type.toLowerCase()}`);
  if (activePill) activePill.classList.add('active');
  applyFleetFilter(type);
}

function applyFleetFilter(type) {
  if (type === 'ALL') {
    filteredDevices = [...allDevices];
  } else if (type === 'MOVING') {
    filteredDevices = allDevices.filter(d => d.status === 'ONLINE' && d.lastTelemetry && d.lastTelemetry.speed > 0);
  } else if (type === 'IDLE') {
    filteredDevices = allDevices.filter(d => d.status === 'ONLINE' && d.lastTelemetry && (d.lastTelemetry.ignition === true || d.lastTelemetry.ignition === 1) && (!d.lastTelemetry.speed || d.lastTelemetry.speed === 0));
  } else if (type === 'PARKED') {
    filteredDevices = allDevices.filter(d => d.status === 'ONLINE' && (!d.lastTelemetry || !d.lastTelemetry.ignition) && (!d.lastTelemetry || !d.lastTelemetry.speed || d.lastTelemetry.speed === 0));
  } else if (type === 'OFFLINE') {
    filteredDevices = allDevices.filter(d => d.status !== 'ONLINE');
  }

  populateDeviceDropdown(filteredDevices);

  if (filteredDevices.length > 0) {
    // If current selected device is still in the filtered list, keep it; else select first
    const exists = filteredDevices.some(d => d.imei === currentDeviceImei);
    if (!exists) {
      selectDevice(filteredDevices[0].imei);
    }
  } else {
    showEmptyDeviceState();
  }
}

function populateDeviceDropdown(devices) {
  const select = document.getElementById('deviceSelect');
  const btnDelete = document.getElementById('btnDeleteDevice');
  if (!select) return;

  select.innerHTML = '';
  if (devices.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.innerText = '(No matching vehicles)';
    select.appendChild(opt);
    if (btnDelete) btnDelete.style.display = 'none';
    return;
  }

  devices.forEach(dev => {
    const opt = document.createElement('option');
    opt.value = dev.imei;
    opt.innerText = `${dev.vehicleNumber} (${dev.model || 'Traxen Tracker'})`;
    select.appendChild(opt);
  });

  if (btnDelete) btnDelete.style.display = 'inline-block';

  select.onchange = (e) => {
    selectDevice(e.target.value);
  };
}

function showEmptyDeviceState() {
  currentDeviceImei = null;
  const modelElem = document.getElementById('selectedVehicleModel');
  if (modelElem) modelElem.innerText = 'No vehicles registered • Connect tracker to Port 5023';

  const statusDot = document.getElementById('mainStatusDot');
  const statusText = document.getElementById('mainStatusText');
  if (statusDot && statusText) {
    statusDot.className = 'status-dot';
    statusText.innerText = 'TCP Port 5023 Active';
  }

  const navIcon = document.getElementById('navVehicleIcon');
  if (navIcon) navIcon.src = getVehicleIconPath('OPEN TRUCK', 'nodata');

  if (window.GaugesController) {
    window.GaugesController.updateGauges({
      speed: 0,
      engineRpm: 0,
      odometerKm: 0,
      coolantTemp: 0,
      batteryVoltage: 0,
      fuelPercentage: 0,
      fuelLiters: 0,
      ignition: false
    }, 480);
  }
}

function selectDevice(imei) {
  currentDeviceImei = imei;
  const dev = allDevices.find(d => d.imei === imei);
  if (!dev) return;

  const select = document.getElementById('deviceSelect');
  if (select && select.value !== imei) select.value = imei;

  const btnDelete = document.getElementById('btnDeleteDevice');
  if (btnDelete) btnDelete.style.display = 'inline-block';

  const isOnline = dev.status === 'ONLINE';
  const tel = dev.lastTelemetry || {};
  const statusMode = isOnline ? (tel.speed > 0 ? 'moving' : (tel.ignition ? 'idle' : 'parking')) : 'nodata';

  // Update Traxen Sideview Icon in Navbar
  const navIcon = document.getElementById('navVehicleIcon');
  if (navIcon) {
    navIcon.src = getVehicleIconPath(dev.category || 'OPEN TRUCK', statusMode);
  }

  // Update Header Badges
  const modelElem = document.getElementById('selectedVehicleModel');
  if (modelElem) modelElem.innerText = `${dev.model} • ${dev.tankCapacity}L Tank • ${dev.category || 'Vehicle'}`;

  const sourceBadge = document.getElementById('fuelSourceBadge');
  if (sourceBadge) {
    sourceBadge.innerText = dev.fuelSource === 'ANALOG_AIN1' 
      ? 'Analog Float (AIN1)' 
      : (dev.fuelSource === 'CAN_LITERS' ? 'Direct CAN Liters (AVL 84)' : 'CAN Bus % (AVL 83)');
  }

  const statusDot = document.getElementById('mainStatusDot');
  const statusText = document.getElementById('mainStatusText');
  if (statusDot && statusText) {
    statusDot.className = `status-dot ${isOnline ? '' : 'offline'}`;
    statusText.innerText = isOnline ? 'TCP Port 5023 Online' : 'Device Offline';
  }

  // Update Telemetry & Gauges
  if (dev.lastTelemetry) {
    if (window.MapController) {
      window.MapController.updateVehicleLocation(
        dev.lastTelemetry.lat || 11.6643,
        dev.lastTelemetry.lng || 78.1460,
        dev.lastTelemetry.angle || 0,
        dev.lastTelemetry.speed || 0,
        dev.category || 'OPEN TRUCK'
      );
    }
    if (window.GaugesController) {
      window.GaugesController.updateGauges(dev.lastTelemetry, dev.tankCapacity);
    }
  }

  // Initialize Calibration Studio
  if (window.CalibrationStudio) {
    window.CalibrationStudio.initCalibrationStudio(dev);
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

  // Auto-fill sensible default tank capacities based on category
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

function deleteCurrentDevice() {
  if (!currentDeviceImei) return;
  const dev = allDevices.find(d => d.imei === currentDeviceImei);
  const name = dev ? dev.vehicleNumber : currentDeviceImei;

  if (!confirm(`Are you sure you want to delete vehicle "${name}"?`)) {
    return;
  }

  fetch(`/api/devices/${currentDeviceImei}`, {
    method: 'DELETE'
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      loadDevices();
    } else {
      alert('Error deleting device: ' + data.error);
    }
  })
  .catch(err => alert('Network error: ' + err.message));
}

// WebSocket Real-time Listener
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[WS] Connected to Live Telematics Stream');
    const wsBadge = document.getElementById('wsStatusText');
    if (wsBadge) wsBadge.innerText = 'WebSocket Connected';
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
    console.warn('[WS] Disconnected, reconnecting in 3s...');
    const wsBadge = document.getElementById('wsStatusText');
    if (wsBadge) wsBadge.innerText = 'Reconnecting...';
    setTimeout(initWebSocket, 3000);
  };
}

function handleWebSocketMessage(msg) {
  if (msg.event === 'telemetry') {
    const { imei, data } = msg.data;
    
    // Update memory device telemetry
    const dev = allDevices.find(d => d.imei === imei);
    if (dev) {
      dev.lastTelemetry = data;
      dev.status = 'ONLINE';
    }
    updateFleetCounters();

    if (imei === currentDeviceImei) {
      if (window.MapController) {
        window.MapController.updateVehicleLocation(data.lat, data.lng, data.angle, data.speed, dev ? dev.category : 'OPEN TRUCK');
      }
      if (window.GaugesController) {
        window.GaugesController.updateGauges(data, dev ? dev.tankCapacity : 480);
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
    <div class="alert-content">
      <span style="font-size: 1.4rem;">${isTheft ? '🚨' : '⛽'}</span>
      <div>
        <span class="alert-title">${alert.title} [${alert.vehicleNumber}]</span>
        <div style="font-size: 0.84rem; opacity: 0.9; margin-top: 2px;">${alert.message} • Coordinates: ${alert.lat}, ${alert.lng}</div>
      </div>
    </div>
    <button class="btn-secondary" style="padding: 4px 10px; font-size: 0.8rem;" onclick="this.closest('.alert-banner').remove()">✕</button>
  `;

  container.innerHTML = '';
  container.appendChild(banner);

  // Auto dismiss after 15 seconds
  setTimeout(() => {
    if (banner.parentElement) banner.remove();
  }, 15000);
}

// Remote Codec 12 Command Dispatcher
function sendRemoteCommand(cmdText) {
  if (!currentDeviceImei) return;

  const input = document.getElementById('customCommandInput');
  const command = cmdText || (input ? input.value : '');
  if (!command) return;

  if (window.SimulatorController) {
    window.SimulatorController.logTerminal(`[Dispatching Codec 12] ➡️ "${command}" to ${currentDeviceImei}...`, 'cmd');
  }

  fetch(`/api/devices/${currentDeviceImei}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      if (window.SimulatorController) {
        window.SimulatorController.logTerminal(`[Success] Packet transmitted to device TCP socket.`, 'resp');
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

window.App = {
  selectDevice,
  filterFleet,
  selectCategory,
  sendRemoteCommand,
  openAddDeviceModal,
  closeAddDeviceModal,
  saveNewDevice,
  deleteCurrentDevice
};
