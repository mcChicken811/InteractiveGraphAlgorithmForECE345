import type { GraphView } from './graph-views.js';

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
export function renderAdjacencyList(target: HTMLElement, view: GraphView): void {
  const rows = view.adjacencyList();
  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'adj-empty';
    empty.textContent = EMPTY;
    target.replaceChildren(empty);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'adj-list';
  list.setAttribute('aria-label', 'Adjacency list');
  // Every box shares one width (sized for the longest id), keeping the vertex column aligned.
  const digits = Math.max(...rows.map((r) => String(r.id).length));
  list.style.setProperty('--adj-cell', `${Math.max(28, 12 + digits * 9)}px`);

  for (const { id, neighbors } of rows) {
    const row = document.createElement('li');
    row.className = 'adj-row';

    const vertex = document.createElement('span');
    vertex.className = 'adj-vertex';
    vertex.textContent = String(id);

    const chain = document.createElement('ul');
    chain.className = 'adj-neighbors';
    chain.setAttribute('aria-label', `${view.directed ? 'Out-neighbours' : 'Neighbours'} of ${id}`);
    for (const n of neighbors) {
      const box = document.createElement('li');
      box.className = 'adj-box';
      box.textContent = String(n);
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
export function renderAdjacencyMatrix(target: HTMLElement, view: GraphView): void {
  const { ids, matrix } = view.adjacencyMatrix();
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
      const td = cell('td', String(value));
      if (value) td.classList.add('on');
      if (i === j) td.classList.add('diag');
      tr.append(td);
    });
    body.append(tr);
  });

  target.replaceChildren(table);
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
