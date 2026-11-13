import { beforeEach, describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';

describe('Graph', () => {
  let g: Graph;

  beforeEach(() => {
    g = new Graph();
  });

  describe('nodes', () => {
    it('starts empty', () => {
      expect(g.nodeCount).toBe(0);
      expect(g.edgeCount).toBe(0);
      expect(g.getNodes()).toEqual([]);
      expect(g.getEdges()).toEqual([]);
    });

    it('assigns sequential ids and stores positions', () => {
      const a = g.addNode(10, 20);
      const b = g.addNode(30, 40);
      expect(a).toEqual({ id: 0, x: 10, y: 20 });
      expect(b).toEqual({ id: 1, x: 30, y: 40 });
      expect(g.nodeCount).toBe(2);
      expect(g.getNode(1)).toEqual({ id: 1, x: 30, y: 40 });
    });

    it('reuses the smallest free id after a removal', () => {
      g.addNode(0, 0);
      g.addNode(0, 0);
      g.addNode(0, 0);
      g.removeNode(1);
      expect(g.addNode(0, 0).id).toBe(1);
      expect(g.addNode(0, 0).id).toBe(3);
    });

    it('returns nodes sorted by id', () => {
      g.addNode(0, 0);
      g.addNode(0, 0);
      g.addNode(0, 0);
      g.removeNode(0);
      g.addNode(0, 0); // reuses id 0, inserted last
      expect(g.getNodes().map((n) => n.id)).toEqual([0, 1, 2]);
    });

    it('moves a node', () => {
      g.addNode(0, 0);
      g.moveNode(0, 50, 60);
      expect(g.getNode(0)).toMatchObject({ x: 50, y: 60 });
    });

    it('ignores moves and removals of unknown nodes', () => {
      expect(() => g.moveNode(42, 1, 1)).not.toThrow();
      expect(g.removeNode(42)).toBe(false);
      expect(g.getNode(42)).toBeUndefined();
    });

    it('removing a node removes its incident edges', () => {
      for (let i = 0; i < 4; i++) g.addNode(0, 0);
      g.addEdge(0, 1);
      g.addEdge(0, 2);
      g.addEdge(2, 3);
      expect(g.removeNode(0)).toBe(true);
      expect(g.getEdges()).toEqual([[2, 3]]);
      expect(g.neighbors(1)).toEqual([]);
      expect(g.neighbors(2)).toEqual([3]);
      expect(g.edgeCount).toBe(1);
    });
  });

  describe('edges', () => {
    beforeEach(() => {
      for (let i = 0; i < 4; i++) g.addNode(0, 0);
    });

    it('adds an undirected edge visible from both endpoints', () => {
      expect(g.addEdge(0, 1)).toBe(true);
      expect(g.hasEdge(0, 1)).toBe(true);
      expect(g.hasEdge(1, 0)).toBe(true);
      expect(g.neighbors(0)).toEqual([1]);
      expect(g.neighbors(1)).toEqual([0]);
      expect(g.edgeCount).toBe(1);
    });

    it('rejects duplicate edges in either direction', () => {
      g.addEdge(0, 1);
      expect(g.addEdge(0, 1)).toBe(false);
      expect(g.addEdge(1, 0)).toBe(false);
      expect(g.edgeCount).toBe(1);
    });

    it('rejects self-loops', () => {
      expect(g.addEdge(2, 2)).toBe(false);
      expect(g.edgeCount).toBe(0);
    });

    it('rejects edges to unknown nodes', () => {
      expect(g.addEdge(0, 99)).toBe(false);
      expect(g.addEdge(99, 0)).toBe(false);
      expect(g.neighbors(0)).toEqual([]);
    });

    it('lists each edge once as [min, max], sorted', () => {
      g.addEdge(3, 1);
      g.addEdge(2, 0);
      g.addEdge(1, 0);
      expect(g.getEdges()).toEqual([
        [0, 1],
        [0, 2],
        [1, 3],
      ]);
    });

    it('returns neighbors in ascending order regardless of insertion order', () => {
      g.addEdge(0, 3);
      g.addEdge(0, 1);
      g.addEdge(0, 2);
      expect(g.neighbors(0)).toEqual([1, 2, 3]);
    });

    it('removes an edge in either direction', () => {
      g.addEdge(0, 1);
      expect(g.removeEdge(1, 0)).toBe(true);
      expect(g.hasEdge(0, 1)).toBe(false);
      expect(g.hasEdge(1, 0)).toBe(false);
      expect(g.edgeCount).toBe(0);
    });

    it('returns false when removing a missing edge', () => {
      expect(g.removeEdge(0, 1)).toBe(false);
      expect(g.removeEdge(0, 99)).toBe(false);
    });

    it('returns no neighbors for an unknown node', () => {
      expect(g.neighbors(99)).toEqual([]);
    });
  });

  describe('directed storage, directed / undirected interpretation', () => {
    beforeEach(() => {
      for (let i = 0; i < 3; i++) g.addNode(0, 0);
    });

    it('defaults to undirected', () => {
      expect(g.directed).toBe(false);
    });

    it('always stores an edge as the arc first → second', () => {
      g.addEdge(1, 0);
      expect(g.hasArc(1, 0)).toBe(true);
      expect(g.hasArc(0, 1)).toBe(false);
      expect(g.getArcs()).toEqual([[1, 0]]);
    });

    it('undirected: a single arc counts as one edge both ways', () => {
      g.addEdge(1, 0);
      expect(g.hasEdge(0, 1)).toBe(true);
      expect(g.hasEdge(1, 0)).toBe(true);
      expect(g.getEdges()).toEqual([[0, 1]]);
      expect(g.edgeCount).toBe(1);
      expect(g.neighbors(0)).toEqual([1]);
      expect(g.neighbors(1)).toEqual([0]);
    });

    it('directed: a single arc is one edge, one way', () => {
      g.directed = true;
      g.addEdge(1, 0);
      expect(g.hasEdge(1, 0)).toBe(true);
      expect(g.hasEdge(0, 1)).toBe(false);
      expect(g.getEdges()).toEqual([[1, 0]]);
      expect(g.neighbors(1)).toEqual([0]);
      expect(g.neighbors(0)).toEqual([]);
    });

    it('directed mode allows the reverse arc; undirected treats the pair as one edge', () => {
      g.directed = true;
      expect(g.addEdge(0, 1)).toBe(true);
      expect(g.addEdge(1, 0)).toBe(true);
      expect(g.addEdge(0, 1)).toBe(false); // duplicate arc
      expect(g.getEdges()).toEqual([
        [0, 1],
        [1, 0],
      ]);
      expect(g.edgeCount).toBe(2);

      g.directed = false;
      expect(g.getEdges()).toEqual([[0, 1]]);
      expect(g.edgeCount).toBe(1);
      expect(g.neighbors(0)).toEqual([1]);
      expect(g.getArcs()).toHaveLength(2); // nothing was lost
    });

    it('undirected mode rejects the reverse of an existing arc', () => {
      g.addEdge(0, 1);
      expect(g.addEdge(1, 0)).toBe(false);
      expect(g.getArcs()).toEqual([[0, 1]]);
    });

    it('directed removal deletes one arc; undirected removal deletes both', () => {
      g.directed = true;
      g.addEdge(0, 1);
      g.addEdge(1, 0);
      expect(g.removeEdge(0, 1)).toBe(true);
      expect(g.getArcs()).toEqual([[1, 0]]);
      expect(g.removeEdge(0, 1)).toBe(false);

      g.addEdge(0, 1);
      g.directed = false;
      expect(g.removeEdge(0, 1)).toBe(true);
      expect(g.getArcs()).toEqual([]);
    });

    it('undirected removal works whichever way round the arc was stored', () => {
      g.addEdge(1, 0);
      expect(g.removeEdge(0, 1)).toBe(true);
      expect(g.getArcs()).toEqual([]);
    });

    it('switching modes never changes the stored arcs', () => {
      g.directed = true;
      g.addEdge(0, 1);
      g.addEdge(1, 0);
      g.addEdge(2, 1);
      const arcs = g.getArcs();
      g.directed = false;
      expect(g.getArcs()).toEqual(arcs);
      g.directed = true;
      expect(g.getArcs()).toEqual(arcs);
    });

    it('removing a node removes arcs into and out of it', () => {
      g.directed = true;
      g.addEdge(0, 1);
      g.addEdge(1, 2);
      g.addEdge(2, 1);
      g.removeNode(1);
      expect(g.getArcs()).toEqual([]);
      expect(g.neighbors(0)).toEqual([]);
      expect(g.neighbors(2)).toEqual([]);
    });

    it('representations follow the mode', () => {
      g.addEdge(0, 1);
      g.addEdge(2, 1);
      g.directed = true;
      expect(g.adjacencyList()).toEqual([
        { id: 0, neighbors: [1] },
        { id: 1, neighbors: [] },
        { id: 2, neighbors: [1] },
      ]);
      expect(g.adjacencyMatrix().matrix).toEqual([
        [0, 1, 0],
        [0, 0, 0],
        [0, 1, 0],
      ]);

      g.directed = false;
      expect(g.adjacencyList()).toEqual([
        { id: 0, neighbors: [1] },
        { id: 1, neighbors: [0, 2] },
        { id: 2, neighbors: [1] },
      ]);
      expect(g.adjacencyMatrix().matrix).toEqual([
        [0, 1, 0],
        [1, 0, 1],
        [0, 1, 0],
      ]);
    });

    it('arcs both ways appear once in the undirected matrix (as a single 1 per cell)', () => {
      g.directed = true;
      g.addEdge(0, 1);
      g.addEdge(1, 0);
      g.directed = false;
      expect(g.adjacencyMatrix().matrix).toEqual([
        [0, 1, 0],
        [1, 0, 0],
        [0, 0, 0],
      ]);
    });

    it('connected components ignore direction (weakly connected)', () => {
      g.directed = true;
      g.addEdge(0, 1);
      g.addEdge(2, 1);
      expect(g.connectedComponents()).toEqual([[0, 1, 2]]);
    });
  });

  describe('representations', () => {
    beforeEach(() => {
      for (let i = 0; i < 4; i++) g.addNode(0, 0);
      g.addEdge(0, 1);
      g.addEdge(0, 2);
      g.addEdge(2, 3);
    });

    it('adjacencyList gives every node with its sorted neighbours', () => {
      expect(g.adjacencyList()).toEqual([
        { id: 0, neighbors: [1, 2] },
        { id: 1, neighbors: [0] },
        { id: 2, neighbors: [0, 3] },
        { id: 3, neighbors: [2] },
      ]);
    });

    it('adjacencyMatrix is a symmetric 0/1 matrix with an empty diagonal', () => {
      const { ids, matrix } = g.adjacencyMatrix();
      expect(ids).toEqual([0, 1, 2, 3]);
      expect(matrix).toEqual([
        [0, 1, 1, 0],
        [1, 0, 0, 0],
        [1, 0, 0, 1],
        [0, 0, 1, 0],
      ]);
      matrix.forEach((row, i) => row.forEach((v, j) => expect(v).toBe(matrix[j][i])));
    });

    it('labels matrix rows and columns by id when ids have gaps', () => {
      g.removeNode(1);
      const { ids, matrix } = g.adjacencyMatrix();
      expect(ids).toEqual([0, 2, 3]);
      expect(matrix).toEqual([
        [0, 1, 0],
        [1, 0, 1],
        [0, 1, 0],
      ]);
    });

    it('both representations agree on every edge', () => {
      const { ids, matrix } = g.adjacencyMatrix();
      const list = g.adjacencyList();
      ids.forEach((a, i) =>
        ids.forEach((b, j) => {
          expect(matrix[i][j] === 1).toBe(list[i].neighbors.includes(b));
          expect(matrix[i][j] === 1).toBe(g.hasEdge(a, b));
        }),
      );
    });

    it('are empty for an empty graph', () => {
      g.clear();
      expect(g.adjacencyList()).toEqual([]);
      expect(g.adjacencyMatrix()).toEqual({ ids: [], matrix: [] });
    });
  });

  describe('connectedComponents', () => {
    it('returns nothing for an empty graph', () => {
      expect(g.connectedComponents()).toEqual([]);
    });

    it('treats isolated nodes as their own components', () => {
      for (let i = 0; i < 3; i++) g.addNode(0, 0);
      expect(g.connectedComponents()).toEqual([[0], [1], [2]]);
    });

    it('groups nodes by reachability, largest first, BFS order inside', () => {
      for (let i = 0; i < 7; i++) g.addNode(0, 0);
      g.addEdge(5, 6); // component {5, 6}
      g.addEdge(1, 3); // component {1, 2, 3, 4}: 1-3, 1-2, 3-4
      g.addEdge(1, 2);
      g.addEdge(3, 4);
      // node 0 is isolated
      expect(g.connectedComponents()).toEqual([[1, 2, 3, 4], [5, 6], [0]]);
    });

    it('orders equal-sized components by their smallest id', () => {
      for (let i = 0; i < 4; i++) g.addNode(0, 0);
      g.addEdge(2, 3);
      g.addEdge(0, 1);
      expect(g.connectedComponents()).toEqual([
        [0, 1],
        [2, 3],
      ]);
    });

    it('updates when edges are removed', () => {
      for (let i = 0; i < 3; i++) g.addNode(0, 0);
      g.addEdge(0, 1);
      g.addEdge(1, 2);
      expect(g.connectedComponents()).toHaveLength(1);
      g.removeEdge(0, 1);
      expect(g.connectedComponents()).toEqual([[1, 2], [0]]);
    });
  });

  it('clear() removes everything and restarts ids at 0', () => {
    g.addNode(0, 0);
    g.addNode(0, 0);
    g.addEdge(0, 1);
    g.clear();
    expect(g.nodeCount).toBe(0);
    expect(g.edgeCount).toBe(0);
    expect(g.addNode(0, 0).id).toBe(0);
  });
});
