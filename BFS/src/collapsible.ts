/**
 * Collapsible cards: a title button (`aria-expanded`, `aria-controls`) shows or hides the
 * element it controls. Each card's state is remembered per browser (localStorage) under
 * its `data-collapse-key`, so a card collapsed once stays collapsed after a reload.
 */
const STORAGE_PREFIX = 'bfs-graph-builder.collapsed.';

function load(key: string): boolean | null {
  try {
    const value = localStorage.getItem(STORAGE_PREFIX + key);
    return value === null ? null : value === 'true';
  } catch {
    return null; // storage blocked (private mode, sandboxing…): fall back to the default
  }
}

function save(key: string, collapsed: boolean): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, String(collapsed));
  } catch {
    // Not persisted; the card still works for this visit.
  }
}

export function setupCollapsible(toggle: HTMLButtonElement, onChange?: () => void): void {
  const body = document.getElementById(toggle.getAttribute('aria-controls')!)!;
  const key = toggle.dataset.collapseKey;

  const set = (expanded: boolean): void => {
    toggle.setAttribute('aria-expanded', String(expanded));
    body.toggleAttribute('hidden', !expanded);
  };

  const remembered = key ? load(key) : null;
  if (remembered !== null) set(!remembered);

  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') !== 'true';
    set(expanded);
    if (key) save(key, !expanded);
    onChange?.();
  });
}
