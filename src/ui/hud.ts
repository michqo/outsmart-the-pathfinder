const CSS = /* css */ `
.hud { position: fixed; left: 50%; top: 12px; transform: translateX(-50%); display: flex; align-items: center; gap: 14px;
  padding: 8px 16px; border-radius: 16px; background: #ffffffb8; backdrop-filter: blur(10px);
  box-shadow: 0 6px 24px #5a4a7a22, inset 0 0 0 1px #fff; font: 600 12px/1.2 ui-rounded, 'SF Pro Rounded', system-ui, sans-serif;
  color: #3b3355; user-select: none; white-space: nowrap; }
.hud .status { display: flex; align-items: center; gap: 6px; min-width: 92px; }
.hud .dot { width: 8px; height: 8px; border-radius: 50%; background: #b9b3c9; }
.hud .dot.searching, .hud .dot.replanning { background: #3fd6f0; animation: hudpulse .6s infinite alternate; }
.hud .dot.walking { background: #ff8f78; }
.hud .dot.happy { background: #8fd46f; }
.hud .dot.stuck { background: #e0475a; }
@keyframes hudpulse { to { transform: scale(1.5); opacity: .6; } }
.hud .stat { display: flex; flex-direction: column; align-items: center; }
.hud .sep { width: 1px; align-self: stretch; background: #3b335522; }
.hud .stat b { font-size: 15px; font-variant-numeric: tabular-nums; }
.hud .stat span { font-size: 9px; opacity: .55; text-transform: uppercase; letter-spacing: .06em; }
.hud kbd { font: inherit; padding: 2px 7px; border-radius: 6px; background: #3b3355; color: #fff; }
@media (max-width: 720px) { .hud { top: auto; bottom: 84px; } }
`;

export type HudStatus = 'ready' | 'searching' | 'walking' | 'happy' | 'stuck' | 'replanning';

const LABEL: Record<HudStatus, string> = {
  ready: 'Ready',
  searching: 'Thinking…',
  walking: 'Walking',
  happy: 'Made it!',
  stuck: 'No path',
  replanning: 'Replanning…',
};

export interface HudStats {
  expanded: number;
  pathLength: number;
  cost: number;
  ms: number;
  blocks: string;
  dug: number;
  built: number;
  replans: number;
}

/** The score strip: status plus the numbers that make the "make it work hard" game. */
export class Hud {
  private el = document.createElement('div');
  private dot: HTMLElement;
  private label: HTMLElement;
  private values: Record<keyof HudStats, HTMLElement>;

  constructor() {
    const css = document.createElement('style');
    css.textContent = CSS;
    document.head.appendChild(css);
    this.el.className = 'hud';
    const stat = (k: string, name: string) => `<div class="stat"><b data-k="${k}">–</b><span>${name}</span></div>`;
    this.el.innerHTML =
      `<div class="status"><i class="dot"></i><span class="label"></span></div>` +
      stat('expanded', 'nodes') + stat('pathLength', 'steps') + stat('cost', 'cost') + stat('ms', 'ms') +
      `<i class="sep"></i>` + stat('blocks', 'blocks') + stat('dug', 'dug') + stat('built', 'built') + stat('replans', 'replans') +
      `<kbd>Space</kbd>`;
    document.body.appendChild(this.el);
    this.dot = this.el.querySelector('.dot')!;
    this.label = this.el.querySelector('.label')!;
    const v = (k: string) => this.el.querySelector(`[data-k="${k}"]`) as HTMLElement;
    this.values = {
      expanded: v('expanded'), pathLength: v('pathLength'), cost: v('cost'), ms: v('ms'),
      blocks: v('blocks'), dug: v('dug'), built: v('built'), replans: v('replans'),
    };
    this.setStatus('ready');
  }

  setStatus(s: HudStatus): void {
    this.dot.className = `dot ${s}`;
    this.label.textContent = LABEL[s];
  }

  setStats(s: Partial<HudStats>): void {
    if (s.expanded !== undefined) this.values.expanded.textContent = s.expanded.toLocaleString();
    if (s.pathLength !== undefined) this.values.pathLength.textContent = s.pathLength ? String(s.pathLength) : '–';
    if (s.cost !== undefined) this.values.cost.textContent = s.cost ? s.cost.toFixed(1) : '–';
    if (s.ms !== undefined) this.values.ms.textContent = s.ms.toFixed(1);
    if (s.blocks !== undefined) this.values.blocks.textContent = s.blocks;
    if (s.dug !== undefined) this.values.dug.textContent = String(s.dug);
    if (s.built !== undefined) this.values.built.textContent = String(s.built);
    if (s.replans !== undefined) this.values.replans.textContent = String(s.replans);
  }
}
