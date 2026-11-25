/** Native modals keep focus and pointer input out of the game while open. */
export function showModal(
  dialog: HTMLDialogElement,
  onClose?: () => void,
  opener?: HTMLElement,
): void {
  const previous = opener ?? document.activeElement;
  dialog.classList.add('game-dialog');
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.defaultPrevented) return;
    const stops = [...dialog.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]')]
      .filter((el) => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0);
    const first = stops[0], last = stops.at(-1);
    if (e.shiftKey && document.activeElement === first && last) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last && first) {
      e.preventDefault();
      first.focus();
    }
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (previous instanceof HTMLElement && !document.querySelector('dialog[open]')) previous.focus();
    onClose?.();
  }, { once: true });
  document.body.appendChild(dialog);
  dialog.showModal();
}

export function ignoreGameShortcut(e: KeyboardEvent): boolean {
  return e.defaultPrevented || !!document.querySelector('dialog[open]') ||
    (e.target instanceof Element && !!e.target.closest(
      'button, input, select, textarea, a[href], [contenteditable]:not([contenteditable="false"]), [role="button"], [role="slider"]',
    ));
}
