import { CLOUD_GLSL, type CloudUniforms } from './clouds';
import * as THREE from 'three';
import type { World } from '../world/world';
import type { Assets } from './assets';

/**
 * The voxel grid as a 3D texture, so terrain shaders can look up a face's material
 * and its neighbours (bevels only on exposed edges). The world's flat layout
 * `x + z*sx + y*sx*sz` is exactly a 3D texture of size sx × sz × sy: no copy needed.
 * When the window is reshaped the texture is recreated; shaders hold `uniform`, which follows.
 */
export class VoxelTexture {
  readonly uniform: { value: THREE.Data3DTexture };

  constructor(private world: World) {
    this.uniform = { value: this.create() };
  }

  get texture(): THREE.Data3DTexture {
    return this.uniform.value;
  }

  private create(): THREE.Data3DTexture {
    const w = this.world;
    const t = new THREE.Data3DTexture(w.data, w.sx, w.sz, w.sy);
    t.format = THREE.RedFormat;
    t.type = THREE.UnsignedByteType;
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.unpackAlignment = 1;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  }

  /** Re-upload (128 KB for the default window); call whenever voxels changed. */
  touch(): void {
    if (this.texture.image.data !== this.world.data) {
      this.texture.dispose();
      this.uniform.value = this.create();
    } else this.texture.needsUpdate = true;
  }
}

const COMMON = /* glsl */ `
varying vec3 vVox;
varying vec3 vVoxN;
float vh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(vh(i), vh(i + vec2(1, 0)), f.x), mix(vh(i + vec2(0, 1)), vh(i + vec2(1, 1)), f.x), f.y);
}
`;

const TERRAIN_FRAG_HEAD = /* glsl */ `
${COMMON}
uniform sampler2DArray tAlb, tNor, tArm;
uniform sampler3D tVox;
uniform float uScale, uBevel, uNormalStrength, uGreen;

/** The grass scan is full of fallen leaves: pull it towards green, keeping its luminance detail. */
vec3 greener(vec3 c) {
  float l = dot(c, vec3(0.3, 0.59, 0.11));
  return mix(c, l * vec3(0.6, 1.12, 0.3), uGreen);
}
uniform vec3 uPlaced, uCrystal;
/** 0 = soft palette colours, 1 = full photo textures. */
uniform float uRealism;
uniform vec3 uGrassTop, uGrassSide, uSoil, uStone;

int voxAt(ivec3 c) {
  ivec3 n = textureSize(tVox, 0); // (sx, sz, sy)
  if (c.x < 0 || c.y < 0 || c.z < 0 || c.x >= n.x || c.y >= n.z || c.z >= n.y) return 0;
  return int(texelFetch(tVox, ivec3(c.x, c.z, c.y), 0).r * 255.0 + 0.5);
}
bool solidM(int m) { return m != 0 && m != 5; }

const mat2 ROT = mat2(0.8, -0.6, 0.6, 0.8);

/** One PBR layer; on High a second rotated, rescaled sample is blended in by noise to hide tiling. */
void sampleLayer(float layer, vec2 uv, out vec3 alb, out vec3 nT, out vec3 arm) {
  alb = texture(tAlb, vec3(uv, layer)).rgb;
  nT = texture(tNor, vec3(uv, layer)).xyz * 2.0 - 1.0;
  arm = texture(tArm, vec3(uv, layer)).xyz;
#ifndef LOW_QUALITY
  vec2 uv2 = ROT * uv * 0.61 + vec2(0.37, 0.71);
  float k = smoothstep(0.25, 0.75, vnoise(uv * 0.8 + layer * 7.0));
  vec3 n2 = texture(tNor, vec3(uv2, layer)).xyz * 2.0 - 1.0;
  n2.xy = transpose(ROT) * n2.xy; // back into this face's tangent frame
  alb = mix(alb, texture(tAlb, vec3(uv2, layer)).rgb, k);
  nT = mix(nT, n2, k);
  arm = mix(arm, texture(tArm, vec3(uv2, layer)).xyz, k);
#endif
  nT = normalize(vec3(nT.xy * uNormalStrength, nT.z));
}
`;

