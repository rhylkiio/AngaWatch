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
    list: ['TART-Kenya'], // You can add 'TART-South-Africa', etc., here later
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
    list: ['IONOSONDE-Malindi'],
    topLink: {
      name: 'Active Ionosondes',
      badge: '1 Online'
    }
  }
];