import type { QueueSnapshot } from './algorithms/types.js';
import type { NodeId } from './graph.js';

/**
 * Draws an algorithm's queue as a horizontal strip in the side panel:
 *
 *   ← pop  (front) (…) (back)  (incoming…)  ← push
 *
 * Vertices are drawn like the canvas nodes (ringed circle with the id), smaller. The
 * front vertex — popped by the next step — has the canvas's white "current" ring; the
 * vertices the next step will push are greyed out after the back of the queue.
 *
 * `update()` animates the change from the previous snapshot (FLIP): the popped vertex
 * turns green and slides out to the left, the rest glide into their new places,
 * incoming vertices fill in as they join the queue, and new incoming ones fade in. With
 * `prefers-reduced-motion`, or `animate = false`, it updates instantly. The strip
 * scrolls horizontally when it overflows.
 */

const DURATION = 340;
const EASING = 'cubic-bezier(0.2, 0.7, 0.2, 1)';

type ItemKind = 'pop' | 'push' | 'front' | 'queued' | 'incoming';

interface Item {
  key: string;
  kind: ItemKind;
  id?: NodeId;
}

const ARROW_LEFT =
  '<svg viewBox="0 0 24 14" width="24" height="14" aria-hidden="true"><path d="M22 7H3M8 2L3 7l5 5" /></svg>';

export class QueueView {
  /**
   * Called with `true` while the pointer is over (or keyboard focus is in) the strip, and
   * `false` when it leaves: vertex labels then switch back to ids, here and on the canvas.
   */
  onPeek: ((peek: boolean) => void) | null = null;
  private labels: Record<NodeId, string> | undefined;

  constructor(
    private readonly strip: HTMLElement,
    private readonly emptyNote: HTMLElement,
  ) {
    const peek = (on: boolean) => {
      strip.classList.toggle('peek-ids', on);
      this.onPeek?.(on);
    };
    strip.addEventListener('pointerenter', () => peek(true));
    strip.addEventListener('pointerleave', () => peek(strip.contains(document.activeElement)));
    strip.addEventListener('focusin', () => peek(true));
    strip.addEventListener('focusout', () => peek(strip.matches(':hover')));
  }

  /**
   * Shows `snapshot` (or nothing, for null), animating from the previous one if asked.
   * `labels` (e.g. BFS distances) are drawn inside the vertices instead of their ids;
   * vertices without a label are left blank. Hovering the strip shows the ids.
   */
  update(snapshot: QueueSnapshot | null, animate: boolean, labels?: Record<NodeId, string>): void {
    this.labels = labels;
    this.strip.classList.toggle('has-labels', !!labels);
    const motion = animate && canAnimate() && !prefersReducedMotion();
    const live = this.liveElements();

    // FLIP, step 1 ("First"): where every item is drawn right now.
    const before = new Map<string, DOMRect>();
    for (const [key, el] of live) before.set(key, el.getBoundingClientRect());

    const items = snapshot ? this.items(snapshot) : [];
    const wanted = new Set(items.map((i) => i.key));

    // Items that leave (the popped vertex, an arrow that is no longer needed).
    for (const [key, el] of live) {
      if (wanted.has(key)) continue;
      if (!motion) {
        el.remove();
        continue;
      }
      // Freeze it where it is, out of the flow, and let it slide away.
      const left = el.offsetLeft;
      const top = el.offsetTop;
      el.classList.add('exiting');
      if (el.classList.contains('front')) el.classList.add('popped'); // green, like the canvas
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

    // Build the new order, reusing elements by key so they can be animated.
    const ordered = items.map((item) => {
      const el = live.get(item.key) ?? this.create(item);
      this.apply(el, item);
      return el;
    });
    for (const el of ordered) this.strip.append(el); // moves existing ones into place

    const empty = !!snapshot && items.length === 0;
    this.emptyNote.hidden = !empty;
    this.strip.hidden = !snapshot || empty;
    if (!motion) return;

    // FLIP, steps 2–4 ("Last, Invert, Play"): animate each item from where it was.
    for (const el of ordered) {
      const key = el.dataset.key!;
      const was = before.get(key);
      for (const running of el.getAnimations()) running.cancel();
      if (was) {
        const now = el.getBoundingClientRect();
        const dx = was.left - now.left;
        if (Math.abs(dx) > 0.5) {
          el.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: DURATION, easing: EASING });
        }
      } else {
        // New: fade and slide in from the right (to its own resting opacity).
        el.animate([{ opacity: 0, transform: 'translateX(16px) scale(0.8)' }], { duration: DURATION, easing: EASING });
      }
    }
  }

  private items(snapshot: QueueSnapshot): Item[] {
    const items: Item[] = [];
    if (snapshot.items.length) items.push({ key: 'pop', kind: 'pop' });
    snapshot.items.forEach((id, i) => items.push({ key: `v${id}`, kind: i === 0 ? 'front' : 'queued', id }));
    for (const id of snapshot.incoming) items.push({ key: `v${id}`, kind: 'incoming', id });
    if (snapshot.incoming.length) items.push({ key: 'push', kind: 'push' });
    return items;
  }

  /** Current (non-leaving) elements by key. */
  private liveElements(): Map<string, HTMLElement> {
    const map = new Map<string, HTMLElement>();
    for (const el of this.strip.querySelectorAll<HTMLElement>(':scope > [data-key]:not(.exiting)')) {
      map.set(el.dataset.key!, el);
    }
    return map;
  }

  private create(item: Item): HTMLElement {
    const el = document.createElement(item.kind === 'pop' || item.kind === 'push' ? 'span' : 'div');
    el.dataset.key = item.key;
    if (item.kind === 'pop' || item.kind === 'push') {
      el.className = `q-arrow q-${item.kind}`;
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = `${ARROW_LEFT}<span>${item.kind}</span>`;
    } else {
      el.className = 'q-node';
      el.setAttribute('role', 'listitem');
      // The id and the algorithm's label overlap; CSS crossfades between them.
      const index = document.createElement('span');
      index.className = 'q-index';
      index.textContent = String(item.id);
      const label = document.createElement('span');
      label.className = 'q-label';
      el.append(index, label);
    }
    return el;
  }

  private apply(el: HTMLElement, item: Item): void {
    if (item.id === undefined) return;
    el.classList.toggle('front', item.kind === 'front');
    el.classList.toggle('incoming', item.kind === 'incoming');
    const label = this.labels?.[item.id];
    el.querySelector('.q-label')!.textContent = label ?? '';
    const role = item.kind === 'front' ? ', next to be popped' : item.kind === 'incoming' ? ', about to be pushed' : '';
    const distance = label !== undefined ? `, distance ${label}` : '';
    el.setAttribute('aria-label', `${item.id}${distance}${role}`);
  }
}

function canAnimate(): boolean {
  return typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
