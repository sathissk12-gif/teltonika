/**
 * Traxen Telematics Suite - 90-Day CAN History, Route Playback & Trip-by-Trip Fuel/KM Audit
 * High-performance Leaflet route animation with live CAN HUD, Trip Breakdown, Refuel/Theft logs & CSV Export.
 */

const HistoryStudio = {
  activeImei: null,
  activeVehicle: null,
  activeTab: 'playback', // 'playback' | 'tripsTable' | 'fuelEvents' | 'canTable'
  currentPreset: 'today',

  // Telemetry state
  playbackPoints: [],
  fuelEvents: [],
  trips: [],
  rawCanHistory: [],
  playbackIndex: 0,
  isPlaying: false,
  playSpeed: 1, // 1x, 2x, 5x, 10x, 20x
  playInterval: null,
  playbackMap: null,
  routePolyline: null,
  progressPolyline: null,
  vehicleMarker: null,
  startMarker: null,
  endMarker: null,
  eventMarkers: [],

  // Initialize
  init() {
    this.setDefaultDates('today');
  },

  setDefaultDates(preset) {
    this.currentPreset = preset;
    const now = new Date();
    let fromDate = new Date();
    let toDate = new Date();

    if (preset === 'today') {
      fromDate.setHours(0, 0, 0, 0);
      toDate.setHours(23, 59, 59, 999);
    } else if (preset === 'yesterday') {
      fromDate.setDate(fromDate.getDate() - 1);
      fromDate.setHours(0, 0, 0, 0);
      toDate.setDate(toDate.getDate() - 1);
      toDate.setHours(23, 59, 59, 999);
    } else if (preset === '7days') {
      fromDate.setDate(fromDate.getDate() - 7);
      fromDate.setHours(0, 0, 0, 0);
    } else if (preset === '30days') {
      fromDate.setDate(fromDate.getDate() - 30);
      fromDate.setHours(0, 0, 0, 0);
    } else if (preset === '90days') {
      fromDate.setDate(fromDate.getDate() - 90);
      fromDate.setHours(0, 0, 0, 0);
    }

    const formatForInput = (d) => {
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const fromInput = document.getElementById('histFromDate');
    const toInput = document.getElementById('histToDate');
    if (fromInput) fromInput.value = formatForInput(fromDate);
    if (toInput) toInput.value = formatForInput(toDate);

    // Update preset button active states
    document.querySelectorAll('.hist-preset-btn').forEach(btn => {
      if (btn.dataset.preset === preset) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  },

  openHistoryModal(imei, tab = 'playback') {
    this.activeImei = imei || window.currentDeviceImei;
    if (!this.activeImei) {
      if (window.allDevices && window.allDevices.length > 0) {
        this.activeImei = window.allDevices[0].imei;
      } else {
        alert('Please select or create a vehicle first.');
        return;
      }
    }

    this.activeVehicle = (window.allDevices && window.allDevices.find(d => d.imei === this.activeImei)) || {
      vehicleNumber: `TN-${this.activeImei.slice(-4)}`,
      model: 'Traxen Telematics Unit',
      category: 'OPEN TRUCK',
      imei: this.activeImei
    };

    // Update Header info
    const plateEl = document.getElementById('histModalPlate');
    const modelEl = document.getElementById('histModalModel');
    const imeiEl = document.getElementById('histModalImei');
    const iconEl = document.getElementById('histModalIcon');

    if (plateEl) plateEl.innerText = this.activeVehicle.vehicleNumber || this.activeVehicle.numberPlate;
    if (modelEl) modelEl.innerText = `${this.activeVehicle.model || 'Traxen GPS'} • ${this.activeVehicle.category || 'Vehicle'}`;
    if (imeiEl) imeiEl.innerText = `IMEI: ${this.activeImei}`;
    if (iconEl && window.getVehicleIconPath) {
      iconEl.src = getVehicleIconPath(this.activeVehicle.category || 'OPEN TRUCK', 'moving');
    }

    // Populate Vehicle Selector Dropdown in Modal
    const selectEl = document.getElementById('histVehicleSelect');
    if (selectEl && window.allDevices) {
      selectEl.innerHTML = window.allDevices.map(d => `
        <option value="${d.imei}" ${d.imei === this.activeImei ? 'selected' : ''}>
          ${d.vehicleNumber || d.numberPlate} (${d.category || 'Vehicle'})
        </option>
      `).join('');
    }

    const modal = document.getElementById('historyModal');
    if (modal) modal.classList.add('active');

    this.switchHistoryTab(tab);
    this.initPlaybackMap();
    this.fetchData();
  },

  closeHistoryModal() {
    this.pause();
    const modal = document.getElementById('historyModal');
    if (modal) modal.classList.remove('active');
  },

  onVehicleSelectChange(newImei) {
    if (newImei && newImei !== this.activeImei) {
      this.pause();
      this.openHistoryModal(newImei, this.activeTab);
    }
  },

  switchHistoryTab(tabId) {
    this.activeTab = tabId;
    document.querySelectorAll('.hist-sub-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.hist-tab-content').forEach(p => p.classList.remove('active'));

    const tabBtn = document.querySelector(`.hist-sub-tab[data-tab="${tabId}"]`);
    const tabPane = document.getElementById(`histTab_${tabId}`);

    if (tabBtn) tabBtn.classList.add('active');
    if (tabPane) tabPane.classList.add('active');

    if (tabId === 'playback' && this.playbackMap) {
      setTimeout(() => {
        this.playbackMap.invalidateSize();
        if (this.playbackPoints.length > 0) {
          const latlngs = this.playbackPoints.map(p => [p.latitude, p.longitude]);
          this.playbackMap.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] });
        }
      }, 200);
    }
  },

  initPlaybackMap() {
    const mapContainer = document.getElementById('histPlaybackMap');
    if (!mapContainer) return;

    if (!this.playbackMap) {
      this.playbackMap = L.map('histPlaybackMap', {
        zoomControl: true,
        attributionControl: false
      }).setView([11.6643, 78.1460], 13);

      // Dark Cyber Basemap
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd'
      }).addTo(this.playbackMap);
    } else {
      setTimeout(() => this.playbackMap.invalidateSize(), 150);
    }
  },

  async fetchData() {
    const fromVal = document.getElementById('histFromDate')?.value;
    const toVal = document.getElementById('histToDate')?.value;

    const fromIso = fromVal ? new Date(fromVal).toISOString() : null;
    const toIso = toVal ? new Date(toVal).toISOString() : null;

    const loadingOverlay = document.getElementById('histLoadingOverlay');
    if (loadingOverlay) loadingOverlay.style.display = 'flex';

    try {
      const [playbackRes, tripsRes, fuelEventsRes, historyRes] = await Promise.all([
        fetch(`/api/devices/${this.activeImei}/playback?${fromIso ? `from=${encodeURIComponent(fromIso)}&` : ''}${toIso ? `to=${encodeURIComponent(toIso)}&` : ''}limit=4000`).then(r => r.json()),
        fetch(`/api/devices/${this.activeImei}/trips?${fromIso ? `from=${encodeURIComponent(fromIso)}&` : ''}${toIso ? `to=${encodeURIComponent(toIso)}&` : ''}limit=100`).then(r => r.json()),
        fetch(`/api/devices/${this.activeImei}/fuel-events?${fromIso ? `from=${encodeURIComponent(fromIso)}&` : ''}${toIso ? `to=${encodeURIComponent(toIso)}&` : ''}`).then(r => r.json()),
        fetch(`/api/devices/${this.activeImei}/history?${fromIso ? `from=${encodeURIComponent(fromIso)}&` : ''}${toIso ? `to=${encodeURIComponent(toIso)}&` : ''}limit=500`).then(r => r.json())
      ]);

      if (loadingOverlay) loadingOverlay.style.display = 'none';

      const rawPoints = (playbackRes.success && playbackRes.data) ? playbackRes.data.points || [] : [];
      this.playbackPoints = rawPoints.map(p => ({
        ...p,
        latitude: parseFloat(p.latitude !== undefined ? p.latitude : p.lat) || 0,
        longitude: parseFloat(p.longitude !== undefined ? p.longitude : p.lng) || 0,
        angle: p.angle !== undefined ? p.angle : (p.bearing !== undefined ? p.bearing : 0),
        speed: p.speed !== undefined ? p.speed : 0,
        rpm: p.rpm !== undefined ? p.rpm : (p.engineRpm !== undefined ? p.engineRpm : 0),
        fuelLiters: p.fuelLiters !== undefined ? p.fuelLiters : 0,
        fuelPercent: p.fuelPercent !== undefined ? p.fuelPercent : (p.fuelPct !== undefined ? p.fuelPct : 0),
        gear: p.gearLabel || p.gear || (p.gearNumber ? `${p.gearNumber}` : (p.speed > 0 ? 'D' : 'N'))
      })).filter(p => p.latitude !== 0 && p.longitude !== 0);

      this.trips = (tripsRes.success && tripsRes.data) ? tripsRes.data || [] : [];

      const rawFuelEvents = (fuelEventsRes.success && fuelEventsRes.data) ? fuelEventsRes.data.events || [] : [];
      this.fuelEvents = rawFuelEvents.map(e => ({
        ...e,
        latitude: parseFloat(e.latitude !== undefined ? e.latitude : e.lat) || 0,
        longitude: parseFloat(e.longitude !== undefined ? e.longitude : e.lng) || 0
      }));

      this.rawCanHistory = (historyRes.success && historyRes.data) ? historyRes.data || [] : [];

      // Update Summary Statistics Banner
      this.renderSummaryStats(playbackRes.data ? playbackRes.data.summary : null, fuelEventsRes.data ? fuelEventsRes.data.summary : null);

      // Render Playback Map
      this.setupPlaybackRoute();

      // Render Trips Tab
      this.renderTripsList();

      // Render Fuel Events Tab
      this.renderFuelEventsList();

      // Render Raw CAN Tab
      this.renderCanDataTable();

    } catch (err) {
      if (loadingOverlay) loadingOverlay.style.display = 'none';
      console.error('Error fetching history:', err);
    }
  },

  renderSummaryStats(playbackSummary, fuelSummary) {
    const elDistance = document.getElementById('histStatDistance');
    const elFuelUsed = document.getElementById('histStatFuelUsed');
    const elMileage = document.getElementById('histStatMileage');
    const elFuelPerKm = document.getElementById('histStatFuelPerKm');
    const elMaxSpeed = document.getElementById('histStatMaxSpeed');
    const elFuelRefills = document.getElementById('histStatFuelRefills');
    const elTotalPoints = document.getElementById('histStatPoints');

    const totalKm = playbackSummary ? parseFloat(playbackSummary.totalDistanceKm || 0) : 0;
    const maxSpd = playbackSummary ? Math.round(playbackSummary.maxSpeed || 0) : 0;
    const avgSpd = playbackSummary ? Math.round(playbackSummary.avgSpeed || 0) : 0;
    const totalFilled = fuelSummary ? Number(fuelSummary.totalFuelFilled || 0).toFixed(1) : '0.0';
    const totalDrained = fuelSummary ? Number(fuelSummary.totalFuelDrained || 0).toFixed(1) : '0.0';

    // Calculate aggregate fuel used and mileage across trips or points
    let totalFuelConsumed = 0;
    if (this.trips.length > 0) {
      totalFuelConsumed = this.trips.reduce((acc, t) => acc + (parseFloat(t.fuelConsumedLiters) || 0), 0);
    } else if (totalKm > 0) {
      const defaultEconomy = (this.activeVehicle?.category === 'BIKE') ? 45.0 : ((this.activeVehicle?.category === 'CAR') ? 15.0 : 4.5);
      totalFuelConsumed = totalKm / defaultEconomy;
    }

    const avgMileage = (totalKm > 0.05 && totalFuelConsumed > 0.01) 
      ? (totalKm / totalFuelConsumed).toFixed(2) 
      : '0.0';

    const fuelPerKm = (totalKm > 0.05 && totalFuelConsumed > 0.01) 
      ? (totalFuelConsumed / totalKm).toFixed(3) 
      : '0.000';

    if (elDistance) elDistance.innerText = `${totalKm.toFixed(1)} km`;
    if (elFuelUsed) elFuelUsed.innerText = `${totalFuelConsumed.toFixed(1)} L`;
    if (elMileage) elMileage.innerText = `${avgMileage} km/L`;
    if (elFuelPerKm) elFuelPerKm.innerText = `${fuelPerKm} L/km`;
    if (elMaxSpeed) elMaxSpeed.innerText = `${maxSpd} / ${avgSpd} km/h`;
    if (elFuelRefills) elFuelRefills.innerText = `+${totalFilled} / -${totalDrained} L`;
    if (elTotalPoints) elTotalPoints.innerText = `${this.playbackPoints.length}`;
  },

  setupPlaybackRoute() {
    if (!this.playbackMap) return;

    // Clear previous layers
    if (this.routePolyline) this.playbackMap.removeLayer(this.routePolyline);
    if (this.progressPolyline) this.playbackMap.removeLayer(this.progressPolyline);
    if (this.vehicleMarker) this.playbackMap.removeLayer(this.vehicleMarker);
    if (this.startMarker) this.playbackMap.removeLayer(this.startMarker);
    if (this.endMarker) this.playbackMap.removeLayer(this.endMarker);
    this.eventMarkers.forEach(m => this.playbackMap.removeLayer(m));
    this.eventMarkers = [];

    this.playbackIndex = 0;
    this.pause();

    const emptyState = document.getElementById('histPlaybackEmpty');
    const controls = document.getElementById('histPlaybackControls');

    if (this.playbackPoints.length === 0) {
      if (emptyState) emptyState.style.display = 'flex';
      if (controls) controls.style.opacity = '0.5';
      this.updateHud(null);
      return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (controls) controls.style.opacity = '1';

    const latlngs = this.playbackPoints.map(p => [p.latitude, p.longitude]);

    // Background Full Route Polyline (Glow cyan-orange)
    this.routePolyline = L.polyline(latlngs, {
      color: 'rgba(255, 143, 0, 0.45)',
      weight: 5,
      dashArray: '8, 8',
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(this.playbackMap);

    // Active Progress Polyline (Solid Traxen Primary Orange)
    this.progressPolyline = L.polyline([], {
      color: '#FF6D00',
      weight: 6,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(this.playbackMap);

    // Start Pin (Green)
    const startPt = this.playbackPoints[0];
    const startIcon = L.divIcon({
      className: 'hist-map-pin start',
      html: '<div class="pin-inner">🟢 <span>START</span></div>',
      iconSize: [60, 24],
      iconAnchor: [30, 12]
    });
    this.startMarker = L.marker([startPt.latitude, startPt.longitude], { icon: startIcon }).addTo(this.playbackMap);

    // End Pin (Flag)
    const endPt = this.playbackPoints[this.playbackPoints.length - 1];
    const endIcon = L.divIcon({
      className: 'hist-map-pin end',
      html: '<div class="pin-inner">🏁 <span>END</span></div>',
      iconSize: [50, 24],
      iconAnchor: [25, 12]
    });
    this.endMarker = L.marker([endPt.latitude, endPt.longitude], { icon: endIcon }).addTo(this.playbackMap);

    // Moving Vehicle Marker
    const vehicleIcon = L.divIcon({
      className: 'hist-vehicle-anim-marker',
      html: `
        <div id="histMarkerWrapper" class="hist-marker-wrapper" style="transform: rotate(${startPt.angle || 0}deg);">
          <img src="${getVehicleIconPath(this.activeVehicle.category || 'OPEN TRUCK', 'moving')}" class="hist-marker-img">
          <div class="hist-marker-pulse"></div>
        </div>
      `,
      iconSize: [44, 44],
      iconAnchor: [22, 22]
    });
    this.vehicleMarker = L.marker([startPt.latitude, startPt.longitude], { icon: vehicleIcon, zIndexOffset: 1000 }).addTo(this.playbackMap);

    // Add Fuel Event Markers along the trail
    this.fuelEvents.forEach(ev => {
      const isRefuel = ev.type === 'REFUEL';
      const evIcon = L.divIcon({
        className: `hist-event-pin ${isRefuel ? 'refuel' : 'theft'}`,
        html: `<span>${isRefuel ? '⛽' : '🚨'}</span>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });
      const marker = L.marker([ev.latitude, ev.longitude], { icon: evIcon })
        .bindPopup(`
          <div style="font-family: var(--font-main); padding: 4px;">
            <strong style="color: ${isRefuel ? 'var(--status-moving)' : 'var(--status-theft)'};">
              ${isRefuel ? '⛽ Diesel Refill' : '🚨 Fuel Theft / Drop'} (${isRefuel ? `+${ev.amountLiters}L` : `-${ev.amountLiters}L`})
            </strong>
            <div style="font-size: 0.78rem; color: #cbd5e1; margin-top: 4px;">Time: ${new Date(ev.timestamp).toLocaleTimeString('en-IN')}</div>
            <div style="font-size: 0.78rem; color: #94a3b8;">Fuel Level: ${ev.startFuelLiters}L ➔ ${ev.endFuelLiters}L</div>
          </div>
        `)
        .addTo(this.playbackMap);
      this.eventMarkers.push(marker);
    });

    // Fit Bounds to entire route
    this.playbackMap.fitBounds(L.latLngBounds(latlngs), { padding: [50, 50] });

    // Update Slider bounds
    const slider = document.getElementById('histScrubber');
    if (slider) {
      slider.min = 0;
      slider.max = this.playbackPoints.length - 1;
      slider.value = 0;
    }

    this.seekTo(0);
  },

  seekTo(index) {
    if (index < 0 || index >= this.playbackPoints.length) return;
    this.playbackIndex = index;
    const pt = this.playbackPoints[index];

    // Update vehicle marker position & angle
    if (this.vehicleMarker) {
      this.vehicleMarker.setLatLng([pt.latitude, pt.longitude]);
      const markerWrap = document.getElementById('histMarkerWrapper');
      if (markerWrap) {
        markerWrap.style.transform = `rotate(${pt.angle || 0}deg)`;
      }
    }

    // Update progress polyline
    if (this.progressPolyline) {
      const progressPts = this.playbackPoints.slice(0, index + 1).map(p => [p.latitude, p.longitude]);
      this.progressPolyline.setLatLngs(progressPts);
    }

    // Auto-center map if enabled
    const autoCenter = document.getElementById('histAutoCenterCheck')?.checked;
    if (autoCenter && this.playbackMap) {
      this.playbackMap.panTo([pt.latitude, pt.longitude], { animate: false });
    }

    // Update slider UI
    const slider = document.getElementById('histScrubber');
    if (slider) slider.value = index;

    // Update HUD
    this.updateHud(pt);
  },

  updateHud(pt) {
    const elSpeed = document.getElementById('hudSpeed');
    const elGear = document.getElementById('hudGear');
    const elFuel = document.getElementById('hudFuel');
    const elRpm = document.getElementById('hudRpm');
    const elIgn = document.getElementById('hudIgnition');
    const elTime = document.getElementById('hudTime');
    const elProgressPct = document.getElementById('hudProgressPct');

    if (!pt) {
      if (elSpeed) elSpeed.innerText = '0 km/h';
      if (elGear) elGear.innerText = 'N';
      if (elFuel) elFuel.innerText = '0 L';
      if (elRpm) elRpm.innerText = '0';
      if (elIgn) elIgn.innerText = 'OFF';
      if (elTime) elTime.innerText = '--:--:--';
      if (elProgressPct) elProgressPct.innerText = '0%';
      return;
    }

    if (elSpeed) elSpeed.innerText = `${pt.speed || 0} km/h`;
    if (elGear) elGear.innerText = pt.gear || (pt.gearNumber ? `${pt.gearNumber}` : (pt.speed > 0 ? 'D' : 'N'));
    if (elFuel) elFuel.innerText = `${Number(pt.fuelLiters || 0).toFixed(1)} L (${pt.fuelPercent || 0}%)`;
    if (elRpm) elRpm.innerText = `${pt.rpm || 0} RPM`;
    if (elIgn) {
      const isIgn = pt.ignition === 1 || pt.ignition === true || pt.ignition === 'ON';
      elIgn.innerText = isIgn ? 'ON 🟢' : 'OFF ⚪';
      elIgn.style.color = isIgn ? 'var(--status-moving)' : 'var(--text-muted)';
    }
    if (elTime) {
      const d = new Date(pt.timestamp);
      elTime.innerText = d.toLocaleString('en-IN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    }
    if (elProgressPct && this.playbackPoints.length > 0) {
      const pct = Math.round((this.playbackIndex / (this.playbackPoints.length - 1)) * 100);
      elProgressPct.innerText = `${pct}% (${this.playbackIndex + 1}/${this.playbackPoints.length})`;
    }
  },

  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  },

  play() {
    if (this.playbackPoints.length === 0) return;
    if (this.playbackIndex >= this.playbackPoints.length - 1) {
      this.playbackIndex = 0;
    }

    this.isPlaying = true;
    const playBtn = document.getElementById('btnHistPlay');
    if (playBtn) playBtn.innerHTML = '<span>⏸️</span> Pause';

    if (this.playInterval) clearInterval(this.playInterval);

    const stepTime = Math.max(30, Math.floor(400 / this.playSpeed));

    this.playInterval = setInterval(() => {
      if (this.playbackIndex < this.playbackPoints.length - 1) {
        this.seekTo(this.playbackIndex + 1);
      } else {
        this.pause();
      }
    }, stepTime);
  },

  pause() {
    this.isPlaying = false;
    if (this.playInterval) clearInterval(this.playInterval);
    const playBtn = document.getElementById('btnHistPlay');
    if (playBtn) playBtn.innerHTML = '<span>▶️</span> Play';
  },

  setPlaySpeed(multiplier) {
    this.playSpeed = multiplier;
    document.querySelectorAll('.hist-speed-pill').forEach(btn => {
      if (btn.dataset.speed == multiplier) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    if (this.isPlaying) {
      this.pause();
      this.play();
    }
  },

  onScrubberInput(val) {
    const idx = parseInt(val, 10);
    this.seekTo(idx);
  },

  // -------------------------------------------------------------
  // TAB 2: TRIP-BY-TRIP FUEL & KM MILEAGE AUDIT
  // -------------------------------------------------------------
  renderTripsList() {
    const container = document.getElementById('histTripsGrid');
    if (!container) return;

    if (this.trips.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px 20px; color: var(--text-muted); background: var(--bg-card); border-radius: var(--radius-lg); border: 1px solid var(--border-glass);">
          <div style="font-size: 2.5rem; margin-bottom: 10px;">🛣️</div>
          <div style="font-size: 1.05rem; font-weight: 700; color: #fff;">No Completed Trips Found</div>
          <div style="font-size: 0.8rem; margin-top: 4px;">Trips are automatically logged when the vehicle starts and finishes moving.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = this.trips.map((t, idx) => {
      const sDate = new Date(t.startTime);
      const eDate = new Date(t.endTime);
      const sTimeStr = sDate.toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
      const eTimeStr = eDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

      const distKm = parseFloat(t.distanceKm || 0).toFixed(1);
      const fuelLiters = parseFloat(t.fuelConsumedLiters || 0).toFixed(2);
      const mileageKmPerL = parseFloat(t.mileageKmPerLiter || (distKm / Math.max(0.1, fuelLiters))).toFixed(2);
      const fuelPerKm = parseFloat(t.fuelPerKm || (fuelLiters / Math.max(0.1, distKm))).toFixed(3);
      const costTotal = (t.costTotal || (fuelLiters * 102.50)).toFixed(1);
      const costKm = (t.costPerKm || (fuelPerKm * 102.50)).toFixed(2);

      const durationHours = Math.floor((t.durationMinutes || 1) / 60);
      const durationMins = (t.durationMinutes || 1) % 60;
      const durationStr = durationHours > 0 ? `${durationHours}h ${durationMins}m` : `${durationMins}m`;

      return `
        <div class="hist-trip-card">
          <!-- Trip Top Header -->
          <div class="trip-card-header">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="trip-number-badge">Trip #${this.trips.length - idx}</span>
              <span class="trip-duration-pill">⏱️ ${durationStr}</span>
            </div>
            <div class="trip-cost-badge">₹ ${costTotal}</div>
          </div>

          <!-- Trip Time Span -->
          <div class="trip-time-row">
            <div class="trip-point">
              <span class="dot start"></span>
              <span class="time">${sTimeStr}</span>
            </div>
            <div class="trip-arrow">➔</div>
            <div class="trip-point">
              <span class="dot end"></span>
              <span class="time">${eTimeStr}</span>
            </div>
          </div>

          <!-- 4-Grid Trip Metrics: Dist, Fuel, Mileage, Fuel/KM -->
          <div class="trip-metrics-quad">
            <div class="trip-metric-box">
              <span class="trip-m-lbl">Distance</span>
              <span class="trip-m-val">${distKm} km</span>
            </div>
            <div class="trip-metric-box">
              <span class="trip-m-lbl">Fuel Used</span>
              <span class="trip-m-val" style="color: var(--traxen-primary-light);">${fuelLiters} L</span>
            </div>
            <div class="trip-metric-box" style="border-color: rgba(22, 163, 74, 0.4); background: rgba(22, 163, 74, 0.08);">
              <span class="trip-m-lbl" style="color: var(--status-moving);">Mileage</span>
              <span class="trip-m-val" style="color: var(--status-moving); font-size: 1.15rem;">${mileageKmPerL} <span style="font-size: 0.7rem;">km/L</span></span>
            </div>
            <div class="trip-metric-box" style="border-color: rgba(255, 143, 0, 0.4); background: rgba(255, 143, 0, 0.08);">
              <span class="trip-m-lbl" style="color: var(--traxen-amber-light);">💧 Fuel / KM</span>
              <span class="trip-m-val" style="color: var(--traxen-amber-light); font-size: 1.15rem;">${fuelPerKm} <span style="font-size: 0.7rem;">L/km</span></span>
            </div>
          </div>

          <!-- Sub Info: Cost/KM, Avg Speed, Idle Waste -->
          <div class="trip-sub-stats">
            <span>💰 Cost: <strong>₹ ${costKm} / km</strong></span>
            <span>⚡ Avg: <strong>${t.avgSpeed || 0} km/h</strong> (Max: ${t.maxSpeed || 0})</span>
            <span>🛑 Idle: <strong>${t.idleMinutes || 0}m</strong></span>
          </div>

          <!-- Actions -->
          <div class="trip-actions-row">
            <button class="btn-trip-play" onclick="HistoryStudio.playSpecificTrip('${t.startTime}', '${t.endTime}')">
              <span>▶️</span> Play Route
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  playSpecificTrip(startTime, endTime) {
    const fromTime = new Date(startTime).getTime();
    const toTime = new Date(endTime).getTime();

    // Find the starting point index in playbackPoints
    const startIndex = this.playbackPoints.findIndex(p => new Date(p.timestamp).getTime() >= fromTime);
    this.switchHistoryTab('playback');
    
    if (startIndex !== -1) {
      this.seekTo(startIndex);
      setTimeout(() => this.play(), 300);
    } else {
      this.seekTo(0);
    }
  },

  // -------------------------------------------------------------
  // TAB 3: FUEL REFUEL & THEFT LOGS
  // -------------------------------------------------------------
  renderFuelEventsList() {
    const container = document.getElementById('histFuelEventsList');
    if (!container) return;

    if (this.fuelEvents.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
          <div style="font-size: 2.5rem; margin-bottom: 10px;">⛽</div>
          <div style="font-size: 1.05rem; font-weight: 700; color: #fff;">No Refuel or Sudden Drop Events Detected</div>
          <div style="font-size: 0.8rem; margin-top: 4px;">Fuel level remained stable during this time range.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = this.fuelEvents.map((ev, idx) => {
      const isRefuel = ev.type === 'REFUEL';
      const amountStr = isRefuel ? `+${Number(ev.amountLiters).toFixed(1)} L` : `-${Number(ev.amountLiters).toFixed(1)} L`;
      const dateStr = new Date(ev.timestamp).toLocaleString('en-IN', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });

      return `
        <div class="hist-fuel-card ${isRefuel ? 'refuel' : 'theft'}">
          <div class="hist-fuel-badge ${isRefuel ? 'refuel' : 'theft'}">
            <span>${isRefuel ? '⛽ DIESEL REFUEL' : '🚨 SUDDEN FUEL DROP / THEFT'}</span>
            <span class="hist-fuel-amount">${amountStr}</span>
          </div>

          <div class="hist-fuel-body">
            <div class="hist-fuel-row">
              <span class="hist-fuel-lbl">Event Timestamp</span>
              <span class="hist-fuel-val">${dateStr}</span>
            </div>
            <div class="hist-fuel-row">
              <span class="hist-fuel-lbl">Tank Level Transition</span>
              <span class="hist-fuel-val highlight">${ev.startFuelLiters} L ➔ ${ev.endFuelLiters} L</span>
            </div>
            <div class="hist-fuel-row">
              <span class="hist-fuel-lbl">Ignition State</span>
              <span class="hist-fuel-val">${ev.ignition ? 'IGNITION ON' : 'IGNITION OFF (PARKED)'}</span>
            </div>
            <div class="hist-fuel-row">
              <span class="hist-fuel-lbl">GPS Coordinates</span>
              <span class="hist-fuel-val mono">${Number(ev.latitude).toFixed(4)}, ${Number(ev.longitude).toFixed(4)}</span>
            </div>
          </div>

          <div class="hist-fuel-footer">
            <button class="btn-hist-locate" onclick="HistoryStudio.locateEventOnMap(${ev.latitude}, ${ev.longitude})">
              <span>📍</span> Locate Event on Map
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  locateEventOnMap(lat, lng) {
    this.switchHistoryTab('playback');
    if (this.playbackMap) {
      this.playbackMap.setView([lat, lng], 16, { animate: true });
    }
  },

  // -------------------------------------------------------------
  // TAB 4: RAW 90-DAY CAN TELEMETRY TABLE & CSV EXPORT
  // -------------------------------------------------------------
  renderCanDataTable() {
    const tbody = document.getElementById('histCanTableBody');
    if (!tbody) return;

    if (this.rawCanHistory.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="10" style="text-align:center; padding: 30px; color: var(--text-muted);">
            No CAN telemetry records found in this date range.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = this.rawCanHistory.map(r => {
      const d = new Date(r.timestamp);
      const timeStr = d.toLocaleString('en-IN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });

      const isIgn = r.ignition === 1 || r.ignition === true || r.ignition === 'ON';

      return `
        <tr>
          <td class="mono" style="font-size: 0.78rem; color: #cbd5e1;">${timeStr}</td>
          <td><span class="table-speed-pill">${r.speed || 0} km/h</span></td>
          <td><strong>${r.engineRpm || 0}</strong></td>
          <td style="color: var(--traxen-amber-light); font-weight: 800;">${r.gearLabel || (r.currentGear ? `${r.currentGear}` : 'N')}</td>
          <td style="color: var(--traxen-primary-light); font-weight: 700;">${Number(r.fuelLiters || 0).toFixed(1)} L</td>
          <td>${r.fuelPercentage || 0}%</td>
          <td>${r.coolantTemp || 0}°C</td>
          <td>${r.externalVoltage ? `${r.externalVoltage}V` : '--'}</td>
          <td><span class="table-ign-badge ${isIgn ? 'on' : 'off'}">${isIgn ? 'ON' : 'OFF'}</span></td>
          <td class="mono">${r.totalMileageCan ? `${(r.totalMileageCan / 1000).toFixed(1)}k` : (r.odometer ? `${r.odometer}k` : '--')}</td>
        </tr>
      `;
    }).join('');
  },

  exportToCsv() {
    if (this.rawCanHistory.length === 0) {
      alert('No CAN records available to export.');
      return;
    }

    const headers = [
      'Timestamp (IST)',
      'Vehicle Number',
      'IMEI',
      'Latitude',
      'Longitude',
      'Speed (km/h)',
      'Engine RPM',
      'Transmission Gear',
      'Fuel Liters',
      'Fuel Percent',
      'Coolant Temp (C)',
      'Battery Voltage (V)',
      'Ignition',
      'Odometer (km)'
    ];

    const rows = this.rawCanHistory.map(r => [
      new Date(r.timestamp).toISOString(),
      this.activeVehicle.vehicleNumber || this.activeVehicle.numberPlate,
      this.activeImei,
      r.latitude || '',
      r.longitude || '',
      r.speed || 0,
      r.engineRpm || 0,
      r.gearLabel || r.currentGear || 'N',
      r.fuelLiters || 0,
      r.fuelPercentage || 0,
      r.coolantTemp || 0,
      r.externalVoltage || '',
      r.ignition ? 'ON' : 'OFF',
      r.totalMileageCan || r.odometer || 0
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + 
      [headers.join(','), ...rows.map(e => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    const filename = `Traxen_CAN_History_${(this.activeVehicle.vehicleNumber || this.activeImei).replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};

window.HistoryStudio = HistoryStudio;
