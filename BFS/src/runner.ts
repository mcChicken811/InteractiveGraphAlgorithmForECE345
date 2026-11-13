import { ALGORITHMS, type AlgorithmDefinition, type Simulation } from './algorithms/index.js';
import type { GraphEditor } from './editor.js';
import type { Graph } from './graph.js';
import type { QueueView } from './queue-view.js';
import type { SelectMenu } from './select-menu.js';

export interface RunnerElements {
  /** Algorithm picker. */
  select: SelectMenu;
  run: HTMLButtonElement;
  /** "Update" while steps remain, "Finish" after the last one. */
  step: HTMLButtonElement;
  stop: HTMLButtonElement;
  /** The Unweighted / Weighted switch (locked when an algorithm requires a weighting). */
  weightSwitch: HTMLFieldSetElement;
  /** The Undirected / Directed switch (locked while running: changing it would change the graph). */
  directionSwitch: HTMLFieldSetElement;
  /** Side-panel card showing the algorithm's queue while it runs (if it has one). */
  queueCard?: HTMLElement;
  queueView?: QueueView;
}

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
  private simulation: Simulation | null = null;
  /** The weighting chosen before Run forced one, restored on Stop. */
  private savedWeighted: boolean | null = null;

  constructor(
    private readonly graph: Graph,
    private readonly editor: GraphEditor,
    private readonly el: RunnerElements,
    private readonly hooks: {
      /** Shows a status message. */
      message: (text: string) => void;
      /** Called when running starts or stops (so other controls can update). */
      onStateChange: () => void;
    },
  ) {
    el.select.setOptions(ALGORITHMS.map((a) => ({ value: a.id, label: a.name })));
    el.run.addEventListener('click', () => this.run());
    el.step.addEventListener('click', () => this.step());
    el.stop.addEventListener('click', () => this.stop('Stopped.'));
    this.updateControls();
  }

  get running(): boolean {
    return this.simulation !== null;
  }

  private get algorithm(): AlgorithmDefinition {
    return ALGORITHMS.find((a) => a.id === this.el.select.value) ?? ALGORITHMS[0];
  }

  /** Starts the selected algorithm from the selected node (or the lowest id). */
  run(): void {
    if (this.running || this.graph.nodeCount === 0) return;
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
    this.show(false);
  }

  /** Advances one step; once finished, ends the run like Stop. */
  step(): void {
    const simulation = this.simulation;
    if (!simulation) return;
    if (simulation.finished) {
      this.stop('Finished.');
      return;
    }
    simulation.step();
    this.show(true);
  }

  /** Ends the run and releases every lock. */
  stop(message = 'Stopped.'): void {
    if (!this.simulation) return;
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
    this.el.queueView?.update(null, false);
    if (this.el.queueCard) this.el.queueCard.hidden = true;
    this.updateControls();
    this.hooks.onStateChange();
    this.hooks.message(`${message} The graph can be edited again.`);
  }

  /** Draws the simulation's state; `animate` animates the queue from its previous state. */
  private show(animate: boolean): void {
    const simulation = this.simulation!;
    this.editor.setHighlight(simulation.highlight());
    const queue = simulation.queueSnapshot?.() ?? null;
    if (this.el.queueCard) this.el.queueCard.hidden = queue === null;
    this.el.queueView?.update(queue, animate);
    this.updateControls();
    this.hooks.onStateChange();
    this.hooks.message(simulation.describe());
  }

  private updateControls(): void {
    const running = this.running;
    this.el.run.hidden = running;
    this.el.run.disabled = this.graph.nodeCount === 0;
    this.el.step.hidden = !running;
    this.el.stop.hidden = !running;
    this.el.step.textContent = this.simulation?.finished ? 'Finish' : 'Update';
    this.el.select.disabled = running;
  }

  /** Re-checks Run's availability (e.g. after nodes were added or removed). */
  refresh(): void {
    this.updateControls();
  }

  private syncWeightSwitch(): void {
    for (const input of this.el.weightSwitch.querySelectorAll<HTMLInputElement>('input')) {
      input.checked = (input.value === 'weighted') === this.graph.weighted;
    }
  }

  private lockSwitch(fieldset: HTMLFieldSetElement, locked: boolean): void {
    fieldset.disabled = locked;
    if (locked) fieldset.title = LOCKED_TITLE;
    else fieldset.removeAttribute('title');
  }
}
