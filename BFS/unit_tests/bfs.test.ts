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

  it('starts with nothing highlighted and asks for the first step', () => {
    expect(sim.finished).toBe(false);
    expect(sim.highlight()).toEqual({ current: null, done: [], activeEdges: [] });
    expect(sim.describe()).toBe('BFS from 0: press Update to take the first step.');
  });

  it('first step: the source becomes current, with its edges active', () => {
    sim.step();
    expect(sim.highlight()).toEqual({
      current: 0,
      done: [],
      activeEdges: [
        [0, 1],
        [0, 2],
      ],
    });
    expect(sim.queued).toEqual([1, 2]);
    expect(sim.describe()).toBe('Visiting 0: discovered 1, 2. Queue: 1, 2.');
  });

  it('each step finishes the previous vertex (green) and moves on in queue order', () => {
    sim.step(); // 0
    sim.step(); // 1
    expect(sim.highlight()).toEqual({
      current: 1,
      done: [0],
      activeEdges: [
        [1, 0],
        [1, 3],
      ],
    });
    expect(sim.describe()).toBe('Visiting 1: discovered 3. Queue: 2, 3.');
    sim.step(); // 2
    expect(sim.highlight().current).toBe(2);
    expect(sim.highlight().done).toEqual([0, 1]);
    expect(sim.describe()).toBe('Visiting 2: nothing new. Queue: 3.');
  });

  it('visits in BFS order with hop distances and a BFS tree', () => {
    runToEnd(sim);
    expect(sim.order).toEqual([0, 1, 2, 3]);
    expect(Object.fromEntries(sim.distance)).toEqual({ 0: 0, 1: 1, 2: 1, 3: 2 });
    expect(Object.fromEntries(sim.parent)).toEqual({ 0: null, 1: 0, 2: 0, 3: 1 });
  });

  it('takes one step per reachable vertex plus a final step that finishes the last one', () => {
    expect(runToEnd(sim)).toBe(4 + 1);
    expect(sim.finished).toBe(true);
    expect(sim.highlight()).toEqual({ current: null, done: [0, 1, 2, 3], activeEdges: [] });
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
    expect(sim.highlight()).toEqual(before);
  });

  it('can start anywhere', () => {
    const from3 = new BfsSimulation(g.undirectedView, 3);
    runToEnd(from3);
    expect(from3.order).toEqual([3, 1, 2, 0]);
  });

  it('an isolated source finishes after two steps', () => {
    const lonely = new BfsSimulation(g.undirectedView, 4);
    expect(runToEnd(lonely)).toBe(2);
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
    sim.step();
    expect(sim.highlight().activeEdges).toEqual([
      [0, 1],
      [0, 2],
    ]);
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
