import { beforeEach, describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import { DfsSimulation, EDGE_CLASS_LABELS, dfs } from '../src/algorithms/dfs.js';
import { ALGORITHMS } from '../src/algorithms/index.js';

/**
 * Arcs (stored as added):
 *
 *   0 → 1 → 2,  2 → 0,  0 → 2,      3 → 1,  3 → 4
 *
 * DFS from 0 (CLRS order: adjacency lists ascending, then the next white vertex):
 *   0 (1/6) → 1 (2/5) → 2 (3/4); 2 → 0 is a back edge; 0 → 2 a forward edge;
 *   new tree at 3 (7/10): 3 → 1 is a cross edge, 3 → 4 (8/9) a tree edge.
 */
let g: Graph;

beforeEach(() => {
  g = new Graph();
  for (let i = 0; i < 5; i++) g.addNode(i * 10, 0);
  g.directed = true; // so 0 → 2 can be added next to 2 → 0
  for (const [a, b] of [
    [0, 1],
    [1, 2],
    [2, 0],
    [0, 2],
    [3, 1],
    [3, 4],
  ]) g.addEdge(a, b);
});

function runToEnd(sim: DfsSimulation): number {
  let steps = 0;
  while (sim.step()) steps++;
  return steps;
}

describe('DFS registry entry', () => {
  it('is offered after BFS, and requires the unweighted, directed view', () => {
    expect(ALGORITHMS.map((a) => a.id)).toEqual(['bfs', 'dfs']);
    expect(dfs.name).toBe('Depth-first search');
    expect(dfs.requires).toEqual({ weighted: false, directed: true });
    expect(dfs.create(g.directedView, 0)).toBeInstanceOf(DfsSimulation);
  });

  it('tags back, forward and cross edges; tree edges stay plain', () => {
    expect(EDGE_CLASS_LABELS).toEqual({ tree: undefined, back: 'backward', forward: 'forward', cross: 'crossed' });
  });
});

describe('DfsSimulation (directed, CLRS)', () => {
  let sim: DfsSimulation;
  beforeEach(() => {
    sim = new DfsSimulation(g.directedView, 0);
  });

  it('starts with nothing discovered: the start vertex is white, about to be pushed', () => {
    expect(sim.finished).toBe(false);
    expect(sim.clock).toBe(0);
    expect(sim.highlight()).toEqual({
      current: 0,
      done: [],
      running: [],
      activeEdges: [],
      labels: {},
      exploredEdges: [],
    });
    expect(sim.stackSnapshot()).toEqual({ items: [], incoming: [0], popping: false });
    expect(sim.describe()).toBe('DFS from 0. Time 0. Press Update to discover 0.');
    expect([0, 1, 2, 3, 4].map((id) => sim.colorOf(id))).toEqual(['white', 'white', 'white', 'white', 'white']);
  });

  it('walks through the book’s steps: discover, explore each edge, finish', () => {
    const trace: string[] = [];
    while (sim.step()) trace.push(sim.describe());
    expect(trace).toEqual([
      'Discovered 0 at time 1. Stack: 0 (top first).',
      '0 → 1 is a tree edge: discovered 1 at time 2. Stack: 1, 0 (top first).',
      '1 → 2 is a tree edge: discovered 2 at time 3. Stack: 2, 1, 0 (top first).',
      '2 → 0 is a backward edge: 0 is still running (an ancestor of 2). Stack: 2, 1, 0 (top first).',
      'Finished 2 at time 4. Stack: 1, 0 (top first).',
      'Finished 1 at time 5. Stack: 0 (top first).',
      '0 → 2 is a forward edge: 2 already finished, a descendant of 0. Stack: 0 (top first).',
      'Finished 0 at time 6. Stack: empty.',
      'New tree: discovered 3 at time 7. Stack: 3 (top first).',
      '3 → 1 is a crossed edge: 1 already finished, not a descendant of 3. Stack: 3 (top first).',
      '3 → 4 is a tree edge: discovered 4 at time 8. Stack: 4, 3 (top first).',
      'Finished 4 at time 9. Stack: 3 (top first).',
      'DFS finished at time 10: 5 vertices in 2 trees; 3 tree, 1 backward, 1 forward, 1 crossed edges. ' +
        'A backward edge means a cycle, so there is no topological order. Press Finish.',
    ]);
  });

  it('gives every vertex the book’s discovery and finish times, and a depth-first forest', () => {
    runToEnd(sim);
    expect(Object.fromEntries(sim.discovery)).toEqual({ 0: 1, 1: 2, 2: 3, 3: 7, 4: 8 });
    expect(Object.fromEntries(sim.finish)).toEqual({ 0: 6, 1: 5, 2: 4, 3: 10, 4: 9 });
    expect(Object.fromEntries(sim.parent)).toEqual({ 0: null, 1: 0, 2: 1, 3: null, 4: 3 });
    expect(sim.trees).toEqual([0, 3]);
    expect(sim.edges).toEqual([
      { from: 0, to: 1, kind: 'tree' },
      { from: 1, to: 2, kind: 'tree' },
      { from: 2, to: 0, kind: 'back' },
      { from: 0, to: 2, kind: 'forward' },
      { from: 3, to: 1, kind: 'cross' },
      { from: 3, to: 4, kind: 'tree' },
    ]);
    expect([0, 1, 2, 3, 4].every((id) => sim.colorOf(id) === 'black')).toBe(true);
  });

  it('takes one step per vertex discovered, edge explored and vertex finished', () => {
    // 2 roots + 6 edges (tree edges also discover) + 5 finishes.
    expect(runToEnd(sim)).toBe(2 + 6 + 5);
    expect(sim.finished).toBe(true);
    expect(sim.step()).toBe(false);
  });

  it('white marks the vertex the next step works on and the edge it explores next', () => {
    sim.step(); // discover 0 → next: explore 0 → 1
    expect(sim.highlight()).toMatchObject({ current: 0, running: [0], activeEdges: [[0, 1]] });
    sim.step(); // 0 → 1 → next: explore 1 → 2
    expect(sim.highlight()).toMatchObject({ current: 1, running: [0, 1], activeEdges: [[1, 2]] });
    sim.step(); // 1 → 2 → next: explore 2 → 0
    expect(sim.highlight()).toMatchObject({ current: 2, activeEdges: [[2, 0]] });
    sim.step(); // 2 → 0 (back) → next: finish 2, no edge
    expect(sim.highlight()).toMatchObject({ current: 2, done: [], running: [0, 1, 2], activeEdges: [] });
    sim.step(); // finish 2 → next: finish 1
    expect(sim.highlight()).toMatchObject({ current: 1, done: [2], running: [0, 1], activeEdges: [] });
  });

  it('running (gray) vertices are exactly the stack; finished (black) ones are done', () => {
    for (let i = 0; i < 13; i++) {
      const h = sim.highlight();
      const gray = [0, 1, 2, 3, 4].filter((id) => sim.colorOf(id) === 'gray');
      const black = [0, 1, 2, 3, 4].filter((id) => sim.colorOf(id) === 'black');
      expect([...h.running!].sort()).toEqual(gray);
      expect([...sim.stacked].reverse()).toEqual(h.running);
      expect([...h.done].sort()).toEqual(black);
      sim.step();
    }
  });

  it('labels vertices "d," while running and "d,f" once finished; undiscovered ones stay blank', () => {
    sim.step();
    sim.step();
    sim.step();
    expect(sim.highlight().labels).toEqual({ 0: '1,', 1: '2,', 2: '3,' });
    sim.step();
    sim.step(); // finish 2
    expect(sim.highlight().labels).toEqual({ 0: '1,', 1: '2,', 2: '3,4' });
    runToEnd(sim);
    expect(sim.highlight().labels).toEqual({ 0: '1,6', 1: '2,5', 2: '3,4', 3: '7,10', 4: '8,9' });
  });

  it('lists explored edges with their tags, so the rest can be drawn dashed', () => {
    for (let i = 0; i < 4; i++) sim.step(); // up to the back edge 2 → 0
    expect(sim.highlight().exploredEdges).toEqual([
      { from: 0, to: 1, label: undefined },
      { from: 1, to: 2, label: undefined },
      { from: 2, to: 0, label: 'backward' },
    ]);
    runToEnd(sim);
    expect(sim.highlight().exploredEdges!.map((e) => e.label)).toEqual([
      undefined,
      undefined,
      'backward',
      'forward',
      'crossed',
      undefined,
    ]);
  });

  it('stack snapshot: top first, the vertex the next step pushes, and whether it pops', () => {
    const snaps = [sim.stackSnapshot()];
    while (sim.step()) snaps.push(sim.stackSnapshot());
    expect(snaps).toEqual([
      { items: [], incoming: [0], popping: false }, // next: discover 0
      { items: [0], incoming: [1], popping: false }, // next: 0 → 1 (tree)
      { items: [1, 0], incoming: [2], popping: false }, // next: 1 → 2 (tree)
      { items: [2, 1, 0], incoming: [], popping: false }, // next: 2 → 0 (back: no push)
      { items: [2, 1, 0], incoming: [], popping: true }, // next: finish 2
      { items: [1, 0], incoming: [], popping: true }, // next: finish 1
      { items: [0], incoming: [], popping: false }, // next: 0 → 2 (forward)
      { items: [0], incoming: [], popping: true }, // next: finish 0
      { items: [], incoming: [3], popping: false }, // next: new tree at 3
      { items: [3], incoming: [], popping: false }, // next: 3 → 1 (cross)
      { items: [3], incoming: [4], popping: false }, // next: 3 → 4 (tree)
      { items: [4, 3], incoming: [], popping: true }, // next: finish 4
      { items: [3], incoming: [], popping: true }, // next: finish 3
      { items: [], incoming: [], popping: false }, // done
    ]);
  });

  it('the stack snapshot agrees with the highlight', () => {
    do {
      const h = sim.highlight();
      const s = sim.stackSnapshot();
      if (s.items.length) expect(h.current).toBe(s.items[0]); // the top is white
      else expect(h.current).toBe(s.incoming[0] ?? null); // or the next root
      if (h.activeEdges.length && s.incoming.length) expect(h.activeEdges[0][1]).toBe(s.incoming[0]);
    } while (sim.step());
  });

  it('starts the outer loop at the chosen vertex', () => {
    const from3 = new DfsSimulation(g.directedView, 3);
    runToEnd(from3);
    expect(from3.trees).toEqual([3]); // everything is reachable from 3
    expect(Object.fromEntries(from3.discovery)).toEqual({ 3: 1, 1: 2, 2: 3, 0: 4, 4: 8 });
    // From 3: 3 → 1 → 2 → 0, so 0 → 1 and 0 → 2 lead back up the stack.
    expect(from3.edges.map((e) => `${e.from}${e.to}:${e.kind}`)).toEqual([
      '31:tree',
      '12:tree',
      '20:tree',
      '01:back',
      '02:back',
      '34:tree',
    ]);
  });

  it('then goes on with the other vertices in id order', () => {
    const from2 = new DfsSimulation(g.directedView, 2);
    runToEnd(from2);
    // 2 → 0 → 1 reaches 0, 1, 2; 3 is next in id order (4 is reached from it).
    expect(from2.trees).toEqual([2, 3]);
    expect(Object.fromEntries(from2.parent)).toEqual({ 2: null, 0: 2, 1: 0, 3: null, 4: 3 });
  });

  it('satisfies the parenthesis theorem and the edge-class time rules on random graphs', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let trial = 0; trial < 40; trial++) {
      const r = new Graph();
      const n = 2 + Math.floor(rand() * 9);
      for (let i = 0; i < n; i++) r.addNode(i * 10, 0);
      r.directed = true;
      for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (a !== b && rand() < 0.3) r.addEdge(a, b);
      const s = new DfsSimulation(r.directedView, Math.floor(rand() * n));
      runToEnd(s);
      const d = (v: number) => s.discovery.get(v)!;
      const f = (v: number) => s.finish.get(v)!;
      // Every vertex timestamped; times are 1..2n, each used once.
      expect([...s.discovery.values(), ...s.finish.values()].sort((x, y) => x - y)).toEqual(
        Array.from({ length: 2 * n }, (_, i) => i + 1),
      );
      // Parenthesis theorem (CLRS Theorem 20.7): intervals are disjoint or nested.
      for (let u = 0; u < n; u++)
        for (let v = 0; v < n; v++) {
          if (u === v) continue;
          const disjoint = f(u) < d(v) || f(v) < d(u);
          const nested = (d(u) < d(v) && f(v) < f(u)) || (d(v) < d(u) && f(u) < f(v));
          expect(disjoint || nested).toBe(true);
        }
      // Every arc explored exactly once, and classified consistently with the times
      // (CLRS Exercise 20.3-5).
      expect(s.edges).toHaveLength(r.edgeCount);
      for (const { from: u, to: v, kind } of s.edges) {
        if (kind === 'tree' || kind === 'forward') expect(d(u) < d(v) && f(v) < f(u)).toBe(true);
        if (kind === 'back') expect(d(v) <= d(u) && f(u) <= f(v)).toBe(true);
        if (kind === 'cross') expect(f(v) < d(u)).toBe(true);
        if (kind === 'tree') expect(s.parent.get(v)).toBe(u);
      }
    }
  });

  it('never modifies the graph', () => {
    const arcs = g.getArcs();
    runToEnd(sim);
    expect(g.getArcs()).toEqual(arcs);
  });

  it('a graph with no edges: every vertex is its own tree', () => {
    const lone = new Graph();
    for (let i = 0; i < 3; i++) lone.addNode(i * 10, 0);
    const s = new DfsSimulation(lone.directedView, 1);
    expect(runToEnd(s)).toBe(6); // discover + finish each
    expect(s.trees).toEqual([1, 0, 2]);
    expect(s.describe()).toBe(
      'DFS finished at time 6: 3 vertices in 3 trees; 0 tree, 0 backward, 0 forward, 0 crossed edges. ' +
        'No backward edge, so the graph is acyclic: press Topological sort, or Finish.',
    );
  });
});

