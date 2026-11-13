import type { NodeId } from '../graph.js';
import type { GraphView } from '../graph-views.js';
import type { AlgorithmDefinition, Highlight, Simulation } from './types.js';

/**
 * Breadth-first search from a single source, one vertex per step.
 *
 * Each step:
 *  1. the vertex processed in the previous step (if any) is finished → shown green;
 *  2. the next vertex is taken from the front of the queue and becomes current → shown
 *     white, together with the edges BFS explores from it (its neighbours in the view:
 *     all incident edges when undirected, out-edges when directed);
 *  3. its not-yet-discovered neighbours are discovered and appended to the queue, in
 *     ascending id order (the views return sorted neighbours, so runs are deterministic).
 *
 * The step after the last vertex only finishes it; the simulation is then `finished`.
 * Vertices not reachable from the source are never discovered.
 */
export class BfsSimulation implements Simulation {
  private readonly queue: NodeId[];
  private readonly discovered: Set<NodeId>;
  private readonly finishedSet = new Set<NodeId>();
  private current: NodeId | null = null;
  private lastDiscovered: NodeId[] = [];
  private steps = 0;

  /** Visit order so far. */
  readonly order: NodeId[] = [];
  /** BFS tree: discovered vertex → the vertex it was discovered from (source → null). */
  readonly parent = new Map<NodeId, NodeId | null>();
  /** Edges (number of hops) from the source to each discovered vertex. */
  readonly distance = new Map<NodeId, number>();

  constructor(
    private readonly view: GraphView,
    readonly source: NodeId,
  ) {
    this.queue = [source];
    this.discovered = new Set([source]);
    this.parent.set(source, null);
    this.distance.set(source, 0);
  }

  get finished(): boolean {
    return this.current === null && this.queue.length === 0 && this.steps > 0;
  }

  step(): boolean {
    if (this.finished) return false;
    this.steps++;
    if (this.current !== null) this.finishedSet.add(this.current);

    this.current = this.queue.shift() ?? null;
    this.lastDiscovered = [];
    if (this.current !== null) {
      this.order.push(this.current);
      for (const w of this.view.neighbors(this.current)) {
        if (this.discovered.has(w)) continue;
        this.discovered.add(w);
        this.parent.set(w, this.current);
        this.distance.set(w, this.distance.get(this.current)! + 1);
        this.queue.push(w);
        this.lastDiscovered.push(w);
      }
    }
    return true;
  }

  highlight(): Highlight {
    const current = this.current;
    return {
      current,
      done: [...this.finishedSet],
      activeEdges: current === null ? [] : this.view.neighbors(current).map((w) => [current, w] as [NodeId, NodeId]),
    };
  }

  /** Vertices waiting in the queue, front first. */
  get queued(): NodeId[] {
    return [...this.queue];
  }

  describe(): string {
    if (this.steps === 0) return `BFS from ${this.source}: press Update to take the first step.`;
    if (this.finished) {
      const total = this.view.nodeIds().length;
      const reached = this.order.length;
      const unreachable = total - reached;
      return (
        `BFS finished: visited ${reached} of ${total} vertices (order ${this.order.join(', ')}).` +
        (unreachable ? ` ${unreachable} not reachable from ${this.source}.` : '') +
        ' Press Finish.'
      );
    }
    const found = this.lastDiscovered.length ? `discovered ${this.lastDiscovered.join(', ')}` : 'nothing new';
    const queue = this.queue.length ? this.queue.join(', ') : 'empty';
    return `Visiting ${this.current}: ${found}. Queue: ${queue}.`;
  }
}

export const bfs: AlgorithmDefinition = {
  id: 'bfs',
  name: 'Breadth-first search',
  // BFS ignores weights (every edge counts as one hop), so it runs on the unweighted view.
  requires: { weighted: false },
  create: (view, start) => new BfsSimulation(view, start),
};
