import { Mat } from '../world/materials';

/**
 * Recorded sound effects: footsteps by surface, digging, placing and a few UI cues.
 * The clips are Kenney's CC0 "Impact Sounds" and "Interface Sounds" (public/sfx).
 * Each cue picks one of three takes and nudges its pitch, so repeats don't sound canned.
 * The audio context and the clips load on the first user gesture (browsers require that);
 * muting is remembered.
 */
export type Sound = 'place' | 'remove' | 'think' | 'dig' | 'pop' | 'bonk' | 'arrive' | 'stuck' | 'best' | 'denied' | 'step';

const KEY = 'pathfinder.muted';
const TAKES = ['000', '001', '002'];
const IMPACTS = ['footstep_grass', 'footstep_snow', 'footstep_concrete', 'footstep_wood', 'footstep_carpet', 'impactSoft_medium', 'impactSoft_heavy',
  'impactGlass_light', 'impactWood_light', 'impactWood_medium', 'impactMining', 'impactPlate_light', 'impactPunch_medium'];
const CUES = ['tick_001', 'tick_002', 'confirmation_002', 'error_004', 'error_006', 'bong_001'];

/** A clip family (three takes) or a single cue, with its volume and pitch. */
interface Shot {
  clip: string;
  gain: number;
  rate?: number;
}

/** What a footstep on a floor sounds like. */
function stepOn(floor: number): Shot {
  switch (floor) {
    case Mat.Snow: return { clip: 'footstep_snow', gain: 0.5 };
    case Mat.Sand: case Mat.Mud: return { clip: 'footstep_carpet', gain: 0.6, rate: floor === Mat.Mud ? 0.8 : 1 };
    case Mat.Water: return { clip: 'footstep_carpet', gain: 0.45, rate: 0.7 };
    case Mat.Timber: return { clip: 'footstep_wood', gain: 0.5 };
    case Mat.Stone: case Mat.Crystal: case Mat.Placed: case Mat.Magma: return { clip: 'footstep_concrete', gain: 0.45 };
    default: return { clip: 'footstep_grass', gain: 0.55 }; // moss, clay, leaves
  }
}

/** A block of this material being put down (or, faster and lighter, taken away). */
function blockOf(mat: number | undefined): Shot {
  switch (mat) {
    case Mat.Crystal: return { clip: 'impactGlass_light', gain: 0.5 };
    case Mat.Timber: return { clip: 'impactWood_light', gain: 0.7 };
    case Mat.Stone: case Mat.Magma: return { clip: 'impactPlate_light', gain: 0.45, rate: 0.8 };
    case Mat.Snow: return { clip: 'footstep_snow', gain: 0.7 };
    case Mat.Sand: return { clip: 'footstep_carpet', gain: 0.8 };
    case Mat.Water: return { clip: 'footstep_carpet', gain: 0.6, rate: 0.7 };
    case Mat.Leaves: return { clip: 'footstep_grass', gain: 0.8, rate: 1.2 };
    default: return { clip: 'impactSoft_medium', gain: 0.8 }; // moss, clay, mud, placed blocks
  }
}

/** The bot digging into a block. */
function digInto(mat: number | undefined): Shot {
  switch (mat) {
    case Mat.Timber: return { clip: 'impactWood_medium', gain: 0.6 };
    case Mat.Sand: case Mat.Snow: return { clip: mat === Mat.Sand ? 'footstep_carpet' : 'footstep_snow', gain: 0.8 };
    case Mat.Leaves: return { clip: 'footstep_grass', gain: 0.8, rate: 1.2 };
    case Mat.Grass: case Mat.Soil: case Mat.Mud: return { clip: 'impactMining', gain: 0.5, rate: 0.85 };
    default: return { clip: 'impactMining', gain: 0.6 }; // stone
  }
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private lastThink = 0;
  private thinkStep = 0;
  private lastStep = 0;
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

  /** `mat`: the material involved (placed, removed, dug, or stepped on), for its sound. */
  play(s: Sound, mat?: number): void {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    switch (s) {
      case 'place': return this.shoot(blockOf(mat));
      case 'remove': {
        const b = blockOf(mat);
        return this.shoot({ ...b, gain: b.gain * 0.7, rate: (b.rate ?? 1) * 1.2 });
      }
      case 'pop': return this.shoot(blockOf(Mat.Placed));
      case 'step':
        if (t - this.lastStep < 0.12) return;
        this.lastStep = t;
        return this.shoot(stepOn(mat ?? Mat.Grass));
      case 'dig': return this.shoot(digInto(mat));
      case 'think': {
        // Soft ticks while the search runs, throttled, climbing a little in pitch.
        if (t - this.lastThink < 0.08) return;
        this.lastThink = t;
        this.thinkStep = (this.thinkStep + 1) % 8;
        return this.cue(this.thinkStep % 2 ? 'tick_001' : 'tick_002', 0.18, 1 + this.thinkStep * 0.03);
      }
      case 'bonk': return this.shoot({ clip: 'impactPunch_medium', gain: 0.6 });
      case 'arrive': return this.cue('confirmation_002', 0.5);
      case 'stuck': return this.cue('error_006', 0.45);
      case 'denied': return this.cue('error_004', 0.4);
      case 'best': return this.cue('bong_001', 0.5);
    }
  }

  /** One of the three takes of a clip family, slightly detuned. */
  private shoot(s: Shot): void {
    const take = TAKES[Math.floor(Math.random() * TAKES.length)];
    this.cue(`${s.clip}_${take}`, s.gain, (s.rate ?? 1) * (0.94 + Math.random() * 0.12));
  }

  private cue(name: string, gain: number, rate = 1): void {
    const buf = this.buffers.get(name);
    if (!buf || !this.ctx || !this.master) return; // still loading (or failed to decode)
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master);
    src.start();
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext();
    } catch {
      return null;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
    const names = [...IMPACTS.flatMap((n) => TAKES.map((t) => `${n}_${t}`)), ...CUES];
    for (const name of names) {
      fetch(`${import.meta.env.BASE_URL}sfx/${name}.ogg`)
        .then((r) => r.arrayBuffer())
        .then((data) => this.ctx!.decodeAudioData(data))
        .then((buf) => this.buffers.set(name, buf))
        .catch(() => console.warn(`Sound ${name} could not be loaded.`));
    }
    return this.ctx;
  }
}
