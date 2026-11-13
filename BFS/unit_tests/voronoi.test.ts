import { describe, expect, it } from 'vitest';
import { FLAT, cutShape, loopsPath, polylinesPath, type CutFeature, type Point, type Side } from '../src/voronoi.js';

const BOUNDS = { width: 800, height: 600 };

function rng(seed: number): () => number {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);

function toSegment(p: Point, a: Point, b: Point): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return dist(p, { x: a.x + dx * t, y: a.y + dy * t });
}

/** Even-odd point-in-loops test, as the region is filled. */
function inRegion(loops: Point[][], p: Point): boolean {
  let inside = false;
  for (const ps of loops) {
    for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) {
      const [a, b] = [ps[i], ps[j]];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

/** A random graph and a cut: vertices, edges, and which vertices are in S. */
function randomCut(seed: number, n = 9) {
  const rand = rng(seed);
  const verts = Array.from({ length: n }, () => ({ x: 40 + rand() * 720, y: 40 + rand() * 520 }));
  const edges: Array<[number, number]> = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if (rand() < 0.25) edges.push([a, b]);
  const inside = new Set(verts.map((_, i) => i).filter(() => rand() < 0.5));
  if (inside.size === 0) inside.add(0);
  if (inside.size === n) inside.delete(0);
  return { verts, edges, inside };
}

/** Features for the change of cut from S0 to S1 (crossing edges belong to neither side). */
function features(verts: Point[], edges: Array<[number, number]>, s0: Set<number>, s1: Set<number>): CutFeature[] {
  const side = (s: Set<number>, i: number): Side => (s.has(i) ? 'in' : 'out');
  const edgeSide = (s: Set<number>, a: number, b: number) => (s.has(a) === s.has(b) ? side(s, a) : null);
  const list: CutFeature[] = verts.map((v, i) => ({ a: v, from: side(s0, i), to: side(s1, i) }));
  for (const [a, b] of edges) {
    const [f, g] = [edgeSide(s0, a, b), edgeSide(s1, a, b)];
    if (f || g) list.push({ a: verts[a], b: verts[b], from: f, to: g });
  }
  return list;
}

describe('cutShape (a single cut)', () => {
  it('two vertices: the border is their perpendicular bisector, and S’s territory is its side', () => {
    const feats: CutFeature[] = [
      { a: { x: 100, y: 300 }, from: 'in', to: 'in' },
      { a: { x: 250, y: 300 }, from: 'out', to: 'out' },
    ];
    const { region, border } = cutShape(feats, BOUNDS, { t: 1, from: 'split', to: 'split' });
    const points = border.flat();
    expect(points.length).toBeGreaterThan(10);
    for (const p of points) expect(p.x).toBeCloseTo(175, 0);
    expect(Math.min(...points.map((p) => p.y))).toBeCloseTo(0, 5); // edge to edge of the canvas
    expect(Math.max(...points.map((p) => p.y))).toBeCloseTo(600, 5);
    expect(inRegion(region, { x: 100, y: 300 })).toBe(true);
    expect(inRegion(region, { x: 170, y: 50 })).toBe(true);
    expect(inRegion(region, { x: 180, y: 50 })).toBe(false);
  });

  it('every border point is (almost exactly) as near to S’s features as to the others’', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { verts, edges, inside } = randomCut(seed * 7);
      const feats = features(verts, edges, inside, inside);
      const { border } = cutShape(feats, BOUNDS, { t: 1, from: 'split', to: 'split' });
      const near = (p: Point, side: Side) =>
        Math.min(...feats.filter((f) => f.to === side).map((f) => (f.b ? toSegment(p, f.a, f.b) : dist(p, f.a))));
      for (const p of border.flat()) expect(Math.abs(near(p, 'in') - near(p, 'out'))).toBeLessThan(1);
    }
  });

  it('holds S’s vertices and edges, and none of the others’: only crossing edges cross the border', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { verts, edges, inside } = randomCut(seed * 13);
      const feats = features(verts, edges, inside, inside);
      const { region } = cutShape(feats, BOUNDS, { t: 1, from: 'split', to: 'split' });
      const near = (p: Point, side: Side) =>
        Math.min(...feats.filter((f) => f.to === side).map((f) => (f.b ? toSegment(p, f.a, f.b) : dist(p, f.a))));
      // Skipping places where the other side's features come within a few pixels (random
      // graphs can run an edge right through a vertex of the other side).
      verts.forEach((v, i) => {
        if (near(v, inside.has(i) ? 'out' : 'in') >= 8) expect(inRegion(region, v)).toBe(inside.has(i));
      });
      // Points along each non-crossing edge.
      for (const f of feats.filter((x) => x.b && x.to)) {
        for (let t = 0.05; t < 1; t += 0.05) {
          const p = { x: f.a.x + (f.b!.x - f.a.x) * t, y: f.a.y + (f.b!.y - f.a.y) * t };
          if (near(p, f.to === 'in' ? 'out' : 'in') < 8) continue;
          expect(inRegion(region, p)).toBe(f.to === 'in');
        }
      }
    }
  });

  it('an empty S has no territory; a full S has the whole canvas and no border', () => {
    const feats: CutFeature[] = [{ a: { x: 400, y: 300 }, from: 'out', to: 'out' }];
    expect(cutShape(feats, BOUNDS, { t: 1, from: 'empty', to: 'empty' })).toEqual({ region: [], border: [] });
    const all = cutShape(feats, BOUNDS, { t: 1, from: 'all', to: 'all' });
    expect(all.border).toEqual([]);
    expect(inRegion(all.region, { x: 1, y: 1 })).toBe(true);
    expect(inRegion(all.region, { x: 799, y: 599 })).toBe(true);
  });

  it('needBoth: a side with no features of its own gives no territory, instead of the whole canvas', () => {
    const feats: CutFeature[] = [{ a: { x: 100, y: 300 }, b: { x: 200, y: 300 }, from: 'in', to: 'in' }];
    const flood = cutShape(feats, BOUNDS, { t: 1, from: 'split', to: 'split' });
    expect(inRegion(flood.region, { x: 790, y: 590 })).toBe(true); // nothing outside: all of it
    expect(cutShape(feats, BOUNDS, { t: 1, from: 'split', to: 'split', needBoth: true })).toEqual({ region: [], border: [] });
    // Everything in S still floods the canvas.
    const all = cutShape(feats, BOUNDS, { t: 1, from: 'split', to: 'all', needBoth: true });
    expect(inRegion(all.region, { x: 790, y: 590 })).toBe(true);
  });

  it('closes every contour, even where the territory reaches the canvas edge', () => {
    const { verts, edges, inside } = randomCut(99);
    const { region } = cutShape(features(verts, edges, inside, inside), BOUNDS, { t: 1, from: 'split', to: 'split' });
    expect(region.length).toBeGreaterThan(0);
    for (const loop of region) expect(loop.length).toBeGreaterThanOrEqual(3);
    expect(loopsPath(region)).toMatch(/Z$/);
  });
});

