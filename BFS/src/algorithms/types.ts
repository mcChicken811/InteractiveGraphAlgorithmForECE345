import type { NodeId } from '../graph.js';
import type { GraphView } from '../graph-views.js';

/**
 * Shared shape of every step-by-step algorithm simulation (BFS, DFS, Prim, Kruskal;
 * Dijkstra, … later). A simulation is pure: it reads the graph only through a read-only GraphView and
 * keeps its own state, so it can be unit-tested without any DOM.
 */

/** What the canvas should highlight after a step. */
export interface Highlight {
  /** The vertex the next step will process (drawn with a white stroke), if any. */
  current: NodeId | null;
  /** Vertices the algorithm has finished with (drawn with a green stroke). */
  done: NodeId[];
  /**
   * Vertices the algorithm has started but not finished (DFS: the gray vertices on the
   * recursion stack), drawn with a yellow stroke. `current` takes precedence.
   */
  running?: NodeId[];
  /**
   * Edges the next step will travel (drawn white), as [from, to] in the view's
   * orientation. In an undirected view [a, b] and [b, a] mean the same edge.
   */
  activeEdges: Array<[NodeId, NodeId]>;
  /**
   * Optional per-vertex labels drawn inside the vertices instead of their ids while the
   * algorithm runs (BFS: the shortest-path length found so far). When given, vertices
   * without an entry show no number. Hovering the queue strip shows the ids again.
   */
  labels?: Record<NodeId, string>;
  /**
   * When given, the algorithm tracks which edges it has explored: edges listed here are
   * drawn solid, with their label (DFS: the edge's class) if any; every other edge is
   * drawn dashed. Same orientation rules as `activeEdges`.
   */
  exploredEdges?: ExploredEdge[];
  /**
   * Draw the vertices compact (Prim): shrunk to half size, filled with what would be their
   * ring colour, and with no number inside. Hovering a strip or panel that shows numbers
   * or labels expands them back to show those (see GraphEditor.setPeek).
   */
  compact?: boolean;
  /**
   * One side S of a cut (S, V − S) (Prim: the tree's vertices). The canvas shades S's
   * territory — the part of the canvas nearer to a vertex of S than to any other vertex
   * (its Voronoi cells) — and draws the border with V − S's territory, which exists even
   * when no edge crosses the cut. When the cut changes, the border moves continuously to
   * its new place. Left out, nothing is drawn; with every vertex in S, the territory floods
   * the canvas and fades out.
   */
  cut?: NodeId[];
  /**
   * Draw the cut's border from the non-crossing edges alone, leaving the vertices out
   * (Kruskal). While either side has no edge of its own (S a lone vertex, at first) there
   * is no border, and no territory, until S takes every vertex and floods the canvas.
   */
  cutEdgesOnly?: boolean;
  /**
   * S split into groups (Kruskal: its trees), each with a territory of its own: all are
   * shaded alike, with borders between them as well as with V − S's territory. An edge
   * joining two groups crosses a border, as one crossing the cut does. Left out, S is
   * one group.
   */
  cutGroups?: NodeId[][];
}

export interface ExploredEdge {
  from: NodeId;
  to: NodeId;
  /** Short tag drawn on the edge, e.g. "backward". */
  label?: string;
  /** Draw the edge in the finished (green) colour, like a finished vertex (Prim: a tree edge). */
  done?: boolean;
  /**
   * Draw the edge solid grey: it crosses the algorithm's cut (Prim: one end in the tree,
   * the other still in the queue). The white `activeEdges` entry may be one of these.
   */
  crossing?: boolean;
  /**
   * Draw the edge dashed in the finished (green) colour: both ends are finished, but the
   * edge is not part of the result (Prim: an edge between two tree vertices that is not a
   * tree edge).
   */
  within?: boolean;
}

/** A queue-like structure for the side panel (BFS's queue). */
export interface QueueSnapshot {
  /** Vertices in the queue, front (next to be popped) first. */
  items: NodeId[];
  /** Vertices the next step will push onto the back, in push order. */
  incoming: NodeId[];
}

/** A recursion stack for the side panel (DFS). */
export interface StackSnapshot {
  /** Vertices on the stack, top (the vertex being worked on) first. */
  items: NodeId[];
  /** Vertices the next step will push on top, in push order. */
  incoming: NodeId[];
  /** Whether the next step pops the top vertex. */
  popping: boolean;
}

/**
 * A left-to-right arrangement of the vertices with its edges drawn as an arc diagram
 * (DFS's topological sort). Edges are expected to run left to right, except `backward` ones.
 */
export interface ArcDiagram {
  /** The vertices, left to right (wrapping into rows when they don't fit). */
  order: NodeId[];
  /**
   * Edges highlighted white (DFS: tree edges). Between neighbouring vertices they lie
   * on the centre line; longer ones arc like the others.
   */
  spine: Array<[NodeId, NodeId]>;
  /** Edges that arc below the line (DFS: cross edges); all other edges arc above. */
  below: Array<[NodeId, NodeId]>;
  /**
   * Edges running right to left (DFS on a cyclic graph: back edges, each closing a cycle):
   * drawn red, arcing below the line.
   */
  backward?: Array<[NodeId, NodeId]>;
}

