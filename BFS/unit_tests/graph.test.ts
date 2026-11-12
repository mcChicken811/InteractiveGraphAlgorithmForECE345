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
