import { describe, expect, it } from 'vitest';
import {
  chainSegments,
  polygonsPath,
  polylinesPath,
  sampleSegment,
  segmentsPath,
  territory,
  voronoiCells,
  type Point,
} from '../src/voronoi.js';

const BOUNDS = { width: 800, height: 600 };

function randomSites(n: number, seed: number): Point[] {
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, () => ({ x: 20 + rand() * 760, y: 20 + rand() * 560 }));
}

/** Shoelace area of a polygon. */
const area = (ps: Point[]) => Math.abs(ps.reduce((s, p, i) => s + p.x * ps[(i + 1) % ps.length].y - ps[(i + 1) % ps.length].x * p.y, 0)) / 2;

/** Is p inside the convex polygon (either winding)? */
function inside(ps: Point[], p: Point): boolean {
  let sign = 0;
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i];
    const b = ps[(i + 1) % ps.length];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(cross) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);

describe('voronoiCells', () => {
  it('two sites split the rectangle along their perpendicular bisector', () => {
    const [left, right] = voronoiCells(
      [
        { x: 200, y: 300 },
        { x: 600, y: 300 },
      ],
      BOUNDS,
    );
    expect(area(left.points)).toBeCloseTo(400 * 600);
    expect(area(right.points)).toBeCloseTo(400 * 600);
    expect(left.points.every((p) => p.x <= 400 + 1e-9)).toBe(true);
    // The edge along x = 400 is labelled with the other site; the rest with the rectangle.
    const bisectorEdges = left.edge.filter((e) => e === 1);
    expect(bisectorEdges).toHaveLength(1);
  });

  it('cells tile the rectangle exactly, and each holds its own site', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const sites = randomSites(3 + seed, seed);
      const cells = voronoiCells(sites, BOUNDS);
      expect(cells.reduce((sum, c) => sum + area(c.points), 0)).toBeCloseTo(800 * 600, 3);
      cells.forEach((c, i) => expect(inside(c.points, sites[i])).toBe(true));
    }
  });

  it('every point lies in the cell of its nearest site', () => {
    const sites = randomSites(12, 42);
    const cells = voronoiCells(sites, BOUNDS);
    for (const p of randomSites(300, 7)) {
      const nearest = sites.reduce((best, s, i) => (dist(p, s) < dist(p, sites[best]) ? i : best), 0);
      expect(inside(cells[nearest].points, p)).toBe(true);
    }
  });

  it('each edge is labelled with the neighbour it borders (equidistant), or −1 for the rectangle', () => {
    const sites = randomSites(10, 3);
    voronoiCells(sites, BOUNDS).forEach((cell, i) => {
      cell.points.forEach((p, k) => {
        const q = cell.points[(k + 1) % cell.points.length];
        const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
        const origin = cell.edge[k];
        if (origin === -1) {
          const onRect = [m.x, m.y, 800 - m.x, 600 - m.y].some((d) => Math.abs(d) < 1e-6);
          expect(onRect).toBe(true);
        } else {
          expect(dist(m, sites[i])).toBeCloseTo(dist(m, sites[origin]), 6);
        }
      });
    });
  });

  it('copes with sites at the same position', () => {
    const cells = voronoiCells(
      [
        { x: 100, y: 100 },
        { x: 100, y: 100 },
        { x: 500, y: 400 },
      ],
      BOUNDS,
    );
    expect(cells[0].points.length).toBeGreaterThanOrEqual(3);
    expect(area(cells[0].points)).toBeCloseTo(area(cells[1].points));
  });
});

describe('territory', () => {
  it('the border lies exactly halfway between the nearest inside and outside sites', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const sites = randomSites(10, seed * 13);
      const side = new Set([0, 1, 2, 3].filter((i) => i % 2 === seed % 2).concat([seed % 10]));
      const { border, region } = territory(sites, side, BOUNDS);
      expect(border.length).toBeGreaterThan(0);
      for (const [p, q] of border) {
        for (const t of [0.25, 0.5, 0.75]) {
          const m = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
          const dIn = Math.min(...sites.filter((_, i) => side.has(i)).map((s) => dist(m, s)));
          const dOut = Math.min(...sites.filter((_, i) => !side.has(i)).map((s) => dist(m, s)));
          expect(dIn).toBeCloseTo(dOut, 5);
        }
      }
      // The region is the inside sites' cells, which hold exactly the inside sites.
      expect(region).toHaveLength(side.size);
      sites.forEach((s, i) => expect(region.some((poly) => inside(poly, s))).toBe(side.has(i)));
    }
  });

  it('exists whatever the edges: it only depends on where the vertices are', () => {
    // Two far-apart groups: the border runs between them.
    const sites = [
      { x: 100, y: 100 },
      { x: 150, y: 140 },
      { x: 650, y: 450 },
      { x: 700, y: 500 },
    ];
    const { border } = territory(sites, new Set([0, 1]), BOUNDS);
    expect(border.length).toBeGreaterThan(0);
  });

  it('has no border when either side is empty', () => {
    const sites = randomSites(5, 9);
    expect(territory(sites, new Set(), BOUNDS)).toEqual({ region: [], border: [] });
    const all = territory(sites, new Set([0, 1, 2, 3, 4]), BOUNDS);
    expect(all.border).toEqual([]);
    expect(all.region.reduce((s, p) => s + area(p), 0)).toBeCloseTo(800 * 600, 3);
  });
});

