import type { NodeId } from './graph.js';

/**
 * Read-only views of a graph's edges.
 *
 * A `Graph` stores every edge as a *weighted directed arc* (from → to, weight). The same
 * arcs can be read in six ways, and all six views are always available, whatever the
 * UI's current mode:
 *
 *               │ unweighted                       │ weighted
 *   ────────────┼──────────────────────────────────┼─────────────────────────────────────
 *   directed    │ every arc is an edge, weight 1   │ every arc is an edge, stored weight
 *   undirected  │ an arc either way (or both) is   │ same, weight = the arc's weight, or
 *               │ one edge, weight 1               │ the smaller of the two (UNDIRECTED_WEIGHT)
 *
 * "Unweighted" uses the standard convention that every edge has weight 1 (what BFS
 * implicitly assumes), so weight-aware code works unchanged on unweighted views.
 * "Positive" is weighted, reading each arc's weight as its magnitude (−5 counts as 5),
 * so no edge weighs less than 0; undirected, the smaller of the two magnitudes.
 *
 * Views are pure: they never modify the graph, and every method returns freshly built
 * data (sorted by node id), so callers may keep or mutate the results freely. They are
 * also live: each call reflects the graph's state at that moment.
 *
 *   const view = graph.view('undirected', 'weighted'); // or graph.currentView
 *   for (const { id, weight } of view.weightedNeighbors(v)) …
 */

export type Orientation = 'directed' | 'undirected';
/** 'positive': weighted, with each stored weight read as its magnitude (|w|). */
export type Weighting = 'weighted' | 'unweighted' | 'positive';

/** A neighbour together with the weight of the edge leading to it. */
export interface WeightedNeighbor {
  id: NodeId;
  weight: number;
}

/** An edge with its weight. Undirected views give each pair once, with from < to. */
export interface WeightedEdge {
  from: NodeId;
  to: NodeId;
  weight: number;
}

/** Adjacency-list representation: every node (ascending id) with its sorted neighbours. */
export type AdjacencyList = Array<{ id: NodeId; neighbors: NodeId[] }>;

/** Weighted adjacency list: every node with its sorted neighbours and edge weights. */
export type WeightedAdjacencyList = Array<{ id: NodeId; neighbors: WeightedNeighbor[] }>;

/**
 * Adjacency-matrix representation. `ids` (ascending) label the rows and columns, and
 * `matrix[i][j]` is 1 when there is an edge from ids[i] to ids[j]. The diagonal is always
 * 0 (self-loops are not allowed). Undirected views give a symmetric matrix.
 */
export interface AdjacencyMatrix {
  ids: NodeId[];
  matrix: Array<Array<0 | 1>>;
}

/**
 * Weight matrix: like AdjacencyMatrix, but each cell holds the edge's weight, or `null`
 * when there is no edge (0 is a valid weight, so it cannot mean "no edge").
 */
export interface WeightMatrix {
  ids: NodeId[];
  matrix: Array<Array<number | null>>;
}

/**
 * How an undirected *weighted* view combines the weights when arcs run both ways with
 * different weights: the smaller one (the cheapest way between the two nodes). Editing
 * an undirected edge sets both arcs to the same value, so they then agree.
 */
export const UNDIRECTED_WEIGHT = (a: number, b: number): number => Math.min(a, b);

/** What every view offers. */
export interface GraphView {
  readonly orientation: Orientation;
  /** Shorthand for `orientation === 'directed'`. */
  readonly directed: boolean;
  readonly weighting: Weighting;
  /** Whether weights are read at all: 'weighted' or 'positive' (not 'unweighted'). */
  readonly weighted: boolean;
  /** Node ids, ascending. */
  nodeIds(): NodeId[];
  /** Directed: out-neighbours (where its arcs point). Undirected: neighbours either way. Sorted. */
  neighbors(id: NodeId): NodeId[];
  /** `neighbors` with the weight of each edge (always 1 in unweighted views). */
  weightedNeighbors(id: NodeId): WeightedNeighbor[];
  /** Number of neighbours (directed: the out-degree). */
  degree(id: NodeId): number;
  /** Directed: is there an arc a → b? Undirected: is there an arc either way? */
  hasEdge(a: NodeId, b: NodeId): boolean;
  /** Weight of the edge a → b (undirected: between a and b), or undefined if there is none. */
  weight(a: NodeId, b: NodeId): number | undefined;
  /** Directed: every arc [from, to]. Undirected: every adjacent pair once, as [min, max]. Sorted. */
  edges(): Array<[NodeId, NodeId]>;
  /** `edges` with weights. */
  weightedEdges(): WeightedEdge[];
  readonly edgeCount: number;
  adjacencyList(): AdjacencyList;
  weightedAdjacencyList(): WeightedAdjacencyList;
  /** 0/1 connectivity matrix (ignores weights). */
  adjacencyMatrix(): AdjacencyMatrix;
  /** Weight per cell, or null for no edge (unweighted views: 1 or null). */
  weightMatrix(): WeightMatrix;
}

/**
 * The read access a view needs to a graph's stored arcs. Implemented privately by
 * `Graph`, so views cannot modify anything.
 */
export interface ArcReader {
  /** Node ids, ascending. */
  nodeIds(): NodeId[];
  /** Arcs leaving `id`: target → weight (undefined for an unknown node). */
  out(id: NodeId): ReadonlyMap<NodeId, number> | undefined;
  /** Sources of the arcs entering `id` (undefined for an unknown node). */
  in(id: NodeId): ReadonlySet<NodeId> | undefined;
}

