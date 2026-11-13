import { ALGORITHMS } from './algorithms/index.js';
const LOCKED_TITLE = 'Locked while the algorithm runs. Press Stop to change it.';
/**
 * Runs the selected algorithm step by step:
 *   Run    → locks the graph (editing, the direction switch, and the weighting) and
 *            forces the reading the algorithm requires (BFS: "Unweighted"; DFS:
 *            "Unweighted" and "Directed"; Prim and Kruskal: "Undirected", with the
 *            weighting left as chosen but locked), then starts the simulation;
 *   Update → advances one step; after the last step it turns into Finish;
 *   Topological sort → (DFS, once finished) lines the vertices up in topological order
 *            as an arc diagram; greyed out when the graph has a cycle. The run goes on
 *            until Finish or Stop;
 *   Show as forest → (DFS, any time while it runs) a toggle: arranges the vertices as the
 *            depth-first forest so far, laid out like the timestamp chart (rows by depth,
 *            columns by time), the vertices not discovered yet grouped on the right; each
 *            Update then glides them into place. Once DFS has finished, its tree edges are
 *            white, and it and Topological sort switch between each other. Pressing it
 *            again, or turning auto-layout on, leaves it. The run goes on until Finish or Stop;
 *   Show as tree → (BFS, any time while it runs) a toggle: arranges the vertices as the
 *            breadth-first tree so far (rows by distance), the vertices not reached yet
 *            grouped on the right; each Update then glides newly reached vertices into the
 *            tree. Pressing it again, or turning auto-layout on, leaves it;
 *   Stop / Finish → ends the run, clears the highlighting and releases every lock
 *            (restoring the weighting and direction that were selected before).
 */
