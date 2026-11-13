import type { NodeId } from '../graph.js';
import type { GraphView } from '../graph-views.js';

/**
 * Shared shape of every step-by-step algorithm simulation (BFS now; DFS, Dijkstra, …
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
   * Edges the next step will travel (drawn white), as [from, to] in the view's
   * orientation. In an undirected view [a, b] and [b, a] mean the same edge.
   */
  activeEdges: Array<[NodeId, NodeId]>;
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
}

/** An entry in the algorithm picker. */
export interface AlgorithmDefinition {
  /** Stable id, used as the <option> value. */
  id: string;
  /** Name shown in the picker. */
  name: string;
  /**
   * How the graph must be read while the algorithm runs. The UI locks the matching
   * switch for the duration (e.g. BFS forces the unweighted view).
   */
  requires: { weighted?: boolean };
  /** Creates a simulation over `view`, starting from `start`. */
  create(view: GraphView, start: NodeId): Simulation;
}
