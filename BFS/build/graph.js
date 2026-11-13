import { DirectedView, UndirectedView, } from './graph-views.js';
/**
 * Unweighted graph. Edges are always *stored* as directed arcs (from → to), in an
 * out-adjacency list plus an in-adjacency list for fast removal.
 *
 * Reading: the arcs can be interpreted as a directed or an undirected graph. Both
 * interpretations are always available as pure, read-only views (see graph-views.ts):
 *
 *   graph.directedView     every arc is its own edge
 *   graph.undirectedView   an arc either way (or both) is one edge
 *   graph.view(o)          either of the above, by name
 *   graph.currentView      the one selected by `graph.directed` (the UI's mode)
 *
 * The convenience readers on Graph itself (`neighbors`, `hasEdge`, `getEdges`,
 * `edgeCount`, `adjacencyList`, `adjacencyMatrix`) delegate to `currentView`.
 *
 * Writing: `addEdge` / `removeEdge` also follow `directed` (see their docs). Node
 * positions live here too so the editor can render them.
 */
export class Graph {
    /** Which view the mode-dependent methods use. Switching it never changes the stored arcs. */
    directed = false;
    nodes = new Map();
    out = new Map();
    in = new Map();
    /** Read-only access to the stored arcs, shared by the views. */
    reader = {
        nodeIds: () => [...this.nodes.keys()].sort((a, b) => a - b),
        out: (id) => this.out.get(id),
        in: (id) => this.in.get(id),
    };
    /** The arcs read as a directed graph. */
    directedView = new DirectedView(this.reader);
    /** The arcs read as an undirected graph. */
    undirectedView = new UndirectedView(this.reader);
    view(orientation) {
        return orientation === 'directed' ? this.directedView : this.undirectedView;
    }
    /** The view selected by `directed`. */
    get currentView() {
        return this.directed ? this.directedView : this.undirectedView;
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
        this.out.set(id, new Set());
        this.in.set(id, new Set());
        return node;
    }
    /** Removes a node and every arc into or out of it. */
    removeNode(id) {
        if (!this.nodes.has(id))
            return false;
        for (const to of this.out.get(id))
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
    /** Every stored arc as [from, to], sorted (ignores `directed`). */
    getArcs() {
        return this.directedView.edges();
    }
    /**
     * Adds an edge from a to b, always stored as the arc a → b.
     * Returns false for self-loops, unknown nodes, or an edge that already exists in the
     * current view (undirected: a and b already adjacent either way).
     */
    addEdge(a, b) {
        if (a === b || !this.nodes.has(a) || !this.nodes.has(b) || this.hasEdge(a, b))
            return false;
        this.out.get(a).add(b);
        this.in.get(b).add(a);
        return true;
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