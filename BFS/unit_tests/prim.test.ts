import { beforeEach, describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import { PrimSimulation, prim } from '../src/algorithms/prim.js';
import { ALGORITHMS } from '../src/algorithms/index.js';

/**
 *        4         5
 *    0 ───── 1 ───────── 3
 *     \      │         / │
 *    8 \     │ 2    9 /  │ 3
 *       \    │      /    │
 *         ── 2 ────      4
 *
 * Prim from 0: 0, then 1 (edge 0—1, 4), 2 (1—2, 2), 3 (1—3, 5), 4 (3—4, 3): weight 14.
 * 0—2 (8) and 2—3 (9) are left out.
 */
const EDGES: Array<[number, number, number]> = [
  [0, 1, 4],
  [0, 2, 8],
  [1, 2, 2],
  [1, 3, 5],
  [2, 3, 9],
  [3, 4, 3],
];

let g: Graph;

beforeEach(() => {
  g = new Graph();
  for (let i = 0; i < 5; i++) g.addNode(i * 10, 0);
  for (const [a, b, w] of EDGES) g.addEdge(a, b, w);
});

const weighted = (graph: Graph) => graph.view('undirected', 'weighted');

function runToEnd(sim: PrimSimulation): number {
  let steps = 0;
  while (sim.step()) steps++;
  return steps;
}

describe('Prim registry entry', () => {
  it('is offered after DFS; requires the undirected view and reads weights without forcing a weighting', () => {
    expect(ALGORITHMS.map((a) => a.id)).toEqual(['bfs', 'dfs', 'prim']);
    expect(prim.name).toBe("Prim's algorithm");
    expect(prim.requires).toEqual({ directed: false }); // no `weighted`: either is fine
    expect(prim.usesWeights).toBe(true);
    expect(prim.create(weighted(g), 0)).toBeInstanceOf(PrimSimulation);
  });
});

describe('PrimSimulation (weighted, CLRS MST-PRIM)', () => {
  let sim: PrimSimulation;
  beforeEach(() => {
    sim = new PrimSimulation(weighted(g), 0);
  });

  it('starts with every key ∞ except the root’s 0, and every vertex in the queue', () => {
    expect(sim.finished).toBe(false);
    expect(Object.fromEntries(sim.key)).toEqual({ 0: 0, 1: Infinity, 2: Infinity, 3: Infinity, 4: Infinity });
    expect([...sim.parent.values()]).toEqual([null, null, null, null, null]);
    expect(sim.queued).toEqual([0, 1, 2, 3, 4]);
    expect(sim.highlight()).toEqual({
      current: 0, // extracted next
      done: [],
      running: [0],
      activeEdges: [], // the root joins by no edge
      labels: { 0: '0', 1: '∞', 2: '∞', 3: '∞', 4: '∞' },
      exploredEdges: [],
    });
    expect(sim.describe()).toBe("Prim from 0. Every key is ∞ except 0's, which is 0. Press Update to add 0 to the tree.");
  });

  it('each step extracts the minimum and lowers its neighbours’ keys', () => {
    const trace: string[] = [];
    while (sim.step()) trace.push(sim.describe());
    expect(trace).toEqual([
      'Added 0 as the root of the tree. Lowered keys: 1 to 4, 2 to 8. ' +
        '2 edges cross the cut; the light edge is 0 — 1 (weight 4). Tree weight 0.',
      'Added 1 by edge 0 — 1 (weight 4). Lowered keys: 2 to 2, 3 to 5. ' +
        '3 edges cross the cut; the light edge is 1 — 2 (weight 2). Tree weight 4.',
      // 2—3 (9) is no better than 5
      'Added 2 by edge 1 — 2 (weight 2). No key changed. 2 edges cross the cut; the light edge is 1 — 3 (weight 5). Tree weight 6.',
      'Added 3 by edge 1 — 3 (weight 5). Lowered keys: 4 to 3. 1 edge crosses the cut; the light edge is 3 — 4 (weight 3). Tree weight 11.',
      'Prim finished: a minimum spanning tree of 4 edges, total weight 14. Press Finish.',
    ]);
  });

  it('builds the minimum spanning tree: one step per vertex, n − 1 edges', () => {
    expect(runToEnd(sim)).toBe(5);
    expect(sim.finished).toBe(true);
    expect(sim.step()).toBe(false);
    expect(sim.order).toEqual([0, 1, 2, 3, 4]);
    expect(sim.treeEdges).toEqual([
      { from: 0, to: 1, weight: 4 },
      { from: 1, to: 2, weight: 2 },
      { from: 1, to: 3, weight: 5 },
      { from: 3, to: 4, weight: 3 },
    ]);
    expect(sim.totalWeight).toBe(14);
    expect(Object.fromEntries(sim.parent)).toEqual({ 0: null, 1: 0, 2: 1, 3: 1, 4: 3 });
    expect(sim.roots).toEqual([0]);
  });

  it('white marks the vertex extracted next and the edge that joins it; tree green; finite keys yellow', () => {
    sim.step(); // 0 in the tree; 1 (key 4) is next, by 0—1
    expect(sim.highlight()).toMatchObject({
      current: 1,
      done: [0],
      running: [1, 2], // 3 and 4 still have key ∞
      activeEdges: [[0, 1]],
      labels: { 0: '0', 1: '4', 2: '8', 3: '∞', 4: '∞' },
      exploredEdges: [
        { from: 0, to: 1, crossing: true }, // the white one is a crossing edge too
        { from: 0, to: 2, crossing: true },
      ],
    });
    sim.step(); // 1 joins; 2's key drops to 2, so 2 is next, by 1—2 (not 0—2)
    expect(sim.highlight()).toMatchObject({
      current: 2,
      done: [0, 1],
      running: [2, 3],
      activeEdges: [[1, 2]],
      labels: { 0: '0', 1: '4', 2: '2', 3: '5', 4: '∞' },
      exploredEdges: [
        { from: 0, to: 1, done: true },
        { from: 0, to: 2, crossing: true },
        { from: 1, to: 2, crossing: true },
        { from: 1, to: 3, crossing: true },
      ],
    });
    runToEnd(sim);
    expect(sim.highlight()).toMatchObject({ current: null, done: [0, 1, 2, 3, 4], running: [], activeEdges: [] });
    expect(sim.highlight().exploredEdges).toHaveLength(4); // the tree; nothing crosses an empty cut
    expect(sim.highlight().exploredEdges!.every((e) => e.done)).toBe(true);
  });

  it('crossing edges are exactly those with one end in the tree; none before the first step', () => {
    expect(sim.crossingEdges()).toEqual([]); // S is empty
    sim.step();
    expect(sim.crossingEdges()).toEqual([
      [0, 1],
      [0, 2],
    ]);
    sim.step();
    expect(sim.crossingEdges()).toEqual([
      [0, 2],
      [1, 2],
      [1, 3],
    ]);
    sim.step(); // 2 joins: 0—2 and 1—2 are now inside the tree side; 2—3 crosses
    expect(sim.crossingEdges()).toEqual([
      [1, 3],
      [2, 3],
    ]);
  });

  it('priority queue snapshot: smallest key first, re-ordered as keys drop', () => {
    expect(sim.priorityQueueSnapshot()).toEqual({ items: [0, 1, 2, 3, 4], incoming: [], running: [0] });
    sim.step();
    expect(sim.priorityQueueSnapshot()).toEqual({ items: [1, 2, 3, 4], incoming: [], running: [1, 2] });
    sim.step(); // keys: 2 → 2, 3 → 5
    expect(sim.priorityQueueSnapshot()).toEqual({ items: [2, 3, 4], incoming: [], running: [2, 3] });
    runToEnd(sim);
    expect(sim.priorityQueueSnapshot()).toEqual({ items: [], incoming: [], running: [] });
  });

  it('the front of the queue is always the white vertex', () => {
    do {
      expect(sim.highlight().current).toBe(sim.queued[0] ?? null);
    } while (sim.step());
  });

  it('breaks ties between equal keys by the lowest id', () => {
    const t = new Graph();
    for (let i = 0; i < 4; i++) t.addNode(i * 10, 0);
    for (const [a, b] of [
      [0, 3],
      [0, 2],
      [0, 1],
    ]) t.addEdge(a, b, 5);
    const s = new PrimSimulation(weighted(t), 0);
    runToEnd(s);
    expect(s.order).toEqual([0, 1, 2, 3]);
  });

  it('can start at any root; the total weight is the same', () => {
    const from4 = new PrimSimulation(weighted(g), 4);
    runToEnd(from4);
    expect(from4.order[0]).toBe(4);
    expect(from4.totalWeight).toBe(14);
  });

  it('handles negative and zero weights', () => {
    g.setWeight(0, 2, -3);
    g.setWeight(2, 3, 0);
    const s = new PrimSimulation(weighted(g), 0);
    runToEnd(s);
    // 0—2 (−3), 1—2 (2), 2—3 (0), 3—4 (3)
    expect(s.totalWeight).toBe(2);
  });

  it('arcs both ways count as one undirected edge with the smaller weight', () => {
    const t = new Graph();
    t.addNode(0, 0);
    t.addNode(10, 0);
    t.directed = true;
    t.addEdge(0, 1, 7);
    t.addEdge(1, 0, 3);
    const s = new PrimSimulation(weighted(t), 0);
    runToEnd(s);
    expect(s.treeEdges).toEqual([{ from: 0, to: 1, weight: 3 }]);
  });

  it('never modifies the graph', () => {
    const arcs = g.getArcs();
    runToEnd(sim);
    expect(g.getArcs()).toEqual(arcs);
  });
});

describe('PrimSimulation on a graph that is not connected', () => {
  it('starts a new tree when only keys of ∞ are left: a minimum spanning forest', () => {
    g.addNode(50, 0); // 5
    g.addNode(60, 0); // 6
    g.addNode(70, 0); // 7, on its own
    g.addEdge(5, 6, 1);
    const sim = new PrimSimulation(weighted(g), 0);
    for (let i = 0; i < 4; i++) sim.step();
    sim.step(); // the first tree is complete
    expect(sim.describe()).toContain('No edge crosses the cut, so 5 will start a new tree.');
    expect(sim.crossingEdges()).toEqual([]);
    expect(sim.highlight()).toMatchObject({ current: 5, activeEdges: [], running: [] }); // key ∞: joins by no edge
    sim.step();
    expect(sim.describe()).toBe(
      '5 has key ∞: no edge joins it to the tree, so it starts a new tree. Lowered keys: 6 to 1. ' +
        '1 edge crosses the cut; the light edge is 5 — 6 (weight 1). Tree weight 14.',
    );
    runToEnd(sim);
    expect(sim.roots).toEqual([0, 5, 7]);
    expect(sim.treeEdges).toHaveLength(5); // 8 vertices − 3 trees
    expect(sim.describe()).toBe(
      'Prim finished: the graph is not connected, so this is a minimum spanning forest of 3 trees, 5 edges, total weight 15. Press Finish.',
    );
  });

  it('a single vertex is a tree with no edges', () => {
    const t = new Graph();
    t.addNode(0, 0);
    const s = new PrimSimulation(weighted(t), 0);
    expect(runToEnd(s)).toBe(1);
    expect(s.describe()).toBe('Prim finished: a minimum spanning tree of 0 edges, total weight 0. Press Finish.');
  });
});

describe('PrimSimulation (unweighted view)', () => {
  it('treats every edge as weight 1', () => {
    const sim = new PrimSimulation(g.undirectedView, 0);
    sim.step();
    expect(sim.describe()).toBe(
      'Added 0 as the root of the tree. Lowered keys: 1 to 1, 2 to 1. ' +
        '2 edges cross the cut; the light edge is 0 — 1 (weight 1). Tree weight 0.',
    );
    runToEnd(sim);
    expect(sim.treeEdges.every((e) => e.weight === 1)).toBe(true);
    expect(sim.totalWeight).toBe(4);
    expect(sim.describe()).toBe(
      'Prim finished: a minimum spanning tree of 4 edges, total weight 4 (every edge counts as 1). Press Finish.',
    );
  });
});

describe('the cut (S, V − S) on random graphs', () => {
  it('crossing edges match a brute-force check, and the white edge is always a light edge', () => {
    let seed = 9;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let trial = 0; trial < 40; trial++) {
      const r = new Graph();
      const n = 2 + Math.floor(rand() * 8);
      for (let i = 0; i < n; i++) r.addNode(i * 10, 0);
      for (let a = 0; a < n; a++)
        for (let b = a + 1; b < n; b++) if (rand() < 0.4) r.addEdge(a, b, Math.floor(rand() * 12) - 2);
      const view = weighted(r);
      const s = new PrimSimulation(view, 0);
      do {
        const tree = new Set(s.order);
        const brute = view
          .edges()
          .filter(([a, b]) => tree.has(a) !== tree.has(b))
          .map(([a, b]) => (tree.has(a) ? `${a}-${b}` : `${b}-${a}`))
          .sort();
        const crossing = s.crossingEdges();
        expect(crossing.map(([a, b]) => `${a}-${b}`).sort()).toEqual(brute);
        const h = s.highlight();
        const lightest = Math.min(...crossing.map(([a, b]) => view.weight(a, b)!));
        if (h.activeEdges.length) {
          const [[a, b]] = h.activeEdges;
          expect(tree.has(a) && !tree.has(b)).toBe(true); // it crosses the cut…
          expect(view.weight(a, b)).toBe(lightest); // …with the least weight
        } else if (tree.size > 0 && !s.finished) {
          expect(crossing).toEqual([]); // no white edge only when nothing crosses
        }
      } while (s.step());
    }
  });
});