const ascending = (a: NodeId, b: NodeId): number => a - b;
const sorted = (ids: Iterable<NodeId> | undefined): NodeId[] => [...(ids ?? [])].sort(ascending);

/** Shared implementation: everything here is derived from `neighbors`, `hasEdge` and `storedWeight`. */
abstract class BaseView implements GraphView {
  abstract readonly orientation: Orientation;

  constructor(
    protected readonly arcs: ArcReader,
    readonly weighting: Weighting,
  ) {}

  abstract neighbors(id: NodeId): NodeId[];
  abstract hasEdge(a: NodeId, b: NodeId): boolean;
  abstract edges(): Array<[NodeId, NodeId]>;
  /** The stored weight of the edge, by this view's orientation (undefined if none). */
  protected abstract storedWeight(a: NodeId, b: NodeId): number | undefined;

  get directed(): boolean {
    return this.orientation === 'directed';
  }

  get weighted(): boolean {
    return this.weighting !== 'unweighted';
  }

  /** How this view reads a stored weight: as it is, or (positive) its magnitude. */
  protected read(stored: number): number {
    return this.weighting === 'positive' ? Math.abs(stored) : stored;
  }

  nodeIds(): NodeId[] {
    return this.arcs.nodeIds();
  }

  degree(id: NodeId): number {
    return this.neighbors(id).length;
  }

  get edgeCount(): number {
    return this.edges().length;
  }

  weight(a: NodeId, b: NodeId): number | undefined {
    const stored = this.storedWeight(a, b);
    if (stored === undefined) return undefined;
    return this.weighted ? this.read(stored) : 1;
  }

  weightedNeighbors(id: NodeId): WeightedNeighbor[] {
    return this.neighbors(id).map((n) => ({ id: n, weight: this.weight(id, n)! }));
  }

  weightedEdges(): WeightedEdge[] {
    return this.edges().map(([from, to]) => ({ from, to, weight: this.weight(from, to)! }));
  }

  adjacencyList(): AdjacencyList {
    return this.nodeIds().map((id) => ({ id, neighbors: this.neighbors(id) }));
  }

  weightedAdjacencyList(): WeightedAdjacencyList {
    return this.nodeIds().map((id) => ({ id, neighbors: this.weightedNeighbors(id) }));
  }

  adjacencyMatrix(): AdjacencyMatrix {
    const ids = this.nodeIds();
    const matrix = ids.map((a) => ids.map((b) => (this.hasEdge(a, b) ? 1 : 0) as 0 | 1));
    return { ids, matrix };
  }

  weightMatrix(): WeightMatrix {
    const ids = this.nodeIds();
    const matrix = ids.map((a) => ids.map((b) => this.weight(a, b) ?? null));
    return { ids, matrix };
  }
}

/** Every stored arc is its own edge. */
export class DirectedView extends BaseView {
  readonly orientation = 'directed' as const;

  neighbors(id: NodeId): NodeId[] {
    return this.outNeighbors(id);
  }

  /** Nodes this node's arcs point to, sorted. Same as `neighbors`. */
  outNeighbors(id: NodeId): NodeId[] {
    return sorted(this.arcs.out(id)?.keys());
  }

  /** Nodes whose arcs point to this node, sorted. */
  inNeighbors(id: NodeId): NodeId[] {
    return sorted(this.arcs.in(id));
  }

  outDegree(id: NodeId): number {
    return this.arcs.out(id)?.size ?? 0;
  }

  inDegree(id: NodeId): number {
    return this.arcs.in(id)?.size ?? 0;
  }

  hasEdge(a: NodeId, b: NodeId): boolean {
    return this.arcs.out(a)?.has(b) ?? false;
  }

  edges(): Array<[NodeId, NodeId]> {
    const edges: Array<[NodeId, NodeId]> = [];
    for (const from of this.nodeIds()) for (const to of this.outNeighbors(from)) edges.push([from, to]);
    return edges;
  }

  protected storedWeight(a: NodeId, b: NodeId): number | undefined {
    return this.arcs.out(a)?.get(b);
  }
}

/** Directions are ignored: an arc either way (or both) makes one edge. */
export class UndirectedView extends BaseView {
  readonly orientation = 'undirected' as const;

  neighbors(id: NodeId): NodeId[] {
    return sorted(new Set([...(this.arcs.out(id)?.keys() ?? []), ...(this.arcs.in(id) ?? [])]));
  }

  hasEdge(a: NodeId, b: NodeId): boolean {
    return (this.arcs.out(a)?.has(b) ?? false) || (this.arcs.out(b)?.has(a) ?? false);
  }

  edges(): Array<[NodeId, NodeId]> {
    const edges: Array<[NodeId, NodeId]> = [];
    for (const a of this.nodeIds()) for (const b of this.neighbors(a)) if (a < b) edges.push([a, b]);
    return edges;
  }

  protected storedWeight(a: NodeId, b: NodeId): number | undefined {
    const there = this.arcs.out(a)?.get(b);
    const back = this.arcs.out(b)?.get(a);
    if (there === undefined) return back;
    if (back === undefined) return there;
    // Positive: the smaller magnitude (|−5| and 3 combine to 3).
    return UNDIRECTED_WEIGHT(this.read(there), this.read(back));
  }

  /**
   * Connected components, found by breadth-first search (for the directed graph these
   * are its *weakly* connected components). Largest first, ties by smallest id; each
   * component lists its ids in BFS order from its smallest id.
   */
  connectedComponents(): NodeId[][] {
    const seen = new Set<NodeId>();
    const components: NodeId[][] = [];
    for (const start of this.nodeIds()) {
      if (seen.has(start)) continue;
      const component: NodeId[] = [];
      const queue: NodeId[] = [start];
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
