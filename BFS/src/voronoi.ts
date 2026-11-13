/**
 * The territories of an algorithm's cut (S, V − S) on the canvas, and the border between
 * them, as the zero line of a distance field:
 *
 *   f(p) = (distance from p to S's nearest feature) − (distance to V − S's nearest feature)
 *
 * A feature is a vertex, or an edge whose ends are both on one side (it does not cross
 * the cut); distances to edges are exact point-to-segment distances. f < 0 is S's
 * territory, f > 0 the other's, and f = 0 the border: the Voronoi border between the two
 * groups of features (the Voronoi view of a partition that GMap starts from — Gansner, Hu
 * & Kobourov, "GMap: Visualizing Graphs and Clusters as Maps", IEEE PacificVis 2010 —
 * with edges as segment sites). It depends only on where the features are, so it exists
 * even when no edge crosses the cut.
 *
 * Moving the border continuously from one cut to the next, when S grows (as in Prim's
 * algorithm), reveals the new territory with a front spreading out from the old S at a
 * steady speed:
 *
 *   region(t) = R_old ∪ (R_new ∩ { p : distance from p to the old S's features < r(t) })
 *
 * with r(t) rising until the front has covered all of the new territory — as a field,
 * g_t = max(f_new, min(f_old, d_seed − r(t))), traced the same way. The territory along a
 * new tree edge so fills in from the tree's end towards the vertex that joined. A vertex
 * that joins with no edge to S (the first one, or a new tree's root) seeds a front of its
 * own. The territory only grows, and moves continuously (sublevel sets of a continuous
 * function); the front's arcs are offset curves of the old S.
 *
 * For any other change (S losing vertices), the two fields are blended instead,
 * f_t = (1 − t)·f_old + t·f_new — the classic way to morph implicit shapes (Turk &
 * O'Brien, "Shape Transformation Using Variational Implicit Functions", SIGGRAPH 1999).
 *
 * The field is sampled on a grid and the zero line traced with marching squares, each
 * crossing refined by bisection on the exact field. A frame of padding with f > 0 around
 * the canvas closes every contour, so S's territory comes out as closed loops (filled with
 * the even-odd rule); the parts of the loops on that frame are left out of the border
 * line. Pure functions, no DOM.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  width: number;
  height: number;
}

export type Side = 'in' | 'out';

/**
 * A vertex (`a` only) or an edge (`a`–`b`), and the side it belongs to before and after
 * a change of cut (`from`, `to`): 'in' (S), 'out' (V − S) or null (an edge crossing the cut).
 * `seed`: a vertex joining S with no edge to the old S, whose territory grows from itself.
 */
export interface CutFeature {
  a: Point;
  b?: Point;
  from: Side | null;
  to: Side | null;
  seed?: boolean;
}

/**
 * What a cut looks like overall: 'split' (both sides have vertices), 'empty' (S has none:
 * no territory) or 'all' (S has every vertex: the whole canvas).
 */
export type CutMode = 'split' | 'empty' | 'all';

export interface CutShapeOptions {
  /** Blend between the cut before (0) and after (1). */
  t: number;
  from: CutMode;
  to: CutMode;
  /** Grid spacing (px). */
  step?: number;
  /**
   * A side with no features of its own: by default the other side's territory takes the
   * whole canvas; with `needBoth`, neither side has any (no territory, no border).
   */
  needBoth?: boolean;
}

export interface CutShape {
  /** S's territory as closed loops (fill with the even-odd rule). */
  region: Point[][];
  /** The border with the other territory, as polylines (closed ones end where they start). */
  border: Point[][];
}

/** The field value standing for "no territory" (+) or "everything" (−) when a side is empty. */
export const FLAT = 60;
const DEFAULT_STEP = 7;
const PAD = 1e9;

/** Distance from (px, py) to the segment a–b. */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * t - px;
  const cy = ay + dy * t - py;
  return Math.sqrt(cx * cx + cy * cy);
}

/** The field for one cut, from the distances to its nearest inside and outside features. */
function field(dIn: number, dOut: number, mode: CutMode, needBoth = false): number {
  if (mode === 'empty') return FLAT;
  if (mode === 'all') return -FLAT;
  if (dIn === Infinity) return FLAT;
  if (dOut === Infinity) return needBoth ? FLAT : -FLAT;
  return dIn - dOut;
}

/**
 * The territory of S, and its border, for the blend `t` between two cuts (t = 1, or
 * `from` equal to `to`, for a single cut).
 */
