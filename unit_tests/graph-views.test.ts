import { beforeEach, describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import { DirectedView, UndirectedView, type GraphView } from '../src/graph-views.js';

/**
 * Arcs used throughout (4 nodes):
 *   0 → 1, 1 → 0   (both ways)
 *   1 → 2          (one way)
 *   3 → 2          (one way)
 */
let g: Graph;

beforeEach(() => {
  g = new Graph();
  for (let i = 0; i < 4; i++) g.addNode(0, 0);
  g.directed = true; // so both directions between 0 and 1 can be added
  g.addEdge(0, 1);
  g.addEdge(1, 0);
  g.addEdge(1, 2);
  g.addEdge(3, 2);
  g.directed = false; // the views must not care
});

describe('access', () => {
  it('exposes both views at once, independent of graph.directed', () => {
    expect(g.directedView).toBeInstanceOf(DirectedView);
    expect(g.undirectedView).toBeInstanceOf(UndirectedView);
    expect(g.view('directed')).toBe(g.directedView);
    expect(g.view('undirected')).toBe(g.undirectedView);
    expect(g.directedView.orientation).toBe('directed');
    expect(g.directedView.directed).toBe(true);
    expect(g.undirectedView.orientation).toBe('undirected');
    expect(g.undirectedView.directed).toBe(false);
  });

  it('currentView follows graph.directed', () => {
    expect(g.currentView).toBe(g.undirectedView);
    g.directed = true;
    expect(g.currentView).toBe(g.directedView);
  });

  it('give the same answers whatever graph.directed is', () => {
    const snapshot = (v: GraphView) => ({ list: v.adjacencyList(), matrix: v.adjacencyMatrix(), edges: v.edges() });
    const before = [snapshot(g.directedView), snapshot(g.undirectedView)];
    g.directed = true;
    expect([snapshot(g.directedView), snapshot(g.undirectedView)]).toEqual(before);
  });
});

describe('DirectedView', () => {
  let v: DirectedView;
  beforeEach(() => {
    v = g.directedView;
  });

  it('neighbours are out-neighbours', () => {
    expect(v.neighbors(0)).toEqual([1]);
    expect(v.neighbors(1)).toEqual([0, 2]);
    expect(v.neighbors(2)).toEqual([]);
    expect(v.neighbors(3)).toEqual([2]);
    expect(v.outNeighbors(1)).toEqual(v.neighbors(1));
  });

  it('in-neighbours and degrees', () => {
    expect(v.inNeighbors(2)).toEqual([1, 3]);
    expect(v.inNeighbors(3)).toEqual([]);
    expect(v.inDegree(2)).toBe(2);
    expect(v.outDegree(1)).toBe(2);
    expect(v.degree(1)).toBe(2);
    expect(v.outDegree(99)).toBe(0);
  });

  it('every arc is its own edge', () => {
    expect(v.hasEdge(1, 2)).toBe(true);
    expect(v.hasEdge(2, 1)).toBe(false);
    expect(v.edges()).toEqual([
      [0, 1],
      [1, 0],
      [1, 2],
      [3, 2],
    ]);
    expect(v.edgeCount).toBe(4);
  });

  it('adjacency list and (asymmetric) matrix', () => {
    expect(v.adjacencyList()).toEqual([
      { id: 0, neighbors: [1] },
      { id: 1, neighbors: [0, 2] },
      { id: 2, neighbors: [] },
      { id: 3, neighbors: [2] },
    ]);
    expect(v.adjacencyMatrix()).toEqual({
      ids: [0, 1, 2, 3],
      matrix: [
        [0, 1, 0, 0],
        [1, 0, 1, 0],
        [0, 0, 0, 0],
        [0, 0, 1, 0],
      ],
    });
  });
});

describe('UndirectedView', () => {
  let v: UndirectedView;
  beforeEach(() => {
    v = g.undirectedView;
  });

  it('neighbours are arcs either way', () => {
    expect(v.neighbors(0)).toEqual([1]);
    expect(v.neighbors(1)).toEqual([0, 2]);
    expect(v.neighbors(2)).toEqual([1, 3]);
    expect(v.neighbors(3)).toEqual([2]);
    expect(v.degree(2)).toBe(2);
  });

  it('arcs both ways count once; a single arc counts both ways', () => {
    expect(v.hasEdge(0, 1)).toBe(true);
    expect(v.hasEdge(2, 1)).toBe(true);
    expect(v.edges()).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(v.edgeCount).toBe(3);
  });

  it('adjacency list and symmetric matrix', () => {
    expect(v.adjacencyList()).toEqual([
      { id: 0, neighbors: [1] },
      { id: 1, neighbors: [0, 2] },
      { id: 2, neighbors: [1, 3] },
      { id: 3, neighbors: [2] },
    ]);
    const { matrix } = v.adjacencyMatrix();
    expect(matrix).toEqual([
      [0, 1, 0, 0],
      [1, 0, 1, 0],
      [0, 1, 0, 1],
      [0, 0, 1, 0],
    ]);
  });

  it('connected components ignore direction', () => {
    g.addNode(0, 0); // isolated node 4
    expect(v.connectedComponents()).toEqual([[0, 1, 2, 3], [4]]);
    expect(g.connectedComponents()).toEqual(v.connectedComponents());
  });
});

describe('the two views of the same graph agree', () => {
  it('undirected neighbours = out-neighbours ∪ in-neighbours', () => {
    for (const id of g.directedView.nodeIds()) {
      const union = [...new Set([...g.directedView.outNeighbors(id), ...g.directedView.inNeighbors(id)])].sort((a, b) => a - b);
      expect(g.undirectedView.neighbors(id)).toEqual(union);
    }
  });

  it('undirected matrix = directed matrix OR its transpose', () => {
    const d = g.directedView.adjacencyMatrix().matrix;
    const u = g.undirectedView.adjacencyMatrix().matrix;
    d.forEach((row, i) => row.forEach((_, j) => expect(u[i][j]).toBe(d[i][j] || d[j][i] ? 1 : 0)));
  });

  it('every undirected edge comes from at least one arc, and every arc yields one', () => {
    const arcs = g.directedView.edges();
    for (const [a, b] of g.undirectedView.edges()) {
      expect(arcs.some(([x, y]) => (x === a && y === b) || (x === b && y === a))).toBe(true);
    }
    for (const [x, y] of arcs) expect(g.undirectedView.hasEdge(x, y)).toBe(true);
  });
});

describe('purity', () => {
  it('views are live: they reflect later edits', () => {
    const v = g.undirectedView;
    expect(v.neighbors(3)).toEqual([2]);
    g.directed = true;
    g.addEdge(0, 3);
    expect(v.neighbors(3)).toEqual([0, 2]);
    g.removeNode(2);
    expect(v.neighbors(3)).toEqual([0]);
  });

  it('returned data are copies: mutating them never changes the graph', () => {
    const v = g.directedView;
    v.neighbors(1).push(3);
    v.inNeighbors(2).length = 0;
    v.adjacencyList()[0].neighbors.push(2);
    v.adjacencyMatrix().matrix[0][3] = 1;
    v.edges().pop();
    v.nodeIds().pop();
    expect(v.neighbors(1)).toEqual([0, 2]);
    expect(v.inNeighbors(2)).toEqual([1, 3]);
    expect(v.adjacencyMatrix().matrix[0][3]).toBe(0);
    expect(v.edgeCount).toBe(4);
    expect(v.nodeIds()).toEqual([0, 1, 2, 3]);
  });

  it('reading never modifies the graph', () => {
    const arcs = g.getArcs();
    for (const v of [g.directedView, g.undirectedView]) {
      v.adjacencyList();
      v.adjacencyMatrix();
      v.edges();
      for (const id of v.nodeIds()) v.neighbors(id);
    }
    g.undirectedView.connectedComponents();
    expect(g.getArcs()).toEqual(arcs);
  });

  it('unknown nodes have no neighbours and no edges', () => {
    for (const v of [g.directedView, g.undirectedView]) {
      expect(v.neighbors(99)).toEqual([]);
      expect(v.hasEdge(99, 0)).toBe(false);
      expect(v.degree(99)).toBe(0);
    }
  });

  it('an empty graph has empty representations', () => {
    g.clear();
    for (const v of [g.directedView, g.undirectedView]) {
      expect(v.adjacencyList()).toEqual([]);
      expect(v.adjacencyMatrix()).toEqual({ ids: [], matrix: [] });
      expect(v.edgeCount).toBe(0);
    }
  });
});

describe('weighted and unweighted views', () => {
  // Same arcs as above, with weights: 0 → 1 = 5, 1 → 0 = 2, 1 → 2 = -3, 3 → 2 = 0 (default)
  beforeEach(() => {
    g.directed = true;
    g.setWeight(0, 1, 5);
    g.setWeight(1, 0, 2);
    g.setWeight(1, 2, -3);
    g.directed = false;
  });

  it('exposes six views, one per orientation × weighting', () => {
    const views = [
      g.view('directed', 'unweighted'),
      g.view('directed', 'weighted'),
      g.view('directed', 'positive'),
      g.view('undirected', 'unweighted'),
      g.view('undirected', 'weighted'),
      g.view('undirected', 'positive'),
    ];
    expect(new Set(views).size).toBe(6);
    expect(views.map((v) => [v.orientation, v.weighting])).toEqual([
      ['directed', 'unweighted'],
      ['directed', 'weighted'],
      ['directed', 'positive'],
      ['undirected', 'unweighted'],
      ['undirected', 'weighted'],
      ['undirected', 'positive'],
    ]);
    expect(g.view('directed')).toBe(g.directedView); // unweighted unless stated
    expect(g.view('directed', 'weighted').weighted).toBe(true);
  });

  it('currentView follows both graph.directed and graph.weighted', () => {
    expect(g.currentView).toBe(g.view('undirected', 'unweighted'));
    g.weighted = true;
    expect(g.currentView).toBe(g.view('undirected', 'weighted'));
    g.directed = true;
    expect(g.currentView).toBe(g.view('directed', 'weighted'));
  });

  it('new edges default to weight 0', () => {
    g.addNode(0, 0); // 4
    g.addEdge(4, 0);
    expect(g.arcWeight(4, 0)).toBe(0);
    expect(g.view('directed', 'weighted').weight(4, 0)).toBe(0);
  });

  it('directed weighted: every arc keeps its own stored weight', () => {
    const v = g.view('directed', 'weighted');
    expect(v.weight(0, 1)).toBe(5);
    expect(v.weight(1, 0)).toBe(2);
    expect(v.weight(2, 1)).toBeUndefined();
    expect(v.weightedNeighbors(1)).toEqual([
      { id: 0, weight: 2 },
      { id: 2, weight: -3 },
    ]);
    expect(v.weightedEdges()).toEqual([
      { from: 0, to: 1, weight: 5 },
      { from: 1, to: 0, weight: 2 },
      { from: 1, to: 2, weight: -3 },
      { from: 3, to: 2, weight: 0 },
    ]);
    expect(v.weightMatrix()).toEqual({
      ids: [0, 1, 2, 3],
      matrix: [
        [null, 5, null, null],
        [2, null, -3, null],
        [null, null, null, null],
        [null, null, 0, null],
      ],
    });
  });

  it('undirected weighted: one arc gives its weight; arcs both ways give the smaller', () => {
    const v = g.view('undirected', 'weighted');
    expect(v.weight(0, 1)).toBe(2); // min(5, 2)
    expect(v.weight(1, 0)).toBe(2);
    expect(v.weight(2, 1)).toBe(-3); // only 1 → 2 is stored
    expect(v.weightedEdges()).toEqual([
      { from: 0, to: 1, weight: 2 },
      { from: 1, to: 2, weight: -3 },
      { from: 2, to: 3, weight: 0 },
    ]);
    const { matrix } = v.weightMatrix();
    matrix.forEach((row, i) => row.forEach((w, j) => expect(w).toBe(matrix[j][i]))); // symmetric
    expect(v.weightedAdjacencyList()[2]).toEqual({
      id: 2,
      neighbors: [
        { id: 1, weight: -3 },
        { id: 3, weight: 0 },
      ],
    });
  });

  it('positive views read every weight as its magnitude; undirected, the smaller magnitude', () => {
    g.directed = true;
    g.setWeight(1, 0, -4); // 0 → 1 = 5, 1 → 0 = -4: the smaller magnitude is 4, not min(5, -4) = -4
    g.directed = false;
    const d = g.view('directed', 'positive');
    expect(d.weighting).toBe('positive');
    expect(d.weighted).toBe(true);
    expect(d.weight(0, 1)).toBe(5);
    expect(d.weight(1, 0)).toBe(4);
    expect(d.weight(1, 2)).toBe(3); // stored -3
    const u = g.view('undirected', 'positive');
    expect(u.weight(0, 1)).toBe(4);
    expect(u.weight(2, 1)).toBe(3);
    expect(u.weightedEdges().every(({ weight }) => weight >= 0)).toBe(true);
    expect(u.weightMatrix().matrix[1][2]).toBe(3);
    // Reading never changes the stored weights.
    expect(g.arcWeight(1, 2)).toBe(-3);
    expect(g.view('undirected', 'weighted').weight(0, 1)).toBe(-4);
    // currentView follows graph.weighting.
    g.weighting = 'positive';
    expect(g.currentView).toBe(u);
    expect(g.weighted).toBe(true);
    g.weighted = false;
    expect(g.weighting).toBe('unweighted');
  });

  it('unweighted views give every edge weight 1, whatever is stored', () => {
    for (const v of [g.view('directed', 'unweighted'), g.view('undirected', 'unweighted')]) {
      for (const { weight } of v.weightedEdges()) expect(weight).toBe(1);
      for (const row of v.weightMatrix().matrix) for (const w of row) expect([1, null]).toContain(w);
    }
    expect(g.view('undirected').weight(1, 2)).toBe(1);
    expect(g.view('undirected').weight(0, 3)).toBeUndefined();
  });

  it('weights never change the topology: same neighbours, edges and 0/1 matrix', () => {
    for (const o of ['directed', 'undirected'] as const) {
      const w = g.view(o, 'weighted');
      const u = g.view(o, 'unweighted');
      expect(w.edges()).toEqual(u.edges());
      expect(w.adjacencyList()).toEqual(u.adjacencyList());
      expect(w.adjacencyMatrix()).toEqual(u.adjacencyMatrix());
      for (const id of w.nodeIds()) expect(w.weightedNeighbors(id).map((n) => n.id)).toEqual(u.neighbors(id));
    }
  });

  it('weight matrix and weight() agree, with null exactly where there is no edge', () => {
    for (const o of ['directed', 'undirected'] as const) {
      const v = g.view(o, 'weighted');
      const { ids, matrix } = v.weightMatrix();
      ids.forEach((a, i) =>
        ids.forEach((b, j) => {
          expect(matrix[i][j]).toBe(v.weight(a, b) ?? null);
          expect(matrix[i][j] !== null).toBe(v.hasEdge(a, b));
        }),
      );
    }
  });

  it('weighted results are copies too', () => {
    const v = g.view('directed', 'weighted');
    v.weightedNeighbors(1)[0].weight = 99;
    v.weightedEdges()[0].weight = 99;
    v.weightMatrix().matrix[0][1] = 99;
    v.weightedAdjacencyList()[0].neighbors[0].weight = 99;
    expect(v.weight(1, 0)).toBe(2);
    expect(v.weight(0, 1)).toBe(5);
    expect(g.arcWeight(0, 1)).toBe(5);
  });
});
