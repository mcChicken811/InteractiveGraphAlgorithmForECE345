/**
 * Voronoi cells and the border between two groups of sites, for drawing an algorithm's
 * cut (S, V − S) as territories on the canvas: every point of the canvas belongs to its
 * nearest vertex, the cells of S's vertices together form S's territory, and the border
 * is where a cell of S meets a cell of V − S.
 *
 * This is the Voronoi-diagram view of a vertex partition that GMap (Gansner, Hu &
 * Kobourov, "GMap: Visualizing Graphs and Clusters as Maps", IEEE PacificVis 2010) starts
 * from. It depends only on where the vertices are, so the border exists even when no
 * edge crosses the cut, and it always separates the two groups exactly.
 *
 * Edges can take part too: a segment site is approximated by points sampled along it
 * (`sampleSegment`), the usual practical stand-in for the exact Voronoi diagram of line
 * segments (whose borders are partly parabolic). Then the territory of a side holds that
 * side's edges as well as its vertices.
 *
 * Each cell is computed exactly: the bounding rectangle clipped by the perpendicular
 * bisector with other sites (Sutherland–Hodgman), remembering which site produced each
 * edge of the cell. Nearby sites are found through a grid of buckets, tried in rings
 * outwards, stopping once the next ring is more than twice as far as the cell's farthest
 * corner — no farther bisector can reach the cell — so each cell costs about the same
 * however many sites there are. Pure functions, no DOM.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  width: number;
  height: number;
}

/** A cell edge's origin: the index of the neighbouring site whose bisector it lies on, or −1 for the rectangle. */
const RECT = -1;

/** A cell as a convex polygon; `edge[i]` is the origin of the edge from `points[i]` to `points[i + 1]`. */
export interface Cell {
  points: Point[];
  edge: number[];
}

/**
 * The Voronoi cell of every site within `bounds` (the rectangle from (0, 0)). Sites at
 * the same position split nothing between them: each gets the cell they share.
 */
export function voronoiCells(sites: Point[], bounds: Bounds): Cell[] {
  const { width: w, height: h } = bounds;
  // A grid of buckets about one site wide, so each cell only meets nearby sites.
  const size = Math.max(8, Math.sqrt((Math.max(w, 1) * Math.max(h, 1)) / Math.max(sites.length, 1)));
  const cols = Math.max(1, Math.ceil(w / size));
  const rows = Math.max(1, Math.ceil(h / size));
  const bucketOf = (p: Point): [number, number] => [
    Math.min(cols - 1, Math.max(0, Math.floor(p.x / size))),
    Math.min(rows - 1, Math.max(0, Math.floor(p.y / size))),
  ];
  const buckets: number[][] = Array.from({ length: cols * rows }, () => []);
  sites.forEach((p, j) => {
    const [bx, by] = bucketOf(p);
    buckets[by * cols + bx].push(j);
  });

  return sites.map((site, i) => {
    let cell: Cell = {
      points: [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ],
      edge: [RECT, RECT, RECT, RECT],
    };
    let reach = farthest2(cell.points, site);
    const [cx, cy] = bucketOf(site);
    // Rings of buckets around the site's own, nearest first. Every site in ring k + 1 is at
    // least k bucket widths away; once that is beyond twice the cell's farthest corner, no
    // bisector with a farther site can reach the cell.
    for (let k = 0; ; k++) {
      if (k > 0 && ((k - 1) * size) ** 2 > 4 * reach) break;
      if (cx - k < 0 && cy - k < 0 && cx + k >= cols && cy + k >= rows) break; // past the grid
      for (let by = cy - k; by <= cy + k; by++) {
        if (by < 0 || by >= rows) continue;
        const edgeRow = by === cy - k || by === cy + k;
        for (let bx = cx - k; bx <= cx + k; bx += edgeRow ? 1 : 2 * k) {
          if (bx >= 0 && bx < cols) {
            for (const j of buckets[by * cols + bx]) {
              if (j === i) continue;
              const clipped = clip(cell, site, sites[j], j);
              if (clipped !== cell) {
                cell = clipped;
                reach = farthest2(cell.points, site);
              }
            }
          }
          if (k === 0) break;
        }
      }
      if (!cell.points.length) break;
    }
    return cell;
  });
}

/** Squared distance from `site` to the farthest of `points`. */
function farthest2(points: Point[], site: Point): number {
  let max = 0;
  for (const p of points) max = Math.max(max, (p.x - site.x) ** 2 + (p.y - site.y) ** 2);
  return max;
}

/**
 * Points spaced at most `step` apart strictly between p and q (not p and q themselves),
 * standing in for the segment p–q as Voronoi sites.
 */
