import { Graph, type NodeId } from './graph.js';
import type { Weighting } from './graph-views.js';
import { ForceLayout, type EdgeWeight } from './layout.js';
import type { ArcDiagram, ForestDiagram, Highlight } from './algorithms/types.js';
import { fitFontSize } from './label-fit.js';
import { halfEllipse, rowLayout, treeLayout } from './arc-diagram.js';
import { cutShape, groupSeams, loopsPath, polylinesPath, type CutFeature, type CutMode, type Side } from './voronoi.js';
import { nodeCountFor, randomArcs, randomPositions } from './random-graph.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const NODE_RADIUS = 20;
/** Pointer travel (px) before a press on a node becomes a drag instead of a click. */
const DRAG_THRESHOLD = 4;
/** Extra space required between two node circles when spawning. */
const MIN_NODE_GAP = 6;
/** How far (px) the two arcs between a pair of nodes bow apart in directed mode. */
const CURVE_OFFSET = 22;
/** Weighted mode: scrolling one page (the window's height) over an edge changes its weight by this much. */
export const WEIGHT_PER_PAGE = 15;
/** Pixels per "line" for wheel events reported in lines (deltaMode 1). */
const LINE_HEIGHT_PX = 16;
/** An algorithm's label inside a node: base font size and the width it may use. */
const SIM_LABEL_FONT = 14;
const SIM_LABEL_WIDTH = NODE_RADIUS * 2 - 8;
/** Arc diagram: how long vertices take to glide into line, and edges to bend into / out of arcs. */
const ARRANGE_MS = 750;
/** How long a cut's border takes to move to its new place when the cut changes. */
const CUT_MS = 650;
/** How a weighting is named in messages. */
const WEIGHTING_NAMES: Record<Weighting, string> = {
  unweighted: 'unweighted',
  weighted: 'weighted',
  positive: 'positive-weighted',
};
/** Numbers the editors' clip paths apart (an id must be unique on the page). */
let clipIds = 0;
const BEND_MS = 450;

interface Point {
  x: number;
  y: number;
}

/** What the current pointer press started on; resolved on pointerup. */
type Pending =
  | { kind: 'node'; id: NodeId; start: Point; offset: Point; dragging: boolean }
  | { kind: 'edge'; a: NodeId; b: NodeId; start: Point }
  | { kind: 'background'; start: Point };

export interface EditorCallbacks {
  /** Called whenever the graph structure changes. */
  onChange?: () => void;
  /** Called with a short status message for the user. */
  onMessage?: (text: string, tone?: 'info' | 'warn') => void;
  /** Called when auto-layout is turned on or off (also when the editor turns it off itself). */
  onAutoLayoutChange?: (enabled: boolean) => void;
  /**
   * How much of the canvas (px) overlays cover at the top (the canvas toolbar) and the
   * bottom (the status bar); the arc diagram keeps its vertices and arcs clear of them.
   */
  canvasInsets?: () => { top: number; bottom: number };
}

/**
 * The arrangement being shown: DFS's topological sort as an arc diagram ('line', see
 * showArcDiagram), its depth-first forest ('forest', see showForest), or BFS's tree
 * ('tree', shown the same way as a forest).
 */
type Arrangement = 'line' | 'forest' | 'tree';

interface ArcState {
  kind: Arrangement;
  /** Whether spine edges are highlighted white. */
  highlightSpine: boolean;
  /** line: the vertices in order. */
  diagram: ArcDiagram | null;
  /** forest: where each vertex goes. */
  forest: ForestDiagram | null;
  rank: Map<NodeId, number>;
  /** tree: the vertices set aside (BFS: not reached yet). */
  aside: Set<NodeId>;
  spine: Set<string>;
  below: Set<string>;
  /** line: edges pointing right to left (DFS: back edges, closing cycles), drawn red. */
  backward: Set<string>;
  /** How far arcs may bulge before running into a neighbouring row or the canvas edge. */
  maxBulge: number;
  /** Exiting: edges are straightening out; the state is dropped once they are straight. */
  leaving: boolean;
}

/** In the forest view, how far a curved edge bulges, as a share of its half length. */
const FOREST_BULGE = 0.6;
/** …and at most (px). */
const FOREST_MAX_BULGE = 110;
/** How far an edge from the tree to the vertices set aside sags, as a share of its half length. */
const ASIDE_SAG = 0.2;

interface Tween<T> {
  from: T;
  to: T;
  start: number;
  duration: number;
}

/**
 * Interactive SVG editor:
 *  - click empty space → add node
 *  - click node, then another node → add edge
 *  - click edge → delete it
 *  - drag node → move it; right-click node (or Delete with it selected) → delete it
 *  - optional auto-layout: a force-directed simulation spaces the nodes out
 *  - directed / undirected view: edges are stored as arcs (first click → second click);
 *    directed mode draws arrows (two curved arcs when they go both ways), undirected
 *    mode draws one plain line per connected pair
 *  - weighted / unweighted / positive view: weighted mode labels every edge with its
 *    weight, and scrolling over an edge changes the weight (WEIGHT_PER_PAGE per page;
 *    up = more); positive mode does the same with each weight's magnitude
 *  - arc diagram (DFS's topological sort): vertices glide into a left-to-right line and
 *    edges bend into half circles (see showArcDiagram)
 */
export class GraphEditor {
  private selected: NodeId | null = null;
  /** While an algorithm runs: no structural edits (dragging nodes is still allowed). */
  private locked = false;
  /** Algorithm state to draw (current vertex, finished vertices, active edges). */
  private highlight: Highlight | null = null;
  private pending: Pending | null = null;
  private cursor: Point | null = null;

  /** Edge the wheel last adjusted, and the fractional weight change not yet applied to it. */
  private wheelEdge: string | null = null;
  private wheelCarry = 0;

  private readonly layout = new ForceLayout({ padding: NODE_RADIUS + 2 });
  /** Weighted modes: whether the layout's edge lengths follow the weights. */
  private weightedLayout = true;
  private autoLayout = false;
  private frame: number | null = null;

  /** Arc diagram state, and the tweens that move vertices into line and bend the edges. */
  private arc: ArcState | null = null;
  /** 0 = edges straight, 1 = full arcs. */
  private bend = 0;
  /**
   * Switching straight from one arrangement to the other: the one before, so each edge's
   * bulge can blend from its old shape to its new one over `morphTween` (0 → 1).
   */
  private arcBefore: ArcState | null = null;
  private morph = 1;
  private morphTween: Tween<number> | null = null;
  private bendTween: Tween<number> | null = null;
  private moveTween: Tween<Map<NodeId, Point>> | null = null;
  private tweenFrame: number | null = null;

  /** An algorithm's cut, drawn under everything: one side's territory and the border. */
  private readonly cutLayer: SVGGElement;
  private readonly cutRegion: SVGPathElement;
  private readonly cutBorder: SVGPathElement;
  /**
   * The borders between S's groups (Kruskal: between trees), clipped to S's territory
   * (cutClip): those of the groups before the latest change fade out (cutSeamsFrom) as
   * those after fade in (cutSeamsTo).
   */
  private readonly cutClip: SVGPathElement;
  private readonly cutSeamsFrom: SVGPathElement;
  private readonly cutSeamsTo: SVGPathElement;
  /** The geometry the cut was last drawn for, to skip redrawing it when nothing moved. */
  private cutKey = '';
  /** The geometry the seams were last traced for (they don't depend on cutT). */
  private seamKey = '';
  /** The seams before the latest change, while they fade out ('' when they stay as they were). */
  private seamsFromPath = '';
  /**
   * The cut being drawn: its S before (cutFrom) and after (cutTo) the latest change, and
   * how far the border has moved between them (cutT, 0 → 1). null: no cut.
   */
  private cutFrom: ReadonlySet<NodeId> | null = null;
  private cutTo: ReadonlySet<NodeId> | null = null;
  /** The group of each vertex of S (its smallest vertex), before and after; null: one group. */
  private cutGroupsFrom: ReadonlyMap<NodeId, NodeId> | null = null;
  private cutGroupsTo: ReadonlyMap<NodeId, NodeId> | null = null;
  private cutT = 1;
  private cutTween: Tween<number> | null = null;
  private readonly edgeLayer: SVGGElement;
  private readonly previewLine: SVGLineElement;
  private readonly nodeLayer: SVGGElement;
  private readonly nodeEls = new Map<NodeId, SVGGElement>();
  private readonly edgeEls = new Map<string, SVGGElement>();

