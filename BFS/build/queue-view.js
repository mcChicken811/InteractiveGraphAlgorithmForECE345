import { fitFontSize } from './label-fit.js';
/**
 * Draws an algorithm's queue (BFS), min-priority queue (Prim) or recursion stack (DFS) as
 * a horizontal strip in the side panel:
 *
 *   queue:  ← pop  (front) (…) (back)  (incoming…)  ← push
 *   priority queue:  ← min  (smallest key) (…) (largest key)
 *   stack:  ← pop   (incoming) (top) (…) (bottom)
 *           → push
 *
 * Vertices are drawn like the canvas nodes (ringed circle with the id), smaller. The
 * vertex the next step works on — the queue's front, the stack's top — has the canvas's
 * white "current" ring; the vertices the next step will push are greyed out where they
 * will land. A stack's other vertices are still running, so they have the canvas's
 * yellow ring; its two arrows share the open (left) end, and the one the next step uses
 * is highlighted. A priority queue is drawn in extraction order, so vertices glide to
 * their new places when their keys change.
 *
 * `update()` animates the change from the previous snapshot (FLIP): the popped vertex
 * turns green and slides out to the left, the rest glide into their new places,
 * incoming vertices fill in as they join the queue, and new incoming ones fade in. With
 * `prefers-reduced-motion`, or `animate = false`, it updates instantly. The strip
 * scrolls horizontally when it overflows.
 */
