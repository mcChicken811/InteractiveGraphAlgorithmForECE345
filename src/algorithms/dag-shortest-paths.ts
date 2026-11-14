import type { NodeId } from '../graph.js';
import type { GraphView } from '../graph-views.js';
import type { AlgorithmDefinition, ArcDiagram, ForestDiagram, Highlight, Simulation } from './types.js';
import { DfsSimulation } from './dfs.js';
import { tidyTree } from './tidy-tree.js';

/**
 * Single-source shortest paths in a directed acyclic graph, as defined in CLRS
 * (Introduction to Algorithms, 4th ed., §22.2):
 *
 *   DAG-SHORTEST-PATHS(G, w, s)
 *     topologically sort the vertices of G
 *     INITIALIZE-SINGLE-SOURCE(G, s)        // v.d = ∞, v.π = NIL; s.d = 0
 *     for each vertex u ∈ G.V, taken in topologically sorted order
 *       for each vertex v in G.Adj[u]
 *         RELAX(u, v, w)                     // if v.d > u.d + w(u, v): v.d = u.d + w(u, v), v.π = u
 *
 * Negative weights are allowed (a DAG has no cycles, negative or not), so it runs on the
 * directed, weighted view. The topological sort is CLRS's TOPOLOGICAL-SORT (§20.4): DFS
 * from s (then every other vertex in ascending id), vertices by decreasing finish time —
 * the same order as DFS's Topological sort line-up, so launching it from there keeps the
 * vertices where they are. If DFS finds a backward edge, the graph has a cycle and no
 * topological order: the simulation is finished from the start and says so.
 *
 * One step is one vertex u in topological order: relax every edge leaving it. A vertex
 * before s in the order has u.d = ∞, so relaxing its edges changes nothing (CLRS still
 * takes it). n vertices take n steps.
 *
 * The display shows what the next step will do: the vertex it takes has a white ring and
 * the edges it will relax are white. Vertices already taken are green; every other edge
 * stays plain. Each vertex shows its d (∞ until an edge reaches it). At the end, the edges
 * (v.π, v) — the shortest-paths tree — are white. "Topological sort" lines the vertices up
 * in the order they are taken, and "Show as tree" shows the predecessor tree so far.
 */
interface LastStep {
  u: NodeId;
  /** Each edge relaxed: its end, d before and after. */
  relaxed: Array<{ v: NodeId; before: number; after: number }>;
}

export class DagShortestPathsSimulation implements Simulation {
  /** The topological order (empty if the graph has a cycle). */
  readonly order: NodeId[];
  /** A backward edge DFS found (the graph has a cycle), or null for a DAG. */
  readonly cycleEdge: [NodeId, NodeId] | null;
  /** v.d: the shortest-path estimate (Infinity for ∞). */
  readonly distance = new Map<NodeId, number>();
  /** v.π: the predecessor on the shortest path found so far (null for NIL). */
  readonly parent = new Map<NodeId, NodeId | null>();
  /** How many vertices of `order` have been taken. */
  private taken = 0;
  private last: LastStep | null = null;
  /** DFS's line-up, kept for Topological sort. */
  private readonly diagram: ArcDiagram | null;

  constructor(
    private readonly view: GraphView,
    readonly source: NodeId,
  ) {
    // TOPOLOGICAL-SORT: DFS, then decreasing finish time (the DFS simulation's own line-up).
    const dfs = new DfsSimulation(view, source);
    while (dfs.step());
    const back = dfs.edges.find((e) => e.kind === 'back');
    this.cycleEdge = back ? [back.from, back.to] : null;
    const sorted = back ? null : dfs.topologicalSort();
    this.order = sorted?.order ?? [];
    // White is the next step's: no white spine; DFS's crossed edges still arc below.
    this.diagram = sorted ? { order: sorted.order, spine: [], below: sorted.below } : null;
    for (const id of view.nodeIds()) {
      this.distance.set(id, Infinity);
      this.parent.set(id, null);
    }
    if (this.distance.has(source)) this.distance.set(source, 0);
  }

  get finished(): boolean {
    return this.taken >= this.order.length;
  }

  /** The vertex the next step takes (null once finished). */
  get next(): NodeId | null {
    return this.finished ? null : this.order[this.taken];
  }

