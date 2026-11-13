import { DisjointSet } from './disjoint-set.js';
/**
 * Kruskal's minimum-spanning-tree algorithm as defined in CLRS (Introduction to
 * Algorithms, 4th ed., §21.2):
 *
 *   MST-KRUSKAL(G, w)
 *     A = ∅
 *     for each vertex v ∈ G.V
 *       MAKE-SET(v)
 *     create a single list of the edges in G.E
 *     sort the list of edges into monotonically increasing order by weight w
 *     for each edge (u, v) taken from the sorted list in order
 *       if FIND-SET(u) ≠ FIND-SET(v)
 *         A = A ∪ {(u, v)}
 *         UNION(u, v)
 *     return A
 *
 * with the disjoint-set forest of §19.3 (union by rank, path compression; see
 * disjoint-set.ts). Like Prim's algorithm it solves the minimum-spanning-tree problem
 * for an undirected graph (Chapter 21), so it runs on the undirected view, with the
 * view's weights (every edge weighs 1 in an unweighted view). Edges of equal weight are
 * taken in order of their ends' ids. On a graph that is not connected it finds a minimum
 * spanning forest, one tree per connected component. It needs no start vertex.
 *
 * One step is one iteration of the for loop: the next edge (u, v) in sorted order is
 * added to A if its ends are in different trees (FIND-SET differs) — then it is a light
 * edge crossing the cut (C, V − C), where C is u's tree (Corollary 21.2) — and skipped
 * otherwise (it would close a cycle). A graph with m edges takes m steps.
 *
 * The display follows Prim's: the white edge is the one the next step considers, the cut
 * (C, V − C) is drawn on the canvas with its crossing edges grey, A's edges are green,
 * other edges inside one tree dashed green, and vertices in a tree with an edge green.
 * Vertices are compact dots labelled with their set's representative, FIND-SET(v), shown
 * when the sorted edge list is hovered.
 */
