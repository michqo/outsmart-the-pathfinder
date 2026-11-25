import type { Vec3i } from '../path/protocol';
import { MAT_COUNT } from '../world/materials';
import { inBounds, SX, SY, SZ } from '../world/world';

/**
 * Share links: everything needed to replay a course, packed into the URL hash.
 *
 * Bytes: version, mode, start xyz, goal xyz, inventory, weight×10, dare (u32 LE),
 * level-id length + ASCII id, then (sandbox only) the world as run-length pairs
 * (varint run, material byte). The whole thing is deflated and base64url-encoded.
 */
export interface SharedLevel {
  /** 'challenge' = a built-in level by id (the world comes from the game); 'sandbox' = the world itself. */
  mode: 'challenge' | 'sandbox';
  levelId: string;
  /** Sandbox only. */
  world: Uint8Array | null;
  start: Vec3i;
  goal: Vec3i;
  inventory: number;
  /** Weighted-A* weight, 1..5 (one decimal). */
  weight: number;
  /** The sharer's best score (nodes), 0 = none. */
  dare: number;
}

const VERSION = 1;
const VOXELS = SX * SY * SZ;
export const HASH_KEY = 'course=';

// ---------------------------------------------------------------- run-length

export function rleEncode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < data.length; ) {
    const m = data[i];
    let run = 1;
    while (i + run < data.length && data[i + run] === m) run++;
    for (let v = run; ; ) {
      // varint: 7 bits per byte, high bit = more follows
      if (v < 0x80) {
        out.push(v);
        break;
      }
      out.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    out.push(m);
    i += run;
  }
  return Uint8Array.from(out);
}

export function rleDecode(bytes: Uint8Array, length: number, offset = 0): Uint8Array {
  const out = new Uint8Array(length);
  let o = 0;
  for (let i = offset; i < bytes.length; ) {
    let run = 0, shift = 0, b: number;
    do {
      if (i >= bytes.length) throw new Error('truncated run');
      b = bytes[i++];
      run |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80 && shift < 28);
    if (i >= bytes.length) throw new Error('truncated run');
    const m = bytes[i++];
    if (m >= MAT_COUNT) throw new Error('bad material');
    if (o + run > length) throw new Error('world too long');
    out.fill(m, o, o + run);
    o += run;
  }
  if (o !== length) throw new Error('world too short');
  return out;
}

// ---------------------------------------------------------------- deflate + base64url

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('not base64url');
  const b = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

// ---------------------------------------------------------------- level

export async function encodeLevel(l: SharedLevel): Promise<string> {
  const id = new TextEncoder().encode(l.levelId.slice(0, 40));
  const head = new Uint8Array(15 + id.length);
  const dv = new DataView(head.buffer);
  head[0] = VERSION;
  head[1] = l.mode === 'challenge' ? 1 : 0;
  head.set(l.start, 2);
  head.set(l.goal, 5);
  head[8] = Math.max(0, Math.min(255, l.inventory | 0));
  head[9] = Math.round(Math.max(1, Math.min(5, l.weight)) * 10);
  dv.setUint32(10, Math.max(0, Math.min(0xffffffff, Math.round(l.dare))), true);
  head[14] = id.length;
  head.set(id, 15);
  const body = l.mode === 'sandbox' && l.world ? rleEncode(l.world) : new Uint8Array(0);
  const all = new Uint8Array(head.length + body.length);
  all.set(head);
  all.set(body, head.length);
  return toBase64Url(await pipe(all, new CompressionStream('deflate-raw')));
}

export async function decodeLevel(text: string): Promise<SharedLevel> {
  const bytes = await pipe(fromBase64Url(text), new DecompressionStream('deflate-raw'));
  if (bytes.length < 15 || bytes[0] !== VERSION) throw new Error('unsupported link version');
  const mode = bytes[1] === 1 ? 'challenge' : 'sandbox';
  const start: Vec3i = [bytes[2], bytes[3], bytes[4]];
  const goal: Vec3i = [bytes[5], bytes[6], bytes[7]];
  if (!inBounds(...start) || !inBounds(...goal)) throw new Error('start/goal out of bounds');
  const idLen = bytes[14];
  if (15 + idLen > bytes.length) throw new Error('truncated');
  const levelId = new TextDecoder().decode(bytes.subarray(15, 15 + idLen));
  const world = mode === 'sandbox' ? rleDecode(bytes, VOXELS, 15 + idLen) : null;
  return {
    mode,
    levelId,
    world,
    start,
    goal,
    inventory: bytes[8],
    weight: Math.max(1, Math.min(5, bytes[9] / 10)),
    dare: new DataView(bytes.buffer, bytes.byteOffset).getUint32(10, true),
  };
}

/** Reads a shared course from a location hash like `#course=...`, or null. */
export function courseFromHash(hash: string): string | null {
  const h = hash.replace(/^#/, '');
  return h.startsWith(HASH_KEY) ? h.slice(HASH_KEY.length) : null;
}
