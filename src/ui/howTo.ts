import { ignoreGameShortcut, showModal } from './modal';

const CSS = /* css */ `
.ht { box-sizing: border-box; width: min(508px, calc(100vw - 32px)); max-height: calc(100% - 32px); overflow: auto;
  padding: 22px 24px 18px; border-radius: 22px; background: #fbf9ff;
  box-shadow: 0 24px 80px #1d1a2c55; font: 600 14px/1.4 ui-rounded, 'SF Pro Rounded', system-ui, sans-serif; color: #2f2a45;
}
.ht .step { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; opacity: .45; }
.ht h2 { margin: 4px 0 8px; font-size: 22px; }
.ht .art { display: grid; place-items: center; height: 120px; margin: 6px 0 12px; border-radius: 16px;
  background: linear-gradient(#eef3fb, #e3e9f3); font-size: 52px; }
.ht p { margin: 0 0 6px; font-weight: 500; }
.ht ul { margin: 6px 0 0; padding: 0; list-style: none; font-weight: 500; font-size: 13px; }
.ht li { display: flex; gap: 8px; padding: 3px 0; }
.ht li b { min-width: 112px; font-weight: 700; }
.ht footer { display: flex; align-items: center; justify-content: space-between; margin-top: 16px; }
.ht .dots { display: flex; gap: 6px; }
.ht .dots i { width: 7px; height: 7px; border-radius: 50%; background: #d9d3e6; }
.ht .dots i.on { background: #6c5ce7; }
.ht footer div:last-child { display: flex; gap: 8px; }
.ht button { padding: 9px 18px; border: 0; border-radius: 12px; font: inherit; cursor: pointer; background: #ece8f4; color: inherit; }
.ht button.next { background: #3b3355; color: #fff; }
.ht button.next:hover { background: #4d4470; }
`;

const KEY = 'pathfinder.intro';
const touch = () => matchMedia('(pointer: coarse)').matches;

interface Card {
  title: string;
  art: string;
  body: () => string;
}

const CARDS: Card[] = [
  {
    title: 'Make the bot think',
    art: '🤖 ⋯ 🚩',
    body: () =>
      `<p>The bot plans its route with A*, and you can watch every cell it considers.</p>
       <p>Your job: build a course that makes it consider as many cells (<b>nodes</b>) as possible. It still has to reach the flag for the run to count.</p>`,
  },
  {
    title: 'Build the course',
    art: '🧱 💎 💧',
    body: () =>
      touch()
        ? `<ul><li><b>Tap</b>place a block</li><li><b>− button</b>switch to removing</li>
           <li><b>Drag</b>turn the camera</li><li><b>Pinch / two fingers</b>zoom and pan</li>
           <li><b>↶</b>undo</li></ul>`
        : `<ul><li><b>Click</b>place a block (1–8 picks one)</li><li><b>Right-click</b>remove</li>
           <li><b>Shift + drag</b>fill a box</li><li><b>Drag / scroll</b>turn and zoom</li>
           <li><b>⌘Z</b>undo</li></ul>
           <p style="margin-top:8px">The bot can dig, swim, and use its blocks to bridge and climb. Slate and timber are slow to dig, crystal and ember can't be dug, and bog and snow slow it down.</p>`,
  },
  {
    title: 'Run it',
    art: '▶ ★★★',
    body: () =>
      `<p>Press <b>${touch() ? 'Run' : 'Space'}</b> and the bot searches, then walks the path. Edit while it walks and it has to rethink.</p>
       <p>Each island gives you a limited number of edits and three star targets. Editing during a run makes it practice. Earn a ★ to open bridges to the next islands.</p>`,
  },
];

/** A short 3-card "how to play". Shown on a first visit; reopen with ? or H. */
export class HowTo {
  private back: HTMLDialogElement | null = null;
  private i = 0;

  constructor() {
    const css = document.createElement('style');
    css.textContent = CSS;
    document.head.appendChild(css);
    window.addEventListener('keydown', (e) => {
      if (ignoreGameShortcut(e) || e.metaKey || e.ctrlKey) return;
      if (e.key.toLowerCase() === 'h' || e.key === '?') this.open();
    });
  }

  static get seen(): boolean {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  }

  open(onClose?: () => void, opener?: HTMLElement): void {
    if (this.back) return;
    this.i = 0;
    const back = (this.back = document.createElement('dialog'));
    back.className = 'ht-back';
    back.setAttribute('aria-label', 'How to play');
    back.innerHTML = '<div class="ht"></div>';
    back.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.next')) this.i < CARDS.length - 1 ? this.show(this.i + 1) : back.close();
      else if (t.closest('.prev')) this.show(this.i - 1);
    });
    back.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' && this.i < CARDS.length - 1) this.show(this.i + 1);
      if (e.key === 'ArrowLeft' && this.i > 0) this.show(this.i - 1);
    });
    this.show(0);
    showModal(back, () => {
      this.back = null;
      try {
        localStorage.setItem(KEY, '1');
      } catch {
        // Storage can be blocked.
      }
      onClose?.();
    }, opener);
  }

  private show(i: number): void {
    this.i = i;
    const c = CARDS[i];
    const last = i === CARDS.length - 1;
    this.back!.querySelector('.ht')!.innerHTML = `
      <div class="step">How to play · ${i + 1} of ${CARDS.length}</div>
      <h2>${c.title}</h2><div class="art">${c.art}</div>${c.body()}
      <footer><div class="dots">${CARDS.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</div>
        <div>${i > 0 ? '<button class="prev">Back</button>' : ''}<button class="next" autofocus>${last ? "Let's go" : 'Next'}</button></div></footer>`;
    this.back!.querySelector<HTMLElement>('.next')!.focus();
  }
}
