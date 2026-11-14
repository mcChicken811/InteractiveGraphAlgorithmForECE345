import type { Graph, NodeId } from './graph.js';

/**
 * Force-directed layout for undirected, unweighted graphs that may be disconnected.
 *
 * Within each connected component: Fruchterman & Reingold, "Graph Drawing by
 * Force-directed Placement" (1991), a refinement of Eades' spring embedder (1984):
 *  - every pair of nodes repels with force  k² / d
 *  - every edge pulls its endpoints together with force  d² / k
 *  - each node moves along its net force, never further than the current
 *    "temperature", which cools every step so the layout settles.
 *
 * Step size: each node's step is its force divided by its own stiffness — the diagonal of
 * the energy's Hessian, Σ 2d/k over its edges plus Σ k²/d² over the other nodes — i.e.
 * gradient descent with a Jacobi (diagonal) preconditioner. A single global step size
 * (plain gradient descent, as before) is an explicit Euler step on a stiff system: the
 * springs at a node add up, so a node of high degree is much stiffer than a leaf, and
 * any step large enough for the leaves overshoots at the hubs. Past the stability limit
 * (step × stiffness > 2) the fastest mode flips sign every frame — neighbouring nodes
 * zig-zagging at 30 Hz until the temperature has cooled. Dividing by each node's own
 * stiffness keeps every node under that limit whatever its degree, and lets leaves take
 * larger steps, so the layout also settles sooner. The forces, and so the layout it
 * settles into, are unchanged. (d3-force tackles the same stiffness by dividing each link's
 * strength by its ends' degree; a higher-order integrator such as RK4 does not help, as
 * its stability region is barely wider than Euler's, at four force evaluations a step.)
 *
 * Weighted layouts (an EdgeWeight given): each edge's ideal length is k·|w|/mean|w|,
 * within [minLengthFactor, maxLengthFactor]; its pull d²·k²/k_e³ (times weightedPull)
 * balances the repulsion at that length. Weights need not obey the triangle inequality, so
 * not every set of lengths can be drawn; the cheapest compromise flattens a triangle into
 * a line, running an edge through a node, so weighted layouts also keep nodes off edges
 * they are not on. Without weights the layout is exactly the unweighted one.
 *
 * Disconnected graphs: the components are laid out independently and then packed
 * into the canvas, the approach used by Graphviz (`pack`), OGDF
 * (ComponentSplitterLayout + TileToRowsCCPacker) and yFiles (ComponentLayout), and
 * studied by Freivalds, Dogrusoz & Kikusts, "Disconnected Graph Layout and the
 * Polyomino Packing Approach" (GD 2001). Running one global simulation instead lets
 * repulsion act between unrelated components, which only a "gravity" force can
 * counter (ForceAtlas2, d3's forceX/forceY): components then drift, get pushed
 * into the walls, or trap each other, and the layout never truly settles.
 *
 * Packing uses rows of component bounding boxes (tile-to-rows / shelf packing,
 * largest component first) shaped to the canvas's aspect ratio. Each step moves a
 * component a fraction of the way to its slot, so changes animate smoothly.
 */

