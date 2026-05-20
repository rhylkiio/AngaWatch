export const spaceWeatherSensors: Record<string, any> = {
  'TART-Kenya': {
    sensorId: 'TART-Kenya',
    uiName: 'TART Radio Telescope',
    objName: 'TART-Kenya',
    type: 'Ground Station',
    system: 'TART',
    operator: 'TUK',
    lat: -1.286389,
    lon: 36.817223,
    zoom: 0.1,
    pluginIconId: 'tart-srb-monitor-bottom-icon',
    hasTelemetry: true
  },

  'GOES-18': {
    sensorId: 'GOES-18',
    uiName: 'GOES-18 X-Ray Monitor',
    objName: 'GOES-18',
    type: 'Satellite',
    system: 'NOAA GOES',
    operator: 'NOAA',
    lat: 0,
    lon: -137.2,
    zoom: 1.0,
    pluginIconId: 'xray-flux-monitor-bottom-icon',
    hasTelemetry: true
  },
  'GOES-19': {
    sensorId: 'GOES-19',
    uiName: 'GOES-19 X-Ray Monitor',
    objName: 'GOES-19',
    type: 'Satellite',
    system: 'NOAA GOES',
    operator: 'NOAA',
    lat: 0,
    lon: -89.5,
    zoom: 1.0,
    pluginIconId: 'xray-flux-monitor-bottom-icon',
    hasTelemetry: true
  },
  'GOES-XRAY': {
    sensorId: 'GOES-XRAY',
    uiName: 'X-RAY Flux Monitor',
    objName: 'GOES-XRAY',
    type: 'Virtual Sensor',
    system: 'GOES',
    operator: 'NOAA',
    lat: 0,
    lon: -100,
    zoom: 1.0,
    hasTelemetry: true
  },

  // --- IONOSONDE SENSORS ---
  'IONOSONDE-Malindi': {
    sensorId: 'IONOSONDE-Malindi',
    uiName: 'Maximum Usable Frequency (MUF(3000)F2)',
    objName: 'Malindi-Ionosonde',
    type: 'Ground Station',
    system: 'IONOSONDE_MUF3000F2', // Updated to unique config key
    operator: 'KSA',
    lat: -2.996,
    lon: 40.113,
    zoom: 0.1,
    hasTelemetry: true
  },
  'IONOSONDE-Malindi-2': {
    sensorId: 'IONOSONDE-Malindi-2',
    uiName: 'Propagation Factor (M(3000)F2)',
    objName: 'Malindi-Ionosonde',
    type: 'Ground Station',
    system: 'IONOSONDE_M3000F2', // Updated to unique config key
    operator: 'KSA',
    lat: -2.996,
    lon: 40.113,
    zoom: 0.1,
    hasTelemetry: true
  },
  'IONOSONDE-Malindi-3': {
    sensorId: 'IONOSONDE-Malindi-3',
    uiName: 'foF2 (F2 Layer Critical Frequency)',
    objName: 'Malindi-Ionosonde',
    type: 'Ground Station',
    system: 'IONOSONDE_FOF2', // Updated to unique config key
    operator: 'KSA',
    lat: -2.996,
    lon: 40.113,
    zoom: 0.1,
    hasTelemetry: true
  },
  'IONOSONDE-Malindi-4': {
    sensorId: 'IONOSONDE-Malindi-4',
    uiName: 'hmF2 (Peak height of the F2 layer)',
    objName: 'Malindi-Ionosonde',
    type: 'Ground Station',
    system: 'IONOSONDE_HMF2', // Updated to unique config key
    operator: 'KSA',
    lat: -2.996,
    lon: 40.113,
    zoom: 0.1,
    hasTelemetry: true
  },
  'IONOSONDE-Malindi-5': {
    sensorId: 'IONOSONDE-Malindi-5',
    uiName: 'foE (E-Layer Critical Frequency)',
    objName: 'Malindi-Ionosonde',
    type: 'Ground Station',
    system: 'IONOSONDE_FOE', // Updated to unique config key
    operator: 'KSA',
    lat: -2.996,
    lon: 40.113,
    zoom: 0.1,
    hasTelemetry: true
  },
  'IONOSONDE-Malindi-6': {
    sensorId: 'IONOSONDE-Malindi-6',
    uiName: 'foF1 (F1-Layer Critical Frequency)',
    objName: 'Malindi-Ionosonde',
    type: 'Ground Station',
    system: 'IONOSONDE_FOF1', // Updated to unique config key
    operator: 'KSA',
    lat: -2.996,
    lon: 40.113,
    zoom: 0.1,
    hasTelemetry: true
  },
  'IONOSONDE-Malindi-7': {
    sensorId: 'IONOSONDE-Malindi-7',
    uiName: 'hmE (E-Layer Peak Height)',
    objName: 'Malindi-Ionosonde',
    type: 'Ground Station',
    system: 'IONOSONDE_HME', // Added missing hmE config
    operator: 'KSA',
    lat: -2.996,
    lon: 40.113,
    zoom: 0.1,
    hasTelemetry: true
  }
};