describe('cutShape (moving from one cut to the next)', () => {
  /** A cut S and the next one, S plus one more vertex, as in a step of Prim's algorithm. */
  function step(seed: number) {
    const { verts, edges, inside } = randomCut(seed);
    const outside = verts.map((_, i) => i).filter((i) => !inside.has(i));
    const next = new Set([...inside, outside[0]]);
    const mode = next.size === verts.length ? ('all' as const) : ('split' as const);
    return { verts, feats: features(verts, edges, inside, next), mode };
  }

  it('t = 0 is the cut before, t = 1 the cut after', () => {
    const { verts, edges, inside } = randomCut(5);
    const outside = verts.map((_, i) => i).filter((i) => !inside.has(i));
    const next = new Set([...inside, outside[0]]);
    const both = features(verts, edges, inside, next);
    const before = cutShape(features(verts, edges, inside, inside), BOUNDS, { t: 1, from: 'split', to: 'split' });
    const after = cutShape(features(verts, edges, next, next), BOUNDS, { t: 1, from: 'split', to: 'split' });
    const mode = next.size === verts.length ? 'all' : 'split';
    expect(polylinesPath(cutShape(both, BOUNDS, { t: 0, from: 'split', to: mode }).border)).toBe(polylinesPath(before.border));
    if (mode === 'split') expect(polylinesPath(cutShape(both, BOUNDS, { t: 1, from: 'split', to: mode }).border)).toBe(polylinesPath(after.border));
  });

  it('moves continuously: each small step in t changes only a little of the territory', () => {
    let checked = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const { feats, mode } = step(seed * 17);
      const rand = rng(seed + 100);
      const probes = Array.from({ length: 1500 }, () => ({ x: rand() * 800, y: rand() * 600 }));
      const sideAt = (t: number) => {
        const { region } = cutShape(feats, BOUNDS, { t, from: 'split', to: mode });
        return probes.map((p) => inRegion(region, p));
      };
      const flipsPerStep: number[] = [];
      let previous = sideAt(0);
      for (let k = 1; k <= 20; k++) {
        const now = sideAt(k / 20);
        flipsPerStep.push(now.filter((v, i) => v !== previous[i]).length);
        previous = now;
      }
      const total = flipsPerStep.reduce((a, b) => a + b, 0);
      if (total < 20) continue; // too little changes hands to measure
      checked++;
      // No 5% step does most of the change (a jump would put it all in one step) …
      expect(Math.max(...flipsPerStep)).toBeLessThan(0.3 * total);
      // … and the change is spread over the move.
      expect(flipsPerStep.filter((f) => f > 0).length).toBeGreaterThanOrEqual(6);
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });

  it('the new territory spreads out from the old S: nearer points change sides sooner', () => {
    // S = {0}; 1 joins by the tree edge 0 — 1. Points along that edge change sides in order,
    // from 0's end towards 1.
    const a = { x: 150, y: 300 };
    const b = { x: 450, y: 300 };
    const c = { x: 700, y: 300 };
    const feats: CutFeature[] = [
      { a, from: 'in', to: 'in' },
      { a: b, from: 'out', to: 'in' },
      { a: c, from: 'out', to: 'out' },
      { a, b, from: null, to: 'in' }, // the new tree edge
    ];
    const flipTime = (p: Point) => {
      for (let k = 0; k <= 50; k++) {
        if (inRegion(cutShape(feats, BOUNDS, { t: k / 50, from: 'split', to: 'split' }).region, p)) return k / 50;
      }
      return Infinity;
    };
    const times = [320, 380, 440, 500].map((x) => flipTime({ x, y: 300 }));
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
    expect(times[times.length - 1]).toBeLessThanOrEqual(1);
  });

  it('when a vertex joins S, S’s territory only grows on the way (it never flickers back)', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { feats, mode } = step(seed * 29);
      const rand = rng(seed);
      const probes = Array.from({ length: 300 }, () => ({ x: rand() * 800, y: rand() * 600 }));
      let was = probes.map(() => false);
      for (let t = 0; t <= 1.0001; t += 0.1) {
        const { region } = cutShape(feats, BOUNDS, { t: Math.min(t, 1), from: 'split', to: mode });
        const now = probes.map((p) => inRegion(region, p));
        now.forEach((inside, k) => {
          if (was[k]) expect(inside).toBe(true);
        });
        was = now;
      }
    }
  });

  it('a first cut grows from nothing around its vertex', () => {
    const feats: CutFeature[] = [
      { a: { x: 200, y: 300 }, from: 'out', to: 'in' },
      { a: { x: 600, y: 300 }, from: 'out', to: 'out' },
    ];
    const at = (t: number) => cutShape(feats, BOUNDS, { t, from: 'empty', to: 'split' }).region;
    expect(at(0)).toEqual([]);
    expect(inRegion(at(1), { x: 200, y: 300 })).toBe(true);
    // Part-way, it covers the vertex but not yet all of its final territory.
    const mid = at(0.6);
    expect(inRegion(mid, { x: 200, y: 300 })).toBe(true);
    expect(inRegion(mid, { x: 390, y: 300 })).toBe(false);
    expect(inRegion(at(1), { x: 390, y: 300 })).toBe(true);
  });

  it('when S takes the last vertex, its territory floods the canvas', () => {
    const feats: CutFeature[] = [
      { a: { x: 200, y: 300 }, from: 'in', to: 'in' },
      { a: { x: 600, y: 300 }, from: 'out', to: 'in' },
    ];
    const end = cutShape(feats, BOUNDS, { t: 1, from: 'split', to: 'all' });
    expect(end.border).toEqual([]);
    expect(inRegion(end.region, { x: 790, y: 590 })).toBe(true);
    expect(FLAT).toBeGreaterThan(0);
  });
});

describe('path helpers', () => {
  it('formats closed loops and open polylines', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1.234567, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(loopsPath([pts])).toBe('M 0 0 L 1.23 0 L 1 1 Z');
    expect(polylinesPath([pts])).toBe('M 0 0 L 1.23 0 L 1 1');
  });
});