export function sampleSegment(p: Point, q: Point, step: number): Point[] {
  const len = Math.hypot(q.x - p.x, q.y - p.y);
  const parts = Math.ceil(len / step);
  const points: Point[] = [];
  for (let k = 1; k < parts; k++) {
    const t = k / parts;
    points.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  }
  return points;
}

/** Keeps the part of `cell` at least as close to `a` as to `b`; new edges get origin `label`. */
function clip(cell: Cell, a: Point, b: Point, label: number): Cell {
  const nx = b.x - a.x;
  const ny = b.y - a.y;
  if (Math.abs(nx) < 1e-9 && Math.abs(ny) < 1e-9) return cell; // same position
  // g(p) ≤ 0 ⇔ p is at least as close to a as to b (g is the bisector's signed distance, scaled).
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const g = (p: Point) => (p.x - mx) * nx + (p.y - my) * ny;
  const points: Point[] = [];
  const edge: number[] = [];
  const n = cell.points.length;
  for (let k = 0; k < n; k++) {
    const p = cell.points[k];
    const q = cell.points[(k + 1) % n];
    const gp = g(p);
    const gq = g(q);
    const cross = (): Point => {
      const t = gp / (gp - gq);
      return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
    };
    if (gp <= 0) {
      points.push(p);
      edge.push(cell.edge[k]);
      // Leaving the kept side: the edge from the crossing to where the polygon comes back
      // in lies along the bisector.
      if (gq > 0) {
        points.push(cross());
        edge.push(label);
      }
    } else if (gq <= 0) {
      // Coming back in: the rest of this edge belongs to the original edge.
      points.push(cross());
      edge.push(cell.edge[k]);
    }
  }
  return { points, edge };
}

export interface Territory {
  /** The cells of the `inside` sites: together, their territory (to fill as one path). */
  region: Point[][];
  /** Segments where an inside cell meets an outside cell: the border between the territories. */
  border: Array<[Point, Point]>;
}

/**
 * The territory of the sites in `inside` and its border with the others. When either
 * side is empty there is no border (and the region is everything or nothing).
 */
export function territory(sites: Point[], inside: ReadonlySet<number>, bounds: Bounds): Territory {
  const cells = voronoiCells(sites, bounds);
  const region: Point[][] = [];
  const border: Array<[Point, Point]> = [];
  cells.forEach((cell, i) => {
    if (!inside.has(i) || cell.points.length < 3) return;
    region.push(cell.points);
    const n = cell.points.length;
    for (let k = 0; k < n; k++) {
      const origin = cell.edge[k];
      if (origin === RECT || inside.has(origin)) continue;
      const p = cell.points[k];
      const q = cell.points[(k + 1) % n];
      if (Math.hypot(q.x - p.x, q.y - p.y) > 1e-6) border.push([p, q]);
    }
  });
  return { region, border };
}

/** SVG path data for polygons (closed) and for loose segments. */
export function polygonsPath(polygons: Point[][]): string {
  return polygons.map((ps) => `M ${ps.map((p) => `${round(p.x)} ${round(p.y)}`).join(' L ')} Z`).join(' ');
}

export function segmentsPath(segments: Array<[Point, Point]>): string {
  return segments.map(([p, q]) => `M ${round(p.x)} ${round(p.y)} L ${round(q.x)} ${round(q.y)}`).join(' ');
}

/**
 * Joins segments that share endpoints into polylines, so a dashed stroke flows along the
 * border instead of restarting its pattern at every short piece.
 */
export function chainSegments(segments: Array<[Point, Point]>): Point[][] {
  const key = (p: Point) => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;
  const at = new Map<string, number[]>();
  segments.forEach(([p, q], i) => {
    for (const k of [key(p), key(q)]) {
      const list = at.get(k);
      if (list) list.push(i);
      else at.set(k, [i]);
    }
  });
  const used = new Uint8Array(segments.length);
  /** Extends `line` from its last point while an unused segment continues it. */
  const extend = (line: Point[]): void => {
    for (;;) {
      const end = line[line.length - 1];
      const next = (at.get(key(end)) ?? []).find((i) => !used[i]);
      if (next === undefined) return;
      used[next] = 1;
      const [p, q] = segments[next];
      line.push(key(p) === key(end) ? q : p);
    }
  };
  const lines: Point[][] = [];
  segments.forEach(([p, q], i) => {
    if (used[i]) return;
    used[i] = 1;
    const line = [p, q];
    extend(line);
    line.reverse();
    extend(line);
    lines.push(line);
  });
  return lines;
}

export function polylinesPath(lines: Point[][]): string {
  return lines.map((ps) => `M ${ps.map((p) => `${round(p.x)} ${round(p.y)}`).join(' L ')}`).join(' ');
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
