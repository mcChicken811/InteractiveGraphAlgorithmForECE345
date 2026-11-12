import { ForceLayout } from './layout.js';
const SVG_NS = 'http://www.w3.org/2000/svg';
export const NODE_RADIUS = 20;
/** Pointer travel (px) before a press on a node becomes a drag instead of a click. */
const DRAG_THRESHOLD = 4;
/** Extra space required between two node circles when spawning. */
const MIN_NODE_GAP = 6;
/**
 * Interactive SVG editor:
 *  - click empty space → add node
 *  - click node, then another node → add edge
 *  - click edge → delete it
 *  - drag node → move it; right-click node (or Delete with it selected) → delete it
 *  - optional auto-layout: a force-directed simulation spaces the nodes out
 */
export class GraphEditor {
    svg;
    graph;
    callbacks;
    selected = null;
    pending = null;
    cursor = null;
    layout = new ForceLayout({ padding: NODE_RADIUS + 2 });
    autoLayout = false;
    frame = null;
    edgeLayer;
    previewLine;
    nodeLayer;
    nodeEls = new Map();
    edgeEls = new Map();
    constructor(svg, graph, callbacks = {}) {
        this.svg = svg;
        this.graph = graph;
        this.callbacks = callbacks;
        this.edgeLayer = svgEl('g', { class: 'edges' });
        this.previewLine = svgEl('line', { class: 'preview-line' });
        this.nodeLayer = svgEl('g', { class: 'nodes' });
        svg.append(this.edgeLayer, this.previewLine, this.nodeLayer);
        svg.addEventListener('pointerdown', this.onPointerDown);
        svg.addEventListener('pointermove', this.onPointerMove);
        svg.addEventListener('pointerup', this.onPointerUp);
        svg.addEventListener('pointercancel', this.onPointerCancel);
        svg.addEventListener('pointerleave', this.onPointerLeave);
        svg.addEventListener('contextmenu', this.onContextMenu);
        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('resize', this.onResize);
        this.render();
    }
    /** Removes every node and edge. */
    clear() {
        this.graph.clear();
        this.selected = null;
        this.pending = null;
        this.render();
        this.changed();
        this.message('Graph cleared. Click empty space to add a node.');
    }
    get autoLayoutEnabled() {
        return this.autoLayout;
    }
    /** Turns the force-directed auto-layout on or off. Nodes stay where they are when turned off. */
    setAutoLayout(enabled) {
        if (enabled === this.autoLayout)
            return;
        this.autoLayout = enabled;
        if (enabled) {
            this.kickLayout();
            this.message('Auto-layout on: drag a node to nudge the layout.');
        }
        else {
            this.layout.stop();
            if (this.frame !== null)
                cancelAnimationFrame(this.frame);
            this.frame = null;
            this.message('Auto-layout off: nodes stay where you put them.');
        }
    }
    // ---------------------------------------------------------------- events
    onPointerDown = (e) => {
        if (e.button !== 0 || this.pending)
            return;
        const p = this.toLocal(e);
        const target = e.target;
        const nodeEl = target.closest('[data-node-id]');
        const edgeEl = target.closest('[data-edge-a]');
        if (nodeEl) {
            const id = Number(nodeEl.dataset.nodeId);
            const node = this.graph.getNode(id);
            if (!node)
                return;
            this.pending = {
                kind: 'node',
                id,
                start: p,
                offset: { x: node.x - p.x, y: node.y - p.y },
                dragging: false,
            };
        }
        else if (edgeEl) {
            this.pending = {
                kind: 'edge',
                a: Number(edgeEl.dataset.edgeA),
                b: Number(edgeEl.dataset.edgeB),
                start: p,
            };
        }
        else {
            this.pending = { kind: 'background', start: p };
        }
        this.svg.setPointerCapture(e.pointerId);
        e.preventDefault();
    };
    onPointerMove = (e) => {
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
    onPointerUp = (e) => {
        const pending = this.pending;
        this.pending = null;
        if (!pending)
            return;
        const p = this.toLocal(e);
        const moved = distance(p, pending.start) > DRAG_THRESHOLD;
        switch (pending.kind) {
            case 'node':
                if (pending.dragging) {
                    this.svg.classList.remove('dragging');
                    this.render();
                    this.kickLayout(); // released node rejoins the simulation
                }
                else {
                    this.handleNodeClick(pending.id);
                }
                break;
            case 'edge':
                if (!moved)
                    this.handleEdgeClick(pending.a, pending.b);
                break;
            case 'background':
                if (!moved)
                    this.handleBackgroundClick(p);
                break;
        }
    };
    onPointerCancel = () => {
        this.pending = null;
        this.svg.classList.remove('dragging');
        this.render();
        this.kickLayout();
    };
    onResize = () => {
        this.kickLayout();
    };
    onPointerLeave = () => {
        if (this.pending)
            return; // pointer is captured; keep tracking
        this.cursor = null;
        this.updatePreview();
    };
    onContextMenu = (e) => {
        const nodeEl = e.target.closest('[data-node-id]');
        if (!nodeEl)
            return;
        e.preventDefault();
        this.deleteNode(Number(nodeEl.dataset.nodeId));
    };
    onKeyDown = (e) => {
        if (this.selected === null)
            return;
        if (e.key === 'Escape') {
            this.select(null);
            this.message('Selection cleared.');
        }
        else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            this.deleteNode(this.selected);
        }
    };
    // ------------------------------------------------------------- actions
    handleNodeClick(id) {
        if (this.selected === null) {
            this.select(id);
            this.message(`Node ${id} selected — click another node to connect it, or empty space to cancel.`);
            return;
        }
        if (this.selected === id) {
            this.select(null);
            this.message('Selection cleared.');
            return;
        }
        const from = this.selected;
        if (this.graph.hasEdge(from, id)) {
            this.message(`Nodes ${from} and ${id} are already connected.`, 'warn');
            return;
        }
        this.graph.addEdge(from, id);
        this.select(null);
        this.changed();
        this.message(`Added edge ${from} — ${id}.`);
    }
    handleEdgeClick(a, b) {
        if (!this.graph.removeEdge(a, b))
            return;
        this.render();
        this.changed();
        this.message(`Removed edge ${a} — ${b}.`);
    }
    handleBackgroundClick(p) {
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
    deleteNode(id) {
        if (!this.graph.removeNode(id))
            return;
        if (this.selected === id)
            this.selected = null;
        this.render();
        this.changed();
        this.message(`Removed node ${id} and its edges.`);
    }
    select(id) {
        this.selected = id;
        this.render();
    }
    // ------------------------------------------------------------ rendering
    render() {
        // Edges (keyed so DOM elements — and their hover state — survive re-renders).
        const liveEdges = new Set();
        for (const [a, b] of this.graph.getEdges()) {
            const key = `${a}-${b}`;
            liveEdges.add(key);
            let g = this.edgeEls.get(key);
            if (!g) {
                g = svgEl('g', { class: 'edge' });
                g.dataset.edgeA = String(a);
                g.dataset.edgeB = String(b);
                const title = svgEl('title', {});
                title.textContent = `Edge ${a} — ${b} (click to delete)`;
                g.append(svgEl('line', { class: 'edge-hit' }), svgEl('line', { class: 'edge-line' }), title);
                this.edgeLayer.append(g);
                this.edgeEls.set(key, g);
            }
            const na = this.graph.getNode(a);
            const nb = this.graph.getNode(b);
            for (const line of g.querySelectorAll('line')) {
                setAttrs(line, { x1: na.x, y1: na.y, x2: nb.x, y2: nb.y });
            }
        }
        for (const [key, g] of this.edgeEls) {
            if (!liveEdges.has(key)) {
                g.remove();
                this.edgeEls.delete(key);
            }
        }
        // Nodes.
        const liveNodes = new Set();
        for (const node of this.graph.getNodes()) {
            liveNodes.add(node.id);
            let g = this.nodeEls.get(node.id);
            if (!g) {
                g = svgEl('g', { class: 'node' });
                g.dataset.nodeId = String(node.id);
                const label = svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' });
                label.textContent = String(node.id);
                g.append(svgEl('circle', { r: NODE_RADIUS }), label);
                this.nodeLayer.append(g);
                this.nodeEls.set(node.id, g);
            }
            g.setAttribute('transform', `translate(${node.x} ${node.y})`);
            g.classList.toggle('selected', node.id === this.selected);
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
    /** Dashed line from the selected node to the cursor while choosing an edge target. */
    updatePreview() {
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
    kickLayout(temperature = 1) {
        if (!this.autoLayout)
            return;
        this.layout.reheat(temperature);
        if (this.frame === null)
            this.frame = requestAnimationFrame(this.layoutFrame);
    }
    layoutFrame = () => {
        this.frame = null;
        if (!this.autoLayout)
            return;
        const rect = this.svg.getBoundingClientRect();
        const bounds = { width: rect.width, height: rect.height };
        const pinned = new Set();
        if (this.pending?.kind === 'node' && this.pending.dragging)
            pinned.add(this.pending.id);
        // With reduced motion, jump straight to the settled layout instead of animating.
        const steps = prefersReducedMotion() ? 1000 : 1;
        for (let i = 0; i < steps && this.layout.running; i++) {
            this.layout.step(this.graph, bounds, pinned);
        }
        this.render();
        if (this.layout.running)
            this.frame = requestAnimationFrame(this.layoutFrame);
    };
    // -------------------------------------------------------------- helpers
    toLocal(e) {
        const rect = this.svg.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    clampToCanvas(p) {
        const rect = this.svg.getBoundingClientRect();
        const pad = NODE_RADIUS + 2;
        return {
            x: Math.min(Math.max(p.x, pad), Math.max(pad, rect.width - pad)),
            y: Math.min(Math.max(p.y, pad), Math.max(pad, rect.height - pad)),
        };
    }
    /** The graph's structure changed: notify listeners and re-run the layout. */
    changed() {
        this.callbacks.onChange?.();
        this.kickLayout();
    }
    message(text, tone = 'info') {
        this.callbacks.onMessage?.(text, tone);
    }
}
function prefersReducedMotion() {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}
function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    setAttrs(el, attrs);
    return el;
}
function setAttrs(el, attrs) {
    for (const [k, v] of Object.entries(attrs))
        el.setAttribute(k, String(v));
}
//# sourceMappingURL=editor.js.map