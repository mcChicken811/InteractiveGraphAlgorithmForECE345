import { describe, expect, it } from 'vitest';
import { nodeCountFor, randomArcs, randomPositions, type Point } from '../src/random-graph.js';

function rng(seed: number): () => number {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

const AREA = { left: 30, top: 70, right: 770, bottom: 500 };
const GAP = 96;

function toSegment(p: Point, a: Point, b: Point): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Number of connected pieces, ignoring direction. */
function components(n: number, arcs: Array<{ from: number; to: number }>): number {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const { from, to } of arcs) parent[find(from)] = find(to);
  return new Set(parent.map((_, i) => find(i))).size;
}

describe('randomPositions', () => {
  it('places points inside the area, at least the gap apart', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const points = randomPositions(9, AREA, GAP, rng(seed));
      expect(points).toHaveLength(9);
      for (const p of points) {
        expect(p.x).toBeGreaterThanOrEqual(AREA.left);
        expect(p.x).toBeLessThanOrEqual(AREA.right);
        expect(p.y).toBeGreaterThanOrEqual(AREA.top);
        expect(p.y).toBeLessThanOrEqual(AREA.bottom);
        for (const q of points) if (q !== p) expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(GAP);
      }
    }
  });

  it('places fewer when the area runs out of room, and none in an empty area', () => {
    expect(randomPositions(10, { left: 0, top: 0, right: 150, bottom: 150 }, GAP, rng(2)).length).toBeLessThan(10);
    expect(randomPositions(5, { left: 0, top: 0, right: 0, bottom: 0 }, GAP, rng(2))).toHaveLength(1);
  });

  it('is repeatable for a seed', () => {
    expect(randomPositions(6, AREA, GAP, rng(42))).toEqual(randomPositions(6, AREA, GAP, rng(42)));
  });
});

describe('nodeCountFor', () => {
  it('scales with the area, between 5 and 10', () => {
    expect(nodeCountFor({ left: 0, top: 0, right: 300, bottom: 300 }, GAP)).toBe(5);
    expect(nodeCountFor({ left: 0, top: 0, right: 3000, bottom: 3000 }, GAP)).toBe(10);
    const mid = nodeCountFor(AREA, GAP);
    expect(mid).toBeGreaterThanOrEqual(5);
    expect(mid).toBeLessThanOrEqual(10);
  });
});

describe('randomArcs', () => {
  const clearance = 26;

  it('connects the points with one weighted arc per pair, none passing through another node', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rand = rng(seed);
      const points = randomPositions(8, AREA, GAP, rand);
      const arcs = randomArcs(points, rand, { clearance });
      expect(components(points.length, arcs)).toBe(1);
      const pairs = new Set(arcs.map(({ from, to }) => `${Math.min(from, to)}-${Math.max(from, to)}`));
      expect(pairs.size).toBe(arcs.length);
      for (const { from, to, weight } of arcs) {
        expect(from).not.toBe(to);
        expect(Number.isInteger(weight) && weight >= 1 && weight <= 20).toBe(true);
        points.forEach((p, k) => {
          if (k !== from && k !== to) expect(toSegment(p, points[from], points[to])).toBeGreaterThanOrEqual(clearance);
        });
      }
      // A spanning tree plus a few more: about 1.5 edges per node at most.
      expect(arcs.length).toBeGreaterThanOrEqual(points.length - 1);
      expect(arcs.length).toBeLessThanOrEqual(points.length - 1 + Math.round(points.length * 0.5));
    }
  });

  it('points both ways and spreads the weights', () => {
    const rand = rng(5);
    const all = Array.from({ length: 20 }, () => randomArcs(randomPositions(8, AREA, GAP, rand), rand, { clearance }));
    const arcs = all.flat();
    expect(arcs.filter((a) => a.from < a.to).length).toBeGreaterThan(arcs.length * 0.3);
    expect(arcs.filter((a) => a.from > a.to).length).toBeGreaterThan(arcs.length * 0.3);
    expect(new Set(arcs.map((a) => a.weight)).size).toBeGreaterThan(12);
    // Not every graph is just a tree.
    expect(all.some((g) => g.length > 7)).toBe(true);
  });

  it('follows the options: weight range and no extra edges', () => {
    const rand = rng(9);
    const points = randomPositions(8, AREA, GAP, rand);
    const arcs = randomArcs(points, rand, { clearance, extraPerNode: 0, maxWeight: 3 });
    expect(arcs).toHaveLength(points.length - 1);
    for (const a of arcs) expect(a.weight).toBeLessThanOrEqual(3);
  });

  it('handles no points and a single point', () => {
    expect(randomArcs([], rng(1), { clearance })).toEqual([]);
    expect(randomArcs([{ x: 1, y: 1 }], rng(1), { clearance })).toEqual([]);
  });
});
