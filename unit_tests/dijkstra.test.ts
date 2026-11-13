import { beforeEach, describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import { DijkstraSimulation, dijkstra } from '../src/algorithms/dijkstra.js';
import { ALGORITHMS } from '../src/algorithms/index.js';

/**
 * CLRS Figure 22.6 (4th ed.), with s, t, x, y, z as 0, 1, 2, 3, 4:
 *   s→t 10, s→y 5, t→x 1, t→y 2, y→t 3, y→x 9, y→z 2, x→z 4, z→x 6, z→s 7.
 * From s: d = s 0, t 8, x 9, y 5, z 7; π: t ← y, x ← t, y ← s, z ← y.
 * Extraction order s, y, z, t, x.
 */
const [s, t, x, y, z] = [0, 1, 2, 3, 4];
const ARCS: Array<[number, number, number]> = [
  [s, t, 10],
  [s, y, 5],
  [t, x, 1],
  [t, y, 2],
  [y, t, 3],
  [y, x, 9],
  [y, z, 2],
  [x, z, 4],
  [z, x, 6],
  [z, s, 7],
];

let g: Graph;
beforeEach(() => {
  g = new Graph();
  for (let i = 0; i < 5; i++) g.addNode(i * 10, 0);
  g.directed = true;
  for (const [a, b, w] of ARCS) g.addEdge(a, b, w);
});

const positive = (graph: Graph, orientation: 'directed' | 'undirected' = 'directed') => graph.view(orientation, 'positive');
function runToEnd(sim: DijkstraSimulation): number {
  let steps = 0;
  while (sim.step()) steps++;
  return steps;
}

describe('Dijkstra registry entry', () => {
  it('is offered last, and forces the positive weighting (direction as chosen)', () => {
    expect(ALGORITHMS.at(-1)).toBe(dijkstra);
    expect(dijkstra.name).toBe("Dijkstra's algorithm");
    expect(dijkstra.requires).toEqual({ weighting: 'positive' });
    expect(dijkstra.create(positive(g), s)).toBeInstanceOf(DijkstraSimulation);
  });
});

describe('DijkstraSimulation on CLRS Figure 22.6', () => {
  let sim: DijkstraSimulation;
  beforeEach(() => {
    sim = new DijkstraSimulation(positive(g), s);
  });

  it('starts with d = ∞ everywhere but s, s white with the edges it will relax', () => {
    expect(sim.finished).toBe(false);
    expect(sim.highlight()).toEqual({
      current: s,
      done: [],
      activeEdges: [
        [s, t],
        [s, y],
      ],
      labels: { 0: '0', 1: '∞', 2: '∞', 3: '∞', 4: '∞' },
    });
    expect(sim.priorityQueueSnapshot()).toEqual({ items: [s, t, x, y, z], incoming: [] });
    expect(sim.describe()).toBe('Dijkstra from 0. Every d is ∞ except 0.d = 0. Press Update to extract 0 and relax its edges.');
  });

  it('each step extracts the smallest d, turns it green, and relaxes its edges', () => {
    sim.step(); // extract s: t 10, y 5
    expect(sim.highlight()).toMatchObject({
      current: y,
      done: [s],
      activeEdges: [
        [y, t],
        [y, x],
        [y, z],
      ],
      labels: { 0: '0', 1: '10', 2: '∞', 3: '5', 4: '∞' },
    });
    expect(sim.describe()).toBe('Extracted 0 (d = 0). Relaxed 0 → 1: d ∞ → 10, 0 → 3: d ∞ → 5. Next: extract 3 (d = 5).');
    expect(sim.priorityQueueSnapshot().items).toEqual([y, t, x, z]);

    sim.step(); // extract y: t 8, x 14, z 7
    expect(sim.highlight().labels).toEqual({ 0: '0', 1: '8', 2: '14', 3: '5', 4: '7' });
    expect(sim.describe()).toBe('Extracted 3 (d = 5). Relaxed 3 → 1: d 10 → 8, 3 → 2: d ∞ → 14, 3 → 4: d ∞ → 7. Next: extract 4 (d = 7).');

    sim.step(); // extract z: x 13 (z → s goes into S: not relaxed)
    expect(sim.highlight()).toMatchObject({ current: t, done: [s, y, z], activeEdges: [[t, x]] }); // t → y: y is in S
    expect(sim.describe()).toBe('Extracted 4 (d = 7). Relaxed 4 → 2: d 14 → 13. Next: extract 1 (d = 8).');

    sim.step(); // extract t: x 9
    expect(sim.describe()).toBe('Extracted 1 (d = 8). Relaxed 1 → 2: d 13 → 9. Next: extract 2 (d = 9).');
  });

  it('gives the book’s distances, predecessors and extraction order, one step per vertex', () => {
    expect(runToEnd(sim)).toBe(5);
    expect(sim.finished).toBe(true);
    expect(Object.fromEntries(sim.distance)).toEqual({ 0: 0, 1: 8, 2: 9, 3: 5, 4: 7 });
    expect(Object.fromEntries(sim.parent)).toEqual({ 0: null, 1: y, 2: t, 3: s, 4: y });
    expect(sim.order).toEqual([s, y, z, t, x]);
  });

  it('at the end: every vertex green, and the white edges are the shortest-paths tree (v.π, v)', () => {
    runToEnd(sim);
    const h = sim.highlight();
    expect(h.current).toBeNull();
    expect(h.done).toEqual([s, y, z, t, x]);
    expect(new Set(h.activeEdges.map(([a, b]) => `${a}>${b}`))).toEqual(new Set(['3>1', '1>2', '0>3', '3>4']));
    expect(sim.describe()).toBe(
      'Extracted 2 (d = 9). No edge to relax. Dijkstra finished: shortest paths from 0 to all 5 vertices; the white edges (v.π, v) form the shortest-paths tree. Press Finish.',
    );
    expect(sim.step()).toBe(false);
  });

  it('a relaxation that finds no shorter path says so', () => {
    const h = new Graph();
    for (let i = 0; i < 3; i++) h.addNode(0, 0);
    h.directed = true;
    h.addEdge(0, 1, 1);
    h.addEdge(0, 2, 5);
    h.addEdge(1, 2, 7); // 1 + 7 > 5
    const d = new DijkstraSimulation(positive(h), 0);
    d.step();
    d.step();
    expect(d.describe()).toBe('Extracted 1 (d = 1). No shorter path to 2. Next: extract 2 (d = 5).');
  });

  it('never modifies the graph', () => {
    const arcs = g.getArcs();
    runToEnd(sim);
    expect(g.getArcs()).toEqual(arcs);
  });
});

describe('DijkstraSimulation on other graphs', () => {
  it('reads every weight as its magnitude (the positive view)', () => {
    g.directed = true;
    g.setWeight(s, y, -5); // |−5| = 5: the same distances as the book
    const sim = new DijkstraSimulation(positive(g), s);
    runToEnd(sim);
    expect(Object.fromEntries(sim.distance)).toEqual({ 0: 0, 1: 8, 2: 9, 3: 5, 4: 7 });
  });

  it('undirected: every edge can be travelled both ways', () => {
    // From x: undirected, x — t is 1, so t is 1, y is 1 + 2 = 3, z is 4, s is min(1 + 10, 3 + 5, 4 + 7) = 8.
    const sim = new DijkstraSimulation(positive(g, 'undirected'), x);
    runToEnd(sim);
    expect(Object.fromEntries(sim.distance)).toEqual({ 0: 8, 1: 1, 2: 0, 3: 3, 4: 4 });
  });

  it('stops once the rest are unreachable: they keep d = ∞, are never extracted, and stay in the queue', () => {
    g.addNode(0, 0); // 5, on its own
    const sim = new DijkstraSimulation(positive(g), s);
    expect(runToEnd(sim)).toBe(5);
    expect(sim.distance.get(5)).toBe(Infinity);
    expect(sim.highlight().done).not.toContain(5);
    expect(sim.highlight().labels![5]).toBe('∞');
    expect(sim.priorityQueueSnapshot().items).toEqual([5]);
    expect(sim.describe()).toContain('shortest paths from 0 to 5 of 6 vertices; 1 not reachable (d = ∞).');
  });

  it('directed: follows arcs forwards only', () => {
    const sim = new DijkstraSimulation(positive(g), x); // x → z (4) → s (11) → y (16) → t (16 + 3 = 19, not 11 + 10)
    runToEnd(sim);
    expect(Object.fromEntries(sim.distance)).toEqual({ 0: 11, 1: 19, 2: 0, 3: 16, 4: 4 });
  });

  it('on random graphs: the distances match Bellman–Ford, and every tree edge is tight', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let trial = 0; trial < 60; trial++) {
      const r = new Graph();
      const n = 1 + Math.floor(rand() * 9);
      for (let i = 0; i < n; i++) r.addNode(0, 0);
      r.directed = rand() < 0.5;
      for (let a = 0; a < n; a++)
        for (let b = 0; b < n; b++) if (a !== b && rand() < 0.3) r.addEdge(a, b, Math.floor(rand() * 21) - 10);
      const view = positive(r, r.directed ? 'directed' : 'undirected');
      const source = Math.floor(rand() * n);
      const sim = new DijkstraSimulation(view, source);
      // Every extraction is in nondecreasing order of d (the invariant behind Theorem 22.6).
      let lastD = -Infinity;
      while (!sim.finished) {
        const u = sim.highlight().current!;
        expect(sim.distance.get(u)!).toBeGreaterThanOrEqual(lastD);
        lastD = sim.distance.get(u)!;
        sim.step();
      }
      // Bellman–Ford, independently.
      const d = new Map(view.nodeIds().map((v) => [v, v === source ? 0 : Infinity]));
      for (let i = 0; i < n; i++)
        for (const { from, to, weight } of view.weightedEdges()) {
          for (const [a, b] of view.directed ? [[from, to]] : [[from, to], [to, from]]) {
            if (d.get(a)! + weight < d.get(b)!) d.set(b, d.get(a)! + weight);
          }
        }
      expect(Object.fromEntries(sim.distance)).toEqual(Object.fromEntries(d));
      for (const [p, v] of sim.predecessorEdges()) expect(sim.distance.get(v)).toBe(sim.distance.get(p)! + view.weight(p, v)!);
    }
  });
});
