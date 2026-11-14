import type { NodeId } from '../graph.js';
import type { GraphView } from '../graph-views.js';
import type { AlgorithmDefinition, ExploredEdge, ForestDiagram, Highlight, Simulation } from './types.js';
import { tidyTree } from './tidy-tree.js';

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
 *
 * Within each pass (and the check), the edges this pass has not reached yet are dashed and
 * those it has relaxed are solid, so a pass starts all dashed and fills in edge by edge.
 * Right after a pass completes, every edge shows solid; the next step starts the next pass.
 * `stepsLeftInPass()` lets the runner play the rest of a pass at once (Full cycle), and
 * `searchTree()` gives the predecessor tree so far for "Show as tree", as for Dijkstra.
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

  /**
   * The edges the current pass (or the check) has gone through, by index in `edges`: all of
   * them right after a pass completes (and at the end, TRUE), up to and including the edge
   * that failed the check (FALSE), and none before the first step.
   */
  visitedThisPass(): Arc[] {
    if (this.last === null) return [];
    if (this.result === false) return this.edges.slice(0, this.index + 1);
    if (this.index === 0) return [...this.edges]; // a pass has just completed
    return this.edges.slice(0, this.index);
  }

  /** Steps left until the current pass (or the check) is through: the Full cycle button's run. */
  stepsLeftInPass(): number {
    return this.finished ? 0 : this.edges.length - this.index;
  }

  /**
   * The predecessor tree G_π so far, as a tidy tree from the source (rows count edges),
   * children in id order. Vertices not in it — d = ∞, or (after a negative-weight cycle)
   * caught in a loop of predecessors — go `aside`. Not highlighted white while running.
   */
  searchTree(): ForestDiagram {
    const places = this.distance.has(this.source) ? tidyTree(this.source, this.parent) : [];
    const placed = new Set(places.map((p) => p.id));
    const aside = [...this.distance.keys()].filter((id) => !placed.has(id));
    // Reached (finite d) but not in the tree: their predecessors loop (CLRS Lemma 22.16).
    const looped = aside.filter((id) => Number.isFinite(this.distance.get(id)!)).length;
    const unreached = aside.length - looped;
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    return {
      places,
      spine: this.predecessorEdges().filter(([u, v]) => placed.has(u) && placed.has(v) && v !== this.source),
      aside,
      asideNote:
        looped === 0
          ? undefined
          : `Waiting on the right: ${unreached ? `${plural(unreached, 'vertex', 'vertices')} not reached yet, and ` : ''}` +
            `${plural(looped, 'vertex', 'vertices')} whose predecessors run round in a loop, which only a negative-weight ` +
            'cycle makes possible (CLRS Lemma 22.16), so they hang from no tree.',
      highlightSpine: false,
      intro:
        'Shortest-paths tree so far: the start is on top, and each vertex hangs from its predecessor v.π, ' +
        'one row below it; each relaxation that lowers a d may move a vertex under a new predecessor.',
    };
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
      // This pass's edges so far solid; the rest dashed.
      exploredEdges: this.visitedThisPass().map(({ from, to }): ExploredEdge => ({ from, to })),
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
