/**
 * Geometry for drawing the graph as an arc diagram (DFS's topological sort): the
 * vertices in a left-to-right line, wrapping into rows like text when they don't fit,
 * and edges as half circles whose diameter runs from one vertex to the other. Pure
 * functions, no DOM.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  width: number;
  height: number;
}

export interface RowLayoutOptions {
  /** Space kept free at the left and right edges (from the vertex centres). */
  padX: number;
  /** Space kept free at the top (e.g. under the canvas toolbar) and bottom (the status bar). */
  padTop: number;
  padBottom: number;
  /** Preferred gap between neighbouring vertices; never more. */
  maxGap: number;
  /** Narrowest gap allowed; below it the line wraps into another row. */
  minGap: number;
}

export const ROW_DEFAULTS: RowLayoutOptions = { padX: 56, padTop: 80, padBottom: 96, maxGap: 150, minGap: 88 };

export interface RowLayout {
  /** Position of each vertex, in the given order. */
  positions: Point[];
  rows: number;
  /** How far an arc may bulge from its line before it would run into a neighbouring row or the edges. */
  maxBulge: number;
}

/**
 * Lays `count` vertices out left to right, centred in `bounds`. If they don't fit at
 * `minGap` apart, they continue on the next row (left to right again, top to bottom),
 * with the rows spread evenly over the height. Arcs above the first row and below the
 * last get the room up to the canvas edges.
 */
export function rowLayout(count: number, bounds: Bounds, options: Partial<RowLayoutOptions> = {}): RowLayout {
  const o = { ...ROW_DEFAULTS, ...options };
  if (count === 0) return { positions: [], rows: 0, maxBulge: 0 };
  const usable = Math.max(0, bounds.width - 2 * o.padX);
  const perRow = Math.max(1, Math.min(count, Math.floor(usable / o.minGap) + 1));
  const rows = Math.ceil(count / perRow);
  const gap = perRow > 1 ? Math.min(o.maxGap, usable / (perRow - 1)) : 0;
  const left = (bounds.width - gap * (perRow - 1)) / 2;
  const top = o.padTop;
  const height = Math.max(0, bounds.height - o.padTop - o.padBottom);
  const rowHeight = height / rows;
  const positions: Point[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow);
    positions.push({ x: left + (i % perRow) * gap, y: top + rowHeight * (row + 0.5) });
  }
  return { positions, rows, maxBulge: Math.max(0, rowHeight / 2 - 4) };
}

export interface ArcPath {
  /** SVG path data, from the rim of `a` to the rim of `b`. */
  d: string;
  /** The arc's middle (its apex), where a label goes. */
  mid: Point;
}

/**
 * A half ellipse from a to b whose major axis is the segment a–b (a half circle when
 * |bulge| reaches half the distance), bulging `bulge` px to the left of the direction
 * a → b (screen coordinates: for a left-to-right edge, positive is up), negative to the
 * right. Bulge 0 is a straight line, so animating the bulge morphs a line into the arc.
 *
 * The path starts `trimStart` px from a and ends `trimEnd` px from b (measured straight,
 * i.e. at the node circles' rims), and is sampled into short segments so an arrowhead
 * marker at its end points along the curve.
 */
export function halfEllipse(a: Point, b: Point, bulge: number, trimStart: number, trimEnd: number, segments = 40): ArcPath {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (len < 1e-6) return { d: `M ${a.x} ${a.y}`, mid: m };
  const rx = len / 2;
  const ry = Math.max(-rx, Math.min(rx, bulge));
  const ux = dx / len;
  const uy = dy / len;
  // Left of the direction of travel, in y-down screen coordinates: (1, 0) → (0, -1).
  const nx = uy;
  const ny = -ux;
  // t = 0 at a, π/2 at the apex, π at b.
  const at = (t: number): Point => ({
    x: m.x - ux * rx * Math.cos(t) + nx * ry * Math.sin(t),
    y: m.y - uy * rx * Math.cos(t) + ny * ry * Math.sin(t),
  });
  const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
  // Distance from an end grows steadily towards the apex (ry ≤ rx), so bisect for the trims.
  const solve = (from: Point, lo: number, hi: number, target: number, rising: boolean): number => {
    for (let i = 0; i < 40; i++) {
      const midT = (lo + hi) / 2;
      const d = dist(at(midT), from);
      if (d < target === rising) lo = midT;
      else hi = midT;
    }
    return (lo + hi) / 2;
  };
  const apex = at(Math.PI / 2);
  const t0 = dist(apex, a) <= trimStart ? Math.PI / 2 : solve(a, 0, Math.PI / 2, trimStart, true);
  const t1 = dist(apex, b) <= trimEnd ? Math.PI / 2 : solve(b, Math.PI / 2, Math.PI, trimEnd, false);
  const points: string[] = [];
  for (let i = 0; i <= segments; i++) {
    const p = at(t0 + ((t1 - t0) * i) / segments);
    points.push(`${round(p.x)} ${round(p.y)}`);
  }
  return { d: `M ${points.join(' L ')}`, mid: apex };
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