describe('DfsSimulation (undirected view)', () => {
  it('explores each edge once, from whichever end gets there first: only tree and back edges', () => {
    const sim = new DfsSimulation(g.undirectedView, 0);
    const steps = runToEnd(sim);
    // Undirected edges: 0—1, 0—2, 1—2, 1—3, 3—4 (2 → 0 and 0 → 2 are one edge).
    // 1's list is [0, 2, 3]: 1—0 was already explored from 0, so it is skipped (no step);
    // 2—0 reaches 0 while it is still running: a back edge.
    expect(sim.edges.map((e) => `${e.from}—${e.to}:${e.kind}`)).toEqual([
      '0—1:tree',
      '1—2:tree',
      '2—0:back',
      '1—3:tree',
      '3—4:tree',
    ]);
    expect(steps).toBe(1 + 5 + 5); // one tree, five edges, five finishes
    expect(sim.edges.every((e) => e.kind === 'tree' || e.kind === 'back')).toBe(true);
  });

  it('describes undirected edges with a dash', () => {
    const sim = new DfsSimulation(g.undirectedView, 0);
    sim.step();
    sim.step();
    expect(sim.describe()).toBe('0 — 1 is a tree edge: discovered 1 at time 2. Stack: 1, 0 (top first).');
  });
});

