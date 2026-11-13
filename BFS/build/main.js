// Compiled by `npm run build` to build/main.js, which index.html loads directly.
// Imports use .js extensions because browsers resolve them verbatim (no bundler).
import { Graph } from './graph.js';
import { GraphEditor } from './editor.js';
import { renderAdjacencyList, renderAdjacencyMatrix, setupTabs } from './representations.js';
const svg = document.querySelector('#canvas');
const stats = document.querySelector('#stats');
const messageEl = document.querySelector('#message');
const adjacencyEl = document.querySelector('#adjacency');
const matrixEl = document.querySelector('#adjacency-matrix');
const clearBtn = document.querySelector('#clear-btn');
const layoutBtn = document.querySelector('#layout-toggle');
const layoutState = layoutBtn.querySelector('.state');
const panelBtn = document.querySelector('#panel-toggle');
const panel = document.querySelector('#info-panel');
const graph = new Graph();
function refreshPanels() {
    const n = graph.nodeCount;
    const m = graph.edgeCount;
    stats.textContent = `${n} node${n === 1 ? '' : 's'} · ${m} edge${m === 1 ? '' : 's'}`;
    clearBtn.disabled = n === 0;
    renderAdjacencyList(adjacencyEl, graph);
    renderAdjacencyMatrix(matrixEl, graph);
}
setupTabs(document.querySelector('.rep-tabs'));
function showMessage(text, tone = 'info') {
    messageEl.textContent = text;
    messageEl.dataset.tone = tone;
}
const editor = new GraphEditor(svg, graph, {
    onChange: refreshPanels,
    onMessage: showMessage,
});
clearBtn.addEventListener('click', () => editor.clear());
layoutBtn.addEventListener('click', () => {
    const enabled = !editor.autoLayoutEnabled;
    editor.setAutoLayout(enabled);
    layoutBtn.setAttribute('aria-pressed', String(enabled));
    layoutState.textContent = enabled ? 'On' : 'Off';
});
// Hamburger menu. The panel floats over the canvas and stays open while editing, so the
// adjacency list can be watched as the graph changes; the button or Esc closes it.
const isPanelOpen = () => !panel.hasAttribute('hidden');
function setPanelOpen(open) {
    panel.toggleAttribute('hidden', !open);
    panelBtn.setAttribute('aria-expanded', String(open));
}
panelBtn.addEventListener('click', () => setPanelOpen(!isPanelOpen()));
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isPanelOpen())
        setPanelOpen(false);
});
refreshPanels();
showMessage('Click empty space to add a node.');
//# sourceMappingURL=main.js.map