const DURATION = 340;
const EASING = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
const ARROW_LEFT = '<svg viewBox="0 0 24 14" width="24" height="14" aria-hidden="true"><path d="M22 7H3M8 2L3 7l5 5" /></svg>';
const ARROW_RIGHT = '<svg viewBox="0 0 24 14" width="24" height="14" aria-hidden="true"><path d="M2 7h19M16 2l5 5-5 5" /></svg>';
/** Width (px) a label may use inside a strip vertex, and its largest font size. */
const LABEL_WIDTH = 22;
const LABEL_FONT = 12;
export class QueueView {
    strip;
    emptyNote;
    /**
     * Called with `true` while the pointer is over (or keyboard focus is in) the strip, and
     * `false` when it leaves: vertex labels then switch back to ids, here and on the canvas.
     */
    onPeek = null;
    labels;
    options;
    /** Stack only: whether the next step pops the top / pushes something (lights its arrow). */
    popping = false;
    pushing = false;
    constructor(strip, emptyNote, options = {}) {
        this.strip = strip;
        this.emptyNote = emptyNote;
        const kind = options.kind ?? 'queue';
        const describeLabel = (label) => (kind === 'priority' ? `key ${label}` : `distance ${label}`);
        this.options = { kind, describeLabel, peekIds: kind !== 'priority', ...options };
        strip.classList.add(`strip-${this.options.kind}`);
        const peek = (on) => {
            strip.classList.toggle('peek-ids', on && this.options.peekIds);
            this.onPeek?.(on);
        };
        strip.addEventListener('pointerenter', () => peek(true));
        strip.addEventListener('pointerleave', () => peek(strip.contains(document.activeElement)));
        strip.addEventListener('focusin', () => peek(true));
        strip.addEventListener('focusout', () => peek(strip.matches(':hover')));
    }
    /**
     * Shows `snapshot` (or nothing, for null), animating from the previous one if asked.
     * `labels` (e.g. BFS distances, DFS times) are drawn inside the vertices instead of
     * their ids; vertices without a label are left blank. Hovering the strip shows the ids.
     */
    update(snapshot, animate, labels) {
        this.labels = labels;
        this.popping = !!snapshot && 'popping' in snapshot && snapshot.popping;
        this.pushing = !!snapshot && snapshot.incoming.length > 0;
        this.strip.classList.toggle('has-labels', !!labels);
        const motion = animate && canAnimate() && !prefersReducedMotion();
        const live = this.liveElements();
        // FLIP, step 1 ("First"): where every item is drawn right now.
        const before = new Map();
        for (const [key, el] of live)
            before.set(key, el.getBoundingClientRect());
        const items = snapshot ? this.items(snapshot) : [];
        const wanted = new Set(items.map((i) => i.key));
        // Items that leave (the popped vertex, an arrow that is no longer needed).
        for (const [key, el] of live) {
            if (wanted.has(key))
                continue;
            if (!motion) {
                el.remove();
                continue;
            }
            // Freeze it where it is, out of the flow, and let it slide away.
            const left = el.offsetLeft;
            const top = el.offsetTop;
            el.classList.add('exiting');
            if (el.classList.contains('front'))
                el.classList.add('popped'); // green, like the canvas
            el.removeAttribute('role');
            el.setAttribute('aria-hidden', 'true');
            Object.assign(el.style, { position: 'absolute', left: `${left}px`, top: `${top}px`, margin: '0' });
            el.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateX(-32px)', opacity: 0 }], {
                duration: DURATION,
                easing: EASING,
                fill: 'forwards',
            }).finished.then(() => el.remove(), () => el.remove());
        }
        // Build the new order, reusing elements by key so they can be animated.
        const ordered = items.map((item) => {
            const el = live.get(item.key) ?? this.create(item);
            this.apply(el, item);
            return el;
        });
        for (const el of ordered)
            this.strip.append(el); // moves existing ones into place
        const empty = !!snapshot && items.length === 0;
        this.emptyNote.hidden = !empty;
        this.strip.hidden = !snapshot || empty;
        if (!motion)
            return;
        // FLIP, steps 2–4 ("Last, Invert, Play"): animate each item from where it was.
        for (const el of ordered) {
            const key = el.dataset.key;
            const was = before.get(key);
            for (const running of el.getAnimations())
                running.cancel();
            if (was) {
                const now = el.getBoundingClientRect();
                const dx = was.left - now.left;
                if (Math.abs(dx) > 0.5) {
                    el.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: DURATION, easing: EASING });
                }
            }
            else {
                // New: fade and slide in from the end it joins at — a queue's back (right), a
                // stack's top (left) — to its own resting opacity.
                const from = this.options.kind === 'stack' ? -16 : 16;
                el.animate([{ opacity: 0, transform: `translateX(${from}px) scale(0.8)` }], { duration: DURATION, easing: EASING });
            }
        }
    }
    items(snapshot) {
        const items = [];
        if (this.options.kind === 'stack') {
            // Pushed vertices land on top: the last one pushed ends up leftmost.
            if (snapshot.items.length || snapshot.incoming.length)
                items.push({ key: 'ends', kind: 'ends' });
            for (const id of [...snapshot.incoming].reverse())
                items.push({ key: `v${id}`, kind: 'incoming', id });
            snapshot.items.forEach((id, i) => items.push({ key: `v${id}`, kind: i === 0 ? 'front' : 'queued', id }));
            return items;
        }
        if (snapshot.items.length)
            items.push({ key: 'pop', kind: 'pop' });
        snapshot.items.forEach((id, i) => items.push({ key: `v${id}`, kind: i === 0 ? 'front' : 'queued', id }));
        for (const id of snapshot.incoming)
            items.push({ key: `v${id}`, kind: 'incoming', id });
        if (snapshot.incoming.length)
            items.push({ key: 'push', kind: 'push' });
        return items;
    }
    /** Current (non-leaving) elements by key. */
    liveElements() {
        const map = new Map();
        for (const el of this.strip.querySelectorAll(':scope > [data-key]:not(.exiting)')) {
            map.set(el.dataset.key, el);
        }
        return map;
    }
    create(item) {
        const el = document.createElement(item.id === undefined ? 'span' : 'div');
        el.dataset.key = item.key;
        if (item.kind === 'ends') {
            // A stack's open end: both arrows, on the left.
            el.className = 'q-ends';
            el.setAttribute('aria-hidden', 'true');
            el.innerHTML =
                `<span class="q-arrow q-pop">${ARROW_LEFT}<span>pop</span></span>` +
                    `<span class="q-arrow q-push">${ARROW_RIGHT}<span>push</span></span>`;
        }
        else if (item.kind === 'pop' || item.kind === 'push') {
            el.className = `q-arrow q-${item.kind}`;
            el.setAttribute('aria-hidden', 'true');
            // A priority queue gives up its minimum, rather than "popping" its oldest.
            const text = item.kind === 'pop' && this.options.kind === 'priority' ? 'min' : item.kind;
            el.innerHTML = `${ARROW_LEFT}<span>${text}</span>`;
        }
        else {
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
    apply(el, item) {
        const stack = this.options.kind === 'stack';
        if (item.kind === 'ends') {
            el.querySelector('.q-pop').classList.toggle('active', this.popping);
            el.querySelector('.q-push').classList.toggle('active', this.pushing);
            return;
        }
        if (item.id === undefined)
            return;
        el.classList.toggle('front', item.kind === 'front');
        el.classList.toggle('incoming', item.kind === 'incoming');
        // A stack's vertices below the top are still running (DFS: gray).
        el.classList.toggle('running', stack && item.kind === 'queued');
        const label = this.labels?.[item.id];
        const labelEl = el.querySelector('.q-label');
        labelEl.textContent = label ?? '';
        const size = fitFontSize(label ?? '', LABEL_WIDTH, LABEL_FONT);
        labelEl.style.fontSize = size < LABEL_FONT ? `${size}px` : '';
        let role = '';
        if (item.kind === 'incoming')
            role = ', about to be pushed';
        else if (item.kind === 'front') {
            if (stack)
                role = this.popping ? ', top, next to be popped' : ', top';
            else
                role = this.options.kind === 'priority' ? ', smallest key, next to be extracted' : ', next to be popped';
        }
        const described = label !== undefined ? `, ${this.options.describeLabel(label)}` : '';
        el.setAttribute('aria-label', `${item.id}${described}${role}`);
    }
}
function canAnimate() {
    return typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
}
function prefersReducedMotion() {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
//# sourceMappingURL=queue-view.js.map