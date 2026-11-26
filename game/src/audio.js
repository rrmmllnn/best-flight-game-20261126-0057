// All sound is synthesised with WebAudio — no audio files, no network.
// The engine is a low sawtooth through a filter whose pitch follows the
// throttle; the wind is looped filtered noise; rings chime, touchdowns thud.
export function createAudio() {
  let context = null;
  let engineOsc = null;
  let engineOsc2 = null;
  let engineGain = null;
  let engineFilter = null;
  let windSource = null;
  let windGain = null;
  let muted = false;
  let started = false;

  function ensure() {
    if (context) return true;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      context = new AudioContext();
      engineOsc = context.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 62;
      engineOsc2 = context.createOscillator();
      engineOsc2.type = 'square';
      engineOsc2.frequency.value = 31;
      engineFilter = context.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 320;
      engineGain = context.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineFilter);
      engineOsc2.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(context.destination);
      engineOsc.start();
      engineOsc2.start();
      // Looping wind: two seconds of white noise, band-passed.
      const length = context.sampleRate * 2;
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
      windSource = context.createBufferSource();
      windSource.buffer = buffer;
      windSource.loop = true;
      const windFilter = context.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 480;
      windFilter.Q.value = 0.6;
      windGain = context.createGain();
      windGain.gain.value = 0;
      windSource.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(context.destination);
      windSource.start();
      return true;
    } catch {
      context = null;
      return false;
    }
  }

  function tone(freq, dur, type, vol, when = 0) {
    if (!context || muted) return;
    try {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, context.currentTime + when);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + when + dur);
      osc.connect(gain);
      gain.connect(context.destination);
      osc.start(context.currentTime + when);
      osc.stop(context.currentTime + when + dur + 0.05);
    } catch {
      // Sound is garnish: never let it break the game.
    }
  }

  return {
    /** Call from a user gesture; browsers block audio before one. */
    start() {
      if (!ensure()) return;
      if (context.state === 'suspended') context.resume().catch(() => {});
      started = true;
    },
    started() {
      return started;
    },
    /** Engine drone and wind follow the flight, every frame. */
    setFlight(throttle, speed, airborne) {
      if (!context || muted || !started) return;
      try {
        const now = context.currentTime;
        const rpm = 52 + throttle * 78 + speed * 0.22;
        engineOsc.frequency.setTargetAtTime(rpm, now, 0.08);
        engineOsc2.frequency.setTargetAtTime(rpm / 2, now, 0.08);
        engineFilter.frequency.setTargetAtTime(240 + throttle * 700, now, 0.1);
        engineGain.gain.setTargetAtTime(airborne ? 0.045 + throttle * 0.05 : 0.02, now, 0.1);
        windGain.gain.setTargetAtTime(Math.min(0.09, (speed / 108) * 0.09), now, 0.15);
      } catch {
        // Ignore audio errors mid-flight.
      }
    },
    ring() {
      tone(880, 0.16, 'sine', 0.22);
      tone(1318, 0.28, 'sine', 0.18, 0.09);
    },
    click() {
      tone(660, 0.07, 'square', 0.08);
    },
    land() {
      tone(110, 0.25, 'sine', 0.3);
      tone(220, 0.3, 'sine', 0.15, 0.05);
    },
    crash() {
      if (!context || muted) return;
      try {
        const dur = 0.7;
        const buffer = context.createBuffer(1, context.sampleRate * dur, context.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i += 1) {
          data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
        }
        const source = context.createBufferSource();
        source.buffer = buffer;
        const filter = context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 420;
        const gain = context.createGain();
        gain.gain.value = 0.5;
        source.connect(filter);
        filter.connect(gain);
        gain.connect(context.destination);
        source.start();
        tone(70, 0.6, 'sine', 0.4);
      } catch {
        // Ignore.
      }
    },
    warning() {
      tone(440, 0.12, 'square', 0.1);
      tone(440, 0.12, 'square', 0.1, 0.18);
    },
    setMuted(value) {
      muted = value;
      if (context && engineGain) {
        engineGain.gain.value = 0;
        if (windGain) windGain.gain.value = 0;
      }
    },
    isMuted() {
      return muted;
    },
  };
}
