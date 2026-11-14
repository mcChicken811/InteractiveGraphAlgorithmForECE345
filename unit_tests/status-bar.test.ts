import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusBar } from '../src/status-bar.js';

// Layout (happy-dom has none): the area is 1000×700 at the origin; the bar is centred at
// the bottom, x 400–600, y 650–684.
const AREA = { left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700, x: 0, y: 0 };
const BAR = { left: 400, top: 650, right: 600, bottom: 684, width: 200, height: 34, x: 400, y: 650 };

let area: HTMLElement;
let bar: HTMLElement;
let status: StatusBar;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="area"><p id="bar"></p></div>';
  area = document.querySelector('#area')!;
  bar = document.querySelector('#bar')!;
  area.getBoundingClientRect = () => AREA as DOMRect;
  bar.getBoundingClientRect = () => BAR as DOMRect;
  status = new StatusBar(bar, area);
});

afterEach(() => {
  vi.useRealTimers();
});

const move = (x: number, y: number) =>
  area.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
const hidden = () => bar.classList.contains('is-hidden');

describe('StatusBar', () => {
  it('shows a message with its tone', () => {
    status.show('Added node 0.');
    expect(bar.textContent).toBe('Added node 0.');
    expect(bar.dataset.tone).toBe('info');
    status.show('Too close to node 0.', 'warn');
    expect(bar.dataset.tone).toBe('warn');
    expect(status.visible).toBe(true);
  });

  it('hides after 2.3 seconds without a new message', () => {
    status.show('Hello');
    vi.advanceTimersByTime(2299);
    expect(hidden()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(hidden()).toBe(true);
    expect(status.visible).toBe(false);
  });

  it('a new message brings it back and restarts the countdown', () => {
    status.show('First');
    vi.advanceTimersByTime(2300);
    expect(hidden()).toBe(true);
    status.show('Second');
    expect(hidden()).toBe(false);
    vi.advanceTimersByTime(2000);
    status.show('Third'); // resets the 2.3 s
    vi.advanceTimersByTime(2000);
    expect(hidden()).toBe(false);
    vi.advanceTimersByTime(300);
    expect(hidden()).toBe(true);
  });

  it('stays up while hovered; the countdown restarts when the pointer leaves', () => {
    status.show('Hello');
    bar.dispatchEvent(new PointerEvent('pointerenter'));
    vi.advanceTimersByTime(20_000);
    expect(hidden()).toBe(false);
    bar.dispatchEvent(new PointerEvent('pointerleave'));
    vi.advanceTimersByTime(2299);
    expect(hidden()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(hidden()).toBe(true);
  });

  it('moving near the bottom edge where it hides brings it back', () => {
    status.show('Hello');
    vi.advanceTimersByTime(2300);
    expect(hidden()).toBe(true);
    move(500, 300); // far away
    expect(hidden()).toBe(true);
    move(500, 690); // near the bottom, under the bar
    expect(hidden()).toBe(false);
  });

  it('"near" is a band along the bottom, around the bar, with some slack on each side', () => {
    status.show('Hello');
    vi.advanceTimersByTime(2300);
    move(150, 690); // bottom edge, but far to the side
    expect(hidden()).toBe(true);
    move(370, 690); // within the slack beside the bar
    expect(hidden()).toBe(false);
  });

  it('stays up while the pointer stays near, and hides 2.3 s after it moves away', () => {
    status.show('Hello');
    move(500, 690);
    vi.advanceTimersByTime(20_000);
    expect(hidden()).toBe(false);
    move(500, 200);
    vi.advanceTimersByTime(2300);
    expect(hidden()).toBe(true);
  });

  it('leaving the area counts as moving away', () => {
    status.show('Hello');
    move(500, 690);
    area.dispatchEvent(new PointerEvent('pointerleave'));
    vi.advanceTimersByTime(2300);
    expect(hidden()).toBe(true);
  });

  it('a tap near the bottom (touch screens) brings it back too', () => {
    status.show('Hello');
    vi.advanceTimersByTime(2300);
    area.dispatchEvent(new PointerEvent('pointerdown', { clientX: 500, clientY: 695, bubbles: true }));
    expect(hidden()).toBe(false);
  });

  it('keeps the text in its own element (so it can fade and hold its width while the bar resizes)', () => {
    status.show('Hello');
    const text = bar.querySelector('.message-text');
    expect(text?.textContent).toBe('Hello');
    expect(bar.children).toHaveLength(1);
    status.show('A much longer message');
    expect(bar.querySelector('.message-text')).toBe(text); // reused, not replaced
    expect(text!.textContent).toBe('A much longer message');
  });

  it('keeps any initial text (e.g. the no-script fallback) inside the text element', () => {
    document.body.innerHTML = '<div id="a2"><p id="b2">  Loading…  </p></div>';
    const b2 = document.querySelector<HTMLElement>('#b2')!;
    new StatusBar(b2, document.querySelector('#a2')!);
    expect(b2.querySelector('.message-text')!.textContent).toBe('Loading…');
  });

  it('respects a custom delay', () => {
    const quick = new StatusBar(bar, area, { hideAfterMs: 1000 });
    quick.show('Hi');
    vi.advanceTimersByTime(1000);
    expect(hidden()).toBe(true);
  });
});
