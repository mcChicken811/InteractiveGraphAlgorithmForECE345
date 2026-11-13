import { beforeEach, describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import { DisjointSet } from '../src/algorithms/disjoint-set.js';
import { KruskalSimulation, kruskal } from '../src/algorithms/kruskal.js';
import { PrimSimulation } from '../src/algorithms/prim.js';
import { ALGORITHMS } from '../src/algorithms/index.js';

/**
 * The same graph as the Prim tests:
 *   0—1 (4), 0—2 (8), 1—2 (2), 1—3 (5), 2—3 (9), 3—4 (3)
 * Sorted: 1—2 (2), 3—4 (3), 0—1 (4), 1—3 (5), 0—2 (8), 2—3 (9).
 * Kruskal adds 1—2, 3—4, 0—1, 1—3 and skips 0—2 and 2—3: weight 14.
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
function runToEnd(sim: KruskalSimulation): number {
  let steps = 0;
  while (sim.step()) steps++;
  return steps;
}

describe('DisjointSet (CLRS §19.3: union by rank, path compression)', () => {
  it('starts with every element its own set, rank 0', () => {
    const s = new DisjointSet();
    for (let i = 0; i < 4; i++) s.makeSet(i);
    expect([0, 1, 2, 3].map((i) => s.findSet(i))).toEqual([0, 1, 2, 3]);
    expect([0, 1, 2, 3].map((i) => s.rankOf(i))).toEqual([0, 0, 0, 0]);
  });

  it('LINK: equal ranks make the second root the parent and raise its rank; else the higher rank wins', () => {
    const s = new DisjointSet();
    for (let i = 0; i < 4; i++) s.makeSet(i);
    s.union(0, 1); // ranks 0 = 0: 0.p = 1, 1.rank = 1
    expect(s.parentOf(0)).toBe(1);
    expect(s.rankOf(1)).toBe(1);
    s.union(2, 1); // rank(2) = 0 < rank(1) = 1: 2.p = 1
    expect(s.parentOf(2)).toBe(1);
    expect(s.rankOf(1)).toBe(1);
    s.union(1, 3); // rank(1) = 1 > rank(3) = 0: 3.p = 1
    expect(s.parentOf(3)).toBe(1);
    expect(new Set([0, 1, 2, 3].map((i) => s.findSet(i)))).toEqual(new Set([1]));
  });

  it('FIND-SET compresses the path; representative() reads it without changing anything', () => {
    const s = new DisjointSet();
    for (let i = 0; i < 4; i++) s.makeSet(i);
    s.union(0, 1); // 0 → 1
    s.union(2, 3); // 2 → 3
    s.union(1, 3); // ranks 1 = 1: 1 → 3, 3.rank = 2; now 0 → 1 → 3
    expect(s.parentOf(0)).toBe(1);
    expect(s.representative(0)).toBe(3);
    expect(s.parentOf(0)).toBe(1); // unchanged
    expect(s.findSet(0)).toBe(3);
    expect(s.parentOf(0)).toBe(3); // compressed
  });
});

describe('Kruskal registry entry', () => {
  it('is offered after Prim; requires the undirected view and reads weights without forcing a weighting', () => {
    expect(ALGORITHMS.map((a) => a.id)).toEqual(['bfs', 'dfs', 'prim', 'kruskal']);
    expect(kruskal.name).toBe("Kruskal's algorithm");
    expect(kruskal.requires).toEqual({ directed: false });
    expect(kruskal.usesWeights).toBe(true);
    expect(kruskal.create(weighted(g), 3)).toBeInstanceOf(KruskalSimulation); // the start is not used
  });
});

describe('KruskalSimulation (weighted, CLRS MST-KRUSKAL)', () => {
  let sim: KruskalSimulation;
  beforeEach(() => {
    sim = new KruskalSimulation(weighted(g));
  });

  it('sorts the edges by weight (ties by their ends), every vertex a set of its own', () => {
    expect(sim.sorted.map((e) => `${e.from}-${e.to}:${e.weight}`)).toEqual(['1-2:2', '3-4:3', '0-1:4', '1-3:5', '0-2:8', '2-3:9']);
    expect([0, 1, 2, 3, 4].map((v) => sim.representative(v))).toEqual([0, 1, 2, 3, 4]);
    expect(sim.describe()).toBe(
      'Kruskal: every vertex is a set of its own; 6 edges sorted by weight. ' +
        "Next: 1 — 2 (weight 2) joins two trees: a light edge crossing the cut around 1's tree.",
    );
  });

  it('each step takes the next edge: added if it joins two trees, skipped if it would close a cycle', () => {
    const trace: string[] = [];
    while (sim.step()) trace.push(sim.describe());
    expect(trace).toEqual([
      "Added 1 — 2 (weight 2): it joined two trees. Forest weight 2. Next: 3 — 4 (weight 3) joins two trees: a light edge crossing the cut around 3's tree.",
      "Added 3 — 4 (weight 3): it joined two trees. Forest weight 5. Next: 0 — 1 (weight 4) joins two trees: a light edge crossing the cut around 0's tree.",
      "Added 0 — 1 (weight 4): it joined two trees. Forest weight 9. Next: 1 — 3 (weight 5) joins two trees: a light edge crossing the cut around 1's tree.",
      'Added 1 — 3 (weight 5): it joined two trees. Forest weight 14. Next: 0 — 2 (weight 8) has both ends in one tree, so it would close a cycle.',
      'Skipped 0 — 2 (weight 8): both ends were already in one tree. Forest weight 14. Next: 2 — 3 (weight 9) has both ends in one tree, so it would close a cycle.',
      'Kruskal finished: a minimum spanning tree of 4 edges, total weight 14. Press Finish.',
    ]);
  });

  it('takes one step per edge and returns the minimum spanning tree', () => {
    expect(runToEnd(sim)).toBe(6);
    expect(sim.finished).toBe(true);
    expect(sim.step()).toBe(false);
    expect(sim.forest.map((e) => `${e.from}-${e.to}`)).toEqual(['1-2', '3-4', '0-1', '1-3']);
    expect(sim.skipped.map((e) => `${e.from}-${e.to}`)).toEqual(['0-2', '2-3']);
    expect(sim.totalWeight).toBe(14);
    expect(sim.treeCount).toBe(1);
  });

  it('highlight: white next edge (dashed), A green, edges still to check inside a tree darker green, the rest dashed', () => {
    expect(sim.highlight()).toMatchObject({
      current: null,
      compact: true,
      done: [], // no vertex is in a tree with an edge yet
      activeEdges: [[1, 2]],
      labels: { 0: '0', 1: '1', 2: '2', 3: '3', 4: '4' },
      cut: [], // no tree with an edge yet: no territory
      cutGroups: [],
      activeDashed: true, // the next edge is not in A yet: it stays dashed
      exploredEdges: [], // no edge is in A or inside a tree: all dashed
    });
    expect(sim.highlight().cutEdgesOnly).toBeUndefined(); // vertices are sites too
    sim.step();
    sim.step();
    sim.step(); // A = {1—2, 3—4, 0—1}; next 1—3
    const h = sim.highlight();
    expect(h.activeEdges).toEqual([[1, 3]]);
    expect(h.cut).toEqual([0, 1, 2, 3, 4]);
    expect(h.done).toEqual([0, 1, 2, 3, 4]);
    expect(h.exploredEdges).toEqual([
      { from: 1, to: 2, done: true },
      { from: 3, to: 4, done: true },
      { from: 0, to: 1, done: true },
      { from: 0, to: 2, waiting: true }, // still to check, inside {0, 1, 2}: it would close a cycle
    ]); // 1—3 (next) and 2—3 join two trees: plain dashed, nothing crossing
    sim.step(); // adds 1—3: now 0—2 is next, and 2—3 waits inside the one tree too
    expect(sim.highlight().activeEdges).toEqual([[0, 2]]);
    expect(sim.highlight().exploredEdges!.filter((e) => e.waiting)).toEqual([
      { from: 0, to: 2, waiting: true }, // the next edge: white, still dashed
      { from: 2, to: 3, waiting: true },
    ]);
    sim.step(); // skips 0—2: checked, so plain dashed from now on
    expect(sim.highlight().exploredEdges!.filter((e) => e.waiting)).toEqual([{ from: 2, to: 3, waiting: true }]);
    sim.step(); // skips 2—3: nothing waits
    expect(sim.highlight().exploredEdges!.every((e) => e.done)).toBe(true);
    // Labels are each vertex's set representative: one number per tree.
    const labels = h.labels!;
    expect(labels[0]).toBe(labels[1]);
    expect(labels[1]).toBe(labels[2]);
    expect(labels[3]).toBe(labels[4]);
    expect(labels[0]).not.toBe(labels[3]);
  });

  it('the cut is every tree with an edge so far, each a group of its own (a territory with its own border)', () => {
    sim.step(); // A = {1—2}
    expect(sim.highlight()).toMatchObject({ cut: [1, 2], cutGroups: [[1, 2]] });
    sim.step(); // A = {1—2, 3—4}: two trees, two groups; 0 is in neither
    expect(sim.highlight()).toMatchObject({ cut: [1, 2, 3, 4], cutGroups: [[1, 2], [3, 4]] });
    sim.step(); // 0—1 joins 0 to 1's tree
    expect(sim.highlight()).toMatchObject({ cut: [0, 1, 2, 3, 4], cutGroups: [[0, 1, 2], [3, 4]] });
    sim.step(); // 1—3 joins the two trees into one
    expect(sim.highlight()).toMatchObject({ cut: [0, 1, 2, 3, 4], cutGroups: [[0, 1, 2, 3, 4]] });
  });

  it('when the next edge would close a cycle, it crosses no cut', () => {
    for (let i = 0; i < 4; i++) sim.step(); // next: 0—2, both ends in the one tree
    const h = sim.highlight();
    expect(h.activeEdges).toEqual([[0, 2]]);
    expect(sim.crossingEdges()).toEqual([]);
  });

  it('at the end of a connected graph the cut is everything (the territory floods), and no edge is next', () => {
    runToEnd(sim);
    expect(sim.highlight()).toMatchObject({ activeEdges: [], cut: [0, 1, 2, 3, 4], cutGroups: [[0, 1, 2, 3, 4]] });
  });

  it('edge queue snapshot: the remaining edges, and what happened to the one just taken', () => {
    expect(sim.edgeQueueSnapshot().items.map((e) => `${e.from}-${e.to}`)).toEqual(['1-2', '3-4', '0-1', '1-3', '0-2', '2-3']);
    expect(sim.edgeQueueSnapshot().last).toBeNull();
    sim.step();
    expect(sim.edgeQueueSnapshot()).toMatchObject({ last: { from: 1, to: 2, weight: 2, added: true } });
    for (let i = 0; i < 4; i++) sim.step();
    expect(sim.edgeQueueSnapshot()).toEqual({
      items: [{ from: 2, to: 3, weight: 9 }],
      last: { from: 0, to: 2, weight: 8, added: false },
    });
  });

  it('never modifies the graph', () => {
    const arcs = g.getArcs();
    runToEnd(sim);
    expect(g.getArcs()).toEqual(arcs);
  });
});

describe('KruskalSimulation on other graphs', () => {
  it('a graph that is not connected gives a minimum spanning forest; the cut keeps its trees (a lone vertex has none)', () => {
    g.addNode(50, 0); // 5, on its own
    const sim = new KruskalSimulation(weighted(g));
    runToEnd(sim);
    expect(sim.treeCount).toBe(2);
    expect(sim.describe()).toBe(
      'Kruskal finished: the graph is not connected, so this is a minimum spanning forest of 2 trees, 4 edges, total weight 14. Press Finish.',
    );
    expect(sim.highlight()).toMatchObject({ cut: [0, 1, 2, 3, 4], cutGroups: [[0, 1, 2, 3, 4]] });
  });

  it('a graph with no edges is finished at once', () => {
    const t = new Graph();
    t.addNode(0, 0);
    t.addNode(10, 0);
    const sim = new KruskalSimulation(weighted(t));
    expect(sim.finished).toBe(true);
    expect(sim.describe()).toBe('Kruskal: the graph has no edges, so every vertex is a tree of its own. Press Finish.');
  });

  it('unweighted: every edge counts as 1', () => {
    const sim = new KruskalSimulation(g.undirectedView);
    expect(sim.sorted.every((e) => e.weight === 1)).toBe(true);
    runToEnd(sim);
    expect(sim.totalWeight).toBe(4);
    expect(sim.describe()).toBe('Kruskal finished: a minimum spanning tree of 4 edges, total weight 4 (every edge counts as 1). Press Finish.');
  });

  it('on random graphs: a spanning forest with the same total weight as Prim, and every added edge was a light edge', () => {
    let seed = 21;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let trial = 0; trial < 60; trial++) {
      const r = new Graph();
      const n = 1 + Math.floor(rand() * 9);
      for (let i = 0; i < n; i++) r.addNode(i * 10, 0);
      for (let a = 0; a < n; a++)
        for (let b = a + 1; b < n; b++) if (rand() < 0.35) r.addEdge(a, b, Math.floor(rand() * 21) - 5);
      const view = weighted(r);
      const k = new KruskalSimulation(view);
      // Before each step, if the next edge joins two trees, it is a lightest edge crossing the
      // cut around its first end's tree (Corollary 21.2).
      while (!k.finished) {
        const next = k.upcoming!;
        const crossing = k.crossingEdges();
        if (k.representative(next.from) !== k.representative(next.to)) {
          expect(crossing.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`)).toContain(`${next.from}-${next.to}`);
          const lightest = Math.min(...crossing.map(([a, b]) => view.weight(a, b)!));
          expect(next.weight).toBe(lightest);
        }
        k.step();
      }
      const p = new PrimSimulation(view, 0);
      while (p.step());
      expect(k.totalWeight).toBe(p.totalWeight);
      expect(k.forest).toHaveLength(p.treeEdges.length);
      expect(k.forest.length + k.treeCount).toBe(n); // a forest: n − (number of trees) edges
    }
  });
});
