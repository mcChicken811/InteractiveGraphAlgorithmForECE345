import type { TimestampSnapshot } from './algorithms/types.js';
import type { NodeId } from './graph.js';

/**
 * The DFS timestamp chart in the side panel: one bar per discovered vertex from its
 * discovery time d to its finish time f, on a time axis 1 … 2n, with each vertex on the
 * row of its depth in the depth-first forest. By the parenthesis theorem a descendant's
 * bar then sits below, and inside, its ancestor's.
 *
 *  - running bars (no f yet) reach the current time and trail off, in the canvas's
 *    yellow; finished bars are green; the bar of the vertex the next step works on has
 *    the canvas's white ring;
 *  - a "now" line and the highlighted axis label mark the current time; the chart
 *    scrolls (both ways) when it overflows, following the current time;
 *  - bars are positioned with CSS custom properties (--start, --stop, --row), so they
 *    grow and move with CSS transitions, and the scale (--unit, --row-h) can change.
 *
 * A button in the chart's bottom-right corner (shown on hover / focus) expands the whole
 * card into a modal dialog centred on the screen, over a darkened, blurred page; the
 * same button shrinks it back to its place in the panel. Both ways animate from one
 * position to the other (instant with prefers-reduced-motion).
 */

const ENTER_MS = 380;
const LEAVE_MS = 320;
const EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

export interface TimelineElements {
  /** The card (moved into the dialog while expanded). */
  card: HTMLElement;
  /** The scrolling chart area. */
  scroll: HTMLElement;
  /** The expand / shrink button in the chart's bottom-right corner. */
  expand: HTMLButtonElement;
  dialog: HTMLDialogElement;
}

export class TimelineView {
  private readonly chart: HTMLElement;
  private readonly plot: HTMLElement;
  private readonly axis: HTMLElement;
  private readonly now: HTMLElement;
  private readonly bars = new Map<NodeId, HTMLElement>();
  private end = 0;
  private clock = 0;
  private current: NodeId | null = null;
  /** Stands in for the card in the panel while it is expanded. */
  private readonly placeholder: HTMLElement;
  /** The dialog's and its backdrop's running animations (the shrink ones hold their end state). */
  private animations: Animation[] = [];

