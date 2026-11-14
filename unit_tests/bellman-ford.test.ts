import { beforeEach, describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import { BellmanFordSimulation, bellmanFord } from '../src/algorithms/bellman-ford.js';
import { ALGORITHMS } from '../src/algorithms/index.js';

/**
 * CLRS Figure 22.4 (4th ed.), with s, t, x, y, z as 0, 1, 2, 3, 4:
 *   t→x 5, t→y 8, t→z −4, x→t −2, y→x −3, y→z 9, z→x 7, z→s 2, s→t 6, s→y 7.
 * From s: d = s 0, t 2, x 4, y 7, z −2; π: t ← x, x ← y, y ← s, z ← t. Returns TRUE.
 */
const [s, t, x, y, z] = [0, 1, 2, 3, 4];
const ARCS: Array<[number, number, number]> = [
  [t, x, 5],
  [t, y, 8],
  [t, z, -4],
  [x, t, -2],
  [y, x, -3],
  [y, z, 9],
  [z, x, 7],
  [z, s, 2],
  [s, t, 6],
  [s, y, 7],
];

let g: Graph;
beforeEach(() => {
  g = new Graph();
  for (let i = 0; i < 5; i++) g.addNode(i * 10, 0);
  g.directed = true;
  for (const [a, b, w] of ARCS) g.addEdge(a, b, w);
});

const weighted = (graph: Graph, orientation: 'directed' | 'undirected' = 'directed') => graph.view(orientation, 'weighted');
function runToEnd(sim: BellmanFordSimulation): number {
  let steps = 0;
  while (sim.step()) steps++;
  return steps;
}

describe('Bellman–Ford registry entry', () => {
  it('is offered last, and reads the weights as chosen (any weighting, either direction)', () => {
    expect(ALGORITHMS.at(-1)).toBe(bellmanFord);
    expect(bellmanFord.name).toBe('Bellman–Ford algorithm');
    expect(bellmanFord.requires).toEqual({});
    expect(bellmanFord.usesWeights).toBe(true);
    expect(bellmanFord.create(weighted(g), s)).toBeInstanceOf(BellmanFordSimulation);
  });
});

describe('BellmanFordSimulation on CLRS Figure 22.4', () => {
  let sim: BellmanFordSimulation;
  beforeEach(() => {
    sim = new BellmanFordSimulation(weighted(g), s);
  });

  it('goes through the edges in adjacency-list order: by from vertex, then to vertex', () => {
    expect(sim.edges.map((e) => `${e.from}>${e.to}:${e.weight}`)).toEqual([
      '0>1:6',
      '0>3:7',
      '1>2:5',
      '1>3:8',
      '1>4:-4',
      '2>1:-2',
      '3>2:-3',
      '3>4:9',
      '4>0:2',
      '4>2:7',
    ]);
    expect(sim.passes).toBe(4);
  });

  it('starts with d = ∞ everywhere but s; the first edge is white, here and in the side panel', () => {
    expect(sim.highlight()).toEqual({
      current: null,
      done: [],
      activeEdges: [[s, t]],
      labels: { 0: '0', 1: '∞', 2: '∞', 3: '∞', 4: '∞' },
      representationEdge: { from: s, to: t },
      exploredEdges: [], // pass 1 has reached no edge yet: every edge dashed
    });
    expect(sim.describe()).toBe(
      'Bellman–Ford from 0. Every d is ∞ except 0.d = 0. 4 passes (|V| − 1) over the 10 edges, then a check. Next: relax 0 → 1 (weight 6).',
    );
  });

  it('one step per edge: relaxes it, then moves the white edge on', () => {
    sim.step(); // 0 → 1: t.d ∞ → 6
    expect(sim.describe()).toBe('Pass 1 of 4, edge 1 of 10: relaxed 0 → 1 (weight 6): 1.d ∞ → 6. Next: relax 0 → 3 (weight 7).');
    expect(sim.highlight()).toMatchObject({ activeEdges: [[s, y]], representationEdge: { from: s, to: y } });
    sim.step(); // 0 → 3: y.d ∞ → 7
    sim.step(); // 1 → 2: x.d ∞ → 11
    sim.step(); // 1 → 3: 6 + 8 = 14 > 7
    expect(sim.describe()).toBe('Pass 1 of 4, edge 4 of 10: 1 → 3 (weight 8) gives no shorter path to 3. Next: relax 1 → 4 (weight -4).');
    for (let i = 4; i < 10; i++) sim.step(); // the rest of pass 1
    expect(sim.describe()).toMatch(/^Pass 1 of 4, edge 10 of 10: .* Next: relax 0 → 1 \(weight 6\), starting pass 2 of 4\.$/);
  });

  it('gives the book’s distances and predecessors, and returns TRUE after (|V| − 1)·|E| + |E| steps', () => {
    expect(runToEnd(sim)).toBe(4 * 10 + 10);
    expect(sim.result).toBe(true);
    expect(sim.finished).toBe(true);
    expect(Object.fromEntries(sim.distance)).toEqual({ 0: 0, 1: 2, 2: 4, 3: 7, 4: -2 });
    expect(Object.fromEntries(sim.parent)).toEqual({ 0: null, 1: x, 2: y, 3: s, 4: t });
  });

  it('the check goes edge by edge too, and at the end the shortest-paths tree is white', () => {
    for (let i = 0; i < 40; i++) sim.step();
    expect(sim.checking).toBe(true);
    expect(sim.describe()).toMatch(/Next: check 0 → 1 \(weight 6\), the first edge of the final check\.$/);
    sim.step();
    expect(sim.describe()).toBe('Check, edge 1 of 10: 0 → 1 (weight 6) cannot lower 1.d. Next: check 0 → 3 (weight 7).');
    runToEnd(sim);
    expect(sim.describe()).toBe(
      'Check, edge 10 of 10: 4 → 2 (weight 7) cannot lower 2.d. Bellman–Ford finished: no negative-weight cycle is reachable from 0 (TRUE), so every d is a shortest-path weight; the white edges (v.π, v) form the shortest-paths tree. Press Finish.',
    );
    const h = sim.highlight();
    expect(h.representationEdge).toBeUndefined();
    expect(new Set(h.activeEdges.map(([a, b]) => `${a}>${b}`))).toEqual(new Set(['2>1', '3>2', '0>3', '1>4']));
    expect(sim.step()).toBe(false);
  });

  it('never modifies the graph', () => {
    const arcs = g.getArcs();
    runToEnd(sim);
    expect(g.getArcs()).toEqual(arcs);
  });
});

describe('per-pass dashing, Full cycle and Show as tree', () => {
  const solid = (sim: BellmanFordSimulation) => sim.highlight().exploredEdges!.map((e) => `${e.from}>${e.to}`);

  it('each pass fills in edge by edge (the rest dashed); right after a pass every edge is solid', () => {
    const sim = new BellmanFordSimulation(weighted(g), s);
    expect(sim.stepsLeftInPass()).toBe(10);
    sim.step();
    sim.step();
    expect(solid(sim)).toEqual(['0>1', '0>3']);
    expect(sim.stepsLeftInPass()).toBe(8);
    for (let i = 2; i < 10; i++) sim.step(); // pass 1 complete
    expect(solid(sim)).toHaveLength(10);
    expect(sim.stepsLeftInPass()).toBe(10); // the whole of pass 2 ahead
    sim.step(); // pass 2 begins: dashed again but its first edge
    expect(solid(sim)).toEqual(['0>1']);
  });

  it('the check fills in too; at the end every edge is solid, TRUE or FALSE', () => {
    const sim = new BellmanFordSimulation(weighted(g), s);
    runToEnd(sim);
    expect(solid(sim)).toHaveLength(10);
    expect(sim.stepsLeftInPass()).toBe(0);
    const h = new Graph();
    for (let i = 0; i < 3; i++) h.addNode(0, 0);
    h.directed = true;
    h.addEdge(0, 1, 1);
    h.addEdge(1, 2, -2);
    h.addEdge(2, 1, 1);
    const bad = new BellmanFordSimulation(weighted(h), 0);
    runToEnd(bad);
    expect(bad.result).toBe(false);
    expect(solid(bad)).toEqual(['0>1', '1>2', '2>1']);
  });

  it('search tree: the predecessor tree from the source, rearranging as d values drop', () => {
    const sim = new BellmanFordSimulation(weighted(g), s);
    expect(sim.searchTree()).toMatchObject({ places: [{ id: s, column: 0, row: 0 }], spine: [], aside: [t, x, y, z] });
    for (let i = 0; i < 10; i++) sim.step(); // pass 1
    runToEnd(sim);
    // The book's tree: s → y → x → t → z, a chain of rows 0 … 4.
    const rows = Object.fromEntries(sim.searchTree().places.map((p) => [p.id, p.row]));
    expect(rows).toEqual({ [s]: 0, [y]: 1, [x]: 2, [t]: 3, [z]: 4 });
    expect(sim.searchTree().aside).toEqual([]);
  });

  it('search tree with a negative-weight cycle: never loops, and puts the cycle’s vertices aside', () => {
    const h = new Graph();
    for (let i = 0; i < 3; i++) h.addNode(0, 0);
    h.directed = true;
    h.addEdge(0, 1, 1);
    h.addEdge(1, 0, -3); // 0 → 1 → 0 weighs −2: even the source gets a predecessor
    h.addEdge(1, 2, 1);
    const sim = new BellmanFordSimulation(weighted(h), 0);
    do {
      const tree = sim.searchTree();
      expect(tree.places.length + tree.aside!.length).toBe(3);
      expect(new Set(tree.places.map((p) => p.id)).size).toBe(tree.places.length);
    } while (sim.step());
    expect(sim.result).toBe(false);
  });

  it('reached vertices whose predecessors loop are set aside and explained, not called "not reached yet"', () => {
    const h = new Graph();
    for (let i = 0; i < 4; i++) h.addNode(0, 0);
    h.directed = true;
    h.addEdge(0, 1, 1);
    h.addEdge(1, 2, 1);
    h.addEdge(2, 1, -3); // 1 → 2 → 1 weighs −2, away from the source
    const sim = new BellmanFordSimulation(weighted(h), 0);
    runToEnd(sim);
    const tree = sim.searchTree();
    expect(tree.places.map((p) => p.id)).toEqual([0]);
    expect(tree.aside).toEqual([1, 2, 3]);
    expect(tree.asideNote).toBe(
      'Waiting on the right: 1 vertex not reached yet, and 2 vertices whose predecessors run round in a loop, which only a negative-weight cycle makes possible (CLRS Lemma 22.16), so they hang from no tree.',
    );
    expect(new BellmanFordSimulation(weighted(g), s).searchTree().asideNote).toBeUndefined(); // only d = ∞ aside
  });
});

describe('BellmanFordSimulation: negative-weight cycles and other graphs', () => {
  it('returns FALSE at the first edge that could still be relaxed; at the end the degenerate edges are red', () => {
    const h = new Graph();
    for (let i = 0; i < 3; i++) h.addNode(0, 0);
    h.directed = true;
    h.addEdge(0, 1, 1);
    h.addEdge(1, 2, -2);
    h.addEdge(2, 1, 1); // 1 → 2 → 1 weighs −1
    const sim = new BellmanFordSimulation(weighted(h), 0);
    runToEnd(sim);
    // Pass 2 leaves d = 0, −1, −2 (π: 1 ← 2, 2 ← 1); the check fails at 1 → 2: −2 > −1 − 2.
    expect(sim.result).toBe(false);
    expect(Object.fromEntries(sim.distance)).toEqual({ 0: 0, 1: -1, 2: -2 });
    expect(sim.degenerateEdges().map((e) => `${e.from}>${e.to}`)).toEqual(['1>2']);
    const last = sim.highlight();
    expect(last.exploredEdges).toEqual([
      { from: 0, to: 1 },
      { from: 1, to: 2, degenerate: true },
      { from: 2, to: 1 },
    ]);
    // The predecessor edges are white, except 1 → 2 (2.π = 1), which is red.
    expect(last.activeEdges).toEqual([[2, 1]]);
    expect(last.representationEdge).toBeUndefined();
    expect(sim.describe()).toMatch(
      /could still lower 2\.d .* Bellman–Ford finished: a negative-weight cycle is reachable from 0 \(FALSE\), so some shortest paths are not defined\. In red: the edge that could still lower a d\. Press Finish\.$/,
    );
  });

  it('a TRUE run has no degenerate edges, and nothing red', () => {
    const sim = new BellmanFordSimulation(weighted(g), s);
    runToEnd(sim);
    expect(sim.degenerateEdges()).toEqual([]);
    expect(sim.highlight().exploredEdges!.some((e) => e.degenerate)).toBe(false);
  });

  it('undirected: a red edge is red whichever way round it failed, and is not also white', () => {
    const h = new Graph();
    for (let i = 0; i < 3; i++) h.addNode(0, 0);
    h.addEdge(0, 1, 2);
    h.addEdge(1, 2, -1); // a negative undirected edge: a negative cycle by itself
    const sim = new BellmanFordSimulation(weighted(h, 'undirected'), 0);
    runToEnd(sim);
    expect(sim.result).toBe(false);
    const h2 = sim.highlight();
    const red = h2.exploredEdges!.filter((e) => e.degenerate).map((e) => `${Math.min(e.from, e.to)}-${Math.max(e.from, e.to)}`);
    expect(red).toContain('1-2');
    for (const [a, b] of h2.activeEdges) expect(red).not.toContain(`${Math.min(a, b)}-${Math.max(a, b)}`);
  });

  it('a negative cycle that the source cannot reach does not matter', () => {
    const h = new Graph();
    for (let i = 0; i < 4; i++) h.addNode(0, 0);
    h.directed = true;
    h.addEdge(0, 1, 3);
    h.addEdge(2, 3, -2);
    h.addEdge(3, 2, 1);
    const sim = new BellmanFordSimulation(weighted(h), 0);
    runToEnd(sim);
    expect(sim.result).toBe(true);
    expect(Object.fromEntries(sim.distance)).toEqual({ 0: 0, 1: 3, 2: Infinity, 3: Infinity });
  });

  it('undirected: each edge both ways, so a negative edge is a negative cycle by itself', () => {
    const h = new Graph();
    for (let i = 0; i < 3; i++) h.addNode(0, 0);
    h.addEdge(0, 1, 4);
    h.addEdge(1, 2, 1);
    const ok = new BellmanFordSimulation(weighted(h, 'undirected'), 2);
    expect(ok.edges).toHaveLength(4);
    runToEnd(ok);
    expect(ok.result).toBe(true);
    expect(Object.fromEntries(ok.distance)).toEqual({ 0: 5, 1: 1, 2: 0 });
    h.setWeight(1, 2, -1);
    const bad = new BellmanFordSimulation(weighted(h, 'undirected'), 2);
    runToEnd(bad);
    expect(bad.result).toBe(false);
  });

  it('a graph with no edges is finished at once (TRUE)', () => {
    const h = new Graph();
    h.addNode(0, 0);
    h.addNode(0, 0);
    const sim = new BellmanFordSimulation(weighted(h), 1);
    expect(sim.finished).toBe(true);
    expect(sim.result).toBe(true);
    expect(sim.step()).toBe(false);
    expect(sim.describe()).toBe('Bellman–Ford from 1: there are no edges, so nothing to relax; no negative-weight cycle (TRUE). Press Finish.');
  });

  it('on random graphs: the verdict and distances match Floyd–Warshall', () => {
    let seed = 5;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let cycles = 0;
    for (let trial = 0; trial < 80; trial++) {
      const r = new Graph();
      const n = 1 + Math.floor(rand() * 7);
      for (let i = 0; i < n; i++) r.addNode(0, 0);
      r.directed = true;
      for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (a !== b && rand() < 0.3) r.addEdge(a, b, Math.floor(rand() * 14) - 3);
      const view = weighted(r);
      const source = Math.floor(rand() * n);
      const sim = new BellmanFordSimulation(view, source);
      runToEnd(sim);
      // Floyd–Warshall, independently.
      const ids = view.nodeIds();
      const d = ids.map((a) => ids.map((b) => (a === b ? 0 : (view.weight(a, b) ?? Infinity))));
      for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) d[i][j] = Math.min(d[i][j], d[i][k] + d[k][j]);
      const negative = ids.some((v) => d[source][v] < Infinity && d[v][v] < 0);
      expect(sim.result).toBe(!negative);
      if (negative) cycles++;
      else expect(Object.fromEntries(sim.distance)).toEqual(Object.fromEntries(ids.map((v) => [v, d[source][v]])));
    }
    expect(cycles).toBeGreaterThan(3);
    expect(cycles).toBeLessThan(77);
  });
});
