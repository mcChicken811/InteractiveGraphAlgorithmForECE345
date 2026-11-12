// Compiled by `npm run build` to build/main.js, which index.html loads directly.
// Imports use .js extensions because browsers resolve them verbatim (no bundler).
import { Graph } from './graph.js';
import { GraphEditor } from './editor.js';

const svg = document.querySelector<SVGSVGElement>('#canvas')!;
const stats = document.querySelector<HTMLElement>('#stats')!;
const messageEl = document.querySelector<HTMLElement>('#message')!;
const adjacencyEl = document.querySelector<HTMLElement>('#adjacency')!;
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

  const nodes = graph.getNodes();
  adjacencyEl.textContent = nodes.length
    ? nodes
        .map((node) => {
          const nbrs = graph.neighbors(node.id);
          return `${node.id}: ${nbrs.length ? nbrs.join(', ') : '—'}`;
        })
        .join('\n')
    : 'No nodes yet.';
}

function showMessage(text: string, tone: 'info' | 'warn' = 'info'): void {
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
const isPanelOpen = (): boolean => !panel.hasAttribute('hidden');

function setPanelOpen(open: boolean): void {
  panel.toggleAttribute('hidden', !open);
  panelBtn.setAttribute('aria-expanded', String(open));
}

panelBtn.addEventListener('click', () => setPanelOpen(!isPanelOpen()));

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isPanelOpen()) setPanelOpen(false);
});

refreshPanels();
showMessage('Click empty space to add a node.');
