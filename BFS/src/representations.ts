import type { Graph } from './graph.js';

/**
 * Views of the two standard graph representations shown in the ☰ panel:
 * the adjacency list and the adjacency matrix, with a left/right switch between them.
 */

const EMPTY = 'No nodes yet.';

/** Renders "id: neighbours" lines into a <pre>. */
export function renderAdjacencyList(target: HTMLElement, graph: Graph): void {
  const rows = graph.adjacencyList();
  target.textContent = rows.length
    ? rows.map(({ id, neighbors }) => `${id}: ${neighbors.length ? neighbors.join(', ') : '—'}`).join('\n')
    : EMPTY;
}

/** Renders the adjacency matrix as a table with node ids as row and column headers. */
export function renderAdjacencyMatrix(target: HTMLElement, graph: Graph): void {
  const { ids, matrix } = graph.adjacencyMatrix();
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