  constructor(
    private readonly svg: SVGSVGElement,
    private readonly graph: Graph,
    private readonly callbacks: EditorCallbacks = {},
  ) {
    this.cutLayer = svgEl('g', { class: 'cut', 'aria-hidden': 'true' });
    this.cutRegion = svgEl('path', { class: 'cut-region' });
    this.cutBorder = svgEl('path', { class: 'cut-border' });
    const clipId = `cut-clip-${++clipIds}`;
    const clip = svgEl('clipPath', { id: clipId });
    this.cutClip = svgEl('path', { 'clip-rule': 'evenodd' });
    clip.append(this.cutClip);
    this.cutSeamsFrom = svgEl('path', { class: 'cut-seam' });
    this.cutSeamsTo = svgEl('path', { class: 'cut-seam' });
    const seams = svgEl('g', { 'clip-path': `url(#${clipId})` });
    seams.append(this.cutSeamsFrom, this.cutSeamsTo);
    this.cutLayer.append(clip, this.cutRegion, seams, this.cutBorder);
    this.edgeLayer = svgEl('g', { class: 'edges' });
    this.previewLine = svgEl('line', { class: 'preview-line' });
    this.nodeLayer = svgEl('g', { class: 'nodes' });
    svg.append(arrowDefs(), this.cutLayer, this.edgeLayer, this.previewLine, this.nodeLayer);

    svg.addEventListener('pointerdown', this.onPointerDown);
    svg.addEventListener('pointermove', this.onPointerMove);
    svg.addEventListener('pointerup', this.onPointerUp);
    svg.addEventListener('pointercancel', this.onPointerCancel);
    svg.addEventListener('pointerleave', this.onPointerLeave);
    svg.addEventListener('contextmenu', this.onContextMenu);
    svg.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.onResize);

