/**
 * 2D Top-Down Vehicle Wireframe Graphic Controller
 * Visualizes live doors, headlights, seatbelt, handbrake, and safety indicators.
 */

function updateWireframe(telemetry) {
  if (!telemetry) return;

  const doorMask = telemetry.doorMask || 0;
  // Bit 0: Driver door, Bit 1: Passenger door, Bit 2: Rear Left, Bit 3: Rear Right, Bit 4: Hood, Bit 5: Trunk
  const isDriverDoorOpen = (doorMask & 1) !== 0;
  const isPassDoorOpen = (doorMask & 2) !== 0;
  const isTrunkOpen = (doorMask & 32) !== 0;
  const isHoodOpen = (doorMask & 16) !== 0;

  // Door Visuals
  const doorDriver = document.getElementById('wfDoorDriver');
  const doorPass = document.getElementById('wfDoorPass');
  const hood = document.getElementById('wfHood');
  const trunk = document.getElementById('wfTrunk');

  if (doorDriver) {
    doorDriver.setAttribute('fill', isDriverDoorOpen ? 'rgba(255, 23, 68, 0.7)' : 'rgba(0, 230, 118, 0.2)');
    doorDriver.setAttribute('stroke', isDriverDoorOpen ? '#ff1744' : '#00e676');
  }

  if (doorPass) {
    doorPass.setAttribute('fill', isPassDoorOpen ? 'rgba(255, 23, 68, 0.7)' : 'rgba(0, 230, 118, 0.2)');
    doorPass.setAttribute('stroke', isPassDoorOpen ? '#ff1744' : '#00e676');
  }

  // Headlights
  const lights = document.getElementById('wfHeadlights');
  if (lights) {
    const isLightsOn = telemetry.speed > 0 || telemetry.ignition;
    lights.style.opacity = isLightsOn ? '0.85' : '0.1';
  }

  // Status Badges
  const seatbeltBadge = document.getElementById('wfSeatbeltBadge');
  if (seatbeltBadge) {
    const isBuckled = telemetry.seatbelt !== false;
    seatbeltBadge.innerText = isBuckled ? 'SEATBELT: FASTENED 🟢' : 'SEATBELT: UNBUCKLED ⚠️';
    seatbeltBadge.className = `pill-status ${isBuckled ? 'on' : 'alert'}`;
  }

  const handbrakeBadge = document.getElementById('wfHandbrakeBadge');
  if (handbrakeBadge) {
    const isHandbrake = telemetry.handbrake === true || (telemetry.speed === 0 && !telemetry.ignition);
    handbrakeBadge.innerText = isHandbrake ? 'HANDBRAKE: ON 🅿️' : 'HANDBRAKE: RELEASED';
    handbrakeBadge.className = `pill-status ${isHandbrake ? 'alert' : 'on'}`;
  }
}

window.WireframeController = {
  updateWireframe
};
