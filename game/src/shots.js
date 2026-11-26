// The screenshot scenes behind ?shot=start|play|end. Each one plays the real
// rules forward from a fresh flight for a fixed number of steps, steered by a
// simple autopilot — bank toward the next ring, pitch toward its height,
// throttle steady — so the frame is what a short game really looks like and
// the same seed always gives the same frame.
import { STEP } from './config.js';
import { stepFlight, createFlight, EVENT_CRASH, EVENT_LANDED } from './physics.js';
import { runwayCentre } from './terrain.js';
import { SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WIN } from './render.js';

const START_SECONDS = 6;
const PLAY_SECONDS = 34;
const END_LIMIT_SECONDS = 600;

/** Steer toward the next ring: bank for its bearing, pitch for its height.
 *  Once the rings are done, steer for Coral Bay runway B and come down:
 *  level off at 14 m on final, slow below landing speed, and let the
 *  runway arrive under the wheels. */
export function autopilot(flight, rings) {
  let target;
  let final = false;
  if (flight.ringsHit >= rings.length) {
    const centre = runwayCentre('B');
    const distToRunway = Math.hypot(centre.x - flight.x, centre.z - 400 - flight.z);
    final = distToRunway < 900;
    // On final, aim 250 m ahead down the centreline at 11.5 m — a shallow
    // descent that puts the wheels on the strip, not a fixed point that
    // the plane would turn back for once it flies past it.
    target = final
      ? { x: centre.x, y: 11.5, z: flight.z + 250 }
      : { x: centre.x, y: 42, z: centre.z - 400 };
  } else {
    target = rings[flight.ringsHit];
  }
  const dx = target.x - flight.x;
  const dz = target.z - flight.z;
  const dy = target.y - flight.y;
  const bearing = Math.atan2(dx, dz);
  let rel = bearing - flight.heading;
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;
  const dist = Math.hypot(dx, dz);
  let roll = Math.max(-1, Math.min(1, rel * 3.0));
  if (final) roll *= clamp(dist / 300, 0.25, 1);
  const wantPitch = Math.max(-0.6, Math.min(0.7, (dy / Math.max(dist, 60)) * 2.0));
  const pitch = Math.max(-1, Math.min(1, wantPitch * 2.4));
  const cruise = final ? 46 : 56;
  const throttleUp = flight.speed < cruise - 4;
  const throttleDown = flight.speed > cruise + 6;
  const brake = final && flight.speed > 50 && dist < 350;
  return { pitch, roll, throttleUp, throttleDown, brake };
}

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

/**
 * Set the flight to the named scene (start, play or end; any other name is
 * start) and return the screen to draw over it and the best score to show.
 */
export function stageShot(name, flight, rings, world) {
  if (name !== 'play' && name !== 'end') {
    for (let index = 0; index < START_SECONDS / STEP; index += 1) {
      stepFlight(flight, { pitch: 0, roll: 0, throttleUp: false, throttleDown: false, brake: false }, STEP, world);
    }
    return { screen: SCREEN_TITLE, best: 0 };
  }
  const limit = name === 'end' ? END_LIMIT_SECONDS : PLAY_SECONDS;
  for (let index = 0; index < limit / STEP; index += 1) {
    const input = autopilot(flight, rings);
    const events = stepFlight(flight, input, STEP, world);
    if (name === 'play') {
      if (events & EVENT_CRASH) break;
    } else if (events & (EVENT_CRASH | EVENT_LANDED)) {
      break;
    }
  }
  if (name === 'play') {
    return { screen: SCREEN_PLAY, best: Math.round(flight.score) };
  }
  const over = flight.crashed || flight.finished;
  return { screen: flight.landed ? SCREEN_WIN : SCREEN_OVER, best: Math.round(flight.score), over };
}

export { createFlight };
