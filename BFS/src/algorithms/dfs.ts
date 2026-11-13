import type { NodeId } from '../graph.js';
import type { GraphView } from '../graph-views.js';
import type {
  AlgorithmDefinition,
  ArcDiagram,
  ExploredEdge,
  ForestDiagram,
  Highlight,
  Simulation,
  StackSnapshot,
  TimestampSnapshot,
} from './types.js';

/**
 * Depth-first search as defined in CLRS (Introduction to Algorithms, 4th ed., §20.3):
 *
 *   DFS(G)                                DFS-VISIT(G, u)
 *     for each vertex u ∈ G.V               time = time + 1        // u discovered
 *       u.color = WHITE; u.π = NIL          u.d = time
 *     time = 0                              u.color = GRAY
 *     for each vertex u ∈ G.V               for each v ∈ G.Adj[u]  // explore (u, v)
 *       if u.color == WHITE                   if v.color == WHITE
 *         DFS-VISIT(G, u)                       v.π = u
 *                                               DFS-VISIT(G, v)
 *                                           time = time + 1
 *                                           u.f = time; u.color = BLACK   // u finished
 *
 * Like the book, it searches the whole graph: once a tree is done, the next white vertex
 * starts a new one, so every vertex gets a discovery time d and a finish time f. The
 * outer loop takes `start` first and then the other vertices in ascending id order;
 * adjacency lists are in ascending id order too (views return them sorted).
 *
 * Every explored edge (u, v) is classified by the colour of v when it is explored
 * (§20.3, "Classification of edges"):
 *   tree    — v is WHITE (the search goes on into v);
 *   back    — v is GRAY: an ancestor of u still on the recursion stack;
 *   forward — v is BLACK and u.d < v.d: a descendant of u, already finished;
 *   cross   — v is BLACK and u.d > v.d: finished earlier, in another branch or tree.
 * In an undirected view each edge is classified once, the first time either end
 * explores it (so only tree and back edges occur, Theorem 20.10).
 *
 * One step is one of:
 *   - discover the next root (outer loop): push it on the recursion stack;
 *   - explore the next edge (u, v) of the vertex on top of the stack — for a tree edge
 *     this also discovers v and pushes it;
 *   - finish the top vertex, which has no edges left: pop it.
 *
 * The display shows what the next step will do: white is the vertex it works on (the
 * top of the stack, or the next root) and the edge it will explore. Gray vertices are
 * yellow and black ones green. Vertices are labelled "d," while running and "d,f" once
 * finished; undiscovered ones are blank.
 *
 * Once finished, `topologicalSort()` gives TOPOLOGICAL-SORT (CLRS §20.4): the vertices by
 * decreasing finish time — available only when no back edge was found, which by
 * Lemma 20.11 is exactly when the directed graph is acyclic. `searchForest()` gives the
 * depth-first forest G_π (§20.3) — the vertices joined by the tree edges — drawn as trees
 * the way the timestamp chart nests their intervals, at any point of the search.
 */

type Color = 'white' | 'gray' | 'black';

export type EdgeClass = 'tree' | 'back' | 'forward' | 'cross';

/** How each class is tagged on the canvas (tree edges are left plain). */
export const EDGE_CLASS_LABELS: Readonly<Record<EdgeClass, string | undefined>> = {
  tree: undefined,
  back: 'backward',
  forward: 'forward',
  cross: 'crossed',
};

export interface ClassifiedEdge {
  from: NodeId;
  to: NodeId;
  kind: EdgeClass;
}

/** A DFS-VISIT call in progress: its vertex and how far it has got through Adj[u]. */
interface Frame {
  id: NodeId;
  adj: NodeId[];
  next: number;
}

type Action =
  | { type: 'root'; v: NodeId }
  | { type: 'edge'; u: NodeId; v: NodeId }
  | { type: 'finish'; u: NodeId };

type Done =
  | { type: 'root'; v: NodeId }
  | { type: 'edge'; edge: ClassifiedEdge }
  | { type: 'finish'; u: NodeId };

export class DfsSimulation implements Simulation {
  private readonly color = new Map<NodeId, Color>();
  /** The recursion stack, bottom first. */
  private readonly stack: Frame[] = [];
  /** The outer loop's order: `start`, then every other vertex ascending. */
  private readonly roots: NodeId[];
  private rootIndex = 0;
  private time = 0;
  private last: Done | null = null;
  /** Edge keys already classified (undirected views explore each edge once). */
  private readonly seen = new Set<string>();

  /** u.d: when each vertex was discovered. */
  readonly discovery = new Map<NodeId, number>();
  /** u.f: when each vertex was finished. */
  readonly finish = new Map<NodeId, number>();
  /** u.π: the depth-first forest (roots → null). */
  readonly parent = new Map<NodeId, NodeId | null>();
  /** Every explored edge with its class, in the order explored. */
  readonly edges: ClassifiedEdge[] = [];
  /** Tree roots, in the order they were started. */
  readonly trees: NodeId[] = [];
  /** Depth of each discovered vertex in the depth-first forest (roots 0). */
  readonly depth = new Map<NodeId, number>();

