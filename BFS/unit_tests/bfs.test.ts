import { beforeEach, describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import { BfsSimulation, bfs } from '../src/algorithms/bfs.js';
import { ALGORITHMS } from '../src/algorithms/index.js';

/**
 *   0 — 1 — 3
 *   |       |
 *   2 ——————     (2 — 3)      4 isolated
 *
 * Arcs stored as added: 0→1, 0→2, 1→3, 3→2 (note: 3 → 2, against reading order).
 */
let g: Graph;

beforeEach(() => {
  g = new Graph();
  for (let i = 0; i < 5; i++) g.addNode(i * 10, 0);
  g.addEdge(0, 1);
  g.addEdge(0, 2);
  g.addEdge(1, 3);
  g.addEdge(3, 2);
});

/** Runs a simulation to the end and returns how many steps it took. */
function runToEnd(sim: BfsSimulation): number {
  let steps = 0;
  while (sim.step()) steps++;
  return steps;
}

describe('BFS registry entry', () => {
  it('is the only algorithm offered for now, and requires the unweighted view', () => {
    expect(ALGORITHMS.map((a) => a.id)).toEqual(['bfs']);
    expect(bfs.name).toBe('Breadth-first search');
    expect(bfs.requires).toEqual({ weighted: false });
    expect(bfs.create(g.undirectedView, 0)).toBeInstanceOf(BfsSimulation);
  });
});

describe('BfsSimulation (undirected)', () => {
  let sim: BfsSimulation;
  beforeEach(() => {
    sim = new BfsSimulation(g.undirectedView, 0);
  });

  it('starts with the source at the front of the queue: white, with the edges it will travel', () => {
    expect(sim.finished).toBe(false);
    expect(sim.queued).toEqual([0]);
    expect(sim.highlight()).toMatchObject({
      current: 0,
      done: [],
      activeEdges: [
        [0, 1],
        [0, 2],
      ],
    });
    expect(sim.describe()).toBe('BFS from 0. Queue: 0. Press Update to pop 0.');
  });

  it('a step pops the front vertex (green) and the new front turns white', () => {
    sim.step(); // pop 0, discover 1, 2
    expect(sim.queued).toEqual([1, 2]);
    expect(sim.highlight()).toMatchObject({
      current: 1, // next to be popped
      done: [0],
      activeEdges: [[1, 3]], // 1 → 0 is not travelled: 0 is already discovered
    });
    expect(sim.describe()).toBe('Popped 0: discovered 1, 2. Queue: 1, 2.');
  });

  it('the queue text always includes the white (front) vertex', () => {
    for (let i = 0; i < 3; i++) {
      sim.step();
      const { current } = sim.highlight();
      expect(sim.queued[0]).toBe(current);
      expect(sim.describe()).toContain(`Queue: ${sim.queued.join(', ')}.`);
    }
  });

  it('white edges are only those the next pop will travel (to undiscovered neighbours)', () => {
    sim.step(); // pop 0 → queue 1, 2
    sim.step(); // pop 1 → discovers 3 → queue 2, 3
    expect(sim.highlight()).toMatchObject({ current: 2, done: [0, 1], activeEdges: [] }); // 0 and 3 already known
    expect(sim.describe()).toBe('Popped 1: discovered 3. Queue: 2, 3.');
    sim.step(); // pop 2 → nothing new → queue 3
    expect(sim.highlight()).toMatchObject({ current: 3, done: [0, 1, 2], activeEdges: [] });
    expect(sim.describe()).toBe('Popped 2: nothing new. Queue: 3.');
  });

  it('queue snapshot: the queue front first, then what the next pop will push', () => {
    expect(sim.queueSnapshot()).toEqual({ items: [0], incoming: [1, 2] });
    sim.step(); // pop 0 → queue 1, 2; popping 1 next will push 3
    expect(sim.queueSnapshot()).toEqual({ items: [1, 2], incoming: [3] });
    sim.step(); // pop 1 → queue 2, 3; 2 has nothing new
    expect(sim.queueSnapshot()).toEqual({ items: [2, 3], incoming: [] });
    runToEnd(sim);
    expect(sim.queueSnapshot()).toEqual({ items: [], incoming: [] });
  });

  it('queue snapshot agrees with the highlight', () => {
    for (let i = 0; i < 4; i++) {
      const { items, incoming } = sim.queueSnapshot();
      const h = sim.highlight();
      expect(h.current).toBe(items[0] ?? null);
      expect(h.activeEdges.map(([, w]) => w)).toEqual(incoming);
      sim.step();
    }
  });

  it('labels each vertex with its distance from the source once it is discovered', () => {
    expect(sim.highlight().labels).toEqual({ 0: '0' }); // only the source is known at first
    sim.step(); // pop 0 → discovers 1, 2 at distance 1
    expect(sim.highlight().labels).toEqual({ 0: '0', 1: '1', 2: '1' });
    sim.step(); // pop 1 → discovers 3 at distance 2
    expect(sim.highlight().labels).toEqual({ 0: '0', 1: '1', 2: '1', 3: '2' });
    runToEnd(sim);
    expect(sim.highlight().labels).not.toHaveProperty('4'); // unreachable: never labelled
  });

  it('distances along the queue never decrease (the BFS invariant)', () => {
    for (let i = 0; i < 4; i++) {
      const { labels } = sim.highlight();
      const ds = sim.queued.map((id) => Number(labels![id]));
      for (let j = 1; j < ds.length; j++) expect(ds[j]).toBeGreaterThanOrEqual(ds[j - 1]);
      expect(Math.max(...ds) - Math.min(...ds)).toBeLessThanOrEqual(1);
      sim.step();
    }
  });

  it('visits in BFS order with hop distances and a BFS tree', () => {
    runToEnd(sim);
    expect(sim.order).toEqual([0, 1, 2, 3]);
    expect(Object.fromEntries(sim.distance)).toEqual({ 0: 0, 1: 1, 2: 1, 3: 2 });
    expect(Object.fromEntries(sim.parent)).toEqual({ 0: null, 1: 0, 2: 0, 3: 1 });
  });

  it('takes exactly one step per reachable vertex', () => {
    expect(runToEnd(sim)).toBe(4);
    expect(sim.finished).toBe(true);
    expect(sim.highlight()).toMatchObject({ current: null, done: [0, 1, 2, 3], activeEdges: [] });
  });

  it('leaves unreachable vertices undiscovered and says so', () => {
    runToEnd(sim);
    expect(sim.highlight().done).not.toContain(4);
    expect(sim.describe()).toBe(
      'BFS finished: visited 4 of 5 vertices (order 0, 1, 2, 3). 1 not reachable from 0. Press Finish.',
    );
  });

  it('does nothing once finished', () => {
    runToEnd(sim);
    const before = sim.highlight();
    expect(sim.step()).toBe(false);
    expect(sim.highlight()).toMatchObject(before);
  });

  it('can start anywhere', () => {
    const from3 = new BfsSimulation(g.undirectedView, 3);
    runToEnd(from3);
    expect(from3.order).toEqual([3, 1, 2, 0]);
  });

  it('an isolated source finishes after one step', () => {
    const lonely = new BfsSimulation(g.undirectedView, 4);
    expect(lonely.highlight()).toMatchObject({ current: 4, done: [], activeEdges: [] });
    expect(runToEnd(lonely)).toBe(1);
    expect(lonely.order).toEqual([4]);
    expect(lonely.describe()).toContain('visited 1 of 5 vertices');
  });

  it('never modifies the graph', () => {
    const arcs = g.getArcs();
    runToEnd(sim);
    expect(g.getArcs()).toEqual(arcs);
  });
});

describe('BfsSimulation (directed)', () => {
  it('follows arcs only forwards, and highlights only out-edges', () => {
    const sim = new BfsSimulation(g.directedView, 0);
    expect(sim.highlight().activeEdges).toEqual([
      [0, 1],
      [0, 2],
    ]);
    sim.step(); // pop 0 → queue 1, 2; 1's only out-arc leads to 3
    expect(sim.highlight()).toMatchObject({ current: 1, done: [0], activeEdges: [[1, 3]] });
    runToEnd(sim);
    // 2 has no out-arcs; 3 is reached via 1 → 3. 3 → 2 is not needed (2 already found).
    expect(sim.order).toEqual([0, 1, 2, 3]);
  });

  it('cannot go against an arc', () => {
    const sim = new BfsSimulation(g.directedView, 2); // 2 has no outgoing arcs
    runToEnd(sim);
    expect(sim.order).toEqual([2]);
  });

  it('reaches 2 from 3 but not 3 from 2', () => {
    const from3 = new BfsSimulation(g.directedView, 3);
    runToEnd(from3);
    expect(from3.order).toEqual([3, 2]);
  });
});
