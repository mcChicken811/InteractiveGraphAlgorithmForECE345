import type { NodeId } from '../graph.js';
import type { GraphView } from '../graph-views.js';
import type { AlgorithmDefinition, Highlight, QueueSnapshot, Simulation } from './types.js';

/**
 * Dijkstra's single-source shortest-paths algorithm as defined in CLRS (Introduction to
 * Algorithms, 4th ed., §22.3):
 *
 *   DIJKSTRA(G, w, s)
 *     INITIALIZE-SINGLE-SOURCE(G, s)        // v.d = ∞, v.π = NIL; s.d = 0
 *     S = ∅
 *     Q = ∅
 *     for each vertex u ∈ G.V
 *       INSERT(Q, u)
 *     while Q ≠ ∅
 *       u = EXTRACT-MIN(Q)
 *       S = S ∪ {u}
 *       for each vertex v in G.Adj[u]
 *         RELAX(u, v, w)                     // if v.d > u.d + w(u, v): v.d = u.d + w(u, v),
 *         if the call of RELAX decreased v.d //   v.π = u
 *           DECREASE-KEY(Q, v, v.d)
 *
 * Dijkstra's algorithm needs every edge weight to be nonnegative, so it runs on the
 * positive view, where each stored weight counts as its magnitude (Run selects Positive).
 * It follows the graph's direction as chosen: directed, Adj[u] holds u's out-neighbours;
 * undirected, every edge can be travelled both ways.
 *
 * One step is one iteration of the while loop: extract the vertex with the smallest d
 * (ties: the lowest id), add it to S, and relax each edge leaving it. Relaxing an edge into
 * S never changes anything (its end's d is already final, CLRS Theorem 22.6), so only the
 * edges to vertices still in the queue are shown and counted as relaxed.
 *
 * Once the smallest d left in the queue is ∞, the remaining vertices cannot be reached
 * from s. CLRS would still extract them one by one, each relaxing nothing; the simulation
 * stops there instead, and they keep d = ∞.
 *
 * The display shows what the next step will do: the next vertex to extract has a white
 * ring, and the edges it will relax are white. Vertices in S are green; every other edge
 * stays solid grey. Each vertex shows its d (∞ until an edge reaches it). At the end, the
 * edges (v.π, v) — the shortest-paths tree — are white.
 */
interface LastStep {
  u: NodeId;
  /** Each edge relaxed (to a vertex still in the queue): its end, d before and after. */
  relaxed: Array<{ v: NodeId; before: number; after: number }>;
}

export class DijkstraSimulation implements Simulation {
  /** The min-priority queue's contents (membership; order comes from d). */
  private readonly inQueue: Set<NodeId>;
  private last: LastStep | null = null;

  /** v.d: the shortest-path estimate (Infinity for ∞). */
  readonly distance = new Map<NodeId, number>();
  /** v.π: the predecessor on the shortest path found so far (null for NIL). */
  readonly parent = new Map<NodeId, NodeId | null>();
  /** S: the vertices in the order they were extracted. */
  readonly order: NodeId[] = [];

  constructor(
    private readonly view: GraphView,
    readonly source: NodeId,
  ) {
    const ids = view.nodeIds();
    for (const id of ids) {
      this.distance.set(id, Infinity);
      this.parent.set(id, null);
    }
    if (this.distance.has(source)) this.distance.set(source, 0);
    this.inQueue = new Set(ids);
  }

  /** The queue in extraction order: smallest d first, ties by lowest id. */
  get queued(): NodeId[] {
    return [...this.inQueue].sort((a, b) => {
      const [da, db] = [this.distance.get(a)!, this.distance.get(b)!];
      return da === db ? a - b : da < db ? -1 : 1; // (∞ − ∞ is NaN, so compare, don't subtract)
    });
  }

  /** The vertex the next step extracts, or null once the rest (if any) are unreachable. */
  get next(): NodeId | null {
    const u = this.queued[0];
    return u !== undefined && Number.isFinite(this.distance.get(u)!) ? u : null;
  }

  /** True once every reachable vertex is in S. */
  get finished(): boolean {
    return this.next === null;
  }

