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