  constructor(
    private readonly view: GraphView,
    readonly start: NodeId,
  ) {
    const ids = view.nodeIds();
    for (const id of ids) this.color.set(id, 'white');
    this.roots = ids.includes(start) ? [start, ...ids.filter((id) => id !== start)] : ids;
  }

  get finished(): boolean {
    return this.nextAction() === null;
  }

  /** The recursion stack, top first. */
  get stacked(): NodeId[] {
    return this.stack.map((f) => f.id).reverse();
  }

  /** The current time (the last d or f handed out). */
  get clock(): number {
    return this.time;
  }

  colorOf(id: NodeId): Color | undefined {
    return this.color.get(id);
  }

  step(): boolean {
    const action = this.nextAction();
    if (!action) return false;
    if (action.type === 'root') {
      this.rootIndex++;
      this.trees.push(action.v);
      this.parent.set(action.v, null);
      this.discover(action.v);
      this.last = { type: 'root', v: action.v };
    } else if (action.type === 'edge') {
      const { u, v } = action;
      this.top!.next++;
      this.seen.add(this.edgeKey(u, v));
      const kind = this.classify(u, v);
      const edge = { from: u, to: v, kind };
      this.edges.push(edge);
      if (kind === 'tree') {
        this.parent.set(v, u);
        this.discover(v);
      }
      this.last = { type: 'edge', edge };
    } else {
      this.stack.pop();
      this.time++;
      this.finish.set(action.u, this.time);
      this.color.set(action.u, 'black');
      this.last = { type: 'finish', u: action.u };
    }
    return true;
  }

  highlight(): Highlight {
    const action = this.nextAction();
    const labels: Record<NodeId, string> = {};
    for (const [id, d] of this.discovery) labels[id] = `${d},${this.finish.get(id) ?? ''}`;
    return {
      current: action === null ? null : action.type === 'root' ? action.v : action.u,
      done: [...this.finish.keys()],
      running: this.stack.map((f) => f.id),
      activeEdges: action?.type === 'edge' ? [[action.u, action.v]] : [],
      labels,
      exploredEdges: this.edges.map(
        ({ from, to, kind }): ExploredEdge => ({ from, to, label: EDGE_CLASS_LABELS[kind] }),
      ),
    };
  }

  /** Whether a back edge has been found (in a directed graph: it has a cycle). */
  get hasCycle(): boolean {
    return this.edges.some((e) => e.kind === 'back');
  }

  /**
   * CLRS TOPOLOGICAL-SORT: once DFS is finished and found no back edge, the vertices by
   * decreasing finish time (each finished vertex goes to the front of the list), with
   * the tree edges as the white spine and cross edges arcing below. Otherwise null.
   */
  topologicalSort(): ArcDiagram | null {
    if (!this.finished || this.hasCycle || !this.view.directed) return null;
    const pairs = (kind: EdgeClass) =>
      this.edges.filter((e) => e.kind === kind).map((e): [NodeId, NodeId] => [e.from, e.to]);
    return {
      order: [...this.finish.keys()].sort((a, b) => this.finish.get(b)! - this.finish.get(a)!),
      spine: pairs('tree'),
      below: pairs('cross'),
    };
  }

  /**
   * The depth-first forest G_π found so far (CLRS §20.3: the discovered vertices and the
   * tree edges (v.π, v)), laid out as on the timestamp chart: each vertex on the row of
   * its depth, above the middle of its interval [d, f] — for a vertex still running,
   * [d, now], as its bar on the chart runs up to the current time. Vertices not
   * discovered yet go `aside`. Tree edges are highlighted white only once DFS has
   * finished (until then white is the next step's).
   */
  searchForest(): ForestDiagram {
    return {
      places: [...this.discovery].map(([id, d]) => ({
        id,
        column: (d + (this.finish.get(id) ?? this.time)) / 2,
        row: this.depth.get(id)!,
      })),
      spine: this.edges.filter((e) => e.kind === 'tree').map((e): [NodeId, NodeId] => [e.from, e.to]),
      aside: this.view.nodeIds().filter((id) => !this.discovery.has(id)),
      highlightSpine: this.finished,
    };
  }

  /**
   * Each discovered vertex's interval [d, f] (f null while running), on the row of its
   * depth in the forest — so, by the parenthesis theorem, a descendant's interval sits
   * below and inside its ancestor's — plus the clock.
   */
  timestamps(): TimestampSnapshot {
    const action = this.nextAction();
    const current = action === null ? null : action.type === 'root' ? action.v : action.u;
    return {
      clock: this.time,
      end: 2 * this.color.size,
      intervals: [...this.discovery].map(([id, start]) => ({
        id,
        start,
        finish: this.finish.get(id) ?? null,
        depth: this.depth.get(id)!,
      })),
      current: current !== null && this.discovery.has(current) ? current : null,
    };
  }

