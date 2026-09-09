/**
 * Teltonika Telematics Suite - Main Application Controller
 */

let currentDeviceImei = null;
let allDevices = [];
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

// Load Devices from Server
function loadDevices() {
  fetch('/api/devices')
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        allDevices = data.data || [];
        populateDeviceDropdown(allDevices);
        if (allDevices.length > 0) {
          selectDevice(allDevices[0].imei);
        } else {
          showEmptyDeviceState();
        }
      }
    })
    .catch(err => console.error('Error loading devices:', err));
}

function populateDeviceDropdown(devices) {
  const select = document.getElementById('deviceSelect');
  const btnDelete = document.getElementById('btnDeleteDevice');
  if (!select) return;

  select.innerHTML = '';
  if (devices.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.innerText = '(No vehicles registered)';
    select.appendChild(opt);
    if (btnDelete) btnDelete.style.display = 'none';
    return;
  }

  devices.forEach(dev => {
    const opt = document.createElement('option');
    opt.value = dev.imei;
    opt.innerText = `${dev.vehicleNumber} (${dev.model || 'Teltonika'})`;
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
    statusText.innerText = 'TCP Port 5023 Ready';
  }

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

  // Update Header Badges
  const modelElem = document.getElementById('selectedVehicleModel');
  if (modelElem) modelElem.innerText = `${dev.model} • ${dev.tankCapacity}L Tank`;

  const statusDot = document.getElementById('mainStatusDot');
  const statusText = document.getElementById('mainStatusText');
  if (statusDot && statusText) {
    const isOnline = dev.status === 'ONLINE';
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
        dev.lastTelemetry.speed || 0
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
    alert('Please enter Device IMEI and Vehicle Number!');
    return;
  }

  fetch('/api/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imei,
      vehicleNumber,
      model: model || 'Teltonika Tracker',
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
    if (imei === currentDeviceImei) {
      if (window.MapController) {
        window.MapController.updateVehicleLocation(data.lat, data.lng, data.angle, data.speed);
      }
      const dev = allDevices.find(d => d.imei === imei);
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

  const isRefuel = alert.type === 'REFUEL';
  const banner = document.createElement('div');
  banner.className = `alert-banner ${isRefuel ? 'refuel' : ''}`;
  banner.innerHTML = `
    <div class="alert-content">
      <span style="font-size: 1.4rem;">${isRefuel ? '⛽' : '🚨'}</span>
      <div>
        <strong>${alert.title} [${alert.vehicleNumber}]</strong>
        <div style="font-size: 0.82rem; opacity: 0.9;">${alert.message} • Lat: ${alert.lat}, Lng: ${alert.lng}</div>
      </div>
    </div>
    <button class="alert-close" onclick="this.parentElement.remove()">✕</button>
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

window.App = {
  selectDevice,
  sendRemoteCommand,
  openAddDeviceModal,
  closeAddDeviceModal,
  saveNewDevice,
  deleteCurrentDevice
};
