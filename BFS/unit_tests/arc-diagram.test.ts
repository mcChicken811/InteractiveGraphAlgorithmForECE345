import { describe, expect, it } from 'vitest';
import { FOREST_DEFAULTS, ROW_DEFAULTS, forestLayout, halfEllipse, rowLayout, type Point } from '../src/arc-diagram.js';

const BOUNDS = { width: 1000, height: 600 };

describe('forestLayout', () => {
  const tree = [
    { column: 3.5, row: 0 },
    { column: 2.5, row: 1 },
    { column: 5.5, row: 1 },
    { column: 9.5, row: 0 },
  ];

  it('maps columns to x at up to maxUnit per time unit, centred, and rows to evenly spaced y', () => {
    const p = forestLayout(tree, BOUNDS);
    expect(p[2].x - p[1].x).toBeCloseTo(3 * FOREST_DEFAULTS.maxUnit);
    expect((p[1].x + p[3].x) / 2).toBeCloseTo(500); // the span is centred
    expect(p[0].y).toBeCloseTo(p[3].y);
    expect(p[1].y - p[0].y).toBeCloseTo(FOREST_DEFAULTS.maxRowHeight);
    // The rows are centred in the space between the pads.
    const middle = (FOREST_DEFAULTS.padTop + 600 - FOREST_DEFAULTS.padBottom) / 2;
    expect((p[0].y + p[1].y) / 2).toBeCloseTo(middle);
  });

  it('shrinks the unit and the rows to fit', () => {
    const wide = Array.from({ length: 40 }, (_, i) => ({ column: i * 2 + 1.5, row: i % 12 }));
    const p = forestLayout(wide, BOUNDS);
    const xs = p.map((q) => q.x);
    const ys = p.map((q) => q.y);
    expect(Math.min(...xs)).toBeCloseTo(FOREST_DEFAULTS.padX);
    expect(Math.max(...xs)).toBeCloseTo(1000 - FOREST_DEFAULTS.padX);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(FOREST_DEFAULTS.padTop);
    expect(Math.max(...ys)).toBeLessThanOrEqual(600 - FOREST_DEFAULTS.padBottom);
  });

  it('one vertex sits in the middle; no vertices, no places', () => {
    const [p] = forestLayout([{ column: 1.5, row: 0 }], BOUNDS, { padTop: 0, padBottom: 0 });
    expect(p.x).toBeCloseTo(500);
    expect(forestLayout([], BOUNDS)).toEqual([]);
  });
});

describe('rowLayout', () => {
  it('puts a few vertices on one centred row, at most maxGap apart', () => {
    const { positions, rows } = rowLayout(4, BOUNDS);
    expect(rows).toBe(1);
    const gaps = positions.slice(1).map((p, i) => p.x - positions[i].x);
    expect(gaps.every((g) => g === ROW_DEFAULTS.maxGap)).toBe(true);
    expect((positions[0].x + positions[3].x) / 2).toBeCloseTo(500);
    expect(new Set(positions.map((p) => p.y)).size).toBe(1);
  });

  it('spreads out to the edges before wrapping, never closer than minGap', () => {
    const { positions, rows } = rowLayout(10, BOUNDS);
    expect(rows).toBe(1);
    expect(positions[0].x).toBeCloseTo(ROW_DEFAULTS.padX);
    expect(positions[9].x).toBeCloseTo(1000 - ROW_DEFAULTS.padX);
    expect(positions[1].x - positions[0].x).toBeGreaterThanOrEqual(ROW_DEFAULTS.minGap);
  });

  it('wraps like text when the line would not fit: left to right, then the next row down', () => {
    const { positions, rows } = rowLayout(25, BOUNDS);
    const perRow = Math.floor((1000 - 2 * ROW_DEFAULTS.padX) / ROW_DEFAULTS.minGap) + 1;
    expect(rows).toBe(Math.ceil(25 / perRow));
    for (let i = 1; i < 25; i++) {
      const [p, q] = [positions[i - 1], positions[i]];
      if (i % perRow === 0) {
        expect(q.y).toBeGreaterThan(p.y); // next row…
        expect(q.x).toBeCloseTo(positions[0].x); // …starting at the left again
      } else {
        expect(q.y).toBe(p.y);
        expect(q.x).toBeGreaterThan(p.x);
      }
    }
    for (const p of positions) {
      expect(p.x).toBeGreaterThanOrEqual(ROW_DEFAULTS.padX - 1e-9);
      expect(p.x).toBeLessThanOrEqual(1000 - ROW_DEFAULTS.padX + 1e-9);
      expect(p.y).toBeGreaterThan(ROW_DEFAULTS.padTop);
      expect(p.y).toBeLessThan(600 - ROW_DEFAULTS.padBottom);
    }
  });

  it('limits arcs to half a row, so they stay clear of the neighbouring rows', () => {
    const one = rowLayout(3, BOUNDS);
    const three = rowLayout(25, BOUNDS);
    expect(three.rows).toBe(3);
    expect(three.maxBulge).toBeLessThan(one.maxBulge);
    const rowGap = three.positions[three.positions.length - 1].y - three.positions[0].y;
    expect(three.maxBulge).toBeLessThan(rowGap / (three.rows - 1) / 2);
  });

  it('handles nothing and a single vertex', () => {
    expect(rowLayout(0, BOUNDS).positions).toEqual([]);
    expect(rowLayout(1, BOUNDS).positions[0].x).toBeCloseTo(500);
  });
});

describe('halfEllipse', () => {
  const a = { x: 100, y: 300 };
  const b = { x: 500, y: 300 };
  const points = (d: string): Point[] => [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: +m[1], y: +m[2] }));
  const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);

  it('a full bulge is a half circle with the segment a–b as its diameter', () => {
    const { d, mid } = halfEllipse(a, b, 200, 0, 0);
    const centre = { x: 300, y: 300 };
    for (const p of points(d)) expect(dist(p, centre)).toBeCloseTo(200, 1);
    expect(mid).toEqual({ x: 300, y: 100 }); // apex above (left of a → b)
    const ps = points(d);
    expect(ps[0]).toEqual(a);
    expect(ps[ps.length - 1]).toEqual(b);
  });

  it('a negative bulge goes below; going right to left flips the sides', () => {
    expect(halfEllipse(a, b, -200, 0, 0).mid).toEqual({ x: 300, y: 500 });
    expect(halfEllipse(b, a, 200, 0, 0).mid).toEqual({ x: 300, y: 500 });
  });

  it('never bulges past a half circle, and flattens when told to', () => {
    expect(halfEllipse(a, b, 900, 0, 0).mid.y).toBeCloseTo(100);
    const flat = halfEllipse(a, b, 80, 0, 0);
    expect(flat.mid.y).toBeCloseTo(220);
    expect(Math.min(...points(flat.d).map((p) => p.y))).toBeCloseTo(220, 0);
  });

  it('bulge 0 is a straight line', () => {
    expect(points(halfEllipse(a, b, 0, 0, 0).d).every((p) => p.y === 300)).toBe(true);
  });

  it('starts and ends at the given distances from the vertices (their rims)', () => {
    const ps = points(halfEllipse(a, b, 200, 20, 21).d);
    expect(dist(ps[0], a)).toBeCloseTo(20, 1);
    expect(dist(ps[ps.length - 1], b)).toBeCloseTo(21, 1);
  });
});
