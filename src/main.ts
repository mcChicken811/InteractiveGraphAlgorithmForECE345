// Bundled by `npm run build` with everything it imports into build/app.js, the classic
// script index.html loads (so the page also runs when opened from file://).
// Imports use .js extensions, as NodeNext module resolution requires.
import { Graph } from './graph.js';
import type { Weighting } from './graph-views.js';
import { GraphEditor } from './editor.js';
import { renderAdjacencyList, renderAdjacencyMatrix, setupTabs } from './representations.js';
import { followColorScheme } from './favicon.js';
import { setupCollapsible } from './collapsible.js';
import { AlgorithmRunner } from './runner.js';
import { SelectMenu } from './select-menu.js';
import { QueueView } from './queue-view.js';
import { StatusBar, type Tone } from './status-bar.js';
import { TimelineView } from './timeline-view.js';
import { EdgeQueueView } from './edge-queue-view.js';

followColorScheme();

const svg = document.querySelector<SVGSVGElement>('#canvas')!;
const stats = document.querySelector<HTMLElement>('#stats')!;
const messageEl = document.querySelector<HTMLElement>('#message')!;
const adjacencyEl = document.querySelector<HTMLElement>('#adjacency')!;
const matrixEl = document.querySelector<HTMLElement>('#adjacency-matrix')!;
const listNote = document.querySelector<HTMLElement>('#list-note')!;
const matrixNote = document.querySelector<HTMLElement>('#matrix-note')!;
const modeInputs = document.querySelectorAll<HTMLInputElement>('input[name="edge-mode"]');
const weightInputs = document.querySelectorAll<HTMLInputElement>('input[name="weight-mode"]');
const toolbar = document.querySelector<HTMLElement>('.canvas-toolbar')!;
const clearBtn = document.querySelector<HTMLButtonElement>('#clear-btn')!;
const randomBtn = document.querySelector<HTMLButtonElement>('#random-btn')!;
const layoutBtn = document.querySelector<HTMLButtonElement>('#layout-toggle')!;
const layoutState = layoutBtn.querySelector<HTMLElement>('.state')!;
const panelBtn = document.querySelector<HTMLButtonElement>('#panel-toggle')!;
const panel = document.querySelector<HTMLElement>('#info-panel')!;

const graph = new Graph();
let runner: AlgorithmRunner | undefined;

function refreshPanels(): void {
  const n = graph.nodeCount;
  const m = graph.edgeCount;
  stats.textContent = `${n} node${n === 1 ? '' : 's'} · ${m} edge${m === 1 ? '' : 's'}`;
  clearBtn.disabled = n === 0 || (runner?.running ?? false);
  randomBtn.disabled = runner?.running ?? false;
  runner?.refresh();

  // The panel shows whichever reading of the graph the Undirected/Directed switch selects.
  renderAdjacencyList(adjacencyEl, graph.currentView);
  renderAdjacencyMatrix(matrixEl, graph.currentView);
  listNote.textContent =
    (graph.directed ? 'Each node followed by the nodes its edges point to.' : 'Each node followed by its neighbours.') +
    (graph.weighted ? ' Each box shows the neighbour (top) and the edge weight (bottom).' : '');
  matrixNote.textContent = graph.weighted
    ? (graph.directed
        ? 'Row r, column c is the weight of the edge r → c; — means no edge.'
        : 'Each cell is the weight of the edge between the row and column nodes; — means no edge. If edges run both ways with different weights, the smaller is shown.')
    : graph.directed
      ? 'Row r, column c is 1 when there is an edge r → c, so the matrix need not be symmetric.'
      : '1 marks an edge between the row and column nodes. The matrix is symmetric because edges are undirected.';
  if (graph.weighting === 'positive') {
    const positive = ' Positive: every weight is shown, and used, as its magnitude (−5 as 5).';
    listNote.textContent += positive;
    matrixNote.textContent += positive;
  }
  placePanel();
}

