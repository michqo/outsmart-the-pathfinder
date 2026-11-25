/**
 * Tiny synth blips, made on the fly with WebAudio (no sound files).
 * The context starts on the first user gesture (browsers require that); muting is remembered.
 */
export type Sound = 'place' | 'remove' | 'think' | 'dig' | 'pop' | 'bonk' | 'arrive' | 'stuck' | 'best' | 'click' | 'denied';

const KEY = 'pathfinder.muted';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastThink = 0;
  private thinkPitch = 0;
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
    try {
      localStorage.setItem(KEY, m ? '1' : '0');
    } catch {
      // ignore
    }
  }

  play(s: Sound): void {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    switch (s) {
      case 'place':
        this.tone(520, 780, t, 0.07, 'triangle', 0.22);
        break;
      case 'remove':
        this.tone(420, 240, t, 0.08, 'triangle', 0.2);
        this.hiss(t, 0.05, 2400, 0.06);
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
        this.hiss(t, 0.12, 900, 0.16);
        this.tone(140, 80, t, 0.1, 'square', 0.06);
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
    return ctx;
  }

  /** A short pitched blip sliding from f0 to f1 with a quick attack and exponential decay. */
  private tone(f0: number, f1: number, t: number, dur: number, type: OscillatorType, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Filtered noise: digging crunch, removal scrape. */
  private hiss(t: number, dur: number, freq: number, vol: number): void {
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
    src.connect(f).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + dur);
  }
}
