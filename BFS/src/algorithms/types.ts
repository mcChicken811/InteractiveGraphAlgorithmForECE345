import type { NodeId } from '../graph.js';
import type { GraphView } from '../graph-views.js';

/**
 * Shared shape of every step-by-step algorithm simulation (BFS, DFS; Dijkstra, …
 * later). A simulation is pure: it reads the graph only through a read-only GraphView and
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
}

export interface ExploredEdge {
  from: NodeId;
  to: NodeId;
  /** Short tag drawn on the edge, e.g. "backward". */
  label?: string;
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
  /** The algorithm's recursion stack, if it has one; shown in the side panel while running. */
  stackSnapshot?(): StackSnapshot;
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
   * the unweighted, directed view).
   */
  requires: { weighted?: boolean; directed?: boolean };
  /** Creates a simulation over `view`, starting from `start`. */
  create(view: GraphView, start: NodeId): Simulation;
}
