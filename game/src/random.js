// Seeded randomness: a small mulberry32 generator plus value noise, so the
// terrain, clouds, trees and ring jitter are the same for the same seed.
// Nothing here touches the DOM, so the physics and the renderer share it.

/** A fast seeded PRNG returning floats in [0, 1). */
export function createRandom(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic integer hash of a 2D lattice point, in [0, 1). */
function hash2(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 974634211) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

/** Smooth value noise over the XZ plane, in roughly [-1, 1]. */
export function valueNoise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  const u = smooth(fx);
  const v = smooth(fz);
  const top = a + (b - a) * u;
  const bottom = c + (d - c) * u;
  return (top + (bottom - top) * v) * 2 - 1;
}

/** Fractal noise: three octaves of value noise, in roughly [-1, 1]. */
export function fbm(x, z, seed) {
  let total = 0;
  let amp = 0.55;
  let freq = 1;
  for (let octave = 0; octave < 3; octave += 1) {
    total += valueNoise(x * freq, z * freq, seed + octave * 101) * amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return total;
}

/** Pick one of `items` using `random`, weighted equally. */
export function pick(random, items) {
  return items[Math.floor(random() * items.length)];
}
