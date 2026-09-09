/**
 * Teltonika AVL ID Parameter Dictionary
 * Maps standard and CAN Bus AVL IDs to human-readable names, units, and conversion factors.
 */

const AVL_DICTIONARY = {
  // Standard Hardware IOs
  1: { name: 'DIN1', label: 'Digital Input 1 (Ignition)', type: 'boolean' },
  2: { name: 'DIN2', label: 'Digital Input 2', type: 'boolean' },
  3: { name: 'DIN3', label: 'Digital Input 3', type: 'boolean' },
  4: { name: 'DIN4', label: 'Digital Input 4', type: 'boolean' },
  9: { name: 'AIN1', label: 'Analog Input 1 Voltage', unit: 'V', multiplier: 0.001 },
  10: { name: 'AIN2', label: 'Analog Input 2 Voltage', unit: 'V', multiplier: 0.001 },
  11: { name: 'ICCID1', label: 'SIM 1 ICCID', type: 'string' },
  14: { name: 'ICCID2', label: 'SIM 2 ICCID', type: 'string' },
  16: { name: 'odometer', label: 'Total Odometer', unit: 'km', multiplier: 0.001 },
  17: { name: 'axisX', label: 'Accelerometer X', unit: 'mG' },
  18: { name: 'axisY', label: 'Accelerometer Y', unit: 'mG' },
  19: { name: 'axisZ', label: 'Accelerometer Z', unit: 'mG' },
  21: { name: 'gsmSignal', label: 'GSM Signal Strength', unit: 'CSQ (0-31)' },
  22: { name: 'speed', label: 'Speed', unit: 'km/h' },
  24: { name: 'speedLimit', label: 'Speed Limit', unit: 'km/h' },
  66: { name: 'externalVoltage', label: 'External Power Voltage', unit: 'V', multiplier: 0.001 },
  67: { name: 'batteryVoltage', label: 'Internal Battery Voltage', unit: 'V', multiplier: 0.001 },
  68: { name: 'batteryCurrent', label: 'Internal Battery Current', unit: 'mA' },
  69: { name: 'gnssStatus', label: 'GNSS Status', type: 'enum' },
  70: { name: 'pcbTemp', label: 'PCB Temperature', unit: '°C', multiplier: 0.1 },
  78: { name: 'driverId', label: 'iButton / Driver ID', type: 'string' },
  179: { name: 'dout1', label: 'Digital Output 1 (Immobilizer Relay)', type: 'boolean' },
  180: { name: 'dout2', label: 'Digital Output 2', type: 'boolean' },
  239: { name: 'ignition', label: 'Ignition Status', type: 'boolean' },
  240: { name: 'movement', label: 'Movement Status', type: 'boolean' },
  241: { name: 'gsmOperator', label: 'GSM Operator Code', type: 'integer' },
  246: { name: 'towingAlert', label: 'Towing Event Alert', type: 'boolean' },
  247: { name: 'crashAlert', label: 'Crash Event Alert', type: 'boolean' },
  249: { name: 'jammingAlert', label: 'GSM Jamming Alert', type: 'boolean' },
  250: { name: 'tripOdometer', label: 'Trip Odometer', unit: 'km', multiplier: 0.001 },
  252: { name: 'unplugAlert', label: 'Power Unplug / Tamper Alert', type: 'boolean' },

  // CAN Bus & Engine Parameters (FMX150 / FMB150 / CAN Adapters)
  30: { name: 'dtcCount', label: 'Diagnostic Trouble Codes Count', unit: 'codes' },
  31: { name: 'engineLoad', label: 'Engine Load', unit: '%' },
  32: { name: 'engineRpm', label: 'Engine RPM', unit: 'RPM' },
  33: { name: 'engineHours', label: 'Total Engine Hours', unit: 'h', multiplier: 0.05 },
  34: { name: 'canSpeed', label: 'Vehicle Speed (CAN)', unit: 'km/h' },
  35: { name: 'acceleratorPedal', label: 'Accelerator Pedal Position', unit: '%' },
  36: { name: 'coolantTemp', label: 'Coolant Temperature', unit: '°C' },
  37: { name: 'fuelLevel', label: 'Fuel Level (Raw CAN)', unit: '%' },
  38: { name: 'evBatterySoc', label: 'EV High Voltage Battery SoC', unit: '%' },
  39: { name: 'evBatteryVoltage', label: 'EV Battery Voltage', unit: 'V', multiplier: 0.1 },
  40: { name: 'evBatteryCurrent', label: 'EV Battery Current', unit: 'A', multiplier: 0.1 },
  41: { name: 'evMotorTemp', label: 'EV Motor Temperature', unit: '°C' },
  42: { name: 'evRangeKm', label: 'EV Remaining Range', unit: 'km' },

  81: { name: 'overspeedCan', label: 'CAN Overspeed Alert', type: 'boolean' },
  82: { name: 'engineWorkTime', label: 'Engine Work Time', unit: 'h', multiplier: 0.1 },
  83: { name: 'fuelLevelPercentage', label: 'Fuel Level (%)', unit: '%' },
  84: { name: 'fuelLevelLiters', label: 'Fuel Level (Direct Liters)', unit: 'L' },
  85: { name: 'engineOilLevel', label: 'Engine Oil Level', unit: '%' },
  86: { name: 'engineOilTemp', label: 'Engine Oil Temperature', unit: '°C' },
  87: { name: 'totalFuelConsumed', label: 'Total Fuel Consumed', unit: 'L', multiplier: 0.1 },
  89: { name: 'fuelRate', label: 'Fuel Consumption Rate', unit: 'L/h', multiplier: 0.1 },
  
  90: { name: 'doorStatusMask', label: 'Door Status Mask', type: 'bitmask' },
  91: { name: 'seatbeltMask', label: 'Seatbelt Mask', type: 'bitmask' },
  92: { name: 'handbrake', label: 'Handbrake (Parking Brake)', type: 'boolean' },
  93: { name: 'footBrake', label: 'Foot Brake Switch', type: 'boolean' },
  94: { name: 'clutch', label: 'Clutch Switch', type: 'boolean' },
  95: { name: 'cruiseControl', label: 'Cruise Control Active', type: 'boolean' },
  96: { name: 'acStatus', label: 'Air Conditioner (AC)', type: 'boolean' },
  97: { name: 'lightsMask', label: 'Lights Status Mask', type: 'bitmask' },
  98: { name: 'currentGear', label: 'Transmission Gear', type: 'integer' },
  
  99: { name: 'axleWeight1', label: 'Axle Weight 1', unit: 'kg' },
  100: { name: 'axleWeight2', label: 'Axle Weight 2', unit: 'kg' },
  101: { name: 'axleWeight3', label: 'Axle Weight 3', unit: 'kg' },
  102: { name: 'adBlueLevel', label: 'AdBlue / DEF Fluid Level', unit: '%' },
  103: { name: 'ptoState', label: 'PTO (Power Take-Off) State', type: 'boolean' },
  104: { name: 'retarderTorque', label: 'Retarder Actual Torque', unit: '%' },
  105: { name: 'airSuspensionPressure', label: 'Air Suspension Pressure', unit: 'bar', multiplier: 0.1 },
  106: { name: 'ambientTemp', label: 'Ambient Air Temperature', unit: '°C' },
  107: { name: 'vinChassis', label: 'Vehicle VIN Number', type: 'string' },
  115: { name: 'oilPressure', label: 'Engine Oil Pressure', unit: 'bar', multiplier: 0.1 },
  116: { name: 'cngRate', label: 'CNG Gaseous Fuel Rate', unit: 'kg/h', multiplier: 0.1 },
  117: { name: 'totalCngUsed', label: 'Total CNG Used', unit: 'kg', multiplier: 0.1 },
  132: { name: 'nextServiceDistance', label: 'Distance Till Next Service', unit: 'km' }
};

function getAvlDefinition(avlId) {
  return AVL_DICTIONARY[avlId] || {
    name: `avl_${avlId}`,
    label: `Custom Parameter ${avlId}`,
    type: 'raw'
  };
}

module.exports = {
  AVL_DICTIONARY,
  getAvlDefinition
};
