/**
 * Random graphs for the Randomise button. Pure functions, no DOM; `rand` is any source of
 * uniform numbers in [0, 1) (Math.random, or a seeded one in tests).
 *
 *  - randomPositions: nodes scattered over a rectangle, no two closer than a minimum gap
 *    (dart throwing: random candidates, each kept only if it is far enough from the rest);
 *  - randomArcs: edges between given points that stay readable on the canvas. A spanning
 *    tree of short edges first (Kruskal's algorithm on lengths jittered by ±30%, so the
 *    graph is connected but not always the same), then a few more short edges that cross
 *    nothing already drawn. No edge passes through another node.
 *
 * The graph is random for the kind of graph being edited (`directed`, `weighted`), while
 * it is stored, like every edge, as weighted directed arcs:
 *  - undirected: one arc per connected pair, in either direction (which one does not
 *    matter in that reading);
 *  - directed: each connected pair gets an arc one way, the other way, or both ways;
 *  - weighted: each arc gets a random whole-number weight; unweighted: the weight is 0,
 *    the weight of an edge added by hand.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Area {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface RandomArc {
  from: number;
  to: number;
  weight: number;
}

export interface ArcOptions {
  /** How close (px) an edge may pass to a node that is not one of its ends. */
  clearance: number;
  /** A directed graph: pairs may be joined both ways (default false). */
  directed?: boolean;
  /** A weighted graph: random weights; otherwise every weight is 0 (default false). */
  weighted?: boolean;
  /** Directed: the chance that a connected pair is joined both ways (default 0.25). */
  bothWays?: number;
  /** Extra edges beyond the spanning tree, per node (default 0.5). */
  extraPerNode?: number;
  /** Weights are whole numbers from 1 to this (default 20). */
  maxWeight?: number;
}

/**
 * Up to `count` points inside `area`, at least `gap` apart. Fewer when the area runs out
 * of room (it gives up after a fixed number of tries per point).
 */
export function randomPositions(count: number, area: Area, gap: number, rand: () => number): Point[] {
  const points: Point[] = [];
  const w = Math.max(0, area.right - area.left);
  const h = Math.max(0, area.bottom - area.top);
  for (let tries = 0; points.length < count && tries < count * 200; tries++) {
    const p = { x: area.left + rand() * w, y: area.top + rand() * h };
    if (points.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= gap)) points.push(p);
  }
  return points;
}

/** How many nodes fit comfortably in `area` with centres `gap` apart (between `min` and `max`). */
export function nodeCountFor(area: Area, gap: number, min = 5, max = 10): number {
  const cells = ((area.right - area.left) * (area.bottom - area.top)) / (gap * gap * 2.2);
  return Math.max(min, Math.min(max, Math.floor(cells)));
}

/** Random arcs between `points` (indices into the array); see the module comment. */
export function randomArcs(points: readonly Point[], rand: () => number, options: ArcOptions): RandomArc[] {
  const n = points.length;
  const { clearance } = options;
  const maxWeight = options.maxWeight ?? 20;
  const bothWays = options.directed ? (options.bothWays ?? 0.25) : 0;
  const weight = () => (options.weighted ? 1 + Math.floor(rand() * maxWeight) : 0);
  const extra = Math.round(n * (options.extraPerNode ?? 0.5));

  // Candidate pairs: those whose straight edge keeps clear of every other node.
  const pairs: Array<{ a: number; b: number; length: number }> = [];
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const blocked = points.some(
        (p, k) => k !== a && k !== b && segmentDistance(p, points[a], points[b]) < clearance,
      );
      if (!blocked) pairs.push({ a, b, length: Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y) });
    }
  }

  // A spanning tree (a forest, if the candidates leave some nodes apart) of short edges.
  const parent = points.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const jittered = pairs.map((p) => ({ ...p, key: p.length * (0.7 + 0.6 * rand()) })).sort((p, q) => p.key - q.key);
  const chosen: Array<{ a: number; b: number }> = [];
  const rest: typeof jittered = [];
  for (const p of jittered) {
    const [ra, rb] = [find(p.a), find(p.b)];
    if (ra !== rb) {
      parent[ra] = rb;
      chosen.push(p);
    } else {
      rest.push(p);
    }
  }

  // A few more short edges, each crossing none of the edges already chosen.
  const crosses = (p: { a: number; b: number }) =>
    chosen.some(
      (q) =>
        q.a !== p.a && q.a !== p.b && q.b !== p.a && q.b !== p.b &&
        segmentsCross(points[p.a], points[p.b], points[q.a], points[q.b]),
    );
  let added = 0;
  for (const p of rest) {
    if (added >= extra) break;
    if (rand() < 0.6 && !crosses(p)) {
      chosen.push(p);
      added++;
    }
  }

  return chosen.flatMap(({ a, b }) => {
    if (rand() < bothWays) return [{ from: a, to: b, weight: weight() }, { from: b, to: a, weight: weight() }];
    const [from, to] = rand() < 0.5 ? [a, b] : [b, a];
    return [{ from, to, weight: weight() }];
  });
}

/** Distance from p to the segment a–b. */
function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** True if the segments p1–p2 and q1–q2 properly cross. */
function segmentsCross(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  const side = (a: Point, b: Point, c: Point) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return side(p1, p2, q1) * side(p1, p2, q2) < 0 && side(q1, q2, p1) * side(q1, q2, p2) < 0;
}
