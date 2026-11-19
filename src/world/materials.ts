/** Block materials. Ids are stored in the world's Uint8Array, so keep them small and stable. */
export const Mat = {
  Air: 0,
  Grass: 1,
  Soil: 2,
  Stone: 3,
  Crystal: 4,
  Water: 5,
  Placed: 6,
} as const;
export type Mat = (typeof Mat)[keyof typeof Mat];

export const MAT_COUNT = 7;
export const MAT_KEYS = ['air', 'grass', 'soil', 'stone', 'crystal', 'water', 'placed'] as const;
export type MatKey = (typeof MAT_KEYS)[number];

/** 1 = blocks light and hides neighbouring faces. Indexed by Mat id. */
export const OPAQUE = Uint8Array.from([0, 1, 1, 1, 1, 0, 1]);
