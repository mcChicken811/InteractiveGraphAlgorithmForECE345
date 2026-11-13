import type { EdgeQueueSnapshot, WeightedPair } from './algorithms/types.js';

/**
 * Draws a list of edges waiting their turn (Kruskal's edges in sorted order) as a
 * horizontal strip in the side panel:
 *
 *   ← next  [1 — 2 · 2] [0 — 1 · 4] [1 — 3 · 5] …
 *
 * Each edge is a pill with its ends and weight; the first is the one the next step
 * considers. `update()` animates the change (FLIP, like QueueView): the edge just taken
 * slides out to the left — green if it was added, faded and struck through if skipped —
 * and the rest glide into place. Instant with prefers-reduced-motion. Hovering (or
 * focusing) the strip calls `onPeek`, for the canvas to show the vertices' labels.
 */

const DURATION = 340;
const EASING = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
const ARROW_LEFT =
  '<svg viewBox="0 0 24 14" width="24" height="14" aria-hidden="true"><path d="M22 7H3M8 2L3 7l5 5" /></svg>';

const keyOf = (e: WeightedPair) => `e${e.from}-${e.to}`;

export class EdgeQueueView {
  /** Called with true while the pointer is over (or focus is in) the strip, false when it leaves. */
  onPeek: ((peek: boolean) => void) | null = null;

  constructor(
    private readonly strip: HTMLElement,
    private readonly emptyNote: HTMLElement,
  ) {
    const peek = (on: boolean) => this.onPeek?.(on);
    strip.addEventListener('pointerenter', () => peek(true));
    strip.addEventListener('pointerleave', () => peek(strip.contains(document.activeElement)));
    strip.addEventListener('focusin', () => peek(true));
    strip.addEventListener('focusout', () => peek(strip.matches(':hover')));
  }

  update(snapshot: EdgeQueueSnapshot | null, animate: boolean): void {
    const motion = animate && canAnimate() && !prefersReducedMotion();
    const live = new Map<string, HTMLElement>();
    for (const el of this.strip.querySelectorAll<HTMLElement>(':scope > [data-key]:not(.exiting)')) live.set(el.dataset.key!, el);
    const before = new Map<string, DOMRect>();
    for (const [key, el] of live) before.set(key, el.getBoundingClientRect());

    const items = snapshot?.items ?? [];
    const wanted = new Set(items.map(keyOf));
    if (items.length) wanted.add('next');

    for (const [key, el] of live) {
      if (wanted.has(key)) continue;
      if (!motion) {
        el.remove();
        continue;
      }
      // Freeze it where it is and slide it away, coloured by what happened to it.
      const left = el.offsetLeft;
      const top = el.offsetTop;
      const last = snapshot?.last;
      if (last && keyOf(last) === key) el.classList.add(last.added ? 'added' : 'skipped');
      el.classList.add('exiting');
      el.removeAttribute('role');
      el.setAttribute('aria-hidden', 'true');
      Object.assign(el.style, { position: 'absolute', left: `${left}px`, top: `${top}px`, margin: '0' });
      el.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateX(-32px)', opacity: 0 }], {
        duration: DURATION,
        easing: EASING,
        fill: 'forwards',
      }).finished.then(
        () => el.remove(),
        () => el.remove(),
      );
    }

    const ordered: HTMLElement[] = [];
    if (items.length) ordered.push(live.get('next') ?? this.createArrow());
    items.forEach((edge, i) => {
      const el = live.get(keyOf(edge)) ?? this.createPill(edge);
      el.classList.toggle('front', i === 0);
      el.setAttribute('aria-label', `Edge ${edge.from} — ${edge.to}, weight ${edge.weight}${i === 0 ? ', next' : ''}`);
      ordered.push(el);
    });
    for (const el of ordered) this.strip.append(el);

    const empty = !!snapshot && items.length === 0;
    this.emptyNote.hidden = !empty;
    this.strip.hidden = !snapshot || empty;
    if (!motion) return;
    for (const el of ordered) {
      for (const running of el.getAnimations()) running.cancel();
      const was = before.get(el.dataset.key!);
      if (was) {
        const dx = was.left - el.getBoundingClientRect().left;
        if (Math.abs(dx) > 0.5) el.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: DURATION, easing: EASING });
      } else {
        el.animate([{ opacity: 0, transform: 'translateX(16px) scale(0.8)' }], { duration: DURATION, easing: EASING });
      }
    }
  }

  private createArrow(): HTMLElement {
    const el = document.createElement('span');
    el.dataset.key = 'next';
    el.className = 'q-arrow q-pop';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `${ARROW_LEFT}<span>next</span>`;
    return el;
  }

  private createPill(edge: WeightedPair): HTMLElement {
    const el = document.createElement('div');
    el.dataset.key = keyOf(edge);
    el.className = 'q-edge';
    el.setAttribute('role', 'listitem');
    const ends = document.createElement('span');
    ends.className = 'q-edge-ends';
    ends.textContent = `${edge.from} — ${edge.to}`;
    const weight = document.createElement('span');
    weight.className = 'q-edge-weight';
    weight.textContent = String(edge.weight);
    el.append(ends, weight);
    return el;
  }
}

function canAnimate(): boolean {
  return typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