export class KruskalSimulation {
    view;
    sets = new DisjointSet();
    /** The edges in sorted order; `next` indexes the one the next step considers. */
    sorted;
    next = 0;
    last = null;
    /** A: the forest's edges, in the order they were added. */
    forest = [];
    /** Edges skipped because their ends were already in one tree. */
    skipped = [];
    constructor(view) {
        this.view = view;
        for (const v of view.nodeIds())
            this.sets.makeSet(v);
        this.sorted = view
            .weightedEdges()
            .map(({ from, to, weight }) => ({ from: Math.min(from, to), to: Math.max(from, to), weight }))
            .sort((a, b) => a.weight - b.weight || a.from - b.from || a.to - b.to);
    }
    get finished() {
        return this.next >= this.sorted.length;
    }
    /** The edge the next step considers, if any. */
    get upcoming() {
        return this.sorted[this.next] ?? null;
    }
    get totalWeight() {
        return this.forest.reduce((sum, e) => sum + e.weight, 0);
    }
    /** FIND-SET(v) without path compression (display only). */
    representative(v) {
        return this.sets.representative(v);
    }
    /** The vertices of v's tree, ascending. */
    treeOf(v) {
        const r = this.sets.representative(v);
        return this.view.nodeIds().filter((x) => this.sets.representative(x) === r);
    }
    /** The forest's trees (one per set), each in id order, ordered by their smallest vertex. */
    trees() {
        const byRoot = new Map();
        for (const v of this.view.nodeIds()) {
            const r = this.sets.representative(v);
            byRoot.set(r, [...(byRoot.get(r) ?? []), v]);
        }
        return [...byRoot.values()];
    }
    /** How many trees the forest has (one per set). */
    get treeCount() {
        return new Set(this.view.nodeIds().map((v) => this.sets.representative(v))).size;
    }
    step() {
        const edge = this.sorted[this.next];
        if (!edge)
            return false;
        this.next++;
        const added = this.sets.findSet(edge.from) !== this.sets.findSet(edge.to);
        if (added) {
            this.forest.push(edge);
            this.sets.union(edge.from, edge.to);
        }
        else {
            this.skipped.push(edge);
        }
        this.last = { edge, added };
        return true;
    }
    /**
     * The edges crossing the cut (C, V − C) around u's tree, for the upcoming edge (u, v):
     * one end in C, the other outside, as [inside end, outside end].
     */
    crossingEdges() {
        const edge = this.upcoming;
        if (!edge)
            return [];
        const tree = new Set(this.treeOf(edge.from));
        return this.view
            .edges()
            .filter(([a, b]) => tree.has(a) !== tree.has(b))
            .map(([a, b]) => (tree.has(a) ? [a, b] : [b, a]));
    }
    highlight() {
        const edge = this.upcoming;
        const inForest = new Set(this.forest.map((e) => `${e.from}-${e.to}`));
        const crossing = this.crossingEdges();
        const crossKey = new Set(crossing.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`));
        // Edges with both ends in one tree that are not A's (they would close a cycle).
        const within = this.view
            .edges()
            .filter(([a, b]) => !inForest.has(`${a}-${b}`) && this.sets.representative(a) === this.sets.representative(b));
        const ids = this.view.nodeIds();
        const touched = new Set(this.forest.flatMap((e) => [e.from, e.to]));
        // The trees with an edge, each a territory of its own (a lone vertex is the rest's).
        const trees = this.trees().filter((tree) => tree.length > 1);
        return {
            current: null,
            compact: true,
            done: ids.filter((v) => touched.has(v)), // in a tree with an edge
            activeEdges: edge ? [[edge.from, edge.to]] : [],
            labels: Object.fromEntries(ids.map((v) => [v, String(this.sets.representative(v))])),
            exploredEdges: [
                ...this.forest.map(({ from, to }) => ({ from, to, done: true })),
                ...crossing.filter(([a, b]) => !inForest.has(`${Math.min(a, b)}-${Math.max(a, b)}`)).map(([from, to]) => ({ from, to, crossing: true })),
                ...within.filter(([a, b]) => !crossKey.has(`${a}-${b}`)).map(([from, to]) => ({ from, to, within: true })),
            ],
            // Every tree of A so far, green, with a border around each: between two trees as well
            // as with the rest. At the end, a spanning tree floods the canvas, as with Prim.
            // The territories come from the vertices and the non-crossing edges, as with Prim:
            // each tree's own, and the rest's (the vertices in no tree yet, and edges among them).
            cut: trees.flat(),
            cutGroups: trees,
        };
    }
    edgeQueueSnapshot() {
        return { items: this.sorted.slice(this.next), last: this.last ? { ...this.last.edge, added: this.last.added } : null };
    }
    describe() {
        const edge = this.upcoming;
        const name = (e) => `${e.from} — ${e.to} (weight ${e.weight})`;
        const unit = this.view.weighted ? '' : ' (every edge counts as 1)';
        if (this.finished) {
            if (!this.last)
                return 'Kruskal: the graph has no edges, so every vertex is a tree of its own. Press Finish.';
            const edges = this.forest.length;
            const size = `${edges} ${edges === 1 ? 'edge' : 'edges'}, total weight ${this.totalWeight}${unit}`;
            const trees = this.treeCount;
            return trees <= 1
                ? `Kruskal finished: a minimum spanning tree of ${size}. Press Finish.`
                : `Kruskal finished: the graph is not connected, so this is a minimum spanning forest of ${trees} trees, ${size}. Press Finish.`;
        }
        const upcoming = (e) => this.sets.representative(e.from) === this.sets.representative(e.to)
            ? `Next: ${name(e)} has both ends in one tree, so it would close a cycle.`
            : `Next: ${name(e)} joins two trees: a light edge crossing the cut around ${e.from}'s tree.`;
        if (!this.last) {
            const m = this.sorted.length;
            return `Kruskal: every vertex is a set of its own; ${m} ${m === 1 ? 'edge' : 'edges'} sorted by weight. ${upcoming(edge)}`;
        }
        const { edge: e, added } = this.last;
        const did = added
            ? `Added ${name(e)}: it joined two trees.`
            : `Skipped ${name(e)}: both ends were already in one tree.`;
        return `${did} Forest weight ${this.totalWeight}. ${upcoming(edge)}`;
    }
}
export const kruskal = {
    id: 'kruskal',
    name: "Kruskal's algorithm",
    // A minimum spanning tree is defined for undirected graphs (CLRS ch. 21). Either
    // weighting works: unweighted views give every edge weight 1. No start vertex is used.
    requires: { directed: false },
    usesWeights: true,
    create: (view) => new KruskalSimulation(view),
};
//# sourceMappingURL=kruskal.js.map