import type { NodeId } from '../graph.js';
import type { GraphView } from '../graph-views.js';
import type { AlgorithmDefinition, ForestDiagram, Highlight, QueueSnapshot, Simulation } from './types.js';
import { tidyTree } from './tidy-tree.js';

/**
 * Breadth-first search from a single source, one queue pop per step.
 *
 * The display always shows what the *next* step will do:
 *  - white: the vertex at the front of the queue (popped next step), and the edges that
 *    step will travel — from it to its not-yet-discovered neighbours;
 *  - green: vertices already popped (finished);
 *  - solid edges: the predecessor edges (v.π, v) of the vertices discovered so far — the
 *    breadth-first tree G_π (CLRS §20.2), each drawn as soon as v is discovered. Every
 *    other edge is dashed.
 *
 * Each step pops the front vertex (it turns green), then discovers its undiscovered
 * neighbours and appends them to the queue in ascending id order (views return sorted
 * neighbours, so runs are deterministic). The new front vertex turns white.
 *
 * Vertices are labelled with their shortest-path length from the source as soon as they
 * are discovered (BFS discovers every vertex at its final distance).
 *
 * `searchTree()` gives the breadth-first tree found so far, for "Show as tree": each
 * vertex on the row of its distance, laid out as a tidy tree (children left to right in
 * discovery order, each parent centred over its children), and the vertices not reached
 * yet set aside.
 *
 * Right after creation the source is the only vertex in the queue, so it is already
 * white. A source with n reachable vertices finishes after exactly n steps; vertices not
 * reachable from it are never discovered.
 */
export class BfsSimulation implements Simulation {
  private readonly queue: NodeId[];
  /** Vertices that have been put in the queue (including those already popped). */
  private readonly discovered: Set<NodeId>;
  /** Vertices that have been popped. */
  private readonly popped = new Set<NodeId>();
  private lastPopped: NodeId | null = null;
  private lastDiscovered: NodeId[] = [];

  /** Pop order so far. */
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

  /** True once the queue is empty: every reachable vertex has been popped. */
  get finished(): boolean {
    return this.queue.length === 0;
  }

  /** The vertices in the queue, front (next to be popped) first. */
  get queued(): NodeId[] {
    return [...this.queue];
  }

  step(): boolean {
    const v = this.queue.shift();
    if (v === undefined) return false;
    this.popped.add(v);
    this.order.push(v);
    this.lastPopped = v;
    this.lastDiscovered = [];
    for (const w of this.view.neighbors(v)) {
      if (this.discovered.has(w)) continue;
      this.discovered.add(w);
      this.parent.set(w, v);
      this.distance.set(w, this.distance.get(v)! + 1);
      this.queue.push(w);
      this.lastDiscovered.push(w);
    }
    return true;
  }

  /** Undiscovered neighbours of the front vertex: what the next step will push, in order. */
  private incoming(): NodeId[] {
    const next = this.queue[0];
    return next === undefined ? [] : this.view.neighbors(next).filter((w) => !this.discovered.has(w));
  }

  highlight(): Highlight {
    const next = this.queue[0] ?? null;
    return {
      current: next,
      done: [...this.popped],
      activeEdges: next === null ? [] : this.incoming().map((w) => [next, w] as [NodeId, NodeId]),
      // Shortest-path length (in edges) from the source, known from the moment a vertex is
      // discovered; undiscovered vertices get no label.
      labels: Object.fromEntries([...this.distance].map(([id, d]) => [id, String(d)])),
      // Only the predecessor edges (v.π, v) are solid; the editor dashes the rest.
      exploredEdges: [...this.parent]
        .filter((entry): entry is [NodeId, NodeId] => entry[1] !== null)
        .map(([v, u]) => ({ from: u, to: v })),
    };
  }

  /**
   * The breadth-first tree G_π so far (CLRS §20.2), as a tidy tree: rows by distance from
   * the source; leaves two column units apart, in the order a depth-first walk of the tree
   * meets them (children in discovery order); each parent centred over its first and last
   * child. Undiscovered vertices go `aside`. Tree edges are not highlighted white (white
   * is the next step's), but are straight; every other edge curves.
   */
  searchTree(): ForestDiagram {
    return {
      // A vertex's depth in G_π is its distance from the source.
      places: tidyTree(this.source, this.parent),
      spine: [...this.parent]
        .filter((entry): entry is [NodeId, NodeId] => entry[1] !== null)
        .map(([v, u]): [NodeId, NodeId] => [u, v]),
      aside: this.view.nodeIds().filter((id) => !this.discovered.has(id)),
      highlightSpine: false,
      intro:
        'Breadth-first tree so far: each row is a distance from the start, which is on top; each vertex hangs ' +
        'from the vertex it was discovered from.',
    };
  }

  queueSnapshot(): QueueSnapshot {
    return { items: [...this.queue], incoming: this.incoming() };
  }

  describe(): string {
    const queue = `Queue: ${this.queue.length ? this.queue.join(', ') : 'empty'}.`;
    if (this.lastPopped === null) return `BFS from ${this.source}. ${queue} Press Update to pop ${this.source}.`;
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
    return `Popped ${this.lastPopped}: ${found}. ${queue}`;
  }
}

export const bfs: AlgorithmDefinition = {
  id: 'bfs',
  name: 'Breadth-first search',
  // BFS ignores weights (every edge counts as one hop), so it runs on the unweighted view.
  requires: { weighted: false },
  create: (view, start) => new BfsSimulation(view, start),
};
