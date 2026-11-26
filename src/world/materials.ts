/** Block materials. Ids are stored in the world's Uint8Array, so keep them small and stable. */
export const Mat = {
  Air: 0,
  Grass: 1,
  Soil: 2,
  Stone: 3,
  Crystal: 4,
  Water: 5,
  Placed: 6,
  /** Cheap to dig. */
  Sand: 7,
  /** Slow to walk on. */
  Mud: 8,
  /** Tree trunks: slow to dig. */
  Timber: 9,
  /** Canopies: the bot pushes through them, slowly; nothing to stand on. */
  Leaves: 10,
  /** Never entered, stood on or dug. Glows. */
  Magma: 11,
  /** Snow caps: a little slow to wade through, easy to dig. */
  Snow: 12,
} as const;
export type Mat = (typeof Mat)[keyof typeof Mat];

export const MAT_COUNT = 13;
export const MAT_KEYS = ['air', 'grass', 'soil', 'stone', 'crystal', 'water', 'placed', 'sand', 'mud', 'timber', 'leaves', 'magma', 'snow'] as const;
export type MatKey = (typeof MAT_KEYS)[number];

/** 1 = hides neighbouring faces when drawing. Indexed by Mat id. */
export const OPAQUE = Uint8Array.from([0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1]);
/** 1 = a solid block the bot bumps into (leaves are pushed through). Indexed by Mat id. */
export const SOLID = Uint8Array.from([0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]);
