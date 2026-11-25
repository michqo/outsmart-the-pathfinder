import * as THREE from 'three';
import type { Stage } from './scene';

const CSS = /* css */ `
.follow-btn { position: fixed; left: 12px; top: 58px; z-index: 20; display: flex; align-items: center; gap: 7px;
  padding: 7px 11px; border: 0; border-radius: 12px; background: #ffffffb8; backdrop-filter: blur(10px);
  box-shadow: 0 6px 24px #5a4a7a22, inset 0 0 0 1px #fff; cursor: pointer;
  font: 600 12px/1 ui-rounded, 'SF Pro Rounded', system-ui, sans-serif; color: #3b3355; }
.follow-btn:hover { background: #fff; }
.follow-btn i { width: 26px; height: 15px; border-radius: 8px; background: #cfc9dc; position: relative; transition: background .15s; }
.follow-btn i::after { content: ''; position: absolute; left: 2px; top: 2px; width: 11px; height: 11px; border-radius: 50%;
  background: #fff; transition: transform .15s; }
.follow-btn.on i { background: #6c5ce7; }
.follow-btn.on i::after { transform: translateX(11px); }
.follow-btn kbd { font: inherit; font-size: 10px; opacity: .5; }
`;

/**
 * Follow-bot camera: while a run is on, the orbit target glides after the bot and the
 * camera moves by the same amount, so your chosen angle and zoom are kept (and you can
 * still orbit/zoom). Toggle with the HUD switch or V.
 */
export class FollowCam {
  enabled = true;
  private button = document.createElement('button');
  private p = new THREE.Vector3();
  private step = new THREE.Vector3();

  constructor(
    private stage: Stage,
    private target: (out: THREE.Vector3) => THREE.Vector3 | null,
  ) {
    const css = document.createElement('style');
    css.textContent = CSS;
    document.head.appendChild(css);
    this.button.className = 'follow-btn';
    this.button.title = 'Camera follows the bot during runs (V)';
    this.button.innerHTML = '<i></i>Follow bot <kbd>V</kbd>';
    this.button.addEventListener('click', () => this.toggle());
    document.body.appendChild(this.button);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyV' && !e.metaKey && !e.ctrlKey && !(e.target instanceof HTMLInputElement)) this.toggle();
    });
    this.render();
  }

  toggle(): void {
    this.enabled = !this.enabled;
    this.render();
  }

  private render(): void {
    this.button.classList.toggle('on', this.enabled);
  }

  update(dt: number): void {
    if (!this.enabled) return;
    const at = this.target(this.p);
    if (!at) return;
    const { controls, camera, island } = this.stage;
    island.localToWorld(at); // bot positions are in island space
    at.y += 0.9;
    this.step.subVectors(at, controls.target).multiplyScalar(1 - Math.exp(-dt * 3.5));
    controls.target.add(this.step);
    camera.position.add(this.step);
  }
}
