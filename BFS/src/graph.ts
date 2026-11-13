import {
  type AdjacencyList,
  type AdjacencyMatrix,
  type ArcReader,
  DirectedView,
  type GraphView,
  type Orientation,
  UndirectedView,
} from './graph-views.js';

export type NodeId = number;

export interface GraphNode {
  id: NodeId;
  x: number;
  y: number;
}

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

  private readonly nodes = new Map<NodeId, GraphNode>();
  private readonly out = new Map<NodeId, Set<NodeId>>();
  private readonly in = new Map<NodeId, Set<NodeId>>();

  /** Read-only access to the stored arcs, shared by the views. */
  private readonly reader: ArcReader = {
    nodeIds: () => [...this.nodes.keys()].sort((a, b) => a - b),
    out: (id) => this.out.get(id),
    in: (id) => this.in.get(id),
  };

  /** The arcs read as a directed graph. */
  readonly directedView = new DirectedView(this.reader);
  /** The arcs read as an undirected graph. */
  readonly undirectedView = new UndirectedView(this.reader);

  /** The view for the given orientation. */
  view(orientation: 'directed'): DirectedView;
  view(orientation: 'undirected'): UndirectedView;
  view(orientation: Orientation): GraphView;
  view(orientation: Orientation): GraphView {
    return orientation === 'directed' ? this.directedView : this.undirectedView;
  }

  /** The view selected by `directed`. */
  get currentView(): GraphView {
    return this.directed ? this.directedView : this.undirectedView;
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
    this.out.set(id, new Set());
    this.in.set(id, new Set());
    return node;
  }

  /** Removes a node and every arc into or out of it. */
  removeNode(id: NodeId): boolean {
    if (!this.nodes.has(id)) return false;
    for (const to of this.out.get(id)!) this.in.get(to)!.delete(id);
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

  /** Every stored arc as [from, to], sorted (ignores `directed`). */
  getArcs(): Array<[NodeId, NodeId]> {
    return this.directedView.edges();
  }

  /**
   * Adds an edge from a to b, always stored as the arc a → b.
   * Returns false for self-loops, unknown nodes, or an edge that already exists in the
   * current view (undirected: a and b already adjacent either way).
   */
  addEdge(a: NodeId, b: NodeId): boolean {
    if (a === b || !this.nodes.has(a) || !this.nodes.has(b) || this.hasEdge(a, b)) return false;
    this.out.get(a)!.add(b);
    this.in.get(b)!.add(a);
    return true;
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
