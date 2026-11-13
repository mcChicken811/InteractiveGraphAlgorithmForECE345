import { ALGORITHMS } from './algorithms/index.js';
const LOCKED_TITLE = 'Locked while the algorithm runs. Press Stop to change it.';
/**
 * Runs the selected algorithm step by step:
 *   Run    → locks the graph (editing, the direction switch, and the weighting) and
 *            forces the reading the algorithm requires (BFS: "Unweighted"; DFS:
 *            "Unweighted" and "Directed"), then starts the simulation;
 *   Update → advances one step; after the last step it turns into Finish;
 *   Topological sort → (DFS, once finished) lines the vertices up in topological order
 *            as an arc diagram; greyed out when the graph has a cycle. The run goes on
 *            until Finish or Stop;
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
        this.lockSwitch(this.el.weightSwitch, weighted !== undefined);
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
        this.hooks.message(`Topological order (decreasing finish time): ${diagram.order.join(', ')}. Every edge points left to right: ` +
            'tree edges in white, forward edges arc above, crossed edges below. Press Finish or Stop to end.');
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