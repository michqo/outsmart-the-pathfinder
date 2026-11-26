import * as THREE from 'three';
import { ignoreGameShortcut } from '../ui/modal';
import type { Stage } from './scene';

const CSS = /* css */ `
.cams { position: fixed; left: 12px; top: 58px; z-index: 20; display: flex; gap: 6px; }
.follow-btn { display: flex; align-items: center; gap: 7px;
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
 * Cameras for runs, each a switch in the top-left:
 *  - Follow bot (V): the orbit target glides after the bot and the camera moves by the same
 *    amount, so your angle and zoom are kept (and you can still orbit/zoom).
 *  - Bot's eye (B): the camera rides just behind the bot's head, looking where it faces,
 *    so you watch the search spread around it and then walk the route at its height. The
 *    orbit view comes back when the run ends.
 */
export class FollowCam {
  enabled = true;
  eye = false;
  private button = document.createElement('button');
  private eyeButton = document.createElement('button');
  private p = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private step = new THREE.Vector3();
  private wantPos = new THREE.Vector3();
  private wantLook = new THREE.Vector3();
  /** The orbit view to return to after a bot's-eye run (null = not riding). */
  private saved: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;

  constructor(
    private stage: Stage,
    private target: (out: THREE.Vector3) => THREE.Vector3 | null,
    /** The bot's facing in world space (unit vector). */
    private facing: (out: THREE.Vector3) => THREE.Vector3,
  ) {
    const css = document.createElement('style');
    css.textContent = CSS;
    document.head.appendChild(css);
    this.button.className = 'follow-btn';
    this.button.title = 'Camera follows the bot during runs (V)';
    this.button.innerHTML = '<i></i>Follow bot <kbd>V</kbd>';
    this.button.addEventListener('click', () => this.toggle());
    this.eyeButton.className = 'follow-btn eye';
    this.eyeButton.title = "Ride along at the bot's height during runs (B)";
    this.eyeButton.innerHTML = "<i></i>Bot's eye <kbd>B</kbd>";
    this.eyeButton.addEventListener('click', () => this.toggleEye());
    const cams = document.createElement('div');
    cams.className = 'cams';
    cams.append(this.button, this.eyeButton);
    document.body.appendChild(cams);
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || ignoreGameShortcut(e)) return;
      if (e.code === 'KeyV') this.toggle();
      if (e.code === 'KeyB') this.toggleEye();
    });
    this.render();
  }

  toggle(): void {
    this.enabled = !this.enabled;
    this.render();
  }

  toggleEye(): void {
    this.eye = !this.eye;
    this.render();
  }

  private render(): void {
    this.button.classList.toggle('on', this.enabled);
    this.eyeButton.classList.toggle('on', this.eye);
  }

  update(dt: number): void {
    const at = this.target(this.p);
    if (at) this.stage.island.localToWorld(at); // bot positions are in island space
    if (this.eye && at) return this.ride(dt, at);
    if (this.saved) return this.comeBack(dt);
    if (!this.enabled || !at) return;
    const { controls, camera } = this.stage;
    at.y += 0.9;
    this.step.subVectors(at, controls.target).multiplyScalar(1 - Math.exp(-dt * 3.5));
    controls.target.add(this.step);
    camera.position.add(this.step);
  }

  /** Behind and just above the bot's head, looking a few cells ahead of it. */
  private ride(dt: number, at: THREE.Vector3): void {
    const { controls, camera } = this.stage;
    if (!this.saved) this.saved = { pos: camera.position.clone(), target: controls.target.clone() };
    controls.enabled = false; // every frame: a click elsewhere re-enables orbiting
    const f = this.facing(this.dir);
    f.y = 0;
    if (f.lengthSq() < 1e-6) f.set(0, 0, 1);
    f.normalize();
    this.wantPos.copy(at).addScaledVector(f, -6).setY(at.y + 3.4);
    this.wantLook.copy(at).addScaledVector(f, 6).setY(at.y + 0.6);
    const k = 1 - Math.exp(-dt * 4);
    camera.position.lerp(this.wantPos, k);
    controls.target.lerp(this.wantLook, k);
  }

  /** The run ended (or the switch went off): glide back to the orbit view you had. */
  private comeBack(dt: number): void {
    const { controls, camera } = this.stage;
    const s = this.saved!;
    const k = 1 - Math.exp(-dt * 3.5);
    camera.position.lerp(s.pos, k);
    controls.target.lerp(s.target, k);
    if (camera.position.distanceTo(s.pos) < 0.05 && controls.target.distanceTo(s.target) < 0.05) {
      camera.position.copy(s.pos);
      controls.target.copy(s.target);
      controls.enabled = true;
      this.saved = null;
    }
  }
}