describe('topological sort (CLRS §20.4)', () => {
  /** The fixture without its back edge 2 → 0: a DAG. */
  function dag(): Graph {
    g.removeEdge(2, 0);
    return g;
  }

  it('is only offered once DFS has finished', () => {
    const sim = new DfsSimulation(dag().directedView, 0);
    sim.step();
    expect(sim.topologicalSort()).toBeNull();
    runToEnd(sim);
    expect(sim.topologicalSort()).not.toBeNull();
  });

  it('orders the vertices by decreasing finish time, with tree edges as the spine and cross edges below', () => {
    const sim = new DfsSimulation(dag().directedView, 0);
    runToEnd(sim);
    // 0 (1,6) → 1 (2,5) → 2 (3,4); 0 → 2 forward; 3 (7,10) → 4 (8,9); 3 → 1 cross.
    expect(sim.hasCycle).toBe(false);
    expect(sim.topologicalSort()).toEqual({
      order: [3, 4, 0, 1, 2],
      spine: [
        [0, 1],
        [1, 2],
        [3, 4],
      ],
      below: [[3, 1]],
    });
  });

  it('is not available when DFS found a back edge (a cycle)', () => {
    const sim = new DfsSimulation(g.directedView, 0); // has 2 → 0
    runToEnd(sim);
    expect(sim.hasCycle).toBe(true);
    expect(sim.topologicalSort()).toBeNull();
  });

  it('on random graphs: exists exactly when the graph is acyclic, and every edge then points forward', () => {
    let seed = 11;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let acyclicSeen = 0;
    for (let trial = 0; trial < 60; trial++) {
      const r = new Graph();
      const n = 2 + Math.floor(rand() * 8);
      for (let i = 0; i < n; i++) r.addNode(i * 10, 0);
      r.directed = true;
      for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (a !== b && rand() < 0.22) r.addEdge(a, b);
      const s = new DfsSimulation(r.directedView, Math.floor(rand() * n));
      runToEnd(s);
      // Independent acyclicity check (Kahn's algorithm).
      const indeg = new Map(r.directedView.nodeIds().map((v) => [v, 0]));
      for (const [, b] of r.directedView.edges()) indeg.set(b, indeg.get(b)! + 1);
      const ready = [...indeg].filter(([, d]) => d === 0).map(([v]) => v);
      let removed = 0;
      while (ready.length) {
        const v = ready.pop()!;
        removed++;
        for (const w of r.directedView.neighbors(v)) {
          indeg.set(w, indeg.get(w)! - 1);
          if (indeg.get(w) === 0) ready.push(w);
        }
      }
      const acyclic = removed === n;
      const sort = s.topologicalSort();
      expect(sort !== null).toBe(acyclic); // Lemma 20.11
      if (!sort) continue;
      acyclicSeen++;
      expect([...sort.order].sort((x, y) => x - y)).toEqual(r.directedView.nodeIds());
      const rank = new Map(sort.order.map((v, i) => [v, i]));
      for (const [a, b] of r.directedView.edges()) expect(rank.get(a)!).toBeLessThan(rank.get(b)!); // Theorem 20.12
    }
    expect(acyclicSeen).toBeGreaterThan(5);
  });
});

