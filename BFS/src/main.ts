// Compiled by `npm run build` to build/main.js, which index.html loads directly.
// Imports use .js extensions because browsers resolve them verbatim (no bundler).
import { Graph } from './graph.js';
import { GraphEditor } from './editor.js';
import { renderAdjacencyList, renderAdjacencyMatrix, setupTabs } from './representations.js';
import { followColorScheme } from './favicon.js';

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
const layoutBtn = document.querySelector<HTMLButtonElement>('#layout-toggle')!;
const layoutState = layoutBtn.querySelector<HTMLElement>('.state')!;
const panelBtn = document.querySelector<HTMLButtonElement>('#panel-toggle')!;
const panel = document.querySelector<HTMLElement>('#info-panel')!;

const graph = new Graph();

function refreshPanels(): void {
  const n = graph.nodeCount;
  const m = graph.edgeCount;
  stats.textContent = `${n} node${n === 1 ? '' : 's'} · ${m} edge${m === 1 ? '' : 's'}`;
  clearBtn.disabled = n === 0;

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

function showMessage(text: string, tone: 'info' | 'warn' = 'info'): void {
  messageEl.textContent = text;
  messageEl.dataset.tone = tone;
}

const editor = new GraphEditor(svg, graph, {
  onChange: refreshPanels,
  onMessage: showMessage,
});

clearBtn.addEventListener('click', () => editor.clear());

// Undirected / Directed switch: only changes how the stored arcs are interpreted.
for (const input of modeInputs) {
  input.addEventListener('change', () => {
    if (input.checked) editor.setDirected(input.value === 'directed');
  });
}

// Unweighted / Weighted switch: only changes whether the stored weights are shown and used.
for (const input of weightInputs) {
  input.addEventListener('change', () => {
    if (input.checked) editor.setWeighted(input.value === 'weighted');
  });
}

layoutBtn.addEventListener('click', () => {
  const enabled = !editor.autoLayoutEnabled;
  editor.setAutoLayout(enabled);
  layoutBtn.setAttribute('aria-pressed', String(enabled));
  layoutState.textContent = enabled ? 'On' : 'Off';
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

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isPanelOpen()) setPanelOpen(false);
});

refreshPanels();
showMessage('Click empty space to add a node.');
