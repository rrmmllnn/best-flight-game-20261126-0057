// Drawing only: the flight state and the current screen in, pixels out.
// A real chase camera with a 3D projection: the island is a heightfield the
// renderer paints far-to-near, the Kestrel is drawn in frame, and the bottom
// of the screen carries lit instruments — airspeed, altitude, heading,
// artificial horizon, throttle and fuel — so the screenshots read as a
// flight game at a glance.
import { COURSE, FIELD, FONT, PALETTE, RING, VIEW_DISTANCE, FOV_DEGREES } from './config.js';
import { courseX, heightAt, ridgeHeight, riverX, runwayAt } from './terrain.js';
import { valueNoise } from './random.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_WIN = 'win';

const DEG = Math.PI / 180;

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function rgb(r, g, b, shade = 1, alpha = 1) {
  const cr = clamp(Math.round(r * shade), 0, 255);
  const cg = clamp(Math.round(g * shade), 0, 255);
  const cb = clamp(Math.round(b * shade), 0, 255);
  return alpha >= 1 ? `rgb(${cr},${cg},${cb})` : `rgba(${cr},${cg},${cb},${alpha})`;
}

function formatTime(seconds) {
  const total = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
}

function knots(speedMs) {
  return Math.round(speedMs * 1.944);
}

