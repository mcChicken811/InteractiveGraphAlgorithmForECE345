import { ALGORITHMS, type AlgorithmDefinition, type Simulation } from './algorithms/index.js';
import type { GraphEditor } from './editor.js';
import type { Graph, NodeId } from './graph.js';
import type { Weighting } from './graph-views.js';
import type { QueueView } from './queue-view.js';
import type { SelectMenu } from './select-menu.js';
import type { TimelineView } from './timeline-view.js';
import type { EdgeQueueView } from './edge-queue-view.js';

export interface RunnerElements {
  /** Algorithm picker. */
  select: SelectMenu;
  run: HTMLButtonElement;
  /** "Update" while steps remain, "Finish" after the last one. */
  step: HTMLButtonElement;
  stop: HTMLButtonElement;
  /** "Topological sort", offered next to Finish when the simulation has one (DFS). */
  topo?: HTMLButtonElement;
  /** "Show as forest", a toggle offered while the simulation has a search forest to show (DFS). */
  forest?: HTMLButtonElement;
  /** "Show as tree", a toggle offered while the simulation has a search tree to show (BFS, Dijkstra, Bellman–Ford). */
  tree?: HTMLButtonElement;
  /** "Full cycle", offered while the simulation goes in passes over the edges (Bellman–Ford): plays the rest of a pass. */
  cycle?: HTMLButtonElement;
  /** The Unweighted / Weighted / Positive switch (locked when an algorithm requires a weighting or reads the weights). */
  weightSwitch: HTMLFieldSetElement;
  /** The Undirected / Directed switch (locked while running: changing it would change the graph). */
  directionSwitch: HTMLFieldSetElement;
  /** Side-panel card showing the algorithm's queue while it runs (if it has one). */
  queueCard?: HTMLElement;
  queueView?: QueueView;
  /** Side-panel card showing the algorithm's min-priority queue while it runs (if it has one). */
  priorityQueueCard?: HTMLElement;
  priorityQueueView?: QueueView;
  /** Side-panel card listing the algorithm's edges in processing order while it runs (Kruskal). */
  edgeQueueCard?: HTMLElement;
  edgeQueueView?: EdgeQueueView;
  /** Side-panel card showing the algorithm's recursion stack while it runs (if it has one). */
  stackCard?: HTMLElement;
  stackView?: QueueView;
  /** Side-panel card charting the algorithm's timestamps while it runs (if it keeps them). */
  timestampsCard?: HTMLElement;
  timelineView?: TimelineView;
}

const LOCKED_TITLE = 'Locked while the algorithm runs. Press Stop to change it.';

/** Full cycle: steps (edges) per second. */
export const FULL_CYCLE_RATE = 15;