    this.render();
  }

  /** Removes every node and edge. */
  clear(): void {
    this.graph.clear();
    this.selected = null;
    this.pending = null;
    this.render();
    this.changed();
    this.message('Graph cleared. Click empty space to add a node.');
  }

  /**
   * Randomise: on an empty canvas, scatters a handful of nodes and connects them; with
   * nodes already placed, keeps them where they are and replaces their edges with a
   * random set. The graph is random for the current mode: directed graphs may join a
   * pair both ways; weighted ones get weights from −20 to 20 (never 0), positive ones
   * from 1 to 20, and unweighted ones weight 0. It is still stored as weighted directed
   * arcs, as every edge is. See random-graph.ts.
   */
  randomise(rand: () => number = Math.random): void {
    if (this.locked) return;
    const fresh = this.graph.nodeCount === 0;
    if (fresh) {
      const area = this.freeArea();
      const gap = NODE_RADIUS * 2 + 56;
      for (const p of randomPositions(nodeCountFor(area, gap), area, gap, rand)) this.graph.addNode(p.x, p.y);
    }
    const nodes = this.graph.getNodes();
    this.graph.clearEdges();
    const { directed, weighted, weighting } = this.graph;
    // Weighted: negative weights too; Positive: positive ones only.
    const negative = weighting === 'weighted';
    const arcs = randomArcs(nodes, rand, { clearance: NODE_RADIUS + 6, directed, weighted, negative });
    for (const arc of arcs) this.graph.addEdge(nodes[arc.from].id, nodes[arc.to].id, arc.weight);
    this.selected = null;
    this.pending = null;
    this.render();
    this.changed();
    const m = this.graph.edgeCount;
    const edges = `${m} edge${m === 1 ? '' : 's'}`;
    const kind = `${directed ? 'directed' : 'undirected'}, ${WEIGHTING_NAMES[weighting]}`;
    if (fresh) this.message(`Random ${kind} graph: ${nodes.length} nodes and ${edges}.`);
    else if (nodes.length < 2) this.message('Randomise needs at least two nodes to connect.', 'warn');
    else this.message(`Random ${kind} edges between the ${nodes.length} nodes: ${edges}.`);
  }

  /** The canvas minus a node's margin and the overlays at the top and bottom. */
  private freeArea(): { left: number; top: number; right: number; bottom: number } {
    const rect = this.svg.getBoundingClientRect();
    const insets = this.callbacks.canvasInsets?.() ?? { top: 0, bottom: 0 };
    const pad = NODE_RADIUS + 12;
    const top = Math.min(rect.height / 2, insets.top + NODE_RADIUS);
    const bottom = Math.max(top, rect.height - Math.min(rect.height / 2, insets.bottom));
    return { left: pad, top: Math.max(pad, top), right: Math.max(pad, rect.width - pad), bottom: Math.max(pad, bottom - pad) };
  }

  /** The selected node, if any (e.g. the start vertex for an algorithm). */
  get selectedNode(): NodeId | null {
    return this.selected;
  }

  get isLocked(): boolean {
    return this.locked;
  }

  /**
   * Locks the graph while an algorithm runs: clicks no longer add, connect, select or
   * delete anything, and weights cannot be scrolled. Nodes can still be dragged.
   */
  setLocked(locked: boolean): void {
    if (locked === this.locked) return;
    this.locked = locked;
    this.selected = null;
    this.svg.classList.toggle('locked', locked);
    this.render();
  }

  /** Draws an algorithm's state on the graph, or clears it with null. */
  setHighlight(highlight: Highlight | null): void {
    this.highlight = highlight;
    this.svg.classList.toggle('sim-labels', !!highlight?.labels);
    this.svg.classList.toggle('sim-compact', !!highlight?.compact);
    this.svg.classList.toggle('sim-active-dashed', !!highlight?.activeDashed);
    if (!highlight) this.setPeek(null);
    this.setCut(highlight?.cut ? new Set(highlight.cut) : null, highlight?.cutGroups);
    this.render();
  }

  /**
   * Takes the highlight's cut (and S's groups, if given). When it changes, the border
   * moves continuously to its new place (CUT_MS) instead of jumping; a cut appearing grows
   * from nothing.
   */
  private setCut(next: ReadonlySet<NodeId> | null, groups?: NodeId[][]): void {
    if (!next) {
      this.cutFrom = this.cutTo = null;
      this.cutGroupsFrom = this.cutGroupsTo = null;
      this.cutTween = null;
      this.cutT = 1;
      return;
    }
    const nextGroups = groups
      ? new Map(groups.flatMap((group) => group.map((id): [NodeId, NodeId] => [id, Math.min(...group)])))
      : null;
    const prev = this.cutTo;
    const prevGroups = this.cutGroupsTo;
    const sameGroups =
      (prevGroups === null) === (nextGroups === null) &&
      (!nextGroups || (prevGroups!.size === nextGroups.size && [...nextGroups].every(([id, g]) => prevGroups!.get(id) === g)));
    if (prev && prev.size === next.size && [...next].every((id) => prev.has(id)) && sameGroups) return;
    // From the previous target: a change during a move continues from where it was headed.
    this.cutFrom = prev ?? new Set();
    this.cutTo = next;
    this.cutGroupsFrom = prev ? prevGroups : null;
    this.cutGroupsTo = nextGroups;
    if (prefersReducedMotion()) {
      this.cutTween = null;
      this.cutT = 1;
      return;
    }
    this.cutT = 0;
    this.cutTween = { from: 0, to: 1, start: performance.now(), duration: CUT_MS };
    this.startTweens();
  }

  /**
   * Temporarily changes what the vertices show while the pointer is over (or focus is in)
   * a side-panel strip or panel. CSS crossfades, and grows compact vertices back:
   *  - 'ids': the vertex ids (instead of an algorithm's labels, such as BFS distances);
   *  - 'labels': the algorithm's labels (Prim's keys, hidden while vertices are compact);
   *  - null: back to normal.
   */
  setPeek(mode: 'ids' | 'labels' | null): void {
    this.svg.classList.toggle('peek-ids', mode === 'ids');
    this.svg.classList.toggle('peek-labels', mode === 'labels');
  }

  get directed(): boolean {
    return this.graph.directed;
  }

  /**
   * Switches between treating the graph as directed or undirected. The stored arcs never
   * change; only how they are drawn, counted and represented does.
   */
  setDirected(directed: boolean): void {
    if (directed === this.graph.directed) return;
    this.graph.directed = directed;
    this.render();
    this.callbacks.onChange?.();
    if (this.graph.weighted) this.kickLayout(0.5); // a pair's length: both arcs' average, or the edge's weight
    this.message(
      directed
        ? 'Directed: clicking A then B adds an edge A → B.'
        : 'Undirected: edge directions are ignored; arcs both ways count as one edge.',
    );
  }

  get weighted(): boolean {
    return this.graph.weighted;
  }

  get weighting(): Weighting {
    return this.graph.weighting;
  }

  /** setWeighting('weighted') or setWeighting('unweighted'). */
  setWeighted(weighted: boolean): void {
    this.setWeighting(weighted ? 'weighted' : 'unweighted');
  }

  /**
   * Shows the graph as weighted (weight labels; scroll over an edge to change its weight),
   * positive (the same, each weight read as its magnitude) or unweighted. Changing the
   * mode never changes the stored weights.
   */
  setWeighting(weighting: Weighting): void {
    if (weighting === this.graph.weighting) return;
    this.graph.weighting = weighting;
    this.render();
    this.callbacks.onChange?.();
    this.kickLayout(); // edge lengths follow the weights only when they are read
    this.message(
      weighting === 'weighted'
        ? 'Weighted: scroll over an edge to change its weight (up = more).'
        : weighting === 'positive'
          ? 'Positive: every weight counts as its magnitude (−5 as 5). Scroll over an edge to change it (up = more).'
          : 'Unweighted: weights are hidden and every edge counts as weight 1.',
    );
  }

  get autoLayoutEnabled(): boolean {
    return this.autoLayout;
  }

  /** Weighted or Positive: whether auto-layout makes edge lengths follow the weights (default on). */
  get weightedLayoutEnabled(): boolean {
    return this.weightedLayout;
  }

  /**
   * Weighted or Positive: lets auto-layout give edges lengths in proportion to their weights
   * (on, the default), or lay the graph out as usual, every edge alike (off). The layout
   * moves to match; unweighted mode always uses the usual layout.
   */
  setWeightedLayout(enabled: boolean): void {
    if (enabled === this.weightedLayout) return;
    this.weightedLayout = enabled;
    this.kickLayout();
    this.message(
      enabled
        ? 'Weighted layout: edge lengths follow the weights.'
        : 'Usual layout: every edge has the same length, whatever its weight.',
    );
  }

  /** Turns the force-directed auto-layout on or off. Nodes stay where they are when turned off. */
  setAutoLayout(enabled: boolean): void {
    if (enabled === this.autoLayout) return;
    this.autoLayout = enabled;
    this.callbacks.onAutoLayoutChange?.(enabled);
    if (enabled) {
      // The layout takes over the positions: leave the arc diagram.
      this.leaveArcDiagram();
      this.kickLayout();
      this.message('Auto-layout on: drag a node to nudge the layout.');
    } else {
      this.layout.stop();
      if (this.frame !== null) cancelAnimationFrame(this.frame);
      this.frame = null;
      this.message('Auto-layout off: nodes stay where you put them.');
    }
  }

  // ----------------------------------------------------------- arc diagram

  /** Whether an arrangement (DFS's topological sort or its forest) is shown. */
  get arcDiagramActive(): boolean {
    return this.arc !== null && !this.arc.leaving;
  }

  /** Which arrangement is shown: the topological sort's line, the forest, or neither. */
  get arrangement(): Arrangement | null {
    return this.arcDiagramActive ? this.arc!.kind : null;
  }

  /**
   * Shows `diagram`: the vertices glide into `order`, left to right and centred (wrapping
   * into rows, top to bottom, when they don't fit), and the edges bend into half circles
   * whose diameter runs between their ends — above the line, or below for `diagram.below`
   * and `diagram.backward` (red, pointing right to left). `spine` edges are highlighted
   * white, and lie straight on the centre line where they join neighbouring vertices.
   * Auto-layout is turned off, since it would move the vertices.
   *
   * null leaves the diagram: edges straighten out again, and the vertices stay where they
   * are. Turning auto-layout back on does the same.
   */
  showArcDiagram(diagram: ArcDiagram | null): void {
    if (!diagram) {
      this.leaveArcDiagram();
      return;
    }
    const keys = (pairs: Array<[NodeId, NodeId]>) =>
      new Set(pairs.map(([a, b]) => this.edgeKey(a, b, this.graph.directed)));
    this.enterArrangement({
      kind: 'line',
      highlightSpine: true,
      diagram,
      forest: null,
      rank: new Map(diagram.order.map((id, i) => [id, i])),
      aside: new Set(),
      spine: keys(diagram.spine),
      below: keys([...diagram.below, ...(diagram.backward ?? [])]),
      backward: keys(diagram.backward ?? []),
      maxBulge: 0,
      leaving: false,
    });
  }

  /**
   * Shows DFS's depth-first forest: the vertices glide to their places in `forest` (rows
   * by depth, columns by time, as on the timestamp chart), the tree edges (`spine`) are
   * straight and highlighted white, and every other edge curves (a flat half ellipse,
   * bulging to the left of its direction, so edges both ways between two vertices part).
   * Auto-layout is turned off. From the topological sort's line it moves straight over;
   * showArcDiagram(null) or auto-layout leaves it, as for the line.
   *
   * `kind` 'tree' is BFS's tree, shown the same way; `forest.aside` vertices (not reached
   * yet) are grouped on the right. Showing it again with a grown tree glides every vertex
   * to its new place, so newly reached vertices join the tree.
   */
  showForest(forest: ForestDiagram, kind: 'forest' | 'tree' = 'forest'): void {
    const keys = (pairs: Array<[NodeId, NodeId]>) =>
      new Set(pairs.map(([a, b]) => this.edgeKey(a, b, this.graph.directed)));
    this.enterArrangement({
      kind,
      highlightSpine: forest.highlightSpine ?? true,
      diagram: null,
      forest,
      rank: new Map(),
      aside: new Set(forest.aside ?? []),
      spine: keys(forest.spine),
      below: new Set(),
      backward: new Set(),
      maxBulge: FOREST_MAX_BULGE,
      leaving: false,
    });
  }

  /** Starts showing `next`, blending the edges over from the arrangement shown before, if any. */
  private enterArrangement(next: ArcState): void {
    this.setAutoLayout(false);
    const before = this.arc;
    if (before && this.bend > 0 && !prefersReducedMotion()) {
      // Freeze the old arrangement's shapes where they are, then blend to the new ones.
      before.leaving = true;
      this.arcBefore = before;
      this.morph = 0;
      this.morphTween = { from: 0, to: 1, start: performance.now(), duration: ARRANGE_MS };
    } else {
      this.arcBefore = null;
      this.morph = 1;
      this.morphTween = null;
    }
    this.arc = next;
    this.svg.classList.add('arc-diagram');
    this.svg.classList.toggle('forest-view', next.kind !== 'line');
    this.placeArcDiagram(true);
    this.tweenBend(1);
  }

  private leaveArcDiagram(): void {
    if (!this.arc || this.arc.leaving) return;
    this.arc.leaving = true;
    this.moveTween = null; // vertices stay where they are now
    this.finishMorph();
    this.svg.classList.remove('arc-diagram', 'forest-view');
    this.render(); // the white spine goes at once; the arcs straighten out over the tween
    this.tweenBend(0);
  }

  /** Moves the vertices to their places in the arrangement (gliding there if `animate`). */
  private placeArcDiagram(animate: boolean): void {
    const arc = this.arc!;
    const rect = this.svg.getBoundingClientRect();
    const bounds = { width: rect.width, height: rect.height };
    const insets = this.callbacks.canvasInsets?.();
    const pads = insets ? { padTop: insets.top, padBottom: insets.bottom } : {};
    let to: Map<NodeId, Point>;
    if (arc.kind !== 'line') {
      const places = arc.forest!.places.filter((p) => this.graph.getNode(p.id));
      const aside = (arc.forest!.aside ?? []).filter((id) => this.graph.getNode(id));
      const { tree, aside: group } = treeLayout(places, aside.length, bounds, pads);
      to = new Map([...places.map((p, i): [NodeId, Point] => [p.id, tree[i]]), ...aside.map((id, i): [NodeId, Point] => [id, group[i]])]);
    } else {
      const order = arc.diagram!.order.filter((id) => this.graph.getNode(id));
      const { positions, maxBulge } = rowLayout(order.length, bounds, pads);
      arc.maxBulge = maxBulge;
      to = new Map(order.map((id, i) => [id, positions[i]]));
    }
    const order = [...to.keys()];
    if (animate && !prefersReducedMotion()) {
      const from = new Map(order.map((id) => [id, { ...this.graph.getNode(id)! }]));
      this.moveTween = { from, to, start: performance.now(), duration: ARRANGE_MS };
      this.startTweens();
    } else {
      this.moveTween = null;
      for (const [id, p] of to) this.graph.moveNode(id, p.x, p.y);
      this.render();
    }
  }

  private tweenBend(target: number): void {
    if (prefersReducedMotion()) {
      this.bendTween = null;
      this.bend = target;
      if (target === 0 && this.arc?.leaving) this.arc = null;
      this.render();
      return;
    }
    // Entering waits for the vertices to arrive, so the arcs grow as they settle.
    this.bendTween = { from: this.bend, to: target, start: performance.now(), duration: target > 0 ? ARRANGE_MS : BEND_MS };
    this.startTweens();
  }

  private startTweens(): void {
    if (this.tweenFrame === null) this.tweenFrame = requestAnimationFrame(this.tweenTick);
  }

  private tweenTick = (): void => {
    this.tweenFrame = null;
    const now = performance.now();
    const progress = (t: Tween<unknown>) => easeInOut(Math.min(1, Math.max(0, (now - t.start) / t.duration)));
    if (this.moveTween) {
      const k = progress(this.moveTween);
      const dragged = this.pending?.kind === 'node' && this.pending.dragging ? this.pending.id : null;
      for (const [id, to] of this.moveTween.to) {
        const from = this.moveTween.from.get(id)!;
        if (id === dragged || !this.graph.getNode(id)) continue; // a dragged vertex follows the pointer
        this.graph.moveNode(id, from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k);
      }
      if (k >= 1) this.moveTween = null;
    }
    if (this.cutTween) {
      this.cutT = progress(this.cutTween);
      if (this.cutT >= 1) {
        this.cutT = 1;
        this.cutTween = null;
      }
    }
    if (this.morphTween) {
      this.morph = progress(this.morphTween);
      if (this.morph >= 1) this.finishMorph();
    }
    if (this.bendTween) {
      const k = progress(this.bendTween);
      this.bend = this.bendTween.from + (this.bendTween.to - this.bendTween.from) * k;
      if (k >= 1) {
        this.bendTween = null;
        if (this.bend === 0 && this.arc?.leaving) this.arc = null;
      }
    }
    this.render();
    if (this.moveTween || this.bendTween || this.cutTween || this.morphTween) this.startTweens();
  };

  /** Ends a blend between two arrangements: only the new one is left. */
  private finishMorph(): void {
    this.arcBefore = null;
    this.morph = 1;
    this.morphTween = null;
  }

  // ---------------------------------------------------------------- events

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.pending) return;
    const p = this.toLocal(e);
    const target = e.target as Element;

    const nodeEl = target.closest<SVGGElement>('[data-node-id]');
    const edgeEl = target.closest<SVGGElement>('[data-edge-a]');

    if (nodeEl) {
      const id = Number(nodeEl.dataset.nodeId);
      const node = this.graph.getNode(id);
      if (!node) return;
      this.pending = {
        kind: 'node',
        id,
        start: p,
        offset: { x: node.x - p.x, y: node.y - p.y },
        dragging: false,
      };
    } else if (edgeEl) {
      this.pending = {
        kind: 'edge',
        a: Number(edgeEl.dataset.edgeA),
        b: Number(edgeEl.dataset.edgeB),
        start: p,
      };
    } else {
      this.pending = { kind: 'background', start: p };
    }

    this.svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.toLocal(e);
    this.cursor = p;
    const pending = this.pending;

    if (pending?.kind === 'node') {
      if (!pending.dragging && distance(p, pending.start) > DRAG_THRESHOLD) {
        pending.dragging = true;
        this.svg.classList.add('dragging');
      }
      if (pending.dragging) {
        const pos = this.clampToCanvas({ x: p.x + pending.offset.x, y: p.y + pending.offset.y });
        this.graph.moveNode(pending.id, pos.x, pos.y);
        this.render();
        this.kickLayout(0.5); // let the neighbours react to the dragged node
        return;
      }
    }

    this.updatePreview();
  };

  private onPointerUp = (e: PointerEvent): void => {
    const pending = this.pending;
    this.pending = null;
    if (!pending) return;

    const p = this.toLocal(e);
    const moved = distance(p, pending.start) > DRAG_THRESHOLD;

    if (this.locked && !(pending.kind === 'node' && pending.dragging)) {
      if (!moved) this.message('The graph is locked while the algorithm runs. Press Stop to edit it.', 'warn');
      return;
    }

    switch (pending.kind) {
      case 'node':
        if (pending.dragging) {
          this.svg.classList.remove('dragging');
          this.render();
          this.kickLayout(); // released node rejoins the simulation
        } else {
          this.handleNodeClick(pending.id);
        }
        break;
      case 'edge':
        if (!moved) this.handleEdgeClick(pending.a, pending.b);
        break;
      case 'background':
        if (!moved) this.handleBackgroundClick(p);
        break;
    }
  };

  private onPointerCancel = (): void => {
    this.pending = null;
    this.svg.classList.remove('dragging');
    this.render();
    this.kickLayout();
  };

  /**
   * Weighted mode: scrolling over an edge changes its weight linearly, WEIGHT_PER_PAGE per
   * page of scrolling (up = increase). Weights stay whole numbers: the fractional part is
   * carried over to the next wheel event on the same edge.
   */
  private onWheel = (e: WheelEvent): void => {
    if (this.locked || !this.graph.weighted || e.ctrlKey) return; // ctrl+wheel is the browser's zoom
    const edgeEl = (e.target as Element).closest<SVGGElement>('[data-edge-a]');
    if (!edgeEl) return;
    e.preventDefault();

    const a = Number(edgeEl.dataset.edgeA);
    const b = Number(edgeEl.dataset.edgeB);
    const key = `${this.graph.directed ? 'd' : 'u'}:${a}-${b}`;
    if (key !== this.wheelEdge) {
      this.wheelEdge = key;
      this.wheelCarry = 0;
    }

    const page = window.innerHeight || 800;
    const px = e.deltaMode === 1 ? e.deltaY * LINE_HEIGHT_PX : e.deltaMode === 2 ? e.deltaY * page : e.deltaY;
    this.wheelCarry += (-px / page) * WEIGHT_PER_PAGE;
    // Tiny tolerance so floating-point drift (e.g. 0.999999…) doesn't swallow a step.
    const steps = Math.trunc(this.wheelCarry + Math.sign(this.wheelCarry) * 1e-9);
    if (steps === 0) return;
    this.wheelCarry -= steps;

    // Positive: the shown magnitude changes, and never goes below 0.
    const current = this.graph.currentView.weight(a, b);
    if (current === undefined) return;
    const next = this.graph.weighting === 'positive' ? Math.max(0, current + steps) : current + steps;
    if (next === current) return;
    this.graph.setWeight(a, b, next); // undirected: both arcs get the new weight
    this.render();
    this.callbacks.onChange?.();
    this.kickLayout(0.5); // its length follows its weight
    this.message(`Weight of edge ${this.edgeLabel(a, b)}: ${next}`);
  };

  private onResize = (): void => {
    this.kickLayout();
    if (this.arcDiagramActive) this.placeArcDiagram(false); // keep the line fitted to the canvas
  };

  private onPointerLeave = (): void => {
    if (this.pending) return; // pointer is captured; keep tracking
    this.cursor = null;
    this.updatePreview();
  };

  private onContextMenu = (e: MouseEvent): void => {
    const nodeEl = (e.target as Element).closest<SVGGElement>('[data-node-id]');
    if (!nodeEl) return;
    e.preventDefault();
    if (this.locked) {
      this.message('The graph is locked while the algorithm runs. Press Stop to edit it.', 'warn');
      return;
    }
    this.deleteNode(Number(nodeEl.dataset.nodeId));
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.selected === null) return;
    if (e.key === 'Escape') {
      this.select(null);
      this.message('Selection cleared.');
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.deleteNode(this.selected);
    }
  };

  // ------------------------------------------------------------- actions

  private handleNodeClick(id: NodeId): void {
    if (this.selected === null) {
      this.select(id);
      this.message(
        this.graph.directed
          ? `Node ${id} selected — click another node to add an edge from ${id} to it, or empty space to cancel.`
          : `Node ${id} selected — click another node to connect it, or empty space to cancel.`,
      );
      return;
    }
    if (this.selected === id) {
      this.select(null);
      this.message('Selection cleared.');
      return;
    }

    const from = this.selected;
    if (this.graph.hasEdge(from, id)) {
      this.message(
        this.graph.directed
          ? `Edge ${from} → ${id} already exists.`
          : `Nodes ${from} and ${id} are already connected.`,
        'warn',
      );
      return;
    }
    this.graph.addEdge(from, id); // stored as the arc from → id (weight 0) in either mode
    this.select(null);
    this.changed();
    this.message(
      this.graph.weighted
        ? `Added edge ${this.edgeLabel(from, id)} with weight 0. Scroll over it to change the weight.`
        : `Added edge ${this.edgeLabel(from, id)}.`,
    );
  }

  private handleEdgeClick(a: NodeId, b: NodeId): void {
    // Undirected mode removes the arcs both ways: they are drawn as one edge.
    if (!this.graph.removeEdge(a, b)) return;
    this.render();
    this.changed();
    this.message(`Removed edge ${this.edgeLabel(a, b)}.`);
  }

  private edgeLabel(a: NodeId, b: NodeId): string {
    return this.graph.directed ? `${a} → ${b}` : `${a} — ${b}`;
  }

  private handleBackgroundClick(p: Point): void {
    if (this.selected !== null) {
      this.select(null);
      this.message('Selection cleared.');
      return;
    }

    const pos = this.clampToCanvas(p);
    const blocker = this.graph
      .getNodes()
      .find((n) => distance(n, pos) < NODE_RADIUS * 2 + MIN_NODE_GAP);
    if (blocker) {
      this.message(`Too close to node ${blocker.id} — click a little further away.`, 'warn');
      return;
    }

    const node = this.graph.addNode(pos.x, pos.y);
    this.render();
    this.changed();
    this.message(`Added node ${node.id}.`);
  }

  private deleteNode(id: NodeId): void {
    if (!this.graph.removeNode(id)) return;
    if (this.selected === id) this.selected = null;
    this.render();
    this.changed();
    this.message(`Removed node ${id} and its edges.`);
  }

  private select(id: NodeId | null): void {
    this.selected = id;
    this.render();
  }

  // ------------------------------------------------------------ rendering

  private render(): void {
    // Edges (keyed so DOM elements — and their hover state — survive re-renders).
    // Undirected: one line per adjacent pair, centre to centre, data-edge-a < data-edge-b.
    // Directed: one arrow per arc a → b, ending at b's rim; when b → a also exists, both
    // arcs are drawn as curves bowing to opposite sides so each can be clicked.
    const directed = this.graph.directed;
    const weighted = this.graph.weighted;
    const view = this.graph.currentView;
    this.svg.classList.toggle('directed', directed);
    this.svg.classList.toggle('weighted', weighted);
    const liveEdges = new Set<string>();
    // Edges the algorithm has explored (by key), if it tracks them; the rest are dashed.
    const explored = this.highlight?.exploredEdges
      ? new Map(this.highlight.exploredEdges.map((e) => [this.edgeKey(e.from, e.to, directed), e]))
      : null;
    const arc = this.arc;
    for (const [a, b] of this.graph.getEdges()) {
      // Directed, both ways: weighted, the lighter arc is straight and the heavier one bows out.
      const bend = directed && this.graph.hasArc(b, a) ? this.pairBend(a, b) : 0;
      const curved = bend > 0;
      const key = this.edgeKey(a, b, directed);
      // Arc diagram: spine edges between neighbouring vertices stay straight; the rest arc.
      // Forest: every edge is a path (tree edges with no bulge), so it can blend to and fro.
      const arcs = arc !== null && (arc.kind !== 'line' || this.arcBefore !== null || !this.straightSpine(arc, a, b, key));
      const shape = curved || arcs ? 'path' : 'line';
      liveEdges.add(key);
      let g = this.edgeEls.get(key);
      if (g && g.dataset.shape !== shape) {
        g.remove();
        g = undefined;
      }
      if (!g) {
        g = svgEl('g', { class: 'edge' });
        g.dataset.edgeA = String(a);
        g.dataset.edgeB = String(b);
        g.dataset.shape = shape;
        // Weight label (shown in weighted mode). Part of the edge's group, so scrolling or
        // clicking on the label acts on the edge.
        const label = svgEl('g', { class: 'edge-weight' });
        label.append(svgEl('rect', { rx: 9, height: 18 }), svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }));
        // An algorithm's tag for the edge (DFS: its class, e.g. "backward"), same place.
        const tag = svgEl('g', { class: 'edge-tag' });
        tag.append(svgEl('rect', { rx: 8, height: 16 }), svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }));
        g.append(svgEl(shape, { class: 'edge-hit' }), svgEl(shape, { class: 'edge-line' }), label, tag, svgEl('title', {}));
        this.edgeLayer.append(g);
        this.edgeEls.set(key, g);
      }
      const { attrs, mid } = arcs
        ? this.arcGeometry(this.graph.getNode(a)!, this.graph.getNode(b)!, directed, key)
        : this.edgeGeometry(this.graph.getNode(a)!, this.graph.getNode(b)!, directed, curved, bend);
      g.classList.toggle('sim-active', this.isActiveEdge(a, b, directed));
      g.classList.toggle('sim-spine', arc !== null && !arc.leaving && arc.highlightSpine && arc.spine.has(key));
      g.classList.toggle('sim-backward', arc !== null && !arc.leaving && arc.backward.has(key));
      g.classList.toggle('sim-unexplored', explored !== null && !explored.has(key));
      g.classList.toggle('sim-explored', explored?.has(key) ?? false);
      g.classList.toggle('sim-tree', explored?.get(key)?.done ?? false);
      g.classList.toggle('sim-crossing', explored?.get(key)?.crossing ?? false);
      g.classList.toggle('sim-within', explored?.get(key)?.within ?? false);
      g.classList.toggle('sim-degenerate', explored?.get(key)?.degenerate ?? false);
      g.classList.toggle('sim-waiting', explored?.get(key)?.waiting ?? false);
      for (const el of g.querySelectorAll('.edge-hit, .edge-line')) setAttrs(el, attrs);

      const tag = explored?.get(key)?.label ?? '';
      if (tag) {
        g.dataset.tag = tag;
        const tagWidth = 12 + tag.length * 6.4;
        g.querySelector('.edge-tag text')!.textContent = tag;
        setAttrs(g.querySelector('.edge-tag text')!, { x: mid.x, y: mid.y });
        setAttrs(g.querySelector('.edge-tag rect')!, { x: mid.x - tagWidth / 2, y: mid.y - 8, width: tagWidth });
      } else {
        delete g.dataset.tag;
      }

      const weight = view.weight(a, b)!;
      const text = String(weight);
      const width = 10 + text.length * 7.5;
      g.querySelector('.edge-weight text')!.textContent = text;
      setAttrs(g.querySelector('.edge-weight text')!, { x: mid.x, y: mid.y });
      setAttrs(g.querySelector('.edge-weight rect')!, { x: mid.x - width / 2, y: mid.y - 9, width });
      g.dataset.weight = text;
      g.querySelector('title')!.textContent = weighted
        ? `Edge ${this.edgeLabel(a, b)}, weight ${weight} (scroll to change the weight, click to delete)`
        : `Edge ${this.edgeLabel(a, b)} (click to delete)`;
    }
    for (const [key, g] of this.edgeEls) {
      if (!liveEdges.has(key)) {
        g.remove();
        this.edgeEls.delete(key);
      }
    }

    // Nodes.
    const liveNodes = new Set<NodeId>();
    for (const node of this.graph.getNodes()) {
      liveNodes.add(node.id);
      let g = this.nodeEls.get(node.id);
      if (!g) {
        g = svgEl('g', { class: 'node' });
        g.dataset.nodeId = String(node.id);
        // Two overlapping labels: the id, and an algorithm's label (BFS: the distance). CSS
        // crossfades between them (see setPeek).
        const label = svgEl('text', { class: 'node-index', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
        label.textContent = String(node.id);
        const simLabel = svgEl('text', { class: 'sim-label', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
        g.append(svgEl('circle', { r: NODE_RADIUS }), label, simLabel);
        this.nodeLayer.append(g);
        this.nodeEls.set(node.id, g);
      }
      g.setAttribute('transform', `translate(${node.x} ${node.y})`);
      g.classList.toggle('selected', node.id === this.selected);
      g.classList.toggle('sim-current', this.highlight?.current === node.id);
      g.classList.toggle('sim-done', this.highlight?.done.includes(node.id) ?? false);
      g.classList.toggle('sim-running', this.highlight?.running?.includes(node.id) ?? false);
      const simLabel = g.querySelector<SVGTextElement>('.sim-label')!;
      const text = this.highlight?.labels?.[node.id] ?? '';
      simLabel.textContent = text;
      // Long labels (DFS's "d,f") shrink to stay inside the circle.
      const size = fitFontSize(text, SIM_LABEL_WIDTH, SIM_LABEL_FONT);
      simLabel.style.fontSize = size < SIM_LABEL_FONT ? `${size}px` : '';
    }
    for (const [id, g] of this.nodeEls) {
      if (!liveNodes.has(id)) {
        g.remove();
        this.nodeEls.delete(id);
      }
    }

    this.svg.classList.toggle('has-selection', this.selected !== null);
    this.updatePreview();
    this.renderCut();
  }

  /**
   * Draws the highlight's cut (S, V − S), if any: S's territory shaded, and the border with
   * the rest. A side's territory is the part of the canvas nearer to it than to the other
   * side — nearer to one of its vertices, or to one of its edges whose ends are both on
   * that side (it does not cross the cut). So only crossing edges cross the border.
   *
   * With S split into groups (Kruskal: trees), an edge counts for a group when both its ends
   * are in it; an edge between two groups crosses, like one crossing the cut. Every group is
   * shaded, and the borders between groups (seams: where the nearest group changes) are
   * drawn inside the shading as well.
   *
   * While the cut changes, the border moves continuously: the new territory is revealed by
   * a front spreading out from the old S (see voronoi.ts), and the seams cross-fade. When S
   * ends up as one group with every vertex, its territory floods the canvas and then fades
   * out. It follows the vertices as they move.
   */
  private renderCut(): void {
    const to = this.cutTo;
    if (!to) {
      this.cutKey = this.seamKey = this.seamsFromPath = '';
      this.svg.classList.remove('has-cut', 'cut-moving');
      for (const path of [this.cutRegion, this.cutBorder, this.cutClip, this.cutSeamsFrom, this.cutSeamsTo]) path.removeAttribute('d');
      return;
    }
    const from = this.cutFrom ?? to;
    const fromGroups = this.cutFrom ? this.cutGroupsFrom : this.cutGroupsTo;
    const toGroups = this.cutGroupsTo;
    const t = this.cutTween ? this.cutT : 1;
    const nodes = this.graph.getNodes();
    const edgesOnly = !!this.highlight?.cutEdgesOnly;

    const sideIn = (set: ReadonlySet<NodeId>, id: NodeId): Side => (set.has(id) ? 'in' : 'out');
    /** The group of a vertex of S (one group, 0, when S is not split). */
    const groupOfVertex = (groups: ReadonlyMap<NodeId, NodeId> | null, id: NodeId): NodeId => (groups ? (groups.get(id) ?? id) : 0);
    /** The group of an edge with both ends in one group of S (null otherwise). */
    const groupOf = (set: ReadonlySet<NodeId>, groups: ReadonlyMap<NodeId, NodeId> | null, a: NodeId, b: NodeId) => {
      if (!set.has(a) || !set.has(b)) return null;
      const ga = groupOfVertex(groups, a);
      return ga === groupOfVertex(groups, b) ? ga : null;
    };
    // Crossing edges, and edges between two groups, belong to neither side.
    const edgeSide = (set: ReadonlySet<NodeId>, groups: ReadonlyMap<NodeId, NodeId> | null, a: NodeId, b: NodeId): Side | null =>
      !set.has(a) && !set.has(b) ? 'out' : groupOf(set, groups, a, b) !== null ? 'in' : null;
    // Where the new territory comes from. Split into groups: a group with no vertex in the
    // old S (a new tree) grows a territory of its own, from its vertices and edges. Otherwise
    // a vertex joining S with no edge to the old S (the first one, or a new tree's root) does.
    // The rest of the new territory spreads from the old S.
    const oldGroups = new Set([...from].filter((id) => to.has(id)).map((id) => groupOfVertex(toGroups, id)));
    const newGroup = (id: NodeId) => toGroups !== null && !oldGroups.has(groupOfVertex(toGroups, id));
    const touchesFrom = new Set<NodeId>();
    for (const [a, b] of this.graph.getEdges()) {
      if (from.has(a)) touchesFrom.add(b);
      if (from.has(b)) touchesFrom.add(a);
    }
    const features: CutFeature[] = [];
    /** Each feature's group before and after (null: not in S). */
    const featureGroups: Array<{ from: NodeId | null; to: NodeId | null }> = [];
    // The vertices are sites too, unless the border comes from the non-crossing edges alone (cutEdgesOnly).
    if (!edgesOnly) {
      for (const node of nodes) {
        const joins = !from.has(node.id) && to.has(node.id);
        features.push({
          a: node,
          from: sideIn(from, node.id),
          to: sideIn(to, node.id),
          seed: joins && (toGroups ? newGroup(node.id) : !touchesFrom.has(node.id)),
        });
        featureGroups.push({
          from: from.has(node.id) ? groupOfVertex(fromGroups, node.id) : null,
          to: to.has(node.id) ? groupOfVertex(toGroups, node.id) : null,
        });
      }
    }
    for (const [a, b] of this.graph.getEdges()) {
      const f = edgeSide(from, fromGroups, a, b);
      const g = edgeSide(to, toGroups, a, b);
      if (!f && !g) continue;
      // An edge of a new group (or, edges only, joining S with neither end in the old S)
      // grows a territory of its own.
      const seed = f !== 'in' && g === 'in' && (toGroups ? newGroup(a) : edgesOnly && !from.has(a) && !from.has(b));
      features.push({ a: this.graph.getNode(a)!, b: this.graph.getNode(b)!, from: f, to: g, seed });
      featureGroups.push({ from: groupOf(from, fromGroups, a, b), to: groupOf(to, toGroups, a, b) });
    }

    const modeOf = (set: ReadonlySet<NodeId>, which: 'from' | 'to'): CutMode => {
      const inside = nodes.filter((n) => set.has(n.id)).length;
      if (inside === nodes.length) return inside === 0 ? 'empty' : 'all';
      if (!edgesOnly) return inside === 0 ? 'empty' : 'split';
      // Edges only: a territory needs edges of its own, and a border a second territory to
      // meet — the rest's, or another group's (then S's groups share the whole canvas).
      const groups = new Set(featureGroups.map((g) => g[which]).filter((g) => g !== null));
      if (groups.size === 0) return 'empty';
      if (!features.some((f) => f[which] === 'out')) return groups.size > 1 ? 'all' : 'empty';
      return 'split';
    };
    const toMode = modeOf(to, 'to');
    const fromMode = modeOf(from, 'from');

    const rect = this.svg.getBoundingClientRect();
    const bounds = { width: rect.width, height: rect.height };
    const where = features.map((f) => `${f.a.x},${f.a.y},${f.b?.x},${f.b?.y}`);
    // The seams: where the nearest group changes (the rest left out), each traced once.
    // Traced again only when something moved.
    const seamsOf = (which: 'from' | 'to'): string =>
      polylinesPath(
        groupSeams(
          features.flatMap((f, k) => {
            const group = featureGroups[k][which];
            return group === null ? [] : [{ a: f.a, b: f.b, group }];
          }),
          bounds,
        ),
      );
    const seamKey = [rect.width, rect.height, ...featureGroups.map((g, k) => `${where[k]},${g.from},${g.to}`)].join('|');
    let seamsTo = this.cutSeamsTo.getAttribute('d') ?? '';
    if (seamKey !== this.seamKey) {
      this.seamKey = seamKey;
      seamsTo = seamsOf('to');
      this.cutSeamsTo.setAttribute('d', seamsTo);
      // Seams that stay as they were don't fade.
      const seamsFrom = t < 1 ? seamsOf('from') : '';
      this.seamsFromPath = seamsFrom === seamsTo ? '' : seamsFrom;
    }
    const fading = t < 1 && this.seamsFromPath !== '';
    this.cutSeamsFrom.setAttribute('d', fading ? this.seamsFromPath : '');
    this.cutSeamsFrom.style.opacity = fading ? String(1 - t) : '';
    this.cutSeamsTo.style.opacity = fading ? String(t) : '';

    // Shown while both sides have territory, while moving, and while there are seams; a
    // full (or empty) cut that has finished moving fades out.
    this.svg.classList.toggle('has-cut', toMode === 'split' || t < 1 || (toMode === 'all' && seamsTo !== ''));
    this.svg.classList.toggle('cut-moving', t < 1);

    const key = [rect.width, rect.height, t, ...features.map((f, k) => `${where[k]},${f.from},${f.to}`)].join('|');
    if (key === this.cutKey) return; // nothing moved
    this.cutKey = key;
    const { region, border } = cutShape(features, bounds, {
      t,
      from: fromMode,
      to: toMode,
      // Edges only: a side with no edge of its own has no border with the other.
      needBoth: edgesOnly,
    });
    const regionPath = loopsPath(region);
    this.cutRegion.setAttribute('d', regionPath);
    this.cutClip.setAttribute('d', regionPath);
    this.cutBorder.setAttribute('d', polylinesPath(border));
  }

  /** The key of the drawn edge a → b (undirected: between a and b), as used in edgeEls. */
  private edgeKey(a: NodeId, b: NodeId, directed: boolean): string {
    return directed ? `${a}>${b}` : `${Math.min(a, b)}-${Math.max(a, b)}`;
  }

  /** Is the edge a → b (undirected: between a and b) one the algorithm highlights? */
  private isActiveEdge(a: NodeId, b: NodeId, directed: boolean): boolean {
    return (this.highlight?.activeEdges ?? []).some(
      ([x, y]) => (x === a && y === b) || (!directed && x === b && y === a),
    );
  }

  /**
   * SVG attributes for an edge from a to b (see render() for the three cases), and the
   * point midway along it, where the weight label goes.
   */
  private edgeGeometry(
    a: Point,
    b: Point,
    directed: boolean,
    curved: boolean,
    bend = CURVE_OFFSET * 2,
  ): { attrs: Record<string, number | string>; mid: Point } {
    const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (!directed) return { attrs: { x1: a.x, y1: a.y, x2: b.x, y2: b.y }, mid: centre };
    const len = Math.max(distance(a, b), 0.001);
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const rim = NODE_RADIUS + 1; // the arrow's tip sits just outside the target circle
    if (!curved) return { attrs: { x1: a.x, y1: a.y, x2: b.x - ux * rim, y2: b.y - uy * rim }, mid: centre };

    // Quadratic curve bowing to the right of a → b (so b → a bows the other way), its
    // control point `bend` px from the middle (the curve's apex is half as far).
    const c = { x: (a.x + b.x) / 2 - uy * bend, y: (a.y + b.y) / 2 + ux * bend };
    const toward = (from: Point, to: Point, by: number): Point => {
      const d = Math.max(distance(from, to), 0.001);
      return { x: from.x + ((to.x - from.x) / d) * by, y: from.y + ((to.y - from.y) / d) * by };
    };
    const start = toward(a, c, NODE_RADIUS);
    const end = toward(b, c, rim);
    // Midpoint of the quadratic curve (t = 1/2) between the node centres: (a + 2c + b) / 4.
    const mid = { x: (a.x + 2 * c.x + b.x) / 4, y: (a.y + 2 * c.y + b.y) / 4 };
    return { attrs: { d: `M ${start.x} ${start.y} Q ${c.x} ${c.y} ${end.x} ${end.y}` }, mid };
  }

  /**
   * Directed arcs a → b and b → a: how far a → b bows (its curve's control offset, px; 0:
   * straight). Unweighted, or with equal magnitudes, both bow the same, apart. Weighted,
   * the lighter arc runs straight and the heavier one bows out, the further the more they
   * differ: from a base (nearly equal) to three times it (one of them 0). The base grows
   * with the pair's length (a fifth of it, at least CURVE_OFFSET·2), so even a long pair
   * reads as two arcs. The layout spaces the pair by their average weight, so the heavier
   * arc is also the longer path.
   */
  private pairBend(a: NodeId, b: NodeId): number {
    if (!this.graph.weighted) return CURVE_OFFSET * 2;
    const view = this.graph.currentView;
    const here = Math.abs(view.weight(a, b) ?? 0);
    const back = Math.abs(view.weight(b, a) ?? 0);
    if (here === back) return CURVE_OFFSET * 2;
    if (here < back) return 0;
    const base = Math.max(CURVE_OFFSET * 2, 0.2 * distance(this.graph.getNode(a)!, this.graph.getNode(b)!));
    return base * (1 + (2 * (here - back)) / (here + back));
  }

  /**
   * The weights the auto-layout gives edge lengths in proportion to: none when unweighted,
   * or when the weighted layout is switched off (every edge the same ideal length). Weighted or positive, each pair's magnitude:
   * directed, the average of the two arcs' (one arc: its own); undirected, the edge's weight.
   */
  private layoutWeight(): EdgeWeight | undefined {
    if (!this.graph.weighted || !this.weightedLayout) return undefined;
    const view = this.graph.currentView;
    if (!this.graph.directed) return (a, b) => Math.abs(view.weight(a, b) ?? 0);
    return (a, b) => {
      const arcs = [view.weight(a, b), view.weight(b, a)].filter((w): w is number => w !== undefined).map(Math.abs);
      return arcs.length ? arcs.reduce((sum, w) => sum + w, 0) / arcs.length : 0;
    };
  }

  /**
   * An edge of an arrangement, as a half ellipse from a to b bulging the edge's way (see
   * bulgeIn), scaled by the current bend (0 = straight). While switching arrangements,
   * the bulge blends from the old arrangement's to the new one's.
   */
  private arcGeometry(a: Point, b: Point, directed: boolean, key: string): { attrs: Record<string, string>; mid: Point } {
    let bulge = this.bulgeIn(this.arc!, key, a, b);
    if (this.arcBefore) bulge = this.bulgeIn(this.arcBefore, key, a, b) * (1 - this.morph) + bulge * this.morph;
    const { d, mid } = halfEllipse(a, b, bulge * this.bend, NODE_RADIUS, directed ? NODE_RADIUS + 1 : NODE_RADIUS);
    return { attrs: { d }, mid };
  }

  /**
   * How far an edge bulges in an arrangement (left of its direction; negative: right), for
   * an edge `radius` (half its length) long.
   *  - line: a half circle (flattened to fit maxBulge), above the line, or below for
   *    `below` (which includes the backward edges, whichever way they point); spine
   *    edges between neighbouring vertices lie straight on the line;
   *  - forest / tree: tree edges straight; the others a flat half ellipse to the left,
   *    except edges from the tree to the vertices set aside, which only sag a little
   *    (below the line between them, so they clear the vertices of the row they leave),
   *    and edges within that group, which bow to the left, away from the canvas edge.
   */
  private bulgeIn(arc: ArcState, key: string, from: Point, to: Point): number {
    const radius = distance(from, to) / 2;
    const [a, b] = key.split(/[>-]/).map(Number);
    if (arc.kind !== 'line') {
      if (arc.spine.has(key)) return 0;
      if (arc.aside.has(a) !== arc.aside.has(b)) return (from.x > to.x ? 1 : -1) * Math.min(radius * ASIDE_SAG, 60);
      const bulge = Math.min(radius * FOREST_BULGE, arc.maxBulge);
      // Within the group (at the canvas's right edge), bow to the left, into the canvas.
      if (arc.aside.has(a)) return (to.y > from.y ? -1 : 1) * bulge;
      return bulge;
    }
    if (this.straightSpine(arc, a, b, key)) return 0;
    // Positive bulges to the left of a → b: up for an edge pointing right, down for one pointing left.
    const rightward = (arc.rank.get(a) ?? 0) <= (arc.rank.get(b) ?? 0);
    return (arc.below.has(key) === rightward ? -1 : 1) * Math.min(radius, arc.maxBulge);
  }

  /** Line arrangement: a spine edge between neighbouring vertices, which lies on the line. */
  private straightSpine(arc: ArcState, a: NodeId, b: NodeId, key: string): boolean {
    return arc.kind === 'line' && arc.spine.has(key) && Math.abs(arc.rank.get(a)! - arc.rank.get(b)!) === 1;
  }

  /** Dashed line from the selected node to the cursor while choosing an edge target. */
  private updatePreview(): void {
    const from = this.selected === null ? undefined : this.graph.getNode(this.selected);
    if (!from || !this.cursor) {
      this.previewLine.style.display = 'none';
      return;
    }
    this.previewLine.style.display = '';
    setAttrs(this.previewLine, { x1: from.x, y1: from.y, x2: this.cursor.x, y2: this.cursor.y });
  }

  // --------------------------------------------------------------- layout

  /** (Re)starts the auto-layout animation if it is enabled. */
  private kickLayout(temperature = 1): void {
    if (!this.autoLayout) return;
    this.layout.reheat(temperature);
    if (this.frame === null) this.frame = requestAnimationFrame(this.layoutFrame);
  }

  private layoutFrame = (): void => {
    this.frame = null;
    if (!this.autoLayout) return;

    const rect = this.svg.getBoundingClientRect();
    const bounds = { width: rect.width, height: rect.height };
    const pinned = new Set<NodeId>();
    if (this.pending?.kind === 'node' && this.pending.dragging) pinned.add(this.pending.id);

    // With reduced motion, jump straight to the settled layout instead of animating.
    const steps = prefersReducedMotion() ? 1000 : 1;
    const weight = this.layoutWeight();
    for (let i = 0; i < steps && this.layout.running; i++) {
      this.layout.step(this.graph, bounds, pinned, weight);
    }
    this.render();

    if (this.layout.running) this.frame = requestAnimationFrame(this.layoutFrame);
  };

  // -------------------------------------------------------------- helpers

  private toLocal(e: PointerEvent): Point {
    const rect = this.svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private clampToCanvas(p: Point): Point {
    const rect = this.svg.getBoundingClientRect();
    const pad = NODE_RADIUS + 2;
    return {
      x: Math.min(Math.max(p.x, pad), Math.max(pad, rect.width - pad)),
      y: Math.min(Math.max(p.y, pad), Math.max(pad, rect.height - pad)),
    };
  }

  /** The graph's structure changed: notify listeners and re-run the layout. */
  private changed(): void {
    this.callbacks.onChange?.();
    this.kickLayout();
  }

  private message(text: string, tone: 'info' | 'warn' = 'info'): void {
    this.callbacks.onMessage?.(text, tone);
  }
}

/**
 * Arrowhead markers for directed mode: normal, hovered (delete), the preview line,
 * algorithm-highlighted edges, and the topological sort's backward edges.
 */
function arrowDefs(): SVGDefsElement {
  const defs = svgEl('defs', {});
  for (const id of ['arrow', 'arrow-hover', 'arrow-preview', 'arrow-active', 'arrow-done', 'arrow-backward']) {
    const marker = svgEl('marker', {
      id,
      viewBox: '0 0 10 10',
      refX: 10,
      refY: 5,
      markerWidth: 11,
      markerHeight: 11,
      markerUnits: 'userSpaceOnUse',
      orient: 'auto',
    });
    marker.append(svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: `${id}-head` }));
    defs.append(marker);
  }
  return defs;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  setAttrs(el, attrs);
  return el;
}

function setAttrs(el: Element, attrs: Record<string, string | number>): void {
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
}
