import { beforeEach, describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import { DagShortestPathsSimulation, dagShortestPaths } from '../src/algorithms/dag-shortest-paths.js';
import { BellmanFordSimulation } from '../src/algorithms/bellman-ford.js';
import { DfsSimulation } from '../src/algorithms/dfs.js';
import { ALGORITHMS } from '../src/algorithms/index.js';

/**
 * CLRS Figure 22.5 (4th ed.), with r, s, t, x, y, z as 0 … 5:
 *   r→s 5, r→t 3, s→t 2, s→x 6, t→x 7, t→y 4, t→z 2, x→y −1, x→z 1, y→z −2.
 * DFS from s gives the book's topological order r, s, t, x, y, z.
 * From s: d = r ∞, s 0, t 2, x 6, y 5, z 3; π: t ← s, x ← s, y ← x, z ← y.
 */
const [r, s, t, x, y, z] = [0, 1, 2, 3, 4, 5];
const ARCS: Array<[number, number, number]> = [
  [r, s, 5],
  [r, t, 3],
  [s, t, 2],
  [s, x, 6],
  [t, x, 7],
  [t, y, 4],
  [t, z, 2],
  [x, y, -1],
  [x, z, 1],
  [y, z, -2],
];

let g: Graph;
beforeEach(() => {
  g = new Graph();
  for (let i = 0; i < 6; i++) g.addNode(i * 10, 0);
  g.directed = true;
  for (const [a, b, w] of ARCS) g.addEdge(a, b, w);
});

const view = (graph: Graph) => graph.view('directed', 'weighted');
function runToEnd(sim: { step(): boolean }): number {
  let steps = 0;
  while (sim.step()) steps++;
  return steps;
}

describe('DAG shortest paths registry entry', () => {
  it('is offered last, and forces the weighted, directed view', () => {
    expect(ALGORITHMS.at(-1)).toBe(dagShortestPaths);
    expect(dagShortestPaths.name).toBe('DAG shortest paths');
    expect(dagShortestPaths.requires).toEqual({ weighting: 'weighted', directed: true });
    expect(dagShortestPaths.create(view(g), s)).toBeInstanceOf(DagShortestPathsSimulation);
  });
});

describe('DagShortestPathsSimulation on CLRS Figure 22.5', () => {
  let sim: DagShortestPathsSimulation;
  beforeEach(() => {
    sim = new DagShortestPathsSimulation(view(g), s);
  });

  it('takes the vertices in topological order (DFS from s, by decreasing finish time)', () => {
    expect(sim.cycleEdge).toBeNull();
    expect(sim.order).toEqual([r, s, t, x, y, z]);
    expect(sim.topologicalSort()).toMatchObject({ order: [r, s, t, x, y, z], spine: [] });
  });

  it('starts at the first vertex in that order: white, with the edges it will relax', () => {
    expect(sim.highlight()).toEqual({
      current: r,
      done: [],
      activeEdges: [
        [r, s],
        [r, t],
      ],
      labels: { 0: '∞', 1: '0', 2: '∞', 3: '∞', 4: '∞', 5: '∞' },
    });
    expect(sim.describe()).toBe(
      'DAG shortest paths from 1, taking the vertices in topological order: 0, 1, 2, 3, 4, 5. Every d is ∞ except 1.d = 0. ' +
        'Next: 0 (d = ∞: not reachable from 1, so relaxing its edges changes nothing).',
    );
  });

  it('each step takes one vertex (it turns green) and relaxes every edge out of it', () => {
    sim.step(); // r: d = ∞, nothing changes
    expect(sim.describe()).toBe('Took 0 (d = ∞). No shorter path to 1, 2. Next: 1 (d = 0), relaxing the edges out of it.');
    expect(sim.highlight()).toMatchObject({ current: s, done: [r] });
    sim.step(); // s: t 2, x 6
    expect(sim.describe()).toBe('Took 1 (d = 0). Relaxed 1 → 2: d ∞ → 2, 1 → 3: d ∞ → 6. Next: 2 (d = 2), relaxing the edges out of it.');
    sim.step(); // t: y 6, z 4 (x stays 6)
    expect(sim.describe()).toBe('Took 2 (d = 2). Relaxed 2 → 4: d ∞ → 6, 2 → 5: d ∞ → 4. No shorter path to 3. Next: 3 (d = 6), relaxing the edges out of it.');
    expect(sim.highlight().activeEdges).toEqual([
      [x, y],
      [x, z],
    ]);
  });

  it('gives the book’s distances and predecessors in one step per vertex; the tree is white at the end', () => {
    expect(runToEnd(sim)).toBe(6);
    expect(sim.finished).toBe(true);
    expect(Object.fromEntries(sim.distance)).toEqual({ 0: Infinity, 1: 0, 2: 2, 3: 6, 4: 5, 5: 3 });
    expect(Object.fromEntries(sim.parent)).toEqual({ 0: null, 1: null, 2: s, 3: s, 4: x, 5: y });
    const h = sim.highlight();
    expect(h.current).toBeNull();
    expect(h.done).toEqual([r, s, t, x, y, z]);
    expect(new Set(h.activeEdges.map(([a, b]) => `${a}>${b}`))).toEqual(new Set(['1>2', '1>3', '3>4', '4>5']));
    expect(sim.describe()).toBe(
      'Took 5 (d = 3). No edge leaves it. DAG shortest paths finished: shortest paths from 1 to 5 of 6 vertices; 1 not reachable (d = ∞). The white edges (v.π, v) form the shortest-paths tree. Press Finish.',
    );
  });

  it('Show as tree: the predecessor tree from s, with r (d = ∞) aside', () => {
    runToEnd(sim);
    const tree = sim.searchTree();
    expect(Object.fromEntries(tree.places.map((p) => [p.id, p.row]))).toEqual({ [s]: 0, [t]: 1, [x]: 1, [y]: 2, [z]: 3 });
    expect(tree.aside).toEqual([r]);
  });

  it('never modifies the graph', () => {
    const arcs = g.getArcs();
    runToEnd(sim);
    expect(g.getArcs()).toEqual(arcs);
  });
});

describe('DAG shortest paths on other graphs', () => {
  it('a graph with a cycle has no topological order: finished at once, and says why', () => {
    g.addEdge(z, r, 1); // z → r closes r → s → … → z → r
    const sim = new DagShortestPathsSimulation(view(g), s);
    expect(sim.cycleEdge).not.toBeNull();
    expect(sim.finished).toBe(true);
    expect(sim.step()).toBe(false);
    expect(sim.topologicalSort()).toBeNull();
    expect(sim.describe()).toMatch(/^DAG shortest paths needs a directed acyclic graph, but DFS found the backward edge \d → \d \(a cycle\)/);
  });

  it('on random DAGs (negative weights included): the distances match Bellman–Ford', () => {
    let seed = 13;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let trial = 0; trial < 50; trial++) {
      const h = new Graph();
      const n = 1 + Math.floor(rand() * 8);
      for (let i = 0; i < n; i++) h.addNode(0, 0);
      h.directed = true;
      // Arcs only from lower to higher ids: acyclic.
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if (rand() < 0.4) h.addEdge(a, b, Math.floor(rand() * 21) - 8);
      const source = Math.floor(rand() * n);
      const dag = new DagShortestPathsSimulation(view(h), source);
      expect(runToEnd(dag)).toBe(n);
      const bf = new BellmanFordSimulation(view(h), source);
      runToEnd(bf);
      expect(bf.result).toBe(true);
      expect(Object.fromEntries(dag.distance)).toEqual(Object.fromEntries(bf.distance));
    }
  });
});

describe('DFS offers it from its topological line-up ("Find shortest path for DAG")', () => {
  it('not before DFS has finished', () => {
    const dfs = new DfsSimulation(view(g), s);
    expect(dfs.followUp()).toBeNull();
  });

  it('on a DAG: from the vertex DFS started at, ready to run', () => {
    const dfs = new DfsSimulation(view(g), s);
    runToEnd(dfs);
    expect(dfs.followUp()).toMatchObject({
      label: 'Find shortest path for DAG',
      algorithm: 'dag-shortest-paths',
      start: s,
      blocked: undefined,
    });
    expect(ALGORITHMS.some((a) => a.id === dfs.followUp()!.algorithm)).toBe(true);
  });

  it('on a graph with a cycle: blocked, naming a backward edge', () => {
    g.addEdge(z, r, 1);
    const dfs = new DfsSimulation(view(g), s);
    runToEnd(dfs);
    expect(dfs.followUp()!.blocked).toMatch(/^Not a DAG: the backward edge \d → \d closes a cycle/);
  });
});