export class AlgorithmRunner {
    graph;
    editor;
    el;
    hooks;
    simulation = null;
    /** The weighting / direction chosen before Run forced one, restored on Stop. */
    savedWeighted = null;
    savedDirected = null;
    constructor(graph, editor, el, hooks) {
        this.graph = graph;
        this.editor = editor;
        this.el = el;
        this.hooks = hooks;
        el.select.setOptions(ALGORITHMS.map((a) => ({ value: a.id, label: a.name })));
        el.run.addEventListener('click', () => this.run());
        el.step.addEventListener('click', () => this.step());
        el.stop.addEventListener('click', () => this.stop('Stopped.'));
        el.topo?.addEventListener('click', () => this.topologicalSort());
        el.forest?.addEventListener('click', () => this.toggleForest());
        el.tree?.addEventListener('click', () => this.toggleTree());
        this.updateControls();
    }
    get running() {
        return this.simulation !== null;
    }
    get algorithm() {
        return ALGORITHMS.find((a) => a.id === this.el.select.value) ?? ALGORITHMS[0];
    }
    /** Starts the selected algorithm from the selected node (or the lowest id). */
    run() {
        if (this.running || this.graph.nodeCount === 0)
            return;
        const algorithm = this.algorithm;
        const start = this.editor.selectedNode ?? this.graph.getNodes()[0].id;
        // Locks: no editing; the direction switch; and the weighting the algorithm needs.
        this.editor.setLocked(true);
        const { weighted, directed } = algorithm.requires;
        if (weighted !== undefined) {
            this.savedWeighted = this.graph.weighted;
            this.editor.setWeighted(weighted);
            this.syncSwitch(this.el.weightSwitch, 'weighted', this.graph.weighted);
        }
        if (directed !== undefined) {
            this.savedDirected = this.graph.directed;
            this.editor.setDirected(directed);
            this.syncSwitch(this.el.directionSwitch, 'directed', this.graph.directed);
        }
        // An algorithm that reads the weights keeps the user's weighting, but it must not
        // change under it part-way.
        this.lockSwitch(this.el.weightSwitch, weighted !== undefined || !!algorithm.usesWeights);
        this.lockSwitch(this.el.directionSwitch, true);
        this.simulation = algorithm.create(this.graph.currentView, start);
        this.show(false);
    }
    /** Advances one step; once finished, ends the run like Stop. */
    step() {
        const simulation = this.simulation;
        if (!simulation)
            return;
        if (simulation.finished) {
            this.stop('Finished.');
            return;
        }
        simulation.step();
        this.show(true);
        // The tree or forest, if shown, grows: newly reached vertices glide into it.
        if (this.editor.arrangement === 'tree' && simulation.searchTree)
            this.editor.showForest(simulation.searchTree(), 'tree');
        if (this.editor.arrangement === 'forest' && simulation.searchForest)
            this.editor.showForest(simulation.searchForest());
    }
    /**
     * Lines the vertices up in the simulation's topological order (DFS on an acyclic graph),
     * left to right by decreasing finish time. The run is not over: Finish or Stop ends it.
     */
    topologicalSort() {
        const diagram = this.simulation?.topologicalSort?.() ?? null;
        if (!diagram)
            return;
        this.editor.showArcDiagram(diagram);
        this.updateControls();
        this.hooks.message(`Topological order (decreasing finish time): ${diagram.order.join(', ')}. Every edge points left to right: ` +
            'tree edges in white, forward edges arc above, crossed edges below. Press Finish or Stop to end.');
    }
    /**
     * Arranges the vertices as the simulation's depth-first forest so far (DFS), as its
     * timestamp chart nests them, or leaves it when it is shown. The run goes on either way.
     */
    toggleForest() {
        const simulation = this.simulation;
        if (!simulation?.searchForest)
            return;
        if (this.editor.arrangement === 'forest') {
            this.editor.showArcDiagram(null); // vertices stay where they are
            this.updateControls();
            this.hooks.message('Left the forest: the vertices stay where they are. Press Show as forest to arrange them again.');
            return;
        }
        const forest = simulation.searchForest();
        this.editor.showForest(forest);
        this.updateControls();
        const roots = forest.places.filter((p) => p.row === 0).sort((p, q) => p.column - q.column).map((p) => p.id);
        const trees = roots.length === 0
            ? 'nothing discovered yet'
            : roots.length === 1
                ? `1 tree, rooted at ${roots[0]}`
                : `${roots.length} trees, rooted at ${roots.join(', ')}`;
        const waiting = forest.aside?.length ?? 0;
        if (simulation.finished) {
            this.hooks.message(`Depth-first forest: ${trees}. As on the timestamp chart, each row is a depth and each vertex ` +
                'sits above the middle of its [d, f] interval, its descendants below it. Tree edges in white; ' +
                'the other edges curve. Press Finish or Stop to end.');
        }
        else {
            this.hooks.message(`Depth-first forest so far: ${trees}. As on the timestamp chart, each row is a depth and each vertex ` +
                'sits above the middle of its [d, f] interval ([d, now] while it runs), its descendants below it. ' +
                (waiting
                    ? `The ${waiting} not discovered yet wait on the right; each Update brings the new ones in.`
                    : 'Every vertex is discovered.'));
        }
    }
    /**
     * Shows the simulation's search tree so far (BFS), or leaves it when it is shown. The
     * run goes on either way.
     */
    toggleTree() {
        const simulation = this.simulation;
        if (!simulation?.searchTree)
            return;
        if (this.editor.arrangement === 'tree') {
            this.editor.showArcDiagram(null); // vertices stay where they are
            this.updateControls();
            this.hooks.message('Left the tree: the vertices stay where they are. Press Show as tree to arrange them again.');
            return;
        }
        const tree = simulation.searchTree();
        this.editor.showForest(tree, 'tree');
        this.updateControls();
        const waiting = tree.aside?.length ?? 0;
        this.hooks.message('Breadth-first tree so far: each row is a distance from the start, which is on top; each vertex hangs ' +
            'from the vertex it was discovered from. ' +
            (waiting ? `The ${waiting} not reached yet wait on the right; each Update brings the new ones into the tree.` : 'Every vertex is in it.'));
    }
    /** Ends the run and releases every lock. */
    stop(message = 'Stopped.') {
        if (!this.simulation)
            return;
        this.simulation = null;
        this.editor.showArcDiagram(null); // vertices stay where they are
        this.editor.setHighlight(null);
        this.editor.setLocked(false);
        if (this.savedWeighted !== null) {
            this.editor.setWeighted(this.savedWeighted);
            this.syncSwitch(this.el.weightSwitch, 'weighted', this.graph.weighted);
            this.savedWeighted = null;
        }
        if (this.savedDirected !== null) {
            this.editor.setDirected(this.savedDirected);
            this.syncSwitch(this.el.directionSwitch, 'directed', this.graph.directed);
            this.savedDirected = null;
        }
        this.lockSwitch(this.el.weightSwitch, false);
        this.lockSwitch(this.el.directionSwitch, false);
        this.el.queueView?.update(null, false);
        if (this.el.queueCard)
            this.el.queueCard.hidden = true;
        this.el.priorityQueueView?.update(null, false);
        if (this.el.priorityQueueCard)
            this.el.priorityQueueCard.hidden = true;
        this.el.edgeQueueView?.update(null, false);
        if (this.el.edgeQueueCard)
            this.el.edgeQueueCard.hidden = true;
        this.el.stackView?.update(null, false);
        if (this.el.stackCard)
            this.el.stackCard.hidden = true;
        this.el.timelineView?.collapse(false);
        this.el.timelineView?.update(null, false);
        if (this.el.timestampsCard)
            this.el.timestampsCard.hidden = true;
        this.updateControls();
        this.hooks.onStateChange();
        this.hooks.message(`${message} The graph can be edited again.`);
    }
    /** Draws the simulation's state; `animate` animates the queue / stack from its previous state. */
    show(animate) {
        const simulation = this.simulation;
        const highlight = simulation.highlight();
        this.editor.setHighlight(highlight);
        const queue = simulation.queueSnapshot?.() ?? null;
        if (this.el.queueCard)
            this.el.queueCard.hidden = queue === null;
        this.el.queueView?.update(queue, animate, highlight.labels);
        const priorityQueue = simulation.priorityQueueSnapshot?.() ?? null;
        if (this.el.priorityQueueCard)
            this.el.priorityQueueCard.hidden = priorityQueue === null;
        this.el.priorityQueueView?.update(priorityQueue, animate, highlight.labels);
        const edgeQueue = simulation.edgeQueueSnapshot?.() ?? null;
        if (this.el.edgeQueueCard)
            this.el.edgeQueueCard.hidden = edgeQueue === null;
        this.el.edgeQueueView?.update(edgeQueue, animate);
        const stack = simulation.stackSnapshot?.() ?? null;
        if (this.el.stackCard)
            this.el.stackCard.hidden = stack === null;
        this.el.stackView?.update(stack, animate, highlight.labels);
        const timestamps = simulation.timestamps?.() ?? null;
        if (this.el.timestampsCard)
            this.el.timestampsCard.hidden = timestamps === null;
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
        this.el.step.textContent = this.simulation?.finished ? 'Finish' : 'Update';
        this.el.select.disabled = running;
        // Topological sort: next to Finish once the simulation offers one; greyed out (with
        // the reason) when there is none.
        const topo = this.el.topo;
        if (topo) {
            const simulation = this.simulation;
            const offered = !!simulation?.finished && typeof simulation.topologicalSort === 'function';
            const available = offered && simulation.topologicalSort() !== null;
            topo.hidden = !offered;
            topo.disabled = offered && !available;
            if (offered && !available)
                topo.title = 'No topological order: a backward edge means the graph has a cycle.';
            else
                topo.removeAttribute('title');
            topo.setAttribute('aria-pressed', String(this.editor.arrangement === 'line'));
        }
        // Show as tree: while the simulation has a search tree (BFS), pressed while it is shown.
        const tree = this.el.tree;
        if (tree) {
            tree.hidden = !(this.simulation && typeof this.simulation.searchTree === 'function');
            tree.setAttribute('aria-pressed', String(this.editor.arrangement === 'tree'));
        }
        // Show as forest: while the simulation has a search forest (DFS), pressed while it is shown.
        const forest = this.el.forest;
        if (forest) {
            const simulation = this.simulation;
            forest.hidden = !(simulation && typeof simulation.searchForest === 'function');
            forest.setAttribute('aria-pressed', String(this.editor.arrangement === 'forest'));
        }
    }
    /** Re-checks Run's availability (e.g. after nodes were added or removed). */
    refresh() {
        this.updateControls();
    }
    /** Checks the radio matching the graph's state (`on`: the option named `onValue`). */
    syncSwitch(fieldset, onValue, on) {
        for (const input of fieldset.querySelectorAll('input')) {
            input.checked = (input.value === onValue) === on;
        }
    }
    lockSwitch(fieldset, locked) {
        fieldset.disabled = locked;
        if (locked)
            fieldset.title = LOCKED_TITLE;
        else
            fieldset.removeAttribute('title');
    }
}
//# sourceMappingURL=runner.js.map