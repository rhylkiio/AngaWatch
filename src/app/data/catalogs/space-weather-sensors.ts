export const spaceWeatherSensors: Record<string, any> = {
  'TART-Kenya': {
    sensorId: 'TART-Kenya',
    uiName: 'TART Radio Telescope',
    objName: 'TART-Kenya',
    type: 'Ground Station',
    system: 'TART',
    operator: 'TUK',
    lat: -1.286389, // Latitude for Nairobi, Kenya
    lon: 36.817223,  // Longitude for Nairobi, Kenya
    zoom: 0.1,
    pluginIconId: 'tart-srb-monitor-bottom-icon', // Matches bottomIconElementName in tart-srb-status.ts
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
    lon: -137.2, // GOES West geostationary position
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
    lon: -89.5, // Current checkout position (will eventually replace GOES-16 at -75.2)
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
  'IONOSONDE-Malindi': {
    sensorId: 'IONOSONDE-Malindi',
    uiName: 'Malindi Ionosonde (ML10L)',
    objName: 'Malindi-Ionosonde',
    type: 'Ground Station',
    system: 'Ionosonde',
    operator: 'SANSA/TUK',
    lat: -2.996, // Approximate Malindi coordinates
    lon: 40.113,
    zoom: 0.1,
    hasTelemetry: true // This triggers the 📈 icon to appear
  }
};