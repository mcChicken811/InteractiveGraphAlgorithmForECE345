(function() {
	// src/graph-views.ts
	/**
	* How an undirected *weighted* view combines the weights when arcs run both ways with
	* different weights: the smaller one (the cheapest way between the two nodes). Editing
	* an undirected edge sets both arcs to the same value, so they then agree.
	*/
	const UNDIRECTED_WEIGHT = (a, b) => Math.min(a, b);
	const ascending = (a, b) => a - b;
	const sorted = (ids) => [...ids ?? []].sort(ascending);
	/** Shared implementation: everything here is derived from `neighbors`, `hasEdge` and `storedWeight`. */
	var BaseView = class {
		arcs;
		weighting;
		constructor(arcs, weighting) {
			this.arcs = arcs;
			this.weighting = weighting;
		}
		get directed() {
			return this.orientation === "directed";
		}
		get weighted() {
			return this.weighting !== "unweighted";
		}
		/** How this view reads a stored weight: as it is, or (positive) its magnitude. */
		read(stored) {
			return this.weighting === "positive" ? Math.abs(stored) : stored;
		}
		nodeIds() {
			return this.arcs.nodeIds();
		}
		degree(id) {
			return this.neighbors(id).length;
		}
		get edgeCount() {
			return this.edges().length;
		}
		weight(a, b) {
			const stored = this.storedWeight(a, b);
			if (stored === void 0) return void 0;
			return this.weighted ? this.read(stored) : 1;
		}
		weightedNeighbors(id) {
			return this.neighbors(id).map((n) => ({
				id: n,
				weight: this.weight(id, n)
			}));
		}
		weightedEdges() {
			return this.edges().map(([from, to]) => ({
				from,
				to,
				weight: this.weight(from, to)
			}));
		}
		adjacencyList() {
			return this.nodeIds().map((id) => ({
				id,
				neighbors: this.neighbors(id)
			}));
		}
		weightedAdjacencyList() {
			return this.nodeIds().map((id) => ({
				id,
				neighbors: this.weightedNeighbors(id)
			}));
		}
		adjacencyMatrix() {
			const ids = this.nodeIds();
			return {
				ids,
				matrix: ids.map((a) => ids.map((b) => this.hasEdge(a, b) ? 1 : 0))
			};
		}
		weightMatrix() {
			const ids = this.nodeIds();
			return {
				ids,
				matrix: ids.map((a) => ids.map((b) => this.weight(a, b) ?? null))
			};
		}
	};
	/** Every stored arc is its own edge. */
	var DirectedView = class extends BaseView {
		orientation = "directed";
		neighbors(id) {
			return this.outNeighbors(id);
		}
		/** Nodes this node's arcs point to, sorted. Same as `neighbors`. */
		outNeighbors(id) {
			return sorted(this.arcs.out(id)?.keys());
		}
		/** Nodes whose arcs point to this node, sorted. */
		inNeighbors(id) {
			return sorted(this.arcs.in(id));
		}
		outDegree(id) {
			return this.arcs.out(id)?.size ?? 0;
		}
		inDegree(id) {
			return this.arcs.in(id)?.size ?? 0;
		}
		hasEdge(a, b) {
			return this.arcs.out(a)?.has(b) ?? false;
		}
		edges() {
			const edges = [];
			for (const from of this.nodeIds()) for (const to of this.outNeighbors(from)) edges.push([from, to]);
			return edges;
		}
		storedWeight(a, b) {
			return this.arcs.out(a)?.get(b);
		}
	};
	/** Directions are ignored: an arc either way (or both) makes one edge. */
	var UndirectedView = class extends BaseView {
		orientation = "undirected";
		neighbors(id) {
			return sorted(/* @__PURE__ */ new Set([...this.arcs.out(id)?.keys() ?? [], ...this.arcs.in(id) ?? []]));
		}
		hasEdge(a, b) {
			return (this.arcs.out(a)?.has(b) ?? false) || (this.arcs.out(b)?.has(a) ?? false);
		}
		edges() {
			const edges = [];
			for (const a of this.nodeIds()) for (const b of this.neighbors(a)) if (a < b) edges.push([a, b]);
			return edges;
		}
		storedWeight(a, b) {
			const there = this.arcs.out(a)?.get(b);
			const back = this.arcs.out(b)?.get(a);
			if (there === void 0) return back;
			if (back === void 0) return there;
			return UNDIRECTED_WEIGHT(this.read(there), this.read(back));
		}
		/**
		* Connected components, found by breadth-first search (for the directed graph these
		* are its *weakly* connected components). Largest first, ties by smallest id; each
		* component lists its ids in BFS order from its smallest id.
		*/
		connectedComponents() {
			const seen = /* @__PURE__ */ new Set();
			const components = [];
			for (const start of this.nodeIds()) {
				if (seen.has(start)) continue;
				const component = [];
				const queue = [start];
				seen.add(start);
				for (let head = 0; head < queue.length; head++) {
					const v = queue[head];
					component.push(v);
					for (const w of this.neighbors(v)) if (!seen.has(w)) {
						seen.add(w);
						queue.push(w);
					}
				}
				components.push(component);
			}
			return components.sort((a, b) => b.length - a.length);
		}
	};
	// src/graph.ts
	/**
	* Weighted graph. Edges are always *stored* as weighted directed arcs (from → to, weight;
	* the weight defaults to 0), in an out-adjacency map plus an in-adjacency set for fast
	* removal.
	*
	* Reading: the arcs can be interpreted as directed or undirected, and as weighted,
	* unweighted (every edge weight 1) or positive (each weight's magnitude). All six
	* interpretations are always available as pure, read-only views (see graph-views.ts):
	*
	*   graph.view('directed' | 'undirected', 'weighted' | 'unweighted' | 'positive')
	*   graph.directedView / graph.undirectedView   the two unweighted views (shortcuts)
	*   graph.currentView                           the one selected by `directed` and
	*                                               `weighting` (the UI's modes)
	*
	* The convenience readers on Graph itself (`neighbors`, `hasEdge`, `getEdges`,
	* `edgeCount`, `adjacencyList`, `adjacencyMatrix`) delegate to `currentView`.
	*
	* Writing: `addEdge` / `removeEdge` / `setWeight` follow `directed` (see their docs).
	* Node positions live here too so the editor can render them.
	*/
	var Graph = class {
		/** Directed or undirected reading for the mode-dependent methods. Never changes stored arcs. */
		directed = false;
		/** Weighted, unweighted or positive reading for `currentView`. Never changes stored weights. */
		weighting = "unweighted";
		/** Whether weights are read ('weighted' or 'positive'). Setting it picks 'weighted' or 'unweighted'. */
		get weighted() {
			return this.weighting !== "unweighted";
		}
		set weighted(on) {
			this.weighting = on ? "weighted" : "unweighted";
		}
		nodes = /* @__PURE__ */ new Map();
		/** from → (to → weight) */
		out = /* @__PURE__ */ new Map();
		/** to → sources */
		in = /* @__PURE__ */ new Map();
		/** Read-only access to the stored arcs, shared by the views. */
		reader = {
			nodeIds: () => [...this.nodes.keys()].sort((a, b) => a - b),
			out: (id) => this.out.get(id),
			in: (id) => this.in.get(id)
		};
		views = {
			directed: {
				unweighted: new DirectedView(this.reader, "unweighted"),
				weighted: new DirectedView(this.reader, "weighted"),
				positive: new DirectedView(this.reader, "positive")
			},
			undirected: {
				unweighted: new UndirectedView(this.reader, "unweighted"),
				weighted: new UndirectedView(this.reader, "weighted"),
				positive: new UndirectedView(this.reader, "positive")
			}
		};
		view(orientation, weighting = "unweighted") {
			return this.views[orientation][weighting];
		}
		/** The arcs read as an unweighted directed graph. */
		get directedView() {
			return this.views.directed.unweighted;
		}
		/** The arcs read as an unweighted undirected graph. */
		get undirectedView() {
			return this.views.undirected.unweighted;
		}
		/** The view selected by `directed` and `weighting`. */
		get currentView() {
			return this.view(this.directed ? "directed" : "undirected", this.weighting);
		}
		get nodeCount() {
			return this.nodes.size;
		}
		/** Adds a node using the smallest unused id, so labels stay compact. */
		addNode(x, y) {
			let id = 0;
			while (this.nodes.has(id)) id++;
			const node = {
				id,
				x,
				y
			};
			this.nodes.set(id, node);
			this.out.set(id, /* @__PURE__ */ new Map());
			this.in.set(id, /* @__PURE__ */ new Set());
			return node;
		}
		/** Removes a node and every arc into or out of it. */
		removeNode(id) {
			if (!this.nodes.has(id)) return false;
			for (const to of this.out.get(id).keys()) this.in.get(to).delete(id);
			for (const from of this.in.get(id)) this.out.get(from).delete(id);
			this.out.delete(id);
			this.in.delete(id);
			this.nodes.delete(id);
			return true;
		}
		moveNode(id, x, y) {
			const node = this.nodes.get(id);
			if (node) {
				node.x = x;
				node.y = y;
			}
		}
		getNode(id) {
			return this.nodes.get(id);
		}
		/** Nodes sorted by id. */
		getNodes() {
			return [...this.nodes.values()].sort((a, b) => a.id - b.id);
		}
		/** True if the arc from → to is stored (ignores `directed`). */
		hasArc(from, to) {
			return this.directedView.hasEdge(from, to);
		}
		/** Stored weight of the arc from → to, or undefined if there is no such arc. */
		arcWeight(from, to) {
			return this.out.get(from)?.get(to);
		}
		/** Every stored arc as [from, to], sorted (ignores `directed`). */
		getArcs() {
			return this.directedView.edges();
		}
		/**
		* Adds an edge from a to b, always stored as the arc a → b with the given weight
		* (default 0). Returns false for self-loops, unknown nodes, non-finite weights, or an
		* edge that already exists in the current view (undirected: a and b adjacent either way).
		*/
		addEdge(a, b, weight = 0) {
			if (a === b || !this.nodes.has(a) || !this.nodes.has(b) || !Number.isFinite(weight)) return false;
			if (this.hasEdge(a, b)) return false;
			this.out.get(a).set(b, weight);
			this.in.get(b).add(a);
			return true;
		}
		/**
		* Sets the weight of the edge between a and b in the current orientation:
		* directed → the arc a → b; undirected → every stored arc between them (one or both
		* directions), so they agree afterwards. Returns false if there is no such edge.
		*/
		setWeight(a, b, weight) {
			if (!Number.isFinite(weight)) return false;
			let changed = false;
			const arcs = this.directed ? [[a, b]] : [[a, b], [b, a]];
			for (const [from, to] of arcs) {
				const targets = this.out.get(from);
				if (targets?.has(to)) {
					targets.set(to, weight);
					changed = true;
				}
			}
			return changed;
		}
		/**
		* Removes the edge between a and b in the current view:
		* directed → only the arc a → b; undirected → the arcs in both directions.
		*/
		removeEdge(a, b) {
			let removed = this.removeArc(a, b);
			if (!this.directed) removed = this.removeArc(b, a) || removed;
			return removed;
		}
		removeArc(from, to) {
			if (!this.out.get(from)?.delete(to)) return false;
			this.in.get(to)?.delete(from);
			return true;
		}
		/** Removes every stored arc, keeping the nodes where they are. */
		clearEdges() {
			for (const targets of this.out.values()) targets.clear();
			for (const sources of this.in.values()) sources.clear();
		}
		clear() {
			this.nodes.clear();
			this.out.clear();
			this.in.clear();
		}
		/** Number of edges in the current view. */
		get edgeCount() {
			return this.currentView.edgeCount;
		}
		/** Edges in the current view (see GraphView.edges). */
		getEdges() {
			return this.currentView.edges();
		}
		/** Neighbours in the current view, sorted by id (a stable order for BFS). */
		neighbors(id) {
			return this.currentView.neighbors(id);
		}
		/** Is there an edge a → b (directed) / between a and b (undirected) in the current view? */
		hasEdge(a, b) {
			return this.currentView.hasEdge(a, b);
		}
		adjacencyList() {
			return this.currentView.adjacencyList();
		}
		adjacencyMatrix() {
			return this.currentView.adjacencyMatrix();
		}
		/** Connected components ignoring direction (see UndirectedView.connectedComponents). */
		connectedComponents() {
			return this.undirectedView.connectedComponents();
		}
	};
	// src/layout.ts
	const DEFAULT_LAYOUT_OPTIONS = {
		padding: 24,
		minEdgeLength: 70,
		maxEdgeLength: 150,
		componentGap: .5,
		packRate: .15,
		stepScale: 1,
		maxStep: .25,
		cooling: .985,
		minLengthFactor: .45,
		maxLengthFactor: 2.5,
		weightedPull: 2
	};
	/** Below this temperature the force simulation counts as settled. */
	const MIN_TEMPERATURE = .005;
	/** Movements below this (px) count as "at rest". */
	const REST_THRESHOLD = .05;
	/**
	* When the packed layout overflows the canvas, k shrinks (e.g. a long path drawn straight),
	* but never below this many node "paddings" (≈ radii), so nodes cannot overlap.
	*/
	const MIN_EDGE_IN_PADDINGS = 2;
	/** The packed layout may fill at most this fraction of the canvas before it is shrunk. */
	const FIT = .95;
	/** Shrink by at most this factor per step, so the fit is smooth and does not fold the drawing. */
	const MAX_SHRINK_PER_STEP = .97;
	/** Below this fraction (in both directions), a shrunken layout grows back toward scale 1. */
	const GROW = .8;
	/** Largest rotation per step (radians, ≈3°) when aligning an overflowing component. */
	const MAX_ROTATION = .05;
	/** Only rotate components whose spread along their minor axis is below this fraction of the major. */
	const ELONGATED = .6;
	/** Golden angle (radians): spreads per-node jiggle directions evenly. */
	const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
	/**
	* Weighted layouts: how far (in paddings ≈ node radii) a node must stay from edges it is
	* not on. 1.25 leaves a visible gap; more costs more of the edge lengths' fidelity.
	*/
	const EDGE_CLEARANCE = 1.25;
	/** Jiggle strength as a fraction of k at full temperature (fades with temperature²). */
	const JIGGLE = .03;
	/** Fills rows left to right, starting a new row when the next box would exceed `rowLimit`. */
	function fillRows(sizes, gap, rowLimit) {
		const rows = [];
		let row = {
			items: [],
			width: 0,
			height: 0
		};
		sizes.forEach((s, i) => {
			if (row.items.length && row.width + gap + s.width > rowLimit) {
				rows.push(row);
				row = {
					items: [],
					width: 0,
					height: 0
				};
			}
			row.width = row.items.length ? row.width + gap + s.width : s.width;
			row.height = Math.max(row.height, s.height);
			row.items.push(i);
		});
		rows.push(row);
		return rows;
	}
	function extent(rows, gap) {
		return {
			width: Math.max(...rows.map((r) => r.width)),
			height: rows.reduce((sum, r) => sum + r.height, 0) + gap * (rows.length - 1)
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
	function packRows(sizes, bounds, gap) {
		if (sizes.length === 0) return {
			centers: [],
			width: 0,
			height: 0
		};
		const area = sizes.reduce((sum, s) => sum + (s.width + gap) * (s.height + gap), 0);
		const widest = Math.max(...sizes.map((s) => s.width));
		const aspect = bounds.width / Math.max(1, bounds.height);
		const limits = [Math.max(widest, Math.min(bounds.width, Math.sqrt(area * aspect)))];
		const STEPS = 8;
		for (let i = 0; i <= STEPS; i++) limits.push(widest + (bounds.width - widest) * i / STEPS);
		let best = null;
		for (const limit of limits) {
			const rows = fillRows(sizes, gap, limit);
			const size = extent(rows, gap);
			const room = Math.min(bounds.width / size.width, bounds.height / size.height);
			if (!best || room > best.room * 1.01) best = {
				rows,
				size,
				room
			};
		}
		const { rows, size } = best;
		const centers = new Array(sizes.length);
		let y = (bounds.height - size.height) / 2;
		for (const r of rows) {
			let x = (bounds.width - r.width) / 2;
			for (const i of r.items) {
				centers[i] = {
					x: x + sizes[i].width / 2,
					y: y + r.height / 2
				};
				x += sizes[i].width + gap;
			}
			y += r.height + gap;
		}
		return {
			centers,
			width: size.width,
			height: size.height
		};
	}
	var ForceLayout = class {
		/** Force-simulation temperature: 1 = hot (just started), 0 = settled. */
		temperature = 0;
		/** True while components are still travelling to their packed slots. */
		packing = false;
		/** Shrinks k when the packed components do not fit the canvas. */
		scale = 1;
		options;
		constructor(options = {}) {
			this.options = {
				...DEFAULT_LAYOUT_OPTIONS,
				...options
			};
		}
		/** True while the layout still has work to do and `step()` should keep being called. */
		get running() {
			return this.temperature > MIN_TEMPERATURE || this.packing;
		}
		/** Restart (or keep) the simulation at least at the given temperature. */
		reheat(temperature = 1) {
			this.temperature = Math.max(this.temperature, Math.min(1, temperature));
			this.packing = true;
		}
		stop() {
			this.temperature = 0;
			this.packing = false;
		}
		/** Ideal edge length: proportional to the side of the square each node would get if area were shared evenly. */
		idealEdgeLength(bounds, nodeCount) {
			const { padding, minEdgeLength, maxEdgeLength } = this.options;
			const area = Math.max(1, bounds.width - 2 * padding) * Math.max(1, bounds.height - 2 * padding);
			const k = .6 * Math.sqrt(area / Math.max(1, nodeCount));
			return Math.min(maxEdgeLength, Math.max(minEdgeLength, k));
		}
		/**
		* Advances the layout one step, moving nodes in `graph` in place.
		* Nodes in `pinned` (e.g. one being dragged) exert forces but do not move, and
		* their component is not repositioned by the packing.
		* Returns the largest distance any node moved.
		*/
		step(graph, bounds, pinned = /* @__PURE__ */ new Set(), weight) {
			const nodes = graph.getNodes();
			if (!this.running || nodes.length === 0) {
				this.stop();
				return 0;
			}
			const { padding, componentGap, packRate, stepScale, maxStep, cooling } = this.options;
			const minK = MIN_EDGE_IN_PADDINGS * padding;
			let k = Math.max(minK, this.idealEdgeLength(bounds, nodes.length) * this.scale);
			const pos = new Map(nodes.map((n) => [n.id, {
				x: n.x,
				y: n.y
			}]));
			const components = graph.connectedComponents();
			const lengths = weight ? this.lengthFactors(graph, weight) : null;
			const limit = this.temperature * maxStep * k;
			for (const component of components) {
				if (component.length < 2) continue;
				const { force, stiffness } = this.componentForces(graph, component, pos, k, lengths);
				for (const id of component) {
					if (pinned.has(id)) continue;
					const f = force.get(id);
					const rate = stepScale / Math.max(1, stiffness.get(id));
					const jiggle = JIGGLE * k * this.temperature ** 2;
					let mx = f.x * rate + Math.cos(id * GOLDEN_ANGLE) * jiggle;
					let my = f.y * rate + Math.sin(id * GOLDEN_ANGLE) * jiggle;
					const len = Math.hypot(mx, my);
					if (len > limit) {
						mx = mx / len * limit;
						my = my / len * limit;
					}
					const p = pos.get(id);
					p.x += mx;
					p.y += my;
				}
			}
			for (const component of components) resolveCollisions(component, pos, pinned, 2 * padding);
			if (lengths) for (const component of components) clearEdges(graph, component, pos, pinned, EDGE_CLEARANCE * padding);
			for (const component of components) {
				if (component.length < 3 || component.some((id) => pinned.has(id))) continue;
				const box = boundingBox(component, pos, padding);
				if (box.maxX - box.minX > FIT * bounds.width || box.maxY - box.minY > FIT * bounds.height) rotateTowardLongSide(component, pos, bounds);
			}
			let boxes = components.map((c) => boundingBox(c, pos, padding));
			let packed = packRows(sizesOf(boxes), bounds, componentGap * k);
			const fit = Math.min(FIT * bounds.width / packed.width, FIT * bounds.height / packed.height);
			const factor = Math.min(1, Math.max(fit, MAX_SHRINK_PER_STEP, minK / k));
			if (factor < 1) {
				components.forEach((component, i) => {
					if (component.some((id) => pinned.has(id))) return;
					const cx = (boxes[i].minX + boxes[i].maxX) / 2;
					const cy = (boxes[i].minY + boxes[i].maxY) / 2;
					for (const id of component) {
						const p = pos.get(id);
						p.x = cx + (p.x - cx) * factor;
						p.y = cy + (p.y - cy) * factor;
					}
				});
				k *= factor;
				this.scale *= factor;
				boxes = components.map((c) => boundingBox(c, pos, padding));
				packed = packRows(sizesOf(boxes), bounds, componentGap * k);
			}
			if (this.scale < 1 && packed.width < GROW * bounds.width && packed.height < GROW * bounds.height) this.scale = Math.min(1, this.scale * 1.002);
			let packMoved = 0;
			components.forEach((component, i) => {
				if (component.some((id) => pinned.has(id))) return;
				const box = boxes[i];
				const dx = (packed.centers[i].x - (box.minX + box.maxX) / 2) * packRate;
				const dy = (packed.centers[i].y - (box.minY + box.maxY) / 2) * packRate;
				packMoved = Math.max(packMoved, Math.hypot(dx, dy));
				for (const id of component) {
					const p = pos.get(id);
					p.x += dx;
					p.y += dy;
				}
			});
			const minX = Math.min(padding, bounds.width / 2);
			const minY = Math.min(padding, bounds.height / 2);
			const maxX = Math.max(minX, bounds.width - padding);
			const maxY = Math.max(minY, bounds.height - padding);
			let maxMoved = 0;
			for (const node of nodes) {
				if (pinned.has(node.id)) continue;
				const p = pos.get(node.id);
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
		settle(graph, bounds, maxSteps = 2e3, weight) {
			this.reheat();
			let steps = 0;
			while (this.running && steps < maxSteps) {
				this.step(graph, bounds, /* @__PURE__ */ new Set(), weight);
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
		lengthFactors(graph, weight) {
			const { minLengthFactor, maxLengthFactor } = this.options;
			const pairs = graph.undirectedView.edges();
			const magnitudes = pairs.map(([a, b]) => Math.abs(weight(a, b)));
			const positive = magnitudes.filter((m) => m > 0);
			const mean = positive.length ? positive.reduce((s, m) => s + m, 0) / positive.length : 0;
			const factors = /* @__PURE__ */ new Map();
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
		componentForces(graph, component, pos, k, lengths = null) {
			const force = new Map(component.map((id) => [id, {
				x: 0,
				y: 0
			}]));
			const stiffness = new Map(component.map((id) => [id, 0]));
			const ids = [...component].sort((a, b) => a - b);
			for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
				const p = pos.get(ids[i]);
				const q = pos.get(ids[j]);
				let dx = p.x - q.x;
				let dy = p.y - q.y;
				let d = Math.hypot(dx, dy);
				if (d < .01) {
					const angle = (ids[i] * 7 + ids[j] * 13) % 360;
					dx = Math.cos(angle);
					dy = Math.sin(angle);
					d = 1;
				}
				const f = k * k / d;
				addForce(force.get(ids[i]), dx / d * f, dy / d * f);
				addForce(force.get(ids[j]), -dx / d * f, -dy / d * f);
				const s = k * k / (d * d);
				stiffness.set(ids[i], stiffness.get(ids[i]) + s);
				stiffness.set(ids[j], stiffness.get(ids[j]) + s);
			}
			for (const a of ids) for (const b of graph.undirectedView.neighbors(a)) {
				if (b < a) continue;
				const p = pos.get(a);
				const q = pos.get(b);
				const dx = p.x - q.x;
				const dy = p.y - q.y;
				const d = Math.hypot(dx, dy);
				if (d < .01) continue;
				const factor = lengths?.get(`${a}-${b}`) ?? 1;
				const pull = factor === 1 && !lengths ? 1 : this.options.weightedPull / factor ** 3;
				const f = d * d / k * pull;
				addForce(force.get(a), -dx / d * f, -dy / d * f);
				addForce(force.get(b), dx / d * f, dy / d * f);
				const s = 2 * d / k * pull;
				stiffness.set(a, stiffness.get(a) + s);
				stiffness.set(b, stiffness.get(b) + s);
			}
			return {
				force,
				stiffness
			};
		}
	};
	function addForce(target, x, y) {
		target.x += x;
		target.y += y;
	}
	/** Separates overlapping nodes of one component; pinned nodes stay put. */
	function resolveCollisions(component, pos, pinned, minDistance) {
		for (let pass = 0; pass < 2; pass++) for (let i = 0; i < component.length; i++) for (let j = i + 1; j < component.length; j++) {
			const a = component[i];
			const b = component[j];
			const p = pos.get(a);
			const q = pos.get(b);
			const dx = q.x - p.x;
			const dy = q.y - p.y;
			const d = Math.hypot(dx, dy);
			if (d >= minDistance || d < 1e-6) continue;
			const aFixed = pinned.has(a);
			const bFixed = pinned.has(b);
			if (aFixed && bFixed) continue;
			const push = (minDistance - d) / d;
			const share = aFixed || bFixed ? 1 : .5;
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
	/**
	* Pushes nodes of one component off edges they are not on: a node closer than `minDistance`
	* to such an edge (between its ends) moves away from it, and the edge's ends move the other
	* way, half as far each, so the push does not shift the drawing as a whole. Pinned nodes
	* stay put.
	*/
	function clearEdges(graph, component, pos, pinned, minDistance) {
		const inComponent = new Set(component);
		const edges = graph.undirectedView.edges().filter(([a]) => inComponent.has(a));
		for (let pass = 0; pass < 2; pass++) for (const [a, b] of edges) {
			const p = pos.get(a);
			const q = pos.get(b);
			const ex = q.x - p.x;
			const ey = q.y - p.y;
			const len2 = ex * ex + ey * ey;
			if (len2 < 1e-6) continue;
			for (const v of component) {
				if (v === a || v === b) continue;
				const r = pos.get(v);
				const t = ((r.x - p.x) * ex + (r.y - p.y) * ey) / len2;
				if (t <= .05 || t >= .95) continue;
				const cx = p.x + ex * t;
				const cy = p.y + ey * t;
				let dx = r.x - cx;
				let dy = r.y - cy;
				let d = Math.hypot(dx, dy);
				if (d >= minDistance) continue;
				if (d < 1e-6) {
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
				const nodeShare = pinned.has(v) ? 0 : ends ? .5 : 1;
				const endShare = ends ? 1 - nodeShare : 0;
				if (nodeShare) {
					r.x += dx * push * nodeShare;
					r.y += dy * push * nodeShare;
				}
				for (const [id, share] of [[a, 1 - t], [b, t]]) {
					if (pinned.has(id) || !endShare) continue;
					const e = pos.get(id);
					e.x -= dx * push * endShare * share;
					e.y -= dy * push * endShare * share;
				}
			}
		}
	}
	/**
	* Rotates a component about its centroid toward the canvas's longer side, by at most
	* MAX_ROTATION. The component's main direction is its principal axis (the dominant
	* eigenvector of the positions' covariance matrix).
	*/
	function rotateTowardLongSide(component, pos, bounds) {
		let cx = 0;
		let cy = 0;
		for (const id of component) {
			cx += pos.get(id).x;
			cy += pos.get(id).y;
		}
		cx /= component.length;
		cy /= component.length;
		let sxx = 0;
		let syy = 0;
		let sxy = 0;
		for (const id of component) {
			const dx = pos.get(id).x - cx;
			const dy = pos.get(id).y - cy;
			sxx += dx * dx;
			syy += dy * dy;
			sxy += dx * dy;
		}
		const mean = (sxx + syy) / 2;
		const spread = Math.hypot((sxx - syy) / 2, sxy);
		const major = mean + spread;
		const minor = mean - spread;
		if (major <= 0 || Math.sqrt(Math.max(0, minor) / major) > ELONGATED) return;
		const axis = .5 * Math.atan2(2 * sxy, sxx - syy);
		let diff = (bounds.width >= bounds.height ? 0 : Math.PI / 2) - axis;
		while (diff > Math.PI / 2) diff -= Math.PI;
		while (diff <= -Math.PI / 2) diff += Math.PI;
		const angle = Math.max(-.05, Math.min(MAX_ROTATION, diff));
		if (Math.abs(angle) < 1e-4) return;
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		for (const id of component) {
			const p = pos.get(id);
			const dx = p.x - cx;
			const dy = p.y - cy;
			p.x = cx + dx * cos - dy * sin;
			p.y = cy + dx * sin + dy * cos;
		}
	}
	function sizesOf(boxes) {
		return boxes.map((b) => ({
			width: b.maxX - b.minX,
			height: b.maxY - b.minY
		}));
	}
	function boundingBox(ids, pos, margin) {
		const box = {
			minX: Infinity,
			minY: Infinity,
			maxX: -Infinity,
			maxY: -Infinity
		};
		for (const id of ids) {
			const p = pos.get(id);
			box.minX = Math.min(box.minX, p.x - margin);
			box.minY = Math.min(box.minY, p.y - margin);
			box.maxX = Math.max(box.maxX, p.x + margin);
			box.maxY = Math.max(box.maxY, p.y + margin);
		}
		return box;
	}
	// src/label-fit.ts
	/**
	* Font size for a short label (an algorithm's label inside a vertex, e.g. DFS's "12,15")
	* so it fits across `width` px: `max` when it fits, smaller (in half-pixel steps) when
	* it doesn't. Widths are estimated, not measured, so this works without layout.
	*/
	function fitFontSize(text, width, max) {
		let ems = 0;
		for (const ch of text) ems += NARROW.has(ch) ? .3 : .62;
		if (ems === 0) return max;
		return Math.min(max, Math.floor(width / ems * 2) / 2);
	}
	const NARROW = /* @__PURE__ */ new Set([
		",",
		".",
		" ",
		":",
		";",
		"|",
		"!",
		"i",
		"l"
	]);
	// src/arc-diagram.ts
	const ROW_DEFAULTS = {
		padX: 56,
		padTop: 80,
		padBottom: 96,
		maxGap: 150,
		minGap: 88
	};
	/**
	* Lays `count` vertices out left to right, centred in `bounds`. If they don't fit at
	* `minGap` apart, they continue on the next row (left to right again, top to bottom),
	* with the rows spread evenly over the height. Arcs above the first row and below the
	* last get the room up to the canvas edges.
	*/
	function rowLayout(count, bounds, options = {}) {
		const o = {
			...ROW_DEFAULTS,
			...options
		};
		if (count === 0) return {
			positions: [],
			rows: 0,
			maxBulge: 0
		};
		const usable = Math.max(0, bounds.width - 2 * o.padX);
		const perRow = Math.max(1, Math.min(count, Math.floor(usable / o.minGap) + 1));
		const rows = Math.ceil(count / perRow);
		const gap = perRow > 1 ? Math.min(o.maxGap, usable / (perRow - 1)) : 0;
		const left = (bounds.width - gap * (perRow - 1)) / 2;
		const top = o.padTop;
		const rowHeight = Math.max(0, bounds.height - o.padTop - o.padBottom) / rows;
		const positions = [];
		for (let i = 0; i < count; i++) {
			const row = Math.floor(i / perRow);
			positions.push({
				x: left + i % perRow * gap,
				y: top + rowHeight * (row + .5)
			});
		}
		return {
			positions,
			rows,
			maxBulge: Math.max(0, rowHeight / 2 - 4)
		};
	}
	const FOREST_DEFAULTS = {
		padX: 56,
		padTop: 80,
		padBottom: 96,
		maxUnit: 72,
		maxRowHeight: 120
	};
	/**
	* Places a forest as on the timestamp chart: rows top to bottom by depth, and columns
	* left to right on a time scale, both as large as fits (up to `maxUnit` px per time unit
	* and `maxRowHeight` per row) and centred in `bounds`.
	*/
	function forestLayout(places, bounds, options = {}) {
		const o = {
			...FOREST_DEFAULTS,
			...options
		};
		if (places.length === 0) return [];
		const columns = places.map((p) => p.column);
		const [first, last] = [Math.min(...columns), Math.max(...columns)];
		const rows = Math.max(...places.map((p) => p.row)) + 1;
		const left = o.left ?? o.padX;
		const right = o.right ?? bounds.width - o.padX;
		const usableX = Math.max(0, right - left);
		const unit = last > first ? Math.min(o.maxUnit, usableX / (last - first)) : 0;
		const usableY = Math.max(0, bounds.height - o.padTop - o.padBottom);
		const rowHeight = Math.min(o.maxRowHeight, usableY / rows);
		const top = o.padTop + (usableY - rowHeight * rows) / 2;
		const centre = (first + last) / 2;
		return places.map((p) => ({
			x: (left + right) / 2 + (p.column - centre) * unit,
			y: top + rowHeight * (p.row + .5)
		}));
	}
	/**
	* A tree (laid out as forestLayout does) on the left, and the vertices `aside` (BFS: not
	* reached yet) in a compact group on the right: a grid, column by column, at ASIDE_GAP
	* px, vertically centred. With nothing aside, the tree has the whole width.
	*/
	function treeLayout(places, aside, bounds, options = {}) {
		const o = {
			...FOREST_DEFAULTS,
			...options
		};
		if (aside === 0) return {
			tree: forestLayout(places, bounds, o),
			aside: []
		};
		const usableY = Math.max(0, bounds.height - o.padTop - o.padBottom);
		const perColumn = Math.max(1, Math.floor(usableY / 64) + 1);
		const columns = Math.ceil(aside / perColumn);
		const rows = Math.min(aside, perColumn);
		const right = bounds.width - o.padX;
		const groupLeft = Math.max(bounds.width / 2, right - (columns - 1) * 64);
		const gapX = columns > 1 ? (right - groupLeft) / (columns - 1) : 0;
		const top = o.padTop + (usableY - (rows - 1) * 64) / 2;
		const group = [];
		for (let i = 0; i < aside; i++) {
			const [c, r] = [Math.floor(i / perColumn), i % perColumn];
			group.push({
				x: groupLeft + c * gapX,
				y: top + r * 64
			});
		}
		return {
			tree: forestLayout(places, bounds, {
				...o,
				right: Math.max(o.padX, groupLeft - 56 - 32)
			}),
			aside: group
		};
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
	function halfEllipse(a, b, bulge, trimStart, trimEnd, segments = 40) {
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const len = Math.hypot(dx, dy);
		const m = {
			x: (a.x + b.x) / 2,
			y: (a.y + b.y) / 2
		};
		if (len < 1e-6) return {
			d: `M ${a.x} ${a.y}`,
			mid: m
		};
		const rx = len / 2;
		const ry = Math.max(-rx, Math.min(rx, bulge));
		const ux = dx / len;
		const uy = dy / len;
		const nx = uy;
		const ny = -ux;
		const at = (t) => ({
			x: m.x - ux * rx * Math.cos(t) + nx * ry * Math.sin(t),
			y: m.y - uy * rx * Math.cos(t) + ny * ry * Math.sin(t)
		});
		const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
		const solve = (from, lo, hi, target, rising) => {
			for (let i = 0; i < 40; i++) {
				const midT = (lo + hi) / 2;
				if (dist(at(midT), from) < target === rising) lo = midT;
				else hi = midT;
			}
			return (lo + hi) / 2;
		};
		const apex = at(Math.PI / 2);
		const t0 = dist(apex, a) <= trimStart ? Math.PI / 2 : solve(a, 0, Math.PI / 2, trimStart, true);
		const t1 = dist(apex, b) <= trimEnd ? Math.PI / 2 : solve(b, Math.PI / 2, Math.PI, trimEnd, false);
		const points = [];
		for (let i = 0; i <= segments; i++) {
			const p = at(t0 + (t1 - t0) * i / segments);
			points.push(`${round$1(p.x)} ${round$1(p.y)}`);
		}
		return {
			d: `M ${points.join(" L ")}`,
			mid: apex
		};
	}
	function round$1(v) {
		return Math.round(v * 100) / 100;
	}
	const DEFAULT_STEP = 7;
	const PAD = 1e9;
	/** Distance from (px, py) to the segment a–b. */
	function segmentDistance$1(px, py, ax, ay, bx, by) {
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
	function field(dIn, dOut, mode, needBoth = false) {
		if (mode === "empty") return 60;
		if (mode === "all") return -60;
		if (dIn === Infinity) return 60;
		if (dOut === Infinity) return needBoth ? 60 : -60;
		return dIn - dOut;
	}
	/**
	* The territory of S, and its border, for the blend `t` between two cuts (t = 1, or
	* `from` equal to `to`, for a single cut).
	*/
	function cutShape(features, bounds, options) {
		const { t, from, to } = options;
		const step = options.step ?? DEFAULT_STEP;
		const w = Math.max(bounds.width, 1);
		const h = Math.max(bounds.height, 1);
		const nx = Math.max(1, Math.ceil(w / step));
		const ny = Math.max(1, Math.ceil(h / step));
		const sx = w / nx;
		const sy = h / ny;
		const cols = nx + 3;
		const rows = ny + 3;
		const value = new Float64Array(cols * rows).fill(PAD);
		const index = (i, j) => (j + 1) * cols + (i + 1);
		const n = features.length;
		const ax = new Float64Array(n);
		const ay = new Float64Array(n);
		const bx = new Float64Array(n);
		const by = new Float64Array(n);
		const fromIn = new Uint8Array(n);
		const fromOut = new Uint8Array(n);
		const toIn = new Uint8Array(n);
		const toOut = new Uint8Array(n);
		const seedOf = new Uint8Array(n);
		features.forEach((f, k) => {
			ax[k] = f.a.x;
			ay[k] = f.a.y;
			bx[k] = (f.b ?? f.a).x;
			by[k] = (f.b ?? f.a).y;
			fromIn[k] = +(f.from === "in");
			fromOut[k] = +(f.from === "out");
			toIn[k] = +(f.to === "in");
			toOut[k] = +(f.to === "out");
			seedOf[k] = +(f.from === "in" || !!f.seed);
		});
		const grows = features.every((f) => f.from !== "in" || f.to === "in") && seedOf.some((x) => x === 1);
		/** The old field, the new one, and the distance to the front's seeds, at a point. */
		const scratch = /* @__PURE__ */ new Float64Array(3);
		const sample = (px, py) => {
			let fIn = Infinity;
			let fOut = Infinity;
			let tIn = Infinity;
			let tOut = Infinity;
			let seed = Infinity;
			for (let k = 0; k < n; k++) {
				if (!(toIn[k] | toOut[k] | fromIn[k] | fromOut[k] | seedOf[k])) continue;
				const d = segmentDistance$1(px, py, ax[k], ay[k], bx[k], by[k]);
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
		let r0 = Infinity;
		let r1 = -Infinity;
		for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
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
		const sweep = grows && to !== "empty" && r0 <= r1 && Number.isFinite(r1);
		const radius = r0 - .5 + (r1 - r0 + 1) * t;
		/** The field drawn at blend t. */
		const blend = (fo, fn, sd) => {
			if (t >= 1) return fn;
			if (t <= 0) return fo;
			if (sweep) return Math.max(fn, Math.min(fo, sd - radius));
			return (1 - t) * fo + t * fn;
		};
		for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
			const at = index(i, j);
			value[at] = blend(oldF[at], newF[at], seedD[at]);
		}
		const exact = (px, py) => {
			const [fo, fn, sd] = sample(px, py);
			return blend(fo, fn, sd);
		};
		const xOf = (i) => i * sx;
		const yOf = (j) => j * sy;
		const inner = (i, j) => i >= 0 && j >= 0 && i <= nx && j <= ny;
		const crossing = /* @__PURE__ */ new Map();
		const crossAt = (i, j, horizontal) => {
			const id = index(i, j) * 2 + (horizontal ? 0 : 1);
			if (!crossing.has(id)) {
				const [i2, j2] = horizontal ? [i + 1, j] : [i, j + 1];
				const f1 = value[index(i, j)];
				const f2 = value[index(i2, j2)];
				const [x1, y1, x2, y2] = [
					xOf(i),
					yOf(j),
					xOf(i2),
					yOf(j2)
				];
				let s = f1 / (f1 - f2);
				if (inner(i, j) && inner(i2, j2)) {
					let lo = 0;
					let hi = 1;
					for (let k = 0; k < 7; k++) {
						if (exact(x1 + (x2 - x1) * s, y1 + (y2 - y1) * s) < 0 === f1 < 0) lo = s;
						else hi = s;
						s = (lo + hi) / 2;
					}
				}
				crossing.set(id, {
					x: x1 + (x2 - x1) * s,
					y: y1 + (y2 - y1) * s
				});
			}
			return id;
		};
		const segA = [];
		const segB = [];
		const segPad = [];
		for (let j = -1; j <= ny; j++) for (let i = -1; i <= nx; i++) {
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
			const add = (p, q) => {
				segA.push(p);
				segB.push(q);
				segPad.push(pad);
			};
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
				case 10: if (centreIn) {
					add(L(), T());
					add(R(), B());
				} else {
					add(T(), R());
					add(B(), L());
				}
			}
		}
		const at = /* @__PURE__ */ new Map();
		for (let s = 0; s < segA.length; s++) for (const id of [segA[s], segB[s]]) {
			const list = at.get(id);
			if (list) list.push(s);
			else at.set(id, [s]);
		}
		const used = new Uint8Array(segA.length);
		const region = [];
		const border = [];
		for (let start = 0; start < segA.length; start++) {
			if (used[start]) continue;
			const ids = [segA[start]];
			const pads = [];
			let s = start;
			let id = segB[start];
			for (;;) {
				used[s] = 1;
				pads.push(segPad[s]);
				ids.push(id);
				const next = (at.get(id) ?? []).find((x) => !used[x]);
				if (next === void 0) break;
				id = segA[next] === id ? segB[next] : segA[next];
				s = next;
			}
			const points = ids.map((c) => crossing.get(c));
			region.push(points.slice(0, -1));
			const firstPad = pads.indexOf(true);
			if (firstPad < 0) {
				border.push(points);
				continue;
			}
			let run = [];
			for (let k = 1; k <= pads.length; k++) {
				const seg = (firstPad + k) % pads.length;
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
		return {
			region,
			border
		};
	}
	/**
	* The borders between groups of features (seams): where the nearest group changes — the
	* Voronoi borders of the groups. Each group's territory is traced against all the others
	* together (as a cut), and of its border only the parts facing a later group are kept,
	* so each seam is traced once. Fewer than two groups have none.
	*/
	function groupSeams(features, bounds, step) {
		const groups = [...new Set(features.map((f) => f.group))].sort((x, y) => x - y);
		if (groups.length < 2) return [];
		const distanceTo = (p, group) => {
			let d = Infinity;
			for (const f of features) {
				if (f.group !== group) continue;
				const b = f.b ?? f.a;
				d = Math.min(d, segmentDistance$1(p.x, p.y, f.a.x, f.a.y, b.x, b.y));
			}
			return d;
		};
		/** The group nearest to p other than `group`. */
		const across = (p, group) => {
			let best = Infinity;
			let nearest = group;
			for (const h of groups) {
				if (h === group) continue;
				const d = distanceTo(p, h);
				if (d < best) [best, nearest] = [d, h];
			}
			return nearest;
		};
		const seams = [];
		for (const group of groups) {
			const cut = features.map((f) => {
				const side = f.group === group ? "in" : "out";
				return {
					a: f.a,
					b: f.b,
					from: side,
					to: side
				};
			});
			for (const line of cutShape(cut, bounds, {
				t: 1,
				from: "split",
				to: "split",
				step
			}).border) {
				let run = [];
				for (let k = 1; k < line.length; k++) {
					const [p, q] = [line[k - 1], line[k]];
					if (across({
						x: (p.x + q.x) / 2,
						y: (p.y + q.y) / 2
					}, group) > group) {
						if (!run.length) run.push(p);
						run.push(q);
					} else {
						if (run.length > 1) seams.push(run);
						run = [];
					}
				}
				if (run.length > 1) seams.push(run);
			}
		}
		return seams;
	}
	/** SVG path data for closed loops. */
	function loopsPath(loops) {
		return loops.map((ps) => `M ${ps.map((p) => `${round(p.x)} ${round(p.y)}`).join(" L ")} Z`).join(" ");
	}
	/** SVG path data for open polylines. */
	function polylinesPath(lines) {
		return lines.map((ps) => `M ${ps.map((p) => `${round(p.x)} ${round(p.y)}`).join(" L ")}`).join(" ");
	}
	function round(v) {
		return Math.round(v * 100) / 100;
	}
	// src/random-graph.ts
	/**
	* Up to `count` points inside `area`, at least `gap` apart. Fewer when the area runs out
	* of room (it gives up after a fixed number of tries per point).
	*/
	function randomPositions(count, area, gap, rand) {
		const points = [];
		const w = Math.max(0, area.right - area.left);
		const h = Math.max(0, area.bottom - area.top);
		for (let tries = 0; points.length < count && tries < count * 200; tries++) {
			const p = {
				x: area.left + rand() * w,
				y: area.top + rand() * h
			};
			if (points.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= gap)) points.push(p);
		}
		return points;
	}
	/** How many nodes fit comfortably in `area` with centres `gap` apart (between `min` and `max`). */
	function nodeCountFor(area, gap, min = 5, max = 10) {
		const cells = (area.right - area.left) * (area.bottom - area.top) / (gap * gap * 2.2);
		return Math.max(min, Math.min(max, Math.floor(cells)));
	}
	/** Random arcs between `points` (indices into the array); see the module comment. */
	function randomArcs(points, rand, options) {
		const n = points.length;
		const { clearance } = options;
		const maxWeight = options.maxWeight ?? 20;
		const bothWays = options.directed ? options.bothWays ?? .25 : 0;
		const weight = () => {
			if (!options.weighted) return 0;
			const magnitude = 1 + Math.floor(rand() * maxWeight);
			return options.negative && rand() < .5 ? -magnitude : magnitude;
		};
		const extra = Math.round(n * (options.extraPerNode ?? .5));
		const pairs = [];
		for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if (!points.some((p, k) => k !== a && k !== b && segmentDistance(p, points[a], points[b]) < clearance)) pairs.push({
			a,
			b,
			length: Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y)
		});
		const parent = points.map((_, i) => i);
		const find = (i) => parent[i] === i ? i : parent[i] = find(parent[i]);
		const jittered = pairs.map((p) => ({
			...p,
			key: p.length * (.7 + .6 * rand())
		})).sort((p, q) => p.key - q.key);
		const chosen = [];
		const rest = [];
		for (const p of jittered) {
			const [ra, rb] = [find(p.a), find(p.b)];
			if (ra !== rb) {
				parent[ra] = rb;
				chosen.push(p);
			} else rest.push(p);
		}
		const crosses = (p) => chosen.some((q) => q.a !== p.a && q.a !== p.b && q.b !== p.a && q.b !== p.b && segmentsCross(points[p.a], points[p.b], points[q.a], points[q.b]));
		let added = 0;
		for (const p of rest) {
			if (added >= extra) break;
			if (rand() < .6 && !crosses(p)) {
				chosen.push(p);
				added++;
			}
		}
		return chosen.flatMap(({ a, b }) => {
			if (rand() < bothWays) return [{
				from: a,
				to: b,
				weight: weight()
			}, {
				from: b,
				to: a,
				weight: weight()
			}];
			const [from, to] = rand() < .5 ? [a, b] : [b, a];
			return [{
				from,
				to,
				weight: weight()
			}];
		});
	}
	/** Distance from p to the segment a–b. */
	function segmentDistance(p, a, b) {
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const len2 = dx * dx + dy * dy;
		const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
		return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
	}
	/** True if the segments p1–p2 and q1–q2 properly cross. */
	function segmentsCross(p1, p2, q1, q2) {
		const side = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
		return side(p1, p2, q1) * side(p1, p2, q2) < 0 && side(q1, q2, p1) * side(q1, q2, p2) < 0;
	}
	// src/editor.ts
	const SVG_NS = "http://www.w3.org/2000/svg";
	/** Pointer travel (px) before a press on a node becomes a drag instead of a click. */
	const DRAG_THRESHOLD = 4;
	/** Pixels per "line" for wheel events reported in lines (deltaMode 1). */
	const LINE_HEIGHT_PX = 16;
	/** An algorithm's label inside a node: base font size and the width it may use. */
	const SIM_LABEL_FONT = 14;
	const SIM_LABEL_WIDTH = 32;
	/** Arc diagram: how long vertices take to glide into line, and edges to bend into / out of arcs. */
	const ARRANGE_MS = 750;
	/** How long a cut's border takes to move to its new place when the cut changes. */
	const CUT_MS = 650;
	/** How a weighting is named in messages. */
	const WEIGHTING_NAMES = {
		unweighted: "unweighted",
		weighted: "weighted",
		positive: "positive-weighted"
	};
	/** Numbers the editors' clip paths apart (an id must be unique on the page). */
	let clipIds = 0;
	const BEND_MS = 450;
	/** In the forest view, how far a curved edge bulges, as a share of its half length. */
	const FOREST_BULGE = .6;
	/** …and at most (px). */
	const FOREST_MAX_BULGE = 110;
	/** How far an edge from the tree to the vertices set aside sags, as a share of its half length. */
	const ASIDE_SAG = .2;
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
	var GraphEditor = class {
		svg;
		graph;
		callbacks;
		selected = null;
		/** While an algorithm runs: no structural edits (dragging nodes is still allowed). */
		locked = false;
		/** Algorithm state to draw (current vertex, finished vertices, active edges). */
		highlight = null;
		pending = null;
		cursor = null;
		/** Edge the wheel last adjusted, and the fractional weight change not yet applied to it. */
		wheelEdge = null;
		wheelCarry = 0;
		layout = new ForceLayout({ padding: 22 });
		autoLayout = false;
		frame = null;
		/** Arc diagram state, and the tweens that move vertices into line and bend the edges. */
		arc = null;
		/** 0 = edges straight, 1 = full arcs. */
		bend = 0;
		/**
		* Switching straight from one arrangement to the other: the one before, so each edge's
		* bulge can blend from its old shape to its new one over `morphTween` (0 → 1).
		*/
		arcBefore = null;
		morph = 1;
		morphTween = null;
		bendTween = null;
		moveTween = null;
		tweenFrame = null;
		/** An algorithm's cut, drawn under everything: one side's territory and the border. */
		cutLayer;
		cutRegion;
		cutBorder;
		/**
		* The borders between S's groups (Kruskal: between trees), clipped to S's territory
		* (cutClip): those of the groups before the latest change fade out (cutSeamsFrom) as
		* those after fade in (cutSeamsTo).
		*/
		cutClip;
		cutSeamsFrom;
		cutSeamsTo;
		/** The geometry the cut was last drawn for, to skip redrawing it when nothing moved. */
		cutKey = "";
		/** The geometry the seams were last traced for (they don't depend on cutT). */
		seamKey = "";
		/** The seams before the latest change, while they fade out ('' when they stay as they were). */
		seamsFromPath = "";
		/**
		* The cut being drawn: its S before (cutFrom) and after (cutTo) the latest change, and
		* how far the border has moved between them (cutT, 0 → 1). null: no cut.
		*/
		cutFrom = null;
		cutTo = null;
		/** The group of each vertex of S (its smallest vertex), before and after; null: one group. */
		cutGroupsFrom = null;
		cutGroupsTo = null;
		cutT = 1;
		cutTween = null;
		edgeLayer;
		previewLine;
		nodeLayer;
		nodeEls = /* @__PURE__ */ new Map();
		edgeEls = /* @__PURE__ */ new Map();
		constructor(svg, graph, callbacks = {}) {
			this.svg = svg;
			this.graph = graph;
			this.callbacks = callbacks;
			this.cutLayer = svgEl("g", {
				class: "cut",
				"aria-hidden": "true"
			});
			this.cutRegion = svgEl("path", { class: "cut-region" });
			this.cutBorder = svgEl("path", { class: "cut-border" });
			const clipId = `cut-clip-${++clipIds}`;
			const clip = svgEl("clipPath", { id: clipId });
			this.cutClip = svgEl("path", { "clip-rule": "evenodd" });
			clip.append(this.cutClip);
			this.cutSeamsFrom = svgEl("path", { class: "cut-seam" });
			this.cutSeamsTo = svgEl("path", { class: "cut-seam" });
			const seams = svgEl("g", { "clip-path": `url(#${clipId})` });
			seams.append(this.cutSeamsFrom, this.cutSeamsTo);
			this.cutLayer.append(clip, this.cutRegion, seams, this.cutBorder);
			this.edgeLayer = svgEl("g", { class: "edges" });
			this.previewLine = svgEl("line", { class: "preview-line" });
			this.nodeLayer = svgEl("g", { class: "nodes" });
			svg.append(arrowDefs(), this.cutLayer, this.edgeLayer, this.previewLine, this.nodeLayer);
			svg.addEventListener("pointerdown", this.onPointerDown);
			svg.addEventListener("pointermove", this.onPointerMove);
			svg.addEventListener("pointerup", this.onPointerUp);
			svg.addEventListener("pointercancel", this.onPointerCancel);
			svg.addEventListener("pointerleave", this.onPointerLeave);
			svg.addEventListener("contextmenu", this.onContextMenu);
			svg.addEventListener("wheel", this.onWheel, { passive: false });
			window.addEventListener("keydown", this.onKeyDown);
			window.addEventListener("resize", this.onResize);
			this.render();
		}
		/** Removes every node and edge. */
		clear() {
			this.graph.clear();
			this.selected = null;
			this.pending = null;
			this.render();
			this.changed();
			this.message("Graph cleared. Click empty space to add a node.");
		}
		/**
		* Randomise: on an empty canvas, scatters a handful of nodes and connects them; with
		* nodes already placed, keeps them where they are and replaces their edges with a
		* random set. The graph is random for the current mode: directed graphs may join a
		* pair both ways; weighted ones get weights from −20 to 20 (never 0), positive ones
		* from 1 to 20, and unweighted ones weight 0. It is still stored as weighted directed
		* arcs, as every edge is. See random-graph.ts.
		*/
		randomise(rand = Math.random) {
			if (this.locked) return;
			const fresh = this.graph.nodeCount === 0;
			if (fresh) {
				const area = this.freeArea();
				const gap = 96;
				for (const p of randomPositions(nodeCountFor(area, gap), area, gap, rand)) this.graph.addNode(p.x, p.y);
			}
			const nodes = this.graph.getNodes();
			this.graph.clearEdges();
			const { directed, weighted, weighting } = this.graph;
			const arcs = randomArcs(nodes, rand, {
				clearance: 26,
				directed,
				weighted,
				negative: weighting === "weighted"
			});
			for (const arc of arcs) this.graph.addEdge(nodes[arc.from].id, nodes[arc.to].id, arc.weight);
			this.selected = null;
			this.pending = null;
			this.render();
			this.changed();
			const m = this.graph.edgeCount;
			const edges = `${m} edge${m === 1 ? "" : "s"}`;
			const kind = `${directed ? "directed" : "undirected"}, ${WEIGHTING_NAMES[weighting]}`;
			if (fresh) this.message(`Random ${kind} graph: ${nodes.length} nodes and ${edges}.`);
			else if (nodes.length < 2) this.message("Randomise needs at least two nodes to connect.", "warn");
			else this.message(`Random ${kind} edges between the ${nodes.length} nodes: ${edges}.`);
		}
		/** The canvas minus a node's margin and the overlays at the top and bottom. */
		freeArea() {
			const rect = this.svg.getBoundingClientRect();
			const insets = this.callbacks.canvasInsets?.() ?? {
				top: 0,
				bottom: 0
			};
			const pad = 32;
			const top = Math.min(rect.height / 2, insets.top + 20);
			const bottom = Math.max(top, rect.height - Math.min(rect.height / 2, insets.bottom));
			return {
				left: pad,
				top: Math.max(pad, top),
				right: Math.max(pad, rect.width - pad),
				bottom: Math.max(pad, bottom - pad)
			};
		}
		/** The selected node, if any (e.g. the start vertex for an algorithm). */
		get selectedNode() {
			return this.selected;
		}
		get isLocked() {
			return this.locked;
		}
		/**
		* Locks the graph while an algorithm runs: clicks no longer add, connect, select or
		* delete anything, and weights cannot be scrolled. Nodes can still be dragged.
		*/
		setLocked(locked) {
			if (locked === this.locked) return;
			this.locked = locked;
			this.selected = null;
			this.svg.classList.toggle("locked", locked);
			this.render();
		}
		/** Draws an algorithm's state on the graph, or clears it with null. */
		setHighlight(highlight) {
			this.highlight = highlight;
			this.svg.classList.toggle("sim-labels", !!highlight?.labels);
			this.svg.classList.toggle("sim-compact", !!highlight?.compact);
			this.svg.classList.toggle("sim-active-dashed", !!highlight?.activeDashed);
			if (!highlight) this.setPeek(null);
			this.setCut(highlight?.cut ? new Set(highlight.cut) : null, highlight?.cutGroups);
			this.render();
		}
		/**
		* Takes the highlight's cut (and S's groups, if given). When it changes, the border
		* moves continuously to its new place (CUT_MS) instead of jumping; a cut appearing grows
		* from nothing.
		*/
		setCut(next, groups) {
			if (!next) {
				this.cutFrom = this.cutTo = null;
				this.cutGroupsFrom = this.cutGroupsTo = null;
				this.cutTween = null;
				this.cutT = 1;
				return;
			}
			const nextGroups = groups ? new Map(groups.flatMap((group) => group.map((id) => [id, Math.min(...group)]))) : null;
			const prev = this.cutTo;
			const prevGroups = this.cutGroupsTo;
			const sameGroups = prevGroups === null === (nextGroups === null) && (!nextGroups || prevGroups.size === nextGroups.size && [...nextGroups].every(([id, g]) => prevGroups.get(id) === g));
			if (prev && prev.size === next.size && [...next].every((id) => prev.has(id)) && sameGroups) return;
			this.cutFrom = prev ?? /* @__PURE__ */ new Set();
			this.cutTo = next;
			this.cutGroupsFrom = prev ? prevGroups : null;
			this.cutGroupsTo = nextGroups;
			if (prefersReducedMotion$4()) {
				this.cutTween = null;
				this.cutT = 1;
				return;
			}
			this.cutT = 0;
			this.cutTween = {
				from: 0,
				to: 1,
				start: performance.now(),
				duration: CUT_MS
			};
			this.startTweens();
		}
		/**
		* Temporarily changes what the vertices show while the pointer is over (or focus is in)
		* a side-panel strip or panel. CSS crossfades, and grows compact vertices back:
		*  - 'ids': the vertex ids (instead of an algorithm's labels, such as BFS distances);
		*  - 'labels': the algorithm's labels (Prim's keys, hidden while vertices are compact);
		*  - null: back to normal.
		*/
		setPeek(mode) {
			this.svg.classList.toggle("peek-ids", mode === "ids");
			this.svg.classList.toggle("peek-labels", mode === "labels");
		}
		get directed() {
			return this.graph.directed;
		}
		/**
		* Switches between treating the graph as directed or undirected. The stored arcs never
		* change; only how they are drawn, counted and represented does.
		*/
		setDirected(directed) {
			if (directed === this.graph.directed) return;
			this.graph.directed = directed;
			this.render();
			this.callbacks.onChange?.();
			if (this.graph.weighted) this.kickLayout(.5);
			this.message(directed ? "Directed: clicking A then B adds an edge A → B." : "Undirected: edge directions are ignored; arcs both ways count as one edge.");
		}
		get weighted() {
			return this.graph.weighted;
		}
		get weighting() {
			return this.graph.weighting;
		}
		/** setWeighting('weighted') or setWeighting('unweighted'). */
		setWeighted(weighted) {
			this.setWeighting(weighted ? "weighted" : "unweighted");
		}
		/**
		* Shows the graph as weighted (weight labels; scroll over an edge to change its weight),
		* positive (the same, each weight read as its magnitude) or unweighted. Changing the
		* mode never changes the stored weights.
		*/
		setWeighting(weighting) {
			if (weighting === this.graph.weighting) return;
			this.graph.weighting = weighting;
			this.render();
			this.callbacks.onChange?.();
			this.kickLayout();
			this.message(weighting === "weighted" ? "Weighted: scroll over an edge to change its weight (up = more)." : weighting === "positive" ? "Positive: every weight counts as its magnitude (−5 as 5). Scroll over an edge to change it (up = more)." : "Unweighted: weights are hidden and every edge counts as weight 1.");
		}
		get autoLayoutEnabled() {
			return this.autoLayout;
		}
		/** Turns the force-directed auto-layout on or off. Nodes stay where they are when turned off. */
		setAutoLayout(enabled) {
			if (enabled === this.autoLayout) return;
			this.autoLayout = enabled;
			this.callbacks.onAutoLayoutChange?.(enabled);
			if (enabled) {
				this.leaveArcDiagram();
				this.kickLayout();
				this.message("Auto-layout on: drag a node to nudge the layout.");
			} else {
				this.layout.stop();
				if (this.frame !== null) cancelAnimationFrame(this.frame);
				this.frame = null;
				this.message("Auto-layout off: nodes stay where you put them.");
			}
		}
		/** Whether an arrangement (DFS's topological sort or its forest) is shown. */
		get arcDiagramActive() {
			return this.arc !== null && !this.arc.leaving;
		}
		/** Which arrangement is shown: the topological sort's line, the forest, or neither. */
		get arrangement() {
			return this.arcDiagramActive ? this.arc.kind : null;
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
		showArcDiagram(diagram) {
			if (!diagram) {
				this.leaveArcDiagram();
				return;
			}
			const keys = (pairs) => new Set(pairs.map(([a, b]) => this.edgeKey(a, b, this.graph.directed)));
			this.enterArrangement({
				kind: "line",
				highlightSpine: true,
				diagram,
				forest: null,
				rank: new Map(diagram.order.map((id, i) => [id, i])),
				aside: /* @__PURE__ */ new Set(),
				spine: keys(diagram.spine),
				below: keys([...diagram.below, ...diagram.backward ?? []]),
				backward: keys(diagram.backward ?? []),
				maxBulge: 0,
				leaving: false
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
		showForest(forest, kind = "forest") {
			const keys = (pairs) => new Set(pairs.map(([a, b]) => this.edgeKey(a, b, this.graph.directed)));
			this.enterArrangement({
				kind,
				highlightSpine: forest.highlightSpine ?? true,
				diagram: null,
				forest,
				rank: /* @__PURE__ */ new Map(),
				aside: new Set(forest.aside ?? []),
				spine: keys(forest.spine),
				below: /* @__PURE__ */ new Set(),
				backward: /* @__PURE__ */ new Set(),
				maxBulge: FOREST_MAX_BULGE,
				leaving: false
			});
		}
		/** Starts showing `next`, blending the edges over from the arrangement shown before, if any. */
		enterArrangement(next) {
			this.setAutoLayout(false);
			const before = this.arc;
			if (before && this.bend > 0 && !prefersReducedMotion$4()) {
				before.leaving = true;
				this.arcBefore = before;
				this.morph = 0;
				this.morphTween = {
					from: 0,
					to: 1,
					start: performance.now(),
					duration: ARRANGE_MS
				};
			} else {
				this.arcBefore = null;
				this.morph = 1;
				this.morphTween = null;
			}
			this.arc = next;
			this.svg.classList.add("arc-diagram");
			this.svg.classList.toggle("forest-view", next.kind !== "line");
			this.placeArcDiagram(true);
			this.tweenBend(1);
		}
		leaveArcDiagram() {
			if (!this.arc || this.arc.leaving) return;
			this.arc.leaving = true;
			this.moveTween = null;
			this.finishMorph();
			this.svg.classList.remove("arc-diagram", "forest-view");
			this.render();
			this.tweenBend(0);
		}
		/** Moves the vertices to their places in the arrangement (gliding there if `animate`). */
		placeArcDiagram(animate) {
			const arc = this.arc;
			const rect = this.svg.getBoundingClientRect();
			const bounds = {
				width: rect.width,
				height: rect.height
			};
			const insets = this.callbacks.canvasInsets?.();
			const pads = insets ? {
				padTop: insets.top,
				padBottom: insets.bottom
			} : {};
			let to;
			if (arc.kind !== "line") {
				const places = arc.forest.places.filter((p) => this.graph.getNode(p.id));
				const aside = (arc.forest.aside ?? []).filter((id) => this.graph.getNode(id));
				const { tree, aside: group } = treeLayout(places, aside.length, bounds, pads);
				to = new Map([...places.map((p, i) => [p.id, tree[i]]), ...aside.map((id, i) => [id, group[i]])]);
			} else {
				const order = arc.diagram.order.filter((id) => this.graph.getNode(id));
				const { positions, maxBulge } = rowLayout(order.length, bounds, pads);
				arc.maxBulge = maxBulge;
				to = new Map(order.map((id, i) => [id, positions[i]]));
			}
			const order = [...to.keys()];
			if (animate && !prefersReducedMotion$4()) {
				const from = new Map(order.map((id) => [id, { ...this.graph.getNode(id) }]));
				this.moveTween = {
					from,
					to,
					start: performance.now(),
					duration: ARRANGE_MS
				};
				this.startTweens();
			} else {
				this.moveTween = null;
				for (const [id, p] of to) this.graph.moveNode(id, p.x, p.y);
				this.render();
			}
		}
		tweenBend(target) {
			if (prefersReducedMotion$4()) {
				this.bendTween = null;
				this.bend = target;
				if (target === 0 && this.arc?.leaving) this.arc = null;
				this.render();
				return;
			}
			this.bendTween = {
				from: this.bend,
				to: target,
				start: performance.now(),
				duration: target > 0 ? ARRANGE_MS : BEND_MS
			};
			this.startTweens();
		}
		startTweens() {
			if (this.tweenFrame === null) this.tweenFrame = requestAnimationFrame(this.tweenTick);
		}
		tweenTick = () => {
			this.tweenFrame = null;
			const now = performance.now();
			const progress = (t) => easeInOut(Math.min(1, Math.max(0, (now - t.start) / t.duration)));
			if (this.moveTween) {
				const k = progress(this.moveTween);
				const dragged = this.pending?.kind === "node" && this.pending.dragging ? this.pending.id : null;
				for (const [id, to] of this.moveTween.to) {
					const from = this.moveTween.from.get(id);
					if (id === dragged || !this.graph.getNode(id)) continue;
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
		finishMorph() {
			this.arcBefore = null;
			this.morph = 1;
			this.morphTween = null;
		}
		onPointerDown = (e) => {
			if (e.button !== 0 || this.pending) return;
			const p = this.toLocal(e);
			const target = e.target;
			const nodeEl = target.closest("[data-node-id]");
			const edgeEl = target.closest("[data-edge-a]");
			if (nodeEl) {
				const id = Number(nodeEl.dataset.nodeId);
				const node = this.graph.getNode(id);
				if (!node) return;
				this.pending = {
					kind: "node",
					id,
					start: p,
					offset: {
						x: node.x - p.x,
						y: node.y - p.y
					},
					dragging: false
				};
			} else if (edgeEl) this.pending = {
				kind: "edge",
				a: Number(edgeEl.dataset.edgeA),
				b: Number(edgeEl.dataset.edgeB),
				start: p
			};
			else this.pending = {
				kind: "background",
				start: p
			};
			this.svg.setPointerCapture(e.pointerId);
			e.preventDefault();
		};
		onPointerMove = (e) => {
			const p = this.toLocal(e);
			this.cursor = p;
			const pending = this.pending;
			if (pending?.kind === "node") {
				if (!pending.dragging && distance(p, pending.start) > DRAG_THRESHOLD) {
					pending.dragging = true;
					this.svg.classList.add("dragging");
				}
				if (pending.dragging) {
					const pos = this.clampToCanvas({
						x: p.x + pending.offset.x,
						y: p.y + pending.offset.y
					});
					this.graph.moveNode(pending.id, pos.x, pos.y);
					this.render();
					this.kickLayout(.5);
					return;
				}
			}
			this.updatePreview();
		};
		onPointerUp = (e) => {
			const pending = this.pending;
			this.pending = null;
			if (!pending) return;
			const p = this.toLocal(e);
			const moved = distance(p, pending.start) > DRAG_THRESHOLD;
			if (this.locked && !(pending.kind === "node" && pending.dragging)) {
				if (!moved) this.message("The graph is locked while the algorithm runs. Press Stop to edit it.", "warn");
				return;
			}
			switch (pending.kind) {
				case "node":
					if (pending.dragging) {
						this.svg.classList.remove("dragging");
						this.render();
						this.kickLayout();
					} else this.handleNodeClick(pending.id);
					break;
				case "edge":
					if (!moved) this.handleEdgeClick(pending.a, pending.b);
					break;
				case "background": if (!moved) this.handleBackgroundClick(p);
			}
		};
		onPointerCancel = () => {
			this.pending = null;
			this.svg.classList.remove("dragging");
			this.render();
			this.kickLayout();
		};
		/**
		* Weighted mode: scrolling over an edge changes its weight linearly, WEIGHT_PER_PAGE per
		* page of scrolling (up = increase). Weights stay whole numbers: the fractional part is
		* carried over to the next wheel event on the same edge.
		*/
		onWheel = (e) => {
			if (this.locked || !this.graph.weighted || e.ctrlKey) return;
			const edgeEl = e.target.closest("[data-edge-a]");
			if (!edgeEl) return;
			e.preventDefault();
			const a = Number(edgeEl.dataset.edgeA);
			const b = Number(edgeEl.dataset.edgeB);
			const key = `${this.graph.directed ? "d" : "u"}:${a}-${b}`;
			if (key !== this.wheelEdge) {
				this.wheelEdge = key;
				this.wheelCarry = 0;
			}
			const page = window.innerHeight || 800;
			const px = e.deltaMode === 1 ? e.deltaY * LINE_HEIGHT_PX : e.deltaMode === 2 ? e.deltaY * page : e.deltaY;
			this.wheelCarry += -px / page * 15;
			const steps = Math.trunc(this.wheelCarry + Math.sign(this.wheelCarry) * 1e-9);
			if (steps === 0) return;
			this.wheelCarry -= steps;
			const current = this.graph.currentView.weight(a, b);
			if (current === void 0) return;
			const next = this.graph.weighting === "positive" ? Math.max(0, current + steps) : current + steps;
			if (next === current) return;
			this.graph.setWeight(a, b, next);
			this.render();
			this.callbacks.onChange?.();
			this.kickLayout(.5);
			this.message(`Weight of edge ${this.edgeLabel(a, b)}: ${next}`);
		};
		onResize = () => {
			this.kickLayout();
			if (this.arcDiagramActive) this.placeArcDiagram(false);
		};
		onPointerLeave = () => {
			if (this.pending) return;
			this.cursor = null;
			this.updatePreview();
		};
		onContextMenu = (e) => {
			const nodeEl = e.target.closest("[data-node-id]");
			if (!nodeEl) return;
			e.preventDefault();
			if (this.locked) {
				this.message("The graph is locked while the algorithm runs. Press Stop to edit it.", "warn");
				return;
			}
			this.deleteNode(Number(nodeEl.dataset.nodeId));
		};
		onKeyDown = (e) => {
			if (this.selected === null) return;
			if (e.key === "Escape") {
				this.select(null);
				this.message("Selection cleared.");
			} else if (e.key === "Delete" || e.key === "Backspace") {
				e.preventDefault();
				this.deleteNode(this.selected);
			}
		};
		handleNodeClick(id) {
			if (this.selected === null) {
				this.select(id);
				this.message(this.graph.directed ? `Node ${id} selected — click another node to add an edge from ${id} to it, or empty space to cancel.` : `Node ${id} selected — click another node to connect it, or empty space to cancel.`);
				return;
			}
			if (this.selected === id) {
				this.select(null);
				this.message("Selection cleared.");
				return;
			}
			const from = this.selected;
			if (this.graph.hasEdge(from, id)) {
				this.message(this.graph.directed ? `Edge ${from} → ${id} already exists.` : `Nodes ${from} and ${id} are already connected.`, "warn");
				return;
			}
			this.graph.addEdge(from, id);
			this.select(null);
			this.changed();
			this.message(this.graph.weighted ? `Added edge ${this.edgeLabel(from, id)} with weight 0. Scroll over it to change the weight.` : `Added edge ${this.edgeLabel(from, id)}.`);
		}
		handleEdgeClick(a, b) {
			if (!this.graph.removeEdge(a, b)) return;
			this.render();
			this.changed();
			this.message(`Removed edge ${this.edgeLabel(a, b)}.`);
		}
		edgeLabel(a, b) {
			return this.graph.directed ? `${a} → ${b}` : `${a} — ${b}`;
		}
		handleBackgroundClick(p) {
			if (this.selected !== null) {
				this.select(null);
				this.message("Selection cleared.");
				return;
			}
			const pos = this.clampToCanvas(p);
			const blocker = this.graph.getNodes().find((n) => distance(n, pos) < 46);
			if (blocker) {
				this.message(`Too close to node ${blocker.id} — click a little further away.`, "warn");
				return;
			}
			const node = this.graph.addNode(pos.x, pos.y);
			this.render();
			this.changed();
			this.message(`Added node ${node.id}.`);
		}
		deleteNode(id) {
			if (!this.graph.removeNode(id)) return;
			if (this.selected === id) this.selected = null;
			this.render();
			this.changed();
			this.message(`Removed node ${id} and its edges.`);
		}
		select(id) {
			this.selected = id;
			this.render();
		}
		render() {
			const directed = this.graph.directed;
			const weighted = this.graph.weighted;
			const view = this.graph.currentView;
			this.svg.classList.toggle("directed", directed);
			this.svg.classList.toggle("weighted", weighted);
			const liveEdges = /* @__PURE__ */ new Set();
			const explored = this.highlight?.exploredEdges ? new Map(this.highlight.exploredEdges.map((e) => [this.edgeKey(e.from, e.to, directed), e])) : null;
			const arc = this.arc;
			for (const [a, b] of this.graph.getEdges()) {
				const bend = directed && this.graph.hasArc(b, a) ? this.pairBend(a, b) : 0;
				const curved = bend > 0;
				const key = this.edgeKey(a, b, directed);
				const arcs = arc !== null && (arc.kind !== "line" || this.arcBefore !== null || !this.straightSpine(arc, a, b, key));
				const shape = curved || arcs ? "path" : "line";
				liveEdges.add(key);
				let g = this.edgeEls.get(key);
				if (g && g.dataset.shape !== shape) {
					g.remove();
					g = void 0;
				}
				if (!g) {
					g = svgEl("g", { class: "edge" });
					g.dataset.edgeA = String(a);
					g.dataset.edgeB = String(b);
					g.dataset.shape = shape;
					const label = svgEl("g", { class: "edge-weight" });
					label.append(svgEl("rect", {
						rx: 9,
						height: 18
					}), svgEl("text", {
						"text-anchor": "middle",
						"dominant-baseline": "central"
					}));
					const tag = svgEl("g", { class: "edge-tag" });
					tag.append(svgEl("rect", {
						rx: 8,
						height: 16
					}), svgEl("text", {
						"text-anchor": "middle",
						"dominant-baseline": "central"
					}));
					g.append(svgEl(shape, { class: "edge-hit" }), svgEl(shape, { class: "edge-line" }), label, tag, svgEl("title", {}));
					this.edgeLayer.append(g);
					this.edgeEls.set(key, g);
				}
				const { attrs, mid } = arcs ? this.arcGeometry(this.graph.getNode(a), this.graph.getNode(b), directed, key) : this.edgeGeometry(this.graph.getNode(a), this.graph.getNode(b), directed, curved, bend);
				g.classList.toggle("sim-active", this.isActiveEdge(a, b, directed));
				g.classList.toggle("sim-spine", arc !== null && !arc.leaving && arc.highlightSpine && arc.spine.has(key));
				g.classList.toggle("sim-backward", arc !== null && !arc.leaving && arc.backward.has(key));
				g.classList.toggle("sim-unexplored", explored !== null && !explored.has(key));
				g.classList.toggle("sim-explored", explored?.has(key) ?? false);
				g.classList.toggle("sim-tree", explored?.get(key)?.done ?? false);
				g.classList.toggle("sim-crossing", explored?.get(key)?.crossing ?? false);
				g.classList.toggle("sim-within", explored?.get(key)?.within ?? false);
				g.classList.toggle("sim-degenerate", explored?.get(key)?.degenerate ?? false);
				g.classList.toggle("sim-waiting", explored?.get(key)?.waiting ?? false);
				for (const el of g.querySelectorAll(".edge-hit, .edge-line")) setAttrs(el, attrs);
				const tag = explored?.get(key)?.label ?? "";
				if (tag) {
					g.dataset.tag = tag;
					const tagWidth = 12 + tag.length * 6.4;
					g.querySelector(".edge-tag text").textContent = tag;
					setAttrs(g.querySelector(".edge-tag text"), {
						x: mid.x,
						y: mid.y
					});
					setAttrs(g.querySelector(".edge-tag rect"), {
						x: mid.x - tagWidth / 2,
						y: mid.y - 8,
						width: tagWidth
					});
				} else delete g.dataset.tag;
				const weight = view.weight(a, b);
				const text = String(weight);
				const width = 10 + text.length * 7.5;
				g.querySelector(".edge-weight text").textContent = text;
				setAttrs(g.querySelector(".edge-weight text"), {
					x: mid.x,
					y: mid.y
				});
				setAttrs(g.querySelector(".edge-weight rect"), {
					x: mid.x - width / 2,
					y: mid.y - 9,
					width
				});
				g.dataset.weight = text;
				g.querySelector("title").textContent = weighted ? `Edge ${this.edgeLabel(a, b)}, weight ${weight} (scroll to change the weight, click to delete)` : `Edge ${this.edgeLabel(a, b)} (click to delete)`;
			}
			for (const [key, g] of this.edgeEls) if (!liveEdges.has(key)) {
				g.remove();
				this.edgeEls.delete(key);
			}
			const liveNodes = /* @__PURE__ */ new Set();
			for (const node of this.graph.getNodes()) {
				liveNodes.add(node.id);
				let g = this.nodeEls.get(node.id);
				if (!g) {
					g = svgEl("g", { class: "node" });
					g.dataset.nodeId = String(node.id);
					const label = svgEl("text", {
						class: "node-index",
						"text-anchor": "middle",
						"dominant-baseline": "central"
					});
					label.textContent = String(node.id);
					const simLabel = svgEl("text", {
						class: "sim-label",
						"text-anchor": "middle",
						"dominant-baseline": "central"
					});
					g.append(svgEl("circle", { r: 20 }), label, simLabel);
					this.nodeLayer.append(g);
					this.nodeEls.set(node.id, g);
				}
				g.setAttribute("transform", `translate(${node.x} ${node.y})`);
				g.classList.toggle("selected", node.id === this.selected);
				g.classList.toggle("sim-current", this.highlight?.current === node.id);
				g.classList.toggle("sim-done", this.highlight?.done.includes(node.id) ?? false);
				g.classList.toggle("sim-running", this.highlight?.running?.includes(node.id) ?? false);
				const simLabel = g.querySelector(".sim-label");
				const text = this.highlight?.labels?.[node.id] ?? "";
				simLabel.textContent = text;
				const size = fitFontSize(text, SIM_LABEL_WIDTH, SIM_LABEL_FONT);
				simLabel.style.fontSize = size < SIM_LABEL_FONT ? `${size}px` : "";
			}
			for (const [id, g] of this.nodeEls) if (!liveNodes.has(id)) {
				g.remove();
				this.nodeEls.delete(id);
			}
			this.svg.classList.toggle("has-selection", this.selected !== null);
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
		renderCut() {
			const to = this.cutTo;
			if (!to) {
				this.cutKey = this.seamKey = this.seamsFromPath = "";
				this.svg.classList.remove("has-cut", "cut-moving");
				for (const path of [
					this.cutRegion,
					this.cutBorder,
					this.cutClip,
					this.cutSeamsFrom,
					this.cutSeamsTo
				]) path.removeAttribute("d");
				return;
			}
			const from = this.cutFrom ?? to;
			const fromGroups = this.cutFrom ? this.cutGroupsFrom : this.cutGroupsTo;
			const toGroups = this.cutGroupsTo;
			const t = this.cutTween ? this.cutT : 1;
			const nodes = this.graph.getNodes();
			const edgesOnly = !!this.highlight?.cutEdgesOnly;
			const sideIn = (set, id) => set.has(id) ? "in" : "out";
			/** The group of a vertex of S (one group, 0, when S is not split). */
			const groupOfVertex = (groups, id) => groups ? groups.get(id) ?? id : 0;
			/** The group of an edge with both ends in one group of S (null otherwise). */
			const groupOf = (set, groups, a, b) => {
				if (!set.has(a) || !set.has(b)) return null;
				const ga = groupOfVertex(groups, a);
				return ga === groupOfVertex(groups, b) ? ga : null;
			};
			const edgeSide = (set, groups, a, b) => !set.has(a) && !set.has(b) ? "out" : groupOf(set, groups, a, b) !== null ? "in" : null;
			const oldGroups = new Set([...from].filter((id) => to.has(id)).map((id) => groupOfVertex(toGroups, id)));
			const newGroup = (id) => toGroups !== null && !oldGroups.has(groupOfVertex(toGroups, id));
			const touchesFrom = /* @__PURE__ */ new Set();
			for (const [a, b] of this.graph.getEdges()) {
				if (from.has(a)) touchesFrom.add(b);
				if (from.has(b)) touchesFrom.add(a);
			}
			const features = [];
			/** Each feature's group before and after (null: not in S). */
			const featureGroups = [];
			if (!edgesOnly) for (const node of nodes) {
				const joins = !from.has(node.id) && to.has(node.id);
				features.push({
					a: node,
					from: sideIn(from, node.id),
					to: sideIn(to, node.id),
					seed: joins && (toGroups ? newGroup(node.id) : !touchesFrom.has(node.id))
				});
				featureGroups.push({
					from: from.has(node.id) ? groupOfVertex(fromGroups, node.id) : null,
					to: to.has(node.id) ? groupOfVertex(toGroups, node.id) : null
				});
			}
			for (const [a, b] of this.graph.getEdges()) {
				const f = edgeSide(from, fromGroups, a, b);
				const g = edgeSide(to, toGroups, a, b);
				if (!f && !g) continue;
				const seed = f !== "in" && g === "in" && (toGroups ? newGroup(a) : edgesOnly && !from.has(a) && !from.has(b));
				features.push({
					a: this.graph.getNode(a),
					b: this.graph.getNode(b),
					from: f,
					to: g,
					seed
				});
				featureGroups.push({
					from: groupOf(from, fromGroups, a, b),
					to: groupOf(to, toGroups, a, b)
				});
			}
			const modeOf = (set, which) => {
				const inside = nodes.filter((n) => set.has(n.id)).length;
				if (inside === nodes.length) return inside === 0 ? "empty" : "all";
				if (!edgesOnly) return inside === 0 ? "empty" : "split";
				const groups = new Set(featureGroups.map((g) => g[which]).filter((g) => g !== null));
				if (groups.size === 0) return "empty";
				if (!features.some((f) => f[which] === "out")) return groups.size > 1 ? "all" : "empty";
				return "split";
			};
			const toMode = modeOf(to, "to");
			const fromMode = modeOf(from, "from");
			const rect = this.svg.getBoundingClientRect();
			const bounds = {
				width: rect.width,
				height: rect.height
			};
			const where = features.map((f) => `${f.a.x},${f.a.y},${f.b?.x},${f.b?.y}`);
			const seamsOf = (which) => polylinesPath(groupSeams(features.flatMap((f, k) => {
				const group = featureGroups[k][which];
				return group === null ? [] : [{
					a: f.a,
					b: f.b,
					group
				}];
			}), bounds));
			const seamKey = [
				rect.width,
				rect.height,
				...featureGroups.map((g, k) => `${where[k]},${g.from},${g.to}`)
			].join("|");
			let seamsTo = this.cutSeamsTo.getAttribute("d") ?? "";
			if (seamKey !== this.seamKey) {
				this.seamKey = seamKey;
				seamsTo = seamsOf("to");
				this.cutSeamsTo.setAttribute("d", seamsTo);
				const seamsFrom = t < 1 ? seamsOf("from") : "";
				this.seamsFromPath = seamsFrom === seamsTo ? "" : seamsFrom;
			}
			const fading = t < 1 && this.seamsFromPath !== "";
			this.cutSeamsFrom.setAttribute("d", fading ? this.seamsFromPath : "");
			this.cutSeamsFrom.style.opacity = fading ? String(1 - t) : "";
			this.cutSeamsTo.style.opacity = fading ? String(t) : "";
			this.svg.classList.toggle("has-cut", toMode === "split" || t < 1 || toMode === "all" && seamsTo !== "");
			this.svg.classList.toggle("cut-moving", t < 1);
			const key = [
				rect.width,
				rect.height,
				t,
				...features.map((f, k) => `${where[k]},${f.from},${f.to}`)
			].join("|");
			if (key === this.cutKey) return;
			this.cutKey = key;
			const { region, border } = cutShape(features, bounds, {
				t,
				from: fromMode,
				to: toMode,
				needBoth: edgesOnly
			});
			const regionPath = loopsPath(region);
			this.cutRegion.setAttribute("d", regionPath);
			this.cutClip.setAttribute("d", regionPath);
			this.cutBorder.setAttribute("d", polylinesPath(border));
		}
		/** The key of the drawn edge a → b (undirected: between a and b), as used in edgeEls. */
		edgeKey(a, b, directed) {
			return directed ? `${a}>${b}` : `${Math.min(a, b)}-${Math.max(a, b)}`;
		}
		/** Is the edge a → b (undirected: between a and b) one the algorithm highlights? */
		isActiveEdge(a, b, directed) {
			return (this.highlight?.activeEdges ?? []).some(([x, y]) => x === a && y === b || !directed && x === b && y === a);
		}
		/**
		* SVG attributes for an edge from a to b (see render() for the three cases), and the
		* point midway along it, where the weight label goes.
		*/
		edgeGeometry(a, b, directed, curved, bend = 44) {
			const centre = {
				x: (a.x + b.x) / 2,
				y: (a.y + b.y) / 2
			};
			if (!directed) return {
				attrs: {
					x1: a.x,
					y1: a.y,
					x2: b.x,
					y2: b.y
				},
				mid: centre
			};
			const len = Math.max(distance(a, b), .001);
			const ux = (b.x - a.x) / len;
			const uy = (b.y - a.y) / len;
			const rim = 21;
			if (!curved) return {
				attrs: {
					x1: a.x,
					y1: a.y,
					x2: b.x - ux * rim,
					y2: b.y - uy * rim
				},
				mid: centre
			};
			const c = {
				x: (a.x + b.x) / 2 - uy * bend,
				y: (a.y + b.y) / 2 + ux * bend
			};
			const toward = (from, to, by) => {
				const d = Math.max(distance(from, to), .001);
				return {
					x: from.x + (to.x - from.x) / d * by,
					y: from.y + (to.y - from.y) / d * by
				};
			};
			const start = toward(a, c, 20);
			const end = toward(b, c, rim);
			const mid = {
				x: (a.x + 2 * c.x + b.x) / 4,
				y: (a.y + 2 * c.y + b.y) / 4
			};
			return {
				attrs: { d: `M ${start.x} ${start.y} Q ${c.x} ${c.y} ${end.x} ${end.y}` },
				mid
			};
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
		pairBend(a, b) {
			if (!this.graph.weighted) return 44;
			const view = this.graph.currentView;
			const here = Math.abs(view.weight(a, b) ?? 0);
			const back = Math.abs(view.weight(b, a) ?? 0);
			if (here === back) return 44;
			if (here < back) return 0;
			return Math.max(44, .2 * distance(this.graph.getNode(a), this.graph.getNode(b))) * (1 + 2 * (here - back) / (here + back));
		}
		/**
		* The weights the auto-layout gives edge lengths in proportion to: none when unweighted
		* (every edge the same ideal length). Weighted or positive, each pair's magnitude:
		* directed, the average of the two arcs' (one arc: its own); undirected, the edge's weight.
		*/
		layoutWeight() {
			if (!this.graph.weighted) return void 0;
			const view = this.graph.currentView;
			if (!this.graph.directed) return (a, b) => Math.abs(view.weight(a, b) ?? 0);
			return (a, b) => {
				const arcs = [view.weight(a, b), view.weight(b, a)].filter((w) => w !== void 0).map(Math.abs);
				return arcs.length ? arcs.reduce((sum, w) => sum + w, 0) / arcs.length : 0;
			};
		}
		/**
		* An edge of an arrangement, as a half ellipse from a to b bulging the edge's way (see
		* bulgeIn), scaled by the current bend (0 = straight). While switching arrangements,
		* the bulge blends from the old arrangement's to the new one's.
		*/
		arcGeometry(a, b, directed, key) {
			let bulge = this.bulgeIn(this.arc, key, a, b);
			if (this.arcBefore) bulge = this.bulgeIn(this.arcBefore, key, a, b) * (1 - this.morph) + bulge * this.morph;
			const { d, mid } = halfEllipse(a, b, bulge * this.bend, 20, directed ? 21 : 20);
			return {
				attrs: { d },
				mid
			};
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
		bulgeIn(arc, key, from, to) {
			const radius = distance(from, to) / 2;
			const [a, b] = key.split(/[>-]/).map(Number);
			if (arc.kind !== "line") {
				if (arc.spine.has(key)) return 0;
				if (arc.aside.has(a) !== arc.aside.has(b)) return (from.x > to.x ? 1 : -1) * Math.min(radius * ASIDE_SAG, 60);
				const bulge = Math.min(radius * FOREST_BULGE, arc.maxBulge);
				if (arc.aside.has(a)) return (to.y > from.y ? -1 : 1) * bulge;
				return bulge;
			}
			if (this.straightSpine(arc, a, b, key)) return 0;
			const rightward = (arc.rank.get(a) ?? 0) <= (arc.rank.get(b) ?? 0);
			return (arc.below.has(key) === rightward ? -1 : 1) * Math.min(radius, arc.maxBulge);
		}
		/** Line arrangement: a spine edge between neighbouring vertices, which lies on the line. */
		straightSpine(arc, a, b, key) {
			return arc.kind === "line" && arc.spine.has(key) && Math.abs(arc.rank.get(a) - arc.rank.get(b)) === 1;
		}
		/** Dashed line from the selected node to the cursor while choosing an edge target. */
		updatePreview() {
			const from = this.selected === null ? void 0 : this.graph.getNode(this.selected);
			if (!from || !this.cursor) {
				this.previewLine.style.display = "none";
				return;
			}
			this.previewLine.style.display = "";
			setAttrs(this.previewLine, {
				x1: from.x,
				y1: from.y,
				x2: this.cursor.x,
				y2: this.cursor.y
			});
		}
		/** (Re)starts the auto-layout animation if it is enabled. */
		kickLayout(temperature = 1) {
			if (!this.autoLayout) return;
			this.layout.reheat(temperature);
			if (this.frame === null) this.frame = requestAnimationFrame(this.layoutFrame);
		}
		layoutFrame = () => {
			this.frame = null;
			if (!this.autoLayout) return;
			const rect = this.svg.getBoundingClientRect();
			const bounds = {
				width: rect.width,
				height: rect.height
			};
			const pinned = /* @__PURE__ */ new Set();
			if (this.pending?.kind === "node" && this.pending.dragging) pinned.add(this.pending.id);
			const steps = prefersReducedMotion$4() ? 1e3 : 1;
			const weight = this.layoutWeight();
			for (let i = 0; i < steps && this.layout.running; i++) this.layout.step(this.graph, bounds, pinned, weight);
			this.render();
			if (this.layout.running) this.frame = requestAnimationFrame(this.layoutFrame);
		};
		toLocal(e) {
			const rect = this.svg.getBoundingClientRect();
			return {
				x: e.clientX - rect.left,
				y: e.clientY - rect.top
			};
		}
		clampToCanvas(p) {
			const rect = this.svg.getBoundingClientRect();
			const pad = 22;
			return {
				x: Math.min(Math.max(p.x, pad), Math.max(pad, rect.width - pad)),
				y: Math.min(Math.max(p.y, pad), Math.max(pad, rect.height - pad))
			};
		}
		/** The graph's structure changed: notify listeners and re-run the layout. */
		changed() {
			this.callbacks.onChange?.();
			this.kickLayout();
		}
		message(text, tone = "info") {
			this.callbacks.onMessage?.(text, tone);
		}
	};
	/**
	* Arrowhead markers for directed mode: normal, hovered (delete), the preview line,
	* algorithm-highlighted edges, and the topological sort's backward edges.
	*/
	function arrowDefs() {
		const defs = svgEl("defs", {});
		for (const id of [
			"arrow",
			"arrow-hover",
			"arrow-preview",
			"arrow-active",
			"arrow-done",
			"arrow-backward"
		]) {
			const marker = svgEl("marker", {
				id,
				viewBox: "0 0 10 10",
				refX: 10,
				refY: 5,
				markerWidth: 11,
				markerHeight: 11,
				markerUnits: "userSpaceOnUse",
				orient: "auto"
			});
			marker.append(svgEl("path", {
				d: "M 0 0 L 10 5 L 0 10 z",
				class: `${id}-head`
			}));
			defs.append(marker);
		}
		return defs;
	}
	function easeInOut(t) {
		return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
	}
	function prefersReducedMotion$4() {
		return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
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
		for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
	}
	// src/representations.ts
	/**
	* Renders the two standard graph representations shown in the ☰ panel: the adjacency
	* list and the adjacency matrix, with a left/right switch between them. The renderers
	* take a read-only GraphView, so they can show either the directed or the undirected
	* reading of the graph.
	*/
	const EMPTY = "No nodes yet.";
	/**
	* Renders the adjacency list as boxes: a column of vertex boxes on the left, then, after
	* a gap, each vertex's neighbours as boxes joined left to right (like an array).
	* Built from nested lists so screen readers announce "Neighbours of 0, 2 items" etc.
	*/
	function renderAdjacencyList(target, view, focus = null) {
		const rows = view.weightedAdjacencyList();
		if (rows.length === 0) {
			const empty = document.createElement("p");
			empty.className = "adj-empty";
			empty.textContent = EMPTY;
			target.replaceChildren(empty);
			return;
		}
		const list = document.createElement("ul");
		list.className = view.weighted ? "adj-list weighted" : "adj-list";
		list.setAttribute("aria-label", "Adjacency list");
		const digits = Math.max(...rows.map((r) => String(r.id).length), ...view.weighted ? rows.flatMap((r) => r.neighbors.map((n) => String(n.weight).length)) : []);
		list.style.setProperty("--adj-cell", `${Math.max(28, 12 + digits * 9)}px`);
		for (const { id, neighbors } of rows) {
			const row = document.createElement("li");
			row.className = "adj-row";
			const vertex = document.createElement("span");
			vertex.className = "adj-vertex";
			vertex.textContent = String(id);
			const focusRow = focus !== null && focus.from === id;
			if (focusRow) markFocus(vertex);
			const chain = document.createElement("ul");
			chain.className = "adj-neighbors";
			chain.setAttribute("aria-label", `${view.directed ? "Out-neighbours" : "Neighbours"} of ${id}`);
			for (const n of neighbors) {
				const box = document.createElement("li");
				box.className = "adj-box";
				if (focusRow && n.id === focus.to) markFocus(box);
				const idEl = document.createElement("span");
				idEl.className = "adj-id";
				idEl.textContent = String(n.id);
				box.append(idEl);
				if (view.weighted) {
					const weightEl = document.createElement("span");
					weightEl.className = "adj-weight";
					weightEl.textContent = String(n.weight);
					weightEl.setAttribute("aria-label", `weight ${n.weight}`);
					box.append(weightEl);
				}
				chain.append(box);
			}
			row.append(vertex, chain);
			if (neighbors.length === 0) {
				const none = document.createElement("span");
				none.className = "adj-none";
				none.setAttribute("aria-hidden", "true");
				none.textContent = "∅";
				row.append(none);
			}
			list.append(row);
		}
		target.replaceChildren(list);
	}
	/** Renders the adjacency matrix as a table with node ids as row and column headers. */
	function renderAdjacencyMatrix(target, view, focus = null) {
		const { ids, matrix } = view.weighted ? view.weightMatrix() : view.adjacencyMatrix();
		if (ids.length === 0) {
			const empty = document.createElement("p");
			empty.className = "matrix-empty";
			empty.textContent = EMPTY;
			target.replaceChildren(empty);
			return;
		}
		const table = document.createElement("table");
		table.className = "matrix";
		table.setAttribute("aria-label", "Adjacency matrix");
		const headRow = document.createElement("tr");
		const corner = document.createElement("td");
		corner.className = "corner";
		headRow.append(corner);
		for (const id of ids) headRow.append(cell("th", String(id), { scope: "col" }));
		table.createTHead().append(headRow);
		const body = table.createTBody();
		matrix.forEach((row, i) => {
			const tr = document.createElement("tr");
			tr.append(cell("th", String(ids[i]), { scope: "row" }));
			row.forEach((value, j) => {
				const present = view.weighted ? value !== null : value === 1;
				const td = cell("td", value === null ? "—" : String(value));
				if (present) td.classList.add("on");
				if (i === j) td.classList.add("diag");
				if (focus !== null && ids[i] === focus.from && ids[j] === focus.to) markFocus(td);
				tr.append(td);
			});
			body.append(tr);
		});
		target.replaceChildren(table);
	}
	/** Picks out an element as the focus edge's (white, as the edge on the canvas). */
	function markFocus(el) {
		el.classList.add("sim-focus");
		el.setAttribute("aria-current", "true");
	}
	function cell(tag, text, attrs = {}) {
		const el = document.createElement(tag);
		el.textContent = text;
		for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
		return el;
	}
	/**
	* Wires a tab list (ARIA tabs pattern): clicking a tab, or Left/Right/Home/End while one
	* is focused, selects it and shows its panel (the element named by aria-controls).
	*/
	function setupTabs(tablist) {
		const tabs = [...tablist.querySelectorAll("[role=\"tab\"]")];
		const select = (index, focus) => {
			tabs.forEach((tab, i) => {
				const selected = i === index;
				tab.setAttribute("aria-selected", String(selected));
				tab.tabIndex = selected ? 0 : -1;
				document.getElementById(tab.getAttribute("aria-controls"))?.toggleAttribute("hidden", !selected);
			});
			if (focus) tabs[index].focus();
		};
		tabs.forEach((tab, i) => {
			tab.addEventListener("click", () => select(i, false));
			tab.addEventListener("keydown", (e) => {
				const next = {
					ArrowRight: (i + 1) % tabs.length,
					ArrowLeft: (i - 1 + tabs.length) % tabs.length,
					Home: 0,
					End: tabs.length - 1
				};
				if (e.key in next) {
					e.preventDefault();
					select(next[e.key], true);
				}
			});
		});
	}
	// src/favicon.ts
	/**
	* Keeps the favicon in step with the page's colour scheme. The page switches between its
	* light and dark palettes with `prefers-color-scheme`, so the favicon follows the same
	* media query, including when it changes while the page is open.
	*
	* index.html declares the icon links with `data-favicon="svg" | "png"`; their href is
	* pointed at icons/favicon-<light|dark>.<svg|png>.
	*/
	const darkScheme = window.matchMedia("(prefers-color-scheme: dark)");
	function syncFavicon() {
		const theme = darkScheme.matches ? "dark" : "light";
		for (const link of document.querySelectorAll("link[data-favicon]")) {
			const href = `./icons/favicon-${theme}.${link.dataset.favicon}`;
			if (link.getAttribute("href") !== href) link.setAttribute("href", href);
		}
	}
	function followColorScheme() {
		syncFavicon();
		darkScheme.addEventListener("change", syncFavicon);
	}
	// src/collapsible.ts
	/**
	* Collapsible cards: a title button (`aria-expanded`, `aria-controls`) shows or hides the
	* element it controls. Each card's state is remembered per browser (localStorage) under
	* its `data-collapse-key`, so a card collapsed once stays collapsed after a reload.
	*/
	const STORAGE_PREFIX = "bfs-graph-builder.collapsed.";
	function load(key) {
		try {
			const value = localStorage.getItem(STORAGE_PREFIX + key);
			return value === null ? null : value === "true";
		} catch {
			return null;
		}
	}
	function save(key, collapsed) {
		try {
			localStorage.setItem(STORAGE_PREFIX + key, String(collapsed));
		} catch {}
	}
	function setupCollapsible(toggle, onChange) {
		const body = document.getElementById(toggle.getAttribute("aria-controls"));
		const key = toggle.dataset.collapseKey;
		const set = (expanded) => {
			toggle.setAttribute("aria-expanded", String(expanded));
			body.toggleAttribute("hidden", !expanded);
		};
		const remembered = key ? load(key) : null;
		if (remembered !== null) set(!remembered);
		toggle.addEventListener("click", () => {
			const expanded = toggle.getAttribute("aria-expanded") !== "true";
			set(expanded);
			if (key) save(key, !expanded);
			onChange?.();
		});
	}
	// src/algorithms/tidy-tree.ts
	/**
	* Places a tree, given by each vertex's parent (the root's is null), as a tidy tree for
	* "Show as tree": rows by depth (the root on row 0); leaves two column units apart, in the
	* order a depth-first walk meets them (children in the order they appear in `parent`);
	* each parent centred over its first and last child. Vertices not connected to `root`
	* through `parent` are left out, and so is any loop in `parent` (a negative-weight cycle
	* can make Bellman–Ford's predecessors loop, even back to the root): each vertex is
	* placed once. Pure.
	*/
	function tidyTree(root, parent) {
		const children = /* @__PURE__ */ new Map();
		for (const [v, u] of parent) {
			if (u === null) continue;
			children.set(u, [...children.get(u) ?? [], v]);
		}
		const places = [];
		const placed = /* @__PURE__ */ new Set([root]);
		let slot = 0;
		const place = (v, row) => {
			const kids = (children.get(v) ?? []).filter((kid) => !placed.has(kid));
			for (const kid of kids) placed.add(kid);
			let column;
			if (kids.length === 0) column = 2 * slot++;
			else {
				const cols = kids.map((kid) => place(kid, row + 1));
				column = (cols[0] + cols[cols.length - 1]) / 2;
			}
			places.push({
				id: v,
				column,
				row
			});
			return column;
		};
		place(root, 0);
		return places;
	}
	// src/algorithms/bfs.ts
	/**
	* Breadth-first search from a single source, one queue pop per step.
	*
	* The display always shows what the *next* step will do:
	*  - white: the vertex at the front of the queue (popped next step), and the edges that
	*    step will travel — from it to its not-yet-discovered neighbours;
	*  - green: vertices already popped (finished);
	*  - solid edges: the predecessor edges (v.π, v) of the vertices discovered so far — the
	*    breadth-first tree G_π (CLRS §20.2), each drawn as soon as v is discovered. Every
	*    other edge is dashed.
	*
	* Each step pops the front vertex (it turns green), then discovers its undiscovered
	* neighbours and appends them to the queue in ascending id order (views return sorted
	* neighbours, so runs are deterministic). The new front vertex turns white.
	*
	* Vertices are labelled with their shortest-path length from the source as soon as they
	* are discovered (BFS discovers every vertex at its final distance).
	*
	* `searchTree()` gives the breadth-first tree found so far, for "Show as tree": each
	* vertex on the row of its distance, laid out as a tidy tree (children left to right in
	* discovery order, each parent centred over its children), and the vertices not reached
	* yet set aside.
	*
	* Right after creation the source is the only vertex in the queue, so it is already
	* white. A source with n reachable vertices finishes after exactly n steps; vertices not
	* reachable from it are never discovered.
	*/
	var BfsSimulation = class {
		view;
		source;
		queue;
		/** Vertices that have been put in the queue (including those already popped). */
		discovered;
		/** Vertices that have been popped. */
		popped = /* @__PURE__ */ new Set();
		lastPopped = null;
		lastDiscovered = [];
		/** Pop order so far. */
		order = [];
		/** BFS tree: discovered vertex → the vertex it was discovered from (source → null). */
		parent = /* @__PURE__ */ new Map();
		/** Edges (number of hops) from the source to each discovered vertex. */
		distance = /* @__PURE__ */ new Map();
		constructor(view, source) {
			this.view = view;
			this.source = source;
			this.queue = [source];
			this.discovered = /* @__PURE__ */ new Set([source]);
			this.parent.set(source, null);
			this.distance.set(source, 0);
		}
		/** True once the queue is empty: every reachable vertex has been popped. */
		get finished() {
			return this.queue.length === 0;
		}
		/** The vertices in the queue, front (next to be popped) first. */
		get queued() {
			return [...this.queue];
		}
		step() {
			const v = this.queue.shift();
			if (v === void 0) return false;
			this.popped.add(v);
			this.order.push(v);
			this.lastPopped = v;
			this.lastDiscovered = [];
			for (const w of this.view.neighbors(v)) {
				if (this.discovered.has(w)) continue;
				this.discovered.add(w);
				this.parent.set(w, v);
				this.distance.set(w, this.distance.get(v) + 1);
				this.queue.push(w);
				this.lastDiscovered.push(w);
			}
			return true;
		}
		/** Undiscovered neighbours of the front vertex: what the next step will push, in order. */
		incoming() {
			const next = this.queue[0];
			return next === void 0 ? [] : this.view.neighbors(next).filter((w) => !this.discovered.has(w));
		}
		highlight() {
			const next = this.queue[0] ?? null;
			return {
				current: next,
				done: [...this.popped],
				activeEdges: next === null ? [] : this.incoming().map((w) => [next, w]),
				labels: Object.fromEntries([...this.distance].map(([id, d]) => [id, String(d)])),
				exploredEdges: [...this.parent].filter((entry) => entry[1] !== null).map(([v, u]) => ({
					from: u,
					to: v
				}))
			};
		}
		/**
		* The breadth-first tree G_π so far (CLRS §20.2), as a tidy tree: rows by distance from
		* the source; leaves two column units apart, in the order a depth-first walk of the tree
		* meets them (children in discovery order); each parent centred over its first and last
		* child. Undiscovered vertices go `aside`. Tree edges are not highlighted white (white
		* is the next step's), but are straight; every other edge curves.
		*/
		searchTree() {
			return {
				places: tidyTree(this.source, this.parent),
				spine: [...this.parent].filter((entry) => entry[1] !== null).map(([v, u]) => [u, v]),
				aside: this.view.nodeIds().filter((id) => !this.discovered.has(id)),
				highlightSpine: false,
				intro: "Breadth-first tree so far: each row is a distance from the start, which is on top; each vertex hangs from the vertex it was discovered from."
			};
		}
		queueSnapshot() {
			return {
				items: [...this.queue],
				incoming: this.incoming()
			};
		}
		describe() {
			const queue = `Queue: ${this.queue.length ? this.queue.join(", ") : "empty"}.`;
			if (this.lastPopped === null) return `BFS from ${this.source}. ${queue} Press Update to pop ${this.source}.`;
			if (this.finished) {
				const total = this.view.nodeIds().length;
				const reached = this.order.length;
				const unreachable = total - reached;
				return `BFS finished: visited ${reached} of ${total} vertices (order ${this.order.join(", ")}).` + (unreachable ? ` ${unreachable} not reachable from ${this.source}.` : "") + " Press Finish.";
			}
			const found = this.lastDiscovered.length ? `discovered ${this.lastDiscovered.join(", ")}` : "nothing new";
			return `Popped ${this.lastPopped}: ${found}. ${queue}`;
		}
	};
	const bfs = {
		id: "bfs",
		name: "Breadth-first search",
		requires: { weighted: false },
		create: (view, start) => new BfsSimulation(view, start)
	};
	// src/algorithms/dfs.ts
	/** How each class is tagged on the canvas (tree edges are left plain). */
	const EDGE_CLASS_LABELS = {
		tree: void 0,
		back: "backward",
		forward: "forward",
		cross: "crossed"
	};
	var DfsSimulation = class {
		view;
		start;
		color = /* @__PURE__ */ new Map();
		/** The recursion stack, bottom first. */
		stack = [];
		/** The outer loop's order: `start`, then every other vertex ascending. */
		roots;
		rootIndex = 0;
		time = 0;
		last = null;
		/** Edge keys already classified (undirected views explore each edge once). */
		seen = /* @__PURE__ */ new Set();
		/** u.d: when each vertex was discovered. */
		discovery = /* @__PURE__ */ new Map();
		/** u.f: when each vertex was finished. */
		finish = /* @__PURE__ */ new Map();
		/** u.π: the depth-first forest (roots → null). */
		parent = /* @__PURE__ */ new Map();
		/** Every explored edge with its class, in the order explored. */
		edges = [];
		/** Tree roots, in the order they were started. */
		trees = [];
		/** Depth of each discovered vertex in the depth-first forest (roots 0). */
		depth = /* @__PURE__ */ new Map();
		constructor(view, start) {
			this.view = view;
			this.start = start;
			const ids = view.nodeIds();
			for (const id of ids) this.color.set(id, "white");
			this.roots = ids.includes(start) ? [start, ...ids.filter((id) => id !== start)] : ids;
		}
		get finished() {
			return this.nextAction() === null;
		}
		/** The recursion stack, top first. */
		get stacked() {
			return this.stack.map((f) => f.id).reverse();
		}
		/** The current time (the last d or f handed out). */
		get clock() {
			return this.time;
		}
		colorOf(id) {
			return this.color.get(id);
		}
		step() {
			const action = this.nextAction();
			if (!action) return false;
			if (action.type === "root") {
				this.rootIndex++;
				this.trees.push(action.v);
				this.parent.set(action.v, null);
				this.discover(action.v);
				this.last = {
					type: "root",
					v: action.v
				};
			} else if (action.type === "edge") {
				const { u, v } = action;
				this.top.next++;
				this.seen.add(this.edgeKey(u, v));
				const kind = this.classify(u, v);
				const edge = {
					from: u,
					to: v,
					kind
				};
				this.edges.push(edge);
				if (kind === "tree") {
					this.parent.set(v, u);
					this.discover(v);
				}
				this.last = {
					type: "edge",
					edge
				};
			} else {
				this.stack.pop();
				this.time++;
				this.finish.set(action.u, this.time);
				this.color.set(action.u, "black");
				this.last = {
					type: "finish",
					u: action.u
				};
			}
			return true;
		}
		highlight() {
			const action = this.nextAction();
			const labels = {};
			for (const [id, d] of this.discovery) labels[id] = `${d},${this.finish.get(id) ?? ""}`;
			return {
				current: action === null ? null : action.type === "root" ? action.v : action.u,
				done: [...this.finish.keys()],
				running: this.stack.map((f) => f.id),
				activeEdges: action?.type === "edge" ? [[action.u, action.v]] : [],
				labels,
				exploredEdges: this.edges.map(({ from, to, kind }) => ({
					from,
					to,
					label: EDGE_CLASS_LABELS[kind]
				}))
			};
		}
		/** Whether a back edge has been found (in a directed graph: it has a cycle). */
		get hasCycle() {
			return this.edges.some((e) => e.kind === "back");
		}
		/**
		* CLRS TOPOLOGICAL-SORT: once DFS is finished, the vertices by decreasing finish time
		* (each finished vertex goes to the front of the list), with the tree edges as the
		* white spine and cross edges arcing below. With no back edge this is a topological
		* order (every edge points left to right). On a cyclic graph it is the same line-up,
		* and exactly the back edges point right to left (`backward`, drawn red). Null until
		* DFS has finished.
		*/
		topologicalSort() {
			if (!this.finished || !this.view.directed) return null;
			const pairs = (kind) => this.edges.filter((e) => e.kind === kind).map((e) => [e.from, e.to]);
			return {
				order: [...this.finish.keys()].sort((a, b) => this.finish.get(b) - this.finish.get(a)),
				spine: pairs("tree"),
				below: pairs("cross"),
				backward: pairs("back")
			};
		}
		/**
		* Once finished, from the topological line-up: DAG shortest paths (CLRS §22.2) from the
		* vertex DFS started at, on this graph — greyed out when DFS found a backward edge, since
		* the graph then has a cycle and no topological order.
		*/
		followUp() {
			if (!this.finished || !this.view.directed) return null;
			const back = this.edges.find((e) => e.kind === "back");
			return {
				label: "Find shortest path for DAG",
				title: `Run DAG shortest paths (CLRS §22.2) from ${this.start}, taking the vertices in this topological order. It switches to Weighted.`,
				algorithm: "dag-shortest-paths",
				start: this.start,
				blocked: back ? `Not a DAG: the backward edge ${back.from} → ${back.to} closes a cycle, so there is no topological order for DAG shortest paths.` : void 0
			};
		}
		/**
		* The depth-first forest G_π found so far (CLRS §20.3: the discovered vertices and the
		* tree edges (v.π, v)), laid out as on the timestamp chart: each vertex on the row of
		* its depth, above the middle of its interval [d, f] — for a vertex still running,
		* [d, now], as its bar on the chart runs up to the current time. Vertices not
		* discovered yet go `aside`. Tree edges are highlighted white only once DFS has
		* finished (until then white is the next step's).
		*/
		searchForest() {
			return {
				places: [...this.discovery].map(([id, d]) => ({
					id,
					column: (d + (this.finish.get(id) ?? this.time)) / 2,
					row: this.depth.get(id)
				})),
				spine: this.edges.filter((e) => e.kind === "tree").map((e) => [e.from, e.to]),
				aside: this.view.nodeIds().filter((id) => !this.discovery.has(id)),
				highlightSpine: this.finished
			};
		}
		/**
		* Each discovered vertex's interval [d, f] (f null while running), on the row of its
		* depth in the forest — so, by the parenthesis theorem, a descendant's interval sits
		* below and inside its ancestor's — plus the clock.
		*/
		timestamps() {
			const action = this.nextAction();
			const current = action === null ? null : action.type === "root" ? action.v : action.u;
			return {
				clock: this.time,
				end: 2 * this.color.size,
				intervals: [...this.discovery].map(([id, start]) => ({
					id,
					start,
					finish: this.finish.get(id) ?? null,
					depth: this.depth.get(id)
				})),
				current: current !== null && this.discovery.has(current) ? current : null
			};
		}
		stackSnapshot() {
			const action = this.nextAction();
			let incoming = [];
			if (action?.type === "root") incoming = [action.v];
			else if (action?.type === "edge" && this.color.get(action.v) === "white") incoming = [action.v];
			return {
				items: this.stacked,
				incoming,
				popping: action?.type === "finish"
			};
		}
		describe() {
			const stack = `Stack: ${this.stack.length ? `${this.stacked.join(", ")} (top first)` : "empty"}.`;
			const last = this.last;
			if (last === null) return `DFS from ${this.start}. Time 0. Press Update to discover ${this.start}.`;
			if (this.finished) {
				const count = (kind) => this.edges.filter((e) => e.kind === kind).length;
				const n = this.discovery.size;
				const trees = this.trees.length;
				return `DFS finished at time ${this.time}: ${n} ${n === 1 ? "vertex" : "vertices"} in ${trees} ${trees === 1 ? "tree" : "trees"}; ${count("tree")} tree, ${count("back")} backward, ${count("forward")} forward, ${count("cross")} crossed edges. ` + (this.hasCycle ? "A backward edge means a cycle, so there is no topological order. Press Topological sort (backward edges in red), Show as forest, or Finish." : "No backward edge, so the graph is acyclic: press Topological sort, Show as forest, or Finish.");
			}
			switch (last.type) {
				case "root": return `${this.trees.length === 1 ? "Discovered" : "New tree: discovered"} ${last.v} at time ${this.discovery.get(last.v)}. ${stack}`;
				case "finish": return `Finished ${last.u} at time ${this.finish.get(last.u)}. ${stack}`;
				case "edge": {
					const { from: u, to: v, kind } = last.edge;
					const edge = `${u} ${this.view.directed ? "→" : "—"} ${v}`;
					const why = {
						tree: `discovered ${v} at time ${this.discovery.get(v)}`,
						back: `${v} is still running (an ancestor of ${u})`,
						forward: `${v} already finished, a descendant of ${u}`,
						cross: `${v} already finished, not a descendant of ${u}`
					}[kind];
					return `${edge} is a ${kind === "tree" ? "tree" : EDGE_CLASS_LABELS[kind]} edge: ${why}. ${stack}`;
				}
			}
		}
		get top() {
			return this.stack[this.stack.length - 1];
		}
		/** DFS-VISIT's first lines: time stamp, colour gray, push. */
		discover(v) {
			const parent = this.parent.get(v) ?? null;
			this.depth.set(v, parent === null ? 0 : this.depth.get(parent) + 1);
			this.time++;
			this.discovery.set(v, this.time);
			this.color.set(v, "gray");
			this.stack.push({
				id: v,
				adj: this.view.neighbors(v),
				next: 0
			});
		}
		classify(u, v) {
			const c = this.color.get(v);
			if (c === "white") return "tree";
			if (c === "gray") return "back";
			return this.discovery.get(u) < this.discovery.get(v) ? "forward" : "cross";
		}
		edgeKey(u, v) {
			return this.view.directed ? `${u}>${v}` : `${Math.min(u, v)}-${Math.max(u, v)}`;
		}
		/**
		* What the next step will do, or null when the search is over. Skips (without
		* counting a step) edges an undirected search has already explored from the other end,
		* and outer-loop vertices that are no longer white.
		*/
		nextAction() {
			const top = this.top;
			if (top) {
				while (top.next < top.adj.length && this.seen.has(this.edgeKey(top.id, top.adj[top.next]))) top.next++;
				if (top.next < top.adj.length) return {
					type: "edge",
					u: top.id,
					v: top.adj[top.next]
				};
				return {
					type: "finish",
					u: top.id
				};
			}
			while (this.rootIndex < this.roots.length && this.color.get(this.roots[this.rootIndex]) !== "white") this.rootIndex++;
			return this.rootIndex < this.roots.length ? {
				type: "root",
				v: this.roots[this.rootIndex]
			} : null;
		}
	};
	const dfs = {
		id: "dfs",
		name: "Depth-first search",
		requires: {
			weighted: false,
			directed: true
		},
		create: (view, start) => new DfsSimulation(view, start)
	};
	// src/algorithms/prim.ts
	var PrimSimulation = class {
		view;
		root;
		/** The min-priority queue's contents (membership; order comes from the keys). */
		inQueue;
		last = null;
		/** v.key: the lightest edge found so far joining v to the tree (Infinity for ∞). */
		key = /* @__PURE__ */ new Map();
		/** v.π: the tree-side end of that edge (null for NIL). */
		parent = /* @__PURE__ */ new Map();
		/** Vertices in the order they were extracted (added to the tree). */
		order = [];
		/** The tree's edges (u.π, u), in the order they were added. */
		treeEdges = [];
		/** The root of each tree: `root`, then one more for every further connected component. */
		roots = [];
		constructor(view, root) {
			this.view = view;
			this.root = root;
			const ids = view.nodeIds();
			for (const id of ids) {
				this.key.set(id, Infinity);
				this.parent.set(id, null);
			}
			if (this.key.has(root)) this.key.set(root, 0);
			this.inQueue = new Set(ids);
		}
		/** True once the queue is empty: every vertex is in the tree (or forest). */
		get finished() {
			return this.inQueue.size === 0;
		}
		/** The queue in extraction order: smallest key first, ties by lowest id. */
		get queued() {
			return [...this.inQueue].sort((a, b) => {
				const [ka, kb] = [this.key.get(a), this.key.get(b)];
				return ka === kb ? a - b : ka < kb ? -1 : 1;
			});
		}
		/**
		* The edges crossing the cut (S, V − S): one end in the tree, the other still in the
		* queue, as [tree end, queue end], in extraction order of the tree end, then by id.
		*/
		crossingEdges() {
			const crossing = [];
			for (const u of this.order) for (const v of this.view.neighbors(u)) if (this.inQueue.has(v)) crossing.push([u, v]);
			return crossing;
		}
		/**
		* Edges with both ends in the tree that are not tree edges (they would close a cycle),
		* as [smaller id, larger id], sorted.
		*/
		withinEdges() {
			const inTree = new Set(this.order);
			const tree = new Set(this.treeEdges.map(({ from, to }) => `${Math.min(from, to)}-${Math.max(from, to)}`));
			const within = [];
			for (const [a, b] of this.view.edges()) if (inTree.has(a) && inTree.has(b) && !tree.has(`${a}-${b}`)) within.push([a, b]);
			return within;
		}
		/** Sum of the tree edges' weights so far. */
		get totalWeight() {
			return this.treeEdges.reduce((sum, e) => sum + e.weight, 0);
		}
		step() {
			const u = this.queued[0];
			if (u === void 0) return false;
			this.inQueue.delete(u);
			this.order.push(u);
			const via = this.parent.get(u);
			if (via === null) this.roots.push(u);
			else this.treeEdges.push({
				from: via,
				to: u,
				weight: this.key.get(u)
			});
			const lowered = [];
			for (const v of this.view.neighbors(u)) {
				const w = this.view.weight(u, v);
				if (this.inQueue.has(v) && w < this.key.get(v)) {
					this.parent.set(v, u);
					this.key.set(v, w);
					lowered.push([v, w]);
				}
			}
			this.last = {
				u,
				via,
				lowered
			};
			return true;
		}
		highlight() {
			const next = this.queued[0] ?? null;
			const via = next === null ? null : this.parent.get(next);
			return {
				current: null,
				compact: true,
				done: [...this.order],
				activeEdges: next !== null && via !== null ? [[via, next]] : [],
				labels: Object.fromEntries([...this.key].map(([id, k]) => [id, formatKey(k)])),
				exploredEdges: [
					...this.treeEdges.map(({ from, to }) => ({
						from,
						to,
						done: true
					})),
					...this.crossingEdges().map(([from, to]) => ({
						from,
						to,
						crossing: true
					})),
					...this.withinEdges().map(([from, to]) => ({
						from,
						to,
						within: true
					}))
				],
				cut: this.order.length > 0 ? [...this.order] : void 0
			};
		}
		priorityQueueSnapshot() {
			return {
				items: this.queued,
				incoming: []
			};
		}
		describe() {
			const last = this.last;
			if (last === null) return `Prim from ${this.root}. Every key is ∞ except ${this.root}'s, which is 0. Press Update to add ${this.root} to the tree.`;
			if (this.finished) {
				const edges = this.treeEdges.length;
				const unit = this.view.weighted ? "" : " (every edge counts as 1)";
				const size = `${edges} ${edges === 1 ? "edge" : "edges"}, total weight ${this.totalWeight}${unit}`;
				return this.roots.length <= 1 ? `Prim finished: a minimum spanning tree of ${size}. Press Finish.` : `Prim finished: the graph is not connected, so this is a minimum spanning forest of ${this.roots.length} trees, ${size}. Press Finish.`;
			}
			const { u, via, lowered } = last;
			let added;
			if (via !== null) added = `Added ${u} by edge ${via} — ${u} (weight ${this.key.get(u)}).`;
			else if (this.roots.length === 1) added = `Added ${u} as the root of the tree.`;
			else added = `${u} has key ∞: no edge joins it to the tree, so it starts a new tree.`;
			const keys = lowered.length ? `Lowered keys: ${lowered.map(([v, k]) => `${v} to ${k}`).join(", ")}.` : "No key changed.";
			return `${added} ${keys} ${this.describeCut()} Tree weight ${this.totalWeight}.`;
		}
		/** The cut after this step: how many edges cross it, and the light edge (white) among them. */
		describeCut() {
			const crossing = this.crossingEdges().length;
			const next = this.queued[0];
			const via = this.parent.get(next);
			if (crossing === 0 || via === null) return `No edge crosses the cut, so ${next} will start a new tree.`;
			return `${crossing === 1 ? "1 edge crosses" : `${crossing} edges cross`} the cut; the light edge is ${via} — ${next} (weight ${this.key.get(next)}).`;
		}
	};
	function formatKey(key) {
		return Number.isFinite(key) ? String(key) : "∞";
	}
	const prim = {
		id: "prim",
		name: "Prim's algorithm",
		requires: { directed: false },
		usesWeights: true,
		create: (view, start) => new PrimSimulation(view, start)
	};
	// src/algorithms/disjoint-set.ts
	/**
	* Disjoint-set forest with union by rank and path compression, as in CLRS
	* (Introduction to Algorithms, 4th ed., §19.3):
	*
	*   MAKE-SET(x)        FIND-SET(x)                  LINK(x, y)
	*     x.p = x            if x ≠ x.p                   if x.rank > y.rank
	*     x.rank = 0           x.p = FIND-SET(x.p)          y.p = x
	*                        return x.p                   else x.p = y
	*   UNION(x, y)                                         if x.rank == y.rank
	*     LINK(FIND-SET(x), FIND-SET(y))                      y.rank = y.rank + 1
	*
	* Each set is a tree whose root is the set's representative.
	*/
	var DisjointSet = class {
		p = /* @__PURE__ */ new Map();
		rank = /* @__PURE__ */ new Map();
		makeSet(x) {
			this.p.set(x, x);
			this.rank.set(x, 0);
		}
		/** The representative of x's set, compressing the path to it (FIND-SET). */
		findSet(x) {
			const parent = this.p.get(x);
			if (parent !== x) this.p.set(x, this.findSet(parent));
			return this.p.get(x);
		}
		union(x, y) {
			this.link(this.findSet(x), this.findSet(y));
		}
		/** The representative of x's set, without changing anything (for display). */
		representative(x) {
			let r = x;
			while (this.p.get(r) !== r) r = this.p.get(r);
			return r;
		}
		/** x's parent pointer (x.p) and rank, for inspection. */
		parentOf(x) {
			return this.p.get(x);
		}
		rankOf(x) {
			return this.rank.get(x);
		}
		link(x, y) {
			if (this.rank.get(x) > this.rank.get(y)) this.p.set(y, x);
			else {
				this.p.set(x, y);
				if (this.rank.get(x) === this.rank.get(y)) this.rank.set(y, this.rank.get(y) + 1);
			}
		}
	};
	// src/algorithms/kruskal.ts
	/**
	* Kruskal's minimum-spanning-tree algorithm as defined in CLRS (Introduction to
	* Algorithms, 4th ed., §21.2):
	*
	*   MST-KRUSKAL(G, w)
	*     A = ∅
	*     for each vertex v ∈ G.V
	*       MAKE-SET(v)
	*     create a single list of the edges in G.E
	*     sort the list of edges into monotonically increasing order by weight w
	*     for each edge (u, v) taken from the sorted list in order
	*       if FIND-SET(u) ≠ FIND-SET(v)
	*         A = A ∪ {(u, v)}
	*         UNION(u, v)
	*     return A
	*
	* with the disjoint-set forest of §19.3 (union by rank, path compression; see
	* disjoint-set.ts). Like Prim's algorithm it solves the minimum-spanning-tree problem
	* for an undirected graph (Chapter 21), so it runs on the undirected view, with the
	* view's weights (every edge weighs 1 in an unweighted view). Edges of equal weight are
	* taken in order of their ends' ids. On a graph that is not connected it finds a minimum
	* spanning forest, one tree per connected component. It needs no start vertex.
	*
	* One step is one iteration of the for loop: the next edge (u, v) in sorted order is
	* added to A if its ends are in different trees (FIND-SET differs) — then it is a light
	* edge crossing the cut (C, V − C), where C is u's tree (Corollary 21.2) — and skipped
	* otherwise (it would close a cycle). A graph with m edges takes m steps.
	*
	* The display follows Prim's: the white edge is the one the next step considers, the cut
	* (C, V − C) is drawn on the canvas with its crossing edges grey, A's edges are green,
	* other edges inside one tree dashed green, and vertices in a tree with an edge green.
	* Vertices are compact dots labelled with their set's representative, FIND-SET(v), shown
	* when the sorted edge list is hovered.
	*/
	var KruskalSimulation = class {
		view;
		sets = new DisjointSet();
		/** The edges in sorted order; `next` indexes the one the next step considers. */
		sorted;
		next = 0;
		last = null;
		/** A: the forest's edges, in the order they were added. */
		forest = [];
		/** Edges skipped because their ends were already in one tree. */
		skipped = [];
		constructor(view) {
			this.view = view;
			for (const v of view.nodeIds()) this.sets.makeSet(v);
			this.sorted = view.weightedEdges().map(({ from, to, weight }) => ({
				from: Math.min(from, to),
				to: Math.max(from, to),
				weight
			})).sort((a, b) => a.weight - b.weight || a.from - b.from || a.to - b.to);
		}
		get finished() {
			return this.next >= this.sorted.length;
		}
		/** The edge the next step considers, if any. */
		get upcoming() {
			return this.sorted[this.next] ?? null;
		}
		get totalWeight() {
			return this.forest.reduce((sum, e) => sum + e.weight, 0);
		}
		/** FIND-SET(v) without path compression (display only). */
		representative(v) {
			return this.sets.representative(v);
		}
		/** The vertices of v's tree, ascending. */
		treeOf(v) {
			const r = this.sets.representative(v);
			return this.view.nodeIds().filter((x) => this.sets.representative(x) === r);
		}
		/** The forest's trees (one per set), each in id order, ordered by their smallest vertex. */
		trees() {
			const byRoot = /* @__PURE__ */ new Map();
			for (const v of this.view.nodeIds()) {
				const r = this.sets.representative(v);
				byRoot.set(r, [...byRoot.get(r) ?? [], v]);
			}
			return [...byRoot.values()];
		}
		/** How many trees the forest has (one per set). */
		get treeCount() {
			return new Set(this.view.nodeIds().map((v) => this.sets.representative(v))).size;
		}
		step() {
			const edge = this.sorted[this.next];
			if (!edge) return false;
			this.next++;
			const added = this.sets.findSet(edge.from) !== this.sets.findSet(edge.to);
			if (added) {
				this.forest.push(edge);
				this.sets.union(edge.from, edge.to);
			} else this.skipped.push(edge);
			this.last = {
				edge,
				added
			};
			return true;
		}
		/**
		* The edges crossing the cut (C, V − C) around u's tree, for the upcoming edge (u, v):
		* one end in C, the other outside, as [inside end, outside end].
		*/
		crossingEdges() {
			const edge = this.upcoming;
			if (!edge) return [];
			const tree = new Set(this.treeOf(edge.from));
			return this.view.edges().filter(([a, b]) => tree.has(a) !== tree.has(b)).map(([a, b]) => tree.has(a) ? [a, b] : [b, a]);
		}
		highlight() {
			const edge = this.upcoming;
			const waiting = this.sorted.slice(this.next).filter(({ from, to }) => this.sets.representative(from) === this.sets.representative(to));
			const ids = this.view.nodeIds();
			const touched = new Set(this.forest.flatMap((e) => [e.from, e.to]));
			const trees = this.trees().filter((tree) => tree.length > 1);
			return {
				current: null,
				compact: true,
				done: ids.filter((v) => touched.has(v)),
				activeEdges: edge ? [[edge.from, edge.to]] : [],
				labels: Object.fromEntries(ids.map((v) => [v, String(this.sets.representative(v))])),
				exploredEdges: [...this.forest.map(({ from, to }) => ({
					from,
					to,
					done: true
				})), ...waiting.map(({ from, to }) => ({
					from,
					to,
					waiting: true
				}))],
				activeDashed: true,
				cut: trees.flat(),
				cutGroups: trees
			};
		}
		edgeQueueSnapshot() {
			return {
				items: this.sorted.slice(this.next),
				last: this.last ? {
					...this.last.edge,
					added: this.last.added
				} : null
			};
		}
		describe() {
			const edge = this.upcoming;
			const name = (e) => `${e.from} — ${e.to} (weight ${e.weight})`;
			const unit = this.view.weighted ? "" : " (every edge counts as 1)";
			if (this.finished) {
				if (!this.last) return "Kruskal: the graph has no edges, so every vertex is a tree of its own. Press Finish.";
				const edges = this.forest.length;
				const size = `${edges} ${edges === 1 ? "edge" : "edges"}, total weight ${this.totalWeight}${unit}`;
				const trees = this.treeCount;
				return trees <= 1 ? `Kruskal finished: a minimum spanning tree of ${size}. Press Finish.` : `Kruskal finished: the graph is not connected, so this is a minimum spanning forest of ${trees} trees, ${size}. Press Finish.`;
			}
			const upcoming = (e) => this.sets.representative(e.from) === this.sets.representative(e.to) ? `Next: ${name(e)} has both ends in one tree, so it would close a cycle.` : `Next: ${name(e)} joins two trees: a light edge crossing the cut around ${e.from}'s tree.`;
			if (!this.last) {
				const m = this.sorted.length;
				return `Kruskal: every vertex is a set of its own; ${m} ${m === 1 ? "edge" : "edges"} sorted by weight. ${upcoming(edge)}`;
			}
			const { edge: e, added } = this.last;
			return `${added ? `Added ${name(e)}: it joined two trees.` : `Skipped ${name(e)}: both ends were already in one tree.`} Forest weight ${this.totalWeight}. ${upcoming(edge)}`;
		}
	};
	const kruskal = {
		id: "kruskal",
		name: "Kruskal's algorithm",
		requires: { directed: false },
		usesWeights: true,
		create: (view) => new KruskalSimulation(view)
	};
	// src/algorithms/dijkstra.ts
	var DijkstraSimulation = class {
		view;
		source;
		/** The min-priority queue's contents (membership; order comes from d). */
		inQueue;
		last = null;
		/** v.d: the shortest-path estimate (Infinity for ∞). */
		distance = /* @__PURE__ */ new Map();
		/** v.π: the predecessor on the shortest path found so far (null for NIL). */
		parent = /* @__PURE__ */ new Map();
		/** S: the vertices in the order they were extracted. */
		order = [];
		constructor(view, source) {
			this.view = view;
			this.source = source;
			const ids = view.nodeIds();
			for (const id of ids) {
				this.distance.set(id, Infinity);
				this.parent.set(id, null);
			}
			if (this.distance.has(source)) this.distance.set(source, 0);
			this.inQueue = new Set(ids);
		}
		/** The queue in extraction order: smallest d first, ties by lowest id. */
		get queued() {
			return [...this.inQueue].sort((a, b) => {
				const [da, db] = [this.distance.get(a), this.distance.get(b)];
				return da === db ? a - b : da < db ? -1 : 1;
			});
		}
		/** The vertex the next step extracts, or null once the rest (if any) are unreachable. */
		get next() {
			const u = this.queued[0];
			return u !== void 0 && Number.isFinite(this.distance.get(u)) ? u : null;
		}
		/** True once every reachable vertex is in S. */
		get finished() {
			return this.next === null;
		}
		/** The edges the next step relaxes: from the next vertex to its neighbours still in the queue. */
		edgesToRelax() {
			const u = this.next;
			if (u === null) return [];
			return this.view.neighbors(u).filter((v) => this.inQueue.has(v)).map((v) => [u, v]);
		}
		/** The shortest-paths tree found so far: (v.π, v) for every v with a predecessor. */
		predecessorEdges() {
			const edges = [];
			for (const [v, p] of this.parent) if (p !== null) edges.push([p, v]);
			return edges;
		}
		/**
		* The predecessor tree G_π so far (CLRS §22.1) as a tidy tree: the source on top, each
		* vertex one row below v.π (rows count edges, not d), children in id order. Vertices
		* with d = ∞ (not reached yet) go `aside`. Tree edges are not highlighted white while
		* running (white is the next step's); at the end they are, as the shortest-paths tree.
		*/
		searchTree() {
			return {
				places: this.distance.has(this.source) ? tidyTree(this.source, this.parent) : [],
				spine: this.predecessorEdges(),
				aside: this.view.nodeIds().filter((id) => !Number.isFinite(this.distance.get(id))),
				highlightSpine: false,
				intro: "Shortest-paths tree so far: the start is on top, and each vertex hangs from its predecessor v.π, one row below it; each Update may move vertices under a new predecessor."
			};
		}
		step() {
			const u = this.next;
			if (u === null) return false;
			this.inQueue.delete(u);
			this.order.push(u);
			const du = this.distance.get(u);
			const relaxed = [];
			for (const v of this.view.neighbors(u)) {
				if (!this.inQueue.has(v)) continue;
				const before = this.distance.get(v);
				const through = du + this.view.weight(u, v);
				if (through < before) {
					this.distance.set(v, through);
					this.parent.set(v, u);
				}
				relaxed.push({
					v,
					before,
					after: this.distance.get(v)
				});
			}
			this.last = {
				u,
				relaxed
			};
			return true;
		}
		highlight() {
			const next = this.next;
			return {
				current: next,
				done: [...this.order],
				activeEdges: next !== null ? this.edgesToRelax() : this.predecessorEdges(),
				labels: Object.fromEntries([...this.distance].map(([id, d]) => [id, formatDistance$2(d)]))
			};
		}
		priorityQueueSnapshot() {
			return {
				items: this.queued,
				incoming: []
			};
		}
		describe() {
			const arrow = this.view.directed ? "→" : "—";
			const last = this.last;
			const next = this.next;
			const nextText = () => `Next: extract ${next} (d = ${this.distance.get(next)}).`;
			if (last === null) {
				if (next === null) return `Dijkstra from ${this.source}: there is no such vertex. Press Finish.`;
				return `Dijkstra from ${this.source}. Every d is ∞ except ${this.source}.d = 0. Press Update to extract ${this.source} and relax its edges.`;
			}
			const { u, relaxed } = last;
			const lowered = relaxed.filter((r) => r.after < r.before);
			const kept = relaxed.filter((r) => r.after === r.before);
			const parts = [`Extracted ${u} (d = ${this.distance.get(u)}).`];
			if (relaxed.length === 0) parts.push("No edge to relax.");
			else {
				if (lowered.length) parts.push(`Relaxed ${lowered.map((r) => `${u} ${arrow} ${r.v}: d ${formatDistance$2(r.before)} → ${r.after}`).join(", ")}.`);
				if (kept.length) parts.push(`No shorter path to ${kept.map((r) => r.v).join(", ")}.`);
			}
			if (!this.finished) return `${parts.join(" ")} ${nextText()}`;
			const n = this.view.nodeIds().length;
			const reached = this.order.length;
			const unreachable = n - reached;
			const ending = unreachable === 0 ? `Dijkstra finished: shortest paths from ${this.source} to all ${n} vertices; the white edges (v.π, v) form the shortest-paths tree. Press Finish.` : `Dijkstra finished: shortest paths from ${this.source} to ${reached} of ${n} vertices; ${unreachable} not reachable (d = ∞). The white edges (v.π, v) form the shortest-paths tree. Press Finish.`;
			return `${parts.join(" ")} ${ending}`;
		}
	};
	function formatDistance$2(d) {
		return Number.isFinite(d) ? String(d) : "∞";
	}
	const dijkstra = {
		id: "dijkstra",
		name: "Dijkstra's algorithm",
		requires: { weighting: "positive" },
		create: (view, start) => new DijkstraSimulation(view, start)
	};
	// src/algorithms/bellman-ford.ts
	var BellmanFordSimulation = class {
		source;
		/** G.E, in the order each pass goes through them. */
		edges;
		/** v.d: the shortest-path estimate (Infinity for ∞). */
		distance = /* @__PURE__ */ new Map();
		/** v.π: the predecessor on the shortest path found so far (null for NIL). */
		parent = /* @__PURE__ */ new Map();
		/** Passes of RELAX: |V| − 1. */
		passes;
		/** Which pass the next step is in (1 … passes), or passes + 1 for the check. */
		pass = 1;
		/** The next edge's index in `edges`. */
		index = 0;
		last = null;
		/** The check's verdict once it has ended: TRUE (no negative cycle) or FALSE; null before. */
		result = null;
		/** Whether G.E is directed (undirected: each edge is two arcs, drawn as one). */
		directed;
		constructor(view, source) {
			this.source = source;
			this.directed = view.directed;
			const ids = view.nodeIds();
			for (const id of ids) {
				this.distance.set(id, Infinity);
				this.parent.set(id, null);
			}
			if (this.distance.has(source)) this.distance.set(source, 0);
			this.edges = ids.flatMap((u) => view.neighbors(u).map((v) => ({
				from: u,
				to: v,
				weight: view.weight(u, v)
			})));
			this.passes = Math.max(0, ids.length - 1);
			if (this.edges.length === 0) this.result = true;
		}
		get finished() {
			return this.result !== null;
		}
		/** Whether the next step is in the final check (rather than a pass of RELAX). */
		get checking() {
			return this.pass > this.passes;
		}
		/** The edge the next step relaxes or checks (null once finished). */
		get nextEdge() {
			return this.finished ? null : this.edges[this.index];
		}
		/**
		* The edges the current pass (or the check) has gone through, by index in `edges`: all of
		* them right after a pass completes (and at the end, TRUE), up to and including the edge
		* that failed the check (FALSE), and none before the first step.
		*/
		visitedThisPass() {
			if (this.last === null) return [];
			if (this.finished) return [...this.edges];
			if (this.index === 0) return [...this.edges];
			return this.edges.slice(0, this.index);
		}
		/**
		* The degenerate edges: every edge (u, v) that could still be relaxed, v.d > u.d + w(u, v).
		* After |V| − 1 passes there are none unless a negative-weight cycle is reachable from
		* the source (CLRS Theorem 22.4), and then the check stops at the first of them.
		*/
		degenerateEdges() {
			return this.edges.filter(({ from, to, weight }) => this.distance.get(to) > this.distance.get(from) + weight);
		}
		/** Steps left until the current pass (or the check) is through: the Full cycle button's run. */
		stepsLeftInPass() {
			return this.finished ? 0 : this.edges.length - this.index;
		}
		/**
		* The predecessor tree G_π so far, as a tidy tree from the source (rows count edges),
		* children in id order. Vertices not in it — d = ∞, or (after a negative-weight cycle)
		* caught in a loop of predecessors — go `aside`. Not highlighted white while running.
		*/
		searchTree() {
			const places = this.distance.has(this.source) ? tidyTree(this.source, this.parent) : [];
			const placed = new Set(places.map((p) => p.id));
			const aside = [...this.distance.keys()].filter((id) => !placed.has(id));
			const looped = aside.filter((id) => Number.isFinite(this.distance.get(id))).length;
			const unreached = aside.length - looped;
			const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
			return {
				places,
				spine: this.predecessorEdges().filter(([u, v]) => placed.has(u) && placed.has(v) && v !== this.source),
				aside,
				asideNote: looped === 0 ? void 0 : `Waiting on the right: ${unreached ? `${plural(unreached, "vertex", "vertices")} not reached yet, and ` : ""}${plural(looped, "vertex", "vertices")} whose predecessors run round in a loop, which only a negative-weight cycle makes possible (CLRS Lemma 22.16), so they hang from no tree.`,
				highlightSpine: false,
				intro: "Shortest-paths tree so far: the start is on top, and each vertex hangs from its predecessor v.π, one row below it; each relaxation that lowers a d may move a vertex under a new predecessor."
			};
		}
		/** The shortest-paths tree found so far: (v.π, v) for every v with a predecessor. */
		predecessorEdges() {
			const edges = [];
			for (const [v, p] of this.parent) if (p !== null) edges.push([p, v]);
			return edges;
		}
		step() {
			const arc = this.nextEdge;
			if (!arc) return false;
			const { from: u, to: v, weight } = arc;
			const through = this.distance.get(u) + weight;
			if (!this.checking) {
				const before = this.distance.get(v);
				if (through < before) {
					this.distance.set(v, through);
					this.parent.set(v, u);
				}
				this.last = {
					kind: "relax",
					arc,
					pass: this.pass,
					index: this.index,
					before,
					after: this.distance.get(v)
				};
			} else {
				const ok = !(this.distance.get(v) > through);
				this.last = {
					kind: "check",
					arc,
					index: this.index,
					ok
				};
				if (!ok) {
					this.result = false;
					return true;
				}
			}
			this.index++;
			if (this.index === this.edges.length) {
				this.index = 0;
				if (this.checking) this.result = true;
				this.pass++;
			}
			return true;
		}
		highlight() {
			const next = this.nextEdge;
			const degenerate = this.result === false ? this.degenerateEdges() : [];
			const key = (a, b) => this.directed ? `${a}>${b}` : `${Math.min(a, b)}-${Math.max(a, b)}`;
			const red = new Set(degenerate.map(({ from, to }) => key(from, to)));
			return {
				current: null,
				done: [],
				activeEdges: next ? [[next.from, next.to]] : this.predecessorEdges().filter(([u, v]) => !red.has(key(u, v))),
				exploredEdges: this.visitedThisPass().map(({ from, to }) => red.has(key(from, to)) ? {
					from,
					to,
					degenerate: true
				} : {
					from,
					to
				}),
				labels: Object.fromEntries([...this.distance].map(([id, d]) => [id, formatDistance$1(d)])),
				representationEdge: next ? {
					from: next.from,
					to: next.to
				} : void 0
			};
		}
		describe() {
			const name = (a) => `${a.from} → ${a.to} (weight ${a.weight})`;
			const m = this.edges.length;
			const next = this.nextEdge;
			const nextText = () => {
				if (!next) return "";
				return this.checking ? ` Next: check ${name(next)}${this.index === 0 ? ", the first edge of the final check" : ""}.` : ` Next: relax ${name(next)}${this.index === 0 && this.last ? `, starting pass ${this.pass} of ${this.passes}` : ""}.`;
			};
			const last = this.last;
			if (last === null) {
				if (this.finished) return `Bellman–Ford from ${this.source}: there are no edges, so nothing to relax; no negative-weight cycle (TRUE). Press Finish.`;
				return `Bellman–Ford from ${this.source}. Every d is ∞ except ${this.source}.d = 0. ${this.passes} ${this.passes === 1 ? "pass" : "passes"} (|V| − 1) over the ${m} edges, then a check.${nextText()}`;
			}
			let done;
			if (last.kind === "relax") {
				const where = `Pass ${last.pass} of ${this.passes}, edge ${last.index + 1} of ${m}:`;
				done = last.after < last.before ? `${where} relaxed ${name(last.arc)}: ${last.arc.to}.d ${formatDistance$1(last.before)} → ${last.after}.` : `${where} ${name(last.arc)} gives no shorter path to ${last.arc.to}.`;
			} else {
				const where = `Check, edge ${last.index + 1} of ${m}:`;
				done = last.ok ? `${where} ${name(last.arc)} cannot lower ${last.arc.to}.d.` : `${where} ${name(last.arc)} could still lower ${last.arc.to}.d (${formatDistance$1(this.distance.get(last.arc.to))} > ${formatDistance$1(this.distance.get(last.arc.from))} + ${last.arc.weight}).`;
			}
			if (this.result === true) return `${done} Bellman–Ford finished: no negative-weight cycle is reachable from ${this.source} (TRUE), so every d is a shortest-path weight; the white edges (v.π, v) form the shortest-paths tree. Press Finish.`;
			if (this.result === false) {
				const red = this.degenerateEdges().length;
				return `${done} Bellman–Ford finished: a negative-weight cycle is reachable from ${this.source} (FALSE), so some shortest paths are not defined. In red: the ${red === 1 ? "edge" : `${red} edges`} that could still lower a d. Press Finish.`;
			}
			return `${done}${nextText()}`;
		}
	};
	function formatDistance$1(d) {
		return Number.isFinite(d) ? String(d) : "∞";
	}
	const bellmanFord = {
		id: "bellman-ford",
		name: "Bellman–Ford algorithm",
		requires: {},
		usesWeights: true,
		create: (view, start) => new BellmanFordSimulation(view, start)
	};
	// src/algorithms/dag-shortest-paths.ts
	var DagShortestPathsSimulation = class {
		view;
		source;
		/** The topological order (empty if the graph has a cycle). */
		order;
		/** A backward edge DFS found (the graph has a cycle), or null for a DAG. */
		cycleEdge;
		/** v.d: the shortest-path estimate (Infinity for ∞). */
		distance = /* @__PURE__ */ new Map();
		/** v.π: the predecessor on the shortest path found so far (null for NIL). */
		parent = /* @__PURE__ */ new Map();
		/** How many vertices of `order` have been taken. */
		taken = 0;
		last = null;
		/** DFS's line-up, kept for Topological sort. */
		diagram;
		constructor(view, source) {
			this.view = view;
			this.source = source;
			const dfs = new DfsSimulation(view, source);
			while (dfs.step());
			const back = dfs.edges.find((e) => e.kind === "back");
			this.cycleEdge = back ? [back.from, back.to] : null;
			const sorted = back ? null : dfs.topologicalSort();
			this.order = sorted?.order ?? [];
			this.diagram = sorted ? {
				order: sorted.order,
				spine: [],
				below: sorted.below
			} : null;
			for (const id of view.nodeIds()) {
				this.distance.set(id, Infinity);
				this.parent.set(id, null);
			}
			if (this.distance.has(source)) this.distance.set(source, 0);
		}
		get finished() {
			return this.taken >= this.order.length;
		}
		/** The vertex the next step takes (null once finished). */
		get next() {
			return this.finished ? null : this.order[this.taken];
		}
		/** The edges the next step relaxes: every edge leaving the next vertex. */
		edgesToRelax() {
			const u = this.next;
			return u === null ? [] : this.view.neighbors(u).map((v) => [u, v]);
		}
		/** The shortest-paths tree found so far: (v.π, v) for every v with a predecessor. */
		predecessorEdges() {
			const edges = [];
			for (const [v, p] of this.parent) if (p !== null) edges.push([p, v]);
			return edges;
		}
		step() {
			const u = this.next;
			if (u === null) return false;
			const du = this.distance.get(u);
			const relaxed = [];
			for (const v of this.view.neighbors(u)) {
				const before = this.distance.get(v);
				const through = du + this.view.weight(u, v);
				if (through < before) {
					this.distance.set(v, through);
					this.parent.set(v, u);
				}
				relaxed.push({
					v,
					before,
					after: this.distance.get(v)
				});
			}
			this.taken++;
			this.last = {
				u,
				relaxed
			};
			return true;
		}
		highlight() {
			const next = this.next;
			return {
				current: next,
				done: this.order.slice(0, this.taken),
				activeEdges: next !== null ? this.edgesToRelax() : this.predecessorEdges(),
				labels: Object.fromEntries([...this.distance].map(([id, d]) => [id, formatDistance(d)]))
			};
		}
		/** The vertices lined up in the order they are taken (DFS's topological line-up). */
		topologicalSort() {
			return this.diagram;
		}
		/** The predecessor tree so far, from the source (rows count edges); d = ∞ aside. */
		searchTree() {
			return {
				places: this.distance.has(this.source) ? tidyTree(this.source, this.parent) : [],
				spine: this.predecessorEdges(),
				aside: this.view.nodeIds().filter((id) => !Number.isFinite(this.distance.get(id))),
				highlightSpine: false,
				intro: "Shortest-paths tree so far: the start is on top, and each vertex hangs from its predecessor v.π, one row below it; each Update may move vertices under a new predecessor."
			};
		}
		describe() {
			if (this.cycleEdge) {
				const [u, v] = this.cycleEdge;
				return `DAG shortest paths needs a directed acyclic graph, but DFS found the backward edge ${u} → ${v} (a cycle), so there is no topological order. Press Finish.`;
			}
			const next = this.next;
			const nextText = () => {
				const d = this.distance.get(next);
				return Number.isFinite(d) ? ` Next: ${next} (d = ${d}), relaxing the edges out of it.` : ` Next: ${next} (d = ∞: not reachable from ${this.source}, so relaxing its edges changes nothing).`;
			};
			const last = this.last;
			if (last === null) return `DAG shortest paths from ${this.source}, taking the vertices in topological order: ${this.order.join(", ")}. Every d is ∞ except ${this.source}.d = 0.${nextText()}`;
			const { u, relaxed } = last;
			const lowered = relaxed.filter((r) => r.after < r.before);
			const kept = relaxed.filter((r) => r.after === r.before);
			const parts = [`Took ${u} (d = ${formatDistance(this.distance.get(u))}).`];
			if (relaxed.length === 0) parts.push("No edge leaves it.");
			else {
				if (lowered.length) parts.push(`Relaxed ${lowered.map((r) => `${u} → ${r.v}: d ${formatDistance(r.before)} → ${r.after}`).join(", ")}.`);
				if (kept.length) parts.push(`No shorter path to ${kept.map((r) => r.v).join(", ")}.`);
			}
			if (!this.finished) return `${parts.join(" ")}${nextText()}`;
			const unreachable = [...this.distance.values()].filter((d) => !Number.isFinite(d)).length;
			const n = this.order.length;
			return `${parts.join(" ")} DAG shortest paths finished: shortest paths from ${this.source} to ` + (unreachable === 0 ? `all ${n} vertices` : `${n - unreachable} of ${n} vertices; ${unreachable} not reachable (d = ∞)`) + ". The white edges (v.π, v) form the shortest-paths tree. Press Finish.";
		}
	};
	function formatDistance(d) {
		return Number.isFinite(d) ? String(d) : "∞";
	}
	// src/algorithms/index.ts
	/** Algorithms offered in the header's picker, in order. Add new simulations here. */
	const ALGORITHMS = [
		bfs,
		dfs,
		prim,
		kruskal,
		dijkstra,
		bellmanFord,
		{
			id: "dag-shortest-paths",
			name: "DAG shortest paths",
			requires: {
				weighting: "weighted",
				directed: true
			},
			create: (view, start) => new DagShortestPathsSimulation(view, start)
		}
	];
	// src/runner.ts
	const LOCKED_TITLE = "Locked while the algorithm runs. Press Stop to change it.";
	/**
	* Runs the selected algorithm step by step:
	*   Run    → locks the graph (editing, the direction switch, and the weighting) and
	*            forces the reading the algorithm requires (BFS: "Unweighted"; DFS:
	*            "Unweighted" and "Directed"; Prim and Kruskal: "Undirected", with the
	*            weighting left as chosen but locked), then starts the simulation;
	*   Update → advances one step; after the last step it turns into Finish;
	*   Topological sort → (DFS, once finished; DAG shortest paths, all along) lines the
	*            vertices up in topological order as an arc diagram (on a cyclic graph, the
	*            same line-up with the backward edges in red). The run goes on until Finish
	*            or Stop. While DFS's line-up is shown it reads "Find shortest path for DAG",
	*            filled, and starts DAG shortest paths from DFS's start vertex (greyed out
	*            when the graph has a cycle);
	*   Show as forest → (DFS, any time while it runs) a toggle: arranges the vertices as the
	*            depth-first forest so far, laid out like the timestamp chart (rows by depth,
	*            columns by time), the vertices not discovered yet grouped on the right; each
	*            Update then glides them into place. Once DFS has finished, its tree edges are
	*            white, and it and Topological sort switch between each other. Pressing it
	*            again, or turning auto-layout on, leaves it. The run goes on until Finish or Stop;
	*   Show as tree → (BFS, Dijkstra, Bellman–Ford, any time while they run) a toggle:
	*            arranges the vertices as the search tree so far (the start on top), the
	*            vertices not reached yet grouped on the right; each Update then glides them
	*            into place. Pressing it again, or turning auto-layout on, leaves it;
	*   Full cycle → (Bellman–Ford) a toggle: plays the rest of the current pass over the
	*            edges, FULL_CYCLE_RATE steps a second, Update greyed out meanwhile; pressing
	*            it again pauses. It stops by itself at the end of the pass (or of the run);
	*   Stop / Finish → ends the run, clears the highlighting and releases every lock
	*            (restoring the weighting and direction that were selected before).
	*/
	var AlgorithmRunner = class {
		graph;
		editor;
		el;
		hooks;
		simulation = null;
		/** Full cycle playing: the timer, and how many steps it still has to take. */
		cycleTimer = null;
		cycleLeft = 0;
		/** The weighting / direction chosen before Run forced one, restored on Stop. */
		savedWeighting = null;
		savedDirected = null;
		constructor(graph, editor, el, hooks) {
			this.graph = graph;
			this.editor = editor;
			this.el = el;
			this.hooks = hooks;
			el.select.setOptions(ALGORITHMS.map((a) => ({
				value: a.id,
				label: a.name
			})));
			el.run.addEventListener("click", () => this.run());
			el.step.addEventListener("click", () => this.step());
			el.stop.addEventListener("click", () => this.stop("Stopped."));
			el.topo?.addEventListener("click", () => this.topoClicked());
			el.forest?.addEventListener("click", () => this.toggleForest());
			el.tree?.addEventListener("click", () => this.toggleTree());
			el.cycle?.addEventListener("click", () => this.toggleCycle());
			this.updateControls();
		}
		get running() {
			return this.simulation !== null;
		}
		/** The edge the running simulation's next step works on, for the side panel (Bellman–Ford); else null. */
		get representationEdge() {
			return this.simulation?.highlight().representationEdge ?? null;
		}
		get algorithm() {
			return ALGORITHMS.find((a) => a.id === this.el.select.value) ?? ALGORITHMS[0];
		}
		/** Starts the selected algorithm from `start`, or else the selected node (or the lowest id). */
		run(start) {
			if (this.running || this.graph.nodeCount === 0) return;
			const algorithm = this.algorithm;
			start ??= this.editor.selectedNode ?? this.graph.getNodes()[0].id;
			this.editor.setLocked(true);
			const { weighted, weighting, directed } = algorithm.requires;
			const forcesWeighting = weighted !== void 0 || weighting !== void 0;
			if (forcesWeighting) {
				this.savedWeighting = this.graph.weighting;
				if (weighting !== void 0) this.editor.setWeighting(weighting);
				else if (weighted !== this.graph.weighted) this.editor.setWeighted(weighted);
				this.syncSwitch(this.el.weightSwitch, this.graph.weighting);
			}
			if (directed !== void 0) {
				this.savedDirected = this.graph.directed;
				this.editor.setDirected(directed);
				this.syncSwitch(this.el.directionSwitch, this.graph.directed ? "directed" : "undirected");
			}
			this.lockSwitch(this.el.weightSwitch, forcesWeighting || !!algorithm.usesWeights);
			this.lockSwitch(this.el.directionSwitch, true);
			this.simulation = algorithm.create(this.graph.currentView, start);
			this.show(false);
		}
		/** Whether Full cycle is playing. */
		get playingCycle() {
			return this.cycleTimer !== null;
		}
		/**
		* Full cycle (Bellman–Ford): plays the rest of the current pass over the edges, one step
		* now and then FULL_CYCLE_RATE a second, stopping by itself at the end of the pass or of
		* the run. Pressing it while it plays pauses it.
		*/
		toggleCycle() {
			if (this.cycleTimer !== null) {
				this.stopCycle();
				return;
			}
			const simulation = this.simulation;
			const left = simulation?.stepsLeftInPass?.() ?? 0;
			if (!simulation || simulation.finished || left === 0) return;
			this.cycleLeft = left;
			this.cycleTimer = setInterval(() => this.cycleTick(), 1e3 / 15);
			this.cycleTick();
		}
		cycleTick() {
			const simulation = this.simulation;
			if (!simulation || simulation.finished || this.cycleLeft <= 0) {
				this.stopCycle();
				return;
			}
			this.cycleLeft--;
			this.step();
			if (this.cycleLeft <= 0 || simulation.finished) this.stopCycle();
		}
		stopCycle() {
			if (this.cycleTimer !== null) clearInterval(this.cycleTimer);
			this.cycleTimer = null;
			this.cycleLeft = 0;
			if (this.simulation) this.updateControls();
		}
		/** Advances one step; once finished, ends the run like Stop. */
		step() {
			const simulation = this.simulation;
			if (!simulation) return;
			if (simulation.finished) {
				this.stop("Finished.");
				return;
			}
			simulation.step();
			this.show(true);
			if (this.editor.arrangement === "tree" && simulation.searchTree) this.editor.showForest(simulation.searchTree(), "tree");
			if (this.editor.arrangement === "forest" && simulation.searchForest) this.editor.showForest(simulation.searchForest());
		}
		/**
		* Lines the vertices up in the simulation's topological order (DFS), left to right by
		* decreasing finish time. On a cyclic graph the line-up is the same, and the backward
		* edges, which point right to left, are red. The run is not over: Finish or Stop ends it.
		*/
		topologicalSort() {
			const diagram = this.simulation?.topologicalSort?.() ?? null;
			if (!diagram) return;
			this.editor.showArcDiagram(diagram);
			this.updateControls();
			const backward = diagram.backward?.length ?? 0;
			const next = this.simulation?.followUp?.() ?? null;
			const ending = next && !next.blocked ? ` Press ${next.label}, or Finish or Stop to end.` : " Press Finish or Stop to end.";
			if (diagram.spine.length === 0 && backward === 0) {
				this.hooks.message(`Topological order: ${diagram.order.join(", ")}, the order the vertices are taken in. Every edge points left to right; the edges DFS classed as crossed arc below, the rest above.`);
				return;
			}
			this.hooks.message(backward === 0 ? `Topological order (decreasing finish time): ${diagram.order.join(", ")}. Every edge points left to right: tree edges in white, forward edges arc above, crossed edges below.${ending}` : `By decreasing finish time: ${diagram.order.join(", ")}. No topological order: ${backward === 1 ? "the backward edge (red) points" : `the ${backward} backward edges (red) point`} right to left, ${backward === 1 ? "closing a cycle" : "each closing a cycle"}. The rest point left to right: tree edges in white, forward edges arc above, crossed and backward edges below.${ending}`);
		}
		/**
		* Arranges the vertices as the simulation's depth-first forest so far (DFS), as its
		* timestamp chart nests them, or leaves it when it is shown. The run goes on either way.
		*/
		toggleForest() {
			const simulation = this.simulation;
			if (!simulation?.searchForest) return;
			if (this.editor.arrangement === "forest") {
				this.editor.showArcDiagram(null);
				this.updateControls();
				this.hooks.message("Left the forest: the vertices stay where they are. Press Show as forest to arrange them again.");
				return;
			}
			const forest = simulation.searchForest();
			this.editor.showForest(forest);
			this.updateControls();
			const roots = forest.places.filter((p) => p.row === 0).sort((p, q) => p.column - q.column).map((p) => p.id);
			const trees = roots.length === 0 ? "nothing discovered yet" : roots.length === 1 ? `1 tree, rooted at ${roots[0]}` : `${roots.length} trees, rooted at ${roots.join(", ")}`;
			const waiting = forest.aside?.length ?? 0;
			if (simulation.finished) this.hooks.message(`Depth-first forest: ${trees}. As on the timestamp chart, each row is a depth and each vertex sits above the middle of its [d, f] interval, its descendants below it. Tree edges in white; the other edges curve. Press Finish or Stop to end.`);
			else this.hooks.message(`Depth-first forest so far: ${trees}. As on the timestamp chart, each row is a depth and each vertex sits above the middle of its [d, f] interval ([d, now] while it runs), its descendants below it. ` + (waiting ? `The ${waiting} not discovered yet wait on the right; each Update brings the new ones in.` : "Every vertex is discovered."));
		}
		/**
		* Shows the simulation's search tree so far (BFS: the breadth-first tree; Dijkstra: the
		* shortest-paths tree), or leaves it when it is shown. The run goes on either way.
		*/
		toggleTree() {
			const simulation = this.simulation;
			if (!simulation?.searchTree) return;
			if (this.editor.arrangement === "tree") {
				this.editor.showArcDiagram(null);
				this.updateControls();
				this.hooks.message("Left the tree: the vertices stay where they are. Press Show as tree to arrange them again.");
				return;
			}
			const tree = simulation.searchTree();
			this.editor.showForest(tree, "tree");
			this.updateControls();
			const waiting = tree.aside?.length ?? 0;
			this.hooks.message(`${tree.intro ?? "The search tree so far."} ` + (waiting ? tree.asideNote ?? `The ${waiting} not reached yet wait on the right; each Update brings the new ones into the tree.` : "Every vertex is in it."));
		}
		/**
		* The Topological sort button: lines the vertices up in topological order — or, once that
		* line-up is shown and the simulation offers a program to go on with (DFS: DAG shortest
		* paths), starts that program, as the button then says.
		*/
		topoClicked() {
			const next = this.editor.arrangement === "line" ? this.simulation?.followUp?.() ?? null : null;
			if (next) this.startFollowUp(next);
			else this.topologicalSort();
		}
		/**
		* Ends the finished run and starts `next` on the same graph (picked in the picker, from
		* `next.start`), keeping the topological line-up when the new program has one.
		*/
		startFollowUp(next) {
			if (next.blocked || !ALGORITHMS.some((a) => a.id === next.algorithm)) return;
			this.stop(null, { keepArrangement: true });
			this.el.select.value = next.algorithm;
			this.run(next.start);
			const simulation = this.simulation;
			if (!simulation) return;
			const diagram = simulation.topologicalSort?.() ?? null;
			if (diagram) this.editor.showArcDiagram(diagram);
			else this.editor.showArcDiagram(null);
			this.updateControls();
			this.hooks.message(simulation.describe());
		}
		/**
		* Ends the run and releases every lock. `message` (null: none) is shown with a note that
		* the graph can be edited again; `keepArrangement` leaves the vertices' arrangement (a
		* line-up) on, for a program that takes over.
		*/
		stop(message = "Stopped.", { keepArrangement = false } = {}) {
			if (!this.simulation) return;
			this.stopCycle();
			this.simulation = null;
			if (!keepArrangement) this.editor.showArcDiagram(null);
			this.editor.setHighlight(null);
			this.editor.setLocked(false);
			if (this.savedWeighting !== null) {
				this.editor.setWeighting(this.savedWeighting);
				this.syncSwitch(this.el.weightSwitch, this.graph.weighting);
				this.savedWeighting = null;
			}
			if (this.savedDirected !== null) {
				this.editor.setDirected(this.savedDirected);
				this.syncSwitch(this.el.directionSwitch, this.graph.directed ? "directed" : "undirected");
				this.savedDirected = null;
			}
			this.lockSwitch(this.el.weightSwitch, false);
			this.lockSwitch(this.el.directionSwitch, false);
			this.el.queueView?.update(null, false);
			if (this.el.queueCard) this.el.queueCard.hidden = true;
			this.el.priorityQueueView?.update(null, false);
			if (this.el.priorityQueueCard) this.el.priorityQueueCard.hidden = true;
			this.el.edgeQueueView?.update(null, false);
			if (this.el.edgeQueueCard) this.el.edgeQueueCard.hidden = true;
			this.el.stackView?.update(null, false);
			if (this.el.stackCard) this.el.stackCard.hidden = true;
			this.el.timelineView?.collapse(false);
			this.el.timelineView?.update(null, false);
			if (this.el.timestampsCard) this.el.timestampsCard.hidden = true;
			this.updateControls();
			this.hooks.onStateChange();
			if (message !== null) this.hooks.message(`${message} The graph can be edited again.`);
		}
		/** Draws the simulation's state; `animate` animates the queue / stack from its previous state. */
		show(animate) {
			const simulation = this.simulation;
			const highlight = simulation.highlight();
			this.editor.setHighlight(highlight);
			const queue = simulation.queueSnapshot?.() ?? null;
			if (this.el.queueCard) this.el.queueCard.hidden = queue === null;
			this.el.queueView?.update(queue, animate, highlight.labels);
			const priorityQueue = simulation.priorityQueueSnapshot?.() ?? null;
			if (this.el.priorityQueueCard) this.el.priorityQueueCard.hidden = priorityQueue === null;
			this.el.priorityQueueView?.update(priorityQueue, animate, highlight.labels);
			const edgeQueue = simulation.edgeQueueSnapshot?.() ?? null;
			if (this.el.edgeQueueCard) this.el.edgeQueueCard.hidden = edgeQueue === null;
			this.el.edgeQueueView?.update(edgeQueue, animate);
			const stack = simulation.stackSnapshot?.() ?? null;
			if (this.el.stackCard) this.el.stackCard.hidden = stack === null;
			this.el.stackView?.update(stack, animate, highlight.labels);
			const timestamps = simulation.timestamps?.() ?? null;
			if (this.el.timestampsCard) this.el.timestampsCard.hidden = timestamps === null;
			this.el.timelineView?.update(timestamps, animate);
			this.updateControls();
			this.hooks.onStateChange();
			this.hooks.message(simulation.describe());
		}
		updateControls() {
			const running = this.running;
			this.el.run.hidden = running;
			this.el.run.disabled = this.graph.nodeCount === 0;
			this.el.step.hidden = !running;
			this.el.stop.hidden = !running;
			this.el.step.textContent = this.simulation?.finished ? "Finish" : "Update";
			this.el.select.disabled = running;
			const topo = this.el.topo;
			if (topo) {
				const simulation = this.simulation;
				const diagram = simulation?.topologicalSort?.() ?? null;
				const next = this.editor.arrangement === "line" ? simulation?.followUp?.() ?? null : null;
				topo.hidden = diagram === null;
				topo.classList.toggle("primary", next !== null);
				topo.disabled = !!next?.blocked;
				if (next) {
					topo.textContent = next.label;
					topo.title = next.blocked ?? next.title;
					topo.removeAttribute("aria-pressed");
				} else {
					topo.textContent = "Topological sort";
					if (diagram?.backward?.length) topo.title = "No topological order (a backward edge means a cycle): lines the vertices up by decreasing finish time, backward edges in red.";
					else topo.removeAttribute("title");
					topo.setAttribute("aria-pressed", String(this.editor.arrangement === "line"));
				}
			}
			const cycle = this.el.cycle;
			if (cycle) {
				const simulation = this.simulation;
				cycle.hidden = !(simulation && typeof simulation.stepsLeftInPass === "function" && !simulation.finished);
				cycle.setAttribute("aria-pressed", String(this.playingCycle));
			}
			this.el.step.disabled = this.playingCycle;
			const tree = this.el.tree;
			if (tree) {
				tree.hidden = !(this.simulation && typeof this.simulation.searchTree === "function");
				tree.setAttribute("aria-pressed", String(this.editor.arrangement === "tree"));
			}
			const forest = this.el.forest;
			if (forest) {
				const simulation = this.simulation;
				forest.hidden = !(simulation && typeof simulation.searchForest === "function");
				forest.setAttribute("aria-pressed", String(this.editor.arrangement === "forest"));
			}
		}
		/** Re-checks Run's availability (e.g. after nodes were added or removed). */
		refresh() {
			this.updateControls();
		}
		/** Checks the switch's option with this value. */
		syncSwitch(fieldset, value) {
			for (const input of fieldset.querySelectorAll("input")) input.checked = input.value === value;
		}
		lockSwitch(fieldset, locked) {
			fieldset.disabled = locked;
			if (locked) fieldset.title = LOCKED_TITLE;
			else fieldset.removeAttribute("title");
		}
	};
	// src/select-menu.ts
	var SelectMenu = class {
		box;
		list;
		options = [];
		selectedIndex = 0;
		activeIndex = 0;
		valueEl;
		/** Called when the user picks a different option. */
		onChange = null;
		constructor(box, list) {
			this.box = box;
			this.list = list;
			this.valueEl = box.querySelector(".select-value") ?? box;
			box.addEventListener("click", () => this.isOpen ? this.close() : this.open());
			box.addEventListener("keydown", this.onKeyDown);
			box.addEventListener("blur", () => this.close());
			list.addEventListener("pointerdown", (e) => e.preventDefault());
			list.addEventListener("click", (e) => {
				const option = e.target.closest("[role=\"option\"]");
				if (!option) return;
				this.choose(Number(option.dataset.index));
				this.close();
			});
			list.addEventListener("pointermove", (e) => {
				const option = e.target.closest("[role=\"option\"]");
				if (option) this.setActive(Number(option.dataset.index));
			});
			document.addEventListener("pointerdown", (e) => {
				if (this.isOpen && !box.contains(e.target) && !list.contains(e.target)) this.close();
			});
		}
		setOptions(options) {
			this.options = options;
			this.list.replaceChildren(...options.map((o, i) => {
				const li = document.createElement("li");
				li.id = `${this.list.id}-option-${i}`;
				li.className = "select-option";
				li.setAttribute("role", "option");
				li.dataset.index = String(i);
				li.dataset.value = o.value;
				li.textContent = o.label;
				return li;
			}));
			this.selectedIndex = 0;
			this.render();
		}
		get value() {
			return this.options[this.selectedIndex]?.value ?? "";
		}
		set value(value) {
			const index = this.options.findIndex((o) => o.value === value);
			if (index >= 0) {
				this.selectedIndex = index;
				this.render();
			}
		}
		get disabled() {
			return this.box.getAttribute("aria-disabled") === "true";
		}
		set disabled(disabled) {
			if (disabled) {
				this.close();
				this.box.setAttribute("aria-disabled", "true");
				this.box.tabIndex = -1;
			} else {
				this.box.removeAttribute("aria-disabled");
				this.box.tabIndex = 0;
			}
		}
		get isOpen() {
			return this.box.getAttribute("aria-expanded") === "true";
		}
		open() {
			if (this.disabled || this.isOpen || this.options.length === 0) return;
			this.box.setAttribute("aria-expanded", "true");
			this.list.hidden = false;
			this.setActive(this.selectedIndex);
		}
		close() {
			if (!this.isOpen) return;
			this.box.setAttribute("aria-expanded", "false");
			this.box.removeAttribute("aria-activedescendant");
			this.list.hidden = true;
		}
		onKeyDown = (e) => {
			if (this.disabled) return;
			const last = this.options.length - 1;
			if (!this.isOpen) {
				if ([
					"ArrowDown",
					"ArrowUp",
					"Enter",
					" ",
					"Home",
					"End"
				].includes(e.key)) {
					e.preventDefault();
					this.open();
					if (e.key === "Home") this.setActive(0);
					if (e.key === "End") this.setActive(last);
				}
				return;
			}
			switch (e.key) {
				case "ArrowDown":
					e.preventDefault();
					this.setActive(Math.min(last, this.activeIndex + 1));
					break;
				case "ArrowUp":
					e.preventDefault();
					this.setActive(Math.max(0, this.activeIndex - 1));
					break;
				case "Home":
					e.preventDefault();
					this.setActive(0);
					break;
				case "End":
					e.preventDefault();
					this.setActive(last);
					break;
				case "Enter":
				case " ":
					e.preventDefault();
					this.choose(this.activeIndex);
					this.close();
					break;
				case "Escape":
					e.preventDefault();
					e.stopPropagation();
					this.close();
					break;
				case "Tab":
					this.choose(this.activeIndex);
					this.close();
			}
		};
		setActive(index) {
			this.activeIndex = index;
			const options = this.list.querySelectorAll("[role=\"option\"]");
			options.forEach((o, i) => o.classList.toggle("active", i === index));
			const active = options[index];
			if (active) {
				this.box.setAttribute("aria-activedescendant", active.id);
				active.scrollIntoView?.({ block: "nearest" });
			}
		}
		choose(index) {
			if (index === this.selectedIndex) return;
			this.selectedIndex = index;
			this.render();
			this.onChange?.(this.value);
		}
		render() {
			this.valueEl.textContent = this.options[this.selectedIndex]?.label ?? "";
			this.list.querySelectorAll("[role=\"option\"]").forEach((o, i) => {
				o.setAttribute("aria-selected", String(i === this.selectedIndex));
			});
		}
	};
	// src/queue-view.ts
	/**
	* Draws an algorithm's queue (BFS), min-priority queue (Prim) or recursion stack (DFS) as
	* a horizontal strip in the side panel:
	*
	*   queue:  ← pop  (front) (…) (back)  (incoming…)  ← push
	*   priority queue:  ← min  (smallest key) (…) (largest key)
	*   stack:  ← pop   (incoming) (top) (…) (bottom)
	*           → push
	*
	* Vertices are drawn like the canvas nodes (ringed circle with the id), smaller. The
	* vertex the next step works on — the queue's front, the stack's top — has the canvas's
	* white "current" ring; the vertices the next step will push are greyed out where they
	* will land. A stack's other vertices are still running, so they have the canvas's
	* yellow ring; its two arrows share the open (left) end, and the one the next step uses
	* is highlighted. A priority queue is drawn in extraction order, so vertices glide to
	* their new places when their keys change.
	*
	* `update()` animates the change from the previous snapshot (FLIP): the popped vertex
	* turns green and slides out to the left, the rest glide into their new places,
	* incoming vertices fill in as they join the queue, and new incoming ones fade in. With
	* `prefers-reduced-motion`, or `animate = false`, it updates instantly. The strip
	* scrolls horizontally when it overflows.
	*/
	const DURATION$1 = 340;
	const EASING$2 = "cubic-bezier(0.2, 0.7, 0.2, 1)";
	const ARROW_LEFT$1 = "<svg viewBox=\"0 0 24 14\" width=\"24\" height=\"14\" aria-hidden=\"true\"><path d=\"M22 7H3M8 2L3 7l5 5\" /></svg>";
	const ARROW_RIGHT = "<svg viewBox=\"0 0 24 14\" width=\"24\" height=\"14\" aria-hidden=\"true\"><path d=\"M2 7h19M16 2l5 5-5 5\" /></svg>";
	/** Width (px) a label may use inside a strip vertex, and its largest font size. */
	const LABEL_WIDTH = 22;
	const LABEL_FONT = 12;
	var QueueView = class {
		strip;
		emptyNote;
		/**
		* Called with `true` while the pointer is over (or keyboard focus is in) the strip, and
		* `false` when it leaves: vertex labels then switch back to ids, here and on the canvas.
		*/
		onPeek = null;
		labels;
		options;
		/** Stack only: whether the next step pops the top / pushes something (lights its arrow). */
		popping = false;
		pushing = false;
		constructor(strip, emptyNote, options = {}) {
			this.strip = strip;
			this.emptyNote = emptyNote;
			const kind = options.kind ?? "queue";
			const describeLabel = (label) => kind === "priority" ? `key ${label}` : `distance ${label}`;
			this.options = {
				kind,
				describeLabel,
				peekIds: kind !== "priority",
				...options
			};
			strip.classList.add(`strip-${this.options.kind}`);
			const peek = (on) => {
				const { peekIds } = this.options;
				strip.classList.toggle("peek-ids", on && (typeof peekIds === "function" ? peekIds() : peekIds));
				this.onPeek?.(on);
			};
			strip.addEventListener("pointerenter", () => peek(true));
			strip.addEventListener("pointerleave", () => peek(strip.contains(document.activeElement)));
			strip.addEventListener("focusin", () => peek(true));
			strip.addEventListener("focusout", () => peek(strip.matches(":hover")));
		}
		/**
		* Shows `snapshot` (or nothing, for null), animating from the previous one if asked.
		* `labels` (e.g. BFS distances, DFS times) are drawn inside the vertices instead of
		* their ids; vertices without a label are left blank. Hovering the strip shows the ids.
		*/
		update(snapshot, animate, labels) {
			this.labels = labels;
			this.popping = !!snapshot && "popping" in snapshot && snapshot.popping;
			this.pushing = !!snapshot && snapshot.incoming.length > 0;
			this.strip.classList.toggle("has-labels", !!labels);
			const motion = animate && canAnimate$3() && !prefersReducedMotion$3();
			const live = this.liveElements();
			const before = /* @__PURE__ */ new Map();
			for (const [key, el] of live) before.set(key, el.getBoundingClientRect());
			const items = snapshot ? this.items(snapshot) : [];
			const wanted = new Set(items.map((i) => i.key));
			for (const [key, el] of live) {
				if (wanted.has(key)) continue;
				if (!motion) {
					el.remove();
					continue;
				}
				const left = el.offsetLeft;
				const top = el.offsetTop;
				el.classList.add("exiting");
				if (el.classList.contains("front")) el.classList.add("popped");
				el.removeAttribute("role");
				el.setAttribute("aria-hidden", "true");
				Object.assign(el.style, {
					position: "absolute",
					left: `${left}px`,
					top: `${top}px`,
					margin: "0"
				});
				el.animate([{
					transform: "none",
					opacity: 1
				}, {
					transform: "translateX(-32px)",
					opacity: 0
				}], {
					duration: DURATION$1,
					easing: EASING$2,
					fill: "forwards"
				}).finished.then(() => el.remove(), () => el.remove());
			}
			const ordered = items.map((item) => {
				const el = live.get(item.key) ?? this.create(item);
				this.apply(el, item);
				return el;
			});
			for (const el of ordered) this.strip.append(el);
			const empty = !!snapshot && items.length === 0;
			this.emptyNote.hidden = !empty;
			this.strip.hidden = !snapshot || empty;
			if (!motion) return;
			for (const el of ordered) {
				const key = el.dataset.key;
				const was = before.get(key);
				for (const running of el.getAnimations()) running.cancel();
				if (was) {
					const now = el.getBoundingClientRect();
					const dx = was.left - now.left;
					if (Math.abs(dx) > .5) el.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], {
						duration: DURATION$1,
						easing: EASING$2
					});
				} else {
					const from = this.options.kind === "stack" ? -16 : 16;
					el.animate([{
						opacity: 0,
						transform: `translateX(${from}px) scale(0.8)`
					}], {
						duration: DURATION$1,
						easing: EASING$2
					});
				}
			}
		}
		items(snapshot) {
			const items = [];
			if (this.options.kind === "stack") {
				if (snapshot.items.length || snapshot.incoming.length) items.push({
					key: "ends",
					kind: "ends"
				});
				for (const id of [...snapshot.incoming].reverse()) items.push({
					key: `v${id}`,
					kind: "incoming",
					id
				});
				snapshot.items.forEach((id, i) => items.push({
					key: `v${id}`,
					kind: i === 0 ? "front" : "queued",
					id
				}));
				return items;
			}
			if (snapshot.items.length) items.push({
				key: "pop",
				kind: "pop"
			});
			snapshot.items.forEach((id, i) => items.push({
				key: `v${id}`,
				kind: i === 0 ? "front" : "queued",
				id
			}));
			for (const id of snapshot.incoming) items.push({
				key: `v${id}`,
				kind: "incoming",
				id
			});
			if (snapshot.incoming.length) items.push({
				key: "push",
				kind: "push"
			});
			return items;
		}
		/** Current (non-leaving) elements by key. */
		liveElements() {
			const map = /* @__PURE__ */ new Map();
			for (const el of this.strip.querySelectorAll(":scope > [data-key]:not(.exiting)")) map.set(el.dataset.key, el);
			return map;
		}
		create(item) {
			const el = document.createElement(item.id === void 0 ? "span" : "div");
			el.dataset.key = item.key;
			if (item.kind === "ends") {
				el.className = "q-ends";
				el.setAttribute("aria-hidden", "true");
				el.innerHTML = `<span class="q-arrow q-pop">${ARROW_LEFT$1}<span>pop</span></span><span class="q-arrow q-push">${ARROW_RIGHT}<span>push</span></span>`;
			} else if (item.kind === "pop" || item.kind === "push") {
				el.className = `q-arrow q-${item.kind}`;
				el.setAttribute("aria-hidden", "true");
				const text = item.kind === "pop" && this.options.kind === "priority" ? "min" : item.kind;
				el.innerHTML = `${ARROW_LEFT$1}<span>${text}</span>`;
			} else {
				el.className = "q-node";
				el.setAttribute("role", "listitem");
				const index = document.createElement("span");
				index.className = "q-index";
				index.textContent = String(item.id);
				const label = document.createElement("span");
				label.className = "q-label";
				el.append(index, label);
			}
			return el;
		}
		apply(el, item) {
			const stack = this.options.kind === "stack";
			if (item.kind === "ends") {
				el.querySelector(".q-pop").classList.toggle("active", this.popping);
				el.querySelector(".q-push").classList.toggle("active", this.pushing);
				return;
			}
			if (item.id === void 0) return;
			el.classList.toggle("front", item.kind === "front");
			el.classList.toggle("incoming", item.kind === "incoming");
			el.classList.toggle("running", stack && item.kind === "queued");
			const label = this.labels?.[item.id];
			const labelEl = el.querySelector(".q-label");
			labelEl.textContent = label ?? "";
			const size = fitFontSize(label ?? "", LABEL_WIDTH, LABEL_FONT);
			labelEl.style.fontSize = size < LABEL_FONT ? `${size}px` : "";
			let role = "";
			if (item.kind === "incoming") role = ", about to be pushed";
			else if (item.kind === "front") {
				if (stack) role = this.popping ? ", top, next to be popped" : ", top";
				else role = this.options.kind === "priority" ? ", smallest key, next to be extracted" : ", next to be popped";
			}
			const described = label !== void 0 ? `, ${this.options.describeLabel(label)}` : "";
			el.setAttribute("aria-label", `${item.id}${described}${role}`);
		}
	};
	function canAnimate$3() {
		return typeof Element !== "undefined" && typeof Element.prototype.animate === "function";
	}
	function prefersReducedMotion$3() {
		return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
	}
	// src/status-bar.ts
	const DEFAULTS = {
		hideAfterMs: 5e3,
		revealDistance: 64,
		revealSlack: 48
	};
	/** Duration and easing of the size change when a new message arrives. */
	const RESIZE_MS = 260;
	const RESIZE_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";
	var StatusBar = class {
		bar;
		area;
		options;
		timer = null;
		hovered = false;
		near = false;
		/** The text lives in its own element so it can be faded and held at its final width. */
		text;
		/** The running size and fade animations (not the CSS slide, which must not be cut short). */
		resizing = null;
		fading = null;
		constructor(bar, area, options = {}) {
			this.bar = bar;
			this.area = area;
			this.options = {
				...DEFAULTS,
				...options
			};
			this.text = document.createElement("span");
			this.text.className = "message-text";
			this.text.textContent = bar.textContent?.trim() ?? "";
			bar.replaceChildren(this.text);
			bar.addEventListener("pointerenter", () => {
				this.hovered = true;
				this.reveal();
			});
			bar.addEventListener("pointerleave", () => {
				this.hovered = false;
				this.restartCountdown();
			});
			area.addEventListener("pointermove", this.onPointer);
			area.addEventListener("pointerdown", this.onPointer);
			area.addEventListener("pointerleave", () => this.setNear(false));
		}
		/** Displays a message (replacing the previous one) and brings the bar into view. */
		show(text, tone = "info") {
			const before = this.visible && canAnimate$2() && !prefersReducedMotion$2() ? this.bar.getBoundingClientRect() : null;
			this.resizing?.cancel();
			this.fading?.cancel();
			this.resizing = this.fading = null;
			this.releaseText();
			this.text.textContent = text;
			this.bar.dataset.tone = tone;
			if (before) this.resizeSmoothly(before);
			this.reveal();
			this.restartCountdown();
		}
		/**
		* Animates the bar from its previous size to the one the new text needs, fading the
		* text in. From the first frame the text is laid out exactly as it will be at the end
		* (same width, same line breaks); while the bar is still smaller, it clips whatever
		* doesn't fit yet (`overflow: hidden`), keeping the text centred.
		*/
		resizeSmoothly(before) {
			const after = this.bar.getBoundingClientRect();
			const timing = {
				duration: RESIZE_MS,
				easing: RESIZE_EASING
			};
			this.fading = this.text.animate([{ opacity: 0 }, { opacity: 1 }], timing);
			this.fading.finished.catch(() => {});
			if (Math.abs(after.width - before.width) < .5 && Math.abs(after.height - before.height) < .5) return;
			this.text.style.width = `${Math.ceil(this.text.getBoundingClientRect().width)}px`;
			this.text.style.maxWidth = "none";
			const resizing = this.bar.animate([{
				width: `${before.width}px`,
				height: `${before.height}px`
			}, {
				width: `${after.width}px`,
				height: `${after.height}px`
			}], timing);
			this.resizing = resizing;
			resizing.finished.then(() => {
				if (this.resizing === resizing) this.releaseText();
			}, () => {});
		}
		/** Lets the text follow the bar's size again (normal wrapping on narrow screens). */
		releaseText() {
			this.text.style.width = "";
			this.text.style.maxWidth = "";
		}
		/** Whether the bar is currently shown (or sliding into view). */
		get visible() {
			return !this.bar.classList.contains("is-hidden");
		}
		reveal() {
			this.bar.classList.remove("is-hidden");
		}
		restartCountdown() {
			if (this.timer !== null) clearTimeout(this.timer);
			this.timer = setTimeout(() => {
				this.timer = null;
				if (this.hovered || this.near) return;
				this.bar.classList.add("is-hidden");
			}, this.options.hideAfterMs);
		}
		onPointer = (e) => {
			this.setNear(this.isNear(e.clientX, e.clientY));
		};
		setNear(near) {
			if (near === this.near) return;
			this.near = near;
			if (near) this.reveal();
			else this.restartCountdown();
		}
		/** Is the point in the band along the area's bottom edge, around the bar's position? */
		isNear(x, y) {
			const area = this.area.getBoundingClientRect();
			const bar = this.bar.getBoundingClientRect();
			const { revealDistance, revealSlack } = this.options;
			return y >= area.bottom - revealDistance && y <= area.bottom && x >= bar.left - revealSlack && x <= bar.right + revealSlack;
		}
	};
	function canAnimate$2() {
		return typeof Element !== "undefined" && typeof Element.prototype.animate === "function";
	}
	function prefersReducedMotion$2() {
		return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
	}
	// src/timeline-view.ts
	/**
	* The DFS timestamp chart in the side panel: one bar per discovered vertex from its
	* discovery time d to its finish time f, on a time axis 1 … 2n, with each vertex on the
	* row of its depth in the depth-first forest. By the parenthesis theorem a descendant's
	* bar then sits below, and inside, its ancestor's.
	*
	*  - running bars (no f yet) reach the current time and trail off, in the canvas's
	*    yellow; finished bars are green; the bar of the vertex the next step works on has
	*    the canvas's white ring;
	*  - a "now" line and the highlighted axis label mark the current time; the chart
	*    scrolls (both ways) when it overflows, following the current time;
	*  - bars are positioned with CSS custom properties (--start, --stop, --row), so they
	*    grow and move with CSS transitions, and the scale (--unit, --row-h) can change.
	*
	* A button in the chart's bottom-right corner (shown on hover / focus) expands the whole
	* card into a modal dialog centred on the screen, over a darkened, blurred page; the
	* same button shrinks it back to its place in the panel. Both ways animate from one
	* position to the other (instant with prefers-reduced-motion).
	*/
	const ENTER_MS = 380;
	const LEAVE_MS = 320;
	const EASING$1 = "cubic-bezier(0.2, 0.8, 0.2, 1)";
	var TimelineView = class {
		el;
		chart;
		plot;
		axis;
		now;
		bars = /* @__PURE__ */ new Map();
		end = 0;
		clock = 0;
		current = null;
		/** Stands in for the card in the panel while it is expanded. */
		placeholder;
		/** The dialog's and its backdrop's running animations (the shrink ones hold their end state). */
		animations = [];
		constructor(el) {
			this.el = el;
			this.chart = div("tl-chart");
			this.plot = div("tl-plot");
			this.axis = div("tl-axis");
			this.axis.setAttribute("aria-hidden", "true");
			this.now = div("tl-now");
			this.now.setAttribute("aria-hidden", "true");
			this.plot.append(this.now);
			this.chart.append(this.plot, this.axis);
			el.scroll.replaceChildren(this.chart);
			window.addEventListener("resize", () => this.fitWidth());
			this.placeholder = div("info-card tl-placeholder");
			this.placeholder.setAttribute("aria-hidden", "true");
			el.expand.addEventListener("click", () => this.expanded ? this.collapse() : this.expand());
			el.dialog.addEventListener("cancel", (e) => e.preventDefault());
			el.dialog.addEventListener("keydown", (e) => {
				if (e.key !== "Escape") return;
				e.preventDefault();
				e.stopPropagation();
				this.collapse();
			});
			el.dialog.addEventListener("click", (e) => {
				if (e.target === el.dialog) this.collapse();
			});
		}
		get expanded() {
			return this.el.dialog.open;
		}
		/** Shows `snapshot` (or clears the chart, for null). `animate` lets bars grow / fade in. */
		update(snapshot, animate) {
			if (!snapshot) {
				for (const bar of this.bars.values()) bar.remove();
				this.bars.clear();
				this.setEnd(0);
				this.clock = 0;
				this.current = null;
				this.now.hidden = true;
				return;
			}
			const motion = animate && canAnimate$1() && !prefersReducedMotion$1();
			this.setEnd(snapshot.end);
			this.clock = snapshot.clock;
			this.current = snapshot.current;
			const rows = Math.max(1, ...snapshot.intervals.map((i) => i.depth + 1));
			this.chart.style.setProperty("--rows", String(rows));
			const live = /* @__PURE__ */ new Set();
			for (const interval of snapshot.intervals) {
				live.add(interval.id);
				let bar = this.bars.get(interval.id);
				const fresh = !bar;
				if (!bar) {
					bar = div("tl-bar");
					bar.dataset.id = String(interval.id);
					bar.setAttribute("role", "listitem");
					bar.textContent = String(interval.id);
					this.plot.insertBefore(bar, this.now);
					this.bars.set(interval.id, bar);
				}
				const running = interval.finish === null;
				bar.style.setProperty("--start", String(interval.start));
				bar.style.setProperty("--stop", String(running ? snapshot.clock : interval.finish));
				bar.style.setProperty("--row", String(interval.depth));
				bar.classList.toggle("running", running);
				bar.classList.toggle("current", interval.id === snapshot.current);
				const label = running ? `Vertex ${interval.id}: discovered at ${interval.start}, still running` : `Vertex ${interval.id}: discovered at ${interval.start}, finished at ${interval.finish}`;
				bar.setAttribute("aria-label", label);
				bar.title = label;
				if (fresh && motion) bar.animate([{
					opacity: 0,
					transform: "scaleX(0.6)"
				}, {
					opacity: 1,
					transform: "none"
				}], {
					duration: 300,
					easing: EASING$1
				});
			}
			for (const [id, bar] of this.bars) if (!live.has(id)) {
				bar.remove();
				this.bars.delete(id);
			}
			this.fitWidth();
			this.now.hidden = snapshot.clock < 1;
			this.now.style.setProperty("--t", String(Math.max(1, snapshot.clock)));
			for (const label of this.axis.children) label.classList.toggle("now", Number(label.dataset.t) === snapshot.clock);
			this.followClock(motion);
		}
		/** Expands the card into a dialog in the middle of the screen. */
		expand() {
			if (this.expanded) return;
			const { card, dialog, expand } = this.el;
			const before = card.getBoundingClientRect();
			this.placeholder.style.height = `${before.height}px`;
			card.replaceWith(this.placeholder);
			dialog.append(card);
			card.classList.add("tl-expanded");
			card.querySelector(".card-toggle")?.setAttribute("disabled", "");
			dialog.showModal();
			this.fitWidth();
			this.setButton(true);
			expand.focus();
			this.animateBetween(before, dialog.getBoundingClientRect(), ENTER_MS, false);
			this.followClock(false);
		}
		/** Shrinks the dialog back into the card's place in the panel. */
		collapse(animate = true) {
			if (!this.expanded) return;
			const { card, dialog } = this.el;
			const from = dialog.getBoundingClientRect();
			const to = this.placeholder.getBoundingClientRect();
			card.classList.remove("tl-expanded");
			this.fitWidth(to.width - (from.width - this.el.scroll.clientWidth));
			this.setButton(false);
			const done = () => {
				dialog.close();
				this.cancelAnimations();
				this.placeholder.replaceWith(card);
				card.querySelector(".card-toggle")?.removeAttribute("disabled");
				this.fitWidth();
				if (animate) this.el.expand.focus();
				this.followClock(false);
			};
			if (!(animate && canAnimate$1() && !prefersReducedMotion$1() && to.width > 0)) {
				this.cancelAnimations();
				done();
				return;
			}
			this.animateBetween(from, to, LEAVE_MS, true)?.finished.then(done, () => {});
		}
		/** Animates the dialog from one rectangle to another, fading the backdrop in or out. */
		animateBetween(from, to, duration, leaving) {
			if (!canAnimate$1() || prefersReducedMotion$1() || from.width === 0) return null;
			this.cancelAnimations();
			const box = (r) => ({
				left: `${r.left}px`,
				top: `${r.top}px`,
				width: `${r.width}px`,
				height: `${r.height}px`,
				translate: "none"
			});
			const timing = {
				duration,
				easing: EASING$1,
				fill: leaving ? "forwards" : "none"
			};
			const moving = this.el.dialog.animate([box(from), box(to)], timing);
			this.animations = [moving];
			try {
				const fade = [{ opacity: 0 }, { opacity: 1 }];
				this.animations.push(this.el.dialog.animate(leaving ? fade.reverse() : fade, {
					...timing,
					pseudoElement: "::backdrop"
				}));
			} catch {}
			return moving;
		}
		cancelAnimations() {
			for (const a of this.animations) a.cancel();
			this.animations = [];
		}
		setButton(expanded) {
			this.el.expand.setAttribute("aria-expanded", String(expanded));
			this.el.expand.setAttribute("aria-label", expanded ? "Shrink the timestamp chart" : "Expand the timestamp chart");
			this.el.expand.title = expanded ? "Shrink back (Esc)" : "Expand";
		}
		/**
		* Widens the time step (from its minimum, --unit-min) so the axis spans the whole
		* width when it would otherwise stop short; never narrows it (the chart scrolls instead).
		* `width` is the chart area's width to fit, if it is not the current one (mid-move).
		*/
		fitWidth(width = this.el.scroll.clientWidth) {
			const style = getComputedStyle(this.el.scroll);
			const min = parseFloat(style.getPropertyValue("--unit-min")) || 0;
			const pad = parseFloat(style.getPropertyValue("--pad")) || 0;
			if (!min || this.end < 2 || width <= 0) {
				this.chart.style.removeProperty("--fit-unit");
				return;
			}
			const fit = Math.max(min, (width - 2 * pad) / (this.end - 1));
			this.chart.style.setProperty("--fit-unit", `${Math.floor(fit * 100) / 100}px`);
		}
		/** Redraws the grid and axis labels for times 1 … end. */
		setEnd(end) {
			if (end === this.end) return;
			this.end = end;
			this.chart.style.setProperty("--end", String(Math.max(end, 1)));
			for (const tick of this.plot.querySelectorAll(".tl-tick")) tick.remove();
			this.axis.replaceChildren();
			for (let t = 1; t <= end; t++) {
				const tick = div("tl-tick");
				tick.style.setProperty("--t", String(t));
				this.plot.prepend(tick);
				const label = document.createElement("span");
				label.dataset.t = String(t);
				label.style.setProperty("--t", String(t));
				label.textContent = String(t);
				this.axis.append(label);
			}
		}
		/** Scrolls so the current time (and the white bar's row) are in view. */
		followClock(smooth) {
			const scroll = this.el.scroll;
			const style = getComputedStyle(this.chart);
			const unit = parseFloat(style.getPropertyValue("--unit")) || 0;
			const pad = parseFloat(style.getPropertyValue("--pad")) || 0;
			const rowH = parseFloat(style.getPropertyValue("--row-h")) || 0;
			if (!unit || scroll.clientWidth === 0) return;
			const x = pad + (Math.max(1, this.clock) - 1) * unit;
			let left = scroll.scrollLeft;
			if (x < left + unit || x > left + scroll.clientWidth - 2 * unit) left = Math.max(0, x - scroll.clientWidth * .6);
			let top = scroll.scrollTop;
			const row = this.current === null ? null : Number(this.bars.get(this.current)?.style.getPropertyValue("--row"));
			if (row !== null && !Number.isNaN(row) && rowH) {
				const y = row * rowH;
				const visible = scroll.clientHeight - 32;
				if (y < top || y + rowH > top + visible) top = Math.max(0, y - visible / 2);
			}
			if (left === scroll.scrollLeft && top === scroll.scrollTop) return;
			if (typeof scroll.scrollTo === "function") scroll.scrollTo({
				left,
				top,
				behavior: smooth ? "smooth" : "auto"
			});
		}
	};
	function div(className) {
		const el = document.createElement("div");
		el.className = className;
		return el;
	}
	function canAnimate$1() {
		return typeof Element !== "undefined" && typeof Element.prototype.animate === "function";
	}
	function prefersReducedMotion$1() {
		return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
	}
	// src/edge-queue-view.ts
	/**
	* Draws a list of edges waiting their turn (Kruskal's edges in sorted order) as a
	* horizontal strip in the side panel:
	*
	*   ← next  [1 — 2 · 2] [0 — 1 · 4] [1 — 3 · 5] …
	*
	* Each edge is a pill with its ends and weight; the first is the one the next step
	* considers. `update()` animates the change (FLIP, like QueueView): the edge just taken
	* slides out to the left — green if it was added, faded and struck through if skipped —
	* and the rest glide into place. Instant with prefers-reduced-motion. Hovering (or
	* focusing) the strip calls `onPeek`, for the canvas to show the vertices' labels.
	*/
	const DURATION = 340;
	const EASING = "cubic-bezier(0.2, 0.7, 0.2, 1)";
	const ARROW_LEFT = "<svg viewBox=\"0 0 24 14\" width=\"24\" height=\"14\" aria-hidden=\"true\"><path d=\"M22 7H3M8 2L3 7l5 5\" /></svg>";
	const keyOf = (e) => `e${e.from}-${e.to}`;
	var EdgeQueueView = class {
		strip;
		emptyNote;
		/** Called with true while the pointer is over (or focus is in) the strip, false when it leaves. */
		onPeek = null;
		constructor(strip, emptyNote) {
			this.strip = strip;
			this.emptyNote = emptyNote;
			const peek = (on) => this.onPeek?.(on);
			strip.addEventListener("pointerenter", () => peek(true));
			strip.addEventListener("pointerleave", () => peek(strip.contains(document.activeElement)));
			strip.addEventListener("focusin", () => peek(true));
			strip.addEventListener("focusout", () => peek(strip.matches(":hover")));
		}
		update(snapshot, animate) {
			const motion = animate && canAnimate() && !prefersReducedMotion();
			const live = /* @__PURE__ */ new Map();
			for (const el of this.strip.querySelectorAll(":scope > [data-key]:not(.exiting)")) live.set(el.dataset.key, el);
			const before = /* @__PURE__ */ new Map();
			for (const [key, el] of live) before.set(key, el.getBoundingClientRect());
			const items = snapshot?.items ?? [];
			const wanted = new Set(items.map(keyOf));
			if (items.length) wanted.add("next");
			for (const [key, el] of live) {
				if (wanted.has(key)) continue;
				if (!motion) {
					el.remove();
					continue;
				}
				const left = el.offsetLeft;
				const top = el.offsetTop;
				const last = snapshot?.last;
				if (last && keyOf(last) === key) el.classList.add(last.added ? "added" : "skipped");
				el.classList.add("exiting");
				el.removeAttribute("role");
				el.setAttribute("aria-hidden", "true");
				Object.assign(el.style, {
					position: "absolute",
					left: `${left}px`,
					top: `${top}px`,
					margin: "0"
				});
				el.animate([{
					transform: "none",
					opacity: 1
				}, {
					transform: "translateX(-32px)",
					opacity: 0
				}], {
					duration: DURATION,
					easing: EASING,
					fill: "forwards"
				}).finished.then(() => el.remove(), () => el.remove());
			}
			const ordered = [];
			if (items.length) ordered.push(live.get("next") ?? this.createArrow());
			items.forEach((edge, i) => {
				const el = live.get(keyOf(edge)) ?? this.createPill(edge);
				el.classList.toggle("front", i === 0);
				el.setAttribute("aria-label", `Edge ${edge.from} — ${edge.to}, weight ${edge.weight}${i === 0 ? ", next" : ""}`);
				ordered.push(el);
			});
			for (const el of ordered) this.strip.append(el);
			const empty = !!snapshot && items.length === 0;
			this.emptyNote.hidden = !empty;
			this.strip.hidden = !snapshot || empty;
			if (!motion) return;
			for (const el of ordered) {
				for (const running of el.getAnimations()) running.cancel();
				const was = before.get(el.dataset.key);
				if (was) {
					const dx = was.left - el.getBoundingClientRect().left;
					if (Math.abs(dx) > .5) el.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], {
						duration: DURATION,
						easing: EASING
					});
				} else el.animate([{
					opacity: 0,
					transform: "translateX(16px) scale(0.8)"
				}], {
					duration: DURATION,
					easing: EASING
				});
			}
		}
		createArrow() {
			const el = document.createElement("span");
			el.dataset.key = "next";
			el.className = "q-arrow q-pop";
			el.setAttribute("aria-hidden", "true");
			el.innerHTML = `${ARROW_LEFT}<span>next</span>`;
			return el;
		}
		createPill(edge) {
			const el = document.createElement("div");
			el.dataset.key = keyOf(edge);
			el.className = "q-edge";
			el.setAttribute("role", "listitem");
			const ends = document.createElement("span");
			ends.className = "q-edge-ends";
			ends.textContent = `${edge.from} — ${edge.to}`;
			const weight = document.createElement("span");
			weight.className = "q-edge-weight";
			weight.textContent = String(edge.weight);
			el.append(ends, weight);
			return el;
		}
	};
	function canAnimate() {
		return typeof Element !== "undefined" && typeof Element.prototype.animate === "function";
	}
	function prefersReducedMotion() {
		return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
	}
	// src/main.ts
	followColorScheme();
	const svg = document.querySelector("#canvas");
	const stats = document.querySelector("#stats");
	const messageEl = document.querySelector("#message");
	const adjacencyEl = document.querySelector("#adjacency");
	const matrixEl = document.querySelector("#adjacency-matrix");
	const listNote = document.querySelector("#list-note");
	const matrixNote = document.querySelector("#matrix-note");
	const modeInputs = document.querySelectorAll("input[name=\"edge-mode\"]");
	const weightInputs = document.querySelectorAll("input[name=\"weight-mode\"]");
	const toolbar = document.querySelector(".canvas-toolbar");
	const clearBtn = document.querySelector("#clear-btn");
	const randomBtn = document.querySelector("#random-btn");
	const layoutBtn = document.querySelector("#layout-toggle");
	const layoutState = layoutBtn.querySelector(".state");
	const panelBtn = document.querySelector("#panel-toggle");
	const panel = document.querySelector("#info-panel");
	const graph = new Graph();
	let runner;
	function refreshPanels() {
		const n = graph.nodeCount;
		const m = graph.edgeCount;
		stats.textContent = `${n} node${n === 1 ? "" : "s"} · ${m} edge${m === 1 ? "" : "s"}`;
		clearBtn.disabled = n === 0 || (runner?.running ?? false);
		randomBtn.disabled = runner?.running ?? false;
		runner?.refresh();
		const focus = runner?.representationEdge ?? null;
		renderAdjacencyList(adjacencyEl, graph.currentView, focus);
		renderAdjacencyMatrix(matrixEl, graph.currentView, focus);
		listNote.textContent = (graph.directed ? "Each node followed by the nodes its edges point to." : "Each node followed by its neighbours.") + (graph.weighted ? " Each box shows the neighbour (top) and the edge weight (bottom)." : "");
		matrixNote.textContent = graph.weighted ? graph.directed ? "Row r, column c is the weight of the edge r → c; — means no edge." : "Each cell is the weight of the edge between the row and column nodes; — means no edge. If edges run both ways with different weights, the smaller is shown." : graph.directed ? "Row r, column c is 1 when there is an edge r → c, so the matrix need not be symmetric." : "1 marks an edge between the row and column nodes. The matrix is symmetric because edges are undirected.";
		if (graph.weighting === "positive") {
			const positive = " Positive: every weight is shown, and used, as its magnitude (−5 as 5).";
			listNote.textContent += positive;
			matrixNote.textContent += positive;
		}
		placePanel();
	}
	/** Opens the ☰ panel below the toolbar when the toolbar would otherwise overlap it. */
	function placePanel() {
		if (panel.hasAttribute("hidden")) return;
		panel.style.removeProperty("--panel-top");
		const bar = toolbar.getBoundingClientRect();
		const box = panel.getBoundingClientRect();
		if (bar.right > box.left - 8) {
			const wrapTop = panel.offsetParent.getBoundingClientRect().top;
			panel.style.setProperty("--panel-top", `${Math.ceil(bar.bottom - wrapTop + 8)}px`);
		}
	}
	window.addEventListener("resize", placePanel);
	setupTabs(document.querySelector(".rep-tabs"));
	const statusBar = new StatusBar(messageEl, document.querySelector(".canvas-wrap"));
	function showMessage(text, tone = "info") {
		statusBar.show(text, tone);
	}
	const editor = new GraphEditor(svg, graph, {
		onChange: refreshPanels,
		onMessage: showMessage,
		canvasInsets: () => ({
			top: Math.max(0, toolbar.getBoundingClientRect().bottom - svg.getBoundingClientRect().top) + 16,
			bottom: 96
		}),
		onAutoLayoutChange: (enabled) => {
			layoutBtn.setAttribute("aria-pressed", String(enabled));
			layoutState.textContent = enabled ? "On" : "Off";
		}
	});
	clearBtn.addEventListener("click", () => editor.clear());
	randomBtn.addEventListener("click", () => editor.randomise());
	const queueView = new QueueView(document.querySelector("#queue-strip"), document.querySelector("#queue-empty"));
	queueView.onPeek = (peek) => editor.setPeek(peek ? "ids" : null);
	const compactVertices = () => svg.classList.contains("sim-compact");
	const priorityQueueView = new QueueView(document.querySelector("#pq-strip"), document.querySelector("#pq-empty"), {
		kind: "priority",
		peekIds: () => !compactVertices()
	});
	priorityQueueView.onPeek = (peek) => editor.setPeek(peek ? compactVertices() ? "labels" : "ids" : null);
	const edgeQueueView = new EdgeQueueView(document.querySelector("#edges-strip"), document.querySelector("#edges-empty"));
	edgeQueueView.onPeek = (peek) => editor.setPeek(peek ? "labels" : null);
	const stackView = new QueueView(document.querySelector("#stack-strip"), document.querySelector("#stack-empty"), {
		kind: "stack",
		describeLabel: (label) => {
			const [d, f] = label.split(",");
			return f ? `discovered at ${d}, finished at ${f}` : `discovered at ${d}`;
		}
	});
	stackView.onPeek = (peek) => editor.setPeek(peek ? "ids" : null);
	for (const inner of [adjacencyEl, matrixEl]) {
		inner.addEventListener("pointerenter", () => editor.setPeek("ids"));
		inner.addEventListener("pointerleave", () => editor.setPeek(null));
	}
	const timelineView = new TimelineView({
		card: document.querySelector("#timestamps-card"),
		scroll: document.querySelector("#timestamps-chart"),
		expand: document.querySelector("#timestamps-expand"),
		dialog: document.querySelector("#timestamps-dialog")
	});
	runner = new AlgorithmRunner(graph, editor, {
		select: new SelectMenu(document.querySelector("#algorithm"), document.querySelector("#algorithm-list")),
		run: document.querySelector("#run-btn"),
		step: document.querySelector("#step-btn"),
		stop: document.querySelector("#stop-btn"),
		topo: document.querySelector("#topo-btn"),
		forest: document.querySelector("#forest-btn"),
		tree: document.querySelector("#tree-btn"),
		cycle: document.querySelector("#cycle-btn"),
		weightSwitch: document.querySelector("#weight-switch"),
		directionSwitch: document.querySelector("#direction-switch"),
		queueCard: document.querySelector("#queue-card"),
		queueView,
		priorityQueueCard: document.querySelector("#pq-card"),
		priorityQueueView,
		edgeQueueCard: document.querySelector("#edges-card"),
		edgeQueueView,
		stackCard: document.querySelector("#stack-card"),
		stackView,
		timestampsCard: document.querySelector("#timestamps-card"),
		timelineView
	}, {
		message: (text) => showMessage(text),
		onStateChange: refreshPanels
	});
	for (const input of modeInputs) input.addEventListener("change", () => {
		if (input.checked) editor.setDirected(input.value === "directed");
	});
	for (const input of weightInputs) input.addEventListener("change", () => {
		if (input.checked) editor.setWeighting(input.value);
	});
	layoutBtn.addEventListener("click", () => {
		const leaving = editor.autoLayoutEnabled ? null : editor.arrangement;
		editor.setAutoLayout(!editor.autoLayoutEnabled);
		runner?.refresh();
		if (leaving === "line") showMessage("Auto-layout on: left the topological order. Press Topological sort to line the vertices up again.");
		else if (leaving === "forest") showMessage("Auto-layout on: left the forest. Press Show as forest to arrange the vertices as trees again.");
		else if (leaving === "tree") showMessage("Auto-layout on: left the tree. Press Show as tree to arrange the vertices as a tree again.");
	});
	const isPanelOpen = () => !panel.hasAttribute("hidden");
	function setPanelOpen(open) {
		panel.toggleAttribute("hidden", !open);
		panelBtn.setAttribute("aria-expanded", String(open));
		placePanel();
	}
	panelBtn.addEventListener("click", () => setPanelOpen(!isPanelOpen()));
	for (const toggle of panel.querySelectorAll(".card-toggle")) setupCollapsible(toggle, placePanel);
	window.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && isPanelOpen()) setPanelOpen(false);
	});
	refreshPanels();
	showMessage("Click empty space to add a node.");
})();

//# sourceMappingURL=app.js.map