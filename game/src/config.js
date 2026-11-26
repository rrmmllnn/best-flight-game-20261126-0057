// Kestrel Ridge — tuning, palette and constants in one place.
// The playfield is a fixed 1280x720 logical area; the renderer scales it to
// the window, so no rule below depends on the screen size.
export const FIELD = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second. */
export const STEP = 1 / 60;

/** How far ahead the camera looks, in metres, for terrain and rings. */
export const VIEW_DISTANCE = 760;

/** Field of view of the chase camera, in degrees. */
export const FOV_DEGREES = 68;

/** The aircraft: a single-engine prop tourer, the Kestrel K-7. */
export const PLANE = {
  /** Top speed at full throttle, m/s. */
  maxSpeed: 108,
  /** Speed below which the wing stops flying, m/s. */
  stallSpeed: 34,
  /** Cruise speed the autopilot and the trim aim for, m/s. */
  cruiseSpeed: 62,
  /** How fast the engine answers the throttle, per second. */
  throttleResponse: 0.55,
  /** Maximum bank angle, degrees. */
  maxBank: 58,
  /** Maximum pitch up / down, degrees. */
  maxPitchUp: 24,
  maxPitchDown: 20,
  /** How quickly the bank follows the stick, per second. */
  bankRate: 2.4,
  /** How quickly the pitch follows the stick, per second. */
  pitchRate: 1.6,
  /** Drag added by flaps, gear and the airbrake. */
  flapDrag: 9,
  gearDrag: 5,
  brakeDrag: 22,
  /** Fuel burn: base litres-ish per second plus throttle share. */
  fuelBurnBase: 0.09,
  fuelBurnThrottle: 0.14,
  /** Fuel topped up by each ring flown through. */
  ringFuel: 3,
  /** Points for a ring, a landing and the time bonus. */
  ringPoints: 100,
  landingPoints: 500,
  /** Vertical speed that still counts as a gentle touchdown, m/s. */
  softTouchdown: 4.5,
  /** Vertical speed that breaks the landing gear, m/s. */
  hardTouchdown: 9,
  /** Landing speed ceiling, m/s. */
  landingSpeed: 58,
};

export const RING = {
  /** Radius of a target ring, metres. */
  radius: 26,
  /** How close, in metres along the course, a pass counts. */
  passWindow: 30,
};

/** Course geometry, in metres. North is +Z, east is +X, up is +Y. */
export const COURSE = {
  length: 6200,
  runwayA: { z0: -220, z1: 260, width: 48 },
  runwayB: { z0: 5580, z1: 6060, width: 48 },
  waterLevel: 4,
  /** The valley floor the course follows stays near this height. */
  valleyHeight: 10,
};

export const PALETTE = {
  skyTop: '#2f6fb4',
  skyMid: '#7db4dd',
  skyLow: '#cfe6f2',
  duskTop: '#3a2d63',
  duskMid: '#c96f4a',
  duskLow: '#f2b879',
  sun: '#fff3c4',
  groundLow: '#5d8a4a',
  groundMid: '#4a7a3e',
  groundHigh: '#6b7a5e',
  rock: '#8a8378',
  snow: '#e8eef2',
  sand: '#c9b183',
  water: '#3f7fb8',
  river: '#4a90c4',
  runway: '#3c3f45',
  runwayMark: '#f2f2e8',
  ringNext: '#ffb400',
  ringLater: '#37c8e8',
  ringDone: '#7ddb8a',
  hudPanel: 'rgba(8, 18, 28, 0.72)',
  hudLine: 'rgba(140, 220, 255, 0.85)',
  hudText: '#dff4ff',
  hudAmber: '#ffb400',
  hudRed: '#ff5a4e',
  hudGreen: '#7ddb8a',
  planeBody: '#e8542f',
  planeWing: '#f4f1e6',
  planeTrim: '#1d3557',
  panel: 'rgba(10, 16, 24, 0.82)',
  text: '#eef4f8',
  muted: '#9fb4c4',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the best score is kept between visits (this browser only). */
export const BEST_KEY = 'kestrel-ridge.best';
/** Where the last chosen mission is kept between visits. */
export const MISSION_KEY = 'kestrel-ridge.mission';