/** Opens the ☰ panel below the toolbar when the toolbar would otherwise overlap it. */
function placePanel(): void {
  if (panel.hasAttribute('hidden')) return;
  panel.style.removeProperty('--panel-top');
  const bar = toolbar.getBoundingClientRect();
  const box = panel.getBoundingClientRect();
  if (bar.right > box.left - 8) {
    const wrapTop = panel.offsetParent!.getBoundingClientRect().top;
    panel.style.setProperty('--panel-top', `${Math.ceil(bar.bottom - wrapTop + 8)}px`);
  }
}

window.addEventListener('resize', placePanel);

setupTabs(document.querySelector<HTMLElement>('.rep-tabs')!);

// Every status message goes through the status bar, which also slides itself out of view
// when idle and back in when needed.
const statusBar = new StatusBar(messageEl, document.querySelector<HTMLElement>('.canvas-wrap')!);

function showMessage(text: string, tone: Tone = 'info'): void {
  statusBar.show(text, tone);
}

const editor = new GraphEditor(svg, graph, {
  onChange: refreshPanels,
  onMessage: showMessage,
  // The topological sort's line of vertices stays below the canvas toolbar (which wraps
  // onto several rows on narrow screens) and above the status bar.
  canvasInsets: () => ({
    top: Math.max(0, toolbar.getBoundingClientRect().bottom - svg.getBoundingClientRect().top) + 16,
    bottom: 96,
  }),
  // Also fires when the topological sort turns auto-layout off.
  onAutoLayoutChange: (enabled) => {
    layoutBtn.setAttribute('aria-pressed', String(enabled));
    layoutState.textContent = enabled ? 'On' : 'Off';
  },
});

clearBtn.addEventListener('click', () => editor.clear());
randomBtn.addEventListener('click', () => editor.randomise());

// Hovering (or focusing) the queue strip shows vertex ids instead of BFS distances.
const queueView = new QueueView(
  document.querySelector<HTMLElement>('#queue-strip')!,
  document.querySelector<HTMLElement>('#queue-empty')!,
);
queueView.onPeek = (peek) => editor.setPeek(peek ? 'ids' : null);

// Prim's min-priority queue, smallest key first; its vertices show their keys.
const priorityQueueView = new QueueView(
  document.querySelector<HTMLElement>('#pq-strip')!,
  document.querySelector<HTMLElement>('#pq-empty')!,
  { kind: 'priority' },
);
// Hovering it shows the keys on the canvas (Prim's vertices are compact dots otherwise).
priorityQueueView.onPeek = (peek) => editor.setPeek(peek ? 'labels' : null);

// Kruskal's edges in sorted order; hovering shows each vertex's set (FIND-SET) on the canvas.
const edgeQueueView = new EdgeQueueView(
  document.querySelector<HTMLElement>('#edges-strip')!,
  document.querySelector<HTMLElement>('#edges-empty')!,
);
edgeQueueView.onPeek = (peek) => editor.setPeek(peek ? 'labels' : null);

// DFS's recursion stack works the same way; its vertices show "discovery,finish" times.
const stackView = new QueueView(
  document.querySelector<HTMLElement>('#stack-strip')!,
  document.querySelector<HTMLElement>('#stack-empty')!,
  {
    kind: 'stack',
    describeLabel: (label) => {
      const [d, f] = label.split(',');
      return f ? `discovered at ${d}, finished at ${f}` : `discovered at ${d}`;
    },
  },
);
stackView.onPeek = (peek) => editor.setPeek(peek ? 'ids' : null);

// Hovering the adjacency list or matrix always shows the vertex ids on the canvas, whatever
// the algorithm draws inside the vertices, so they can be matched to the rows and columns.
for (const inner of [adjacencyEl, matrixEl]) {
  inner.addEventListener('pointerenter', () => editor.setPeek('ids'));
  inner.addEventListener('pointerleave', () => editor.setPeek(null));
}

