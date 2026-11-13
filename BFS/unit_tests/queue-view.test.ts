import { beforeEach, describe, expect, it } from 'vitest';
import { QueueView } from '../src/queue-view.js';

let strip: HTMLElement;
let empty: HTMLElement;
let view: QueueView;

beforeEach(() => {
  document.body.innerHTML = `<div id="strip" role="list"></div><p id="empty" hidden></p>`;
  strip = document.querySelector('#strip')!;
  empty = document.querySelector('#empty')!;
  view = new QueueView(strip, empty);
});

/** The strip's contents as short tokens, e.g. ['pop', '0*', '1', '2?', 'push']. */
function tokens(): string[] {
  return [...strip.querySelectorAll<HTMLElement>(':scope > [data-key]:not(.exiting)')].map((el) => {
    const key = el.dataset.key!;
    if (key === 'pop' || key === 'push') return key;
    return el.textContent! + (el.classList.contains('front') ? '*' : '') + (el.classList.contains('incoming') ? '?' : '');
  });
}

describe('QueueView', () => {
  it('draws ← pop, the queue front first, the incoming vertices, then ← push', () => {
    view.update({ items: [0, 1], incoming: [2, 3] }, false);
    expect(tokens()).toEqual(['pop', '0*', '1', '2?', '3?', 'push']);
    expect(strip.hidden).toBe(false);
    expect(empty.hidden).toBe(true);
  });

  it('vertices are list items with descriptive labels; arrows are decorative', () => {
    view.update({ items: [4, 5], incoming: [6] }, false);
    const items = [...strip.querySelectorAll('[role="listitem"]')];
    expect(items.map((el) => el.getAttribute('aria-label'))).toEqual([
      '4, next to be popped',
      '5',
      '6, about to be pushed',
    ]);
    for (const arrow of strip.querySelectorAll('.q-arrow')) expect(arrow.getAttribute('aria-hidden')).toBe('true');
    expect(strip.querySelector('.q-pop')!.textContent).toBe('pop');
    expect(strip.querySelector('.q-push')!.textContent).toBe('push');
  });

  it('leaves out the push arrow when nothing is about to be pushed', () => {
    view.update({ items: [1, 2], incoming: [] }, false);
    expect(tokens()).toEqual(['pop', '1*', '2']);
  });

  it('reuses elements across updates, so they can be animated', () => {
    view.update({ items: [0], incoming: [1, 2] }, false);
    const one = strip.querySelector('[data-key="v1"]');
    view.update({ items: [1, 2], incoming: [3] }, false); // 0 popped, 1 and 2 pushed
    expect(tokens()).toEqual(['pop', '1*', '2', '3?', 'push']);
    expect(strip.querySelector('[data-key="v1"]')).toBe(one); // same element, now the front
    expect(one!.classList.contains('incoming')).toBe(false);
    expect(strip.querySelector('[data-key="v0"]')).toBeNull(); // popped (no animation requested)
  });

  it('shows the empty note once the queue is empty', () => {
    view.update({ items: [0], incoming: [] }, false);
    view.update({ items: [], incoming: [] }, false);
    expect(tokens()).toEqual([]);
    expect(empty.hidden).toBe(false);
    expect(strip.hidden).toBe(true);
  });

  it('null clears everything', () => {
    view.update({ items: [0], incoming: [1] }, false);
    view.update(null, false);
    expect(strip.children).toHaveLength(0);
    expect(empty.hidden).toBe(true);
  });
});
