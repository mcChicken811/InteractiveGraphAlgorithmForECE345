import { ALGORITHMS } from './algorithms/index.js';
const LOCKED_TITLE = 'Locked while the algorithm runs. Press Stop to change it.';
/**
 * Runs the selected algorithm step by step:
 *   Run    → locks the graph (editing, the direction switch, and the weighting the
 *            algorithm requires — BFS forces "Unweighted") and starts the simulation;
 *   Update → advances one step; after the last step it turns into Finish;
 *   Stop / Finish → ends the run, clears the highlighting and releases every lock
 *            (restoring the weighting that was selected before).
 */
export class AlgorithmRunner {
    graph;
    editor;
    el;
    hooks;
    simulation = null;
    /** The weighting chosen before Run forced one, restored on Stop. */
    savedWeighted = null;
    constructor(graph, editor, el, hooks) {
        this.graph = graph;
        this.editor = editor;
        this.el = el;
        this.hooks = hooks;
        el.select.setOptions(ALGORITHMS.map((a) => ({ value: a.id, label: a.name })));
        el.run.addEventListener('click', () => this.run());
        el.step.addEventListener('click', () => this.step());
        el.stop.addEventListener('click', () => this.stop('Stopped.'));
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
        if (algorithm.requires.weighted !== undefined) {
            this.savedWeighted = this.graph.weighted;
            this.editor.setWeighted(algorithm.requires.weighted);
            this.syncWeightSwitch();
        }
        this.lockSwitch(this.el.weightSwitch, algorithm.requires.weighted !== undefined);
        this.lockSwitch(this.el.directionSwitch, true);
        this.simulation = algorithm.create(this.graph.currentView, start);
        this.show();
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
        this.show();
    }
    /** Ends the run and releases every lock. */
    stop(message = 'Stopped.') {
        if (!this.simulation)
            return;
        this.simulation = null;
        this.editor.setHighlight(null);
        this.editor.setLocked(false);
        if (this.savedWeighted !== null) {
            this.editor.setWeighted(this.savedWeighted);
            this.syncWeightSwitch();
            this.savedWeighted = null;
        }
        this.lockSwitch(this.el.weightSwitch, false);
        this.lockSwitch(this.el.directionSwitch, false);
        this.updateControls();
        this.hooks.onStateChange();
        this.hooks.message(`${message} The graph can be edited again.`);
    }
    show() {
        const simulation = this.simulation;
        this.editor.setHighlight(simulation.highlight());
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
    }
    /** Re-checks Run's availability (e.g. after nodes were added or removed). */
    refresh() {
        this.updateControls();
    }
    syncWeightSwitch() {
        for (const input of this.el.weightSwitch.querySelectorAll('input')) {
            input.checked = (input.value === 'weighted') === this.graph.weighted;
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