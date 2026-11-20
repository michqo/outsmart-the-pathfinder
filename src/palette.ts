/**
 * All colours live here. Hex values are sRGB; three.js converts them to linear.
 * Each block has top / side / bottom shades so terraces read clearly.
 */
export interface FaceColors {
  top: number;
  side: number;
  bottom: number;
}

export interface Palette {
  name: string;
  blocks: {
    grass: FaceColors;
    soil: FaceColors;
    stone: FaceColors;
    crystal: FaceColors;
    placed: FaceColors;
  };
  water: number;
  waterOpacity: number;
  sky: { top: number; horizon: number; bottom: number };
  sun: { color: number; intensity: number };
  hemi: { sky: number; ground: number; intensity: number };
  cloud: number;
  rock: { top: number; tip: number };
}

const faces = (top: number, side: number, bottom = side): FaceColors => ({ top, side, bottom });

export const PALETTES: Record<string, Palette> = {
  meadow: {
    name: 'Meadow',
    blocks: {
      grass: faces(0xa6d98a, 0x8cc47a, 0xc89a78),
      soil: faces(0xe2b48c, 0xd8a47e),
      stone: faces(0xbdc0d6, 0xa9adc6, 0x9a9cb8),
      crystal: faces(0xd0c2ff, 0xb3a1f7),
      placed: faces(0xff9a52, 0xf2823c),
    },
    water: 0x86d6ea,
    waterOpacity: 0.72,
    sky: { top: 0x93c6f5, horizon: 0xffe6ef, bottom: 0xfff3df },
    sun: { color: 0xfff0d8, intensity: 3.2 },
    hemi: { sky: 0xc8dcff, ground: 0xf2d6c2, intensity: 0.85 },
    cloud: 0xffffff,
    rock: { top: 0xb7a6a8, tip: 0x7b7598 },
  },
  sorbet: {
    name: 'Sorbet',
    blocks: {
      grass: faces(0xbde8a8, 0xa2d79a, 0xf0b9a3),
      soil: faces(0xf4c0a6, 0xeab09a),
      stone: faces(0xd3c9e6, 0xbfb4d9, 0xaea3cc),
      crystal: faces(0x9fe0ff, 0x7ccdf5),
      placed: faces(0xff8a5c, 0xf07040),
    },
    water: 0xa4ece4,
    waterOpacity: 0.7,
    sky: { top: 0xffc4d8, horizon: 0xfff1d6, bottom: 0xffe2ee },
    sun: { color: 0xfff3e4, intensity: 3.0 },
    hemi: { sky: 0xe3d6ff, ground: 0xffe0cf, intensity: 0.85 },
    cloud: 0xfffaf6,
    rock: { top: 0xd5b3b8, tip: 0x9a88b8 },
  },
  dusk: {
    name: 'Dusk',
    blocks: {
      grass: faces(0x8ccb9e, 0x75b08f, 0xb98878),
      soil: faces(0xd09c84, 0xc08b78),
      stone: faces(0x9da1c4, 0x8a8db3, 0x7a7ca3),
      crystal: faces(0xf7b0ff, 0xe08ff0),
      placed: faces(0xffa04a, 0xf08a30),
    },
    water: 0x74b8dc,
    waterOpacity: 0.75,
    sky: { top: 0x6476bd, horizon: 0xf8b9aa, bottom: 0xf6d5bd },
    sun: { color: 0xffc89e, intensity: 3.3 },
    hemi: { sky: 0x9aa6e8, ground: 0xf0bfa6, intensity: 0.85 },
    cloud: 0xffe8e0,
    rock: { top: 0xa58f9c, tip: 0x585a8a },
  },
};

export type PaletteKey = keyof typeof PALETTES;

/**
 * How grass blocks look from the side. 'classic' (green sides over soil) reads
 * too much like a certain blocky game, so the alternatives move away from it.
 */
export const GRASS_STYLES = {
  'Moss drip': 'drip',
  'Top cap only': 'cap',
  'Sage moss': 'sage',
  'Classic (too familiar)': 'classic',
} as const;
export type GrassStyle = (typeof GRASS_STYLES)[keyof typeof GRASS_STYLES];

/** Returns [top, sideUpper, bottom, sideLower] for grass under a given style. */
export function grassFaces(p: Palette, style: GrassStyle): [number, number, number, number] {
  const g = p.blocks.grass, soil = p.blocks.soil;
  switch (style) {
    case 'classic':
      return [g.top, g.side, g.bottom, g.side];
    case 'cap':
      return [g.top, soil.side, g.bottom, soil.side];
    case 'drip':
      return [g.top, g.side, g.bottom, soil.side];
    case 'sage':
      return [0xa9d8c0, 0x93c6b2, g.bottom, soil.side];
  }
}