  /** The edges the next step relaxes: every edge leaving the next vertex. */
  edgesToRelax(): Array<[NodeId, NodeId]> {
    const u = this.next;
    return u === null ? [] : this.view.neighbors(u).map((v): [NodeId, NodeId] => [u, v]);
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
    const du = this.distance.get(u)!;
    const relaxed: LastStep['relaxed'] = [];
    for (const v of this.view.neighbors(u)) {
      const before = this.distance.get(v)!;
      const through = du + this.view.weight(u, v)!; // ∞ + w stays ∞
      if (through < before) {
        this.distance.set(v, through); // RELAX
        this.parent.set(v, u);
      }
      relaxed.push({ v, before, after: this.distance.get(v)! });
    }
    this.taken++;
    this.last = { u, relaxed };
    return true;
  }

  highlight(): Highlight {
    const next = this.next;
    return {
      current: next,
      done: this.order.slice(0, this.taken),
      // The edges the next step relaxes; at the end, the shortest-paths tree.
      activeEdges: next !== null ? this.edgesToRelax() : this.predecessorEdges(),
      labels: Object.fromEntries([...this.distance].map(([id, d]) => [id, formatDistance(d)])),
    };
  }

  /** The vertices lined up in the order they are taken (DFS's topological line-up). */
  topologicalSort(): ArcDiagram | null {
    return this.diagram;
  }

  /** The predecessor tree so far, from the source (rows count edges); d = ∞ aside. */
  searchTree(): ForestDiagram {
    return {
      places: this.distance.has(this.source) ? tidyTree(this.source, this.parent) : [],
      spine: this.predecessorEdges(),
      aside: this.view.nodeIds().filter((id) => !Number.isFinite(this.distance.get(id)!)),
      highlightSpine: false,
      intro:
        'Shortest-paths tree so far: the start is on top, and each vertex hangs from its predecessor v.π, ' +
        'one row below it; each Update may move vertices under a new predecessor.',
    };
  }

  describe(): string {
    if (this.cycleEdge) {
      const [u, v] = this.cycleEdge;
      return `DAG shortest paths needs a directed acyclic graph, but DFS found the backward edge ${u} → ${v} (a cycle), so there is no topological order. Press Finish.`;
    }
    const next = this.next;
    const nextText = () => {
      const d = this.distance.get(next!)!;
      return Number.isFinite(d)
        ? ` Next: ${next} (d = ${d}), relaxing the edges out of it.`
        : ` Next: ${next} (d = ∞: not reachable from ${this.source}, so relaxing its edges changes nothing).`;
    };
    const last = this.last;
    if (last === null) {
      return (
        `DAG shortest paths from ${this.source}, taking the vertices in topological order: ${this.order.join(', ')}. ` +
        `Every d is ∞ except ${this.source}.d = 0.${nextText()}`
      );
    }
    const { u, relaxed } = last;
    const lowered = relaxed.filter((r) => r.after < r.before);
    const kept = relaxed.filter((r) => r.after === r.before);
    const parts = [`Took ${u} (d = ${formatDistance(this.distance.get(u)!)}).`];
    if (relaxed.length === 0) parts.push('No edge leaves it.');
    else {
      if (lowered.length) parts.push(`Relaxed ${lowered.map((r) => `${u} → ${r.v}: d ${formatDistance(r.before)} → ${r.after}`).join(', ')}.`);
      if (kept.length) parts.push(`No shorter path to ${kept.map((r) => r.v).join(', ')}.`);
    }
    if (!this.finished) return `${parts.join(' ')}${nextText()}`;
    const unreachable = [...this.distance.values()].filter((d) => !Number.isFinite(d)).length;
    const n = this.order.length;
    return (
      `${parts.join(' ')} DAG shortest paths finished: shortest paths from ${this.source} to ` +
      (unreachable === 0 ? `all ${n} vertices` : `${n - unreachable} of ${n} vertices; ${unreachable} not reachable (d = ∞)`) +
      '. The white edges (v.π, v) form the shortest-paths tree. Press Finish.'
    );
  }
}

function formatDistance(d: number): string {
  return Number.isFinite(d) ? String(d) : '∞';
}

export const dagShortestPaths: AlgorithmDefinition = {
  id: 'dag-shortest-paths',
  name: 'DAG shortest paths',
  // CLRS §22.2: a weighted, directed acyclic graph (negative weights allowed).
  requires: { weighting: 'weighted', directed: true },
  create: (view, start) => new DagShortestPathsSimulation(view, start),
};
