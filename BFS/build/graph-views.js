/**
 * How an undirected *weighted* view combines the weights when arcs run both ways with
 * different weights: the smaller one (the cheapest way between the two nodes). Editing
 * an undirected edge sets both arcs to the same value, so they then agree.
 */
export const UNDIRECTED_WEIGHT = (a, b) => Math.min(a, b);
const ascending = (a, b) => a - b;
const sorted = (ids) => [...(ids ?? [])].sort(ascending);
/** Shared implementation: everything here is derived from `neighbors`, `hasEdge` and `storedWeight`. */
class BaseView {
    arcs;
    weighting;
    constructor(arcs, weighting) {
        this.arcs = arcs;
        this.weighting = weighting;
    }
    get directed() {
        return this.orientation === 'directed';
    }
    get weighted() {
        return this.weighting === 'weighted';
    }
    nodeIds() {
        return this.arcs.nodeIds();
    }
    degree(id) {
        return this.neighbors(id).length;
    }
    get edgeCount() {
        return this.edges().length;
    }
    weight(a, b) {
        const stored = this.storedWeight(a, b);
        if (stored === undefined)
            return undefined;
        return this.weighted ? stored : 1;
    }
    weightedNeighbors(id) {
        return this.neighbors(id).map((n) => ({ id: n, weight: this.weight(id, n) }));
    }
    weightedEdges() {
        return this.edges().map(([from, to]) => ({ from, to, weight: this.weight(from, to) }));
    }
    adjacencyList() {
        return this.nodeIds().map((id) => ({ id, neighbors: this.neighbors(id) }));
    }
    weightedAdjacencyList() {
        return this.nodeIds().map((id) => ({ id, neighbors: this.weightedNeighbors(id) }));
    }
    adjacencyMatrix() {
        const ids = this.nodeIds();
        const matrix = ids.map((a) => ids.map((b) => (this.hasEdge(a, b) ? 1 : 0)));
        return { ids, matrix };
    }
    weightMatrix() {
        const ids = this.nodeIds();
        const matrix = ids.map((a) => ids.map((b) => this.weight(a, b) ?? null));
        return { ids, matrix };
    }
}
/** Every stored arc is its own edge. */
export class DirectedView extends BaseView {
    orientation = 'directed';
    neighbors(id) {
        return this.outNeighbors(id);
    }
    /** Nodes this node's arcs point to, sorted. Same as `neighbors`. */
    outNeighbors(id) {
        return sorted(this.arcs.out(id)?.keys());
    }
    /** Nodes whose arcs point to this node, sorted. */
    inNeighbors(id) {
        return sorted(this.arcs.in(id));
    }
    outDegree(id) {
        return this.arcs.out(id)?.size ?? 0;
    }
    inDegree(id) {
        return this.arcs.in(id)?.size ?? 0;
    }
    hasEdge(a, b) {
        return this.arcs.out(a)?.has(b) ?? false;
    }
    edges() {
        const edges = [];
        for (const from of this.nodeIds())
            for (const to of this.outNeighbors(from))
                edges.push([from, to]);
        return edges;
    }
    storedWeight(a, b) {
        return this.arcs.out(a)?.get(b);
    }
}
/** Directions are ignored: an arc either way (or both) makes one edge. */
export class UndirectedView extends BaseView {
    orientation = 'undirected';
    neighbors(id) {
        return sorted(new Set([...(this.arcs.out(id)?.keys() ?? []), ...(this.arcs.in(id) ?? [])]));
    }
    hasEdge(a, b) {
        return (this.arcs.out(a)?.has(b) ?? false) || (this.arcs.out(b)?.has(a) ?? false);
    }
    edges() {
        const edges = [];
        for (const a of this.nodeIds())
            for (const b of this.neighbors(a))
                if (a < b)
                    edges.push([a, b]);
        return edges;
    }
    storedWeight(a, b) {
        const there = this.arcs.out(a)?.get(b);
        const back = this.arcs.out(b)?.get(a);
        if (there === undefined)
            return back;
        if (back === undefined)
            return there;
        return UNDIRECTED_WEIGHT(there, back);
    }
    /**
     * Connected components, found by breadth-first search (for the directed graph these
     * are its *weakly* connected components). Largest first, ties by smallest id; each
     * component lists its ids in BFS order from its smallest id.
     */
    connectedComponents() {
        const seen = new Set();
        const components = [];
        for (const start of this.nodeIds()) {
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
}
//# sourceMappingURL=graph-views.js.map