export interface Bounds {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * The weight of the edge between two nodes as the layout should read it: a magnitude
 * (≥ 0). Given, edges get ideal lengths in proportion to it (see ForceLayout.lengthFactors);
 * left out, every edge has the same ideal length k.
 */
export type EdgeWeight = (a: NodeId, b: NodeId) => number;

export interface LayoutOptions {
  /**
   * Keep node centres at least this far from the canvas edges; also the margin
   * around each component's bounding box (roughly a node's radius).
   */
  padding: number;
  /** Clamp range for the ideal edge length k (px). */
  minEdgeLength: number;
  maxEdgeLength: number;
  /** Space between packed components, as a multiple of k. */
  componentGap: number;
  /** Fraction of the remaining distance a component moves toward its slot per step. */
  packRate: number;
  /**
   * Relaxation factor of each node's step: its net force times this, divided by its
   * stiffness (see the class comment). 1 is the limit for a spring network (neighbours
   * moving in opposite directions, as in a grid or an even cycle, then neither grow nor
   * shrink); the stiffness also counts repulsion, so it errs a little high and 1 settles.
   * Above it, that mode grows into a sub-pixel zig-zag that keeps the layout from resting;
   * below it, the layout settles more slowly and untangles less often.
   */
  stepScale: number;
  /** Largest move per step at full temperature, as a fraction of k. */
  maxStep: number;
  /** Temperature multiplier per step; 0.985 cools over at most ~350 steps (~6 s at 60 fps). */
  cooling: number;
  /**
   * Weighted layouts: the shortest and longest ideal edge length, as multiples of k. An
   * edge's ideal length is k·|w|/mean|w| (proportional to its weight), kept within these
   * so a light edge cannot pull its ends on top of each other and a heavy one cannot
   * stretch the drawing off the canvas.
   */
  minLengthFactor: number;
  maxLengthFactor: number;
  /**
   * Weighted layouts: how hard edges pull toward their own lengths, against the repulsion
   * of every other node (1 is Fruchterman–Reingold's balance).
   */
  weightedPull: number;
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  padding: 24,
  minEdgeLength: 70,
  maxEdgeLength: 150,
  componentGap: 0.5,
  packRate: 0.15,
  stepScale: 1,
  maxStep: 0.25,
  cooling: 0.985,
  minLengthFactor: 0.45,
  maxLengthFactor: 2.5,
  weightedPull: 2,
};

/** Below this temperature the force simulation counts as settled. */
const MIN_TEMPERATURE = 0.005;
/** Movements below this (px) count as "at rest". */
const REST_THRESHOLD = 0.05;
/**
 * When the packed layout overflows the canvas, k shrinks (e.g. a long path drawn straight),
 * but never below this many node "paddings" (≈ radii), so nodes cannot overlap.
 */
const MIN_EDGE_IN_PADDINGS = 2;
/** The packed layout may fill at most this fraction of the canvas before it is shrunk. */
const FIT = 0.95;
/** Shrink by at most this factor per step, so the fit is smooth and does not fold the drawing. */
const MAX_SHRINK_PER_STEP = 0.97;
/** Below this fraction (in both directions), a shrunken layout grows back toward scale 1. */
const GROW = 0.8;
/** Largest rotation per step (radians, ≈3°) when aligning an overflowing component. */
const MAX_ROTATION = 0.05;
/** Only rotate components whose spread along their minor axis is below this fraction of the major. */
const ELONGATED = 0.6;
/** Golden angle (radians): spreads per-node jiggle directions evenly. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/**
 * Weighted layouts: how far (in paddings ≈ node radii) a node must stay from edges it is
 * not on. 1.25 leaves a visible gap; more costs more of the edge lengths' fidelity.
 */
const EDGE_CLEARANCE = 1.25;
/** Jiggle strength as a fraction of k at full temperature (fades with temperature²). */
const JIGGLE = 0.03;

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Packing {
  /** Where each box's centre should go, in input order. */
  centers: Point[];
  /** Size of the whole packing. */
  width: number;
  height: number;
}

type Size = { width: number; height: number };
type Row = { items: number[]; width: number; height: number };

/** Fills rows left to right, starting a new row when the next box would exceed `rowLimit`. */
function fillRows(sizes: ReadonlyArray<Size>, gap: number, rowLimit: number): Row[] {
  const rows: Row[] = [];
  let row: Row = { items: [], width: 0, height: 0 };
  sizes.forEach((s, i) => {
    if (row.items.length && row.width + gap + s.width > rowLimit) {
      rows.push(row);
      row = { items: [], width: 0, height: 0 };
    }
    row.width = row.items.length ? row.width + gap + s.width : s.width;
    row.height = Math.max(row.height, s.height);
    row.items.push(i);
  });
  rows.push(row);
  return rows;
}

function extent(rows: Row[], gap: number): Size {
  return {
    width: Math.max(...rows.map((r) => r.width)),
    height: rows.reduce((sum, r) => sum + r.height, 0) + gap * (rows.length - 1),
  };
}

/**
 * Packs boxes (given largest-first) into centred rows (tile-to-rows / shelf packing).
 *
 * Several row widths are tried, from the widest box up to the canvas width, starting
 * with one that matches the canvas's aspect ratio; the packing that leaves the most
 * room on the canvas (largest min(canvas/packing) ratio) wins, ties going to the
 * aspect-ratio guess so the choice stays stable while the layout animates.
 */
export function packRows(sizes: ReadonlyArray<Size>, bounds: Bounds, gap: number): Packing {
  if (sizes.length === 0) return { centers: [], width: 0, height: 0 };

  const area = sizes.reduce((sum, s) => sum + (s.width + gap) * (s.height + gap), 0);
  const widest = Math.max(...sizes.map((s) => s.width));
  const aspect = bounds.width / Math.max(1, bounds.height);
  const limits = [Math.max(widest, Math.min(bounds.width, Math.sqrt(area * aspect)))];
  const STEPS = 8;
  for (let i = 0; i <= STEPS; i++) limits.push(widest + ((bounds.width - widest) * i) / STEPS);

  let best: { rows: Row[]; size: Size; room: number } | null = null;
  for (const limit of limits) {
    const rows = fillRows(sizes, gap, limit);
    const size = extent(rows, gap);
    const room = Math.min(bounds.width / size.width, bounds.height / size.height);
    if (!best || room > best.room * 1.01) best = { rows, size, room };
  }
  const { rows, size } = best!;

  // Centre the packing on the canvas, and each row within the packing.
  const centers: Point[] = new Array(sizes.length);
  let y = (bounds.height - size.height) / 2;
  for (const r of rows) {
    let x = (bounds.width - r.width) / 2;
    for (const i of r.items) {
      centers[i] = { x: x + sizes[i].width / 2, y: y + r.height / 2 };
      x += sizes[i].width + gap;
    }
    y += r.height + gap;
  }
  return { centers, width: size.width, height: size.height };
}

export class ForceLayout {
  /** Force-simulation temperature: 1 = hot (just started), 0 = settled. */
  private temperature = 0;
  /** True while components are still travelling to their packed slots. */
  private packing = false;
  /** Shrinks k when the packed components do not fit the canvas. */
  private scale = 1;
  readonly options: LayoutOptions;

