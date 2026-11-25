const CSS = /* css */ `
.cn { position: fixed; right: 12px; bottom: 18px; z-index: 20; display: flex; align-items: center; gap: 8px;
  font: 700 13px/1 ui-rounded, 'SF Pro Rounded', system-ui, sans-serif; color: #3b3355; user-select: none; }
.cn button { border: 0; cursor: pointer; font: inherit; color: inherit; }
.cn .round { width: 38px; height: 38px; border-radius: 50%; background: #ffffffd0; box-shadow: 0 6px 24px #5a4a7a22, inset 0 0 0 1px #fff; font-size: 16px; }
.cn .round:hover { background: #fff; }
.cn .run { display: flex; align-items: center; gap: 8px; height: 46px; padding: 0 18px 0 16px; border-radius: 16px;
  background: #3b3355; color: #fff; font-size: 15px; box-shadow: 0 8px 24px #3b335555; transition: transform .12s, background .15s; }
.cn .run:hover { background: #4d4470; }
.cn .run:active { transform: scale(.96); }
.cn .run kbd { font: inherit; font-size: 10px; padding: 3px 6px; border-radius: 6px; background: #ffffff26; }
.cn .run.busy { background: #6c5ce7; }
@media (max-width: 1100px) { .cn { bottom: 76px; } }
@media (max-width: 720px), (pointer: coarse) {
  .cn { right: 10px; bottom: 70px; flex-direction: column-reverse; align-items: flex-end; }
  .cn .run kbd { display: none; }
}
`;

export interface CornerHandlers {
  onRun(): void;
  onHelp(opener: HTMLButtonElement): void;
  onMute(muted: boolean): void;
}

/** Bottom-right: the Run button (Space), how to play (?) and mute. */
export class Corner {
  private run: HTMLButtonElement;
  private mute: HTMLButtonElement;

  constructor(muted: boolean, h: CornerHandlers) {
    const css = document.createElement('style');
    css.textContent = CSS;
    document.head.appendChild(css);
    const el = document.createElement('div');
    el.className = 'cn';
    el.innerHTML = `<button class="round help" title="How to play (H)" aria-label="How to play">?</button>
      <button class="round mute"></button>
      <button class="run"><span class="lbl">▶ Run</span><kbd>Space</kbd></button>`;
    document.body.appendChild(el);
    this.run = el.querySelector('.run')!;
    this.mute = el.querySelector('.mute')!;
    this.setMuted(muted);
    this.run.onclick = () => h.onRun();
    const help = el.querySelector<HTMLButtonElement>('.help')!;
    help.onclick = () => h.onHelp(help);
    this.mute.onclick = () => {
      const m = this.mute.dataset.muted !== '1';
      this.setMuted(m);
      h.onMute(m);
    };
  }

  setMuted(m: boolean): void {
    this.mute.dataset.muted = m ? '1' : '0';
    this.mute.textContent = m ? '🔇' : '🔊';
    this.mute.title = m ? 'Sound off' : 'Sound on';
    this.mute.setAttribute('aria-label', this.mute.title);
  }

  /** While a run is in progress the button restarts it. */
  setBusy(busy: boolean): void {
    this.run.classList.toggle('busy', busy);
    (this.run.querySelector('.lbl') as HTMLElement).textContent = busy ? '↻ Restart' : '▶ Run';
  }
}
