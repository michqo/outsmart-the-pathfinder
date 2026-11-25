/** Drives the loading overlay that index.html shows before any script runs. */
export class LoadingScreen {
  private root = document.getElementById('loading');
  private bar = this.root?.querySelector<HTMLElement>('.bar b') ?? null;
  private msg = this.root?.querySelector<HTMLElement>('.msg') ?? null;

  progress(fraction: number, message: string): void {
    if (this.bar) this.bar.style.width = `${Math.round(Math.min(1, fraction) * 100)}%`;
    if (this.msg) this.msg.textContent = message;
  }

  fail(message: string): void {
    if (!this.root || !this.msg) return;
    this.root.classList.add('failed');
    this.msg.textContent = message;
  }

  /** Fades out, then removes the overlay. */
  done(): Promise<void> {
    const root = this.root;
    if (!root) return Promise.resolve();
    this.progress(1, 'Ready');
    root.classList.add('done');
    return new Promise((resolve) =>
      setTimeout(() => {
        root.remove();
        resolve();
      }, 650),
    );
  }
}

export class WebGLUnavailableError extends Error {}
