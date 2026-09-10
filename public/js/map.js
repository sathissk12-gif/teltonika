/**
 * Traxen Telematics Suite - Google Maps Live Telematics Controller
 * Uses Google Maps JavaScript API with Custom Cyber Dark Mode,
 * High-Resolution Satellite Hybrid, Live Traffic Layer, Rotating Vehicle Markers & Route History
 */

let gMap = null;
let googleVehicleOverlay = null;
let googleRoutePolyline = null;
let trafficLayer = null;
let isTrafficOn = false;
let currentMapTheme = 'dark';
let lastVehiclePos = { lat: 11.6643, lng: 78.1460 };
const pathCoordinates = [];

// Fallback Leaflet variables if Google Maps fails to load
let leafletMap = null;
let leafletMarker = null;
let leafletRoute = null;

// Premium Traxen Cyber Dark Theme Style JSON for Google Maps
const TRAXEN_DARK_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0b111e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0b111e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#7488a6' }] },
  {
    featureType: 'administrative.locality',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#d59563' }]
  },
  {
    featureType: 'poi',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#5b7094' }]
  },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: '#131e2e' }]
  },
  {
    featureType: 'poi.park',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#3d566e' }]
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#1b273d' }]
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#101826' }]
  },
  {
    featureType: 'road',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#8fa0bd' }]
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#e65100' }]
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#782600' }]
  },
  {
    featureType: 'road.highway',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#ffa726' }]
  },
  {
    featureType: 'transit',
    elementType: 'geometry',
    stylers: [{ color: '#182438' }]
  },
  {
    featureType: 'transit.station',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#d59563' }]
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#070b14' }]
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#3d566e' }]
  },
  {
    featureType: 'water',
    elementType: 'labels.text.stroke',
    stylers: [{ color: '#070b14' }]
  }
];

/**
 * Initialize Google Maps (or fallback to Leaflet if Google Maps SDK unavailable)
 */
function initMap(initialLat = 11.6643, initialLng = 78.1460, category = 'OPEN TRUCK') {
  lastVehiclePos = { lat: Number(initialLat), lng: Number(initialLng) };

  const mapElem = document.getElementById('leafletMap');
  if (!mapElem) return;

  // Check if Google Maps JavaScript API is loaded
  if (window.google && window.google.maps) {
    try {
      initGoogleMap(initialLat, initialLng, category);
      return;
    } catch (e) {
      console.warn('[Map] Google Maps init error, falling back to Leaflet:', e);
    }
  }

  // Fallback to Leaflet OSM
  initLeafletMap(initialLat, initialLng, category);
}

/**
 * Google Maps Engine Implementation
 */
function initGoogleMap(lat, lng, category) {
  if (gMap) return;

  const mapElem = document.getElementById('leafletMap');
  mapElem.innerHTML = ''; // clear any previous canvas

  const mapCenter = new google.maps.LatLng(lat, lng);

  gMap = new google.maps.Map(mapElem, {
    center: mapCenter,
    zoom: 15,
    styles: TRAXEN_DARK_STYLE,
    mapTypeId: google.maps.MapTypeId.ROADMAP,
    disableDefaultUI: true,
    zoomControl: true,
    zoomControlOptions: {
      position: google.maps.ControlPosition.RIGHT_BOTTOM
    },
    gestureHandling: 'greedy'
  });

  // Create Glowing Orange Breadcrumb Route Trail
  googleRoutePolyline = new google.maps.Polyline({
    path: [],
    geodesic: true,
    strokeColor: '#FF6D00',
    strokeOpacity: 0.95,
    strokeWeight: 4,
    map: gMap
  });

  // Create Custom HTML Rotating Marker Overlay
  createGoogleVehicleOverlay(lat, lng, category);

  // Initialize Traffic Layer
  trafficLayer = new google.maps.TrafficLayer();
}

/**
 * Custom Google Maps HTML Overlay for Rotating Traxen Vehicle
 */
function createGoogleVehicleOverlay(lat, lng, category) {
  function TraxenOverlay(position, cat) {
    this.position = position;
    this.category = cat;
    this.angle = 0;
    this.div = null;
  }

  TraxenOverlay.prototype = new google.maps.OverlayView();

  TraxenOverlay.prototype.onAdd = function () {
    const div = document.createElement('div');
    div.className = 'traxen-map-marker';
    div.style.position = 'absolute';
    div.style.cursor = 'pointer';
    div.style.zIndex = '1000';

    const iconPath = `assets/icons/vehicle/sideview/moving/${this.category}.png`;

    div.innerHTML = `
      <div class="traxen-marker-pulse"></div>
      <div id="markerRotator" class="traxen-marker-icon-container">
        <img id="mapMarkerImg" src="${iconPath}" class="traxen-marker-img" alt="Vehicle" onerror="this.src='assets/icons/vehicle/sideview/moving/OPEN TRUCK.png'">
      </div>
    `;

    this.div = div;
    const panes = this.getPanes();
    panes.overlayMouseTarget.appendChild(div);
  };

  TraxenOverlay.prototype.draw = function () {
    if (!this.div) return;
    const overlayProjection = this.getProjection();
    if (!overlayProjection) return;

    const point = overlayProjection.fromLatLngToDivPixel(this.position);
    if (point) {
      this.div.style.left = point.x - 22 + 'px';
      this.div.style.top = point.y - 22 + 'px';
    }
  };

  TraxenOverlay.prototype.onRemove = function () {
    if (this.div && this.div.parentNode) {
      this.div.parentNode.removeChild(this.div);
      this.div = null;
    }
  };

  TraxenOverlay.prototype.setPosition = function (latLng, angle = 0, cat = null) {
    this.position = latLng;
    this.angle = angle;
    if (cat) this.category = cat;

    if (this.div) {
      const rotator = this.div.querySelector('#markerRotator');
      if (rotator) {
        rotator.style.transform = `rotate(${angle}deg)`;
      }
      const img = this.div.querySelector('#mapMarkerImg');
      if (img && cat) {
        img.src = `assets/icons/vehicle/sideview/moving/${cat}.png`;
      }
    }
    this.draw();
  };

  googleVehicleOverlay = new TraxenOverlay(new google.maps.LatLng(lat, lng), category);
  googleVehicleOverlay.setMap(gMap);
}

