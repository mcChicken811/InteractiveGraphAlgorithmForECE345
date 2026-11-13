import { describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import { DEFAULT_LAYOUT_OPTIONS, ForceLayout, packRows } from '../src/layout.js';

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

  describe('disconnected graphs', () => {
    /** Bounding boxes (node centres ± padding) of each connected component. */
    function componentBoxes(g: Graph) {
      return g.connectedComponents().map((ids) => {
        const xs = ids.map((id) => g.getNode(id)!.x);
        const ys = ids.map((id) => g.getNode(id)!.y);
        return {
          minX: Math.min(...xs) - PAD,
          maxX: Math.max(...xs) + PAD,
          minY: Math.min(...ys) - PAD,
          maxY: Math.max(...ys) + PAD,
        };
      });
    }

    function expectNoComponentOverlap(g: Graph): void {
      const boxes = componentBoxes(g);
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          const overlap = a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
          expect(overlap, `components ${i} and ${j} overlap`).toBe(false);
        }
      }
    }

    function expectOffTheWalls(g: Graph): void {
      for (const n of g.getNodes()) {
        expect(n.x).toBeGreaterThan(PAD + 1);
        expect(n.x).toBeLessThan(BOUNDS.width - PAD - 1);
        expect(n.y).toBeGreaterThan(PAD + 1);
        expect(n.y).toBeLessThan(BOUNDS.height - PAD - 1);
      }
    }

    function cycle(offset: number, n: number): Array<[number, number]> {
      return Array.from({ length: n }, (_, i) => [offset + i, offset + ((i + 1) % n)] as [number, number]);
    }

    it('settles on its own instead of drifting until it cools down', () => {
      const g = bunched(17, cycle(0, 12), 300); // a 12-cycle plus 5 isolated nodes
      const layout = new ForceLayout();
      const steps = layout.settle(g, BOUNDS);
      expect(layout.running).toBe(false);
      expect(steps).toBeLessThan(300);

      // Re-heating a settled layout barely moves it.
      const settled = g.getNodes().map((n) => ({ ...n }));
      layout.reheat(0.2);
      for (let i = 0; i < 50; i++) layout.step(g, BOUNDS);
      for (const n of g.getNodes()) {
        const before = settled.find((s) => s.id === n.id)!;
        expect(Math.hypot(n.x - before.x, n.y - before.y)).toBeLessThan(5);
      }
    });

    it('keeps components apart and off the walls', () => {
      const g = bunched(24, [...cycle(0, 8), ...cycle(8, 8), ...cycle(16, 8)], 300);
      new ForceLayout().settle(g, BOUNDS);
      expectNoComponentOverlap(g);
      expectOffTheWalls(g);
    });

    it('packs many isolated nodes into a tidy block instead of pushing them to the walls', () => {
      const g = bunched(20, [], 300);
      new ForceLayout().settle(g, BOUNDS);
      expectOffTheWalls(g);
      expect(minPairDistance(g)).toBeGreaterThan(2 * PAD);
    });

    it('frees an isolated node that starts trapped inside a cycle', () => {
      const g = new Graph();
      for (let i = 0; i < 12; i++) {
        g.addNode(500 + 200 * Math.cos((i / 12) * 2 * Math.PI), 375 + 200 * Math.sin((i / 12) * 2 * Math.PI));
      }
      g.addNode(500, 375); // node 12, in the middle of the ring
      for (const [a, b] of cycle(0, 12)) g.addEdge(a, b);
      new ForceLayout().settle(g, BOUNDS);
      expectNoComponentOverlap(g);
    });

    it('lays out each component as if it were alone', () => {
      // Two triangles: each should be equilateral, with side ≈ k, despite the other.
      const g = bunched(6, [...cycle(0, 3), ...cycle(3, 3)], 300);
      const layout = new ForceLayout();
      layout.settle(g, BOUNDS);
      const k = layout.idealEdgeLength(BOUNDS, 6);
      for (const len of edgeLengths(g)) {
        expect(len).toBeGreaterThan(0.9 * k);
        expect(len).toBeLessThan(1.1 * k);
      }
    });

    it('centres the packed drawing on the canvas', () => {
      const g = bunched(10, [
        [0, 1],
        [2, 3],
        [4, 5],
        [6, 7],
        [8, 9],
      ]);
      new ForceLayout().settle(g, BOUNDS);
      const xs = g.getNodes().map((n) => n.x);
      const ys = g.getNodes().map((n) => n.y);
      expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(BOUNDS.width / 2, -1);
      expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(BOUNDS.height / 2, -1);
    });
  });

  describe('fitting large components', () => {
    it('turns a long path to lie along the canvas’s longer side', () => {
      const g = bunched(10, path(10), 30);
      new ForceLayout().settle(g, BOUNDS);
      const xs = g.getNodes().map((n) => n.x);
      const ys = g.getNodes().map((n) => n.y);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(Math.max(...ys) - Math.min(...ys));
      for (const n of g.getNodes()) {
        expect(n.x).toBeGreaterThan(PAD + 1); // fits without touching the walls
        expect(n.x).toBeLessThan(BOUNDS.width - PAD - 1);
      }
    });

    it('never lets two nodes overlap', () => {
      // A start that folds the grid: FR is a local optimiser, so folding can happen,
      // but the collision pass must still keep node circles apart.
      const g = bunched(25, grid(5, 5), 200);
      new ForceLayout().settle(g, BOUNDS);
      expect(minPairDistance(g)).toBeGreaterThanOrEqual(2 * PAD - 0.5);
    });

    it('unfolds grids from random starts', () => {
      let seed = 1;
      const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let trial = 0; trial < 10; trial++) {
        const g = new Graph();
        for (let i = 0; i < 25; i++) g.addNode(400 + random() * 200, 275 + random() * 200);
        for (const [a, b] of grid(5, 5)) g.addEdge(a, b);
        new ForceLayout().settle(g, BOUNDS);
        const lengths = edgeLengths(g);
        expect(Math.max(...lengths) / Math.min(...lengths)).toBeLessThan(1.5);
      }
    });
  });

  describe('packRows', () => {
    it('returns nothing for no boxes', () => {
      expect(packRows([], BOUNDS, 10)).toEqual({ centers: [], width: 0, height: 0 });
    });

    it('centres a single box on the canvas', () => {
      const { centers } = packRows([{ width: 100, height: 50 }], BOUNDS, 10);
      expect(centers).toEqual([{ x: 500, y: 375 }]);
    });

    it('places boxes in rows without overlap and wraps to keep the canvas aspect ratio', () => {
      const sizes = Array.from({ length: 9 }, () => ({ width: 100, height: 100 }));
      const { centers, width, height } = packRows(sizes, BOUNDS, 20);
      // 9 equal squares on a 4:3 canvas → rows of 3 or 4, not one long row.
      expect(new Set(centers.map((c) => c.y)).size).toBeGreaterThan(1);
      expect(width).toBeLessThan(BOUNDS.width);
      expect(height).toBeLessThan(BOUNDS.height);
      for (let i = 0; i < centers.length; i++) {
        for (let j = i + 1; j < centers.length; j++) {
          const apart =
            Math.abs(centers[i].x - centers[j].x) >= 120 - 1e-9 || Math.abs(centers[i].y - centers[j].y) >= 120 - 1e-9;
          expect(apart).toBe(true);
        }
      }
    });

    it('keeps the input order (largest component first) in reading order', () => {
      const { centers } = packRows(
        [
          { width: 300, height: 200 },
          { width: 100, height: 100 },
          { width: 100, height: 100 },
        ],
        BOUNDS,
        20,
      );
      const order = centers
        .map((c, i) => ({ ...c, i }))
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map((c) => c.i);
      expect(order[0]).toBe(0);
    });
  });
});