export function cutShape(features: CutFeature[], bounds: Bounds, options: CutShapeOptions): CutShape {
  const { t, from, to } = options;
  const step = options.step ?? DEFAULT_STEP;
  const w = Math.max(bounds.width, 1);
  const h = Math.max(bounds.height, 1);
  const nx = Math.max(1, Math.ceil(w / step));
  const ny = Math.max(1, Math.ceil(h / step));
  const sx = w / nx;
  const sy = h / ny;
  // Nodes i = −1 … nx + 1, j = −1 … ny + 1; the outer ring is padding (outside).
  const cols = nx + 3;
  const rows = ny + 3;
  const value = new Float64Array(cols * rows).fill(PAD);
  const index = (i: number, j: number) => (j + 1) * cols + (i + 1);

  const n = features.length;
  const ax = new Float64Array(n);
  const ay = new Float64Array(n);
  const bx = new Float64Array(n);
  const by = new Float64Array(n);
  const fromIn = new Uint8Array(n);
  const fromOut = new Uint8Array(n);
  const toIn = new Uint8Array(n);
  const toOut = new Uint8Array(n);
  const seedOf = new Uint8Array(n); // the front grows from these
  features.forEach((f, k) => {
    ax[k] = f.a.x;
    ay[k] = f.a.y;
    bx[k] = (f.b ?? f.a).x;
    by[k] = (f.b ?? f.a).y;
    fromIn[k] = +(f.from === 'in');
    fromOut[k] = +(f.from === 'out');
    toIn[k] = +(f.to === 'in');
    toOut[k] = +(f.to === 'out');
    seedOf[k] = +(f.from === 'in' || !!f.seed);
  });
  // S grows when nothing leaves it; then the new territory is revealed by a front.
  const grows = features.every((f) => f.from !== 'in' || f.to === 'in') && seedOf.some((x) => x === 1);

  /** The old field, the new one, and the distance to the front's seeds, at a point. */
  const scratch = new Float64Array(3);
  const sample = (px: number, py: number): Float64Array => {
    let fIn = Infinity;
    let fOut = Infinity;
    let tIn = Infinity;
    let tOut = Infinity;
    let seed = Infinity;
    for (let k = 0; k < n; k++) {
      if (!(toIn[k] | toOut[k] | fromIn[k] | fromOut[k] | seedOf[k])) continue;
      const d = segmentDistance(px, py, ax[k], ay[k], bx[k], by[k]);
      if (toIn[k] && d < tIn) tIn = d;
      if (toOut[k] && d < tOut) tOut = d;
      if (fromIn[k] && d < fIn) fIn = d;
      if (fromOut[k] && d < fOut) fOut = d;
      if (seedOf[k] && d < seed) seed = d;
    }
    scratch[0] = field(fIn, fOut, from, options.needBoth);
    scratch[1] = field(tIn, tOut, to, options.needBoth);
    scratch[2] = seed;
    return scratch;
  };

  const count = cols * rows;
  const oldF = new Float64Array(count);
  const newF = new Float64Array(count);
  const seedD = new Float64Array(count);
  // The front's radius runs over the seed distances of the territory to be revealed.
  let r0 = Infinity;
  let r1 = -Infinity;
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const [fo, fn, sd] = sample(i * sx, j * sy);
      const at = index(i, j);
      oldF[at] = fo;
      newF[at] = fn;
      seedD[at] = sd;
      if (fn < 0 && fo >= 0) {
        r0 = Math.min(r0, sd);
        r1 = Math.max(r1, sd);
      }
    }
  }
  const sweep = grows && r0 <= r1 && Number.isFinite(r1);
  const radius = r0 - 0.5 + (r1 - r0 + 1) * t;
  /** The field drawn at blend t. */
  const blend = (fo: number, fn: number, sd: number): number => {
    if (t >= 1) return fn;
    if (t <= 0) return fo;
    if (sweep) return Math.max(fn, Math.min(fo, sd - radius));
    return (1 - t) * fo + t * fn;
  };
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const at = index(i, j);
      value[at] = blend(oldF[at], newF[at], seedD[at]);
    }
  }
  const exact = (px: number, py: number): number => {
    const [fo, fn, sd] = sample(px, py);
    return blend(fo, fn, sd);
  };

  // Node positions (the padding ring sits one cell outside the canvas).
  const xOf = (i: number) => i * sx;
  const yOf = (j: number) => j * sy;

  // Crossing points, one per grid edge, keyed by edge id: 2·node + 0 (to the right) / 1 (down).
  // Inside the canvas each is refined by bisection on the exact field, so the border is
  // accurate even where the field bends sharply (near vertices).
  const inner = (i: number, j: number) => i >= 0 && j >= 0 && i <= nx && j <= ny;
  const crossing = new Map<number, Point>();
  const crossAt = (i: number, j: number, horizontal: boolean): number => {
    const id = index(i, j) * 2 + (horizontal ? 0 : 1);
    if (!crossing.has(id)) {
      const [i2, j2] = horizontal ? [i + 1, j] : [i, j + 1];
      const f1 = value[index(i, j)];
      const f2 = value[index(i2, j2)];
      const [x1, y1, x2, y2] = [xOf(i), yOf(j), xOf(i2), yOf(j2)];
      let s = f1 / (f1 - f2);
      if (inner(i, j) && inner(i2, j2)) {
        let lo = 0;
        let hi = 1;
        for (let k = 0; k < 7; k++) {
          const v = exact(x1 + (x2 - x1) * s, y1 + (y2 - y1) * s);
          if (v < 0 === f1 < 0) lo = s;
          else hi = s;
          s = (lo + hi) / 2;
        }
      }
      crossing.set(id, { x: x1 + (x2 - x1) * s, y: y1 + (y2 - y1) * s });
    }
    return id;
  };

  // Marching squares: each cell adds up to two segments between crossings on its sides.
  const segA: number[] = [];
  const segB: number[] = [];
  const segPad: boolean[] = [];
  for (let j = -1; j <= ny; j++) {
    for (let i = -1; i <= nx; i++) {
      const v00 = value[index(i, j)];
      const v10 = value[index(i + 1, j)];
      const v11 = value[index(i + 1, j + 1)];
      const v01 = value[index(i, j + 1)];
      const c = (v00 < 0 ? 1 : 0) | (v10 < 0 ? 2 : 0) | (v11 < 0 ? 4 : 0) | (v01 < 0 ? 8 : 0);
      if (c === 0 || c === 15) continue;
      const pad = i < 0 || j < 0 || i >= nx || j >= ny;
      const T = () => crossAt(i, j, true);
      const B = () => crossAt(i, j + 1, true);
      const L = () => crossAt(i, j, false);
      const R = () => crossAt(i + 1, j, false);
      const add = (p: number, q: number) => {
        segA.push(p);
        segB.push(q);
        segPad.push(pad);
      };
      // Saddles (opposite corners inside): the centre decides which corners connect.
      const centreIn = v00 + v10 + v11 + v01 < 0;
      switch (c) {
        case 1:
        case 14:
          add(L(), T());
          break;
        case 2:
        case 13:
          add(T(), R());
          break;
        case 3:
        case 12:
          add(L(), R());
          break;
        case 4:
        case 11:
          add(R(), B());
          break;
        case 6:
        case 9:
          add(T(), B());
          break;
        case 7:
        case 8:
          add(L(), B());
          break;
        case 5:
          if (centreIn) {
            add(T(), R());
            add(B(), L());
          } else {
            add(L(), T());
            add(R(), B());
          }
          break;
        case 10:
          if (centreIn) {
            add(L(), T());
            add(R(), B());
          } else {
            add(T(), R());
            add(B(), L());
          }
          break;
      }
    }
  }

  // Chain the segments into closed loops through the crossings they share (each crossing
  // is shared by exactly the two cells on either side of its grid edge).
  const at = new Map<number, number[]>();
  for (let s = 0; s < segA.length; s++) {
    for (const id of [segA[s], segB[s]]) {
      const list = at.get(id);
      if (list) list.push(s);
      else at.set(id, [s]);
    }
  }
  const used = new Uint8Array(segA.length);
  const region: Point[][] = [];
  const border: Point[][] = [];
  for (let start = 0; start < segA.length; start++) {
    if (used[start]) continue;
    // Walk the loop: crossing ids[k] → ids[k + 1] is segment k, padding if pads[k].
    const ids: number[] = [segA[start]];
    const pads: boolean[] = [];
    let s = start;
    let id = segB[start];
    for (;;) {
      used[s] = 1;
      pads.push(segPad[s]);
      ids.push(id);
      const next = (at.get(id) ?? []).find((x) => !used[x]);
      if (next === undefined) break;
      id = segA[next] === id ? segB[next] : segA[next];
      s = next;
    }
    const points = ids.map((c) => crossing.get(c)!);
    region.push(points.slice(0, -1)); // the last crossing repeats the first
    // The border: runs of segments off the padding frame.
    const firstPad = pads.indexOf(true);
    if (firstPad < 0) {
      border.push(points); // a closed border loop, ending where it starts
      continue;
    }
    let run: Point[] = [];
    for (let k = 1; k <= pads.length; k++) {
      const seg = (firstPad + k) % pads.length; // start just after padding, so runs don't wrap
      if (pads[seg]) {
        if (run.length > 1) border.push(run);
        run = [];
        continue;
      }
      if (!run.length) run.push(points[seg]);
      run.push(points[seg + 1]);
    }
    if (run.length > 1) border.push(run);
  }
  return { region, border };
}

/** SVG path data for closed loops. */
export function loopsPath(loops: Point[][]): string {
  return loops.map((ps) => `M ${ps.map((p) => `${round(p.x)} ${round(p.y)}`).join(' L ')} Z`).join(' ');
}

/** SVG path data for open polylines. */
export function polylinesPath(lines: Point[][]): string {
  return lines.map((ps) => `M ${ps.map((p) => `${round(p.x)} ${round(p.y)}`).join(' L ')}`).join(' ');
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
