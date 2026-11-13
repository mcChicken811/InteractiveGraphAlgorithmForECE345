/**
 * Unweighted graph. Edges are always *stored* as directed arcs (from → to), in an
 * out-adjacency list plus an in-adjacency list for fast removal. The `directed` flag
 * only chooses how that data is *interpreted*:
 *
 *  - directed:   every arc is its own edge (u → v and v → u are two edges).
 *  - undirected: u and v are adjacent if there is an arc either way, so u → v,
 *                v → u, or both all count as the single edge {u, v}.
 *
 * Node positions live here too so the editor can render them.
 */
export class Graph {
    /** How edges are interpreted. Switching it never changes the stored arcs. */
    directed = false;
    nodes = new Map();
    out = new Map();
    in = new Map();
    get nodeCount() {
        return this.nodes.size;
    }
    /** Number of edges under the current interpretation. */
    get edgeCount() {
        return this.getEdges().length;
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
    /** True if the arc from → to is stored (ignores the interpretation). */
    hasArc(from, to) {
        return this.out.get(from)?.has(to) ?? false;
    }
    /** Every stored arc as [from, to], sorted. */
    getArcs() {
        const arcs = [];
        for (const [from, set] of this.out)
            for (const to of set)
                arcs.push([from, to]);
        return arcs.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    }
    /** Neighbours ignoring direction (arcs either way), sorted. Used by the layout. */
    undirectedNeighbors(id) {
        const set = new Set([...(this.out.get(id) ?? []), ...(this.in.get(id) ?? [])]);
        return [...set].sort((a, b) => a - b);
    }
    // ------------------------------------------- edges, per the interpretation
    /**
     * Edges under the current interpretation, sorted:
     * directed → each arc as [from, to]; undirected → each adjacent pair once as [min, max].
     */
    getEdges() {
        if (this.directed)
            return this.getArcs();
        const edges = [];
        for (const { id: a } of this.getNodes()) {
            for (const b of this.undirectedNeighbors(a))
                if (a < b)
                    edges.push([a, b]);
        }
        return edges;
    }
    /**
     * Neighbours of a node, sorted by id (a stable order for BFS):
     * directed → out-neighbours (nodes its arcs point to); undirected → arcs either way.
     */
    neighbors(id) {
        if (this.directed)
            return [...(this.out.get(id) ?? [])].sort((a, b) => a - b);
        return this.undirectedNeighbors(id);
    }
    /** Directed: is there an arc a → b? Undirected: is there an arc either way? */
    hasEdge(a, b) {
        return this.directed ? this.hasArc(a, b) : this.hasArc(a, b) || this.hasArc(b, a);
    }
    /**
     * Adds an edge from a to b, always stored as the arc a → b.
     * Returns false for self-loops, unknown nodes, or an edge that already exists under
     * the current interpretation (undirected: a and b already adjacent either way).
     */
    addEdge(a, b) {
        if (a === b || !this.nodes.has(a) || !this.nodes.has(b) || this.hasEdge(a, b))
            return false;
        this.out.get(a).add(b);
        this.in.get(b).add(a);
        return true;
    }
    /**
     * Removes the edge between a and b under the current interpretation:
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
    // -------------------------------------------------------- representations
    /** Adjacency-list representation: every node (by id) with its sorted neighbours. */
    adjacencyList() {
        return this.getNodes().map(({ id }) => ({ id, neighbors: this.neighbors(id) }));
    }
    /**
     * Adjacency-matrix representation. `ids` (ascending) label the rows and columns;
     * `matrix[i][j]` is 1 when there is an edge from ids[i] to ids[j]. Undirected, the
     * matrix is symmetric; directed, row i lists the arcs leaving ids[i]. The diagonal is
     * 0 because self-loops are not allowed.
     */
    adjacencyMatrix() {
        const ids = this.getNodes().map((n) => n.id);
        const matrix = ids.map((a) => ids.map((b) => (this.hasEdge(a, b) ? 1 : 0)));
        return { ids, matrix };
    }
    /**
     * Connected components, found by breadth-first search with edge directions ignored
     * (for a directed graph these are its *weakly* connected components).
     * Ordered largest first (ties: smallest node id first); each component lists its
     * node ids in BFS order from its smallest id.
     */
    connectedComponents() {
        const seen = new Set();
        const components = [];
        for (const { id: start } of this.getNodes()) {
            if (seen.has(start))
                continue;
            const component = [];
            const queue = [start];
            seen.add(start);
            for (let head = 0; head < queue.length; head++) {
                const v = queue[head];
                component.push(v);
                for (const w of this.undirectedNeighbors(v)) {
                    if (!seen.has(w)) {
                        seen.add(w);
                        queue.push(w);
                    }
                }
            }
            components.push(component);
        }
        // Stable sort: equal sizes keep discovery order, i.e. by smallest id.
        return components.sort((a, b) => b.length - a.length);
    }
    clear() {
        this.nodes.clear();
        this.out.clear();
        this.in.clear();
    }
}
//# sourceMappingURL=graph.js.map