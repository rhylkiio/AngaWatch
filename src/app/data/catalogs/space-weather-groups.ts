export interface SpaceWeatherGroup {
  name: string;
  header: string;
  list: string[];
  topLink?: { name: string; badge: string };
}

export const spaceWeatherGroups: SpaceWeatherGroup[] = [
  {
    name: 'TART',
    header: 'TART Radio Telescopes',
    list: ['TART-Kenya'],
    topLink: {
      name: 'Active TART Stations',
      badge: '1 Online'
    }
  },
  {
    name: 'GOES',
    header: 'GOES Solar Monitors',
    list: ['GOES-XRAY'],
    topLink: {
      name: 'Active GOES Satellites',
      badge: '2 Online'
    }
  },
  {
    name: 'IONOSONDE',
    header: 'Ionospheric Monitors',
    list: [
      'IONOSONDE-Malindi',
      'IONOSONDE-Malindi-2',
      'IONOSONDE-Malindi-3',
      'IONOSONDE-Malindi-4',
      'IONOSONDE-Malindi-5',
      'IONOSONDE-Malindi-6',
      'IONOSONDE-Malindi-7' // Added hmE
    ],
    topLink: {
      name: 'Active Ionosondes',
      badge: '7 Online'
    }
  }
];