  constructor(private readonly el: TimelineElements) {
    this.chart = div('tl-chart');
    this.plot = div('tl-plot');
    this.axis = div('tl-axis');
    this.axis.setAttribute('aria-hidden', 'true');
    this.now = div('tl-now');
    this.now.setAttribute('aria-hidden', 'true');
    this.plot.append(this.now);
    this.chart.append(this.plot, this.axis);
    el.scroll.replaceChildren(this.chart);
    window.addEventListener('resize', () => this.fitWidth());

    this.placeholder = div('info-card tl-placeholder');
    this.placeholder.setAttribute('aria-hidden', 'true');

    el.expand.addEventListener('click', () => (this.expanded ? this.collapse() : this.expand()));
    // Esc shrinks it back (animated) instead of closing the dialog outright, and does not
    // reach the page (which would also close the ☰ panel).
    el.dialog.addEventListener('cancel', (e) => e.preventDefault());
    el.dialog.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      this.collapse();
    });
    // A click on the darkened backdrop (outside the card) also shrinks it back.
    el.dialog.addEventListener('click', (e) => {
      if (e.target === el.dialog) this.collapse();
    });
  }

  get expanded(): boolean {
    return this.el.dialog.open;
  }

  /** Shows `snapshot` (or clears the chart, for null). `animate` lets bars grow / fade in. */
  update(snapshot: TimestampSnapshot | null, animate: boolean): void {
    if (!snapshot) {
      for (const bar of this.bars.values()) bar.remove();
      this.bars.clear();
      this.setEnd(0);
      this.clock = 0;
      this.current = null;
      this.now.hidden = true;
      return;
    }
    const motion = animate && canAnimate() && !prefersReducedMotion();
    this.setEnd(snapshot.end);
    this.clock = snapshot.clock;
    this.current = snapshot.current;
    const rows = Math.max(1, ...snapshot.intervals.map((i) => i.depth + 1));
    this.chart.style.setProperty('--rows', String(rows));

    const live = new Set<NodeId>();
    for (const interval of snapshot.intervals) {
      live.add(interval.id);
      let bar = this.bars.get(interval.id);
      const fresh = !bar;
      if (!bar) {
        bar = div('tl-bar');
        bar.dataset.id = String(interval.id);
        bar.setAttribute('role', 'listitem');
        bar.textContent = String(interval.id);
        this.plot.insertBefore(bar, this.now);
        this.bars.set(interval.id, bar);
      }
      const running = interval.finish === null;
      bar.style.setProperty('--start', String(interval.start));
      bar.style.setProperty('--stop', String(running ? snapshot.clock : interval.finish));
      bar.style.setProperty('--row', String(interval.depth));
      bar.classList.toggle('running', running);
      bar.classList.toggle('current', interval.id === snapshot.current);
      const label = running
        ? `Vertex ${interval.id}: discovered at ${interval.start}, still running`
        : `Vertex ${interval.id}: discovered at ${interval.start}, finished at ${interval.finish}`;
      bar.setAttribute('aria-label', label);
      bar.title = label;
      if (fresh && motion) {
        bar.animate([{ opacity: 0, transform: 'scaleX(0.6)' }, { opacity: 1, transform: 'none' }], {
          duration: 300,
          easing: EASING,
        });
      }
    }
    for (const [id, bar] of this.bars) {
      if (!live.has(id)) {
        bar.remove();
        this.bars.delete(id);
      }
    }

    this.fitWidth();
    this.now.hidden = snapshot.clock < 1;
    this.now.style.setProperty('--t', String(Math.max(1, snapshot.clock)));
    for (const label of this.axis.children) {
      label.classList.toggle('now', Number((label as HTMLElement).dataset.t) === snapshot.clock);
    }
    this.followClock(motion);
  }

  /** Expands the card into a dialog in the middle of the screen. */
  expand(): void {
    if (this.expanded) return;
    const { card, dialog, expand } = this.el;
    const before = card.getBoundingClientRect();
    this.placeholder.style.height = `${before.height}px`;
    card.replaceWith(this.placeholder);
    dialog.append(card);
    card.classList.add('tl-expanded');
    card.querySelector<HTMLButtonElement>('.card-toggle')?.setAttribute('disabled', '');
    dialog.showModal();
    this.fitWidth();
    this.setButton(true);
    expand.focus();
    this.animateBetween(before, dialog.getBoundingClientRect(), ENTER_MS, false);
    this.followClock(false);
  }

  /** Shrinks the dialog back into the card's place in the panel. */
  collapse(animate = true): void {
    if (!this.expanded) return;
    const { card, dialog } = this.el;
    const from = dialog.getBoundingClientRect();
    const to = this.placeholder.getBoundingClientRect();
    card.classList.remove('tl-expanded'); // the scale shrinks back while it moves
    this.fitWidth(to.width - (from.width - this.el.scroll.clientWidth));
    this.setButton(false);
    const done = () => {
      dialog.close();
      // Drop the shrink animations' held end state, or the next expansion would start from it.
      this.cancelAnimations();
      this.placeholder.replaceWith(card);
      card.querySelector<HTMLButtonElement>('.card-toggle')?.removeAttribute('disabled');
      this.fitWidth();
      if (animate) this.el.expand.focus();
      this.followClock(false);
    };
    const motion = animate && canAnimate() && !prefersReducedMotion() && to.width > 0;
    if (!motion) {
      this.cancelAnimations();
      done();
      return;
    }
    const anim = this.animateBetween(from, to, LEAVE_MS, true);
    anim?.finished.then(done, () => {});
  }

  /** Animates the dialog from one rectangle to another, fading the backdrop in or out. */
  private animateBetween(from: DOMRect, to: DOMRect, duration: number, leaving: boolean): Animation | null {
    if (!canAnimate() || prefersReducedMotion() || from.width === 0) return null;
    this.cancelAnimations();
    const box = (r: DOMRect): Keyframe => ({
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      translate: 'none',
    });
    const timing: KeyframeAnimationOptions = { duration, easing: EASING, fill: leaving ? 'forwards' : 'none' };
    const moving = this.el.dialog.animate([box(from), box(to)], timing);
    this.animations = [moving];
    try {
      const fade = [{ opacity: 0 }, { opacity: 1 }];
      this.animations.push(
        this.el.dialog.animate(leaving ? fade.reverse() : fade, { ...timing, pseudoElement: '::backdrop' }),
      );
    } catch {
      // No ::backdrop animation support: it just appears / disappears.
    }
    return moving;
  }

  private cancelAnimations(): void {
    for (const a of this.animations) a.cancel();
    this.animations = [];
  }

  private setButton(expanded: boolean): void {
    this.el.expand.setAttribute('aria-expanded', String(expanded));
    this.el.expand.setAttribute('aria-label', expanded ? 'Shrink the timestamp chart' : 'Expand the timestamp chart');
    this.el.expand.title = expanded ? 'Shrink back (Esc)' : 'Expand';
  }

  /**
   * Widens the time step (from its minimum, --unit-min) so the axis spans the whole
   * width when it would otherwise stop short; never narrows it (the chart scrolls instead).
   * `width` is the chart area's width to fit, if it is not the current one (mid-move).
   */
  private fitWidth(width = this.el.scroll.clientWidth): void {
    const style = getComputedStyle(this.el.scroll);
    const min = parseFloat(style.getPropertyValue('--unit-min')) || 0;
    const pad = parseFloat(style.getPropertyValue('--pad')) || 0;
    if (!min || this.end < 2 || width <= 0) {
      this.chart.style.removeProperty('--fit-unit');
      return;
    }
    const fit = Math.max(min, (width - 2 * pad) / (this.end - 1));
    this.chart.style.setProperty('--fit-unit', `${Math.floor(fit * 100) / 100}px`);
  }

  /** Redraws the grid and axis labels for times 1 … end. */
  private setEnd(end: number): void {
    if (end === this.end) return;
    this.end = end;
    this.chart.style.setProperty('--end', String(Math.max(end, 1)));
    for (const tick of this.plot.querySelectorAll('.tl-tick')) tick.remove();
    this.axis.replaceChildren();
    for (let t = 1; t <= end; t++) {
      const tick = div('tl-tick');
      tick.style.setProperty('--t', String(t));
      this.plot.prepend(tick);
      const label = document.createElement('span');
      label.dataset.t = String(t);
      label.style.setProperty('--t', String(t));
      label.textContent = String(t);
      this.axis.append(label);
    }
  }

  /** Scrolls so the current time (and the white bar's row) are in view. */
  private followClock(smooth: boolean): void {
    const scroll = this.el.scroll;
    const style = getComputedStyle(this.chart);
    const unit = parseFloat(style.getPropertyValue('--unit')) || 0;
    const pad = parseFloat(style.getPropertyValue('--pad')) || 0;
    const rowH = parseFloat(style.getPropertyValue('--row-h')) || 0;
    if (!unit || scroll.clientWidth === 0) return;
    const x = pad + (Math.max(1, this.clock) - 1) * unit;
    let left = scroll.scrollLeft;
    if (x < left + unit || x > left + scroll.clientWidth - 2 * unit) left = Math.max(0, x - scroll.clientWidth * 0.6);
    let top = scroll.scrollTop;
    const row = this.current === null ? null : Number(this.bars.get(this.current)?.style.getPropertyValue('--row'));
    if (row !== null && !Number.isNaN(row) && rowH) {
      const y = row * rowH;
      const visible = scroll.clientHeight - 32; // minus the axis
      if (y < top || y + rowH > top + visible) top = Math.max(0, y - visible / 2);
    }
    if (left === scroll.scrollLeft && top === scroll.scrollTop) return;
    if (typeof scroll.scrollTo === 'function') scroll.scrollTo({ left, top, behavior: smooth ? 'smooth' : 'auto' });
  }
}

function div(className: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  return el;
}

function canAnimate(): boolean {
  return typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
