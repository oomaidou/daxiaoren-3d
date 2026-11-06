import { clamp, rand, chance } from './utils.js';

export class AudioEngine {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.muted = false;
    this.noiseBuffer = null;
    this.ambient = null;
    this.ambientTimer = 4;
    this.sirenTimer = 0;
    this.beam = null;
    this._pan = new (class { constructor() {} })();
    this._tmp = { x: 0, y: 0, z: 0 };
    this._steptime = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 18;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.22;
    compressor.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0.65;
    this.master.connect(compressor);
    this._makeNoise();
    this._startAmbience();
    if (ctx.state === 'suspended') ctx.resume();
  }

  _makeNoise() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
  }

  _startAmbience() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 480;
    const gain = ctx.createGain();
    gain.gain.value = 0.035;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    const hum = ctx.createOscillator();
    hum.type = 'sine';
    hum.frequency.value = 58;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.008;
    hum.connect(humGain).connect(this.master);
    hum.start();
    this.ambient = { src, gain, filter, hum, humGain };
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.linearRampToValueAtTime(muted ? 0 : 0.65, t + 0.08);
    }
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  panFor(worldPos) {
    if (!this.game?.camera || !worldPos) return 0;
    const cam = this.game.camera;
    const right = new (cam.position.constructor)();
    cam.getWorldDirection(right);
    // camera right is roughly forward cross up
    const rx = -right.z, rz = right.x;
    const dx = worldPos.x - cam.position.x;
    const dz = worldPos.z - cam.position.z;
    const d = Math.hypot(dx, dz) || 1;
    return clamp((dx / d) * rx + (dz / d) * rz, -1, 1) * 0.7;
  }

  volumeAt(worldPos, base = 0.5) {
    if (!this.game?.camera || !worldPos) return base;
    const d = this.game.camera.position.distanceTo(worldPos);
    return base * clamp(1 - d / 70, 0.05, 1);
  }

  _noise(duration = 0.12, gainValue = 0.2, type = 'highpass', freq = 900, pan = 0, options = {}) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.playbackRate.value = options.rate || 1;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, now);
    if (options.endFreq) filter.frequency.exponentialRampToValueAtTime(Math.max(40, options.endFreq), now + duration);
    filter.Q.value = options.q || 0.7;
    const gain = ctx.createGain();
    const attack = options.attack ?? 0.002;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue), now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) panner.pan.value = clamp(pan, -1, 1);
    if (panner) src.connect(filter).connect(gain).connect(panner).connect(this.master);
    else src.connect(filter).connect(gain).connect(this.master);
    src.start(now);
    src.stop(now + duration + 0.02);
    return gain;
  }

  _tone(freq, duration, gainValue = 0.1, type = 'sine', pan = 0, options = {}) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime + (options.delay || 0);
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (options.endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, options.endFreq), now + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue), now + (options.attack ?? 0.008));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) { panner.pan.value = clamp(pan, -1, 1); osc.connect(gain).connect(panner).connect(this.master); }
    else osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  play(name, opts = {}) {
    if (!this.ctx || this.muted) return;
    const volume = clamp(opts.volume ?? 0.5, 0, 1.5);
    const pan = opts.pan || 0;
    switch (name) {
      case 'playerPistol':
        this._noise(0.12, 0.33 * volume, 'highpass', 760, pan, { attack: 0.001, q: 0.8 });
        this._tone(140, 0.13, 0.25 * volume, 'triangle', pan, { endFreq: 48, attack: 0.001 });
        this._noise(0.035, 0.24 * volume, 'bandpass', 2200, pan);
        break;
      case 'playerSmg':
        this._noise(0.065, 0.24 * volume, 'highpass', 1100, pan, { attack: 0.001 });
        this._tone(180, 0.07, 0.17 * volume, 'square', pan, { endFreq: 70, attack: 0.001 });
        break;
      case 'playerSniper':
        this._noise(0.4, 0.55 * volume, 'lowpass', 3200, pan, { attack: 0.001, endFreq: 320, q: 0.9 });
        this._tone(95, 0.45, 0.38 * volume, 'sine', pan, { endFreq: 27, attack: 0.001 });
        this._noise(0.55, 0.14 * volume, 'highpass', 1600, pan, { attack: 0.03, endFreq: 240 });
        break;
      case 'enemyPistol':
        this._noise(0.1, 0.17 * volume, 'highpass', 720, pan, { attack: 0.001 });
        this._tone(120, 0.11, 0.12 * volume, 'triangle', pan, { endFreq: 45, attack: 0.001 });
        break;
      case 'enemySmg':
        this._noise(0.055, 0.12 * volume, 'highpass', 1200, pan, { attack: 0.001 });
        this._tone(160, 0.05, 0.07 * volume, 'square', pan, { endFreq: 65, attack: 0.001 });
        break;
      case 'enemySniper':
        this._noise(0.28, 0.32 * volume, 'lowpass', 2600, pan, { attack: 0.001, endFreq: 350 });
        this._tone(110, 0.33, 0.24 * volume, 'sine', pan, { endFreq: 30, attack: 0.001 });
        break;
      case 'dry':
        this._noise(0.03, 0.1 * volume, 'highpass', 2800, pan);
        this._tone(560, 0.035, 0.035 * volume, 'square', pan);
        break;
      case 'reload':
        this._noise(0.04, 0.11 * volume, 'bandpass', 2500, pan);
        this._tone(420, 0.04, 0.035 * volume, 'square', pan);
        setTimeout(() => this._noise(0.05, 0.1 * volume, 'bandpass', 1800, pan), 380);
        setTimeout(() => this._noise(0.06, 0.13 * volume, 'bandpass', 3400, pan), 720);
        break;
      case 'shell':
        this._tone(rand(1700, 2400), 0.035, 0.025 * volume, 'triangle', pan);
        break;
      case 'bowDraw':
        this._noise(0.2, 0.05 * volume, 'bandpass', 700, pan, { q: 1.4, endFreq: 1100 });
        break;
      case 'bowShot':
        this._tone(180, 0.17, 0.13 * volume, 'sawtooth', pan, { endFreq: 62, attack: 0.001 });
        this._noise(0.1, 0.1 * volume, 'highpass', 1400, pan);
        break;
      case 'arrowStick':
        this._noise(0.08, 0.16 * volume, 'bandpass', 420, pan, { q: 1.2 });
        this._tone(90, 0.08, 0.08 * volume, 'sine', pan, { endFreq: 45 });
        break;
      case 'tranq':
        this._noise(0.12, 0.1 * volume, 'bandpass', 1700, pan, { q: 1.8 });
        this._tone(820, 0.07, 0.035 * volume, 'sine', pan, { endFreq: 400 });
        break;
      case 'sedated':
        this._tone(600, 0.2, 0.035 * volume, 'sine', pan, { endFreq: 250 });
        this._tone(400, 0.25, 0.024 * volume, 'sine', pan, { endFreq: 180, delay: 0.08 });
        break;
      case 'flesh':
      case 'fleshHit':
        this._noise(0.09, 0.22 * volume, 'lowpass', 650, pan, { q: 0.7 });
        this._tone(78, 0.1, 0.16 * volume, 'sine', pan, { endFreq: 40 });
        break;
      case 'armor':
        this._tone(1400, 0.09, 0.035 * volume, 'square', pan, { endFreq: 700 });
        this._noise(0.05, 0.1 * volume, 'highpass', 3000, pan);
        break;
      case 'headshot':
        this._tone(1150, 0.09, 0.11 * volume, 'triangle', pan, { endFreq: 1800 });
        this._noise(0.1, 0.18 * volume, 'lowpass', 900, pan);
        break;
      case 'hitmarker':
        this._tone(950, 0.025, 0.04 * volume, 'square', pan);
        break;
      case 'explosion':
        this._noise(1.2, 0.5 * volume, 'lowpass', 1500, pan, { attack: 0.004, endFreq: 80, q: 0.9 });
        this._tone(56, 1.1, 0.42 * volume, 'sine', pan, { endFreq: 24, attack: 0.003 });
        this._noise(0.3, 0.22 * volume, 'highpass', 1700, pan, { attack: 0.001, endFreq: 500 });
        break;
      case 'grenadeBounce':
        this._tone(340, 0.045, 0.05 * volume, 'square', pan, { endFreq: 220 });
        break;
      case 'throw':
        this._noise(0.18, 0.08 * volume, 'bandpass', 900, pan, { endFreq: 300, q: 1 });
        break;
      case 'prone':
        this._noise(0.18, 0.12 * volume, 'lowpass', 520, 0, { attack: 0.01, endFreq: 220 });
        this._tone(90, 0.12, 0.035 * volume, 'sine', 0, { endFreq: 60 });
        break;
      case 'stand':
        this._noise(0.15, 0.1 * volume, 'lowpass', 700, 0, { attack: 0.01, endFreq: 300 });
        this._tone(130, 0.1, 0.03 * volume, 'sine', 0, { endFreq: 90 });
        break;
      case 'smokeThrow':
        this._noise(0.16, 0.1 * volume, 'bandpass', 900, pan, { endFreq: 350, q: 1.2 });
        this._tone(220, 0.1, 0.035 * volume, 'triangle', pan, { endFreq: 120 });
        break;
      case 'smokePop': {
        const dur = 2.8;
        this._noise(dur, 0.18 * volume, 'lowpass', 1600, pan, { attack: 0.04, endFreq: 420, q: 0.9 });
        this._noise(dur * 0.7, 0.08 * volume, 'highpass', 900, pan, { attack: 0.08, endFreq: 260, delay: 0.1 });
        this._tone(300, 0.15, 0.045 * volume, 'sine', pan, { endFreq: 150 });
        break;
      }
      case 'knife':
        this._noise(0.08, 0.13 * volume, 'highpass', 2500, pan, { q: 0.8 });
        this._tone(320, 0.07, 0.05 * volume, 'sine', pan, { endFreq: 140 });
        break;
      case 'melee':
        this._noise(0.12, 0.17 * volume, 'lowpass', 1100, pan);
        break;
      case 'playerHurt':
        this._tone(110, 0.22, 0.09 * volume, 'sawtooth', 0, { endFreq: 60 });
        this._noise(0.18, 0.08 * volume, 'lowpass', 600, 0);
        break;
      case 'scream':
      case 'panic': {
        const base = rand(440, 740);
        this._tone(base, 0.42, 0.045 * volume, 'sawtooth', pan, { endFreq: base * rand(0.7, 1.2), attack: 0.02 });
        this._tone(base * 1.5, 0.28, 0.018 * volume, 'triangle', pan, { endFreq: base * 1.1, attack: 0.03 });
        break;
      }
      case 'down':
        this._noise(0.22, 0.18 * volume, 'lowpass', 500, pan);
        this._tone(88, 0.2, 0.1 * volume, 'sine', pan, { endFreq: 42 });
        break;
      case 'fall':
        this._noise(0.25, 0.2 * volume, 'lowpass', 420, pan);
        this._tone(64, 0.2, 0.1 * volume, 'sine', pan, { endFreq: 32 });
        break;
      case 'footstep':
        this._noise(0.045, 0.03 * volume, 'lowpass', 220, pan, { q: 1.2 });
        break;
      case 'jump':
        this._noise(0.08, 0.06 * volume, 'lowpass', 300, 0);
        break;
      case 'land':
        this._noise(0.12, 0.11 * volume, 'lowpass', 250, 0);
        this._tone(80, 0.1, 0.04 * volume, 'sine', 0, { endFreq: 45 });
        break;
      case 'pickup':
        this._tone(740, 0.09, 0.06 * volume, 'triangle', 0);
        this._tone(1110, 0.14, 0.05 * volume, 'triangle', 0, { delay: 0.07 });
        this._tone(1480, 0.15, 0.035 * volume, 'sine', 0, { delay: 0.14 });
        break;
      case 'armorEquip':
        this._tone(320, 0.08, 0.07 * volume, 'square', 0);
        this._noise(0.16, 0.1 * volume, 'bandpass', 1700, 0);
        this._tone(880, 0.16, 0.035 * volume, 'triangle', 0, { delay: 0.08 });
        break;
      case 'heal':
        this._tone(440, 0.16, 0.04 * volume, 'sine', 0);
        this._tone(660, 0.2, 0.035 * volume, 'sine', 0, { delay: 0.09 });
        break;
      case 'siren':
        this._siren(volume);
        break;
      case 'wave':
        this._tone(180, 0.3, 0.07 * volume, 'sawtooth', 0, { endFreq: 130 });
        this._tone(140, 0.45, 0.06 * volume, 'sawtooth', 0, { endFreq: 100, delay: 0.3 });
        break;
      case 'ui':
        this._tone(600, 0.045, 0.03 * volume, 'triangle', 0);
        break;
      case 'warning':
        this._tone(880, 0.08, 0.035 * volume, 'square', 0);
        this._tone(660, 0.1, 0.03 * volume, 'square', 0, { delay: 0.11 });
        break;
      case 'car':
        this._noise(1.4, 0.045 * volume, 'lowpass', 550, pan, { attack: 0.4, endFreq: 180 });
        break;
      default:
        break;
    }
  }

  _siren(volume = 0.2) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    const gain = ctx.createGain();
    const dur = 3.6;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, 0.035 * volume), now + 0.25);
    gain.gain.setValueAtTime(Math.max(0.001, 0.035 * volume), now + dur - 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    for (let t = 0; t < dur - 0.3; t += 0.55) {
      osc.frequency.setValueAtTime(660, now + t);
      osc.frequency.linearRampToValueAtTime(980, now + t + 0.26);
      osc.frequency.linearRampToValueAtTime(660, now + t + 0.52);
    }
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1400;
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + dur + 0.05);
  }

  footstepNear(human, speed, dt) {
    if (!this.ctx || speed < 0.2) return;
    if (human._stepTimer === undefined) human._stepTimer = rand(0.1, 0.35);
    human._stepTimer -= dt;
    if (human._stepTimer > 0) return;
    human._stepTimer = speed > 3.2 ? rand(0.28, 0.36) : rand(0.42, 0.56);
    const pos = human.root.position;
    const d = this.game.camera.position.distanceTo(pos);
    this.play('footstep', { volume: clamp(0.24 - d / 80, 0.02, 0.2), pan: this.panFor(pos) });
  }

  startBeam() {
    if (!this.ctx || this.beam || this.muted) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 72;
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 144;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 500;
    filter.Q.value = 3.5;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.gain.exponentialRampToValueAtTime(0.055, ctx.currentTime + 0.12);
    osc.connect(filter); osc2.connect(filter); filter.connect(gain).connect(this.master);
    osc.start(); osc2.start();
    this.beam = { osc, osc2, gain, filter };
  }

  updateBeam(active) {
    if (!this.ctx || !this.beam) return;
    const t = this.ctx.currentTime;
    const target = active ? 0.055 : 0.0001;
    this.beam.gain.gain.cancelScheduledValues(t);
    this.beam.gain.gain.linearRampToValueAtTime(target, t + 0.08);
    if (this.beam.filter) {
      this.beam.filter.frequency.cancelScheduledValues(t);
      this.beam.filter.frequency.linearRampToValueAtTime(active ? rand(420, 760) : 180, t + 0.1);
    }
  }

  stopBeam() {
    if (!this.ctx || !this.beam) return;
    const t = this.ctx.currentTime;
    const { osc, osc2, gain } = this.beam;
    gain.gain.cancelScheduledValues(t);
    gain.gain.linearRampToValueAtTime(0.0001, t + 0.12);
    try { osc.stop(t + 0.15); osc2.stop(t + 0.15); } catch (e) { /* noop */ }
    this.beam = null;
  }

  update(dt, wanted = 0) {
    if (!this.ctx) return;
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.ambientTimer = rand(8, 24);
      if (chance(0.55)) {
        this.play('car', { volume: rand(0.15, 0.4) * clamp(0.4 + wanted * 0.1, 0.4, 1), pan: rand(-0.9, 0.9) });
      } else {
        // distant bird chirps
        const pan = rand(-0.8, 0.8);
        const base = rand(1600, 2600);
        this._tone(base, 0.08, 0.008, 'sine', pan, { endFreq: base * 1.25 });
        setTimeout(() => this._tone(base * 1.15, 0.06, 0.006, 'sine', pan, { endFreq: base * 0.9 }), 130);
      }
    }
    if (wanted >= 3) {
      this.sirenTimer -= dt;
      if (this.sirenTimer <= 0) {
        this.sirenTimer = rand(22, 42);
        this._siren(rand(0.18, 0.36));
      }
    }
  }
}
