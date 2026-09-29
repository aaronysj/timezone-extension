import caret from '@phosphor-icons/core/assets/regular/caret-down.svg?raw';
import globe from '@phosphor-icons/core/assets/regular/globe.svg?raw';
import monitor from '@phosphor-icons/core/assets/regular/monitor.svg?raw';
import more from '@phosphor-icons/core/assets/regular/dots-three-vertical.svg?raw';
import trash from '@phosphor-icons/core/assets/regular/trash.svg?raw';
import check from '@phosphor-icons/core/assets/regular/check.svg?raw';
import { h } from './dom';

const assets = { caret, globe, monitor, more, trash, check };
/** Only trusted, bundled library assets enter this markup. */
export function icon(name: keyof typeof assets): HTMLElement {
  const el = h('span', { className: 'ui-icon', ariaHidden: 'true' });
  el.innerHTML = assets[name];
  return el;
}
