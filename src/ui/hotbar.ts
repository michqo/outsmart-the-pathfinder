import type { Tool } from '../edit/editor';
import { Mat } from '../world/materials';

export const HOTBAR_STYLES = { Chips: 'chips', Pebbles: 'pebbles' } as const;
export type HotbarStyle = (typeof HOTBAR_STYLES)[keyof typeof HOTBAR_STYLES];

/** Player-facing names. Deliberately our own vocabulary. */
const NAMES: Partial<Record<Mat, string>> = {
  [Mat.Grass]: 'Moss',
  [Mat.Soil]: 'Clay',
  [Mat.Stone]: 'Slate',
  [Mat.Crystal]: 'Crystal',
  [Mat.Water]: 'Water',
};

const CSS = /* css */ `
.hb { position: fixed; z-index: 20; left: 50%; bottom: 18px; transform: translateX(-50%); display: flex; align-items: center;
  gap: 8px; font: 600 12px/1.2 ui-rounded, 'SF Pro Rounded', system-ui, sans-serif; color: #3b3355; user-select: none; }
.hb button { font: inherit; color: inherit; border: 0; cursor: pointer; }
.hb .sep { width: 1px; align-self: stretch; background: #3b335522; margin: 4px 4px; }
.hb .tool { display: grid; place-items: center; width: 34px; height: 34px; font-size: 18px; }

/* Chips: one frosted bar with pill buttons */
.hb.chips { padding: 6px; border-radius: 18px; background: #ffffffb8; backdrop-filter: blur(10px);
  box-shadow: 0 6px 24px #5a4a7a22, inset 0 0 0 1px #ffffff; }
.hb.chips .mat { display: flex; align-items: center; gap: 6px; padding: 7px 12px 7px 7px; border-radius: 12px; background: transparent; transition: background .15s, transform .15s; }
.hb.chips .mat .sw { width: 18px; height: 18px; border-radius: 6px; box-shadow: inset 0 -3px 0 #0000001c; }
.hb.chips .mat .key { opacity: .4; font-size: 10px; }
.hb.chips .mat.on { background: #fff; box-shadow: 0 2px 8px #5a4a7a26; transform: translateY(-2px); }
.hb.chips .tool { border-radius: 12px; background: transparent; }
.hb.chips .tool.on { background: #3b3355; color: #fff; }

/* Pebbles: separate floating round stones, name shown under the active one */
.hb.pebbles { gap: 12px; bottom: 34px; }
.hb.pebbles .mat { position: relative; width: 46px; height: 46px; border-radius: 50%; padding: 0; background: transparent;
  transition: transform .18s cubic-bezier(.3,1.6,.5,1); }
.hb.pebbles .mat .sw { position: absolute; inset: 0; border-radius: 50% 50% 46% 46%;
  box-shadow: inset -5px -7px 0 #00000022, inset 4px 5px 0 #ffffff55, 0 6px 14px #5a4a7a33; }
.hb.pebbles .mat .label { position: absolute; top: 52px; left: 50%; transform: translateX(-50%); white-space: nowrap; opacity: 0; transition: opacity .15s; }
.hb.pebbles .mat .key { position: absolute; right: -2px; top: -4px; font-size: 10px; background: #fff; border-radius: 8px; padding: 1px 5px; box-shadow: 0 1px 4px #0002; }
.hb.pebbles .mat.on { transform: translateY(-8px) scale(1.12); }
.hb.pebbles .mat.on .label { opacity: 1; }
.hb.pebbles .tool { border-radius: 50%; background: #ffffffc8; box-shadow: 0 4px 12px #5a4a7a22; }
.hb.pebbles .tool.on { background: #3b3355; color: #fff; }
.hb.pebbles .sep { display: none; }

.hb-hint { position: fixed; left: 14px; bottom: 14px; max-width: calc(50vw - 330px); font: 500 11px/1.6 ui-rounded, system-ui, sans-serif; color: #3b3355aa; user-select: none; pointer-events: none; }
.hb-hint b { color: #3b3355; font-weight: 600; }
@media (max-width: 1180px) { .hb-hint { display: none; } }
@media (max-width: 720px), (pointer: coarse) {
  .hb { bottom: 10px; gap: 4px; }
  .hb.chips { padding: 5px; }
  .hb.chips .mat { padding: 7px; }
  .hb.chips .mat .sw { width: 24px; height: 24px; }
  .hb .mat .label, .hb .mat .key { display: none; }
  .hb.pebbles .mat { width: 38px; height: 38px; }
  .hb .tool { width: 38px; height: 38px; }
}
`;

export class Hotbar {
  readonly el = document.createElement('div');
  onSelect: (m: Mat) => void = () => {};
  onTool: (t: Tool) => void = () => {};
  onUndo: () => void = () => {};
  private mats = new Map<Mat, HTMLButtonElement>();
  private tools = new Map<Tool, HTMLButtonElement>();

  constructor(materials: Mat[], style: HotbarStyle) {
    const css = document.createElement('style');
    css.textContent = CSS;
    document.head.appendChild(css);

    materials.forEach((m, i) => {
      const b = document.createElement('button');
      b.className = 'mat';
      b.title = `${NAMES[m]} (${i + 1})`;
      b.innerHTML = `<span class="sw"></span><span class="label">${NAMES[m]}</span><span class="key">${i + 1}</span>`;
      b.addEventListener('click', () => this.onSelect(m));
      this.mats.set(m, b);
      this.el.appendChild(b);
    });
    const sep = document.createElement('div');
    sep.className = 'sep';
    this.el.appendChild(sep);
    for (const [t, glyph, title] of [
      ['place', '+', 'Place (E)'],
      ['remove', '−', 'Remove (R)'],
    ] as const) {
      const b = document.createElement('button');
      b.className = 'tool';
      b.textContent = glyph;
      b.title = title;
      b.addEventListener('click', () => this.onTool(t));
      this.tools.set(t, b);
      this.el.appendChild(b);
    }
    const undo = document.createElement('button');
    undo.className = 'tool undo';
    undo.textContent = '↶';
    undo.title = 'Undo (⌘Z)';
    undo.addEventListener('click', () => this.onUndo());
    this.el.appendChild(undo);
    this.setStyle(style);
    document.body.appendChild(this.el);

    const hint = document.createElement('div');
    hint.className = 'hb-hint';
    hint.innerHTML =
      '<b>Click</b> place · <b>Right / two-finger click</b> remove · <b>Shift-drag</b> fill (<b>+⌥</b> wall)<br>' +
      '<b>Drag</b> orbit · <b>1–5</b> material · <b>E / R</b> place / remove · <b>F</b> or <b>⌥-click</b> focus · <b>⌘Z</b> undo';
    document.body.appendChild(hint);
  }

  setStyle(style: HotbarStyle): void {
    this.el.className = `hb ${style}`;
  }

  setColors(colorOf: (m: Mat) => number): void {
    for (const [m, b] of this.mats) {
      const hex = '#' + colorOf(m).toString(16).padStart(6, '0');
      (b.querySelector('.sw') as HTMLElement).style.background = hex;
    }
  }

  setState(material: Mat, tool: Tool): void {
    for (const [m, b] of this.mats) b.classList.toggle('on', m === material && tool === 'place');
    for (const [t, b] of this.tools) b.classList.toggle('on', t === tool);
  }
}
