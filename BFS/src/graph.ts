export type NodeId = number;

export interface GraphNode {
  id: NodeId;
  x: number;
  y: number;
}

/**
 * Undirected, unweighted graph stored as an adjacency list.
 * Node positions live here too so the editor can render them.
 */
export class Graph {
  private readonly nodes = new Map<NodeId, GraphNode>();
  private readonly adjacency = new Map<NodeId, Set<NodeId>>();

  get nodeCount(): number {
    return this.nodes.size;
  }

  get edgeCount(): number {
    let total = 0;
    for (const set of this.adjacency.values()) total += set.size;
    return total / 2;
  }

  /** Adds a node using the smallest unused id, so labels stay compact. */
  addNode(x: number, y: number): GraphNode {
    let id = 0;
    while (this.nodes.has(id)) id++;
    const node: GraphNode = { id, x, y };
    this.nodes.set(id, node);
    this.adjacency.set(id, new Set());
    return node;
  }

  removeNode(id: NodeId): boolean {
    const neighbors = this.adjacency.get(id);
    if (!neighbors) return false;
    for (const other of neighbors) this.adjacency.get(other)?.delete(id);
    this.adjacency.delete(id);
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

  /** Each undirected edge once, as [smaller id, larger id]. */
  getEdges(): Array<[NodeId, NodeId]> {
    const edges: Array<[NodeId, NodeId]> = [];
    for (const [a, set] of this.adjacency) {
      for (const b of set) if (a < b) edges.push([a, b]);
    }
    return edges.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  }

  /** Neighbors of a node, sorted by id (a stable order for BFS later). */
  neighbors(id: NodeId): NodeId[] {
    return [...(this.adjacency.get(id) ?? [])].sort((a, b) => a - b);
  }

  hasEdge(a: NodeId, b: NodeId): boolean {
    return this.adjacency.get(a)?.has(b) ?? false;
  }

  /** Returns false for self-loops, unknown nodes, or duplicate edges. */
  addEdge(a: NodeId, b: NodeId): boolean {
    if (a === b) return false;
    const setA = this.adjacency.get(a);
    const setB = this.adjacency.get(b);
    if (!setA || !setB || setA.has(b)) return false;
    setA.add(b);
    setB.add(a);
    return true;
  }

  removeEdge(a: NodeId, b: NodeId): boolean {
    const removed = this.adjacency.get(a)?.delete(b) ?? false;
    this.adjacency.get(b)?.delete(a);
    return removed;
  }

  /** Adjacency-list representation: every node (by id) with its sorted neighbours. */
  adjacencyList(): Array<{ id: NodeId; neighbors: NodeId[] }> {
    return this.getNodes().map(({ id }) => ({ id, neighbors: this.neighbors(id) }));
  }

  /**
   * Adjacency-matrix representation. `ids` (ascending) label the rows and columns;
   * `matrix[i][j]` is 1 when ids[i] and ids[j] share an edge. For an undirected graph
   * the matrix is symmetric, and its diagonal is 0 because self-loops are not allowed.
   */
  adjacencyMatrix(): { ids: NodeId[]; matrix: Array<Array<0 | 1>> } {
    const ids = this.getNodes().map((n) => n.id);
    const matrix = ids.map((a) => ids.map((b) => (this.hasEdge(a, b) ? 1 : 0) as 0 | 1));
    return { ids, matrix };
  }

  /**
   * Connected components, found by breadth-first search.
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

  clear(): void {
    this.nodes.clear();
    this.adjacency.clear();
  }
}
