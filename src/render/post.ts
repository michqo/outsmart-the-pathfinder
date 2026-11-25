import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/** Runs after tone mapping, in display space: gentle contrast, saturation, warmth and a vignette. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uContrast: { value: 1.06 },
    uSaturation: { value: 1.08 },
    uVignette: { value: 0.28 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uContrast, uSaturation, uVignette;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = (c - 0.5) * uContrast + 0.5;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      c *= mix(vec3(0.985, 0.99, 1.02), vec3(1.03, 1.0, 0.96), smoothstep(0.2, 0.9, l)); // cool shadows, warm highlights
      vec2 q = vUv - 0.5;
      c *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(q, q) * 2.2);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

/**
 * High-quality pipeline: MSAA scene -> GTAO -> bloom -> tone map (OutputPass) -> grade.
 * Low quality skips the composer entirely and renders straight to the screen.
 */
export class PostFX {
  readonly composer: EffectComposer;
  readonly gtao: GTAOPass;
  readonly bloom: UnrealBloomPass;
  readonly grade: ShaderPass;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
  ) {
    const size = renderer.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));

    this.gtao = new GTAOPass(scene, camera, size.x, size.y);
    this.gtao.updateGtaoMaterial({ radius: 1.1, distanceExponent: 1.6, thickness: 1.5, scale: 1.0, samples: 12 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.gtao.blendIntensity = 0.85;
    // Its depth/normal pre-pass must not see transparent things (water, search cubes, beams).
    const render = this.gtao.render.bind(this.gtao);
    const hidden: THREE.Object3D[] = [];
    this.gtao.render = (...args: Parameters<GTAOPass['render']>) => {
      this.scene.traverseVisible((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (m && !Array.isArray(m) && (m.transparent || !m.depthWrite)) hidden.push(o);
      });
      for (const o of hidden) o.visible = false;
      // The hide only matters for the pre-pass, but GTAOPass renders it and blends in one call;
      // the blend reads the already-rendered beauty buffer, so hidden objects stay in the image.
      render(...args);
      for (const o of hidden) o.visible = true;
      hidden.length = 0;
    };
    // AO is soft and low-frequency: half resolution costs a quarter and looks the same after denoise.
    const gtaoSize = this.gtao.setSize.bind(this.gtao);
    this.gtao.setSize = (w: number, h: number) => gtaoSize(Math.ceil(w / 2), Math.ceil(h / 2));
    this.composer.addPass(this.gtao);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.3, 0.5, 2.6);
    // Bloom is a blur anyway: run its mip chain from quarter resolution instead of half.
    const bloomSize = this.bloom.setSize.bind(this.bloom);
    this.bloom.setSize = (w: number, h: number) => bloomSize(Math.ceil(w / 2), Math.ceil(h / 2));
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const s = this.renderer.getSize(new THREE.Vector2());
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(s.x, s.y);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }
}
