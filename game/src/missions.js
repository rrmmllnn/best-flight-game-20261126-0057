// The three sorties. Same island, same Kestrel, different goals: a gentle
// ring run to learn the plane, a short hop that ends on the far runway, and
// a dusk storm run where the wind and the fuel gauge both fight back.
export const MISSIONS = [
  {
    id: 'ring-run',
    number: 1,
    name: 'Ring Run',
    tagline: 'Learn the Kestrel',
    description:
      'Fly all 10 rings down the valley, then put her down',
    description2:
      'on Coral Bay runway. Generous fuel, calm air — the',
    description3:
      'sortie to learn throttle and turn discipline.',
    rings: 10,
    fuel: 100,
    timeLimit: 420,
    wind: 0,
    dusk: false,
    parTime: 300,
    briefing:
      'Ten rings from Ridge Field to Coral Bay. Fly through the gold ring, ' +
      'watch your fuel, and land on runway B to finish.',
  },
  {
    id: 'island-hop',
    number: 2,
    name: 'Island Hop',
    tagline: 'Six rings, one landing',
    description:
      'A short hop: 6 rings, then a landing at Coral Bay.',
    description2:
      'Less fuel in the tanks, so every ring tops you up —',
    description3:
      'miss too many and you glide home on fumes.',
    rings: 6,
    fuel: 72,
    timeLimit: 300,
    wind: 0.25,
    dusk: false,
    parTime: 210,
    briefing:
      'Six rings, tight fuel. Each ring adds fuel — fly clean and you will ' +
      'have plenty left for the landing at Coral Bay.',
  },
  {
    id: 'storm-ridge',
    number: 3,
    name: 'Storm Ridge',
    tagline: 'Dusk, gusts, 14 rings',
    description:
      'Fourteen rings through a dusk storm. Gusts shove the',
    description2:
      'Kestrel sideways, fuel drops fast, and the last rings',
    description3:
      'sit low over the river. For pilots who own the valley.',
    rings: 14,
    fuel: 88,
    timeLimit: 480,
    wind: 1,
    dusk: true,
    parTime: 360,
    briefing:
      'Fourteen rings in gusting dusk wind. Hold your line, mind the stall ' +
      'speed, and land at Coral Bay before the tanks run dry.',
  },
];

export function missionById(id) {
  return MISSIONS.find((mission) => mission.id === id) ?? MISSIONS[0];
}
