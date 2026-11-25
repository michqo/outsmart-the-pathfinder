import * as THREE from 'three';
import { BIOME_TINT } from '../gen/island';

/** Tint values are stored ÷ this, so multipliers above 1 fit in a byte. */
const RANGE = 1.25;
const NEUTRAL = Math.round(255 / RANGE);

/**
 * A per-column colour multiplier for generated islands (badlands warmer, wetlands greener...).
 * One small texture, linearly filtered so biomes blend at their borders. Neutral for
 * hand-made levels.
 */
export class BiomeTint {
  readonly uniforms = {
    tBiome: { value: neutral() },
    uBiomeSize: { value: new THREE.Vector2(1, 1) },
  };

  /** `biome` per column (x + z*sx), or undefined for no tint. */
  set(biome: Uint8Array | undefined, sx: number, sz: number): void {
    this.uniforms.tBiome.value.dispose();
    if (!biome) {
      this.uniforms.tBiome.value = neutral();
      this.uniforms.uBiomeSize.value.set(1, 1);
      return;
    }
    const data = new Uint8Array(sx * sz * 4);
    for (let i = 0; i < sx * sz; i++) {
      const t = BIOME_TINT[biome[i]] ?? BIOME_TINT[0];
      data[i * 4] = Math.round((t[0] / RANGE) * 255);
      data[i * 4 + 1] = Math.round((t[1] / RANGE) * 255);
      data[i * 4 + 2] = Math.round((t[2] / RANGE) * 255);
      data[i * 4 + 3] = 255;
    }
    this.uniforms.tBiome.value = texture(data, sx, sz);
    this.uniforms.uBiomeSize.value.set(sx, sz);
  }
}

/** GLSL: `biomeTint(local voxel position)` → colour multiplier. */
export const BIOME_TINT_GLSL = /* glsl */ `
uniform sampler2D tBiome;
uniform vec2 uBiomeSize;
vec3 biomeTint(vec3 p) { return texture2D(tBiome, p.xz / uBiomeSize).rgb * ${RANGE.toFixed(2)}; }
`;

function neutral(): THREE.DataTexture {
  return texture(Uint8Array.of(NEUTRAL, NEUTRAL, NEUTRAL, 255), 1, 1);
}

function texture(data: Uint8Array, w: number, h: number): THREE.DataTexture {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}
