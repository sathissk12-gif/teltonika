# 🛰️ Teltonika GPS & CAN Telematics Suite (FMX150 / FMB150)

Production-ready, high-performance Telematics Server and Real-time Dashboard engineered specifically for **Teltonika GPS & CAN trackers (FMX150, FMB150, FMC150, FMM150)**.

---

## 🌟 Key Features

1. **High-Speed TCP Listener (Port 5023)**
   - Teltonika Handshake Authentication (IMEI `0x01` confirmation).
   - Binary Codec 8 (`0x08`) and Codec 8 Extended (`0x8E`) Parser (2-byte AVL IDs & variable IOs).
   - Instant Acknowledgment ACK dispatch (`00 00 00 [Count]`).

2. **Full CAN Bus Parameter Extraction (85+ IDs)**
   - Fuel Level % & Liters, RPM, Total Odometer, Coolant Temp, AdBlue %, Engine Hours.
   - Driver controls: Accelerator %, Footbrake, Clutch, Handbrake, AC status.
   - Body & Safety: Doors (Driver, Passenger, Trunk, Hood), Seatbelts, Headlights.

3. **Multi-Point Diesel Calibration & Theft Engine**
   - Piecewise Linear Interpolation ($X\% \to \text{Liters}$).
   - Pre-configured presets for Ashok Leyland (480L), BharatBenz (300L), Tata (160L), Bolero (60L).
   - Instant Parking Theft Alert (&gt;5L drop while Ignition is OFF) and Refueling Detection.

4. **Codec 12 Remote GPRS Commands**
   - 1-Click Engine Immobilizer (`setdigout 1 0`) & Restore (`setdigout 0 0`).
   - `getinfo`, `getio`, `readcan`, and custom terminal console.

5. **Modern Glassmorphism Real-Time Dashboard (Port 3001)**
   - Live Leaflet Map with animated rotating vehicle markers.
   - 2D Top-Down Interactive Vehicle Wireframe graphic.
   - Animated Fuel Liquid Tank Gauge & CAN Diagnostics.
   - Interactive Diesel Calibration Studio with curve graph & test slider.
   - Built-in Highway Trip Simulator (Chennai to Salem NH44/NH48).

---

## 🚀 Quick Start (Local Development)

### 1. Install Dependencies
```bash
cd teltonika_telematics
npm install
```

### 2. Run Tests
```bash
npm test
```

### 3. Start the Server
```bash
npm start
```

- **Web Dashboard**: Open [http://localhost:3001](http://localhost:3001) in your browser.
- **TCP GPS Listener**: Listening on `0.0.0.0:5023`.

### 4. Run Simulated Vehicle Trip
In a separate terminal:
```bash
npm run simulate
```
Watch the live map move in real time and see fuel drop, speed, and RPM update on the dashboard!

---

## 🌐 Linux VPS Deployment Guide

### Option 1: Docker Compose (Recommended)
```bash
# 1. Clone repository to your VPS
git clone <your-repo-url> /opt/teltonika-telematics
cd /opt/teltonika-telematics/teltonika_telematics

# 2. Launch container in background
docker compose up -d --build

# 3. Check logs
docker compose logs -f
```

### Option 2: PM2 Process Manager
```bash
# 1. Install Node.js 20+ and PM2
npm install -g pm2

# 2. Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

---

## 📱 Teltonika Configurator Setup (Device Side)

In the **Teltonika Configurator tool (or BTApp)**:
- **Protocol**: `TCP`
- **Server IP / Domain**: `<YOUR_VPS_IP_OR_DOMAIN>`
- **Server Port**: `5023`
- **APN**: `airtelgprs.com` (or your M2M SIM APN)
- **Send Period**: On Stop: `60s`, On Move: `10s`
- **Data Protocol**: `Codec 8 Extended`
