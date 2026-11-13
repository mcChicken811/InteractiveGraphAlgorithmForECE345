import type { NodeId } from './graph.js';

/**
 * Read-only views of a graph's edges.
 *
 * A `Graph` stores every edge as a directed arc (from → to). The same arcs can be read
 * two ways, and both views are always available, whatever the UI's current mode:
 *
 *  - `DirectedView`:   every arc is its own edge; A → B and B → A are two edges.
 *  - `UndirectedView`: A and B are adjacent if there is an arc either way; A → B,
 *                      B → A, or both are the single edge {A, B}.
 *
 * Views are pure: they never modify the graph, and every method returns freshly built
 * data (sorted by node id), so callers may keep or mutate the results freely. They are
 * also live: each call reflects the graph's state at that moment.
 *
 * Typical use, e.g. for a BFS that must work in both interpretations:
 *
 *   const view = graph.view('undirected'); // or graph.directedView, graph.currentView
 *   for (const w of view.neighbors(v)) …
 */

export type Orientation = 'directed' | 'undirected';

/** Adjacency-list representation: every node (ascending id) with its sorted neighbours. */
export type AdjacencyList = Array<{ id: NodeId; neighbors: NodeId[] }>;

/**
 * Adjacency-matrix representation. `ids` (ascending) label the rows and columns, and
 * `matrix[i][j]` is 1 when there is an edge from ids[i] to ids[j]. The diagonal is always
 * 0 (self-loops are not allowed). Undirected views give a symmetric matrix.
 */
export interface AdjacencyMatrix {
  ids: NodeId[];
  matrix: Array<Array<0 | 1>>;
}

/** What both views offer. */
export interface GraphView {
  readonly orientation: Orientation;
  /** Shorthand for `orientation === 'directed'`. */
  readonly directed: boolean;
  /** Node ids, ascending. */
  nodeIds(): NodeId[];
  /** Directed: out-neighbours (where its arcs point). Undirected: neighbours either way. Sorted. */
  neighbors(id: NodeId): NodeId[];
  /** Number of neighbours (directed: the out-degree). */
  degree(id: NodeId): number;
  /** Directed: is there an arc a → b? Undirected: is there an arc either way? */
  hasEdge(a: NodeId, b: NodeId): boolean;
  /** Directed: every arc [from, to]. Undirected: every adjacent pair once, as [min, max]. Sorted. */
  edges(): Array<[NodeId, NodeId]>;
  readonly edgeCount: number;
  adjacencyList(): AdjacencyList;
  adjacencyMatrix(): AdjacencyMatrix;
}

/**
 * The read access a view needs to a graph's stored arcs. Implemented privately by
 * `Graph`, so views cannot modify anything.
 */
export interface ArcReader {
  /** Node ids, ascending. */
  nodeIds(): NodeId[];
  /** Targets of the arcs leaving `id` (undefined for an unknown node). */
  out(id: NodeId): ReadonlySet<NodeId> | undefined;
  /** Sources of the arcs entering `id` (undefined for an unknown node). */
  in(id: NodeId): ReadonlySet<NodeId> | undefined;
}

const ascending = (a: NodeId, b: NodeId): number => a - b;
const sorted = (ids: Iterable<NodeId> | undefined): NodeId[] => [...(ids ?? [])].sort(ascending);

/** Shared implementation: everything here is derived from `neighbors` and `hasEdge`. */
abstract class BaseView implements GraphView {
  abstract readonly orientation: Orientation;

  constructor(protected readonly arcs: ArcReader) {}

  abstract neighbors(id: NodeId): NodeId[];
  abstract hasEdge(a: NodeId, b: NodeId): boolean;
  abstract edges(): Array<[NodeId, NodeId]>;

  get directed(): boolean {
    return this.orientation === 'directed';
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

  adjacencyList(): AdjacencyList {
    return this.nodeIds().map((id) => ({ id, neighbors: this.neighbors(id) }));
  }

  adjacencyMatrix(): AdjacencyMatrix {
    const ids = this.nodeIds();
    const matrix = ids.map((a) => ids.map((b) => (this.hasEdge(a, b) ? 1 : 0) as 0 | 1));
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
    return sorted(this.arcs.out(id));
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
}

/** Directions are ignored: an arc either way (or both) makes one edge. */
export class UndirectedView extends BaseView {
  readonly orientation = 'undirected' as const;

  neighbors(id: NodeId): NodeId[] {
    return sorted(new Set([...(this.arcs.out(id) ?? []), ...(this.arcs.in(id) ?? [])]));
  }

  hasEdge(a: NodeId, b: NodeId): boolean {
    return (this.arcs.out(a)?.has(b) ?? false) || (this.arcs.out(b)?.has(a) ?? false);
  }

  edges(): Array<[NodeId, NodeId]> {
    const edges: Array<[NodeId, NodeId]> = [];
    for (const a of this.nodeIds()) for (const b of this.neighbors(a)) if (a < b) edges.push([a, b]);
    return edges;
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
