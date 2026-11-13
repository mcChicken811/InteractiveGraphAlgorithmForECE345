import { beforeEach, describe, expect, it } from 'vitest';
import { TimelineView } from '../src/timeline-view.js';
import type { TimestampSnapshot } from '../src/algorithms/types.js';

let card: HTMLElement;
let scroll: HTMLElement;
let button: HTMLButtonElement;
let dialog: HTMLDialogElement;
let view: TimelineView;

beforeEach(() => {
  document.body.innerHTML = `
    <aside id="panel"><section id="card" class="info-card"><button class="card-toggle"></button>
      <div class="tl-frame"><div id="scroll"></div><button id="expand" aria-expanded="false"></button></div>
    </section><section id="after"></section></aside>
    <dialog id="dialog"></dialog>`;
  card = document.querySelector('#card')!;
  scroll = document.querySelector('#scroll')!;
  button = document.querySelector('#expand')!;
  dialog = document.querySelector('#dialog')!;
  view = new TimelineView({ card, scroll, expand: button, dialog });
});

/** 0 (1, …) → 1 (2, 3) and 0 → 2 (4, …): clock 4, about to work on 2. */
const SNAPSHOT: TimestampSnapshot = {
  clock: 4,
  end: 8,
  intervals: [
    { id: 0, start: 1, finish: null, depth: 0 },
    { id: 1, start: 2, finish: 3, depth: 1 },
    { id: 2, start: 4, finish: null, depth: 1 },
  ],
  current: 2,
};

const bar = (id: number) => scroll.querySelector<HTMLElement>(`.tl-bar[data-id="${id}"]`)!;
const vars = (el: HTMLElement, ...names: string[]) => names.map((n) => el.style.getPropertyValue(`--${n}`));

describe('TimelineView', () => {
  it('draws a bar per interval, from discovery to finish, on the row of its depth', () => {
    view.update(SNAPSHOT, false);
    expect(vars(bar(1), 'start', 'stop', 'row')).toEqual(['2', '3', '1']);
    expect(bar(1).classList.contains('running')).toBe(false);
    expect(bar(1).textContent).toBe('1');
    expect(bar(1).getAttribute('aria-label')).toBe('Vertex 1: discovered at 2, finished at 3');
  });

  it('running bars reach the current time; the next step’s vertex is marked current', () => {
    view.update(SNAPSHOT, false);
    expect(vars(bar(0), 'start', 'stop')).toEqual(['1', '4']);
    expect(bar(0).classList.contains('running')).toBe(true);
    expect(bar(0).getAttribute('aria-label')).toBe('Vertex 0: discovered at 1, still running');
    expect(bar(2).classList.contains('current')).toBe(true);
    expect(bar(0).classList.contains('current')).toBe(false);
  });

  it('has an axis 1 … end with the current time highlighted, and a now line', () => {
    view.update(SNAPSHOT, false);
    const labels = [...scroll.querySelectorAll<HTMLElement>('.tl-axis span')];
    expect(labels.map((l) => l.textContent)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(labels.filter((l) => l.classList.contains('now')).map((l) => l.textContent)).toEqual(['4']);
    expect(scroll.querySelectorAll('.tl-tick')).toHaveLength(8);
    const now = scroll.querySelector<HTMLElement>('.tl-now')!;
    expect(now.hidden).toBe(false);
    expect(now.style.getPropertyValue('--t')).toBe('4');
    expect(scroll.querySelector<HTMLElement>('.tl-chart')!.style.getPropertyValue('--rows')).toBe('2');
  });

  it('updates bars in place, so they can grow smoothly', () => {
    view.update(SNAPSHOT, false);
    const zero = bar(0);
    view.update({ ...SNAPSHOT, clock: 5, intervals: [{ ...SNAPSHOT.intervals[0] }] }, false);
    expect(bar(0)).toBe(zero);
    expect(vars(zero, 'stop')).toEqual(['5']);
    expect(scroll.querySelectorAll('.tl-bar')).toHaveLength(1); // the others are gone
  });

  it('before the first timestamp there is no now line; null clears everything', () => {
    view.update({ clock: 0, end: 6, intervals: [], current: null }, false);
    expect(scroll.querySelector<HTMLElement>('.tl-now')!.hidden).toBe(true);
    view.update(SNAPSHOT, false);
    view.update(null, false);
    expect(scroll.querySelectorAll('.tl-bar, .tl-tick, .tl-axis span')).toHaveLength(0);
  });

  describe('expanding', () => {
    it('moves the card into the dialog (leaving a placeholder) and back again', () => {
      view.update(SNAPSHOT, false);
      button.click();
      expect(view.expanded).toBe(true);
      expect(dialog.open).toBe(true);
      expect(card.parentElement).toBe(dialog);
      expect(card.classList.contains('tl-expanded')).toBe(true);
      const placeholder = document.querySelector('#panel > .tl-placeholder');
      expect(placeholder).not.toBeNull();
      expect(placeholder!.nextElementSibling!.id).toBe('after'); // in the card's place
      expect(button.getAttribute('aria-expanded')).toBe('true');
      expect(button.getAttribute('aria-label')).toBe('Shrink the timestamp chart');
      expect(card.querySelector('.card-toggle')!.hasAttribute('disabled')).toBe(true);

      button.click(); // same button, same place: shrinks back
      expect(view.expanded).toBe(false);
      expect(card.parentElement!.id).toBe('panel');
      expect(card.nextElementSibling!.id).toBe('after');
      expect(document.querySelector('.tl-placeholder')).toBeNull();
      expect(card.classList.contains('tl-expanded')).toBe(false);
      expect(button.getAttribute('aria-label')).toBe('Expand the timestamp chart');
      expect(card.querySelector('.card-toggle')!.hasAttribute('disabled')).toBe(false);
    });

    it('Esc shrinks it back, without reaching the page', () => {
      let reached = false;
      window.addEventListener('keydown', () => (reached = true), { once: true });
      button.click();
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(view.expanded).toBe(false);
      expect(reached).toBe(false);
    });

    it('a click on the backdrop shrinks it back; clicks inside do not', () => {
      button.click();
      card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(view.expanded).toBe(true);
      dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(view.expanded).toBe(false);
    });

    it('collapse(false) puts it back at once (e.g. when the run stops)', () => {
      button.click();
      view.collapse(false);
      expect(dialog.open).toBe(false);
      expect(card.parentElement!.id).toBe('panel');
    });
  });
});
