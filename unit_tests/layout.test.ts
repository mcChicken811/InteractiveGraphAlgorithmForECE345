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

    it('does not zig-zag: nodes of dense graphs do not flip direction frame after frame', () => {
      // A single global step overshoots at high-degree nodes (their springs add up) and the
      // fastest mode flips sign every frame until the layout has cooled down; scaling each
      // node's step by its own stiffness keeps it stable whatever the degree.
      let seed = 4;
      const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (const [n, m] of [
        [16, 32],
        [25, 60],
        [30, 80],
      ]) {
        const g = new Graph();
        for (let i = 0; i < n; i++) g.addNode(100 + random() * 800, 100 + random() * 550);
        for (let i = 1; i < n; i++) g.addEdge(Math.floor(random() * i), i);
        while (g.edgeCount < m) {
          const [a, b] = [Math.floor(random() * n), Math.floor(random() * n)];
          if (a !== b && !g.hasEdge(a, b)) g.addEdge(a, b);
        }
        expect(Math.max(...g.getNodes().map((v) => g.undirectedView.degree(v.id)))).toBeGreaterThanOrEqual(6); // hubs: where the global step overshot
        const layout = new ForceLayout();
        layout.reheat();
        const last = new Map(g.getNodes().map((v) => [v.id, { x: v.x, y: v.y }]));
        const prev = new Map<number, { x: number; y: number }>();
        let steps = 0;
        let zigzag = 0;
        while (layout.running && steps < 1000) {
          layout.step(g, BOUNDS);
          steps++;
          let reversed = 0;
          for (const v of g.getNodes()) {
            const l = last.get(v.id)!;
            const move = { x: v.x - l.x, y: v.y - l.y };
            const p = prev.get(v.id);
            const [a, b] = [Math.hypot(move.x, move.y), p ? Math.hypot(p.x, p.y) : 0];
            if (p && a > 0.05 && b > 0.05 && (move.x * p.x + move.y * p.y) / (a * b) < -0.5) reversed++;
            prev.set(v.id, move);
            last.set(v.id, { x: v.x, y: v.y });
          }
          if (reversed > 0.1 * n) zigzag++;
        }
        expect(zigzag / steps).toBeLessThan(0.03); // the global step zig-zagged in over 90% of frames
      }
    });

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

    it('unfolds grids from random starts (nearly always: a fold is a local minimum)', () => {
      // A force-directed layout can settle in a local minimum, a grid folded over itself,
      // from an unlucky start; Fruchterman–Reingold's does too. Over 50 random starts the
      // old global step folded 5 and the stiffness-scaled one folds 3; demand at most 5.
      let seed = 1;
      const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      let folded = 0;
      for (let trial = 0; trial < 50; trial++) {
        const g = new Graph();
        for (let i = 0; i < 25; i++) g.addNode(400 + random() * 200, 275 + random() * 200);
        for (const [a, b] of grid(5, 5)) g.addEdge(a, b);
        new ForceLayout().settle(g, BOUNDS);
        const lengths = edgeLengths(g);
        if (Math.max(...lengths) / Math.min(...lengths) >= 1.5) folded++;
      }
      expect(folded).toBeLessThanOrEqual(5);
    });
  });

  describe('weighted edge lengths', () => {
    const weighted = (g: Graph) => (a: number, b: number) => g.view('undirected', 'weighted').weight(a, b) ?? 0;
    const d = (g: Graph, a: number, b: number) => Math.hypot(g.getNode(a)!.x - g.getNode(b)!.x, g.getNode(a)!.y - g.getNode(b)!.y);

    it('length factors: weight over the mean weight, clamped; equal or no weights give 1', () => {
      const g = new Graph();
      for (let i = 0; i < 5; i++) g.addNode(i * 10, 0);
      g.addEdge(0, 1, 2);
      g.addEdge(1, 2, 4);
      g.addEdge(2, 3, 6); // mean 4 (with 3 — 4 at 0 left out of the mean)
      g.addEdge(3, 4, 0);
      const layout = new ForceLayout();
      expect(Object.fromEntries(layout.lengthFactors(g, weighted(g)))).toEqual({ '0-1': 0.5, '1-2': 1, '2-3': 1.5, '3-4': DEFAULT_LAYOUT_OPTIONS.minLengthFactor });
      g.setWeight(2, 3, 100); // mean 35.33: 100 / 35.33 is past the longest allowed
      expect(layout.lengthFactors(g, weighted(g)).get('2-3')).toBe(DEFAULT_LAYOUT_OPTIONS.maxLengthFactor);
      for (const [a, b] of g.undirectedView.edges()) g.setWeight(a, b, 7);
      expect([...layout.lengthFactors(g, weighted(g)).values()]).toEqual([1, 1, 1, 1]);
      for (const [a, b] of g.undirectedView.edges()) g.setWeight(a, b, 0);
      expect([...layout.lengthFactors(g, weighted(g)).values()]).toEqual([1, 1, 1, 1]); // no weights yet: as unweighted
      g.setWeight(0, 1, -6); // magnitudes
      expect(layout.lengthFactors(g, weighted(g)).get('0-1')).toBe(1);
    });

    it('heavier edges settle longer, in proportion', () => {
      // A path 0 — 1 — 2 — 3 with weights 2, 4, 8: lengths in about the same ratios.
      const g = bunched(4, [
        [0, 1],
        [1, 2],
        [2, 3],
      ]);
      g.setWeight(0, 1, 2);
      g.setWeight(1, 2, 4);
      g.setWeight(2, 3, 8);
      new ForceLayout().settle(g, BOUNDS, 2000, weighted(g));
      const [a, b, c] = [d(g, 0, 1), d(g, 1, 2), d(g, 2, 3)];
      expect(b / a).toBeGreaterThan(1.6);
      expect(b / a).toBeLessThan(2.4);
      expect(c / b).toBeGreaterThan(1.6);
      expect(c / b).toBeLessThan(2.4);
    });

    it('on random graphs the lengths follow the weights (mean correlation above 0.6)', () => {
      // Not every set of lengths can be drawn (weights need not obey the triangle
      // inequality), and nodes are kept off other edges, so some graphs follow less closely.
      let seed = 3;
      const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const correlations: number[] = [];
      for (let trial = 0; trial < 5; trial++) {
        const g = new Graph();
        for (let i = 0; i < 10; i++) g.addNode(100 + random() * 800, 100 + random() * 550);
        for (let i = 1; i < 10; i++) g.addEdge(Math.floor(random() * i), i, 1 + Math.floor(random() * 20));
        new ForceLayout().settle(g, BOUNDS, 2000, weighted(g));
        const edges = g.undirectedView.edges();
        const xs = edges.map(([a, b]) => d(g, a, b));
        const ys = edges.map(([a, b]) => g.view('undirected', 'weighted').weight(a, b)!);
        const mean = (v: number[]) => v.reduce((x, y) => x + y, 0) / v.length;
        const [mx, my] = [mean(xs), mean(ys)];
        const cov = mean(xs.map((x, i) => (x - mx) * (ys[i] - my)));
        const corr = cov / Math.sqrt(mean(xs.map((x) => (x - mx) ** 2)) * mean(ys.map((y) => (y - my) ** 2)));
        correlations.push(corr);
      }
      expect(correlations.reduce((a, b) => a + b, 0) / correlations.length).toBeGreaterThan(0.6);
      for (const corr of correlations) expect(corr).toBeGreaterThan(0.2);
    });

    it('weighted layouts keep nodes off edges they are not on', () => {
      let seed = 11;
      const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let trial = 0; trial < 8; trial++) {
        const g = new Graph();
        for (let i = 0; i < 12; i++) g.addNode(100 + random() * 800, 100 + random() * 550);
        for (let i = 1; i < 12; i++) g.addEdge(Math.floor(random() * i), i, 1 + Math.floor(random() * 20));
        while (g.edgeCount < 18) {
          const [a, b] = [Math.floor(random() * 12), Math.floor(random() * 12)];
          if (a !== b && !g.hasEdge(a, b)) g.addEdge(a, b, 1 + Math.floor(random() * 20));
        }
        new ForceLayout().settle(g, BOUNDS, 2000, weighted(g));
        for (const [a, b] of g.undirectedView.edges()) {
          const [p, q] = [g.getNode(a)!, g.getNode(b)!];
          const [ex, ey] = [q.x - p.x, q.y - p.y];
          for (const v of g.getNodes()) {
            if (v.id === a || v.id === b) continue;
            const t = ((v.x - p.x) * ex + (v.y - p.y) * ey) / (ex * ex + ey * ey);
            if (t <= 0.05 || t >= 0.95) continue;
            // Default padding 24: at least a node's radius (≈ 22) and a little more.
            expect(Math.hypot(v.x - (p.x + ex * t), v.y - (p.y + ey * t))).toBeGreaterThan(24);
          }
        }
      }
    });

    it('without weights the layout is the unweighted one, exactly', () => {
      const make = () => {
        const g = bunched(6, [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 4],
          [4, 5],
        ]);
        g.setWeight(0, 1, 9);
        return g;
      };
      const [a, b] = [make(), make()];
      new ForceLayout().settle(a, BOUNDS);
      new ForceLayout().settle(b, BOUNDS, 2000, undefined);
      expect(a.getNodes()).toEqual(b.getNodes());
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
