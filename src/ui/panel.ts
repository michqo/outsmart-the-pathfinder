import { Pane } from 'tweakpane';
import { GRASS_STYLES, PALETTES, type GrassStyle } from '../palette';
import { BOT_MODELS, type BotModel } from '../render/bot';
import { VIZ_STYLES, type VizStyle } from '../render/searchViz';
import { HOTBAR_STYLES, type HotbarStyle } from './hotbar';

export interface Settings {
  palette: string;
  grassStyle: GrassStyle;
  hotbarStyle: HotbarStyle;
  revealSeconds: number;
  vizStyle: VizStyle;
  botModel: BotModel;
  inventory: number;
  ao: boolean;
  aoStrength: number;
  jitter: number;
  shadows: boolean;
  wireframe: boolean;
  exposure: number;
  seed: number;
}

export interface Stats {
  fps: number;
  frameMs: number;
  triangles: number;
  remeshMs: number;
  undersideMs: number;
}

export interface PanelHandlers {
  onPalette(): void;
  onHotbarStyle(): void;
  onMeshOptions(): void;
  onJitter(): void;
  onShadows(): void;
  onWireframe(): void;
  onExposure(): void;
  onRegenerate(): void;
  onStress(): void;
  onGauntlet(): void;
  onReveal(): void;
  onVizStyle(): void;
  onBotModel(): void;
  onInventory(): void;
}

export function createPanel(settings: Settings, stats: Stats, h: PanelHandlers): Pane {
  const pane = new Pane({ title: 'Outsmart the Pathfinder' });

  const perf = pane.addFolder({ title: 'Performance' });
  perf.addBinding(stats, 'fps', { readonly: true, view: 'graph', min: 0, max: 130, label: 'fps' });
  perf.addBinding(stats, 'fps', { readonly: true, format: (v: number) => v.toFixed(0), label: '' });
  perf.addBinding(stats, 'frameMs', { readonly: true, format: (v: number) => v.toFixed(2), label: 'frame ms' });
  perf.addBinding(stats, 'triangles', { readonly: true, format: (v: number) => v.toFixed(0), label: 'triangles' });
  perf.addBinding(stats, 'remeshMs', { readonly: true, format: (v: number) => v.toFixed(2), label: 'remesh ms' });
  perf.addBinding(stats, 'undersideMs', { readonly: true, format: (v: number) => v.toFixed(1), label: 'underside ms' });

  const search = pane.addFolder({ title: 'Search' });
  search.addBinding(settings, 'revealSeconds', { label: 'reveal (s)', min: 0, max: 6, step: 0.1 }).on('change', h.onReveal);
  search.addBinding(settings, 'vizStyle', { label: 'viz', options: VIZ_STYLES }).on('change', h.onVizStyle);
  search.addBinding(settings, 'inventory', { label: 'blocks', min: 0, max: 32, step: 1 }).on('change', h.onInventory);
  search.addBinding(settings, 'botModel', { label: 'robot', options: BOT_MODELS }).on('change', h.onBotModel);

  const look = pane.addFolder({ title: 'Look', expanded: false });
  const paletteOptions = Object.fromEntries(Object.entries(PALETTES).map(([k, p]) => [p.name, k]));
  look.addBinding(settings, 'palette', { options: paletteOptions }).on('change', h.onPalette);
  look.addBinding(settings, 'grassStyle', { label: 'grass', options: GRASS_STYLES }).on('change', h.onPalette);
  look.addBinding(settings, 'hotbarStyle', { label: 'hotbar', options: HOTBAR_STYLES }).on('change', h.onHotbarStyle);
  look.addBinding(settings, 'ao', { label: 'AO' }).on('change', h.onMeshOptions);
  look.addBinding(settings, 'aoStrength', { label: 'AO strength', min: 0, max: 0.8, step: 0.01 }).on('change', h.onMeshOptions);
  look.addBinding(settings, 'jitter', { label: 'block jitter', min: 0, max: 0.25, step: 0.005 }).on('change', h.onJitter);
  look.addBinding(settings, 'shadows').on('change', h.onShadows);
  look.addBinding(settings, 'exposure', { min: 0.5, max: 1.6, step: 0.01 }).on('change', h.onExposure);

  const debug = pane.addFolder({ title: 'Debug', expanded: false });
  debug.addBinding(settings, 'wireframe').on('change', h.onWireframe);
  debug.addBinding(settings, 'seed', { min: 1, max: 99, step: 1 });
  debug.addButton({ title: 'Regenerate island' }).on('click', h.onRegenerate);
  debug.addButton({ title: 'Gauntlet (all moves)' }).on('click', h.onGauntlet);
  debug.addButton({ title: 'Stress level (9 floors)' }).on('click', h.onStress);

  return pane;
}
