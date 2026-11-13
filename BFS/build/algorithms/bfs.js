/**
 * Breadth-first search from a single source, one queue pop per step.
 *
 * The display always shows what the *next* step will do:
 *  - white: the vertex at the front of the queue (popped next step), and the edges that
 *    step will travel — from it to its not-yet-discovered neighbours;
 *  - green: vertices already popped (finished).
 *
 * Each step pops the front vertex (it turns green), then discovers its undiscovered
 * neighbours and appends them to the queue in ascending id order (views return sorted
 * neighbours, so runs are deterministic). The new front vertex turns white.
 *
 * Right after creation the source is the only vertex in the queue, so it is already
 * white. A source with n reachable vertices finishes after exactly n steps; vertices not
 * reachable from it are never discovered.
 */
export class BfsSimulation {
    view;
    source;
    queue;
    /** Vertices that have been put in the queue (including those already popped). */
    discovered;
    /** Vertices that have been popped. */
    popped = new Set();
    lastPopped = null;
    lastDiscovered = [];
    /** Pop order so far. */
    order = [];
    /** BFS tree: discovered vertex → the vertex it was discovered from (source → null). */
    parent = new Map();
    /** Edges (number of hops) from the source to each discovered vertex. */
    distance = new Map();
    constructor(view, source) {
        this.view = view;
        this.source = source;
        this.queue = [source];
        this.discovered = new Set([source]);
        this.parent.set(source, null);
        this.distance.set(source, 0);
    }
    /** True once the queue is empty: every reachable vertex has been popped. */
    get finished() {
        return this.queue.length === 0;
    }
    /** The vertices in the queue, front (next to be popped) first. */
    get queued() {
        return [...this.queue];
    }
    step() {
        const v = this.queue.shift();
        if (v === undefined)
            return false;
        this.popped.add(v);
        this.order.push(v);
        this.lastPopped = v;
        this.lastDiscovered = [];
        for (const w of this.view.neighbors(v)) {
            if (this.discovered.has(w))
                continue;
            this.discovered.add(w);
            this.parent.set(w, v);
            this.distance.set(w, this.distance.get(v) + 1);
            this.queue.push(w);
            this.lastDiscovered.push(w);
        }
        return true;
    }
    /** Undiscovered neighbours of the front vertex: what the next step will push, in order. */
    incoming() {
        const next = this.queue[0];
        return next === undefined ? [] : this.view.neighbors(next).filter((w) => !this.discovered.has(w));
    }
    highlight() {
        const next = this.queue[0] ?? null;
        return {
            current: next,
            done: [...this.popped],
            activeEdges: next === null ? [] : this.incoming().map((w) => [next, w]),
        };
    }
    queueSnapshot() {
        return { items: [...this.queue], incoming: this.incoming() };
    }
    describe() {
        const queue = `Queue: ${this.queue.length ? this.queue.join(', ') : 'empty'}.`;
        if (this.lastPopped === null)
            return `BFS from ${this.source}. ${queue} Press Update to pop ${this.source}.`;
        if (this.finished) {
            const total = this.view.nodeIds().length;
            const reached = this.order.length;
            const unreachable = total - reached;
            return (`BFS finished: visited ${reached} of ${total} vertices (order ${this.order.join(', ')}).` +
                (unreachable ? ` ${unreachable} not reachable from ${this.source}.` : '') +
                ' Press Finish.');
        }
        const found = this.lastDiscovered.length ? `discovered ${this.lastDiscovered.join(', ')}` : 'nothing new';
        return `Popped ${this.lastPopped}: ${found}. ${queue}`;
    }
}
export const bfs = {
    id: 'bfs',
    name: 'Breadth-first search',
    // BFS ignores weights (every edge counts as one hop), so it runs on the unweighted view.
    requires: { weighted: false },
    create: (view, start) => new BfsSimulation(view, start),
};
//# sourceMappingURL=bfs.js.map