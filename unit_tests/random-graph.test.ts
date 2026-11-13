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

  it('undirected: connects the points with one arc per pair, none passing through another node', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rand = rng(seed);
      const points = randomPositions(8, AREA, GAP, rand);
      const arcs = randomArcs(points, rand, { clearance, weighted: true });
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

  it('unweighted: every weight is 0, as for an edge added by hand', () => {
    for (const directed of [false, true]) {
      const rand = rng(4);
      const arcs = randomArcs(randomPositions(8, AREA, GAP, rand), rand, { clearance, directed });
      expect(arcs.length).toBeGreaterThan(0);
      for (const a of arcs) expect(a.weight).toBe(0);
    }
  });

  it('directed: pairs are joined one way or the other, or both ways, each arc with its own weight', () => {
    const rand = rng(8);
    let pairs = 0;
    let both = 0;
    let differ = 0;
    for (let k = 0; k < 20; k++) {
      const points = randomPositions(8, AREA, GAP, rand);
      const arcs = randomArcs(points, rand, { clearance, directed: true, weighted: true });
      const keys = arcs.map((a) => `${a.from}-${a.to}`);
      expect(new Set(keys).size).toBe(keys.length); // never the same arc twice
      expect(components(points.length, arcs)).toBe(1); // connected, ignoring direction
      const byPair = new Map<string, typeof arcs>();
      for (const a of arcs) {
        const key = `${Math.min(a.from, a.to)}-${Math.max(a.from, a.to)}`;
        byPair.set(key, [...(byPair.get(key) ?? []), a]);
      }
      for (const group of byPair.values()) {
        pairs++;
        if (group.length === 2) {
          both++;
          if (group[0].weight !== group[1].weight) differ++;
        }
      }
    }
    // About a quarter of the pairs go both ways; the rest one way.
    expect(both / pairs).toBeGreaterThan(0.12);
    expect(both / pairs).toBeLessThan(0.4);
    expect(differ).toBeGreaterThan(both / 2);
    // Undirected never joins a pair both ways.
    const r = rng(8);
    const und = randomArcs(randomPositions(8, AREA, GAP, r), r, { clearance, bothWays: 1 });
    expect(new Set(und.map((a) => `${Math.min(a.from, a.to)}-${Math.max(a.from, a.to)}`)).size).toBe(und.length);
  });

  it('points both ways and spreads the weights', () => {
    const rand = rng(5);
    const all = Array.from({ length: 20 }, () =>
      randomArcs(randomPositions(8, AREA, GAP, rand), rand, { clearance, weighted: true }),
    );
    const arcs = all.flat();
    expect(arcs.filter((a) => a.from < a.to).length).toBeGreaterThan(arcs.length * 0.3);
    expect(arcs.filter((a) => a.from > a.to).length).toBeGreaterThan(arcs.length * 0.3);
    expect(new Set(arcs.map((a) => a.weight)).size).toBeGreaterThan(12);
    // Not every graph is just a tree.
    expect(all.some((g) => g.length > 7)).toBe(true);
  });

  it('negative: weights from −maxWeight to maxWeight, never 0, both signs', () => {
    const rand = rng(12);
    const weights = Array.from({ length: 10 }, () =>
      randomArcs(randomPositions(8, AREA, GAP, rand), rand, { clearance, weighted: true, negative: true }),
    )
      .flat()
      .map((a) => a.weight);
    expect(weights.every((w) => Number.isInteger(w) && w !== 0 && Math.abs(w) <= 20)).toBe(true);
    const negatives = weights.filter((w) => w < 0).length;
    expect(negatives / weights.length).toBeGreaterThan(0.3);
    expect(negatives / weights.length).toBeLessThan(0.7);
    // Without it (the default), every weight is positive.
    const r = rng(12);
    expect(randomArcs(randomPositions(8, AREA, GAP, r), r, { clearance, weighted: true }).every((a) => a.weight > 0)).toBe(true);
  });

  it('follows the options: weight range and no extra edges', () => {
    const rand = rng(9);
    const points = randomPositions(8, AREA, GAP, rand);
    const arcs = randomArcs(points, rand, { clearance, weighted: true, extraPerNode: 0, maxWeight: 3 });
    expect(arcs).toHaveLength(points.length - 1);
    for (const a of arcs) expect(a.weight).toBeLessThanOrEqual(3);
  });

  it('handles no points and a single point', () => {
    expect(randomArcs([], rng(1), { clearance })).toEqual([]);
    expect(randomArcs([{ x: 1, y: 1 }], rng(1), { clearance })).toEqual([]);
  });
});
