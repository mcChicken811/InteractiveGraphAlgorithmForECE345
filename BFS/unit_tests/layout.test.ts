import { describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import { DEFAULT_LAYOUT_OPTIONS, ForceLayout } from '../src/layout.js';

const BOUNDS = { width: 1000, height: 750 };
const PAD = DEFAULT_LAYOUT_OPTIONS.padding;

/** Builds a graph with `n` nodes bunched around the centre (deterministic). */
function bunched(n: number, edges: Array<[number, number]> = [], spread = 40): Graph {
  const g = new Graph();
  for (let i = 0; i < n; i++) {
    g.addNode(500 + ((i * 37) % spread) - spread / 2, 375 + ((i * 53) % spread) - spread / 2);
  }
  for (const [a, b] of edges) g.addEdge(a, b);
  return g;
}

function dist(g: Graph, a: number, b: number): number {
  const p = g.getNode(a)!;
  const q = g.getNode(b)!;
  return Math.hypot(p.x - q.x, p.y - q.y);
}

function edgeLengths(g: Graph): number[] {
  return g.getEdges().map(([a, b]) => dist(g, a, b));
}

function minPairDistance(g: Graph): number {
  const ids = g.getNodes().map((n) => n.id);
  let min = Infinity;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) min = Math.min(min, dist(g, ids[i], ids[j]));
  }
  return min;
}

function path(n: number): Array<[number, number]> {
  return Array.from({ length: n - 1 }, (_, i) => [i, i + 1] as [number, number]);
}

function grid(rows: number, cols: number): Array<[number, number]> {
  const edges: Array<[number, number]> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (c < cols - 1) edges.push([i, i + 1]);
      if (r < rows - 1) edges.push([i, i + cols]);
    }
  }
  return edges;
}

describe('ForceLayout', () => {
  describe('ideal edge length', () => {
    const layout = new ForceLayout();

    it('is capped at maxEdgeLength for small graphs', () => {
      expect(layout.idealEdgeLength(BOUNDS, 2)).toBe(DEFAULT_LAYOUT_OPTIONS.maxEdgeLength);
    });

    it('shrinks as nodes are added, down to minEdgeLength', () => {
      const k20 = layout.idealEdgeLength(BOUNDS, 20);
      const k40 = layout.idealEdgeLength(BOUNDS, 40);
      expect(k40).toBeLessThan(k20);
      expect(layout.idealEdgeLength(BOUNDS, 10_000)).toBe(DEFAULT_LAYOUT_OPTIONS.minEdgeLength);
    });
  });

  describe('lifecycle', () => {
    it('is idle until reheated', () => {
      const g = bunched(3);
      const before = JSON.stringify(g.getNodes());
      const layout = new ForceLayout();
      expect(layout.running).toBe(false);
      expect(layout.step(g, BOUNDS)).toBe(0);
      expect(JSON.stringify(g.getNodes())).toBe(before);
    });

    it('settles and stops on its own', () => {
      const g = bunched(6, path(6));
      const layout = new ForceLayout();
      const steps = layout.settle(g, BOUNDS);
      expect(layout.running).toBe(false);
      expect(steps).toBeLessThan(1000);
    });

    it('stop() halts immediately', () => {
      const layout = new ForceLayout();
      layout.reheat();
      layout.stop();
      expect(layout.running).toBe(false);
    });

    it('handles an empty graph', () => {
      const layout = new ForceLayout();
      layout.reheat();
      expect(layout.step(new Graph(), BOUNDS)).toBe(0);
      expect(layout.running).toBe(false);
    });

    it('is deterministic', () => {
      const a = bunched(8, path(8));
      const b = bunched(8, path(8));
      new ForceLayout().settle(a, BOUNDS);
      new ForceLayout().settle(b, BOUNDS);
      expect(a.getNodes()).toEqual(b.getNodes());
    });
  });

  describe('resulting layout', () => {
    it('places a connected pair about one ideal edge length apart', () => {
      const g = bunched(2, [[0, 1]]);
      const layout = new ForceLayout();
      layout.settle(g, BOUNDS);
      const k = layout.idealEdgeLength(BOUNDS, 2);
      expect(dist(g, 0, 1)).toBeGreaterThan(0.85 * k);
      expect(dist(g, 0, 1)).toBeLessThan(1.15 * k);
    });

    it('draws a triangle as (nearly) equilateral', () => {
      const g = bunched(3, [
        [0, 1],
        [1, 2],
        [0, 2],
      ]);
      new ForceLayout().settle(g, BOUNDS);
      const lengths = edgeLengths(g);
      expect(Math.max(...lengths) / Math.min(...lengths)).toBeLessThan(1.05);
    });

    it('keeps adjacent nodes closer than non-adjacent ones on a path', () => {
      const g = bunched(5, path(5));
      new ForceLayout().settle(g, BOUNDS);
      expect(dist(g, 0, 2)).toBeGreaterThan(dist(g, 0, 1));
      expect(dist(g, 0, 4)).toBeGreaterThan(dist(g, 0, 2));
    });

    it('unfolds a grid into evenly sized edges', () => {
      const g = bunched(16, grid(4, 4), 200);
      new ForceLayout().settle(g, BOUNDS);
      const lengths = edgeLengths(g);
      expect(Math.max(...lengths) / Math.min(...lengths)).toBeLessThan(1.3);
    });

    it('spreads out isolated, bunched-up nodes without overlaps', () => {
      const g = bunched(12, [], 10);
      new ForceLayout().settle(g, BOUNDS);
      expect(minPairDistance(g)).toBeGreaterThan(60);
    });

    it('separates nodes placed on exactly the same spot', () => {
      const g = new Graph();
      for (let i = 0; i < 3; i++) g.addNode(400, 300);
      new ForceLayout().settle(g, BOUNDS);
      expect(minPairDistance(g)).toBeGreaterThan(60);
    });

    it('keeps disconnected components on screen and apart', () => {
      const g = bunched(8, [
        [0, 1],
        [1, 2],
        [2, 3],
        [4, 5],
        [5, 6],
        [6, 7],
      ]);
      new ForceLayout().settle(g, BOUNDS);
      expect(minPairDistance(g)).toBeGreaterThan(60);
      for (const n of g.getNodes()) {
        expect(n.x).toBeGreaterThanOrEqual(PAD);
        expect(n.x).toBeLessThanOrEqual(BOUNDS.width - PAD);
        expect(n.y).toBeGreaterThanOrEqual(PAD);
        expect(n.y).toBeLessThanOrEqual(BOUNDS.height - PAD);
      }
    });

    it('keeps every node inside the padded bounds, even when crowded', () => {
      const small = { width: 300, height: 200 };
      const g = bunched(30, path(30), 300);
      new ForceLayout().settle(g, small);
      for (const n of g.getNodes()) {
        expect(n.x).toBeGreaterThanOrEqual(PAD);
        expect(n.x).toBeLessThanOrEqual(small.width - PAD);
        expect(n.y).toBeGreaterThanOrEqual(PAD);
        expect(n.y).toBeLessThanOrEqual(small.height - PAD);
      }
    });

    it('never moves pinned nodes', () => {
      const g = bunched(4, path(4));
      const pinnedBefore = { ...g.getNode(1)! };
      const layout = new ForceLayout();
      layout.reheat();
      for (let i = 0; i < 200 && layout.running; i++) layout.step(g, BOUNDS, new Set([1]));
      expect(g.getNode(1)).toEqual(pinnedBefore);
      expect(dist(g, 0, 1)).toBeGreaterThan(60); // the others still moved around it
    });
  });
});
