import type { NodeId } from '../graph.js';
import type { GraphView } from '../graph-views.js';
import type { AlgorithmDefinition, Highlight, Simulation } from './types.js';

/**
 * The Bellman–Ford single-source shortest-paths algorithm as defined in CLRS
 * (Introduction to Algorithms, 4th ed., §22.1):
 *
 *   BELLMAN-FORD(G, w, s)
 *     INITIALIZE-SINGLE-SOURCE(G, s)        // v.d = ∞, v.π = NIL; s.d = 0
 *     for i = 1 to |G.V| − 1
 *       for each edge (u, v) ∈ G.E
 *         RELAX(u, v, w)                     // if v.d > u.d + w(u, v): v.d = u.d + w(u, v), v.π = u
 *     for each edge (u, v) ∈ G.E
 *       if v.d > u.d + w(u, v)
 *         return FALSE                       // a negative-weight cycle is reachable from s
 *     return TRUE
 *
 * Unlike Dijkstra's algorithm it allows negative weights, so it reads the weights as the
 * switch shows them (unweighted: every edge 1; positive: each weight's magnitude). It
 * follows the graph's direction as chosen: directed, G.E is the arcs; undirected, each
 * edge can be travelled both ways, so it counts as the two edges (u, v) and (v, u) — and
 * a negative undirected edge is then a negative-weight cycle on its own.
 *
 * One step is one edge: one call of RELAX in a pass, or one test in the final check. The
 * edges go in adjacency-list order — each vertex in ascending id, then its (out-)neighbours
 * in ascending id — the order the adjacency list in the side panel shows them. So |V| − 1
 * passes over |E| edges plus the check take (|V| − 1)·|E| + |E| steps; the check stops at
 * the first edge it finds that can still be relaxed (return FALSE).
 *
 * The display shows what the next step will do: its edge is white, and so is that edge's
 * place in the adjacency list (the from vertex, and the to vertex in its row) and in the
 * adjacency matrix (row u, column v). Each vertex shows its d (∞ until an edge reaches
 * it). At the end, when the check passes, the edges (v.π, v) — the shortest-paths tree —
 * are white; when it fails, the edge that failed it stays white.
 */
interface Arc {
  from: NodeId;
  to: NodeId;
  weight: number;
}

type LastStep =
  | { kind: 'relax'; arc: Arc; pass: number; index: number; before: number; after: number }
  | { kind: 'check'; arc: Arc; index: number; ok: boolean };

export class BellmanFordSimulation implements Simulation {
  /** G.E, in the order each pass goes through them. */
  readonly edges: Arc[];
  /** v.d: the shortest-path estimate (Infinity for ∞). */
  readonly distance = new Map<NodeId, number>();
  /** v.π: the predecessor on the shortest path found so far (null for NIL). */
  readonly parent = new Map<NodeId, NodeId | null>();
  /** Passes of RELAX: |V| − 1. */
  readonly passes: number;
  /** Which pass the next step is in (1 … passes), or passes + 1 for the check. */
  private pass = 1;
  /** The next edge's index in `edges`. */
  private index = 0;
  private last: LastStep | null = null;
  /** The check's verdict once it has ended: TRUE (no negative cycle) or FALSE; null before. */
  result: boolean | null = null;

  constructor(
    view: GraphView,
    readonly source: NodeId,
  ) {
    const ids = view.nodeIds();
    for (const id of ids) {
      this.distance.set(id, Infinity);
      this.parent.set(id, null);
    }
    if (this.distance.has(source)) this.distance.set(source, 0);
    this.edges = ids.flatMap((u) => view.neighbors(u).map((v): Arc => ({ from: u, to: v, weight: view.weight(u, v)! })));
    this.passes = Math.max(0, ids.length - 1);
    if (this.edges.length === 0) this.result = true; // nothing to relax or check: return TRUE
  }

  get finished(): boolean {
    return this.result !== null;
  }

  /** Whether the next step is in the final check (rather than a pass of RELAX). */
  get checking(): boolean {
    return this.pass > this.passes;
  }

  /** The edge the next step relaxes or checks (null once finished). */
  get nextEdge(): Arc | null {
    return this.finished ? null : this.edges[this.index];
  }

  /** The shortest-paths tree found so far: (v.π, v) for every v with a predecessor. */
  predecessorEdges(): Array<[NodeId, NodeId]> {
    const edges: Array<[NodeId, NodeId]> = [];
    for (const [v, p] of this.parent) if (p !== null) edges.push([p, v]);
    return edges;
  }

