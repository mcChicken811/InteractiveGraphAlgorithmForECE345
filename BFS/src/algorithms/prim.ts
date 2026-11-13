import type { NodeId } from '../graph.js';
import type { GraphView } from '../graph-views.js';
import type { AlgorithmDefinition, ExploredEdge, Highlight, QueueSnapshot, Simulation } from './types.js';

/**
 * Prim's minimum-spanning-tree algorithm as defined in CLRS (Introduction to Algorithms,
 * 4th ed., §21.2):
 *
 *   MST-PRIM(G, w, r)
 *     for each vertex u ∈ G.V
 *       u.key = ∞
 *       u.π = NIL
 *     r.key = 0
 *     Q = ∅
 *     for each vertex u ∈ G.V
 *       INSERT(Q, u)
 *     while Q ≠ ∅
 *       u = EXTRACT-MIN(Q)                  // add u to the tree
 *       for each vertex v in G.Adj[u]       // update keys of u's non-tree neighbors
 *         if v ∈ Q and w(u, v) < v.key
 *           v.π = u
 *           v.key = w(u, v)
 *           DECREASE-KEY(Q, v, w(u, v))
 *
 * CLRS defines the minimum-spanning-tree problem for a connected, undirected, weighted
 * graph (Chapter 21), so this runs on the undirected view. Weights come from the view:
 * the stored weights in a weighted view, 1 for every edge in an unweighted one.
 *
 * One step is one iteration of the while loop: extract the vertex with the smallest key
 * (ties: the lowest id), which joins the tree by the edge (u.π, u), then lower the keys of
 * its neighbours still in the queue. n vertices take exactly n steps.
 *
 * If the graph is not connected (CLRS assumes it is), the pseudocode still terminates:
 * when only keys of ∞ are left, the extracted vertex has π = NIL and starts a new tree,
 * so the result is a minimum spanning forest, one tree per connected component.
 *
 * Between steps, the tree's vertices S and the queue's vertices V − S form a cut
 * (S, V − S) (CLRS §21.1). An edge crosses the cut when one end is in S and the other in
 * V − S; a crossing edge of minimum weight is a light edge. Prim's invariant — each queued
 * vertex's key is the weight of its lightest edge into S — makes the next vertex's joining
 * edge (v.π, v) a light edge.
 *
 * The display shows what the next step will do: white is the vertex it will extract and
 * its joining edge — the light edge. The other crossing edges are solid grey. The cut
 * itself is drawn as a border on the canvas: the tree's territory (the canvas nearer to a
 * tree vertex than to any queued vertex) is shaded, so the border shows even when no edge
 * crosses the cut (a graph that is not connected). Vertices in
 * the tree are green, as are the tree's edges; every other edge is dashed. Vertices still
 * in the queue with a finite key (they touch the tree) are yellow. Each vertex is labelled
 * with its key.
 */
export interface TreeEdge {
  from: NodeId;
  to: NodeId;
  weight: number;
}

interface LastStep {
  u: NodeId;
  /** u.π when it was extracted (null: a root). */
  via: NodeId | null;
  /** Keys lowered by this step: [vertex, new key], in adjacency order. */
  lowered: Array<[NodeId, number]>;
}

export class PrimSimulation implements Simulation {
  /** The min-priority queue's contents (membership; order comes from the keys). */
  private readonly inQueue: Set<NodeId>;
  private last: LastStep | null = null;

  /** v.key: the lightest edge found so far joining v to the tree (Infinity for ∞). */
  readonly key = new Map<NodeId, number>();
  /** v.π: the tree-side end of that edge (null for NIL). */
  readonly parent = new Map<NodeId, NodeId | null>();
  /** Vertices in the order they were extracted (added to the tree). */
  readonly order: NodeId[] = [];
  /** The tree's edges (u.π, u), in the order they were added. */
  readonly treeEdges: TreeEdge[] = [];
  /** The root of each tree: `root`, then one more for every further connected component. */
  readonly roots: NodeId[] = [];

  constructor(
    private readonly view: GraphView,
    readonly root: NodeId,
  ) {
    const ids = view.nodeIds();
    for (const id of ids) {
      this.key.set(id, Infinity);
      this.parent.set(id, null);
    }
    if (this.key.has(root)) this.key.set(root, 0);
    this.inQueue = new Set(ids);
  }

  /** True once the queue is empty: every vertex is in the tree (or forest). */
  get finished(): boolean {
    return this.inQueue.size === 0;
  }

  /** The queue in extraction order: smallest key first, ties by lowest id. */
  get queued(): NodeId[] {
    return [...this.inQueue].sort((a, b) => {
      const [ka, kb] = [this.key.get(a)!, this.key.get(b)!];
      return ka === kb ? a - b : ka < kb ? -1 : 1; // (∞ − ∞ is NaN, so compare, don't subtract)
    });
  }

