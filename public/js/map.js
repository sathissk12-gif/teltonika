/**
 * Traxen Telematics Suite - Live Map Controller
 * Official Traxen Rotating Vehicle Marker & Breadcrumb Route Trail
 */

let map = null;
let vehicleMarker = null;
let routePolyline = null;
const pathCoordinates = [];

function initMap(initialLat = 11.6643, initialLng = 78.1460, category = 'OPEN TRUCK') {
  if (map) return;

  const mapElem = document.getElementById('leafletMap');
  if (!mapElem) return;

  map = L.map('leafletMap', {
    zoomControl: false,
    attributionControl: false
  }).setView([initialLat, initialLng], 14);

  // High performance OpenStreetMap tiles
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  createTraxenMarker(initialLat, initialLng, category);

  // Traxen glowing orange breadcrumb route polyline
  routePolyline = L.polyline([], {
    color: '#FF6D00',
    weight: 4,
    opacity: 0.85,
    smoothFactor: 1
  }).addTo(map);
}

function createTraxenMarker(lat, lng, category = 'OPEN TRUCK') {
  const iconPath = `assets/icons/vehicle/sideview/moving/${category}.png`;

  const vehicleIcon = L.divIcon({
    className: 'traxen-map-marker',
    html: `
      <div class="traxen-marker-pulse"></div>
      <div id="markerRotator" class="traxen-marker-icon-container">
        <img id="mapMarkerImg" src="${iconPath}" class="traxen-marker-img" alt="Vehicle" onerror="this.src='assets/icons/vehicle/sideview/moving/OPEN TRUCK.png'">
      </div>
    `,
    iconSize: [44, 44],
    iconAnchor: [22, 22]
  });

  vehicleMarker = L.marker([lat, lng], { icon: vehicleIcon }).addTo(map);
}

function updateVehicleLocation(lat, lng, angle = 0, speed = 0, category = 'OPEN TRUCK') {
  if (!map || !vehicleMarker) {
    initMap(lat, lng, category);
  }

  const newPos = [lat, lng];
  if (vehicleMarker) {
    vehicleMarker.setLatLng(newPos);
  }

  // Update image icon if category changes
  const markerImg = document.getElementById('mapMarkerImg');
  if (markerImg) {
    const targetSrc = `assets/icons/vehicle/sideview/moving/${category}.png`;
    if (!markerImg.src.includes(encodeURIComponent(category)) && !markerImg.src.includes(category)) {
      markerImg.src = targetSrc;
    }
  }

  // Rotate marker according to heading angle
  const rotator = document.getElementById('markerRotator');
  if (rotator) {
    rotator.style.transform = `rotate(${angle}deg)`;
  }

  // Append to breadcrumb path
  pathCoordinates.push(newPos);
  if (pathCoordinates.length > 350) pathCoordinates.shift();
  if (routePolyline) {
    routePolyline.setLatLngs(pathCoordinates);
  }

  // Smoothly center map if vehicle is moving
  if (speed > 0 && map) {
    map.panTo(newPos, { animate: true, duration: 0.8 });
  }
}

function resetMapPath() {
  pathCoordinates.length = 0;
  if (routePolyline) routePolyline.setLatLngs([]);
}

window.MapController = {
  initMap,
  updateVehicleLocation,
  resetMapPath
};