  constructor(options: Partial<LayoutOptions> = {}) {
    this.options = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
  }

  /** True while the layout still has work to do and `step()` should keep being called. */
  get running(): boolean {
    return this.temperature > MIN_TEMPERATURE || this.packing;
  }

  /** Restart (or keep) the simulation at least at the given temperature. */
  reheat(temperature = 1): void {
    this.temperature = Math.max(this.temperature, Math.min(1, temperature));
    this.packing = true;
  }

  stop(): void {
    this.temperature = 0;
    this.packing = false;
  }

  /** Ideal edge length: proportional to the side of the square each node would get if area were shared evenly. */
  idealEdgeLength(bounds: Bounds, nodeCount: number): number {
    const { padding, minEdgeLength, maxEdgeLength } = this.options;
    const area = Math.max(1, bounds.width - 2 * padding) * Math.max(1, bounds.height - 2 * padding);
    const k = 0.6 * Math.sqrt(area / Math.max(1, nodeCount));
    return Math.min(maxEdgeLength, Math.max(minEdgeLength, k));
  }

  /**
   * Advances the layout one step, moving nodes in `graph` in place.
   * Nodes in `pinned` (e.g. one being dragged) exert forces but do not move, and
   * their component is not repositioned by the packing.
   * Returns the largest distance any node moved.
   */
  step(graph: Graph, bounds: Bounds, pinned: ReadonlySet<NodeId> = new Set(), weight?: EdgeWeight): number {
    const nodes = graph.getNodes();
    if (!this.running || nodes.length === 0) {
      this.stop();
      return 0;
    }

    const { padding, componentGap, packRate, stepScale, maxStep, cooling } = this.options;
    const minK = MIN_EDGE_IN_PADDINGS * padding;
    let k = Math.max(minK, this.idealEdgeLength(bounds, nodes.length) * this.scale);
    const pos = new Map<NodeId, Point>(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    const components = graph.connectedComponents();
    const lengths = weight ? this.lengthFactors(graph, weight) : null;

    // 1. Fruchterman–Reingold forces, within each component only.
    const limit = this.temperature * maxStep * k;
    for (const component of components) {
      if (component.length < 2) continue;
      const { force, stiffness } = this.componentForces(graph, component, pos, k, lengths);
      for (const id of component) {
        if (pinned.has(id)) continue;
        const f = force.get(id)!;
        // Jacobi-preconditioned step: the force over this node's own stiffness.
        const rate = stepScale / Math.max(1, stiffness.get(id)!);
        // Small deterministic jiggle that fades as the layout cools. Pure FR forces keep
        // symmetric starts (e.g. nodes on one line) symmetric, an unstable equilibrium
        // it can never leave; d3-force's "jiggle" serves the same purpose.
        const jiggle = JIGGLE * k * this.temperature ** 2;
        let mx = f.x * rate + Math.cos(id * GOLDEN_ANGLE) * jiggle;
        let my = f.y * rate + Math.sin(id * GOLDEN_ANGLE) * jiggle;
        const len = Math.hypot(mx, my);
        if (len > limit) {
          mx = (mx / len) * limit;
          my = (my / len) * limit;
        }
        const p = pos.get(id)!;
        p.x += mx;
        p.y += my;
      }
    }

    // Collision pass (like d3's forceCollide): FR is a local optimiser, and a drawing
    // that folds over itself can pull two nodes on top of each other. Push apart any
    // pair closer than two node "paddings" (≈ radii); components never overlap thanks
    // to the packing, so only pairs within a component are checked.
    for (const component of components) resolveCollisions(component, pos, pinned, 2 * padding);
    // Weighted: lengths that cannot all be met (weights need not obey the triangle
    // inequality) are cheapest to compromise on by flattening a triangle into a line, which
    // runs an edge straight through a node. Keep nodes off edges they are not on (as in
    // Bertault's PrEd, 2000). Unweighted layouts are left exactly as they were.
    if (lengths) for (const component of components) clearEdges(graph, component, pos, pinned, EDGE_CLEARANCE * padding);

    // 2. Turn long, thin components that overflow the canvas toward its longer side,
    //    a few degrees per step. FR forces don't depend on rotation, so this never
    //    fights the simulation (e.g. a long path drawn vertically on a wide canvas).
    for (const component of components) {
      if (component.length < 3 || component.some((id) => pinned.has(id))) continue;
      const box = boundingBox(component, pos, padding);
      const overflows =
        box.maxX - box.minX > FIT * bounds.width || box.maxY - box.minY > FIT * bounds.height;
      if (overflows) rotateTowardLongSide(component, pos, bounds);
    }

    // 3. Fit to the canvas. If the packed components would not fit, shrink every
    //    component about its own centre, and k, by the same factor. With no global
    //    forces, FR's equilibrium scales linearly with k, so the smaller drawing is
    //    still in balance instead of being squashed against the walls.
    let boxes = components.map((c) => boundingBox(c, pos, padding));
    let packed = packRows(sizesOf(boxes), bounds, componentGap * k);
    const fit = Math.min((FIT * bounds.width) / packed.width, (FIT * bounds.height) / packed.height);
    const factor = Math.min(1, Math.max(fit, MAX_SHRINK_PER_STEP, minK / k));
    if (factor < 1) {
      components.forEach((component, i) => {
        if (component.some((id) => pinned.has(id))) return;
        const cx = (boxes[i].minX + boxes[i].maxX) / 2;
        const cy = (boxes[i].minY + boxes[i].maxY) / 2;
        for (const id of component) {
          const p = pos.get(id)!;
          p.x = cx + (p.x - cx) * factor;
          p.y = cy + (p.y - cy) * factor;
        }
      });
      k *= factor;
      this.scale *= factor;
      boxes = components.map((c) => boundingBox(c, pos, padding));
      packed = packRows(sizesOf(boxes), bounds, componentGap * k);
    }
    // Drift back toward the natural size (scale 1) when there is plenty of room.
    if (this.scale < 1 && packed.width < GROW * bounds.width && packed.height < GROW * bounds.height) {
      this.scale = Math.min(1, this.scale * 1.002);
    }

    // 4. Move each component a fraction of the way toward its packed slot.
    let packMoved = 0;
    components.forEach((component, i) => {
      if (component.some((id) => pinned.has(id))) return;
      const box = boxes[i];
      const dx = (packed.centers[i].x - (box.minX + box.maxX) / 2) * packRate;
      const dy = (packed.centers[i].y - (box.minY + box.maxY) / 2) * packRate;
      packMoved = Math.max(packMoved, Math.hypot(dx, dy));
      for (const id of component) {
        const p = pos.get(id)!;
        p.x += dx;
        p.y += dy;
      }
    });

    // 5. Write back, keeping every node on the canvas as a last resort.
    const minX = Math.min(padding, bounds.width / 2);
    const minY = Math.min(padding, bounds.height / 2);
    const maxX = Math.max(minX, bounds.width - padding);
    const maxY = Math.max(minY, bounds.height - padding);
    let maxMoved = 0;
    for (const node of nodes) {
      if (pinned.has(node.id)) continue;
      const p = pos.get(node.id)!;
      const x = Math.min(maxX, Math.max(minX, p.x));
      const y = Math.min(maxY, Math.max(minY, p.y));
      maxMoved = Math.max(maxMoved, Math.hypot(x - node.x, y - node.y));
      graph.moveNode(node.id, x, y);
    }

    this.temperature *= cooling;
    this.packing = packMoved > REST_THRESHOLD;
    if (maxMoved < REST_THRESHOLD) this.stop();
    return maxMoved;
  }

  /** Runs until settled (or `maxSteps`), returning the number of steps taken. */
  settle(graph: Graph, bounds: Bounds, maxSteps = 2000, weight?: EdgeWeight): number {
    this.reheat();
    let steps = 0;
    while (this.running && steps < maxSteps) {
      this.step(graph, bounds, new Set(), weight);
      steps++;
    }
    return steps;
  }

  /**
   * Each edge's ideal length as a multiple of k (keyed "a-b", a < b): its weight over the
   * mean weight of the graph's edges, within [minLengthFactor, maxLengthFactor]. Edges of
   * weight 0 get the shortest length; with no positive weight at all, every edge gets 1
   * (the unweighted layout), and so does every edge when all weights are equal.
   */
  lengthFactors(graph: Graph, weight: EdgeWeight): Map<string, number> {
    const { minLengthFactor, maxLengthFactor } = this.options;
    const pairs = graph.undirectedView.edges();
    const magnitudes = pairs.map(([a, b]) => Math.abs(weight(a, b)));
    const positive = magnitudes.filter((m) => m > 0);
    const mean = positive.length ? positive.reduce((s, m) => s + m, 0) / positive.length : 0;
    const factors = new Map<string, number>();
    pairs.forEach(([a, b], i) => {
      const f = mean > 0 ? magnitudes[i] / mean : 1;
      factors.set(`${a}-${b}`, Math.min(maxLengthFactor, Math.max(minLengthFactor, f)));
    });
    return factors;
  }

  /**
   * Net Fruchterman–Reingold force on each node of one connected component, and each
   * node's stiffness: how fast that force changes as the node moves (the diagonal of the
   * energy's Hessian, in magnitude): Σ k²/d² over the other nodes plus Σ 2d/k over its edges.
   */
  private componentForces(
    graph: Graph,
    component: NodeId[],
    pos: ReadonlyMap<NodeId, Point>,
    k: number,
    lengths: ReadonlyMap<string, number> | null = null,
  ): { force: Map<NodeId, Point>; stiffness: Map<NodeId, number> } {
    const force = new Map<NodeId, Point>(component.map((id) => [id, { x: 0, y: 0 }]));
    const stiffness = new Map<NodeId, number>(component.map((id) => [id, 0]));
    const ids = [...component].sort((a, b) => a - b);

    // Repulsion between every pair in the component: k² / d.
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const p = pos.get(ids[i])!;
        const q = pos.get(ids[j])!;
        let dx = p.x - q.x;
        let dy = p.y - q.y;
        let d = Math.hypot(dx, dy);
        if (d < 0.01) {
          // Coincident nodes: separate them in a deterministic direction.
          const angle = (ids[i] * 7 + ids[j] * 13) % 360;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          d = 1;
        }
        const f = (k * k) / d;
        addForce(force.get(ids[i])!, (dx / d) * f, (dy / d) * f);
        addForce(force.get(ids[j])!, (-dx / d) * f, (-dy / d) * f);
        const s = (k * k) / (d * d);
        stiffness.set(ids[i], stiffness.get(ids[i])! + s);
        stiffness.set(ids[j], stiffness.get(ids[j])! + s);
      }
    }