function feet(altM) {
  return Math.round(altM * 3.281);
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const focal = FIELD.height / 2 / Math.tan((FOV_DEGREES / 2) * DEG);
  const cx = FIELD.width / 2;
  const cy = FIELD.height / 2;

  // Camera state, rebuilt every frame from the flight state.
  const cam = {
    x: 0, y: 0, z: 0,
    heading: 0, pitch: 0,
    sinH: 0, cosH: 1, sinP: 0, cosP: 1,
  };

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
  }

  window.addEventListener('resize', resize);
  resize();

  const fonts = new Map();
  function text(value, x, y, size, color, align = 'left', weight = '') {
    const key = `${weight}${size}`;
    if (!fonts.has(key)) fonts.set(key, `${weight} ${size}px ${FONT}`.trim());
    context.font = fonts.get(key);
    context.fillStyle = color;
    context.textAlign = align;
    context.textBaseline = 'alphabetic';
    context.fillText(value, x, y);
  }

  /** Project a world point into screen space; null when behind the camera. */
  function project(wx, wy, wz) {
    const dx = wx - cam.x;
    const dy = wy - cam.y;
    const dz = wz - cam.z;
    const x1 = dx * cam.cosH - dz * cam.sinH;
    const z1 = dx * cam.sinH + dz * cam.cosH;
    if (z1 < 2) return null;
    const y1 = dy * cam.cosP - z1 * cam.sinP;
    const z2 = dy * cam.sinP + z1 * cam.cosP;
    if (z2 < 2) return null;
    return { x: cx + (x1 / z2) * focal, y: cy - (y1 / z2) * focal, d: z2, s: focal / z2 };
  }

  function setupCamera(flight) {
    const fx = Math.sin(flight.heading);
    const fz = Math.cos(flight.heading);
    cam.x = flight.x - fx * 13;
    cam.z = flight.z - fz * 13;
    cam.y = flight.y + 4.4;
    if (flight.onGround) cam.y = flight.y + 4.6;
    cam.heading = flight.heading;
    cam.pitch = clamp(flight.pitch * 0.55, -0.32, 0.32);
    cam.sinH = Math.sin(cam.heading);
    cam.cosH = Math.cos(cam.heading);
    cam.sinP = Math.sin(cam.pitch);
    cam.cosP = Math.cos(cam.pitch);
  }

  function drawSky(flight, dusk) {
    const grad = context.createLinearGradient(0, 0, 0, FIELD.height * 0.62);
    if (dusk) {
      grad.addColorStop(0, PALETTE.duskTop);
      grad.addColorStop(0.55, PALETTE.duskMid);
      grad.addColorStop(1, PALETTE.duskLow);
    } else {
      grad.addColorStop(0, PALETTE.skyTop);
      grad.addColorStop(0.55, PALETTE.skyMid);
      grad.addColorStop(1, PALETTE.skyLow);
    }
    context.fillStyle = grad;
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    // The sun hangs low to the west, so the light has a direction.
    const sunBearing = -1.15;
    const sunPoint = project(
      cam.x + Math.sin(sunBearing) * 4200,
      cam.y + 620,
      cam.z + Math.cos(sunBearing) * 4200,
    );
    if (sunPoint) {
      const glow = context.createRadialGradient(sunPoint.x, sunPoint.y, 4, sunPoint.x, sunPoint.y, 90);
      glow.addColorStop(0, 'rgba(255, 243, 196, 0.95)');
      glow.addColorStop(0.25, 'rgba(255, 220, 140, 0.55)');
      glow.addColorStop(1, 'rgba(255, 220, 140, 0)');
      context.fillStyle = glow;
      context.fillRect(sunPoint.x - 95, sunPoint.y - 95, 190, 190);
      context.fillStyle = PALETTE.sun;
      context.beginPath();
      context.arc(sunPoint.x, sunPoint.y, 22, 0, Math.PI * 2);
      context.fill();
    }
  }

  function drawRidges(flight, seed, dusk) {
    const horizonY = cy + Math.tan(cam.pitch) * focal;
    for (let layer = 0; layer < 2; layer += 1) {
      const base = horizonY + layer * 26;
      const color = dusk
        ? layer === 0 ? 'rgba(74, 52, 96, 0.9)' : 'rgba(52, 40, 78, 0.95)'
        : layer === 0 ? 'rgba(96, 122, 158, 0.75)' : 'rgba(70, 96, 128, 0.9)';
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(0, FIELD.height);
      context.lineTo(0, base);
      const step = 16;
      for (let sx = 0; sx <= FIELD.width; sx += step) {
        const angle = cam.heading + Math.atan2(sx - cx, focal);
        const h = ridgeHeight(angle, layer, seed) * focal * 0.55;
        context.lineTo(sx, base - h);
      }
      context.lineTo(FIELD.width, FIELD.height);
      context.closePath();
      context.fill();
    }
    // Sea haze where the valley meets the horizon.
    context.fillStyle = dusk ? 'rgba(242, 184, 121, 0.25)' : 'rgba(207, 230, 242, 0.35)';
    context.fillRect(0, horizonY - 4, FIELD.width, 10);
  }

  function drawClouds(clouds, time) {
    for (const cloud of clouds) {
      const driftedX = cloud.x + time * cloud.drift;
      const point = project(driftedX, cloud.y, cloud.z);
      if (!point || point.d > 2400) continue;
      const alpha = clamp(1.15 - point.d / 2400, 0.15, 0.85);
      const s = point.s * cloud.scale;
      context.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      for (const [ox, oy, r] of [[-0.5, 0.1, 0.42], [0, -0.12, 0.55], [0.5, 0.12, 0.44], [0.2, 0.18, 0.36]]) {
        context.beginPath();
        context.ellipse(point.x + ox * s, point.y + oy * s, r * s, r * s * 0.55, 0, 0, Math.PI * 2);
        context.fill();
      }
    }
  }

  function groundColor(h, x, z, seed, shade) {
    const nearRiver = Math.abs(x - riverX(z));
    if (h < COURSE.waterLevel + 0.7 && nearRiver < 60) {
      const shimmer = 0.92 + 0.08 * Math.sin(z * 0.05 + x * 0.03);
      return rgb(58, 122, 178, shade * shimmer);
    }
    if (nearRiver < 75 && h < 9) return rgb(201, 177, 131, shade);
    const patch = valueNoise(x * 0.02, z * 0.02, seed) * 0.5 + 0.5;
    if (h > 150) return rgb(232, 238, 242, shade);
    if (h > 95) return rgb(138, 131, 120, shade * (0.9 + patch * 0.2));
    if (h > 60) return rgb(107, 122, 94, shade * (0.9 + patch * 0.2));
    const g = lerp(0.85, 1.12, patch);
    return rgb(93, 138, 74, shade * g);
  }

  function drawTerrain(flight, seed, time) {
    const step = 55;
    const cols = 23;
    const colStep = 60;
    const x0 = Math.floor((cam.x - 660) / colStep) * colStep;
    const zFar = cam.z + VIEW_DISTANCE;
    // Row depths: fine steps right under the nose (the bottom of the
    // screen shows ground metres ahead when the plane is on the runway),
    // then the regular grid out to the horizon. Rows start 2 m ahead so
    // no quad straddles the camera plane and gets skipped whole.
    const rowZ = [];
    for (const off of [2, 6, 12, 20, 32, 50, 80]) rowZ.push(cam.z + off);
    let z = Math.floor((cam.z + 80) / step) * step + step;
    while (z <= zFar) {
      rowZ.push(z);
      z += step;
    }
    // Heights for the whole grid, far row first so painters order is exact.
    const heights = [];
    for (let r = 0; r < rowZ.length; r += 1) {
      const row = [];
      for (let c = 0; c <= cols; c += 1) {
        row.push(heightAt(x0 + c * colStep, rowZ[r], seed));
      }
      heights.push(row);
    }
    for (let r = rowZ.length - 1; r >= 1; r -= 1) {
      const zA = rowZ[r];
      const zB = rowZ[r - 1];
      for (let c = 0; c < cols; c += 1) {
        const xA = x0 + c * colStep;
        const xB = x0 + (c + 1) * colStep;
        const h00 = heights[r - 1][c];
        const h01 = heights[r - 1][c + 1];
        const h10 = heights[r][c];
        const h11 = heights[r][c + 1];
        const p00 = project(xA, h00, zB);
        const p01 = project(xB, h01, zB);
        const p10 = project(xA, h10, zA);
        const p11 = project(xB, h11, zA);
        if (!p00 || !p01 || !p10 || !p11) continue;
        const midH = (h00 + h01 + h10 + h11) / 4;
        const midX = (xA + xB) / 2;
        const midZ = (zA + zB) / 2;
        const slope = clamp(1 + (h10 - h00) * 0.02 + (h01 - h00) * 0.012, 0.72, 1.18);
        context.fillStyle = groundColor(midH, midX, midZ, seed, slope);
        context.beginPath();
        context.moveTo(p00.x, p00.y);
        context.lineTo(p01.x, p01.y);
        context.lineTo(p11.x, p11.y);
        context.lineTo(p10.x, p10.y);
        context.closePath();
        context.fill();
      }
    }
  }

  function drawRunway(flight, seed) {
    for (const runway of [COURSE.runwayA, COURSE.runwayB]) {
      const midZ = (runway.z0 + runway.z1) / 2;
      const rcx = courseX(midZ);
      const half = runway.width / 2;
      const y = COURSE.valleyHeight + 0.35;
      const corners = [
        project(rcx - half, y, runway.z0),
        project(rcx + half, y, runway.z0),
        project(rcx + half, y, runway.z1),
        project(rcx - half, y, runway.z1),
      ];
      if (corners.some((p) => !p)) continue;
      context.fillStyle = PALETTE.runway;
      context.beginPath();
      context.moveTo(corners[0].x, corners[0].y);
      for (const p of corners.slice(1)) context.lineTo(p.x, p.y);
      context.closePath();
      context.fill();
      // Centreline dashes and the threshold bars.
      context.fillStyle = PALETTE.runwayMark;
      for (let z = runway.z0 + 60; z < runway.z1 - 20; z += 90) {
        const a = project(rcx - 2.5, y + 0.15, z);
        const b = project(rcx + 2.5, y + 0.15, z);
        const c = project(rcx + 2.5, y + 0.15, z + 42);
        const d = project(rcx - 2.5, y + 0.15, z + 42);
        if (!a || !b || !c || !d) continue;
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.lineTo(c.x, c.y);
        context.lineTo(d.x, d.y);
        context.closePath();
        context.fill();
      }
      for (const endZ of [runway.z0 + 26, runway.z1 - 26]) {
        for (const off of [-14, 0, 14]) {
          const a = project(rcx + off - 5, y + 0.15, endZ - 8);
          const b = project(rcx + off + 5, y + 0.15, endZ - 8);
          const c = project(rcx + off + 5, y + 0.15, endZ + 8);
          const d = project(rcx + off - 5, y + 0.15, endZ + 8);
          if (!a || !b || !c || !d) continue;
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(b.x, b.y);
          context.lineTo(c.x, c.y);
          context.lineTo(d.x, d.y);
          context.closePath();
          context.fill();
        }
      }
    }
  }

  function drawTrees(trees) {
    for (let i = trees.length - 1; i >= 0; i -= 1) {
      const tree = trees[i];
      const dz = tree.z - cam.z;
      if (dz < 4 || dz > 520) continue;
      const dx = tree.x - cam.x;
      if (Math.abs(dx) > 560) continue;
      const base = project(tree.x, tree.y, tree.z);
      if (!base) continue;
      const top = project(tree.x, tree.y + tree.size * 2.1, tree.z);
      if (!top) continue;
      const w = Math.max(1.5, tree.size * base.s * 0.5);
      const shade = tree.shade < 0.5 ? 'rgba(34, 84, 44, 0.95)' : 'rgba(46, 104, 52, 0.95)';
      context.fillStyle = shade;
      context.beginPath();
      context.moveTo(top.x, top.y);
      context.lineTo(base.x - w, base.y);
      context.lineTo(base.x + w, base.y);
      context.closePath();
      context.fill();
    }
  }

  function drawRings(rings, flight, time) {
    let nextDrawn = false;
    for (let i = 0; i < rings.length; i += 1) {
      const ring = rings[i];
      if (ring.passed) continue;
      const centre = project(ring.x, ring.y, ring.z);
      if (!centre || centre.d < 4 || centre.d > VIEW_DISTANCE + 120) continue;
      const isNext = i === flight.ringsHit;
      const radiusPx = ring.r * centre.s;
      if (radiusPx < 3) continue;
      const color = isNext ? PALETTE.ringNext : PALETTE.ringLater;
      const pulse = isNext ? 1 + 0.12 * Math.sin(time * 5) : 1;
      context.save();
      context.globalAlpha = isNext ? 0.98 : 0.75;
      context.strokeStyle = color;
      context.lineWidth = Math.max(2, radiusPx * 0.1 * pulse);
      context.shadowColor = color;
      context.shadowBlur = isNext ? 22 : 10;
      context.beginPath();
      context.arc(centre.x, centre.y, radiusPx * pulse, 0, Math.PI * 2);
      context.stroke();
      context.shadowBlur = 0;
      context.lineWidth = Math.max(1, radiusPx * 0.03);
      context.globalAlpha = 0.5;
      context.beginPath();
      context.arc(centre.x, centre.y, radiusPx * 0.72 * pulse, 0, Math.PI * 2);
      context.stroke();
      context.restore();
      if (isNext) {
        nextDrawn = true;
        text(
          `RING ${ring.index + 1} — ${Math.round(centre.d)} m`,
          centre.x,
          centre.y - radiusPx - 14,
          17,
          PALETTE.hudText,
          'center',
          '700 ',
        );
      }
    }
    return nextDrawn;
  }

  /** An arrow at the screen edge when the next ring is out of frame. */
  function drawGuidance(rings, flight) {
    if (flight.ringsHit >= rings.length) return;
    const ring = rings[flight.ringsHit];
    const centre = project(ring.x, ring.y, ring.z);
    if (centre && centre.x > 60 && centre.x < FIELD.width - 60 && centre.y > 60 && centre.y < FIELD.height - 160) return;
    const targetX = centre ? centre.x : cx + Math.sin(Math.atan2(ring.x - flight.x, ring.z - flight.z) - flight.heading) * 500;
    const targetY = centre ? centre.y : cy - 120;
    const edgeX = clamp(targetX, 70, FIELD.width - 70);
    const edgeY = clamp(targetY, 70, FIELD.height - 170);
    const angle = Math.atan2(targetY - edgeY, targetX - edgeX);
    context.save();
    context.translate(edgeX, edgeY);
    context.rotate(angle);
    context.fillStyle = PALETTE.ringNext;
    context.beginPath();
    context.moveTo(18, 0);
    context.lineTo(-10, -12);
    context.lineTo(-4, 0);
    context.lineTo(-10, 12);
    context.closePath();
    context.fill();
    context.restore();
    text(`${Math.round(Math.hypot(ring.x - flight.x, ring.z - flight.z))} m`, edgeX, edgeY + 30, 14, PALETTE.ringNext, 'center', '700 ');
  }

  function drawPlane(flight, time) {
    const px = cx;
    const py = cy + 62 - flight.pitch * 160;
    const blink = Math.sin(time * 6) > 0;
    context.save();
    context.translate(px, py);
    context.rotate(flight.bank);
    // Wings: long, white, red tips, seen from behind and slightly above.
    context.fillStyle = PALETTE.planeWing;
    context.beginPath();
    context.moveTo(-14, -6);
    context.lineTo(-168, 26);
    context.lineTo(-168, 40);
    context.lineTo(-14, 14);
    context.closePath();
    context.fill();
    context.beginPath();
    context.moveTo(14, -6);
    context.lineTo(168, 26);
    context.lineTo(168, 40);
    context.lineTo(14, 14);
    context.closePath();
    context.fill();
    context.fillStyle = PALETTE.planeBody;
    context.fillRect(-168, 24, 16, 18);
    context.fillRect(152, 24, 16, 18);
    // Nav lights: red port, green starboard, blinking white tail.
    context.fillStyle = '#ff3b30';
    context.beginPath();
    context.arc(-166, 33, blink ? 5 : 3.5, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#35e07a';
    context.beginPath();
    context.arc(166, 33, blink ? 5 : 3.5, 0, Math.PI * 2);
    context.fill();
    // Tailplane and fin.
    context.fillStyle = PALETTE.planeWing;
    context.beginPath();
    context.moveTo(-10, 44);
    context.lineTo(-72, 66);
    context.lineTo(-72, 74);
    context.lineTo(-10, 58);
    context.closePath();
    context.fill();
    context.beginPath();
    context.moveTo(10, 44);
    context.lineTo(72, 66);
    context.lineTo(72, 74);
    context.lineTo(10, 58);
    context.closePath();
    context.fill();
    // Fuselage, tapering away from the viewer toward the prop.
    context.fillStyle = PALETTE.planeBody;
    context.beginPath();
    context.moveTo(-26, 78);
    context.quadraticCurveTo(-30, 10, -16, -58);
    context.lineTo(16, -58);
    context.quadraticCurveTo(30, 10, 26, 78);
    context.quadraticCurveTo(0, 88, -26, 78);
    context.closePath();
    context.fill();
    // White cheatline and the Kestrel badge.
    context.fillStyle = PALETTE.planeWing;
    context.fillRect(-24, 26, 48, 7);
    context.fillStyle = PALETTE.planeTrim;
    text('K-7', 0, 66, 15, PALETTE.planeTrim, 'center', '800 ');
    // Canopy glass at the far end.
    context.fillStyle = '#1d3557';
    context.beginPath();
    context.ellipse(0, -38, 11, 20, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = 'rgba(160, 210, 240, 0.65)';
    context.beginPath();
    context.ellipse(-3, -44, 4, 9, -0.2, 0, Math.PI * 2);
    context.fill();
    // Spinning prop disc, a blur at the nose.
    const spin = (time * 22) % Math.PI;
    context.save();
    context.translate(0, -62);
    context.rotate(spin);
    context.fillStyle = 'rgba(30, 30, 34, 0.28)';
    context.beginPath();
    context.ellipse(0, 0, 5, 34, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
    context.fillStyle = '#22242a';
    context.beginPath();
    context.arc(0, -62, 4, 0, Math.PI * 2);
    context.fill();
    // Landing gear when down.
    if (flight.gearDown) {
      context.strokeStyle = '#20242a';
      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(-16, 76);
      context.lineTo(-20, 96);
      context.moveTo(16, 76);
      context.lineTo(20, 96);
      context.stroke();
      context.fillStyle = '#15181c';
      context.beginPath();
      context.arc(-20, 98, 6, 0, Math.PI * 2);
      context.arc(20, 98, 6, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function drawCockpitFrame() {
    context.fillStyle = 'rgba(12, 16, 22, 0.92)';
    // Glareshield along the bottom, with rivets.
    context.beginPath();
    context.moveTo(0, FIELD.height);
    context.lineTo(0, FIELD.height - 34);
    context.quadraticCurveTo(FIELD.width / 2, FIELD.height - 58, FIELD.width, FIELD.height - 34);
    context.lineTo(FIELD.width, FIELD.height);
    context.closePath();
    context.fill();
    context.fillStyle = 'rgba(255, 255, 255, 0.16)';
    for (let x = 60; x < FIELD.width; x += 120) {
      context.beginPath();
      context.arc(x, FIELD.height - 14, 2.5, 0, Math.PI * 2);
      context.fill();
    }
    // Windshield pillars.
    context.save();
    context.translate(0, 0);
    context.fillStyle = 'rgba(12, 16, 22, 0.9)';
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(46, 0);
    context.lineTo(120, FIELD.height * 0.42);
    context.lineTo(96, FIELD.height * 0.42);
    context.closePath();
    context.fill();
    context.beginPath();
    context.moveTo(FIELD.width, 0);
    context.lineTo(FIELD.width - 46, 0);
    context.lineTo(FIELD.width - 120, FIELD.height * 0.42);
    context.lineTo(FIELD.width - 96, FIELD.height * 0.42);
    context.closePath();
    context.fill();
    context.restore();
  }

  function panel(x, y, w, h) {
    context.fillStyle = PALETTE.hudPanel;
    context.beginPath();
    context.roundRect(x, y, w, h, 10);
    context.fill();
    context.strokeStyle = 'rgba(140, 220, 255, 0.35)';
    context.lineWidth = 1;
    context.stroke();
  }

  function drawGauge(cxg, cyg, r, label, valueText, subText, fraction, warn) {
    panel(cxg - r - 12, cyg - r - 12, (r + 12) * 2, (r + 12) * 2 + 26);
    context.save();
    context.translate(cxg, cyg);
    context.fillStyle = '#0a141d';
    context.beginPath();
    context.arc(0, 0, r, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = warn ? PALETTE.hudRed : PALETTE.hudLine;
    context.lineWidth = 2;
    context.stroke();
    // Tick marks.
    for (let i = 0; i <= 10; i += 1) {
      const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
      const inner = r - 8;
      context.strokeStyle = 'rgba(223, 244, 255, 0.6)';
      context.lineWidth = i % 5 === 0 ? 2 : 1;
      context.beginPath();
      context.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      context.lineTo(Math.cos(a) * (r - 2), Math.sin(a) * (r - 2));
      context.stroke();
    }
    // Needle.
    const angle = Math.PI * 0.75 + clamp(fraction, 0, 1) * Math.PI * 1.5;
    context.strokeStyle = warn ? PALETTE.hudRed : PALETTE.hudGreen;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(Math.cos(angle) * (r - 12), Math.sin(angle) * (r - 12));
    context.stroke();
    context.fillStyle = PALETTE.hudText;
    context.beginPath();
    context.arc(0, 0, 4, 0, Math.PI * 2);
    context.fill();
    context.restore();
    text(label, cxg, cyg + r + 16, 12, PALETTE.muted, 'center', '700 ');
    text(valueText, cxg, cyg + 6, 24, warn ? PALETTE.hudRed : PALETTE.hudText, 'center', '800 ');
    if (subText) text(subText, cxg, cyg + r + 32, 11, PALETTE.muted, 'center');
  }

  function drawHorizon(flight, hx, hy, hr) {
    panel(hx - hr - 14, hy - hr - 14, (hr + 14) * 2, (hr + 14) * 2 + 24);
    context.save();
    context.beginPath();
    context.arc(hx, hy, hr, 0, Math.PI * 2);
    context.clip();
    context.translate(hx, hy);
    context.rotate(-flight.bank);
    const pitchOffset = clamp(flight.pitch, -0.5, 0.5) * hr * 1.6;
    context.fillStyle = '#3f8fd2';
    context.fillRect(-hr, -hr + pitchOffset, hr * 2, hr - pitchOffset);
    context.fillStyle = '#7a5a38';
    context.fillRect(-hr, pitchOffset, hr * 2, hr * 2);
    context.strokeStyle = '#eef4f8';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(-hr, pitchOffset);
    context.lineTo(hr, pitchOffset);
    context.stroke();
    context.restore();
    // Fixed wings and the bank pointer.
    context.save();
    context.translate(hx, hy);
    context.strokeStyle = PALETTE.hudAmber;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(-hr + 8, 0);
    context.lineTo(-14, 0);
    context.moveTo(14, 0);
    context.lineTo(hr - 8, 0);
    context.stroke();
    context.fillStyle = PALETTE.hudAmber;
    context.beginPath();
    context.arc(0, 0, 3, 0, Math.PI * 2);
    context.fill();
    context.restore();
    context.strokeStyle = 'rgba(223, 244, 255, 0.7)';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(hx, hy, hr + 5, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
    context.stroke();
    text('ATTITUDE', hx, hy + hr + 16, 12, PALETTE.muted, 'center', '700 ');
  }

  function drawHeadingTape(flight) {
    const tapeW = 460;
    const tapeX = cx - tapeW / 2;
    panel(tapeX - 10, 8, tapeW + 20, 44);
    context.save();
    context.beginPath();
    context.rect(tapeX, 8, tapeW, 44);
    context.clip();
    const headingDeg = ((flight.heading * 180) / Math.PI % 360 + 360) % 360;
    const pxPerDeg = tapeW / 90;
    for (let deg = Math.floor((headingDeg - 45) / 5) * 5; deg <= headingDeg + 45; deg += 5) {
      const wrapped = ((deg % 360) + 360) % 360;
      const x = cx + (deg - headingDeg) * pxPerDeg;
      const major = wrapped % 30 === 0;
      context.strokeStyle = major ? PALETTE.hudText : 'rgba(223, 244, 255, 0.45)';
      context.lineWidth = major ? 2 : 1;
      context.beginPath();
      context.moveTo(x, major ? 16 : 22);
      context.lineTo(x, 30);
      context.stroke();
      if (major) {
        const label = wrapped === 0 ? 'N' : wrapped === 90 ? 'E' : wrapped === 180 ? 'S' : wrapped === 270 ? 'W' : String(wrapped).padStart(3, '0');
        text(label, x, 46, 12, PALETTE.hudText, 'center', '700 ');
      }
    }
    context.restore();
    // Centre caret and the digital heading.
    context.fillStyle = PALETTE.hudAmber;
    context.beginPath();
    context.moveTo(cx - 7, 10);
    context.lineTo(cx + 7, 10);
    context.lineTo(cx, 20);
    context.closePath();
    context.fill();
    text(`${String(Math.round(headingDeg)).padStart(3, '0')}°`, cx, 66, 13, PALETTE.hudAmber, 'center', '800 ');
  }

  function drawHud(view) {
    const flight = view.flight;
    const mission = view.mission;
    // Top-left: score, rings, time.
    panel(14, 8, 302, 86);
    text(`${mission.name.toUpperCase()}  ·  ${mission.tagline}`, 28, 30, 13, PALETTE.hudAmber, 'left', '800 ');
    text(`SCORE  ${Math.round(flight.score)}`, 28, 54, 17, PALETTE.hudText, 'left', '800 ');
    text(
      `RINGS  ${flight.ringsHit}/${flight.ringsTotal}    TIME  ${formatTime(flight.timeLeft)}`,
      28,
      78,
      14,
      flight.timeLeft < 60 ? PALETTE.hudRed : PALETTE.hudText,
      'left',
      '700 ',
    );
    // Top-right: wind and fuel warnings.
    if (mission.wind > 0) {
      panel(FIELD.width - 264, 8, 250, 44);
      const gust = Math.abs(flight.windGust);
      text(
        `WIND  ${gust < 2 ? 'CALM' : gust < 6 ? 'GUSTING' : 'STRONG'}  ${Math.round(flight.windGust)} m/s`,
        FIELD.width - 28,
        36,
        14,
        gust < 6 ? PALETTE.hudText : PALETTE.hudAmber,
        'right',
        '700 ',
      );
    }
    drawHeadingTape(flight);
    // Instruments along the bottom.
    drawGauge(96, 600, 46, 'AIRSPEED', `${knots(flight.speed)}`, 'knots', flight.speed / 108, flight.stalled);
    drawGauge(FIELD.width - 96, 600, 46, 'ALTITUDE', `${feet(flight.y)}`, 'feet', clamp(flight.y / 260, 0, 1), false);
    drawHorizon(flight, cx, 606, 52);
    // Vertical speed, left of the horizon.
    const vs = flight.vspeed;
    panel(cx - 168, 566, 92, 66);
    text('VERT SPD', cx - 122, 588, 11, PALETTE.muted, 'center', '700 ');
    text(`${vs >= 0 ? '+' : ''}${vs.toFixed(1)}`, cx - 122, 614, 18, vs < -6 ? PALETTE.hudRed : PALETTE.hudText, 'center', '800 ');
    text('m/s', cx - 122, 628, 11, PALETTE.muted, 'center');
    // Throttle and fuel, right of the horizon.
    panel(cx + 76, 566, 92, 66);
    text('THROTTLE', cx + 122, 588, 11, PALETTE.muted, 'center', '700 ');
    text(`${Math.round(flight.throttle * 100)}%`, cx + 122, 614, 18, PALETTE.hudText, 'center', '800 ');
    const fuelColor = flight.fuel < 20 ? PALETTE.hudRed : flight.fuel < 45 ? PALETTE.hudAmber : PALETTE.hudGreen;
    context.fillStyle = 'rgba(255,255,255,0.18)';
    context.fillRect(cx + 88, 622, 68, 6);
    context.fillStyle = fuelColor;
    context.fillRect(cx + 88, 622, 68 * (flight.fuel / 100), 6);
    // Gear / flaps / brake lamps.
    const lamps = [
      ['GEAR', flight.gearDown, PALETTE.hudGreen],
      ['FLAPS', flight.flaps, PALETTE.hudAmber],
      ['BRAKE', view.braking, PALETTE.hudRed],
    ];
    lamps.forEach(([label, on, color], i) => {
      const x = 14 + i * 86;
      panel(x, 108, 76, 30);
      context.fillStyle = on ? color : 'rgba(255,255,255,0.25)';
      context.beginPath();
      context.arc(x + 14, 123, 5, 0, Math.PI * 2);
      context.fill();
      text(label, x + 26, 127, 12, on ? PALETTE.hudText : PALETTE.muted, 'left', '700 ');
    });
    // Centre messages: rings, warnings, stall — on a dark pill so they
    // read over bright sky and cloud alike.
    function centreMessage(message, color, size, flash) {
      context.save();
      const blink = flash && Math.sin(view.time * 10) <= 0;
      context.font = `900 ${size}px ${FONT}`;
      const width = context.measureText(message).width;
      context.fillStyle = 'rgba(6, 12, 20, 0.66)';
      context.beginPath();
      context.roundRect(cx - width / 2 - 18, 210 - size - 6, width + 36, size + 20, 12);
      context.fill();
      if (blink) context.globalAlpha *= 0.35;
      text(message, cx, 210, size, color, 'center', '900 ');
      context.restore();
    }
    if (flight.stalled && !flight.crashed) {
      centreMessage('STALL — NOSE DOWN, THROTTLE UP', PALETTE.hudRed, 26, true);
    } else if (flight.message && flight.messageT > 0) {
      context.globalAlpha = clamp(flight.messageT, 0, 1);
      centreMessage(flight.message, PALETTE.hudText, 22, false);
      context.globalAlpha = 1;
    }
    if (flight.fuel < 20 && !flight.crashed && flight.fuel > 0) {
      text('LOW FUEL', FIELD.width - 96, 560, 15, PALETTE.hudRed, 'center', '800 ');
    }
  }

  function overlayPanel(title, lines, accent) {
    const w = 640;
    const h = 120 + lines.length * 30;
    const x = cx - w / 2;
    const y = 120;
    context.fillStyle = 'rgba(6, 12, 20, 0.82)';
    context.beginPath();
    context.roundRect(x, y, w, h, 16);
    context.fill();
    context.strokeStyle = accent;
    context.lineWidth = 2;
    context.stroke();
    text(title, cx, y + 52, 34, accent, 'center', '900 ');
    lines.forEach((line, i) => {
      text(line, cx, y + 96 + i * 30, 17, PALETTE.text, 'center');
    });
  }

  function drawTitle(view) {
    context.fillStyle = 'rgba(4, 10, 18, 0.45)';
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    text('KESTREL RIDGE', cx, 108, 64, '#ffffff', 'center', '900 ');
    text('ISLAND AIR RALLY  ·  A FLIGHT GAME', cx, 142, 18, PALETTE.hudAmber, 'center', '800 ');
    text('Fly the valley, thread the rings, and land her clean on Coral Bay.', cx, 172, 16, PALETTE.text, 'center');
    const cards = missionCards(view.missions);
    cards.forEach((card, i) => {
      const selected = view.selected === i;
      context.fillStyle = selected ? 'rgba(255, 180, 0, 0.16)' : 'rgba(6, 14, 22, 0.78)';
      context.beginPath();
      context.roundRect(card.x, card.y, card.w, card.h, 14);
      context.fill();
      context.strokeStyle = selected ? PALETTE.hudAmber : 'rgba(140, 220, 255, 0.4)';
      context.lineWidth = selected ? 3 : 1.5;
      context.stroke();
      text(`${i + 1} · ${card.mission.name.toUpperCase()}`, card.x + 20, card.y + 36, 20, selected ? PALETTE.hudAmber : PALETTE.hudText, 'left', '900 ');
      text(card.mission.tagline, card.x + 20, card.y + 62, 14, PALETTE.muted, 'left', '700 ');
      text(card.mission.description, card.x + 20, card.y + 86, 13, PALETTE.text, 'left');
      text(card.mission.description2, card.x + 20, card.y + 106, 13, PALETTE.text, 'left');
      text(card.mission.description3, card.x + 20, card.y + 126, 13, PALETTE.text, 'left');
      text(
        `${card.mission.rings} rings   ·   ${card.mission.fuel}% fuel   ·   ${formatTime(card.mission.timeLimit)} limit`,
        card.x + 20,
        card.y + 140,
        13,
        PALETTE.hudGreen,
        'left',
        '700 ',
      );
    });
    text('ARROWS / WASD — stick      SHIFT — throttle up      CTRL — throttle down      G — gear      F — flaps      B — brake', cx, 636, 14, PALETTE.muted, 'center');
    text('Mouse drag steers too.  Press 1 / 2 / 3 to pick a sortie, Enter to fly.  M mutes the sound.', cx, 660, 14, PALETTE.muted, 'center');
    if (view.best > 0) text(`BEST SCORE  ${view.best}`, cx, 690, 15, PALETTE.hudAmber, 'center', '800 ');
  }

  function missionCards(missions) {
    const w = 380;
    const h = 168;
    const gap = 24;
    const total = w * 3 + gap * 2;
    const x0 = cx - total / 2;
    const y = 210;
    return [0, 1, 2].map((i) => ({
      mission: missions[i],
      x: x0 + i * (w + gap),
      y,
      w,
      h,
    }));
  }

  function drawPaused() {
    context.fillStyle = 'rgba(4, 10, 18, 0.55)';
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    overlayPanel('PAUSED', ['P or Esc — resume flying', 'Enter — back to the mission list'], PALETTE.hudText);
  }

  function drawEnd(view) {
    const flight = view.flight;
    const win = view.screen === SCREEN_WIN;
    context.fillStyle = 'rgba(4, 10, 18, 0.5)';
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    const lines = [];
    if (win) {
      lines.push(`Mission complete — ${view.mission.name}`);
      lines.push(`Rings flown: ${flight.ringsHit} of ${flight.ringsTotal}  ·  +${PLANE_POINTS_LANDING} landing bonus`);
      if (flight.timeBonus) lines.push(`Time bonus: +${flight.timeBonus}  (par ${formatTime(view.mission.parTime)})`);
      lines.push(`Distance flown: ${(flight.distance / 1000).toFixed(1)} km`);
    } else if (flight.crashed) {
      lines.push(flight.crashReason || 'Crashed');
      lines.push(`Rings flown: ${flight.ringsHit} of ${flight.ringsTotal}`);
      lines.push(`Distance flown: ${(flight.distance / 1000).toFixed(1)} km`);
    } else {
      lines.push('Out of time — the sortie is over');
      lines.push(`Rings flown: ${flight.ringsHit} of ${flight.ringsTotal}`);
      lines.push(`Distance flown: ${(flight.distance / 1000).toFixed(1)} km`);
    }
    lines.push(`SCORE  ${Math.round(flight.score)}    ·    BEST  ${view.best}`);
    lines.push('Enter — fly again      Esc — mission list');
    overlayPanel(
      win ? 'MISSION COMPLETE' : flight.crashed ? 'CRASHED' : 'TIME UP',
      lines,
      win ? PALETTE.hudGreen : PALETTE.hudRed,
    );
  }

  /** The one draw call: scene, plane, HUD, then the screen on top. */
  function draw(view) {
    const flight = view.flight;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.translate(view.x, view.y);
    context.scale(view.scale, view.scale);
    setupCamera(flight);
    const dusk = view.mission.dusk;
    drawSky(flight, dusk);
    drawRidges(flight, view.seed, dusk);
    drawClouds(view.clouds, view.time);
    drawTerrain(flight, view.seed, view.time);
    drawRunway(flight, view.seed);
    drawTrees(view.trees);
    const nextVisible = drawRings(view.rings, flight, view.time);
    if (!nextVisible) drawGuidance(view.rings, flight);
    drawPlane(flight, view.time);
    drawCockpitFrame();
    if (view.screen === SCREEN_PLAY || view.screen === SCREEN_PAUSED) drawHud(view);
    if (view.screen === SCREEN_TITLE) drawTitle(view);
    else if (view.screen === SCREEN_PAUSED) drawPaused();
    else if (view.screen === SCREEN_OVER || view.screen === SCREEN_WIN) drawEnd(view);
    context.restore();
  }

  return { draw, missionCards };
}

// Landing bonus shown on the end screen; kept beside the renderer text.
const PLANE_POINTS_LANDING = 500;
