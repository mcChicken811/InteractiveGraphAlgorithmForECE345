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
    return (
      el.querySelector('.q-index')!.textContent! +
      (el.classList.contains('front') ? '*' : '') +
      (el.classList.contains('incoming') ? '?' : '')
    );
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

  it('shows labels (e.g. distances) instead of ids, blank where there is none', () => {
    view.update({ items: [0, 1], incoming: [2] }, false, { 0: '0', 1: '1' });
    expect(strip.classList.contains('has-labels')).toBe(true);
    const labels = [...strip.querySelectorAll('.q-label')].map((el) => el.textContent);
    expect(labels).toEqual(['0', '1', '']); // 2 is not discovered yet
    expect(strip.querySelector('[data-key="v1"]')!.getAttribute('aria-label')).toBe('1, distance 1');
    view.update({ items: [0], incoming: [] }, false);
    expect(strip.classList.contains('has-labels')).toBe(false);
  });

  it('hovering or focusing the strip asks to show ids', () => {
    const peeks: boolean[] = [];
    view.onPeek = (p) => peeks.push(p);
    strip.dispatchEvent(new PointerEvent('pointerenter'));
    expect(strip.classList.contains('peek-ids')).toBe(true);
    strip.dispatchEvent(new PointerEvent('pointerleave'));
    expect(strip.classList.contains('peek-ids')).toBe(false);
    strip.dispatchEvent(new FocusEvent('focusin'));
    expect(peeks).toEqual([true, false, true]);
  });

  it('null clears everything', () => {
    view.update({ items: [0], incoming: [1] }, false);
    view.update(null, false);
    expect(strip.children).toHaveLength(0);
    expect(empty.hidden).toBe(true);
  });
});

describe('QueueView as a recursion stack', () => {
  let stack: QueueView;
  beforeEach(() => {
    document.body.innerHTML = `<div id="strip" role="list"></div><p id="empty" hidden></p>`;
    strip = document.querySelector('#strip')!;
    empty = document.querySelector('#empty')!;
    stack = new QueueView(strip, empty, {
      kind: 'stack',
      describeLabel: (label) => `times ${label}`,
    });
  });

  /** Tokens: 'ends' (+ '<' pop lit, '>' push lit), then '<id>' (+ '*' top, '?' incoming, '~' running). */
  function stackTokens(): string[] {
    return [...strip.querySelectorAll<HTMLElement>(':scope > [data-key]:not(.exiting)')].map((el) => {
      if (el.dataset.key === 'ends') {
        return (
          'ends' +
          (el.querySelector('.q-pop')!.classList.contains('active') ? '<' : '') +
          (el.querySelector('.q-push')!.classList.contains('active') ? '>' : '')
        );
      }
      return (
        el.querySelector('.q-index')!.textContent! +
        (el.classList.contains('front') ? '*' : '') +
        (el.classList.contains('incoming') ? '?' : '') +
        (el.classList.contains('running') ? '~' : '')
      );
    });
  }

  it('puts both arrows on the left, then what is pushed next, then the stack top first', () => {
    stack.update({ items: [2, 1, 0], incoming: [3], popping: false }, false);
    expect(stackTokens()).toEqual(['ends>', '3?', '2*', '1~', '0~']);
    expect(strip.classList.contains('strip-stack')).toBe(true);
    const ends = strip.querySelector('.q-ends')!;
    expect(ends.getAttribute('aria-hidden')).toBe('true');
    expect([...ends.querySelectorAll('.q-arrow')].map((a) => a.textContent)).toEqual(['pop', 'push']);
  });

  it('lights the arrow the next step uses: pop, push, or neither', () => {
    stack.update({ items: [2, 1], incoming: [], popping: true }, false);
    expect(stackTokens()).toEqual(['ends<', '2*', '1~']);
    stack.update({ items: [2, 1], incoming: [], popping: false }, false); // e.g. a back edge
    expect(stackTokens()).toEqual(['ends', '2*', '1~']);
  });

  it('a pushed vertex becomes the top in place; a popped one leaves', () => {
    stack.update({ items: [0], incoming: [1], popping: false }, false);
    const one = strip.querySelector('[data-key="v1"]');
    stack.update({ items: [1, 0], incoming: [], popping: true }, false);
    expect(stackTokens()).toEqual(['ends<', '1*', '0~']);
    expect(strip.querySelector('[data-key="v1"]')).toBe(one);
    stack.update({ items: [0], incoming: [], popping: true }, false);
    expect(stackTokens()).toEqual(['ends<', '0*']);
  });

  it('between trees the stack is empty but shows the next root about to be pushed', () => {
    stack.update({ items: [], incoming: [4], popping: false }, false);
    expect(stackTokens()).toEqual(['ends>', '4?']);
    expect(empty.hidden).toBe(true);
    stack.update({ items: [], incoming: [], popping: false }, false);
    expect(stackTokens()).toEqual([]);
    expect(empty.hidden).toBe(false);
  });

  it('describes the top and its labels to screen readers', () => {
    stack.update({ items: [2, 1], incoming: [], popping: true }, false, { 1: '1,', 2: '2,' });
    const labels = [...strip.querySelectorAll('[role="listitem"]')].map((el) => el.getAttribute('aria-label'));
    expect(labels).toEqual(['2, times 2,, top, next to be popped', '1, times 1,']);
    stack.update({ items: [2, 1], incoming: [3], popping: false }, false, { 1: '1,', 2: '2,' });
    const again = [...strip.querySelectorAll('[role="listitem"]')].map((el) => el.getAttribute('aria-label'));
    expect(again).toEqual(['3, about to be pushed', '2, times 2,, top', '1, times 1,']);
  });

  it('shrinks long labels (e.g. "10,11") to fit the circle', () => {
    stack.update({ items: [0, 1], incoming: [], popping: false }, false, { 0: '1,', 1: '10,11' });
    const size = (id: number) => strip.querySelector<HTMLElement>(`[data-key="v${id}"] .q-label`)!.style.fontSize;
    expect(size(0)).toBe(''); // fits at the normal size
    expect(parseFloat(size(1))).toBeLessThan(12);
  });
});

