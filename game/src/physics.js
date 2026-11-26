// The Kestrel's flight model: arcade-true, not a simulator. Throttle sets the
// speed, the stick sets bank and pitch, bank turns the nose, and speed is
// life — below stall speed the wing gives up and the nose drops. No DOM,
// no drawing: step() takes an input and a fixed dt and returns event flags.
import { COURSE, PLANE, RING, STEP } from './config.js';
import { courseX, heightAt, runwayAt } from './terrain.js';

export const EVENT_RING = 1;
export const EVENT_CRASH = 2;
export const EVENT_LANDED = 4;
export const EVENT_FUEL = 8;
export const EVENT_TIMEOUT = 16;
export const EVENT_TOUCHDOWN = 32;
export const EVENT_TAKEOFF = 64;

const DEG = Math.PI / 180;

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

function approach(value, target, rate, dt) {
  if (value < target) return Math.min(target, value + rate * dt);
  return Math.max(target, value - rate * dt);
}

/** Heading of the valley at z, so the spawn lines up with the course. */
function courseHeading(z) {
  const ahead = courseX(z + 40);
  const behind = courseX(z - 40);
  return Math.atan2(ahead - behind, 80);
}

export function createFlight(mission, seed) {
  const spawnZ = 300;
  const state = {
    mission,
    seed,
    x: courseX(spawnZ),
    y: 135,
    z: spawnZ,
    heading: courseHeading(spawnZ),
    pitch: 0,
    bank: 0,
    speed: PLANE.cruiseSpeed,
    throttle: 0.62,
    fuel: mission.fuel,
    score: 0,
    ringsHit: 0,
    ringsTotal: mission.rings,
    time: 0,
    timeLeft: mission.timeLimit,
    gearDown: true,
    flaps: false,
    airbrake: false,
    vspeed: 0,
    onGround: false,
    crashed: false,
    crashReason: '',
    landed: false,
    finished: false,
    fuelEmpty: false,
    fuelWarned: false,
    stalled: false,
    windGust: 0,
    message: '',
    messageT: 0,
    distance: 0,
    refuelled: false,
  };
  return state;
}

/**
 * Advance one fixed step. `input` is { pitch, roll, throttleUp, throttleDown,
 * brake } with pitch/roll in [-1, 1]. `world` is { rings, seed, mission }.
 * Returns a bitmask of EVENT_* flags for this step.
 */