describe('PrimSimulation against Kruskal on random graphs', () => {
  it('finds a spanning forest of minimum total weight', () => {
    let seed = 5;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let trial = 0; trial < 60; trial++) {
      const r = new Graph();
      const n = 1 + Math.floor(rand() * 9);
      for (let i = 0; i < n; i++) r.addNode(i * 10, 0);
      for (let a = 0; a < n; a++)
        for (let b = a + 1; b < n; b++) if (rand() < 0.35) r.addEdge(a, b, Math.floor(rand() * 21) - 5);
      const view = weighted(r);
      const s = new PrimSimulation(view, Math.floor(rand() * n));
      expect(runToEnd(s)).toBe(n);

      // Kruskal with union-find, as an independent answer.
      const parent = Array.from({ length: n }, (_, i) => i);
      const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
      let best = 0;
      let used = 0;
      for (const { from, to, weight } of view.weightedEdges().sort((x, y) => x.weight - y.weight)) {
        if (find(from) === find(to)) continue;
        parent[find(from)] = find(to);
        best += weight;
        used++;
      }
      expect(s.totalWeight).toBe(best);
      expect(s.treeEdges).toHaveLength(used);
      expect(s.roots).toHaveLength(n - used); // one root per component
      // Every tree edge is a real edge with that weight.
      for (const e of s.treeEdges) expect(view.weight(e.from, e.to)).toBe(e.weight);
    }
  });
});
