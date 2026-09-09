/**
 * Leaflet Live Map Controller for Vehicle Tracking
 */

let map = null;
let vehicleMarker = null;
let routePolyline = null;
const pathCoordinates = [];

function initMap(initialLat = 11.6643, initialLng = 78.1460) {
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

  // Custom Animated Vehicle Icon
  const vehicleIcon = L.divIcon({
    className: 'custom-vehicle-marker',
    html: `
      <div id="markerRotator" style="
        width: 36px; height: 36px; 
        background: linear-gradient(135deg, #00f0ff, #0070f3); 
        border: 2px solid #fff; 
        border-radius: 50%; 
        display: flex; align-items: center; justify-content: center; 
        box-shadow: 0 0 15px rgba(0, 240, 255, 0.7);
        transition: transform 0.4s ease;
        transform: rotate(0deg);
      ">
        <span style="font-size: 18px;">🚚</span>
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });

  vehicleMarker = L.marker([initialLat, initialLng], { icon: vehicleIcon }).addTo(map);

  // Breadcrumb route polyline
  routePolyline = L.polyline([], {
    color: '#00f0ff',
    weight: 4,
    opacity: 0.8,
    smoothFactor: 1
  }).addTo(map);
}

function updateVehicleLocation(lat, lng, angle = 0, speed = 0) {
  if (!map || !vehicleMarker) {
    initMap(lat, lng);
  }

  const newPos = [lat, lng];
  vehicleMarker.setLatLng(newPos);

  // Rotate marker according to heading angle
  const rotator = document.getElementById('markerRotator');
  if (rotator) {
    rotator.style.transform = `rotate(${angle}deg)`;
  }

  // Append to breadcrumb path
  pathCoordinates.push(newPos);
  if (pathCoordinates.length > 300) pathCoordinates.shift();
  if (routePolyline) {
    routePolyline.setLatLngs(pathCoordinates);
  }

  // Smoothly center map if vehicle is moving
  if (speed > 0) {
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