/**
 * Runs the selected algorithm step by step:
 *   Run    → locks the graph (editing, the direction switch, and the weighting) and
 *            forces the reading the algorithm requires (BFS: "Unweighted"; DFS:
 *            "Unweighted" and "Directed"; Prim and Kruskal: "Undirected", with the
 *            weighting left as chosen but locked), then starts the simulation;
 *   Update → advances one step; after the last step it turns into Finish;
 *   Topological sort → (DFS, once finished) lines the vertices up in topological order
 *            as an arc diagram (on a cyclic graph, the same line-up with the backward
 *            edges in red). The run goes on until Finish or Stop;
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
export class AlgorithmRunner {
  private simulation: Simulation | null = null;
  /** Full cycle playing: the timer, and how many steps it still has to take. */
  private cycleTimer: ReturnType<typeof setInterval> | null = null;
  private cycleLeft = 0;
  /** The weighting / direction chosen before Run forced one, restored on Stop. */
  private savedWeighting: Weighting | null = null;
  private savedDirected: boolean | null = null;

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
    el.topo?.addEventListener('click', () => this.topologicalSort());
    el.forest?.addEventListener('click', () => this.toggleForest());
    el.tree?.addEventListener('click', () => this.toggleTree());
    el.cycle?.addEventListener('click', () => this.toggleCycle());
    this.updateControls();
  }

  get running(): boolean {
    return this.simulation !== null;
  }

  /** The edge the running simulation's next step works on, for the side panel (Bellman–Ford); else null. */
  get representationEdge(): { from: NodeId; to: NodeId } | null {
    return this.simulation?.highlight().representationEdge ?? null;
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
    const { weighted, weighting, directed } = algorithm.requires;
    const forcesWeighting = weighted !== undefined || weighting !== undefined;
    if (forcesWeighting) {
      this.savedWeighting = this.graph.weighting;
      // Requiring weights keeps Positive if it is chosen; requiring none forces Unweighted.
      if (weighting !== undefined) this.editor.setWeighting(weighting);
      else if (weighted !== this.graph.weighted) this.editor.setWeighted(weighted!);
      this.syncSwitch(this.el.weightSwitch, this.graph.weighting);
    }
    if (directed !== undefined) {
      this.savedDirected = this.graph.directed;
      this.editor.setDirected(directed);
      this.syncSwitch(this.el.directionSwitch, this.graph.directed ? 'directed' : 'undirected');
    }
    // An algorithm that reads the weights keeps the user's weighting, but it must not
    // change under it part-way.
    this.lockSwitch(this.el.weightSwitch, forcesWeighting || !!algorithm.usesWeights);
    this.lockSwitch(this.el.directionSwitch, true);

    this.simulation = algorithm.create(this.graph.currentView, start);
    this.show(false);
  }

  /** Whether Full cycle is playing. */
  get playingCycle(): boolean {
    return this.cycleTimer !== null;
  }

  /**
   * Full cycle (Bellman–Ford): plays the rest of the current pass over the edges, one step
   * now and then FULL_CYCLE_RATE a second, stopping by itself at the end of the pass or of
   * the run. Pressing it while it plays pauses it.
   */
  toggleCycle(): void {
    if (this.cycleTimer !== null) {
      this.stopCycle();
      return;
    }
    const simulation = this.simulation;
    const left = simulation?.stepsLeftInPass?.() ?? 0;
    if (!simulation || simulation.finished || left === 0) return;
    this.cycleLeft = left;
    this.cycleTimer = setInterval(() => this.cycleTick(), 1000 / FULL_CYCLE_RATE);
    this.cycleTick();
  }

  private cycleTick(): void {
    const simulation = this.simulation;
    if (!simulation || simulation.finished || this.cycleLeft <= 0) {
      this.stopCycle();
      return;
    }
    this.cycleLeft--;
    this.step();
    if (this.cycleLeft <= 0 || simulation.finished) this.stopCycle();
  }

  private stopCycle(): void {
    if (this.cycleTimer !== null) clearInterval(this.cycleTimer);
    this.cycleTimer = null;
    this.cycleLeft = 0;
    if (this.simulation) this.updateControls();
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
    // The tree or forest, if shown, grows: newly reached vertices glide into it.
    if (this.editor.arrangement === 'tree' && simulation.searchTree) this.editor.showForest(simulation.searchTree(), 'tree');
    if (this.editor.arrangement === 'forest' && simulation.searchForest) this.editor.showForest(simulation.searchForest());
  }

  /**
   * Lines the vertices up in the simulation's topological order (DFS), left to right by
   * decreasing finish time. On a cyclic graph the line-up is the same, and the backward
   * edges, which point right to left, are red. The run is not over: Finish or Stop ends it.
   */
  topologicalSort(): void {
    const diagram = this.simulation?.topologicalSort?.() ?? null;
    if (!diagram) return;
    this.editor.showArcDiagram(diagram);
    this.updateControls();
    const backward = diagram.backward?.length ?? 0;
    this.hooks.message(
      backward === 0
        ? `Topological order (decreasing finish time): ${diagram.order.join(', ')}. Every edge points left to right: ` +
            'tree edges in white, forward edges arc above, crossed edges below. Press Finish or Stop to end.'
        : `By decreasing finish time: ${diagram.order.join(', ')}. No topological order: ` +
            `${backward === 1 ? 'the backward edge (red) points' : `the ${backward} backward edges (red) point`} right to left, ` +
            `${backward === 1 ? 'closing a cycle' : 'each closing a cycle'}. The rest point left to right: tree edges in white, ` +
            'forward edges arc above, crossed and backward edges below. Press Finish or Stop to end.',
    );
  }

  /**
   * Arranges the vertices as the simulation's depth-first forest so far (DFS), as its
   * timestamp chart nests them, or leaves it when it is shown. The run goes on either way.
   */
  toggleForest(): void {
    const simulation = this.simulation;
    if (!simulation?.searchForest) return;
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
    const trees =
      roots.length === 0
        ? 'nothing discovered yet'
        : roots.length === 1
          ? `1 tree, rooted at ${roots[0]}`
          : `${roots.length} trees, rooted at ${roots.join(', ')}`;
    const waiting = forest.aside?.length ?? 0;
    if (simulation.finished) {
      this.hooks.message(
        `Depth-first forest: ${trees}. As on the timestamp chart, each row is a depth and each vertex ` +
          'sits above the middle of its [d, f] interval, its descendants below it. Tree edges in white; ' +
          'the other edges curve. Press Finish or Stop to end.',
      );
    } else {
      this.hooks.message(
        `Depth-first forest so far: ${trees}. As on the timestamp chart, each row is a depth and each vertex ` +
          'sits above the middle of its [d, f] interval ([d, now] while it runs), its descendants below it. ' +
          (waiting
            ? `The ${waiting} not discovered yet wait on the right; each Update brings the new ones in.`
            : 'Every vertex is discovered.'),
      );
    }
  }

  /**
   * Shows the simulation's search tree so far (BFS: the breadth-first tree; Dijkstra: the
   * shortest-paths tree), or leaves it when it is shown. The run goes on either way.
   */
  toggleTree(): void {
    const simulation = this.simulation;
    if (!simulation?.searchTree) return;
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
    this.hooks.message(
      `${tree.intro ?? 'The search tree so far.'} ` +
        (waiting
          ? (tree.asideNote ?? `The ${waiting} not reached yet wait on the right; each Update brings the new ones into the tree.`)
          : 'Every vertex is in it.'),
    );
  }

  /** Ends the run and releases every lock. */
  stop(message = 'Stopped.'): void {
    if (!this.simulation) return;
    this.stopCycle();
    this.simulation = null;
    this.editor.showArcDiagram(null); // vertices stay where they are
    this.editor.setHighlight(null);
    this.editor.setLocked(false);
    if (this.savedWeighting !== null) {
      this.editor.setWeighting(this.savedWeighting);
      this.syncSwitch(this.el.weightSwitch, this.graph.weighting);
      this.savedWeighting = null;
    }
    if (this.savedDirected !== null) {
      this.editor.setDirected(this.savedDirected);
      this.syncSwitch(this.el.directionSwitch, this.graph.directed ? 'directed' : 'undirected');
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
    this.hooks.message(`${message} The graph can be edited again.`);
  }

  /** Draws the simulation's state; `animate` animates the queue / stack from its previous state. */
  private show(animate: boolean): void {
    const simulation = this.simulation!;
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

  private updateControls(): void {
    const running = this.running;
    this.el.run.hidden = running;
    this.el.run.disabled = this.graph.nodeCount === 0;
    this.el.step.hidden = !running;
    this.el.stop.hidden = !running;
    this.el.step.textContent = this.simulation?.finished ? 'Finish' : 'Update';
    this.el.select.disabled = running;

    // Topological sort: next to Finish once the simulation offers one (on a cyclic graph
    // too: the line-up shows the backward edges in red), with a tooltip saying so.
    const topo = this.el.topo;
    if (topo) {
      const simulation = this.simulation;
      const diagram = simulation?.finished ? (simulation.topologicalSort?.() ?? null) : null;
      topo.hidden = diagram === null;
      if (diagram?.backward?.length)
        topo.title = 'No topological order (a backward edge means a cycle): lines the vertices up by decreasing finish time, backward edges in red.';
      else topo.removeAttribute('title');
      topo.setAttribute('aria-pressed', String(this.editor.arrangement === 'line'));
    }
    // Full cycle: while the simulation goes in passes (Bellman–Ford) and is not finished;
    // pressed while it plays, and Update greyed out meanwhile.
    const cycle = this.el.cycle;
    if (cycle) {
      const simulation = this.simulation;
      cycle.hidden = !(simulation && typeof simulation.stepsLeftInPass === 'function' && !simulation.finished);
      cycle.setAttribute('aria-pressed', String(this.playingCycle));
    }
    this.el.step.disabled = this.playingCycle;
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
  refresh(): void {
    this.updateControls();
  }

  /** Checks the radio matching the graph's state (`on`: the option named `onValue`). */
  /** Checks the switch's option with this value. */
  private syncSwitch(fieldset: HTMLFieldSetElement, value: string): void {
    for (const input of fieldset.querySelectorAll<HTMLInputElement>('input')) {
      input.checked = input.value === value;
    }
  }

  private lockSwitch(fieldset: HTMLFieldSetElement, locked: boolean): void {
    fieldset.disabled = locked;
    if (locked) fieldset.title = LOCKED_TITLE;
    else fieldset.removeAttribute('title');
  }
}