describe('path helpers', () => {
  it('formats closed polygons and loose segments', () => {
    expect(
      polygonsPath([
        [
          { x: 0, y: 0 },
          { x: 1.234567, y: 0 },
          { x: 1, y: 1 },
        ],
      ]),
    ).toBe('M 0 0 L 1.23 0 L 1 1 Z');
    expect(segmentsPath([[{ x: 0, y: 0 }, { x: 2, y: 3 }]])).toBe('M 0 0 L 2 3');
  });
});

describe('pruning (sites tried nearest first, stopping early)', () => {
  it('still tiles the rectangle and assigns every point to its nearest site, with many sites', () => {
    const sites = randomSites(400, 77);
    const cells = voronoiCells(sites, BOUNDS);
    expect(cells.reduce((sum, c) => sum + area(c.points), 0)).toBeCloseTo(800 * 600, 2);
    for (const p of randomSites(400, 5)) {
      const nearest = sites.reduce((best, s, i) => (dist(p, s) < dist(p, sites[best]) ? i : best), 0);
      expect(inside(cells[nearest].points, p)).toBe(true);
    }
  });
});

describe('sampleSegment', () => {
  it('spaces points at most `step` apart, strictly between the ends', () => {
    const pts = sampleSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, 14);
    expect(pts).toHaveLength(7); // 8 parts of 12.5
    expect(pts[0].x).toBeCloseTo(12.5);
    expect(pts[6].x).toBeCloseTo(87.5);
    expect(sampleSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, 14)).toEqual([]);
  });
});

describe('edges as sites (territory of vertices and the edges within each side)', () => {
  /** Distance from p to the segment a–b. */
  function toSegment(p: Point, a: Point, b: Point): number {
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return dist(p, { x: a.x + dx * t, y: a.y + dy * t });
  }

  it('keeps every non-crossing edge inside its own side’s territory', () => {
    const STEP = 14;
    for (let seed = 1; seed <= 12; seed++) {
      const verts = randomSites(9, seed * 31);
      const side = new Set([0, 1, 2, 3].map((k) => (k * 2 + seed) % 9));
      // A few random edges, crossing or not.
      const pairs: Array<[number, number]> = [];
      let r = seed;
      for (let k = 0; k < 10; k++) {
        r = (r * 16807) % 2147483647;
        const a = r % 9;
        r = (r * 16807) % 2147483647;
        const b = r % 9;
        if (a !== b) pairs.push([a, b]);
      }
      const nonCrossing = pairs.filter(([a, b]) => side.has(a) === side.has(b));
      const sites = [...verts];
      const inSet = new Set([...side]);
      for (const [a, b] of nonCrossing) {
        for (const p of sampleSegment(verts[a], verts[b], STEP)) {
          if (side.has(a)) inSet.add(sites.length);
          sites.push(p);
        }
      }
      const { region } = territory(sites, inSet, BOUNDS);
      const inRegion = (p: Point) => region.some((poly) => inside(poly, p));
      // True distance to each side's features (its vertices and its edges).
      const near = (p: Point, own: boolean) =>
        Math.min(
          ...verts.filter((_, i) => side.has(i) === own).map((v) => dist(p, v)),
          ...nonCrossing.filter(([a]) => side.has(a) === own).map(([a, b]) => toSegment(p, verts[a], verts[b])),
        );
      for (const [a, b] of nonCrossing) {
        const own = side.has(a);
        for (let t = 0.02; t < 1; t += 0.02) {
          const p = { x: verts[a].x + (verts[b].x - verts[a].x) * t, y: verts[a].y + (verts[b].y - verts[a].y) * t };
          // Away from places where the other side's features come within a sampling step.
          if (near(p, !own) < STEP) continue;
          expect(inRegion(p)).toBe(own);
        }
      }
    }
  });
});

describe('chainSegments', () => {
  it('joins segments that meet end to end into polylines, whatever their direction', () => {
    const lines = chainSegments([
      [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      [{ x: 20, y: 5 }, { x: 10, y: 0 }], // reversed
      [{ x: 20, y: 5 }, { x: 30, y: 5 }],
      [{ x: 100, y: 100 }, { x: 110, y: 100 }], // separate
    ]);
    expect(lines).toHaveLength(2);
    const long = lines.find((l) => l.length === 4)!;
    const xs = long.map((p) => p.x);
    expect(xs[0] === 0 ? xs : [...xs].reverse()).toEqual([0, 10, 20, 30]);
    expect(polylinesPath([long.length && xs[0] === 0 ? long : [...long].reverse()])).toBe('M 0 0 L 10 0 L 20 5 L 30 5');
  });
});