  stackSnapshot(): StackSnapshot {
    const action = this.nextAction();
    let incoming: NodeId[] = [];
    if (action?.type === 'root') incoming = [action.v];
    else if (action?.type === 'edge' && this.color.get(action.v) === 'white') incoming = [action.v];
    return { items: this.stacked, incoming, popping: action?.type === 'finish' };
  }

  describe(): string {
    const stack = `Stack: ${this.stack.length ? `${this.stacked.join(', ')} (top first)` : 'empty'}.`;
    const last = this.last;
    if (last === null) return `DFS from ${this.start}. Time 0. Press Update to discover ${this.start}.`;
    if (this.finished) {
      const count = (kind: EdgeClass) => this.edges.filter((e) => e.kind === kind).length;
      const n = this.discovery.size;
      const trees = this.trees.length;
      return (
        `DFS finished at time ${this.time}: ${n} ${n === 1 ? 'vertex' : 'vertices'} in ` +
        `${trees} ${trees === 1 ? 'tree' : 'trees'}; ${count('tree')} tree, ${count('back')} backward, ` +
        `${count('forward')} forward, ${count('cross')} crossed edges. ` +
        (this.hasCycle
          ? 'A backward edge means a cycle, so there is no topological order. Press Show as forest, or Finish.'
          : 'No backward edge, so the graph is acyclic: press Topological sort, Show as forest, or Finish.')
      );
    }
    switch (last.type) {
      case 'root': {
        const first = this.trees.length === 1;
        return `${first ? 'Discovered' : 'New tree: discovered'} ${last.v} at time ${this.discovery.get(last.v)}. ${stack}`;
      }
      case 'finish':
        return `Finished ${last.u} at time ${this.finish.get(last.u)}. ${stack}`;
      case 'edge': {
        const { from: u, to: v, kind } = last.edge;
        const edge = `${u} ${this.view.directed ? '→' : '—'} ${v}`;
        const why = {
          tree: `discovered ${v} at time ${this.discovery.get(v)}`,
          back: `${v} is still running (an ancestor of ${u})`,
          forward: `${v} already finished, a descendant of ${u}`,
          cross: `${v} already finished, not a descendant of ${u}`,
        }[kind];
        const name = kind === 'tree' ? 'tree' : EDGE_CLASS_LABELS[kind];
        return `${edge} is a ${name} edge: ${why}. ${stack}`;
      }
    }
  }

  private get top(): Frame | undefined {
    return this.stack[this.stack.length - 1];
  }

  /** DFS-VISIT's first lines: time stamp, colour gray, push. */
  private discover(v: NodeId): void {
    const parent = this.parent.get(v) ?? null;
    this.depth.set(v, parent === null ? 0 : this.depth.get(parent)! + 1);
    this.time++;
    this.discovery.set(v, this.time);
    this.color.set(v, 'gray');
    this.stack.push({ id: v, adj: this.view.neighbors(v), next: 0 });
  }

  private classify(u: NodeId, v: NodeId): EdgeClass {
    const c = this.color.get(v);
    if (c === 'white') return 'tree';
    if (c === 'gray') return 'back';
    return this.discovery.get(u)! < this.discovery.get(v)! ? 'forward' : 'cross';
  }

  private edgeKey(u: NodeId, v: NodeId): string {
    return this.view.directed ? `${u}>${v}` : `${Math.min(u, v)}-${Math.max(u, v)}`;
  }

  /**
   * What the next step will do, or null when the search is over. Skips (without
   * counting a step) edges an undirected search has already explored from the other end,
   * and outer-loop vertices that are no longer white.
   */
  private nextAction(): Action | null {
    const top = this.top;
    if (top) {
      while (top.next < top.adj.length && this.seen.has(this.edgeKey(top.id, top.adj[top.next]))) top.next++;
      if (top.next < top.adj.length) return { type: 'edge', u: top.id, v: top.adj[top.next] };
      return { type: 'finish', u: top.id };
    }
    while (this.rootIndex < this.roots.length && this.color.get(this.roots[this.rootIndex]) !== 'white') this.rootIndex++;
    return this.rootIndex < this.roots.length ? { type: 'root', v: this.roots[this.rootIndex] } : null;
  }
}

export const dfs: AlgorithmDefinition = {
  id: 'dfs',
  name: 'Depth-first search',
  // Edge classes (tree / back / forward / cross) are defined for directed graphs, and DFS
  // ignores weights.
  requires: { weighted: false, directed: true },
  create: (view, start) => new DfsSimulation(view, start),
};