describe('QueueView as a min-priority queue', () => {
  let pq: QueueView;
  beforeEach(() => {
    document.body.innerHTML = `<div id="strip" role="list"></div><p id="empty" hidden></p>`;
    strip = document.querySelector('#strip')!;
    empty = document.querySelector('#empty')!;
    pq = new QueueView(strip, empty, { kind: 'priority' });
  });

  /** Tokens: 'min', then '<id>' (+ '*' smallest key, '~' ringed yellow, which never happens). */
  function pqTokens(): string[] {
    return [...strip.querySelectorAll<HTMLElement>(':scope > [data-key]:not(.exiting)')].map((el) => {
      if (el.dataset.key === 'pop') return el.textContent!;
      return (
        el.querySelector('.q-index')!.textContent! +
        (el.classList.contains('front') ? '*' : '') +
        (el.classList.contains('running') ? '~' : '')
      );
    });
  }

  it('draws ← min, then the vertices in extraction order; no push arrow, no yellow rings', () => {
    pq.update({ items: [2, 0, 1], incoming: [] }, false);
    expect(pqTokens()).toEqual(['min', '2*', '0', '1']); // 2 is white (front); the rest plain
    expect(strip.querySelector('.q-push')).toBeNull();
    expect(strip.classList.contains('strip-priority')).toBe(true);
  });

  it('re-orders the same elements when keys change, so they can glide to their new places', () => {
    pq.update({ items: [0, 1, 2], incoming: [] }, false);
    const two = strip.querySelector('[data-key="v2"]');
    pq.update({ items: [2, 1], incoming: [] }, false); // 0 extracted; 2's key dropped below 1's
    expect(pqTokens()).toEqual(['min', '2*', '1']);
    expect(strip.querySelector('[data-key="v2"]')).toBe(two);
  });

  it('reads keys out as keys, and the front as the next to be extracted', () => {
    pq.update({ items: [1, 2], incoming: [] }, false, { 1: '4', 2: '∞' });
    const labels = [...strip.querySelectorAll('[role="listitem"]')].map((el) => el.getAttribute('aria-label'));
    expect(labels).toEqual(['1, key 4, smallest key, next to be extracted', '2, key ∞']);
    expect([...strip.querySelectorAll('.q-label')].map((el) => el.textContent)).toEqual(['4', '∞']);
  });

  it('hovering keeps showing the keys in the strip (the canvas shows them instead), but still reports the peek', () => {
    const peeks: boolean[] = [];
    pq.onPeek = (p) => peeks.push(p);
    pq.update({ items: [1, 2], incoming: [] }, false, { 1: '4', 2: '∞' });
    strip.dispatchEvent(new PointerEvent('pointerenter'));
    expect(strip.classList.contains('peek-ids')).toBe(false);
    strip.dispatchEvent(new PointerEvent('pointerleave'));
    expect(peeks).toEqual([true, false]);
  });

  it('shows the empty note once every vertex has been extracted', () => {
    pq.update({ items: [], incoming: [] }, false);
    expect(empty.hidden).toBe(false);
    expect(strip.hidden).toBe(true);
  });
});
