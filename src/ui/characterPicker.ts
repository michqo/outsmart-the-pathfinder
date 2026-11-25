import { CHARACTERS, characterInfo } from '../render/characters';
import { ignoreGameShortcut, showModal } from './modal';

const CSS = /* css */ `
.cp-open { position: fixed; left: 12px; top: 12px; z-index: 20; display: flex; align-items: center; gap: 8px;
  padding: 5px 12px 5px 5px; border: 0; border-radius: 14px; background: #ffffffb8; backdrop-filter: blur(10px);
  box-shadow: 0 6px 24px #5a4a7a22, inset 0 0 0 1px #fff; cursor: pointer;
  font: 600 12px/1 ui-rounded, 'SF Pro Rounded', system-ui, sans-serif; color: #3b3355; }
.cp-open:hover { background: #fff; }
@media (max-width: 720px) { .cp-open { left: 10px; top: 10px; padding: 5px; font-size: 0; gap: 0; } }
.cp-open img, .cp-open .ph { width: 30px; height: 30px; border-radius: 9px; background: #e9e4f3; object-fit: cover; }
.cp { width: min(760px, calc(100vw - 32px)); max-height: calc(100vh - 48px); display: flex; flex-direction: column;
  border-radius: 22px; background: #fbf9ff; box-shadow: 0 24px 80px #1d1a2c55;
  font: 600 13px/1.3 ui-rounded, 'SF Pro Rounded', system-ui, sans-serif; color: #2f2a45; }
.cp header { padding: 20px 24px 6px; }
.cp h2 { margin: 0 0 4px; font-size: 21px; }
.cp header p { margin: 0; opacity: .6; font-weight: 500; }
.cp .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 10px; padding: 14px 24px; overflow-y: auto; }
.cp .card { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 6px 9px; border: 0;
  border-radius: 14px; background: #fff; box-shadow: inset 0 0 0 1.5px #ece8f4; cursor: pointer; font: inherit; color: inherit; }
.cp .card:hover { box-shadow: inset 0 0 0 1.5px #c9bff0; transform: translateY(-1px); }
.cp .card.on { box-shadow: inset 0 0 0 2.5px #6c5ce7; background: #f3f0ff; }
.cp .card img, .cp .card .ph { width: 88px; height: 88px; border-radius: 10px; background: linear-gradient(#eef3fb, #e3e9f3); }
.cp .card .ph { animation: cpPulse 1s ease-in-out infinite alternate; }
@keyframes cpPulse { to { opacity: .5; } }
.cp footer { display: flex; justify-content: space-between; align-items: center; padding: 10px 24px 18px; }
.cp footer small { opacity: .5; font-weight: 500; }
.cp footer button { padding: 10px 22px; border: 0; border-radius: 12px; background: #3b3355; color: #fff; font: inherit; cursor: pointer; }
.cp footer button:hover { background: #4d4470; }
`;

const STORE_KEY = 'pathfinder.character';

/** Last chosen character, or null on a first visit. */
export function storedCharacter(): string | null {
  try {
    const id = localStorage.getItem(STORE_KEY);
    return id && CHARACTERS.some((c) => c.id === id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * Character select: a grid of 3D thumbnails. Picking one applies it straight away
 * (so you see it on the island behind the dialog); the choice is remembered.
 */
export class CharacterPicker {
  private button: HTMLButtonElement;
  private thumbs = new Map<string, string>();
  private back: HTMLDialogElement | null = null;

  constructor(
    private current: string,
    private onPick: (id: string) => void,
    /** Renders thumbnails progressively (called once, lazily). */
    private makeThumbs: (onEach: (id: string, url: string) => void) => Promise<unknown>,
  ) {
    const css = document.createElement('style');
    css.textContent = CSS;
    document.head.appendChild(css);
    this.button = document.createElement('button');
    this.button.className = 'cp-open';
    this.button.title = 'Choose character (C)';
    this.button.addEventListener('click', () => this.open(this.button));
    document.body.appendChild(this.button);
    this.renderButton();
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyC' && !e.metaKey && !e.ctrlKey && !ignoreGameShortcut(e)) this.open();
    });
  }

  private thumbsStarted = false;
  private startThumbs(): void {
    if (this.thumbsStarted) return;
    this.thumbsStarted = true;
    this.makeThumbs((id, url) => {
      this.thumbs.set(id, url);
      if (id === this.current) this.renderButton();
      const ph = this.back?.querySelector<HTMLElement>(`[data-id="${id}"] .ph`);
      if (ph) ph.replaceWith(this.img(url));
    }).catch((err) => console.warn('Character thumbnails failed', err));
  }

  private img(url: string): HTMLImageElement {
    const i = document.createElement('img');
    i.src = url;
    i.alt = '';
    return i;
  }

  private visual(id: string): HTMLElement {
    const url = this.thumbs.get(id);
    if (url) return this.img(url);
    const ph = document.createElement('div');
    ph.className = 'ph';
    return ph;
  }

  private renderButton(): void {
    this.button.replaceChildren(this.visual(this.current), document.createTextNode(characterInfo(this.current).name));
  }

  open(opener?: HTMLElement): void {
    if (this.back) return;
    const back = (this.back = document.createElement('dialog'));
    back.className = 'cp-back';
    back.setAttribute('aria-labelledby', 'cp-title');
    back.innerHTML = `
      <div class="cp">
        <header><h2 id="cp-title">Choose your pathfinder</h2>
          <p>Same brain, different look. It digs, builds and swims just the same.</p></header>
        <div class="grid"></div>
        <footer><small>Characters by Kenney (CC0) · press C to reopen</small><button type="button">Let's go</button></footer>
      </div>`;
    const grid = back.querySelector('.grid')!;
    for (const c of CHARACTERS) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'card' + (c.id === this.current ? ' on' : '');
      card.autofocus = c.id === this.current;
      card.setAttribute('aria-pressed', String(c.id === this.current));
      card.dataset.id = c.id;
      card.append(this.visual(c.id), document.createTextNode(c.name));
      card.addEventListener('click', () => this.pick(c.id));
      card.addEventListener('dblclick', () => back.close());
      grid.appendChild(card);
    }
    back.querySelector('footer button')!.addEventListener('click', () => back.close());
    showModal(back, () => {
      this.back = null;
      try {
        localStorage.setItem(STORE_KEY, this.current);
      } catch {
        /* private mode: the choice just isn't remembered */
      }
    }, opener);
    this.startThumbs();
  }

  private pick(id: string): void {
    this.current = id;
    this.back?.querySelectorAll<HTMLElement>('.card').forEach((c) => {
      const selected = c.dataset.id === id;
      c.classList.toggle('on', selected);
      c.setAttribute('aria-pressed', String(selected));
    });
    this.renderButton();
    this.onPick(id);
  }
}
