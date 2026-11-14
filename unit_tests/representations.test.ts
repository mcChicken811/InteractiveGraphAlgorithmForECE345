import { beforeEach, describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import { renderAdjacencyList, renderAdjacencyMatrix } from '../src/representations.js';

/** 0 → 1 (4), 0 → 2 (−1), 2 → 1 (3), drawn directed and weighted. */
let g: Graph;
let target: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="t"></div>';
  target = document.querySelector('#t')!;
  g = new Graph();
  for (let i = 0; i < 3; i++) g.addNode(0, 0);
  g.directed = true;
  g.addEdge(0, 1, 4);
  g.addEdge(0, 2, -1);
  g.addEdge(2, 1, 3);
});

const focused = () => [...target.querySelectorAll('.sim-focus')];

describe('picking out an edge (Bellman–Ford’s next edge)', () => {
  it('adjacency list: the from vertex, and the to vertex in its row only', () => {
    renderAdjacencyList(target, g.view('directed', 'weighted'), { from: 0, to: 2 });
    const marked = focused();
    expect(marked).toHaveLength(2);
    expect(marked[0].className).toContain('adj-vertex');
    expect(marked[0].textContent).toBe('0');
    expect(marked[1].className).toContain('adj-box');
    expect(marked[1].querySelector('.adj-id')!.textContent).toBe('2');
    expect(marked[1].closest('.adj-row')!.querySelector('.adj-vertex')!.textContent).toBe('0'); // in 0's row
    for (const el of marked) expect(el.getAttribute('aria-current')).toBe('true');
  });

  it('adjacency matrix: the cell in row from, column to', () => {
    renderAdjacencyMatrix(target, g.view('directed', 'weighted'), { from: 2, to: 1 });
    const marked = focused();
    expect(marked).toHaveLength(1);
    const td = marked[0] as HTMLTableCellElement;
    expect(td.textContent).toBe('3');
    expect(td.parentElement!.querySelector('th')!.textContent).toBe('2'); // row 2
    expect(target.querySelectorAll('thead th')[td.cellIndex - 1].textContent).toBe('1'); // column 1
  });

  it('undirected: the edge u → v picks out row u (the reverse way, row v)', () => {
    const view = g.view('undirected', 'weighted');
    renderAdjacencyList(target, view, { from: 1, to: 0 });
    expect(focused().map((el) => el.textContent)).toEqual(['1', '04']);
    renderAdjacencyMatrix(target, view, { from: 1, to: 0 });
    expect((focused()[0].parentElement as HTMLTableRowElement).rowIndex).toBe(2); // header row, then rows 0, 1
  });

  it('nothing is picked out without an edge (every other algorithm)', () => {
    renderAdjacencyList(target, g.view('directed', 'weighted'));
    expect(focused()).toHaveLength(0);
    renderAdjacencyMatrix(target, g.view('directed', 'weighted'), null);
    expect(focused()).toHaveLength(0);
  });
});
