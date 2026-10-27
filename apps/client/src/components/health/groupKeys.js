import { nextIndex } from '../../lib/health.js';

const ITEM = '[role="radio"],[role="tab"]';

/**
 * keydown handler for a radiogroup / tablist with roving tabindex: arrows,
 * Home and End move focus and selection to a sibling (selection follows focus
 * by clicking it); Space and Enter select the focused non-button item.
 */
export function onGroupKeyDown(event) {
  const items = [...event.currentTarget.querySelectorAll(ITEM)];
  const target = event.target.closest(ITEM);
  const current = items.indexOf(target);
  if (current < 0) return;

  const next = nextIndex(items.length, current, event.key);
  if (next != null) {
    event.preventDefault();
    items[next].focus();
    items[next].click();
    return;
  }
  if ((event.key === ' ' || event.key === 'Enter') && target.tagName !== 'BUTTON') {
    event.preventDefault();
    target.click();
  }
}
