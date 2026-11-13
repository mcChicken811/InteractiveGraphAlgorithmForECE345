import { Graph, type NodeId } from './graph.js';
import { ForceLayout } from './layout.js';
import type { Highlight } from './algorithms/types.js';

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
 *  - weighted / unweighted view: weighted mode labels every edge with its weight, and
 *    scrolling over an edge changes the weight (WEIGHT_PER_PAGE per page; up = more)
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
  private autoLayout = false;
  private frame: number | null = null;

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
    this.edgeLayer = svgEl('g', { class: 'edges' });
    this.previewLine = svgEl('line', { class: 'preview-line' });
    this.nodeLayer = svgEl('g', { class: 'nodes' });
    svg.append(arrowDefs(), this.edgeLayer, this.previewLine, this.nodeLayer);

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
    if (!highlight) this.setLabelPeek(false);
    this.render();
  }

  /**
   * While an algorithm labels the vertices (e.g. BFS distances), `true` shows the vertex
   * ids again instead — used while the pointer is over the queue strip. CSS crossfades.
   */
  setLabelPeek(peek: boolean): void {
    this.svg.classList.toggle('peek-ids', peek);
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
    this.message(
      directed
        ? 'Directed: clicking A then B adds an edge A → B.'
        : 'Undirected: edge directions are ignored; arcs both ways count as one edge.',
    );
  }

  get weighted(): boolean {
    return this.graph.weighted;
  }

  /**
   * Shows the graph as weighted (weight labels; scroll over an edge to change its weight)
   * or unweighted. The stored weights never change.
   */
  setWeighted(weighted: boolean): void {
    if (weighted === this.graph.weighted) return;
    this.graph.weighted = weighted;
    this.render();
    this.callbacks.onChange?.();
    this.message(
      weighted
        ? 'Weighted: scroll over an edge to change its weight (up = more).'
        : 'Unweighted: weights are hidden and every edge counts as weight 1.',
    );
  }

  get autoLayoutEnabled(): boolean {
    return this.autoLayout;
  }

  /** Turns the force-directed auto-layout on or off. Nodes stay where they are when turned off. */
  setAutoLayout(enabled: boolean): void {
    if (enabled === this.autoLayout) return;
    this.autoLayout = enabled;
    if (enabled) {
      this.kickLayout();
      this.message('Auto-layout on: drag a node to nudge the layout.');
    } else {
      this.layout.stop();
      if (this.frame !== null) cancelAnimationFrame(this.frame);
      this.frame = null;
      this.message('Auto-layout off: nodes stay where you put them.');
    }
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

    const current = this.graph.currentView.weight(a, b);
    if (current === undefined) return;
    this.graph.setWeight(a, b, current + steps); // undirected: both arcs get the new weight
    this.render();
    this.callbacks.onChange?.();
    this.message(`Weight of edge ${this.edgeLabel(a, b)}: ${current + steps}`);
  };

  private onResize = (): void => {
    this.kickLayout();
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
    for (const [a, b] of this.graph.getEdges()) {
      const curved = directed && this.graph.hasArc(b, a);
      const shape = curved ? 'path' : 'line';
      const key = directed ? `${a}>${b}` : `${a}-${b}`;
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
        g.append(svgEl(shape, { class: 'edge-hit' }), svgEl(shape, { class: 'edge-line' }), label, svgEl('title', {}));
        this.edgeLayer.append(g);
        this.edgeEls.set(key, g);
      }
      const { attrs, mid } = this.edgeGeometry(this.graph.getNode(a)!, this.graph.getNode(b)!, directed, curved);
      g.classList.toggle('sim-active', this.isActiveEdge(a, b, directed));
      for (const el of g.querySelectorAll('.edge-hit, .edge-line')) setAttrs(el, attrs);

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
        // crossfades between them (see setLabelPeek).
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
      g.querySelector('.sim-label')!.textContent = this.highlight?.labels?.[node.id] ?? '';
    }
    for (const [id, g] of this.nodeEls) {
      if (!liveNodes.has(id)) {
        g.remove();
        this.nodeEls.delete(id);
      }
    }

    this.svg.classList.toggle('has-selection', this.selected !== null);
    this.updatePreview();
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
  ): { attrs: Record<string, number | string>; mid: Point } {
    const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (!directed) return { attrs: { x1: a.x, y1: a.y, x2: b.x, y2: b.y }, mid: centre };
    const len = Math.max(distance(a, b), 0.001);
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const rim = NODE_RADIUS + 1; // the arrow's tip sits just outside the target circle
    if (!curved) return { attrs: { x1: a.x, y1: a.y, x2: b.x - ux * rim, y2: b.y - uy * rim }, mid: centre };

    // Quadratic curve bowing to the right of a → b (so b → a bows the other way).
    const c = { x: (a.x + b.x) / 2 - uy * CURVE_OFFSET * 2, y: (a.y + b.y) / 2 + ux * CURVE_OFFSET * 2 };
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
    for (let i = 0; i < steps && this.layout.running; i++) {
      this.layout.step(this.graph, bounds, pinned);
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

/** Arrowhead markers for directed mode: normal, hovered (delete), the preview line, and algorithm-highlighted edges. */
function arrowDefs(): SVGDefsElement {
  const defs = svgEl('defs', {});
  for (const id of ['arrow', 'arrow-hover', 'arrow-preview', 'arrow-active']) {
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
