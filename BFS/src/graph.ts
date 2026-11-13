export type NodeId = number;

export interface GraphNode {
  id: NodeId;
  x: number;
  y: number;
}

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

  private readonly nodes = new Map<NodeId, GraphNode>();
  private readonly out = new Map<NodeId, Set<NodeId>>();
  private readonly in = new Map<NodeId, Set<NodeId>>();

  get nodeCount(): number {
    return this.nodes.size;
  }

  /** Number of edges under the current interpretation. */
  get edgeCount(): number {
    return this.getEdges().length;
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

  /** True if the arc from → to is stored (ignores the interpretation). */
  hasArc(from: NodeId, to: NodeId): boolean {
    return this.out.get(from)?.has(to) ?? false;
  }

  /** Every stored arc as [from, to], sorted. */
  getArcs(): Array<[NodeId, NodeId]> {
    const arcs: Array<[NodeId, NodeId]> = [];
    for (const [from, set] of this.out) for (const to of set) arcs.push([from, to]);
    return arcs.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  }

  /** Neighbours ignoring direction (arcs either way), sorted. Used by the layout. */
  undirectedNeighbors(id: NodeId): NodeId[] {
    const set = new Set([...(this.out.get(id) ?? []), ...(this.in.get(id) ?? [])]);
    return [...set].sort((a, b) => a - b);
  }

  // ------------------------------------------- edges, per the interpretation

  /**
   * Edges under the current interpretation, sorted:
   * directed → each arc as [from, to]; undirected → each adjacent pair once as [min, max].
   */
  getEdges(): Array<[NodeId, NodeId]> {
    if (this.directed) return this.getArcs();
    const edges: Array<[NodeId, NodeId]> = [];
    for (const { id: a } of this.getNodes()) {
      for (const b of this.undirectedNeighbors(a)) if (a < b) edges.push([a, b]);
    }
    return edges;
  }

  /**
   * Neighbours of a node, sorted by id (a stable order for BFS):
   * directed → out-neighbours (nodes its arcs point to); undirected → arcs either way.
   */
  neighbors(id: NodeId): NodeId[] {
    if (this.directed) return [...(this.out.get(id) ?? [])].sort((a, b) => a - b);
    return this.undirectedNeighbors(id);
  }

  /** Directed: is there an arc a → b? Undirected: is there an arc either way? */
  hasEdge(a: NodeId, b: NodeId): boolean {
    return this.directed ? this.hasArc(a, b) : this.hasArc(a, b) || this.hasArc(b, a);
  }

  /**
   * Adds an edge from a to b, always stored as the arc a → b.
   * Returns false for self-loops, unknown nodes, or an edge that already exists under
   * the current interpretation (undirected: a and b already adjacent either way).
   */
  addEdge(a: NodeId, b: NodeId): boolean {
    if (a === b || !this.nodes.has(a) || !this.nodes.has(b) || this.hasEdge(a, b)) return false;
    this.out.get(a)!.add(b);
    this.in.get(b)!.add(a);
    return true;
  }

  /**
   * Removes the edge between a and b under the current interpretation:
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

  // -------------------------------------------------------- representations

  /** Adjacency-list representation: every node (by id) with its sorted neighbours. */
  adjacencyList(): Array<{ id: NodeId; neighbors: NodeId[] }> {
    return this.getNodes().map(({ id }) => ({ id, neighbors: this.neighbors(id) }));
  }

  /**
   * Adjacency-matrix representation. `ids` (ascending) label the rows and columns;
   * `matrix[i][j]` is 1 when there is an edge from ids[i] to ids[j]. Undirected, the
   * matrix is symmetric; directed, row i lists the arcs leaving ids[i]. The diagonal is
   * 0 because self-loops are not allowed.
   */
  adjacencyMatrix(): { ids: NodeId[]; matrix: Array<Array<0 | 1>> } {
    const ids = this.getNodes().map((n) => n.id);
    const matrix = ids.map((a) => ids.map((b) => (this.hasEdge(a, b) ? 1 : 0) as 0 | 1));
    return { ids, matrix };
  }

  /**
   * Connected components, found by breadth-first search with edge directions ignored
   * (for a directed graph these are its *weakly* connected components).
   * Ordered largest first (ties: smallest node id first); each component lists its
   * node ids in BFS order from its smallest id.
   */
  connectedComponents(): NodeId[][] {
    const seen = new Set<NodeId>();
    const components: NodeId[][] = [];
    for (const { id: start } of this.getNodes()) {
      if (seen.has(start)) continue;
      const component: NodeId[] = [];
      const queue: NodeId[] = [start];
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

  clear(): void {
    this.nodes.clear();
    this.out.clear();
    this.in.clear();
  }
}