  /**
   * The edges crossing the cut (S, V − S): one end in the tree, the other still in the
   * queue, as [tree end, queue end], in extraction order of the tree end, then by id.
   */
  crossingEdges(): Array<[NodeId, NodeId]> {
    const crossing: Array<[NodeId, NodeId]> = [];
    for (const u of this.order) {
      for (const v of this.view.neighbors(u)) if (this.inQueue.has(v)) crossing.push([u, v]);
    }
    return crossing;
  }

  /** Sum of the tree edges' weights so far. */
  get totalWeight(): number {
    return this.treeEdges.reduce((sum, e) => sum + e.weight, 0);
  }

  step(): boolean {
    const u = this.queued[0];
    if (u === undefined) return false;
    // EXTRACT-MIN: u joins the tree, by the edge (u.π, u) unless it is a root.
    this.inQueue.delete(u);
    this.order.push(u);
    const via = this.parent.get(u)!;
    if (via === null) this.roots.push(u);
    else this.treeEdges.push({ from: via, to: u, weight: this.key.get(u)! });
    // Update the keys of u's neighbours that are not in the tree yet.
    const lowered: Array<[NodeId, number]> = [];
    for (const v of this.view.neighbors(u)) {
      const w = this.view.weight(u, v)!;
      if (this.inQueue.has(v) && w < this.key.get(v)!) {
        this.parent.set(v, u);
        this.key.set(v, w); // DECREASE-KEY
        lowered.push([v, w]);
      }
    }
    this.last = { u, via, lowered };
    return true;
  }

  highlight(): Highlight {
    const queue = this.queued;
    const next = queue[0] ?? null;
    const via = next === null ? null : this.parent.get(next)!;
    return {
      current: next,
      done: [...this.order],
      // In the queue and touching the tree: a finite key.
      running: queue.filter((v) => Number.isFinite(this.key.get(v)!)),
      activeEdges: next !== null && via !== null ? [[via, next]] : [],
      labels: Object.fromEntries([...this.key].map(([id, k]) => [id, formatKey(k)])),
      exploredEdges: [
        ...this.treeEdges.map(({ from, to }): ExploredEdge => ({ from, to, done: true })),
        ...this.crossingEdges().map(([from, to]): ExploredEdge => ({ from, to, crossing: true })),
      ],
      // The cut (S, V − S), while both sides have vertices.
      cut: this.order.length > 0 && !this.finished ? [...this.order] : undefined,
    };
  }

  priorityQueueSnapshot(): QueueSnapshot {
    const items = this.queued;
    return { items, incoming: [], running: items.filter((v) => Number.isFinite(this.key.get(v)!)) };
  }

  describe(): string {
    const last = this.last;
    if (last === null) {
      return `Prim from ${this.root}. Every key is ∞ except ${this.root}'s, which is 0. Press Update to add ${this.root} to the tree.`;
    }
    if (this.finished) {
      const edges = this.treeEdges.length;
      const unit = this.view.weighted ? '' : ' (every edge counts as 1)';
      const size = `${edges} ${edges === 1 ? 'edge' : 'edges'}, total weight ${this.totalWeight}${unit}`;
      return this.roots.length <= 1
        ? `Prim finished: a minimum spanning tree of ${size}. Press Finish.`
        : `Prim finished: the graph is not connected, so this is a minimum spanning forest of ${this.roots.length} trees, ${size}. Press Finish.`;
    }
    const { u, via, lowered } = last;
    let added: string;
    if (via !== null) added = `Added ${u} by edge ${via} — ${u} (weight ${this.key.get(u)}).`;
    else if (this.roots.length === 1) added = `Added ${u} as the root of the tree.`;
    else added = `${u} has key ∞: no edge joins it to the tree, so it starts a new tree.`;
    const keys = lowered.length
      ? `Lowered keys: ${lowered.map(([v, k]) => `${v} to ${k}`).join(', ')}.`
      : 'No key changed.';
    return `${added} ${keys} ${this.describeCut()} Tree weight ${this.totalWeight}.`;
  }

  /** The cut after this step: how many edges cross it, and the light edge (white) among them. */
  private describeCut(): string {
    const crossing = this.crossingEdges().length;
    const next = this.queued[0];
    const via = this.parent.get(next)!;
    if (crossing === 0 || via === null) return `No edge crosses the cut, so ${next} will start a new tree.`;
    const count = crossing === 1 ? '1 edge crosses' : `${crossing} edges cross`;
    return `${count} the cut; the light edge is ${via} — ${next} (weight ${this.key.get(next)}).`;
  }
}

function formatKey(key: number): string {
  return Number.isFinite(key) ? String(key) : '∞';
}

export const prim: AlgorithmDefinition = {
  id: 'prim',
  name: "Prim's algorithm",
  // A minimum spanning tree is defined for undirected graphs (CLRS ch. 21). Either
  // weighting works: unweighted views give every edge weight 1.
  requires: { directed: false },
  usesWeights: true,
  create: (view, start) => new PrimSimulation(view, start),
};
