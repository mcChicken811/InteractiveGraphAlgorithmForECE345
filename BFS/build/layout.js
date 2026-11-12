/** Tuned on paths, cycles, stars, grids, triangles and disconnected/isolated nodes. */
export const DEFAULT_LAYOUT_OPTIONS = {
    padding: 24,
    minEdgeLength: 70,
    maxEdgeLength: 150,
    gravity: 0.15,
    repulsionCutoff: 2.5,
    stepScale: 0.1,
    maxStep: 0.25,
    cooling: 0.985,
};
/** Below this temperature the layout counts as settled. */
const MIN_TEMPERATURE = 0.005;
/** If no node moved more than this (px) in a step, stop early. */
const REST_THRESHOLD = 0.05;
export class ForceLayout {
    /** 1 = hot (just started), 0 = settled. */
    temperature = 0;
    options;
    constructor(options = {}) {
        this.options = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
    }
    /** True while the layout still has energy and `step()` should keep being called. */
    get running() {
        return this.temperature > MIN_TEMPERATURE;
    }
    /** Restart (or keep) the simulation at least at the given temperature. */
    reheat(temperature = 1) {
        this.temperature = Math.max(this.temperature, Math.min(1, temperature));
    }
    stop() {
        this.temperature = 0;
    }
    /** Ideal edge length: the side of the square each node would get if area were shared evenly. */
    idealEdgeLength(bounds, nodeCount) {
        const { padding, minEdgeLength, maxEdgeLength } = this.options;
        const area = Math.max(1, bounds.width - 2 * padding) * Math.max(1, bounds.height - 2 * padding);
        const k = 0.6 * Math.sqrt(area / Math.max(1, nodeCount));
        return Math.min(maxEdgeLength, Math.max(minEdgeLength, k));
    }
    /**
     * Advances the simulation one step, moving nodes in `graph` in place.
     * Nodes in `pinned` (e.g. one being dragged) exert forces but do not move.
     * Returns the largest distance any node moved.
     */
    step(graph, bounds, pinned = new Set()) {
        const nodes = graph.getNodes();
        if (!this.running || nodes.length === 0) {
            this.temperature = 0;
            return 0;
        }
        const { padding, gravity, repulsionCutoff, stepScale, maxStep, cooling } = this.options;
        const n = nodes.length;
        const k = this.idealEdgeLength(bounds, n);
        const index = new Map(nodes.map((node, i) => [node.id, i]));
        const fx = new Float64Array(n);
        const fy = new Float64Array(n);
        const cutoff = repulsionCutoff * k;
        // Repulsion between every pair: k² / d.  O(n²), fine for hand-drawn graphs.
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                let dx = nodes[i].x - nodes[j].x;
                let dy = nodes[i].y - nodes[j].y;
                let d = Math.hypot(dx, dy);
                if (d < 0.01) {
                    // Coincident nodes: separate them in a deterministic direction.
                    const angle = (i * 7 + j * 13) % 360;
                    dx = Math.cos(angle);
                    dy = Math.sin(angle);
                    d = 1;
                }
                if (d > cutoff)
                    continue;
                const f = (k * k) / d;
                const ux = dx / d;
                const uy = dy / d;
                fx[i] += ux * f;
                fy[i] += uy * f;
                fx[j] -= ux * f;
                fy[j] -= uy * f;
            }
        }
        // Attraction along edges: d² / k.
        for (const [a, b] of graph.getEdges()) {
            const i = index.get(a);
            const j = index.get(b);
            const dx = nodes[i].x - nodes[j].x;
            const dy = nodes[i].y - nodes[j].y;
            const d = Math.hypot(dx, dy);
            if (d < 0.01)
                continue;
            const f = (d * d) / k;
            const ux = dx / d;
            const uy = dy / d;
            fx[i] -= ux * f;
            fy[i] -= uy * f;
            fx[j] += ux * f;
            fy[j] += uy * f;
        }
        // Gentle constant pull toward the centre.
        const cx = bounds.width / 2;
        const cy = bounds.height / 2;
        for (let i = 0; i < n; i++) {
            const dx = cx - nodes[i].x;
            const dy = cy - nodes[i].y;
            const d = Math.hypot(dx, dy);
            if (d < 1)
                continue;
            const f = gravity * k * Math.min(1, d / k); // fades out near the centre
            fx[i] += (dx / d) * f;
            fy[i] += (dy / d) * f;
        }
        // Move each free node along its force, capped by the temperature.
        const limit = this.temperature * maxStep * k;
        const minX = Math.min(padding, bounds.width / 2);
        const minY = Math.min(padding, bounds.height / 2);
        const maxX = Math.max(minX, bounds.width - padding);
        const maxY = Math.max(minY, bounds.height - padding);
        let maxMoved = 0;
        for (let i = 0; i < n; i++) {
            const node = nodes[i];
            if (pinned.has(node.id))
                continue;
            let mx = fx[i] * stepScale;
            let my = fy[i] * stepScale;
            const len = Math.hypot(mx, my);
            if (len > limit) {
                mx = (mx / len) * limit;
                my = (my / len) * limit;
            }
            const x = Math.min(maxX, Math.max(minX, node.x + mx));
            const y = Math.min(maxY, Math.max(minY, node.y + my));
            maxMoved = Math.max(maxMoved, Math.hypot(x - node.x, y - node.y));
            graph.moveNode(node.id, x, y);
        }
        this.temperature *= cooling;
        if (maxMoved < REST_THRESHOLD)
            this.temperature = 0;
        return maxMoved;
    }
    /** Runs until settled (or `maxSteps`), returning the number of steps taken. */
    settle(graph, bounds, maxSteps = 1000) {
        this.reheat();
        let steps = 0;
        while (this.running && steps < maxSteps) {
            this.step(graph, bounds);
            steps++;
        }
        return steps;
    }
}
//# sourceMappingURL=layout.js.map