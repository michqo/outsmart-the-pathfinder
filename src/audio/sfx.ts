import { Mat } from '../world/materials';
import type { TimeOfDay } from '../render/timeOfDay';

/**
 * Tiny synth sounds, made on the fly with WebAudio (no sound files): blips for the UI,
 * per-material footsteps, digging and placing, and a quiet ambient bed (wind, birds by
 * day, crickets at night, a rumble on volcanic ground).
 * The context starts on the first user gesture (browsers require that); muting is remembered.
 */
export type Sound = 'place' | 'remove' | 'think' | 'dig' | 'pop' | 'bonk' | 'arrive' | 'stuck' | 'best' | 'click' | 'denied' | 'step';

/** What the ambient bed should sound like (null = silence, e.g. hand-made courses). */
export interface Ambience {
  time: TimeOfDay;
  /** Share of the island in each biome, by Biome id. */
  forest: number;
  snowy: number;
  desert: number;
  volcanic: number;
  wet: number;
}

const KEY = 'pathfinder.muted';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastThink = 0;
  private thinkPitch = 0;
  private lastStep = 0;
  private wind: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private ambience: Ambience | null = null;
  private ambientBus: GainNode | null = null;
  private ambientTimer = 0;
  muted: boolean;

  constructor() {
    let m = false;
    try {
      m = localStorage.getItem(KEY) === '1';
    } catch {
      // ignore
    }
    this.muted = m;
    const unlock = () => {
      this.ensure();
      void this.ctx?.resume();
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ambientBus && this.ctx) this.ambientBus.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.3);
    try {
      localStorage.setItem(KEY, m ? '1' : '0');
    } catch {
      // ignore
    }
  }

  /** `mat`: the material involved (placed, removed, dug, or stepped on), for its timbre. */
  play(s: Sound, mat?: number): void {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    switch (s) {
      case 'place':
        this.tone(520, 780, t, 0.07, 'triangle', 0.18);
        this.texture(mat, t, 0.9);
        break;
      case 'remove':
        this.tone(420, 240, t, 0.08, 'triangle', 0.16);
        this.hiss(t, 0.05, 2400, 0.06);
        this.texture(mat, t, 0.7);
        break;
      case 'step':
        if (t - this.lastStep < 0.12) return;
        this.lastStep = t;
        this.footstep(mat ?? Mat.Grass, t);
        break;
      case 'think': {
        // Soft ticks while the search runs, throttled, drifting up in pitch.
        if (t - this.lastThink < 0.07) return;
        this.lastThink = t;
        this.thinkPitch = (this.thinkPitch + 1) % 12;
        const f = 880 * Math.pow(2, [0, 3, 5, 7, 10, 12, 10, 7, 5, 3, 0, -2][this.thinkPitch] / 12);
        this.tone(f, f, t, 0.035, 'sine', 0.05);
        break;
      }
      case 'dig':
        if (mat === Mat.Timber) {
          // Wood: a hollow knock.
          this.tone(260, 170, t, 0.12, 'triangle', 0.2);
          this.hiss(t, 0.06, 700, 0.1);
        } else if (mat === Mat.Sand || mat === Mat.Snow) {
          this.hiss(t, 0.16, mat === Mat.Sand ? 2600 : 1800, 0.14);
        } else if (mat === Mat.Ice) {
          this.tone(2400, 1900, t, 0.08, 'sine', 0.1);
          this.hiss(t, 0.08, 5200, 0.08);
        } else {
          this.hiss(t, 0.12, mat === Mat.Stone ? 1400 : 900, 0.16);
          this.tone(mat === Mat.Stone ? 180 : 140, 80, t, 0.1, 'square', 0.06);
        }
        break;
      case 'pop':
        this.tone(300, 900, t, 0.06, 'sine', 0.2);
        break;
      case 'bonk':
        this.tone(220, 110, t, 0.16, 'square', 0.1);
        this.tone(180, 90, t + 0.05, 0.14, 'triangle', 0.14);
        break;
      case 'arrive':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, t + i * 0.09, 0.16, 'triangle', 0.18));
        break;
      case 'stuck':
        [392, 330, 262].forEach((f, i) => this.tone(f, f * 0.97, t + i * 0.12, 0.18, 'triangle', 0.16));
        break;
      case 'best':
        [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, f, t + 0.36 + i * 0.07, 0.2, 'sine', 0.14));
        break;
      case 'click':
        this.tone(900, 700, t, 0.03, 'sine', 0.1);
        break;
      case 'denied':
        this.tone(200, 190, t, 0.12, 'square', 0.07);
        this.tone(150, 140, t + 0.1, 0.14, 'square', 0.07);
        break;
    }
  }

  /** The material's own colour on top of a place/remove blip. */
  private texture(mat: number | undefined, t: number, k: number): void {
    switch (mat) {
      case Mat.Crystal: this.tone(1568, 1568, t + 0.02, 0.25, 'sine', 0.06 * k); break;
      case Mat.Water: this.tone(420, 900, t, 0.09, 'sine', 0.12 * k); break;
      case Mat.Sand: this.hiss(t, 0.12, 3200, 0.08 * k); break;
      case Mat.Mud: this.tone(160, 90, t, 0.12, 'sine', 0.16 * k); this.hiss(t, 0.06, 500, 0.06 * k); break;
      case Mat.Leaves: this.hiss(t, 0.1, 4200, 0.07 * k); this.hiss(t + 0.04, 0.08, 3600, 0.05 * k); break;
      case Mat.Stone: this.hiss(t, 0.03, 3000, 0.06 * k); break;
    }
  }

  /** A footstep that sounds like what the bot walks on. */
  private footstep(floor: number, t: number): void {
    const v = 0.5 + Math.random() * 0.25;
    switch (floor) {
      case Mat.Water: this.hiss(t, 0.14, 1100, 0.07 * v); this.tone(380, 240, t, 0.08, 'sine', 0.05 * v); break;
      case Mat.Sand: this.hiss(t, 0.09, 2600, 0.06 * v); break;
      case Mat.Snow: this.hiss(t, 0.07, 1700, 0.08 * v); this.hiss(t + 0.03, 0.05, 2300, 0.05 * v); break;
      case Mat.Ice: this.tone(2300, 2100, t, 0.03, 'sine', 0.04 * v); this.hiss(t, 0.02, 6000, 0.03 * v); break;
      case Mat.Mud: this.tone(150, 80, t, 0.09, 'sine', 0.08 * v); this.hiss(t, 0.05, 450, 0.05 * v); break;
      case Mat.Stone: case Mat.Crystal: case Mat.Placed: case Mat.Timber:
        this.hiss(t, 0.025, 3200, 0.06 * v); this.tone(700, 500, t, 0.03, 'triangle', 0.03 * v); break;
      default: this.hiss(t, 0.05, 1200, 0.05 * v); this.tone(120, 80, t, 0.05, 'sine', 0.05 * v); // moss, clay
    }
  }

  /** Sets the ambient bed for the current island (null = none). */
  setAmbience(a: Ambience | null): void {
    this.ambience = a;
    if (this.ctx) this.startAmbience();
  }

  private startAmbience(): void {
    const ctx = this.ctx!;
    if (!this.ambientBus) {
      this.ambientBus = ctx.createGain();
      this.ambientBus.gain.value = this.muted ? 0 : 1;
      this.ambientBus.connect(this.master!);
    }
    const a = this.ambience;
    // Wind: long looping noise through a slowly breathing low-pass.
    if (!this.wind) {
      const len = ctx.sampleRate * 4;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let b = 0;
      for (let i = 0; i < len; i++) d[i] = b = b * 0.97 + (Math.random() * 2 - 1) * 0.03; // brown-ish
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 500;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.ambientBus);
      src.start();
      this.wind = { src, gain, filter };
    }
    const windLevel = !a ? 0 : 0.5 + a.snowy * 1.2 + a.desert * 0.6;
    this.wind.gain.gain.setTargetAtTime(windLevel * 0.9, ctx.currentTime, 1.5);
    clearTimeout(this.ambientTimer);
    if (a) this.ambientTick();
  }

  /** Every second or so: maybe a bird, a cricket chorus, or a volcanic crackle. */
  private ambientTick(): void {
    const ctx = this.ctx, a = this.ambience;
    if (!ctx || !a) return;
    const t = ctx.currentTime + 0.05;
    if (this.wind) {
      // Gusts.
      const f = 350 + Math.random() * 450 + a.snowy * 300;
      this.wind.filter.frequency.setTargetAtTime(f, t, 1.2);
    }
    if (ctx.state === 'running' && !this.muted) {
      const day = a.time === 'day' || a.time === 'dawn';
      const birds = (day ? 0.35 : a.time === 'dusk' ? 0.1 : 0) * (0.4 + a.forest * 2 + a.wet) * (1 - a.desert) * (1 - a.snowy * 0.8);
      if (Math.random() < birds) this.bird(t);
      const crickets = a.time === 'night' ? 0.6 : a.time === 'dusk' ? 0.25 : 0;
      if (Math.random() < crickets * (1 - a.snowy)) this.crickets(t);
      if (Math.random() < a.volcanic * 1.5) this.crackle(t);
    }
    this.ambientTimer = window.setTimeout(() => this.ambientTick(), 700 + Math.random() * 900);
  }

  private bird(t: number): void {
    const base = 2400 + Math.random() * 1600;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const f = base * (1 + (Math.random() - 0.3) * 0.25);
      this.tone(f, f * (Math.random() < 0.5 ? 1.25 : 0.8), t + i * 0.11, 0.07, 'sine', 0.025, this.ambientBus!);
    }
  }

  private crickets(t: number): void {
    const f = 4300 + Math.random() * 600;
    for (let i = 0; i < 6; i++) this.tone(f, f, t + i * 0.045, 0.02, 'sine', 0.012, this.ambientBus!);
  }

  private crackle(t: number): void {
    for (let i = 0; i < 3; i++) this.hiss(t + Math.random() * 0.3, 0.02, 1500 + Math.random() * 2500, 0.05, this.ambientBus!);
    this.tone(55, 40, t, 0.6, 'sine', 0.05, this.ambientBus!);
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);
    const n = ctx.sampleRate * 0.3;
    this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.startAmbience();
    return ctx;
  }

  /** A short pitched blip sliding from f0 to f1 with a quick attack and exponential decay. */
  private tone(f0: number, f1: number, t: number, dur: number, type: OscillatorType, vol: number, out: AudioNode = this.master!): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Filtered noise: digging crunch, removal scrape. */
  private hiss(t: number, dur: number, freq: number, vol: number, out: AudioNode = this.master!): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t);
    src.stop(t + dur);
  }
}
