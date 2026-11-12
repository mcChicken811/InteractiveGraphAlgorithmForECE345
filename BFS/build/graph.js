/**
 * Undirected, unweighted graph stored as an adjacency list.
 * Node positions live here too so the editor can render them.
 */
export class Graph {
    nodes = new Map();
    adjacency = new Map();
    get nodeCount() {
        return this.nodes.size;
    }
    get edgeCount() {
        let total = 0;
        for (const set of this.adjacency.values())
            total += set.size;
        return total / 2;
    }
    /** Adds a node using the smallest unused id, so labels stay compact. */
    addNode(x, y) {
        let id = 0;
        while (this.nodes.has(id))
            id++;
        const node = { id, x, y };
        this.nodes.set(id, node);
        this.adjacency.set(id, new Set());
        return node;
    }
    removeNode(id) {
        const neighbors = this.adjacency.get(id);
        if (!neighbors)
            return false;
        for (const other of neighbors)
            this.adjacency.get(other)?.delete(id);
        this.adjacency.delete(id);
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
    /** Each undirected edge once, as [smaller id, larger id]. */
    getEdges() {
        const edges = [];
        for (const [a, set] of this.adjacency) {
            for (const b of set)
                if (a < b)
                    edges.push([a, b]);
        }
        return edges.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    }
    /** Neighbors of a node, sorted by id (a stable order for BFS later). */
    neighbors(id) {
        return [...(this.adjacency.get(id) ?? [])].sort((a, b) => a - b);
    }
    hasEdge(a, b) {
        return this.adjacency.get(a)?.has(b) ?? false;
    }
    /** Returns false for self-loops, unknown nodes, or duplicate edges. */
    addEdge(a, b) {
        if (a === b)
            return false;
        const setA = this.adjacency.get(a);
        const setB = this.adjacency.get(b);
        if (!setA || !setB || setA.has(b))
            return false;
        setA.add(b);
        setB.add(a);
        return true;
    }
    removeEdge(a, b) {
        const removed = this.adjacency.get(a)?.delete(b) ?? false;
        this.adjacency.get(b)?.delete(a);
        return removed;
    }
    /**
     * Connected components, found by breadth-first search.
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
                for (const w of this.neighbors(v)) {
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
        this.adjacency.clear();
    }
}
//# sourceMappingURL=graph.js.map