    // Attraction along each edge: d² / k. Directions are ignored, so a pair joined by
    // arcs both ways attracts like one edge and switching directed/undirected mode
    // never changes the layout.
    for (const a of ids) {
      for (const b of graph.undirectedView.neighbors(a)) {
        if (b < a) continue; // each pair once
        const p = pos.get(a)!;
        const q = pos.get(b)!;
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        const d = Math.hypot(dx, dy);
        if (d < 0.01) continue;
        // Weighted: the edge's own ideal length k_e = k·s. Pulling with d²·k²/k_e³ balances
        // the repulsion k²/d at d = k_e for a lone pair (s = 1 is plain d²/k).
        const factor = lengths?.get(`${a}-${b}`) ?? 1;
        const pull = factor === 1 && !lengths ? 1 : this.options.weightedPull / factor ** 3;
        const f = ((d * d) / k) * pull;
        addForce(force.get(a)!, (-dx / d) * f, (-dy / d) * f);
        addForce(force.get(b)!, (dx / d) * f, (dy / d) * f);
        const s = ((2 * d) / k) * pull;
        stiffness.set(a, stiffness.get(a)! + s);
        stiffness.set(b, stiffness.get(b)! + s);
      }
    }
    return { force, stiffness };
  }
}

function addForce(target: Point, x: number, y: number): void {
  target.x += x;
  target.y += y;
}

