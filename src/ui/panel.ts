import { Pane } from 'tweakpane';
import { GRASS_STYLES, PALETTES, type GrassStyle } from '../palette';
import type { BotModel } from '../render/bot';
import { VIZ_STYLES, type VizStyle } from '../render/searchViz';

export interface Settings {
  envIntensity: number;
  realism: number;
  clouds: number;
  wind: number;
  palette: string;
  grassStyle: GrassStyle;
  revealSeconds: number;
  vizStyle: VizStyle;
  /** Chosen in the character picker (not in this panel). */
  botModel: BotModel;
  ao: boolean;
  aoStrength: number;
  jitter: number;
  shadows: boolean;
  wireframe: boolean;
  exposure: number;
}

export interface Stats {
  fps: number;
  frameMs: number;
  triangles: number;
  remeshMs: number;
  undersideMs: number;
}

export interface PanelHandlers {
  onEnvIntensity(): void;
  onRealism(): void;
  onClouds(): void;
  onPalette(): void;
  onMeshOptions(): void;
  onJitter(): void;
  onShadows(): void;
  onWireframe(): void;
  onExposure(): void;
  onReveal(): void;
  onVizStyle(): void;
}

export function createPanel(settings: Settings, stats: Stats, h: PanelHandlers): Pane {
  // Players get the search view; the look tuning, stats and debug are for development (or ?debug).
  const dev = import.meta.env.DEV || new URLSearchParams(location.search).has('debug');
  const pane = new Pane({ title: dev ? 'Outsmart the Pathfinder' : 'Settings', expanded: false });

  const perf = pane.addFolder({ title: 'Performance', hidden: !dev });
  perf.addBinding(stats, 'fps', { readonly: true, view: 'graph', min: 0, max: 130, label: 'fps' });
  perf.addBinding(stats, 'fps', { readonly: true, format: (v: number) => v.toFixed(0), label: '' });
  perf.addBinding(stats, 'frameMs', { readonly: true, format: (v: number) => v.toFixed(2), label: 'frame ms' });
  perf.addBinding(stats, 'triangles', { readonly: true, format: (v: number) => v.toFixed(0), label: 'triangles' });
  perf.addBinding(stats, 'remeshMs', { readonly: true, format: (v: number) => v.toFixed(2), label: 'remesh ms' });
  perf.addBinding(stats, 'undersideMs', { readonly: true, format: (v: number) => v.toFixed(1), label: 'underside ms' });

  pane.addBinding(settings, 'revealSeconds', { label: 'search reveal (s)', min: 0, max: 6, step: 0.1 }).on('change', h.onReveal);
  pane.addBinding(settings, 'vizStyle', { label: 'search view', options: VIZ_STYLES }).on('change', h.onVizStyle);

  const look = pane.addFolder({ title: 'Look', expanded: false, hidden: !dev });
  const paletteOptions = Object.fromEntries(Object.entries(PALETTES).map(([k, p]) => [p.name, k]));
  look.addBinding(settings, 'palette', { options: paletteOptions }).on('change', h.onPalette);
  look.addBinding(settings, 'grassStyle', { label: 'grass', options: GRASS_STYLES }).on('change', h.onPalette);
  look.addBinding(settings, 'envIntensity', { label: 'sky light', min: 0, max: 2, step: 0.01 }).on('change', h.onEnvIntensity);
  look.addBinding(settings, 'realism', { label: 'texture realism', min: 0, max: 1, step: 0.01 }).on('change', h.onRealism);
  look.addBinding(settings, 'clouds', { label: 'cloud cover', min: 0, max: 1, step: 0.01 }).on('change', h.onClouds);
  look.addBinding(settings, 'wind', { min: 0, max: 4, step: 0.05 }).on('change', h.onClouds);
  look.addBinding(settings, 'ao', { label: 'AO' }).on('change', h.onMeshOptions);
  look.addBinding(settings, 'aoStrength', { label: 'AO strength', min: 0, max: 0.8, step: 0.01 }).on('change', h.onMeshOptions);
  look.addBinding(settings, 'jitter', { label: 'block jitter', min: 0, max: 0.25, step: 0.005 }).on('change', h.onJitter);
  look.addBinding(settings, 'shadows').on('change', h.onShadows);
  look.addBinding(settings, 'exposure', { min: 0.5, max: 1.6, step: 0.01 }).on('change', h.onExposure);
  look.addBinding(settings, 'wireframe').on('change', h.onWireframe);

  return pane;
}