describe('timestamps (for the chart)', () => {
  it('lists each discovered vertex’s interval on the row of its depth, with the clock', () => {
    const sim = new DfsSimulation(g.directedView, 0);
    expect(sim.timestamps()).toEqual({ clock: 0, end: 10, intervals: [], current: null }); // 0 not discovered yet
    for (let i = 0; i < 3; i++) sim.step(); // 0, 0 → 1, 1 → 2
    expect(sim.timestamps()).toEqual({
      clock: 3,
      end: 10,
      intervals: [
        { id: 0, start: 1, finish: null, depth: 0 },
        { id: 1, start: 2, finish: null, depth: 1 },
        { id: 2, start: 3, finish: null, depth: 2 },
      ],
      current: 2,
    });
    runToEnd(sim);
    expect(sim.timestamps()).toEqual({
      clock: 10,
      end: 10,
      intervals: [
        { id: 0, start: 1, finish: 6, depth: 0 },
        { id: 1, start: 2, finish: 5, depth: 1 },
        { id: 2, start: 3, finish: 4, depth: 2 },
        { id: 3, start: 7, finish: 10, depth: 0 }, // a second tree starts on the top row again
        { id: 4, start: 8, finish: 9, depth: 1 },
      ],
      current: null,
    });
  });

  it('a deeper row always sits inside the interval of its parent (parenthesis theorem)', () => {
    const sim = new DfsSimulation(g.directedView, 0);
    runToEnd(sim);
    const byId = new Map(sim.timestamps().intervals.map((i) => [i.id, i]));
    for (const [v, p] of sim.parent) {
      if (p === null) continue;
      const [child, parent] = [byId.get(v)!, byId.get(p)!];
      expect(child.depth).toBe(parent.depth + 1);
      expect(parent.start < child.start && child.finish! < parent.finish!).toBe(true);
    }
  });
});