const TERRAIN_SURFACE = /* glsl */ `
  // ---- terrain surface (replaces map_fragment)
  vec3 sN = vec3(round(vVoxN.x), round(vVoxN.y), round(vVoxN.z));
  bool sTop = abs(sN.y) > 0.5;
  vec3 sT = sTop ? vec3(1.0, 0.0, 0.0) : cross(vec3(0.0, 1.0, 0.0), sN);
  vec3 sB = cross(sN, sT);
  ivec3 sCell = ivec3(floor(vVox - sN * 0.5));
  int sMat = voxAt(sCell);
  ivec3 iT = ivec3(sT), iB = ivec3(sB);
  if (!solidM(sMat)) {
    // On a quad's exact border the floor() can land one cell outside it: use the in-plane neighbour.
    ivec3 c;
    c = sCell - iT; if (solidM(voxAt(c))) sCell = c;
    else { c = sCell + iT; if (solidM(voxAt(c))) sCell = c;
    else { c = sCell - iB; if (solidM(voxAt(c))) sCell = c;
    else { c = sCell + iB; if (solidM(voxAt(c))) sCell = c; } } }
    sMat = voxAt(sCell);
  }
  vec2 sUv = vec2(dot(vVox, sT), dot(vVox, sB));
  vec2 tuv = sUv * uScale;
  vec3 sAlb, sNT, sArm;
  vec3 sEmis = vec3(0.0);
  vec3 sFlat = vec3(1.0);
  float macro = 0.9 + 0.2 * vnoise(vVox.xz * 0.09 + vVox.y * 0.07);

  if (sMat == 1) {
    if (sN.y > 0.5) {
      sampleLayer(0.0, tuv, sAlb, sNT, sArm);
      // Patches with more leaf litter break up the green.
      float dry = smoothstep(0.5, 0.9, vnoise(vVox.xz * 0.06 + 3.0));
      sAlb = mix(greener(sAlb), sAlb, dry * 0.6);
      sFlat = uGrassTop;
    } else if (sN.y < -0.5) {
      sampleLayer(1.0, tuv, sAlb, sNT, sArm);
      sFlat = uSoil;
    } else {
      // Moss drips over the soil from the top edge, with a ragged noisy border.
      vec3 a1, n1, r1, a2, n2, r2;
      sampleLayer(0.0, tuv, a1, n1, r1);
      sampleLayer(1.0, tuv, a2, n2, r2);
      a1 = greener(a1);
      float h = vVox.y - float(sCell.y);
      float edge = 0.6 + 0.2 * vnoise(vec2(sUv.x * 2.3, float(sCell.y) * 3.1)) + 0.12 * vnoise(vec2(sUv.x * 11.0, 5.0));
      float g = solidM(voxAt(sCell + ivec3(0, 1, 0))) ? 0.0 : smoothstep(edge - 0.04, edge + 0.03, h);
      sAlb = mix(a2, a1, g);
      sNT = normalize(mix(n2, n1, g));
      sArm = mix(r2, r1, g);
      sFlat = mix(uSoil, uGrassSide, g);
    }
    sAlb *= macro;
  } else if (sMat == 2) {
    sampleLayer(1.0, tuv, sAlb, sNT, sArm);
    sAlb *= macro;
    sFlat = uSoil;
  } else if (sMat == 3) {
    sampleLayer(2.0, tuv, sAlb, sNT, sArm);
    sAlb *= macro;
    sFlat = uStone;
  } else if (sMat == 4) {
    // Crystal: glassy, faceted (rock normals, stronger), a faint inner glow.
    sampleLayer(2.0, tuv * 1.6, sAlb, sNT, sArm);
    float l = dot(sAlb, vec3(0.3, 0.55, 0.15));
    sAlb = uCrystal * mix(0.55, 1.2, l);
    sNT = normalize(vec3(sNT.xy * 1.6, sNT.z));
    sArm = vec3(1.0, 0.06 + 0.1 * sArm.g, 0.0);
    sEmis = uCrystal * (0.12 + 0.3 * vnoise(sUv * 1.7 + float(sCell.y)));
  } else if (sMat == 6) {
    // Placed blocks: painted, slightly worn plastic.
    sampleLayer(1.0, tuv, sAlb, sNT, sArm);
    sAlb = uPlaced * (0.74 + 0.08 * vnoise(sUv * 7.0));
    sNT = normalize(vec3(sNT.xy * 0.1, 1.0));
    sArm = vec3(1.0, 0.36 + 0.12 * sArm.g, 0.0);
  } else {
    sAlb = vec3(1.0, 0.0, 1.0);
    sNT = vec3(0.0, 0.0, 1.0);
    sArm = vec3(1.0, 1.0, 0.0);
  }

  if (sMat <= 3) {
    // Blend the scans towards soft palette colours (less photographic), keeping some texture detail.
    float l = dot(sAlb, vec3(0.3, 0.59, 0.11));
    vec3 detailed = sFlat * (0.55 + 1.1 * l); // palette hue, texture luminance
    sAlb = mix(mix(sFlat, detailed, 0.6), sAlb, uRealism) * mix(0.96, 1.0, macro);
    sNT = normalize(vec3(sNT.xy * mix(0.4, 1.0, uRealism), sNT.z));
  }

  // Bevels on exposed (convex) edges only: no grid lines on flat ground.
  float bw = sMat == 6 ? 0.1 : uBevel;
  float du = fract(sUv.x), dv = fract(sUv.y), w;
  vec3 off = vec3(0.0);
  w = 1.0 - clamp(du / bw, 0.0, 1.0);         if (w > 0.0 && !solidM(voxAt(sCell - iT))) off -= sT * w * w;
  w = 1.0 - clamp((1.0 - du) / bw, 0.0, 1.0); if (w > 0.0 && !solidM(voxAt(sCell + iT))) off += sT * w * w;
  w = 1.0 - clamp(dv / bw, 0.0, 1.0);         if (w > 0.0 && !solidM(voxAt(sCell - iB))) off -= sB * w * w;
  w = 1.0 - clamp((1.0 - dv) / bw, 0.0, 1.0); if (w > 0.0 && !solidM(voxAt(sCell + iB))) off += sB * w * w;

  vec3 sNW = normalize(normalize(sT * sNT.x + sB * sNT.y + sN * sNT.z) + off * 1.1);
  diffuseColor.rgb *= sAlb * mix(1.0, sArm.r, 0.75);
`;