  step(): boolean {
    const arc = this.nextEdge;
    if (!arc) return false;
    const { from: u, to: v, weight } = arc;
    const through = this.distance.get(u)! + weight; // ∞ + w stays ∞
    if (!this.checking) {
      const before = this.distance.get(v)!;
      if (through < before) {
        this.distance.set(v, through); // RELAX
        this.parent.set(v, u);
      }
      this.last = { kind: 'relax', arc, pass: this.pass, index: this.index, before, after: this.distance.get(v)! };
    } else {
      const ok = !(this.distance.get(v)! > through);
      this.last = { kind: 'check', arc, index: this.index, ok };
      if (!ok) {
        this.result = false; // return FALSE
        return true;
      }
    }
    this.index++;
    if (this.index === this.edges.length) {
      this.index = 0;
      if (this.checking) this.result = true; // every edge passed: return TRUE
      this.pass++;
    }
    return true;
  }

  highlight(): Highlight {
    const next = this.nextEdge;
    const failed = this.result === false && this.last ? this.last.arc : null;
    const focus = next ?? failed;
    return {
      current: null,
      done: [],
      // The edge the next step works on; at the end, the shortest-paths tree (or the edge
      // that failed the check).
      activeEdges: focus ? [[focus.from, focus.to]] : this.predecessorEdges(),
      labels: Object.fromEntries([...this.distance].map(([id, d]) => [id, formatDistance(d)])),
      representationEdge: focus ? { from: focus.from, to: focus.to } : undefined,
    };
  }

  describe(): string {
    // Undirected edges too are relaxed one way at a time, so every edge is written u → v.
    const name = (a: Arc) => `${a.from} → ${a.to} (weight ${a.weight})`;
    const m = this.edges.length;
    const next = this.nextEdge;
    const nextText = () => {
      if (!next) return '';
      return this.checking
        ? ` Next: check ${name(next)}${this.index === 0 ? ', the first edge of the final check' : ''}.`
        : ` Next: relax ${name(next)}${this.index === 0 && this.last ? `, starting pass ${this.pass} of ${this.passes}` : ''}.`;
    };
    const last = this.last;
    if (last === null) {
      if (this.finished)
        return `Bellman–Ford from ${this.source}: there are no edges, so nothing to relax; no negative-weight cycle (TRUE). Press Finish.`;
      return (
        `Bellman–Ford from ${this.source}. Every d is ∞ except ${this.source}.d = 0. ` +
        `${this.passes} ${this.passes === 1 ? 'pass' : 'passes'} (|V| − 1) over the ${m} edges, then a check.${nextText()}`
      );
    }
    let done: string;
    if (last.kind === 'relax') {
      const where = `Pass ${last.pass} of ${this.passes}, edge ${last.index + 1} of ${m}:`;
      done =
        last.after < last.before
          ? `${where} relaxed ${name(last.arc)}: ${last.arc.to}.d ${formatDistance(last.before)} → ${last.after}.`
          : `${where} ${name(last.arc)} gives no shorter path to ${last.arc.to}.`;
    } else {
      const where = `Check, edge ${last.index + 1} of ${m}:`;
      done = last.ok
        ? `${where} ${name(last.arc)} cannot lower ${last.arc.to}.d.`
        : `${where} ${name(last.arc)} could still lower ${last.arc.to}.d (${formatDistance(this.distance.get(last.arc.to)!)} > ${formatDistance(this.distance.get(last.arc.from)!)} + ${last.arc.weight}).`;
    }
    if (this.result === true)
      return `${done} Bellman–Ford finished: no negative-weight cycle is reachable from ${this.source} (TRUE), so every d is a shortest-path weight; the white edges (v.π, v) form the shortest-paths tree. Press Finish.`;
    if (this.result === false)
      return `${done} Bellman–Ford finished: a negative-weight cycle is reachable from ${this.source} (FALSE), so some shortest paths are not defined. Press Finish.`;
    return `${done}${nextText()}`;
  }
}

function formatDistance(d: number): string {
  return Number.isFinite(d) ? String(d) : '∞';
}

export const bellmanFord: AlgorithmDefinition = {
  id: 'bellman-ford',
  name: 'Bellman–Ford algorithm',
  // Negative weights are allowed, so any weighting works, as chosen; either direction works.
  requires: {},
  usesWeights: true,
  create: (view, start) => new BellmanFordSimulation(view, start),
};