// DFS's timestamps as a chart; its corner button expands it to the middle of the screen.
const timelineView = new TimelineView({
  card: document.querySelector<HTMLElement>('#timestamps-card')!,
  scroll: document.querySelector<HTMLElement>('#timestamps-chart')!,
  expand: document.querySelector<HTMLButtonElement>('#timestamps-expand')!,
  dialog: document.querySelector<HTMLDialogElement>('#timestamps-dialog')!,
});

// Algorithm simulation (header, top right). `runner` is declared above so refreshPanels,
// which can run before this point, can check it.
runner = new AlgorithmRunner(
  graph,
  editor,
  {
    select: new SelectMenu(
      document.querySelector<HTMLElement>('#algorithm')!,
      document.querySelector<HTMLElement>('#algorithm-list')!,
    ),
    run: document.querySelector<HTMLButtonElement>('#run-btn')!,
    step: document.querySelector<HTMLButtonElement>('#step-btn')!,
    stop: document.querySelector<HTMLButtonElement>('#stop-btn')!,
    topo: document.querySelector<HTMLButtonElement>('#topo-btn')!,
    forest: document.querySelector<HTMLButtonElement>('#forest-btn')!,
    tree: document.querySelector<HTMLButtonElement>('#tree-btn')!,
    weightSwitch: document.querySelector<HTMLFieldSetElement>('#weight-switch')!,
    directionSwitch: document.querySelector<HTMLFieldSetElement>('#direction-switch')!,
    queueCard: document.querySelector<HTMLElement>('#queue-card')!,
    queueView,
    priorityQueueCard: document.querySelector<HTMLElement>('#pq-card')!,
    priorityQueueView,
    edgeQueueCard: document.querySelector<HTMLElement>('#edges-card')!,
    edgeQueueView,
    stackCard: document.querySelector<HTMLElement>('#stack-card')!,
    stackView,
    timestampsCard: document.querySelector<HTMLElement>('#timestamps-card')!,
    timelineView,
  },
  { message: (text) => showMessage(text), onStateChange: refreshPanels },
);

// Undirected / Directed switch: only changes how the stored arcs are interpreted.
for (const input of modeInputs) {
  input.addEventListener('change', () => {
    if (input.checked) editor.setDirected(input.value === 'directed');
  });
}

// Unweighted / Weighted / Positive switch: only changes how the stored weights are shown and used.
for (const input of weightInputs) {
  input.addEventListener('change', () => {
    if (input.checked) editor.setWeighting(input.value as Weighting);
  });
}

layoutBtn.addEventListener('click', () => {
  // Turning auto-layout on leaves the topological order or the forest (the run itself goes on).
  const leaving = editor.autoLayoutEnabled ? null : editor.arrangement;
  editor.setAutoLayout(!editor.autoLayoutEnabled);
  runner?.refresh();
  if (leaving === 'line') {
    showMessage('Auto-layout on: left the topological order. Press Topological sort to line the vertices up again.');
  } else if (leaving === 'forest') {
    showMessage('Auto-layout on: left the forest. Press Show as forest to arrange the vertices as trees again.');
  } else if (leaving === 'tree') {
    showMessage('Auto-layout on: left the tree. Press Show as tree to arrange the vertices as a tree again.');
  }
});

// Hamburger menu. The panel floats over the canvas and stays open while editing, so the
// adjacency list can be watched as the graph changes; the button or Esc closes it.
const isPanelOpen = (): boolean => !panel.hasAttribute('hidden');

function setPanelOpen(open: boolean): void {
  panel.toggleAttribute('hidden', !open);
  panelBtn.setAttribute('aria-expanded', String(open));
  placePanel();
}

panelBtn.addEventListener('click', () => setPanelOpen(!isPanelOpen()));

// The two cards inside the panel ("How to use", "Graph representation") collapse from their titles.
for (const toggle of panel.querySelectorAll<HTMLButtonElement>('.card-toggle')) setupCollapsible(toggle, placePanel);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isPanelOpen()) setPanelOpen(false);
});

refreshPanels();
showMessage('Click empty space to add a node.');
