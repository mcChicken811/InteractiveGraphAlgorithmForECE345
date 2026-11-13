import {
  type AdjacencyList,
  type AdjacencyMatrix,
  type ArcReader,
  DirectedView,
  type GraphView,
  type Orientation,
  UndirectedView,
  type Weighting,
} from './graph-views.js';

export type NodeId = number;

export interface GraphNode {
  id: NodeId;
  x: number;
  y: number;
}

/**
 * Weighted graph. Edges are always *stored* as weighted directed arcs (from → to, weight;
 * the weight defaults to 0), in an out-adjacency map plus an in-adjacency set for fast
 * removal.
 *
 * Reading: the arcs can be interpreted as directed or undirected, and as weighted,
 * unweighted (every edge weight 1) or positive (each weight's magnitude). All six
 * interpretations are always available as pure, read-only views (see graph-views.ts):
 *
 *   graph.view('directed' | 'undirected', 'weighted' | 'unweighted' | 'positive')
 *   graph.directedView / graph.undirectedView   the two unweighted views (shortcuts)
 *   graph.currentView                           the one selected by `directed` and
 *                                               `weighting` (the UI's modes)
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
  /** Weighted, unweighted or positive reading for `currentView`. Never changes stored weights. */
  weighting: Weighting = 'unweighted';

  /** Whether weights are read ('weighted' or 'positive'). Setting it picks 'weighted' or 'unweighted'. */
  get weighted(): boolean {
    return this.weighting !== 'unweighted';
  }

  set weighted(on: boolean) {
    this.weighting = on ? 'weighted' : 'unweighted';
  }

  private readonly nodes = new Map<NodeId, GraphNode>();
  /** from → (to → weight) */
  private readonly out = new Map<NodeId, Map<NodeId, number>>();
  /** to → sources */
  private readonly in = new Map<NodeId, Set<NodeId>>();

  /** Read-only access to the stored arcs, shared by the views. */
  private readonly reader: ArcReader = {
    nodeIds: () => [...this.nodes.keys()].sort((a, b) => a - b),
    out: (id) => this.out.get(id),
    in: (id) => this.in.get(id),
  };

  private readonly views = {
    directed: {
      unweighted: new DirectedView(this.reader, 'unweighted'),
      weighted: new DirectedView(this.reader, 'weighted'),
      positive: new DirectedView(this.reader, 'positive'),
    },
    undirected: {
      unweighted: new UndirectedView(this.reader, 'unweighted'),
      weighted: new UndirectedView(this.reader, 'weighted'),
      positive: new UndirectedView(this.reader, 'positive'),
    },
  };

  /** The view for the given orientation and weighting (unweighted unless stated). */
  view(orientation: 'directed', weighting?: Weighting): DirectedView;
  view(orientation: 'undirected', weighting?: Weighting): UndirectedView;
  view(orientation: Orientation, weighting?: Weighting): GraphView;
  view(orientation: Orientation, weighting: Weighting = 'unweighted'): GraphView {
    return this.views[orientation][weighting];
  }

  /** The arcs read as an unweighted directed graph. */
  get directedView(): DirectedView {
    return this.views.directed.unweighted;
  }

  /** The arcs read as an unweighted undirected graph. */
  get undirectedView(): UndirectedView {
    return this.views.undirected.unweighted;
  }

  /** The view selected by `directed` and `weighting`. */
  get currentView(): GraphView {
    return this.view(this.directed ? 'directed' : 'undirected', this.weighting);
  }

  // ------------------------------------------------------------------ nodes

  get nodeCount(): number {
    return this.nodes.size;
  }

  /** Adds a node using the smallest unused id, so labels stay compact. */
  addNode(x: number, y: number): GraphNode {
    let id = 0;
    while (this.nodes.has(id)) id++;
    const node: GraphNode = { id, x, y };
    this.nodes.set(id, node);
    this.out.set(id, new Map());
    this.in.set(id, new Set());
    return node;
  }

  /** Removes a node and every arc into or out of it. */
  removeNode(id: NodeId): boolean {
    if (!this.nodes.has(id)) return false;
    for (const to of this.out.get(id)!.keys()) this.in.get(to)!.delete(id);
    for (const from of this.in.get(id)!) this.out.get(from)!.delete(id);
    this.out.delete(id);
    this.in.delete(id);
    this.nodes.delete(id);
    return true;
  }

  moveNode(id: NodeId, x: number, y: number): void {
    const node = this.nodes.get(id);
    if (node) {
      node.x = x;
      node.y = y;
    }
  }

  getNode(id: NodeId): GraphNode | undefined {
    return this.nodes.get(id);
  }

  /** Nodes sorted by id. */
  getNodes(): GraphNode[] {
    return [...this.nodes.values()].sort((a, b) => a.id - b.id);
  }

  // ------------------------------------------------------------ stored arcs

  /** True if the arc from → to is stored (ignores `directed`). */
  hasArc(from: NodeId, to: NodeId): boolean {
    return this.directedView.hasEdge(from, to);
  }

  /** Stored weight of the arc from → to, or undefined if there is no such arc. */
  arcWeight(from: NodeId, to: NodeId): number | undefined {
    return this.out.get(from)?.get(to);
  }

  /** Every stored arc as [from, to], sorted (ignores `directed`). */
  getArcs(): Array<[NodeId, NodeId]> {
    return this.directedView.edges();
  }

  /**
   * Adds an edge from a to b, always stored as the arc a → b with the given weight
   * (default 0). Returns false for self-loops, unknown nodes, non-finite weights, or an
   * edge that already exists in the current view (undirected: a and b adjacent either way).
   */
  addEdge(a: NodeId, b: NodeId, weight = 0): boolean {
    if (a === b || !this.nodes.has(a) || !this.nodes.has(b) || !Number.isFinite(weight)) return false;
    if (this.hasEdge(a, b)) return false;
    this.out.get(a)!.set(b, weight);
    this.in.get(b)!.add(a);
    return true;
  }

  /**
   * Sets the weight of the edge between a and b in the current orientation:
   * directed → the arc a → b; undirected → every stored arc between them (one or both
   * directions), so they agree afterwards. Returns false if there is no such edge.
   */
  setWeight(a: NodeId, b: NodeId, weight: number): boolean {
    if (!Number.isFinite(weight)) return false;
    let changed = false;
    const arcs: Array<[NodeId, NodeId]> = this.directed ? [[a, b]] : [[a, b], [b, a]];
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
  removeEdge(a: NodeId, b: NodeId): boolean {
    let removed = this.removeArc(a, b);
    if (!this.directed) removed = this.removeArc(b, a) || removed;
    return removed;
  }

  private removeArc(from: NodeId, to: NodeId): boolean {
    if (!this.out.get(from)?.delete(to)) return false;
    this.in.get(to)?.delete(from);
    return true;
  }

  /** Removes every stored arc, keeping the nodes where they are. */
  clearEdges(): void {
    for (const targets of this.out.values()) targets.clear();
    for (const sources of this.in.values()) sources.clear();
  }

  clear(): void {
    this.nodes.clear();
    this.out.clear();
    this.in.clear();
  }

  // ------------------------------- readers for the current view (by `directed`)

  /** Number of edges in the current view. */
  get edgeCount(): number {
    return this.currentView.edgeCount;
  }

  /** Edges in the current view (see GraphView.edges). */
  getEdges(): Array<[NodeId, NodeId]> {
    return this.currentView.edges();
  }

  /** Neighbours in the current view, sorted by id (a stable order for BFS). */
  neighbors(id: NodeId): NodeId[] {
    return this.currentView.neighbors(id);
  }

  /** Is there an edge a → b (directed) / between a and b (undirected) in the current view? */
  hasEdge(a: NodeId, b: NodeId): boolean {
    return this.currentView.hasEdge(a, b);
  }

  adjacencyList(): AdjacencyList {
    return this.currentView.adjacencyList();
  }

  adjacencyMatrix(): AdjacencyMatrix {
    return this.currentView.adjacencyMatrix();
  }

  /** Connected components ignoring direction (see UndirectedView.connectedComponents). */
  connectedComponents(): NodeId[][] {
    return this.undirectedView.connectedComponents();
  }
}
