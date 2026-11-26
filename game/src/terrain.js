// The island of Kestrel Ridge: one valley course, two runways, a river and
// the ring course. heightAt is the single source of truth — the physics
// crashes into it and the renderer paints it, so the two can never disagree.
import { COURSE, RING } from './config.js';
import { createRandom, fbm } from './random.js';

/** The centre line of the valley, wandering gently as z grows. */
export function courseX(z) {
  return 170 * Math.sin(z * 0.0006) + 55 * Math.sin(z * 0.0013 + 1.7);
}

/** The river runs parallel to the course, a few hundred metres to the west. */
export function riverX(z) {
  return courseX(z) - 300 + 40 * Math.sin(z * 0.0011 + 0.6);
}

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Height of the ground, in metres, at world (x, z). Seed fixes the island. */
export function heightAt(x, z, seed) {
  const cx = courseX(z);
  const dx = Math.abs(x - cx);
  // Rolling hills grow with distance from the valley centre.
  const hills = fbm(x * 0.0035, z * 0.0035, seed) * 40 + fbm(x * 0.011, z * 0.011, seed + 7) * 12;
  const rise = smoothstep(220, 700, dx) * 80;
  let height = COURSE.valleyHeight + hills * 0.35 + rise;
  // The valley floor itself is gentle and flat enough to fly low over.
  height = height * smoothstep(60, 260, dx) + COURSE.valleyHeight * (1 - smoothstep(60, 260, dx));
  // The river carves a shallow channel.
  const riverDip = 1 - smoothstep(0, 55, Math.abs(x - riverX(z)));
  height -= riverDip * 7;
  // Both runways sit on flattened, levelled ground.
  for (const runway of [COURSE.runwayA, COURSE.runwayB]) {
    const rcx = courseX((runway.z0 + runway.z1) / 2);
    const inZ = smoothstep(runway.z0 - 160, runway.z0, z) * (1 - smoothstep(runway.z1, runway.z1 + 160, z));
    const inX = 1 - smoothstep(runway.width / 2 + 30, runway.width / 2 + 170, Math.abs(x - rcx));
    const flat = inZ * inX;
    height = height * (1 - flat) + COURSE.valleyHeight * flat;
  }
  return Math.max(1.5, height);
}

/** Is (x, z) on a runway strip? Returns 'A', 'B' or null. */
export function runwayAt(x, z) {
  for (const [name, runway] of [['A', COURSE.runwayA], ['B', COURSE.runwayB]]) {
    const rcx = courseX((runway.z0 + runway.z1) / 2);
    if (z >= runway.z0 && z <= runway.z1 && Math.abs(x - rcx) <= runway.width / 2) return name;
  }
  return null;
}

/** Centre of a runway, for spawn points and the guidance arrow. */
export function runwayCentre(name) {
  const runway = name === 'B' ? COURSE.runwayB : COURSE.runwayA;
  return { x: courseX((runway.z0 + runway.z1) / 2), z: (runway.z0 + runway.z1) / 2 };
}

/** Build the ring course for a mission: rings follow the valley, rising and
 *  falling so the pilot climbs, dives and banks the whole way down. The
 *  lateral offsets walk gently from ring to ring, so the course flows
 *  instead of zig-zagging — a pilot can actually thread it. */
export function buildRings(mission, seed) {
  const random = createRandom(seed * 31 + mission.rings * 7 + 13);
  const rings = [];
  const firstZ = 650;
  const lastZ = 5350;
  let lateral = 0;
  for (let index = 0; index < mission.rings; index += 1) {
    const t = mission.rings === 1 ? 0 : index / (mission.rings - 1);
    const z = firstZ + (lastZ - firstZ) * t + (random() - 0.5) * 120;
    lateral = Math.max(-120, Math.min(120, lateral + (random() - 0.5) * 170));
    const x = courseX(z) + lateral;
    const ground = heightAt(x, z, seed);
    const y = Math.max(ground + 50, 85 + random() * 55 + Math.sin(t * Math.PI * 2.2) * 20);
    rings.push({ x, y, z, r: RING.radius, passed: false, index });
  }
  return rings;
}

/** Fixed cloud positions for a seed: big soft billboards high over the valley. */
export function buildClouds(seed, count = 26) {
  const random = createRandom(seed * 17 + 5);
  const clouds = [];
  for (let index = 0; index < count; index += 1) {
    clouds.push({
      x: courseX(3000) + (random() - 0.5) * 2600,
      y: 260 + random() * 110,
      z: random() * 6800 - 400,
      scale: 70 + random() * 110,
      drift: 0.6 + random() * 1.4,
    });
  }
  return clouds;
}

/** Fixed tree positions: clumps on the valley sides, never on a runway. */
export function buildTrees(seed, count = 260) {
  const random = createRandom(seed * 23 + 11);
  const trees = [];
  for (let index = 0; index < count; index += 1) {
    const z = random() * 6400 - 300;
    const side = random() < 0.5 ? -1 : 1;
    const x = courseX(z) + side * (150 + random() * 420);
    if (runwayAt(x, z)) continue;
    trees.push({ x, y: heightAt(x, z, seed), z, size: 7 + random() * 9, shade: random() });
  }
  return trees;
}

/** Two far ridge silhouettes for the horizon, drawn before the terrain. */
export function ridgeHeight(angle, layer, seed) {
  // angle is the compass bearing in radians; ridges are pure horizon dressing.
  const wobble = fbm(Math.cos(angle) * 2.2 + layer * 9, Math.sin(angle) * 2.2, seed + layer * 53);
  return 0.16 + wobble * 0.07 + layer * 0.05;
}
