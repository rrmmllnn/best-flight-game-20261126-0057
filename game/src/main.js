// Boot and the one loop: input is read every frame, the flight advances in
// fixed 1/60 s steps (several in a slow frame, none in a fast one), and the
// renderer paints what is there. The game moves between five screens: the
// mission list, play, paused, mission complete and crashed / time up.
// ?seed=N fixes the island. ?shot=start|play|end (with &seed=N) stages that
// scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot.
import { BEST_KEY, FIELD, MISSION_KEY, STEP } from './config.js';
import { buildClouds, buildRings, buildTrees } from './terrain.js';
import { MISSIONS, missionById } from './missions.js';
import {
  createFlight,
  stepFlight,
  EVENT_CRASH,
  EVENT_FUEL,
  EVENT_LANDED,
  EVENT_RING,
  EVENT_TIMEOUT,
  EVENT_TOUCHDOWN,
} from './physics.js';
import {
  ACTION_CONFIRM,
  ACTION_FLAPS,
  ACTION_GEAR,
  ACTION_MISSION_1,
  ACTION_MISSION_2,
  ACTION_MISSION_3,
  ACTION_MUTE,
  ACTION_PAUSE,
  createInput,
} from './input.js';
import { createAudio } from './audio.js';
import {
  createRenderer,
  SCREEN_OVER,
  SCREEN_PAUSED,
  SCREEN_PLAY,
  SCREEN_TITLE,
  SCREEN_WIN,
} from './render.js';
import { autopilot, stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall is dropped. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);
const missionParam = params.get('mission');
const startMission = missionParam ? missionById(missionParam) : MISSIONS[0];

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const audio = createAudio();
const renderer = createRenderer(canvas);

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best then lasts this visit only.
  }
}

function readMission() {
  try {
    return missionById(window.localStorage.getItem(MISSION_KEY) ?? '') ?? MISSIONS[0];
  } catch {
    return MISSIONS[0];
  }
}

function saveMission(mission) {
  try {
    window.localStorage.setItem(MISSION_KEY, mission.id);
  } catch {
    // Ignore.
  }
}

function buildWorld(mission) {
  const rings = buildRings(mission, seed);
  return {
    mission,
    rings,
    clouds: buildClouds(seed),
    trees: buildTrees(seed),
    seed,
    world: { rings, seed, mission },
  };
}

