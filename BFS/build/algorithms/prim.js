export class PrimSimulation {
    view;
    root;
    /** The min-priority queue's contents (membership; order comes from the keys). */
    inQueue;
    last = null;
    /** v.key: the lightest edge found so far joining v to the tree (Infinity for ∞). */
    key = new Map();
    /** v.π: the tree-side end of that edge (null for NIL). */
    parent = new Map();
    /** Vertices in the order they were extracted (added to the tree). */
    order = [];
    /** The tree's edges (u.π, u), in the order they were added. */
    treeEdges = [];
    /** The root of each tree: `root`, then one more for every further connected component. */
    roots = [];
    constructor(view, root) {
        this.view = view;
        this.root = root;
        const ids = view.nodeIds();
        for (const id of ids) {
            this.key.set(id, Infinity);
            this.parent.set(id, null);
        }
        if (this.key.has(root))
            this.key.set(root, 0);
        this.inQueue = new Set(ids);
    }
    /** True once the queue is empty: every vertex is in the tree (or forest). */
    get finished() {
        return this.inQueue.size === 0;
    }
    /** The queue in extraction order: smallest key first, ties by lowest id. */
    get queued() {
        return [...this.inQueue].sort((a, b) => {
            const [ka, kb] = [this.key.get(a), this.key.get(b)];
            return ka === kb ? a - b : ka < kb ? -1 : 1; // (∞ − ∞ is NaN, so compare, don't subtract)
        });
    }
    /**
     * The edges crossing the cut (S, V − S): one end in the tree, the other still in the
     * queue, as [tree end, queue end], in extraction order of the tree end, then by id.
     */
    crossingEdges() {
        const crossing = [];
        for (const u of this.order) {
            for (const v of this.view.neighbors(u))
                if (this.inQueue.has(v))
                    crossing.push([u, v]);
        }
        return crossing;
    }
    /** Sum of the tree edges' weights so far. */
    get totalWeight() {
        return this.treeEdges.reduce((sum, e) => sum + e.weight, 0);
    }
    step() {
        const u = this.queued[0];
        if (u === undefined)
            return false;
        // EXTRACT-MIN: u joins the tree, by the edge (u.π, u) unless it is a root.
        this.inQueue.delete(u);
        this.order.push(u);
        const via = this.parent.get(u);
        if (via === null)
            this.roots.push(u);
        else
            this.treeEdges.push({ from: via, to: u, weight: this.key.get(u) });
        // Update the keys of u's neighbours that are not in the tree yet.
        const lowered = [];
        for (const v of this.view.neighbors(u)) {
            const w = this.view.weight(u, v);
            if (this.inQueue.has(v) && w < this.key.get(v)) {
                this.parent.set(v, u);
                this.key.set(v, w); // DECREASE-KEY
                lowered.push([v, w]);
            }
        }
        this.last = { u, via, lowered };
        return true;
    }
    highlight() {
        const queue = this.queued;
        const next = queue[0] ?? null;
        const via = next === null ? null : this.parent.get(next);
        return {
            current: next,
            done: [...this.order],
            // In the queue and touching the tree: a finite key.
            running: queue.filter((v) => Number.isFinite(this.key.get(v))),
            activeEdges: next !== null && via !== null ? [[via, next]] : [],
            labels: Object.fromEntries([...this.key].map(([id, k]) => [id, formatKey(k)])),
            exploredEdges: [
                ...this.treeEdges.map(({ from, to }) => ({ from, to, done: true })),
                ...this.crossingEdges().map(([from, to]) => ({ from, to, crossing: true })),
            ],
        };
    }
    priorityQueueSnapshot() {
        const items = this.queued;
        return { items, incoming: [], running: items.filter((v) => Number.isFinite(this.key.get(v))) };
    }
    describe() {
        const last = this.last;
        if (last === null) {
            return `Prim from ${this.root}. Every key is ∞ except ${this.root}'s, which is 0. Press Update to add ${this.root} to the tree.`;
        }
        if (this.finished) {
            const edges = this.treeEdges.length;
            const unit = this.view.weighted ? '' : ' (every edge counts as 1)';
            const size = `${edges} ${edges === 1 ? 'edge' : 'edges'}, total weight ${this.totalWeight}${unit}`;
            return this.roots.length <= 1
                ? `Prim finished: a minimum spanning tree of ${size}. Press Finish.`
                : `Prim finished: the graph is not connected, so this is a minimum spanning forest of ${this.roots.length} trees, ${size}. Press Finish.`;
        }
        const { u, via, lowered } = last;
        let added;
        if (via !== null)
            added = `Added ${u} by edge ${via} — ${u} (weight ${this.key.get(u)}).`;
        else if (this.roots.length === 1)
            added = `Added ${u} as the root of the tree.`;
        else
            added = `${u} has key ∞: no edge joins it to the tree, so it starts a new tree.`;
        const keys = lowered.length
            ? `Lowered keys: ${lowered.map(([v, k]) => `${v} to ${k}`).join(', ')}.`
            : 'No key changed.';
        return `${added} ${keys} ${this.describeCut()} Tree weight ${this.totalWeight}.`;
    }
    /** The cut after this step: how many edges cross it, and the light edge (white) among them. */
    describeCut() {
        const crossing = this.crossingEdges().length;
        const next = this.queued[0];
        const via = this.parent.get(next);
        if (crossing === 0 || via === null)
            return `No edge crosses the cut, so ${next} will start a new tree.`;
        const count = crossing === 1 ? '1 edge crosses' : `${crossing} edges cross`;
        return `${count} the cut; the light edge is ${via} — ${next} (weight ${this.key.get(next)}).`;
    }
}
function formatKey(key) {
    return Number.isFinite(key) ? String(key) : '∞';
}
export const prim = {
    id: 'prim',
    name: "Prim's algorithm",
    // A minimum spanning tree is defined for undirected graphs (CLRS ch. 21). Either
    // weighting works: unweighted views give every edge weight 1.
    requires: { directed: false },
    usesWeights: true,
    create: (view, start) => new PrimSimulation(view, start),
};
//# sourceMappingURL=prim.js.map