/** Separates overlapping nodes of one component; pinned nodes stay put. */
function resolveCollisions(
  component: NodeId[],
  pos: Map<NodeId, Point>,
  pinned: ReadonlySet<NodeId>,
  minDistance: number,
): void {
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < component.length; i++) {
      for (let j = i + 1; j < component.length; j++) {
        const a = component[i];
        const b = component[j];
        const p = pos.get(a)!;
        const q = pos.get(b)!;
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d >= minDistance || d < 1e-6) continue; // exact overlaps are split by FR's jiggle
        const aFixed = pinned.has(a);
        const bFixed = pinned.has(b);
        if (aFixed && bFixed) continue;
        const push = (minDistance - d) / d;
        const share = aFixed || bFixed ? 1 : 0.5;
        if (!aFixed) {
          p.x -= dx * push * share;
          p.y -= dy * push * share;
        }
        if (!bFixed) {
          q.x += dx * push * share;
          q.y += dy * push * share;
        }
      }
    }
  }
}

/**
 * Pushes nodes of one component off edges they are not on: a node closer than `minDistance`
 * to such an edge (between its ends) moves away from it, and the edge's ends move the other
 * way, half as far each, so the push does not shift the drawing as a whole. Pinned nodes
 * stay put.
 */
function clearEdges(
  graph: Graph,
  component: NodeId[],
  pos: Map<NodeId, Point>,
  pinned: ReadonlySet<NodeId>,
  minDistance: number,
): void {
  const inComponent = new Set(component);
  const edges = graph.undirectedView.edges().filter(([a]) => inComponent.has(a));
  for (let pass = 0; pass < 2; pass++) {
    for (const [a, b] of edges) {
      const p = pos.get(a)!;
      const q = pos.get(b)!;
      const ex = q.x - p.x;
      const ey = q.y - p.y;
      const len2 = ex * ex + ey * ey;
      if (len2 < 1e-6) continue;
      for (const v of component) {
        if (v === a || v === b) continue;
        const r = pos.get(v)!;
        const t = ((r.x - p.x) * ex + (r.y - p.y) * ey) / len2;
        if (t <= 0.05 || t >= 0.95) continue; // near an end: the node–node collision handles it
        const cx = p.x + ex * t;
        const cy = p.y + ey * t;
        let dx = r.x - cx;
        let dy = r.y - cy;
        let d = Math.hypot(dx, dy);
        if (d >= minDistance) continue;
        if (d < 1e-6) {
          // Exactly on the line: step off it to one side (perpendicular).
          dx = -ey;
          dy = ex;
          d = Math.hypot(dx, dy);
          dx /= d;
          dy /= d;
          d = 0;
        } else {
          dx /= d;
          dy /= d;
        }
        const push = minDistance - d;
        const ends = [a, b].filter((id) => !pinned.has(id)).length;
        const nodeShare = pinned.has(v) ? 0 : ends ? 0.5 : 1;
        const endShare = ends ? 1 - nodeShare : 0;
        if (nodeShare) {
          r.x += dx * push * nodeShare;
          r.y += dy * push * nodeShare;
        }
        // The edge moves the other way: its ends, weighted by how near the foot is to each.
        for (const [id, share] of [
          [a, 1 - t],
          [b, t],
        ] as const) {
          if (pinned.has(id) || !endShare) continue;
          const e = pos.get(id)!;
          e.x -= dx * push * endShare * share;
          e.y -= dy * push * endShare * share;
        }
      }
    }
  }
}

