import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

/**
 * Realistic-look assets (all CC0 from Poly Haven, see public/assets/CREDITS.md).
 *
 * The three terrain texture sets are packed into texture ARRAYS (one layer per set),
 * so the terrain shader needs only three samplers: albedo, normal, ARM (AO/rough/metal).
 */
export const TERRAIN_LAYERS = ['leafy_grass', 'excavated_soil_wall', 'rock_face_03'] as const;
export const Layer = { Grass: 0, Soil: 1, Rock: 2 } as const;

const SIZE = 1024;
const BASE = `${import.meta.env.BASE_URL}assets/`;

export interface Assets {
  albedo: THREE.DataArrayTexture;
  normal: THREE.DataArrayTexture;
  arm: THREE.DataArrayTexture;
  /** Plain 2D rock maps for the (non-voxel) underside rocks. */
  rock: { map: THREE.Texture; normalMap: THREE.Texture; armMap: THREE.Texture };
  env: THREE.DataTexture;
  /** Direction towards the sun, found in the HDRI. */
  sunDir: THREE.Vector3;
}

async function pixels(url: string): Promise<Uint8ClampedArray> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`asset ${url}: ${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), { imageOrientation: 'flipY', colorSpaceConversion: 'none' });
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, SIZE, SIZE);
  bmp.close();
  return ctx.getImageData(0, 0, SIZE, SIZE).data;
}

/** Called as each file finishes: (files done, files total). */
export type Progress = (done: number, total: number) => void;
const FILE_COUNT = 13; // 9 array layers + 3 rock maps + the HDRI
let tick: () => void = () => {};
const counted = <T>(p: Promise<T>): Promise<T> => p.then((v) => (tick(), v));

async function arrayTexture(suffix: string, srgb: boolean): Promise<THREE.DataArrayTexture> {
  const layers = await Promise.all(TERRAIN_LAYERS.map((id) => counted(pixels(`${BASE}${id}_${suffix}_1k.jpg`))));
  const data = new Uint8Array(SIZE * SIZE * 4 * layers.length);
  layers.forEach((l, i) => data.set(l, i * SIZE * SIZE * 4));
  const tex = new THREE.DataArrayTexture(data, SIZE, SIZE, layers.length);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** Finds the brightest spot of an equirect HDR (the sun) and returns the direction to it. */
function findSun(env: THREE.DataTexture): THREE.Vector3 {
  const { data, width, height } = env.image as { data: Uint16Array | Float32Array; width: number; height: number };
  const half = data instanceof Uint16Array;
  const read = (i: number) => (half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i]);
  let best = -1, bx = 0, by = 0;
  // Only the upper half (the sun is above the horizon), every 2nd texel.
  for (let y = 0; y < height / 2; y += 2)
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      const l = read(i) * 0.2126 + read(i + 1) * 0.7152 + read(i + 2) * 0.0722;
      if (l > best) (best = l), (bx = x), (by = y);
    }
  // Row 0 is the top of the image (v = 1 with flipY). Matches three's equirectUv().
  const u = (bx + 0.5) / width, v = 1 - (by + 0.5) / height;
  const lat = (v - 0.5) * Math.PI, lon = (u - 0.5) * Math.PI * 2;
  return new THREE.Vector3(Math.cos(lon) * Math.cos(lat), Math.sin(lat), Math.sin(lon) * Math.cos(lat)).normalize();
}

function rockMap(suffix: string, srgb: boolean): Promise<THREE.Texture> {
  return counted(new THREE.TextureLoader().loadAsync(`${BASE}rock_face_03_${suffix}_1k.jpg`)).then((t) => {
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  });
}

export async function loadAssets(onProgress: Progress = () => {}): Promise<Assets> {
  let done = 0;
  tick = () => onProgress(++done, FILE_COUNT);
  const [albedo, normal, arm, map, normalMap, armMap, env] = await Promise.all([
    arrayTexture('diff', true),
    arrayTexture('nor_gl', false),
    arrayTexture('arm', false),
    rockMap('diff', true),
    rockMap('nor_gl', false),
    rockMap('arm', false),
    counted(new HDRLoader().loadAsync(`${BASE}sky_2k.hdr`)),
  ]);
  env.mapping = THREE.EquirectangularReflectionMapping;
  return { albedo, normal, arm, rock: { map, normalMap, armMap }, env, sunDir: findSun(env) };
}