  /** The edges the next step relaxes: from the next vertex to its neighbours still in the queue. */
  edgesToRelax(): Array<[NodeId, NodeId]> {
    const u = this.next;
    if (u === null) return [];
    return this.view.neighbors(u).filter((v) => this.inQueue.has(v)).map((v): [NodeId, NodeId] => [u, v]);
  }

  /** The shortest-paths tree found so far: (v.π, v) for every v with a predecessor. */
  predecessorEdges(): Array<[NodeId, NodeId]> {
    const edges: Array<[NodeId, NodeId]> = [];
    for (const [v, p] of this.parent) if (p !== null) edges.push([p, v]);
    return edges;
  }

  step(): boolean {
    const u = this.next;
    if (u === null) return false;
    // EXTRACT-MIN: u.d is now final.
    this.inQueue.delete(u);
    this.order.push(u);
    const du = this.distance.get(u)!;
    const relaxed: LastStep['relaxed'] = [];
    for (const v of this.view.neighbors(u)) {
      if (!this.inQueue.has(v)) continue; // in S: relaxing changes nothing
      const before = this.distance.get(v)!;
      const through = du + this.view.weight(u, v)!;
      // RELAX(u, v, w), then DECREASE-KEY if v.d went down.
      if (through < before) {
        this.distance.set(v, through);
        this.parent.set(v, u);
      }
      relaxed.push({ v, before, after: this.distance.get(v)! });
    }
    this.last = { u, relaxed };
    return true;
  }

  highlight(): Highlight {
    const next = this.next;
    return {
      current: next,
      done: [...this.order],
      // The edges the next step relaxes; at the end, the shortest-paths tree.
      activeEdges: next !== null ? this.edgesToRelax() : this.predecessorEdges(),
      labels: Object.fromEntries([...this.distance].map(([id, d]) => [id, formatDistance(d)])),
    };
  }

  priorityQueueSnapshot(): QueueSnapshot {
    return { items: this.queued, incoming: [] };
  }

  describe(): string {
    const arrow = this.view.directed ? '→' : '—';
    const last = this.last;
    const next = this.next;
    const nextText = () => `Next: extract ${next} (d = ${this.distance.get(next!)}).`;
    if (last === null) {
      if (next === null) return `Dijkstra from ${this.source}: there is no such vertex. Press Finish.`;
      return `Dijkstra from ${this.source}. Every d is ∞ except ${this.source}.d = 0. Press Update to extract ${this.source} and relax its edges.`;
    }
    const { u, relaxed } = last;
    const lowered = relaxed.filter((r) => r.after < r.before);
    const kept = relaxed.filter((r) => r.after === r.before);
    const parts = [`Extracted ${u} (d = ${this.distance.get(u)}).`];
    if (relaxed.length === 0) parts.push('No edge to relax.');
    else {
      if (lowered.length)
        parts.push(`Relaxed ${lowered.map((r) => `${u} ${arrow} ${r.v}: d ${formatDistance(r.before)} → ${r.after}`).join(', ')}.`);
      if (kept.length) parts.push(`No shorter path to ${kept.map((r) => r.v).join(', ')}.`);
    }
    if (!this.finished) return `${parts.join(' ')} ${nextText()}`;
    const n = this.view.nodeIds().length;
    const reached = this.order.length;
    const unreachable = n - reached;
    const ending =
      unreachable === 0
        ? `Dijkstra finished: shortest paths from ${this.source} to all ${n} vertices; the white edges (v.π, v) form the shortest-paths tree. Press Finish.`
        : `Dijkstra finished: shortest paths from ${this.source} to ${reached} of ${n} vertices; ${unreachable} not reachable (d = ∞). The white edges (v.π, v) form the shortest-paths tree. Press Finish.`;
    return `${parts.join(' ')} ${ending}`;
  }
}

function formatDistance(d: number): string {
  return Number.isFinite(d) ? String(d) : '∞';
}

export const dijkstra: AlgorithmDefinition = {
  id: 'dijkstra',
  name: "Dijkstra's algorithm",
  // Dijkstra needs nonnegative weights (CLRS §22.3): the positive view reads every weight
  // as its magnitude. Either direction works.
  requires: { weighting: 'positive' },
  create: (view, start) => new DijkstraSimulation(view, start),
};
