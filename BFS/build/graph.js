import { DirectedView, UndirectedView, } from './graph-views.js';
/**
 * Weighted graph. Edges are always *stored* as weighted directed arcs (from → to, weight;
 * the weight defaults to 0), in an out-adjacency map plus an in-adjacency set for fast
 * removal.
 *
 * Reading: the arcs can be interpreted as directed or undirected, and as weighted or
 * unweighted (every edge weight 1). All four interpretations are always available as
 * pure, read-only views (see graph-views.ts):
 *
 *   graph.view('directed' | 'undirected', 'weighted' | 'unweighted')
 *   graph.directedView / graph.undirectedView   the two unweighted views (shortcuts)
 *   graph.currentView                           the one selected by `directed` and
 *                                               `weighted` (the UI's modes)
 *
 * The convenience readers on Graph itself (`neighbors`, `hasEdge`, `getEdges`,
 * `edgeCount`, `adjacencyList`, `adjacencyMatrix`) delegate to `currentView`.
 *
 * Writing: `addEdge` / `removeEdge` / `setWeight` follow `directed` (see their docs).
 * Node positions live here too so the editor can render them.
 */
export class Graph {
    /** Directed or undirected reading for the mode-dependent methods. Never changes stored arcs. */
    directed = false;
    /** Weighted or unweighted reading for `currentView`. Never changes stored weights. */
    weighted = false;
    nodes = new Map();
    /** from → (to → weight) */
    out = new Map();
    /** to → sources */
    in = new Map();
    /** Read-only access to the stored arcs, shared by the views. */
    reader = {
        nodeIds: () => [...this.nodes.keys()].sort((a, b) => a - b),
        out: (id) => this.out.get(id),
        in: (id) => this.in.get(id),
    };
    views = {
        directed: {
            unweighted: new DirectedView(this.reader, 'unweighted'),
            weighted: new DirectedView(this.reader, 'weighted'),
        },
        undirected: {
            unweighted: new UndirectedView(this.reader, 'unweighted'),
            weighted: new UndirectedView(this.reader, 'weighted'),
        },
    };
    view(orientation, weighting = 'unweighted') {
        return this.views[orientation][weighting];
    }
    /** The arcs read as an unweighted directed graph. */
    get directedView() {
        return this.views.directed.unweighted;
    }
    /** The arcs read as an unweighted undirected graph. */
    get undirectedView() {
        return this.views.undirected.unweighted;
    }
    /** The view selected by `directed` and `weighted`. */
    get currentView() {
        return this.view(this.directed ? 'directed' : 'undirected', this.weighted ? 'weighted' : 'unweighted');
    }
    // ------------------------------------------------------------------ nodes
    get nodeCount() {
        return this.nodes.size;
    }
    /** Adds a node using the smallest unused id, so labels stay compact. */
    addNode(x, y) {
        let id = 0;
        while (this.nodes.has(id))
            id++;
        const node = { id, x, y };
        this.nodes.set(id, node);
        this.out.set(id, new Map());
        this.in.set(id, new Set());
        return node;
    }
    /** Removes a node and every arc into or out of it. */
    removeNode(id) {
        if (!this.nodes.has(id))
            return false;
        for (const to of this.out.get(id).keys())
            this.in.get(to).delete(id);
        for (const from of this.in.get(id))
            this.out.get(from).delete(id);
        this.out.delete(id);
        this.in.delete(id);
        this.nodes.delete(id);
        return true;
    }
    moveNode(id, x, y) {
        const node = this.nodes.get(id);
        if (node) {
            node.x = x;
            node.y = y;
        }
    }
    getNode(id) {
        return this.nodes.get(id);
    }
    /** Nodes sorted by id. */
    getNodes() {
        return [...this.nodes.values()].sort((a, b) => a.id - b.id);
    }
    // ------------------------------------------------------------ stored arcs
    /** True if the arc from → to is stored (ignores `directed`). */
    hasArc(from, to) {
        return this.directedView.hasEdge(from, to);
    }
    /** Stored weight of the arc from → to, or undefined if there is no such arc. */
    arcWeight(from, to) {
        return this.out.get(from)?.get(to);
    }
    /** Every stored arc as [from, to], sorted (ignores `directed`). */
    getArcs() {
        return this.directedView.edges();
    }
    /**
     * Adds an edge from a to b, always stored as the arc a → b with the given weight
     * (default 0). Returns false for self-loops, unknown nodes, non-finite weights, or an
     * edge that already exists in the current view (undirected: a and b adjacent either way).
     */
    addEdge(a, b, weight = 0) {
        if (a === b || !this.nodes.has(a) || !this.nodes.has(b) || !Number.isFinite(weight))
            return false;
        if (this.hasEdge(a, b))
            return false;
        this.out.get(a).set(b, weight);
        this.in.get(b).add(a);
        return true;
    }
    /**
     * Sets the weight of the edge between a and b in the current orientation:
     * directed → the arc a → b; undirected → every stored arc between them (one or both
     * directions), so they agree afterwards. Returns false if there is no such edge.
     */
    setWeight(a, b, weight) {
        if (!Number.isFinite(weight))
            return false;
        let changed = false;
        const arcs = this.directed ? [[a, b]] : [[a, b], [b, a]];
        for (const [from, to] of arcs) {
            const targets = this.out.get(from);
            if (targets?.has(to)) {
                targets.set(to, weight);
                changed = true;
            }
        }
        return changed;
    }
    /**
     * Removes the edge between a and b in the current view:
     * directed → only the arc a → b; undirected → the arcs in both directions.
     */
    removeEdge(a, b) {
        let removed = this.removeArc(a, b);
        if (!this.directed)
            removed = this.removeArc(b, a) || removed;
        return removed;
    }
    removeArc(from, to) {
        if (!this.out.get(from)?.delete(to))
            return false;
        this.in.get(to)?.delete(from);
        return true;
    }
    clear() {
        this.nodes.clear();
        this.out.clear();
        this.in.clear();
    }
    // ------------------------------- readers for the current view (by `directed`)
    /** Number of edges in the current view. */
    get edgeCount() {
        return this.currentView.edgeCount;
    }
    /** Edges in the current view (see GraphView.edges). */
    getEdges() {
        return this.currentView.edges();
    }
    /** Neighbours in the current view, sorted by id (a stable order for BFS). */
    neighbors(id) {
        return this.currentView.neighbors(id);
    }
    /** Is there an edge a → b (directed) / between a and b (undirected) in the current view? */
    hasEdge(a, b) {
        return this.currentView.hasEdge(a, b);
    }
    adjacencyList() {
        return this.currentView.adjacencyList();
    }
    adjacencyMatrix() {
        return this.currentView.adjacencyMatrix();
    }
    /** Connected components ignoring direction (see UndirectedView.connectedComponents). */
    connectedComponents() {
        return this.undirectedView.connectedComponents();
    }
}
//# sourceMappingURL=graph.js.map