/**
 * The search forest drawn as trees (DFS's "Show as forest"), laid out like the timestamp
 * chart: each vertex on the row of its depth (roots at the top), and across, above the
 * middle of its [d, f] interval on the time axis. By the parenthesis theorem a vertex's
 * descendants then sit below it, within its interval, and siblings and trees go left to
 * right in discovery order.
 */
export interface ForestDiagram {
  /** Each vertex's place: `column` in time units ((d + f) / 2), `row` its depth. */
  places: Array<{ id: NodeId; column: number; row: number }>;
  /** Tree edges: straight, from parent down to child, highlighted white. All other edges curve. */
  spine: Array<[NodeId, NodeId]>;
  /**
   * Vertices that are not in the forest (BFS: not reached yet), grouped on the right,
   * with the forest to their left.
   */
  aside?: NodeId[];
  /** Whether the tree edges are highlighted white (default true; BFS keeps white for the next step). */
  highlightSpine?: boolean;
}

/** One vertex's [discovery, finish] interval on a timestamp chart (DFS). */
export interface TimestampInterval {
  id: NodeId;
  /** Discovery time d. */
  start: number;
  /** Finish time f, or null while the vertex is still running. */
  finish: number | null;
  /** Depth in the search forest (roots 0): the chart's row, so nested intervals stack downwards. */
  depth: number;
}

/** The timestamp chart for the side panel (DFS): every interval so far, and the clock. */
export interface TimestampSnapshot {
  /** The current time (the last timestamp handed out; 0 before the first). */
  clock: number;
  /** The last time the search will reach (2 × the number of vertices): the axis length. */
  end: number;
  /** Discovered vertices, in discovery order. */
  intervals: TimestampInterval[];
  /** The vertex the next step works on (drawn white), if it has an interval yet. */
  current: NodeId | null;
}

/** An undirected edge with its weight, as [smaller id, larger id]. */
export interface WeightedPair {
  from: NodeId;
  to: NodeId;
  weight: number;
}

/** A list of edges waiting their turn, for the side panel (Kruskal's sorted edges). */
export interface EdgeQueueSnapshot {
  /** The edges still to come, the next one first. */
  items: WeightedPair[];
  /** The edge the latest step took off the front, and whether it was added (kept) or skipped. */
  last: (WeightedPair & { added: boolean }) | null;
}

export interface Simulation {
  /** True once the last step has been taken; `step()` then does nothing. */
  readonly finished: boolean;
  /** Advances one step. Returns false if already finished. */
  step(): boolean;
  /** Current highlight for the canvas. */
  highlight(): Highlight;
  /** One-line, human-readable description of the latest step (for the status message). */
  describe(): string;
  /** The algorithm's queue, if it has one; shown in the side panel while running. */
  queueSnapshot?(): QueueSnapshot;
  /**
   * The algorithm's min-priority queue, if it has one (Prim): `items` in extraction order,
   * smallest key first; shown in the side panel while running.
   */
  priorityQueueSnapshot?(): QueueSnapshot;
  /** The algorithm's list of edges in processing order, if it has one (Kruskal). */
  edgeQueueSnapshot?(): EdgeQueueSnapshot;
  /** The algorithm's recursion stack, if it has one; shown in the side panel while running. */
  stackSnapshot?(): StackSnapshot;
  /** The algorithm's timestamps, if it keeps them; shown as a chart in the side panel while running. */
  timestamps?(): TimestampSnapshot;
  /**
   * Offered once finished (DFS): the vertices in topological order, as an arc diagram
   * (on a cyclic graph, the same line-up, with the edges that close cycles `backward`),
   * or null when there is none to show yet. Algorithms without a topological sort leave
   * it out, and the button stays hidden.
   */
  topologicalSort?(): ArcDiagram | null;
  /**
   * Offered while running (DFS): the depth-first forest so far, laid out as on the
   * timestamp chart, with the vertices not discovered yet `aside`. Algorithms without
   * one leave it out, and the Show as forest button stays hidden.
   */
  searchForest?(): ForestDiagram;
  /**
   * Offered while running (BFS): the search tree so far, as a ForestDiagram (rows by
   * distance), with the vertices not reached yet `aside`. Algorithms without one leave it
   * out, and the Show as tree button stays hidden.
   */
  searchTree?(): ForestDiagram;
}

/** An entry in the algorithm picker. */
export interface AlgorithmDefinition {
  /** Stable id, used as the <option> value. */
  id: string;
  /** Name shown in the picker. */
  name: string;
  /**
   * How the graph must be read while the algorithm runs. The UI forces and locks the
   * matching switches for the duration (e.g. BFS forces the unweighted view; DFS forces
   * the unweighted, directed view; Prim forces the undirected view).
   */
  requires: { weighted?: boolean; directed?: boolean };
  /**
   * The algorithm reads edge weights but accepts either weighting (Prim): the
   * Unweighted / Weighted switch is not forced, only locked at the user's choice for the
   * run, since switching part-way would change the weights under the algorithm.
   * Unweighted views report every edge as weight 1.
   */
  usesWeights?: boolean;
  /** Creates a simulation over `view`, starting from `start`. */
  create(view: GraphView, start: NodeId): Simulation;
}
