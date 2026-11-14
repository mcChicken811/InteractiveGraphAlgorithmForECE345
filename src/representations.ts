import type { GraphView } from './graph-views.js';
import type { NodeId } from './graph.js';

/**
 * An edge to pick out in the representations (Bellman–Ford's next edge): its from vertex
 * and, in that row, its to vertex in the list; row `from`, column `to` in the matrix.
 */
export type FocusEdge = { from: NodeId; to: NodeId } | null;

/**
 * Renders the two standard graph representations shown in the ☰ panel: the adjacency
 * list and the adjacency matrix, with a left/right switch between them. The renderers
 * take a read-only GraphView, so they can show either the directed or the undirected
 * reading of the graph.
 */

const EMPTY = 'No nodes yet.';

/**
 * Renders the adjacency list as boxes: a column of vertex boxes on the left, then, after
 * a gap, each vertex's neighbours as boxes joined left to right (like an array).
 * Built from nested lists so screen readers announce "Neighbours of 0, 2 items" etc.
 */
export function renderAdjacencyList(target: HTMLElement, view: GraphView, focus: FocusEdge = null): void {
  // Weighted views: each neighbour box also shows the edge's weight (below the id).
  const rows = view.weightedAdjacencyList();
  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'adj-empty';
    empty.textContent = EMPTY;
    target.replaceChildren(empty);
    return;
  }

  const list = document.createElement('ul');
  list.className = view.weighted ? 'adj-list weighted' : 'adj-list';
  list.setAttribute('aria-label', 'Adjacency list');
  // Every box shares one width (sized for the longest id), keeping the vertex column aligned.
  const digits = Math.max(
    ...rows.map((r) => String(r.id).length),
    ...(view.weighted ? rows.flatMap((r) => r.neighbors.map((n) => String(n.weight).length)) : []),
  );
  list.style.setProperty('--adj-cell', `${Math.max(28, 12 + digits * 9)}px`);

  for (const { id, neighbors } of rows) {
    const row = document.createElement('li');
    row.className = 'adj-row';

    const vertex = document.createElement('span');
    vertex.className = 'adj-vertex';
    vertex.textContent = String(id);
    const focusRow = focus !== null && focus.from === id;
    if (focusRow) markFocus(vertex);

    const chain = document.createElement('ul');
    chain.className = 'adj-neighbors';
    chain.setAttribute('aria-label', `${view.directed ? 'Out-neighbours' : 'Neighbours'} of ${id}`);
    for (const n of neighbors) {
      const box = document.createElement('li');
      box.className = 'adj-box';
      if (focusRow && n.id === focus.to) markFocus(box);
      const idEl = document.createElement('span');
      idEl.className = 'adj-id';
      idEl.textContent = String(n.id);
      box.append(idEl);
      if (view.weighted) {
        const weightEl = document.createElement('span');
        weightEl.className = 'adj-weight';
        weightEl.textContent = String(n.weight);
        weightEl.setAttribute('aria-label', `weight ${n.weight}`);
        box.append(weightEl);
      }
      chain.append(box);
    }

    row.append(vertex, chain);
    if (neighbors.length === 0) {
      const none = document.createElement('span');
      none.className = 'adj-none';
      none.setAttribute('aria-hidden', 'true');
      none.textContent = '∅';
      row.append(none);
    }
    list.append(row);
  }
  target.replaceChildren(list);
}

/** Renders the adjacency matrix as a table with node ids as row and column headers. */
export function renderAdjacencyMatrix(target: HTMLElement, view: GraphView, focus: FocusEdge = null): void {
  // Unweighted: 0/1. Weighted: the weight, or "—" where there is no edge (0 is a real weight).
  const { ids, matrix } = view.weighted ? view.weightMatrix() : view.adjacencyMatrix();
  if (ids.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'matrix-empty';
    empty.textContent = EMPTY;
    target.replaceChildren(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'matrix';
  table.setAttribute('aria-label', 'Adjacency matrix');

  const headRow = document.createElement('tr');
  const corner = document.createElement('td');
  corner.className = 'corner';
  headRow.append(corner);
  for (const id of ids) headRow.append(cell('th', String(id), { scope: 'col' }));
  table.createTHead().append(headRow);

  const body = table.createTBody();
  matrix.forEach((row, i) => {
    const tr = document.createElement('tr');
    tr.append(cell('th', String(ids[i]), { scope: 'row' }));
    row.forEach((value, j) => {
      const present = view.weighted ? value !== null : value === 1;
      const td = cell('td', value === null ? '—' : String(value));
      if (present) td.classList.add('on');
      if (i === j) td.classList.add('diag');
      if (focus !== null && ids[i] === focus.from && ids[j] === focus.to) markFocus(td);
      tr.append(td);
    });
    body.append(tr);
  });

  target.replaceChildren(table);
}

/** Picks out an element as the focus edge's (white, as the edge on the canvas). */
function markFocus(el: HTMLElement): void {
  el.classList.add('sim-focus');
  el.setAttribute('aria-current', 'true');
}

function cell(tag: 'th' | 'td', text: string, attrs: Record<string, string> = {}): HTMLTableCellElement {
  const el = document.createElement(tag);
  el.textContent = text;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/**
 * Wires a tab list (ARIA tabs pattern): clicking a tab, or Left/Right/Home/End while one
 * is focused, selects it and shows its panel (the element named by aria-controls).
 */
export function setupTabs(tablist: HTMLElement): void {
  const tabs = [...tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]')];

  const select = (index: number, focus: boolean): void => {
    tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')!)?.toggleAttribute('hidden', !selected);
    });
    if (focus) tabs[index].focus();
  };

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(i, false));
    tab.addEventListener('keydown', (e) => {
      const next: Record<string, number> = {
        ArrowRight: (i + 1) % tabs.length,
        ArrowLeft: (i - 1 + tabs.length) % tabs.length,
        Home: 0,
        End: tabs.length - 1,
      };
      if (e.key in next) {
        e.preventDefault();
        select(next[e.key], true);
      }
    });
  });
}