export interface TerrainMaterial {
  material: THREE.MeshStandardMaterial;
  uniforms: {
    uScale: { value: number };
    uBevel: { value: number };
    uNormalStrength: { value: number };
    uGreen: { value: number };
    uPlaced: { value: THREE.Color };
    uCrystal: { value: THREE.Color };
    uRealism: { value: number };
    uGrassTop: { value: THREE.Color };
    uGrassSide: { value: THREE.Color };
    uSoil: { value: THREE.Color };
    uStone: { value: THREE.Color };
  };
  setLowQuality(low: boolean): void;
}

/**
 * `clouds` (optional): the sky's cloud field, so drifting clouds shade the ground.
 * `islandOffset`: where voxel space sits in the world (clouds live in world space).
 */
export function createTerrainMaterial(
  assets: Assets,
  vox: VoxelTexture,
  clouds?: CloudUniforms,
  islandOffset = new THREE.Vector3(),
): TerrainMaterial {
  const uniforms = {
    uScale: { value: 0.28 },
    uBevel: { value: 0.07 },
    uNormalStrength: { value: 1.0 },
    uGreen: { value: 0.7 },
    uPlaced: { value: new THREE.Color(0xff8a3c) },
    uCrystal: { value: new THREE.Color(0xb59cff) },
    uRealism: { value: 0.5 },
    uGrassTop: { value: new THREE.Color() },
    uGrassSide: { value: new THREE.Color() },
    uSoil: { value: new THREE.Color() },
    uStone: { value: new THREE.Color() },
  };
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, {
      tAlb: { value: assets.albedo },
      tNor: { value: assets.normal },
      tArm: { value: assets.arm },
      tVox: vox.uniform,
      ...(clouds ?? {}),
      uIslandOffset: { value: islandOffset },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vVox;\nvarying vec3 vVoxN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvVox = transformed;\nvVoxN = objectNormal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${TERRAIN_FRAG_HEAD}`)
      .replace('#include <map_fragment>', TERRAIN_SURFACE)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = sArm.g;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = sArm.b;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(sNW, 0.0)).xyz);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += sEmis;');
    if (clouds) {
      // Cloud shadows: the HDRI's own sun is part of the image-based light too, so a
      // cloud dims that as well (not fully: the open sky around it still lights the ground).
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${CLOUD_GLSL}\nuniform vec3 uIslandOffset;`)
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
          float cloudLight = cloudShadow(vVox + uIslandOffset);
          reflectedLight.directDiffuse *= cloudLight;
          reflectedLight.directSpecular *= cloudLight;
          reflectedLight.indirectDiffuse *= mix(1.0, cloudLight, 0.7);
          reflectedLight.indirectSpecular *= mix(1.0, cloudLight, 0.7);`,
        );
    }
  };
  material.customProgramCacheKey = () => (clouds ? 'terrain-pbr-clouds' : 'terrain-pbr');
  return {
    material,
    uniforms,
    setLowQuality(low) {
      if (low) material.defines = { LOW_QUALITY: '' };
      else material.defines = {};
      material.needsUpdate = true;
    },
  };
}

export interface WaterMaterial {
  material: THREE.MeshStandardMaterial;
  time: { value: number };
}

/** Reflective water with procedural waves and a fresnel-driven opacity. */
export function createWaterMaterial(): WaterMaterial {
  const time = { value: 0 };
  const material = new THREE.MeshStandardMaterial({
    color: 0x1f5c6b,
    roughness: 0.04,
    metalness: 0,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vVox;\nvarying vec3 vVoxN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvVox = transformed;\nvVoxN = objectNormal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON}\nuniform float uTime;`)
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `
        vec3 wN = vVoxN;
        if (vVoxN.y > 0.5) {
          vec2 p = vVox.xz, g = vec2(0.0);
          // Sum of directional waves: gradient of A*sin(k*dot(d,p) + w*t) is A*k*d*cos(...).
          g += vec2(0.8, 0.6)   * cos(dot(p, vec2(0.8, 0.6))   * 1.7 + uTime * 1.1) * 0.06;
          g += vec2(-0.5, 0.86) * cos(dot(p, vec2(-0.5, 0.86)) * 3.1 + uTime * 1.6) * 0.05;
          g += vec2(0.2, -0.98) * cos(dot(p, vec2(0.2, -0.98)) * 5.9 + uTime * 2.3) * 0.035;
          g += vec2(-0.9, -0.4) * cos(dot(p, vec2(-0.9, -0.4)) * 11.0 + uTime * 3.1) * 0.02;
          wN = normalize(vec3(-g.x, 1.0, -g.y));
        }
        normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
        float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 4.0);
        diffuseColor.a = mix(diffuseColor.a, 0.97, fres);
        `,
      );
  };
  material.customProgramCacheKey = () => 'water-pbr';
  return { material, time };
}