function runShot(name) {
  const mission = startMission;
  const built = buildWorld(mission);
  const flight = createFlight(mission, seed);
  const scene = stageShot(name, flight, built.rings, built.world);
  let painted = 0;
  function paint() {
    renderer.draw({
      flight,
      rings: built.rings,
      clouds: built.clouds,
      trees: built.trees,
      seed,
      mission,
      missions: MISSIONS,
      selected: missionParam ? MISSIONS.indexOf(mission) : 0,
      screen: scene.screen,
      best: Math.max(scene.best, readBest()),
      time: flight.time,
      braking: false,
    });
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let best = readBest();
  let selected = MISSIONS.indexOf(readMission());
  let built = buildWorld(MISSIONS[selected]);
  let flight = createFlight(built.mission, seed);
  let accumulator = 0;
  let last = performance.now();
  let braking = false;

  // Screen readers (and anyone watching the page's text) hear the screen
  // changes and each ring.
  function announce(message) {
    status.textContent = message;
  }

  function startMission(index) {
    selected = index;
    saveMission(MISSIONS[selected]);
    built = buildWorld(MISSIONS[selected]);
    flight = createFlight(built.mission, seed);
    accumulator = 0;
    screen = SCREEN_PLAY;
    audio.start();
    audio.click();
    announce(`Flying ${built.mission.name}. ${built.mission.briefing}`);
  }

  function endFlight(win) {
    screen = win ? SCREEN_WIN : SCREEN_OVER;
    if (Math.round(flight.score) > best) {
      best = Math.round(flight.score);
      saveBest(best);
    }
    announce(
      win
        ? `Mission complete. Score ${Math.round(flight.score)}. Best ${best}.`
        : `Sortie over. Score ${Math.round(flight.score)}. Best ${best}.`,
    );
  }

  /** Which mission card, if any, a client-pixel click lands on. */
  function missionCardAt(clientX, clientY) {
    const scale = Math.min(window.innerWidth / FIELD.width, window.innerHeight / FIELD.height);
    const offsetX = (window.innerWidth - FIELD.width * scale) / 2;
    const offsetY = (window.innerHeight - FIELD.height * scale) / 2;
    const x = (clientX - offsetX) / scale;
    const y = (clientY - offsetY) / scale;
    const cards = renderer.missionCards(MISSIONS);
    for (let i = 0; i < cards.length; i += 1) {
      const card = cards[i];
      if (x >= card.x && x <= card.x + card.w && y >= card.y && y <= card.y + card.h) return i;
    }
    return -1;
  }

  function backToMenu() {
    built = buildWorld(MISSIONS[selected]);
    flight = createFlight(built.mission, seed);
    screen = SCREEN_TITLE;
    announce('Kestrel Ridge. Pick a sortie.');
  }

  function handleActions() {
    const actions = input.takeActions();
    const click = input.takeClick();
    if (actions & ACTION_MUTE) {
      audio.setMuted(!audio.isMuted());
      return;
    }
    if (actions & ACTION_MISSION_1) startMission(0);
    else if (actions & ACTION_MISSION_2) startMission(1);
    else if (actions & ACTION_MISSION_3) startMission(2);
    if (screen === SCREEN_TITLE) {
      // A click on a mission card flies that sortie straight away.
      if (click) {
        const picked = missionCardAt(click.x, click.y);
        if (picked >= 0) {
          startMission(picked);
          return;
        }
      }
      if (actions & ACTION_CONFIRM) startMission(selected);
      return;
    }
    if (screen === SCREEN_OVER || screen === SCREEN_WIN) {
      if (actions & ACTION_CONFIRM) startMission(selected);
      else if (actions & ACTION_PAUSE) backToMenu();
      return;
    }
    if (actions & ACTION_PAUSE) {
      if (screen === SCREEN_PLAY) {
        screen = SCREEN_PAUSED;
        announce('Paused.');
      } else if (screen === SCREEN_PAUSED) {
        screen = SCREEN_PLAY;
        announce('Flying.');
      }
      return;
    }
    if (screen !== SCREEN_PLAY) return;
    if (actions & ACTION_GEAR) {
      flight.gearDown = !flight.gearDown;
      announce(flight.gearDown ? 'Gear down.' : 'Gear up.');
      audio.click();
    }
    if (actions & ACTION_FLAPS) {
      flight.flaps = !flight.flaps;
      announce(flight.flaps ? 'Flaps down.' : 'Flaps up.');
      audio.click();
    }
  }

  function step() {
    const stick = input.stick();
    braking = input.brake();
    const events = stepFlight(
      flight,
      {
        pitch: stick.pitch,
        roll: stick.roll,
        throttleUp: input.throttleUp(),
        throttleDown: input.throttleDown(),
        brake: braking,
      },
      STEP,
      built.world,
    );
    if (events & EVENT_RING) {
      audio.ring();
      announce(`Ring ${flight.ringsHit} of ${flight.ringsTotal}. Score ${Math.round(flight.score)}.`);
    }
    if (events & EVENT_TOUCHDOWN) audio.land();
    if (events & EVENT_FUEL) audio.warning();
    if (events & EVENT_LANDED) {
      audio.land();
      endFlight(true);
    } else if (events & EVENT_CRASH) {
      audio.crash();
      endFlight(false);
    } else if (events & EVENT_TIMEOUT) {
      endFlight(false);
    }
    audio.setFlight(flight.throttle, flight.speed, !flight.onGround);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (screen === SCREEN_PLAY) {
      while (accumulator >= STEP && screen === SCREEN_PLAY) {
        step();
        accumulator -= STEP;
      }
    } else {
      // The title screen keeps the valley alive behind the menu: the
      // autopilot flies the course, and a finished flight restarts.
      while (accumulator >= STEP && screen === SCREEN_TITLE) {
        if (flight.crashed || flight.finished) {
          flight = createFlight(built.mission, seed);
        }
        stepFlight(flight, autopilot(flight, built.rings), STEP, built.world);
        accumulator -= STEP;
      }
      accumulator = 0;
    }
    renderer.draw({
      flight,
      rings: built.rings,
      clouds: built.clouds,
      trees: built.trees,
      seed,
      mission: built.mission,
      missions: MISSIONS,
      selected,
      screen,
      best,
      time: flight.time,
      braking,
    });
  }

  // Leaving the tab pauses a running game rather than letting fuel burn unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Kestrel Ridge. Pick a sortie and press Enter to fly.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