/**
 * Update Vehicle Location (Called on every live telemetry packet)
 */
function updateVehicleLocation(lat, lng, angle = 0, speed = 0, category = 'OPEN TRUCK') {
  if (!lat || !lng) return;
  const numLat = Number(lat);
  const numLng = Number(lng);
  lastVehiclePos = { lat: numLat, lng: numLng };

  if (gMap && googleVehicleOverlay) {
    const latLng = new google.maps.LatLng(numLat, numLng);

    // Update Marker Position & Heading Angle
    googleVehicleOverlay.setPosition(latLng, angle, category);

    // Update Route Breadcrumb Path
    pathCoordinates.push(latLng);
    if (pathCoordinates.length > 500) pathCoordinates.shift();
    if (googleRoutePolyline) {
      googleRoutePolyline.setPath(pathCoordinates);
    }

    // Auto-follow vehicle if in motion
    if (speed > 0) {
      gMap.panTo(latLng);
    }
    return;
  }

  // Fallback to Leaflet if Leaflet active
  if (leafletMap) {
    updateLeafletLocation(numLat, numLng, angle, speed, category);
    return;
  }

  // Otherwise initialize
  initMap(numLat, numLng, category);
}

/**
 * Map Controls Toolbar Handlers
 */
function setMapType(type) {
  if (!gMap) return;
  currentMapTheme = type;

  document.querySelectorAll('.map-btn-control').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`btnMap${type.charAt(0).toUpperCase() + type.slice(1)}`);
  if (btn) btn.classList.add('active');

  if (type === 'dark') {
    gMap.setMapTypeId(google.maps.MapTypeId.ROADMAP);
    gMap.setOptions({ styles: TRAXEN_DARK_STYLE });
  } else if (type === 'satellite') {
    gMap.setMapTypeId(google.maps.MapTypeId.HYBRID);
    gMap.setOptions({ styles: null });
  } else if (type === 'roadmap') {
    gMap.setMapTypeId(google.maps.MapTypeId.ROADMAP);
    gMap.setOptions({ styles: null });
  }
}

function toggleTraffic() {
  if (!gMap || !trafficLayer) return;
  isTrafficOn = !isTrafficOn;

  const btn = document.getElementById('btnMapTraffic');
  if (btn) btn.classList.toggle('active', isTrafficOn);

  if (isTrafficOn) {
    trafficLayer.setMap(gMap);
  } else {
    trafficLayer.setMap(null);
  }
}

function recenterMap() {
  if (gMap && lastVehiclePos) {
    gMap.panTo(new google.maps.LatLng(lastVehiclePos.lat, lastVehiclePos.lng));
    gMap.setZoom(16);
  } else if (leafletMap && lastVehiclePos) {
    leafletMap.setView([lastVehiclePos.lat, lastVehiclePos.lng], 16);
  }
}

function resetMapPath() {
  pathCoordinates.length = 0;
  if (googleRoutePolyline) googleRoutePolyline.setPath([]);
  if (leafletRoute) leafletRoute.setLatLngs([]);
}

/**
 * Leaflet OSM Fallback Implementation
 */
function initLeafletMap(lat, lng, category) {
  if (leafletMap) return;

  const mapElem = document.getElementById('leafletMap');
  if (!mapElem) return;

  leafletMap = L.map('leafletMap', {
    zoomControl: false,
    attributionControl: false
  }).setView([lat, lng], 15);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(leafletMap);

  L.control.zoom({ position: 'bottomright' }).addTo(leafletMap);

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

  leafletMarker = L.marker([lat, lng], { icon: vehicleIcon }).addTo(leafletMap);

  leafletRoute = L.polyline([], {
    color: '#FF6D00',
    weight: 4,
    opacity: 0.85,
    smoothFactor: 1
  }).addTo(leafletMap);
}

function updateLeafletLocation(lat, lng, angle, speed, category) {
  const newPos = [lat, lng];
  if (leafletMarker) {
    leafletMarker.setLatLng(newPos);
  }

  const rotator = document.getElementById('markerRotator');
  if (rotator) rotator.style.transform = `rotate(${angle}deg)`;

  pathCoordinates.push(newPos);
  if (pathCoordinates.length > 350) pathCoordinates.shift();
  if (leafletRoute) leafletRoute.setLatLngs(pathCoordinates);

  if (speed > 0 && leafletMap) {
    leafletMap.panTo(newPos, { animate: true, duration: 0.8 });
  }
}

// Window Controller Export
window.MapController = {
  initMap,
  updateVehicleLocation,
  resetMapPath,
  setMapType,
  toggleTraffic,
  recenterMap
};
