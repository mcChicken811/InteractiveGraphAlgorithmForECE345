import { beforeEach, describe, expect, it } from 'vitest';
import { EdgeQueueView } from '../src/edge-queue-view.js';

let strip: HTMLElement;
let empty: HTMLElement;
let view: EdgeQueueView;

beforeEach(() => {
  document.body.innerHTML = `<div id="strip" role="list"></div><p id="empty" hidden></p>`;
  strip = document.querySelector('#strip')!;
  empty = document.querySelector('#empty')!;
  view = new EdgeQueueView(strip, empty);
});

const e = (from: number, to: number, weight: number) => ({ from, to, weight });
const tokens = () =>
  [...strip.querySelectorAll<HTMLElement>(':scope > [data-key]:not(.exiting)')].map((el) =>
    el.dataset.key === 'next' ? 'next' : `${el.textContent}${el.classList.contains('front') ? '*' : ''}`,
  );

describe('EdgeQueueView', () => {
  it('draws ← next, then the edges in order, each with its ends and weight', () => {
    view.update({ items: [e(1, 2, 2), e(0, 1, 4)], last: null }, false);
    expect(tokens()).toEqual(['next', '1 — 22*', '0 — 14']);
    const items = [...strip.querySelectorAll('[role="listitem"]')].map((el) => el.getAttribute('aria-label'));
    expect(items).toEqual(['Edge 1 — 2, weight 2, next', 'Edge 0 — 1, weight 4']);
    expect(strip.hidden).toBe(false);
  });

  it('reuses elements as edges move up, and drops the one taken', () => {
    view.update({ items: [e(1, 2, 2), e(0, 1, 4)], last: null }, false);
    const second = strip.querySelector('[data-key="e0-1"]');
    view.update({ items: [e(0, 1, 4)], last: { ...e(1, 2, 2), added: true } }, false);
    expect(tokens()).toEqual(['next', '0 — 14*']);
    expect(strip.querySelector('[data-key="e0-1"]')).toBe(second);
  });

  it('says when every edge has been considered; null clears it', () => {
    view.update({ items: [], last: { ...e(1, 2, 2), added: false } }, false);
    expect(empty.hidden).toBe(false);
    expect(strip.hidden).toBe(true);
    view.update(null, false);
    expect(empty.hidden).toBe(true);
  });

  it('hovering reports a peek', () => {
    const peeks: boolean[] = [];
    view.onPeek = (p) => peeks.push(p);
    strip.dispatchEvent(new PointerEvent('pointerenter'));
    strip.dispatchEvent(new PointerEvent('pointerleave'));
    expect(peeks).toEqual([true, false]);
  });
});