/**
 * Rotates a component about its centroid toward the canvas's longer side, by at most
 * MAX_ROTATION. The component's main direction is its principal axis (the dominant
 * eigenvector of the positions' covariance matrix).
 */
function rotateTowardLongSide(component: NodeId[], pos: Map<NodeId, Point>, bounds: Bounds): void {
  let cx = 0;
  let cy = 0;
  for (const id of component) {
    cx += pos.get(id)!.x;
    cy += pos.get(id)!.y;
  }
  cx /= component.length;
  cy /= component.length;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const id of component) {
    const dx = pos.get(id)!.x - cx;
    const dy = pos.get(id)!.y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  // Eigenvalues of [[sxx, sxy], [sxy, syy]]; skip round-ish components.
  const mean = (sxx + syy) / 2;
  const spread = Math.hypot((sxx - syy) / 2, sxy);
  const major = mean + spread;
  const minor = mean - spread;
  if (major <= 0 || Math.sqrt(Math.max(0, minor) / major) > ELONGATED) return;

  const axis = 0.5 * Math.atan2(2 * sxy, sxx - syy); // principal axis angle
  const target = bounds.width >= bounds.height ? 0 : Math.PI / 2;
  // Axes are undirected: bring the difference into (-π/2, π/2].
  let diff = target - axis;
  while (diff > Math.PI / 2) diff -= Math.PI;
  while (diff <= -Math.PI / 2) diff += Math.PI;
  const angle = Math.max(-MAX_ROTATION, Math.min(MAX_ROTATION, diff));
  if (Math.abs(angle) < 1e-4) return;

  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (const id of component) {
    const p = pos.get(id)!;
    const dx = p.x - cx;
    const dy = p.y - cy;
    p.x = cx + dx * cos - dy * sin;
    p.y = cy + dx * sin + dy * cos;
  }
}

function sizesOf(boxes: Box[]): Size[] {
  return boxes.map((b) => ({ width: b.maxX - b.minX, height: b.maxY - b.minY }));
}

function boundingBox(ids: NodeId[], pos: ReadonlyMap<NodeId, Point>, margin: number): Box {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const id of ids) {
    const p = pos.get(id)!;
    box.minX = Math.min(box.minX, p.x - margin);
    box.minY = Math.min(box.minY, p.y - margin);
    box.maxX = Math.max(box.maxX, p.x + margin);
    box.maxY = Math.max(box.maxY, p.y + margin);
  }
  return box;
}