export function stepFlight(state, input, dt, world) {
  if (state.crashed || state.finished) return 0;
  let events = 0;
  const mission = state.mission;

  state.time += dt;
  state.timeLeft = mission.timeLimit - state.time;
  if (state.timeLeft <= 0) {
    state.timeLeft = 0;
    state.finished = true;
    return EVENT_TIMEOUT;
  }
  if (state.messageT > 0) state.messageT -= dt;

  // --- wind: gusts shove the plane sideways and rock the wings. ---
  const t = state.time;
  const gust =
    mission.wind * (Math.sin(t * 0.9) * 5.5 + Math.sin(t * 0.37 + 2.1) * 3.5);
  state.windGust = gust;

  // --- throttle and speed. ---
  if (state.fuel > 0) {
    if (input.throttleUp) state.throttle += PLANE.throttleResponse * dt;
    if (input.throttleDown) state.throttle -= PLANE.throttleResponse * dt;
  } else {
    state.throttle = approach(state.throttle, 0, PLANE.throttleResponse, dt);
  }
  state.throttle = clamp(state.throttle, 0, 1);
  const drag =
    (state.flaps ? PLANE.flapDrag : 0) +
    (state.gearDown ? PLANE.gearDrag : 0) +
    (input.brake ? PLANE.brakeDrag : 0);
  const targetSpeed = 18 + state.throttle * (PLANE.maxSpeed - 18);
  const accel = state.speed < targetSpeed ? 13 : 16;
  state.speed = approach(state.speed, targetSpeed, accel, dt);
  state.speed = Math.max(0, state.speed - drag * dt * (state.speed / PLANE.maxSpeed));

  // --- fuel. ---
  if (state.fuel > 0) {
    const burn = PLANE.fuelBurnBase + PLANE.fuelBurnThrottle * state.throttle;
    state.fuel = Math.max(0, state.fuel - burn * dt * (state.flaps ? 1.15 : 1));
    if (state.fuel <= 0) {
      state.fuelEmpty = true;
      events |= EVENT_FUEL;
      state.message = 'FUEL EMPTY — gliding. Find a runway!';
      state.messageT = 5;
    } else if (state.fuel < 20 && !state.fuelWarned) {
      state.fuelWarned = true;
      state.message = 'LOW FUEL — each ring tops up the tanks';
      state.messageT = 4;
    }
  }

  // --- bank, pitch and the stall. ---
  const bankTarget = input.roll * PLANE.maxBank * DEG;
  state.bank = approach(state.bank, bankTarget, PLANE.bankRate, dt);
  const stalled = state.speed < PLANE.stallSpeed;
  state.stalled = stalled;
  let pitchTarget = input.pitch * (input.pitch > 0 ? PLANE.maxPitchUp : PLANE.maxPitchDown) * DEG;
  if (stalled) pitchTarget = Math.min(pitchTarget, -9 * DEG);
  state.pitch = approach(state.pitch, pitchTarget, PLANE.pitchRate, dt);
  if (mission.wind > 0) state.bank += Math.sin(t * 1.31) * 0.012 * mission.wind;

  // --- turn: bank rolls the lift vector, so the nose follows the bank. ---
  const turnRate = (9.81 * Math.tan(state.bank)) / Math.max(state.speed, 24);
  state.heading += turnRate * dt;

  // --- climb, sink and the ground. ---
  const sink = stalled ? 9 : 0.6;
  state.vspeed = state.speed * Math.sin(state.pitch) - sink;
  const groundY = heightAt(state.x, state.z, state.seed);

  if (state.onGround) {
    state.y = groundY + 1.2;
    state.vspeed = 0;
    state.speed = Math.max(0, state.speed - 13 * dt);
    state.heading += input.roll * 0.35 * dt * (state.speed / 40);
    // Rotate for take-off once there is enough air over the wing.
    if (state.speed > 38 && input.pitch > 0.35) {
      state.onGround = false;
      state.y += 2;
      events |= EVENT_TAKEOFF;
      state.message = 'Airborne!';
      state.messageT = 2.5;
    }
    if (state.speed < 2 && !state.refuelled && state.ringsHit < state.ringsTotal) {
      state.refuelled = true;
      state.fuel = 100;
      events |= EVENT_TOUCHDOWN;
      state.message = 'Refuelled on the runway — throttle up and go again';
      state.messageT = 4;
    }
  } else {
    const horizontal = state.speed * Math.cos(state.pitch);
    state.x += Math.sin(state.heading) * horizontal * dt + gust * dt;
    state.z += Math.cos(state.heading) * horizontal * dt;
    state.y += state.vspeed * dt;
    state.distance += state.speed * dt;
    state.score += state.speed * dt * 0.02;
  }

  // --- rings: only the next gold ring counts. ---
  const rings = world.rings;
  if (state.ringsHit < rings.length) {
    const ring = rings[state.ringsHit];
    const dz = state.z - ring.z;
    if (Math.abs(dz) < RING.passWindow) {
      const dx = state.x - ring.x;
      const dy = state.y - ring.y;
      if (Math.sqrt(dx * dx + dy * dy) < ring.r) {
        ring.passed = true;
        state.ringsHit += 1;
        state.score += PLANE.ringPoints;
        state.fuel = Math.min(100, state.fuel + PLANE.ringFuel);
        events |= EVENT_RING;
        state.message =
          state.ringsHit >= state.ringsTotal
            ? 'All rings! Land on Coral Bay runway B'
            : `Ring ${state.ringsHit} of ${state.ringsTotal} — +${PLANE.ringPoints} pts, +fuel`;
        state.messageT = 3;
      }
    }
  }

  // --- the ground arrives. ---
  if (!state.onGround && state.y <= groundY + 1.2) {
    const runway = runwayAt(state.x, state.z);
    const gentle = state.vspeed >= -PLANE.softTouchdown;
    const hard = state.vspeed < -PLANE.hardTouchdown;
    const slowEnough = state.speed < PLANE.landingSpeed;
    const level = Math.abs(state.bank) < 0.4;
    if (runway && gentle && slowEnough && level) {
      if (!state.gearDown) {
        return crash(state, 'Belly landing — the gear was up', events);
      }
      state.onGround = true;
      state.y = groundY + 1.2;
      state.refuelled = false;
      events |= EVENT_TOUCHDOWN;
      if (state.ringsHit >= state.ringsTotal) {
        state.landed = true;
        state.finished = true;
        state.score += PLANE.landingPoints;
        const timeBonus = Math.max(0, Math.round((mission.parTime - state.time) * 2));
        state.score += timeBonus;
        state.timeBonus = timeBonus;
        state.message = `Landed clean on runway ${runway} — mission complete!`;
        state.messageT = 6;
        return events | EVENT_LANDED;
      }
      state.message = `Down on runway ${runway} — refuelling…`;
      state.messageT = 3;
      return events;
    }
    if (runway && !gentle && !hard) {
      return crash(state, 'Bounced landing — too fast a descent', events);
    }
    if (runway && hard) {
      return crash(state, 'Hard landing — the gear collapsed', events);
    }
    if (runway && !slowEnough) {
      return crash(state, 'Too fast to land — ran off the runway', events);
    }
    if (groundY <= COURSE.waterLevel + 0.6) {
      return crash(state, 'Ditched in the river', events);
    }
    return crash(state, stalled ? 'Stalled into the ridge' : 'Flew into the ridge', events);
  }

  // --- the course ends past runway B: turn back or land. ---
  if (state.z > COURSE.length + 600) {
    state.message = 'Past Coral Bay — turn around and land on runway B';
    state.messageT = 2;
  }
  return events;
}

function crash(state, reason, events) {
  state.crashed = true;
  state.crashReason = reason;
  state.speed = 0;
  state.vspeed = 0;
  return events | EVENT_CRASH;
}

/** Fresh flight state for a mission, used by the game and the screenshot pilot. */
export function resetFlight(mission, seed) {
  return createFlight(mission, seed);
}

export { STEP };
