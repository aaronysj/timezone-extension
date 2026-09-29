/** Native light-dismiss popover: Escape, outside click, and top-layer stacking. */
export function attachPopover(trigger: HTMLButtonElement, panel: HTMLElement, focusId?: string): void {
  panel.popover = 'auto';
  panel.dataset.anchor = trigger.id;
  trigger.popoverTargetElement = panel;
  trigger.popoverTargetAction = 'toggle';
  trigger.ariaExpanded = 'false';
  trigger.setAttribute('aria-controls', panel.id);
  panel.addEventListener('toggle', (event) => {
    const open = (event as ToggleEvent).newState === 'open';
    trigger.ariaExpanded = String(open);
    if (!open || !panel.isConnected) return;
    if (focusId) document.getElementById(focusId)?.focus();
    position(panel);
  });
}

function position(panel: HTMLElement): void {
  const anchor = document.getElementById(panel.dataset.anchor!);
  if (!anchor) return;
  const box = anchor.getBoundingClientRect();
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  const below = innerHeight - box.bottom - 16;
  const above = box.top - 16;
  panel.style.left = `${Math.max(12, Math.min(box.left, innerWidth - width - 12))}px`;
  panel.style.top = `${below >= Math.min(height, 220) || below >= above ? box.bottom + 6 : Math.max(12, box.top - height - 6)}px`;
  panel.style.maxHeight = `${Math.max(160, below >= Math.min(height, 220) || below >= above ? below : above)}px`;
}

// One set of listeners, independent of how often settings rerender.
for (const event of ['resize', 'scroll']) window.addEventListener(event, () => {
  for (const panel of document.querySelectorAll<HTMLElement>('.rule-popover:popover-open')) position(panel);
}, { capture: true, passive: true });
