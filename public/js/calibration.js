/**
 * Interactive Diesel Calibration Studio
 * Manages Multi-Point Table, SVG Curve Graph, Presets, and Live Test Slider.
 */

let currentPoints = [];
let currentTankCapacity = 480;

function initCalibrationStudio(device) {
  if (!device) return;

  currentTankCapacity = device.tankCapacity || 480;
  currentPoints = device.calibrationPoints && device.calibrationPoints.length > 0
    ? [...device.calibrationPoints]
    : [
        { raw: 0, liters: 0 },
        { raw: 25, liters: currentTankCapacity * 0.23 },
        { raw: 50, liters: currentTankCapacity * 0.49 },
        { raw: 75, liters: currentTankCapacity * 0.75 },
        { raw: 100, liters: currentTankCapacity }
      ];

  const capInput = document.getElementById('calibTankCapacity');
  if (capInput) capInput.value = currentTankCapacity;

  renderCalibrationTable();
  drawCurveGraph();
  updateLiveSliderTest(50);
}

function renderCalibrationTable() {
  const tbody = document.getElementById('calibTableBody');
  if (!tbody) return;

  tbody.innerHTML = '';

  currentPoints.sort((a, b) => a.raw - b.raw).forEach((point, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <input type="number" step="0.1" value="${point.raw}" onchange="updatePointRaw(${index}, this.value)" ${index === 0 || index === currentPoints.length - 1 ? 'disabled' : ''}>
        <span style="color: var(--text-muted); font-size: 0.8rem;">%</span>
      </td>
      <td>
        <input type="number" step="0.1" value="${point.liters}" onchange="updatePointLiters(${index}, this.value)">
        <span style="color: var(--text-muted); font-size: 0.8rem;">L</span>
      </td>
      <td>
        ${index > 0 && index < currentPoints.length - 1 
          ? `<button class="btn-icon-danger" onclick="removeCalibrationPoint(${index})">🗑️</button>` 
          : `<span style="color: var(--text-muted); font-size: 0.75rem;">Locked</span>`}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function updatePointRaw(index, val) {
  currentPoints[index].raw = parseFloat(val) || 0;
  drawCurveGraph();
}

function updatePointLiters(index, val) {
  currentPoints[index].liters = parseFloat(val) || 0;
  drawCurveGraph();
}

function addCalibrationRow() {
  const newRaw = Math.min(Math.max(Math.round(Math.random() * 80 + 10), 1), 99);
  const estLiters = parseFloat(((newRaw / 100) * currentTankCapacity).toFixed(1));
  currentPoints.push({ raw: newRaw, liters: estLiters });
  currentPoints.sort((a, b) => a.raw - b.raw);
  renderCalibrationTable();
  drawCurveGraph();
}

function removeCalibrationPoint(index) {
  currentPoints.splice(index, 1);
  renderCalibrationTable();
  drawCurveGraph();
}

function applyPreset(presetKey) {
  fetch('/api/presets')
    .then(res => res.json())
    .then(data => {
      if (data.success && data.data[presetKey]) {
        const preset = data.data[presetKey];
        currentTankCapacity = preset.capacity;
        currentPoints = [...preset.points];
        const capInput = document.getElementById('calibTankCapacity');
        if (capInput) capInput.value = currentTankCapacity;
        renderCalibrationTable();
        drawCurveGraph();
        updateLiveSliderTest(50);
      }
    });
}

function drawCurveGraph() {
  const canvas = document.getElementById('curveCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const padding = 40;

  ctx.clearRect(0, 0, width, height);

  // Background Grid Lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  for (let x = padding; x <= width - padding; x += (width - padding * 2) / 4) {
    ctx.beginPath();
    ctx.moveTo(x, padding);
    ctx.lineTo(x, height - padding);
    ctx.stroke();
  }
  for (let y = padding; y <= height - padding; y += (height - padding * 2) / 4) {
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
  }

  // Draw Axes
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.beginPath();
  ctx.moveTo(padding, padding);
  ctx.lineTo(padding, height - padding);
  ctx.lineTo(width - padding, height - padding);
  ctx.stroke();

  // Axis Labels
  ctx.fillStyle = '#64748b';
  ctx.font = '10px JetBrains Mono';
  ctx.fillText('0%', padding - 5, height - padding + 15);
  ctx.fillText('100%', width - padding - 15, height - padding + 15);
  ctx.fillText('0L', padding - 25, height - padding);
  ctx.fillText(`${currentTankCapacity}L`, padding - 35, padding + 10);

  if (currentPoints.length < 2) return;

  const sorted = [...currentPoints].sort((a, b) => a.raw - b.raw);
  const maxLiters = sorted[sorted.length - 1].liters || currentTankCapacity || 1;

  // Plot Curve Line
  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = 3;
  ctx.shadowColor = 'rgba(0, 240, 255, 0.5)';
  ctx.shadowBlur = 10;
  ctx.beginPath();

  sorted.forEach((p, idx) => {
    const x = padding + (p.raw / 100) * (width - padding * 2);
    const y = (height - padding) - (p.liters / maxLiters) * (height - padding * 2);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Plot Points
  sorted.forEach(p => {
    const x = padding + (p.raw / 100) * (width - padding * 2);
    const y = (height - padding) - (p.liters / maxLiters) * (height - padding * 2);
    ctx.fillStyle = '#ff1744';
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function updateLiveSliderTest(rawPct) {
  const sliderValElem = document.getElementById('sliderRawVal');
  const resultLitersElem = document.getElementById('sliderResultLiters');
  if (sliderValElem) sliderValElem.innerText = `${rawPct}%`;

  // Calculate Liters locally
  const liters = interpolate(parseFloat(rawPct), currentPoints);
  if (resultLitersElem) resultLitersElem.innerText = `${liters.toFixed(1)} Liters`;
}

function interpolate(rawValue, points) {
  if (points.length === 0) return 0;
  const sorted = [...points].sort((a, b) => a.raw - b.raw);
  if (rawValue <= sorted[0].raw) return sorted[0].liters;
  if (rawValue >= sorted[sorted.length - 1].raw) return sorted[sorted.length - 1].liters;

  for (let i = 0; i < sorted.length - 1; i++) {
    const p1 = sorted[i];
    const p2 = sorted[i + 1];
    if (rawValue >= p1.raw && rawValue <= p2.raw) {
      const ratio = (rawValue - p1.raw) / (p2.raw - p1.raw);
      return p1.liters + ratio * (p2.liters - p1.liters);
    }
  }
  return 0;
}

function saveCalibrationToServer(imei) {
  const capInput = document.getElementById('calibTankCapacity');
  const capacity = capInput ? parseFloat(capInput.value) : currentTankCapacity;

  fetch(`/api/devices/${imei}/calibration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tankCapacity: capacity,
      points: currentPoints
    })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      alert('🎉 Calibration Table saved successfully! Fuel levels are now 100% synchronized.');
    } else {
      alert('Error saving calibration: ' + data.error);
    }
  })
  .catch(err => alert('Network error: ' + err.message));
}

window.CalibrationStudio = {
  initCalibrationStudio,
  addCalibrationRow,
  removeCalibrationPoint,
  updatePointRaw,
  updatePointLiters,
  applyPreset,
  updateLiveSliderTest,
  saveCalibrationToServer
};
