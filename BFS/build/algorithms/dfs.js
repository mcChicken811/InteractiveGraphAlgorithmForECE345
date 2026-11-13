/** How each class is tagged on the canvas (tree edges are left plain). */
export const EDGE_CLASS_LABELS = {
    tree: undefined,
    back: 'backward',
    forward: 'forward',
    cross: 'crossed',
};
export class DfsSimulation {
    view;
    start;
    color = new Map();
    /** The recursion stack, bottom first. */
    stack = [];
    /** The outer loop's order: `start`, then every other vertex ascending. */
    roots;
    rootIndex = 0;
    time = 0;
    last = null;
    /** Edge keys already classified (undirected views explore each edge once). */
    seen = new Set();
    /** u.d: when each vertex was discovered. */
    discovery = new Map();
    /** u.f: when each vertex was finished. */
    finish = new Map();
    /** u.π: the depth-first forest (roots → null). */
    parent = new Map();
    /** Every explored edge with its class, in the order explored. */
    edges = [];
    /** Tree roots, in the order they were started. */
    trees = [];
    constructor(view, start) {
        this.view = view;
        this.start = start;
        const ids = view.nodeIds();
        for (const id of ids)
            this.color.set(id, 'white');
        this.roots = ids.includes(start) ? [start, ...ids.filter((id) => id !== start)] : ids;
    }
    get finished() {
        return this.nextAction() === null;
    }
    /** The recursion stack, top first. */
    get stacked() {
        return this.stack.map((f) => f.id).reverse();
    }
    /** The current time (the last d or f handed out). */
    get clock() {
        return this.time;
    }
    colorOf(id) {
        return this.color.get(id);
    }
    step() {
        const action = this.nextAction();
        if (!action)
            return false;
        if (action.type === 'root') {
            this.rootIndex++;
            this.trees.push(action.v);
            this.parent.set(action.v, null);
            this.discover(action.v);
            this.last = { type: 'root', v: action.v };
        }
        else if (action.type === 'edge') {
            const { u, v } = action;
            this.top.next++;
            this.seen.add(this.edgeKey(u, v));
            const kind = this.classify(u, v);
            const edge = { from: u, to: v, kind };
            this.edges.push(edge);
            if (kind === 'tree') {
                this.parent.set(v, u);
                this.discover(v);
            }
            this.last = { type: 'edge', edge };
        }
        else {
            this.stack.pop();
            this.time++;
            this.finish.set(action.u, this.time);
            this.color.set(action.u, 'black');
            this.last = { type: 'finish', u: action.u };
        }
        return true;
    }
    highlight() {
        const action = this.nextAction();
        const labels = {};
        for (const [id, d] of this.discovery)
            labels[id] = `${d},${this.finish.get(id) ?? ''}`;
        return {
            current: action === null ? null : action.type === 'root' ? action.v : action.u,
            done: [...this.finish.keys()],
            running: this.stack.map((f) => f.id),
            activeEdges: action?.type === 'edge' ? [[action.u, action.v]] : [],
            labels,
            exploredEdges: this.edges.map(({ from, to, kind }) => ({ from, to, label: EDGE_CLASS_LABELS[kind] })),
        };
    }
    stackSnapshot() {
        const action = this.nextAction();
        let incoming = [];
        if (action?.type === 'root')
            incoming = [action.v];
        else if (action?.type === 'edge' && this.color.get(action.v) === 'white')
            incoming = [action.v];
        return { items: this.stacked, incoming, popping: action?.type === 'finish' };
    }
    describe() {
        const stack = `Stack: ${this.stack.length ? `${this.stacked.join(', ')} (top first)` : 'empty'}.`;
        const last = this.last;
        if (last === null)
            return `DFS from ${this.start}. Time 0. Press Update to discover ${this.start}.`;
        if (this.finished) {
            const count = (kind) => this.edges.filter((e) => e.kind === kind).length;
            const n = this.discovery.size;
            const trees = this.trees.length;
            return (`DFS finished at time ${this.time}: ${n} ${n === 1 ? 'vertex' : 'vertices'} in ` +
                `${trees} ${trees === 1 ? 'tree' : 'trees'}; ${count('tree')} tree, ${count('back')} backward, ` +
                `${count('forward')} forward, ${count('cross')} crossed edges. Press Finish.`);
        }
        switch (last.type) {
            case 'root': {
                const first = this.trees.length === 1;
                return `${first ? 'Discovered' : 'New tree: discovered'} ${last.v} at time ${this.discovery.get(last.v)}. ${stack}`;
            }
            case 'finish':
                return `Finished ${last.u} at time ${this.finish.get(last.u)}. ${stack}`;
            case 'edge': {
                const { from: u, to: v, kind } = last.edge;
                const edge = `${u} ${this.view.directed ? '→' : '—'} ${v}`;
                const why = {
                    tree: `discovered ${v} at time ${this.discovery.get(v)}`,
                    back: `${v} is still running (an ancestor of ${u})`,
                    forward: `${v} already finished, a descendant of ${u}`,
                    cross: `${v} already finished, not a descendant of ${u}`,
                }[kind];
                const name = kind === 'tree' ? 'tree' : EDGE_CLASS_LABELS[kind];
                return `${edge} is a ${name} edge: ${why}. ${stack}`;
            }
        }
    }
    get top() {
        return this.stack[this.stack.length - 1];
    }
    /** DFS-VISIT's first lines: time stamp, colour gray, push. */
    discover(v) {
        this.time++;
        this.discovery.set(v, this.time);
        this.color.set(v, 'gray');
        this.stack.push({ id: v, adj: this.view.neighbors(v), next: 0 });
    }
    classify(u, v) {
        const c = this.color.get(v);
        if (c === 'white')
            return 'tree';
        if (c === 'gray')
            return 'back';
        return this.discovery.get(u) < this.discovery.get(v) ? 'forward' : 'cross';
    }
    edgeKey(u, v) {
        return this.view.directed ? `${u}>${v}` : `${Math.min(u, v)}-${Math.max(u, v)}`;
    }
    /**
     * What the next step will do, or null when the search is over. Skips (without
     * counting a step) edges an undirected search has already explored from the other end,
     * and outer-loop vertices that are no longer white.
     */
    nextAction() {
        const top = this.top;
        if (top) {
            while (top.next < top.adj.length && this.seen.has(this.edgeKey(top.id, top.adj[top.next])))
                top.next++;
            if (top.next < top.adj.length)
                return { type: 'edge', u: top.id, v: top.adj[top.next] };
            return { type: 'finish', u: top.id };
        }
        while (this.rootIndex < this.roots.length && this.color.get(this.roots[this.rootIndex]) !== 'white')
            this.rootIndex++;
        return this.rootIndex < this.roots.length ? { type: 'root', v: this.roots[this.rootIndex] } : null;
    }
}
export const dfs = {
    id: 'dfs',
    name: 'Depth-first search',
    // Edge classes (tree / back / forward / cross) are defined for directed graphs, and DFS
    // ignores weights.
    requires: { weighted: false, directed: true },
    create: (view, start) => new DfsSimulation(view, start),
};
//# sourceMappingURL=dfs.js.map