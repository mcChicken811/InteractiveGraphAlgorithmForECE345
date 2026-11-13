import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { Graph } from '../src/graph.js';
import { GraphEditor, NODE_RADIUS, WEIGHT_PER_PAGE, type EditorCallbacks } from '../src/editor.js';

const WIDTH = 800;
const HEIGHT = 600;

let svg: SVGSVGElement;
let graph: Graph;
let editor: GraphEditor;
let onChange: Mock<NonNullable<EditorCallbacks['onChange']>>;
let onMessage: Mock<NonNullable<EditorCallbacks['onMessage']>>;

beforeEach(() => {
  document.body.innerHTML = '<svg id="canvas"></svg>';
  svg = document.querySelector<SVGSVGElement>('#canvas')!;
  // happy-dom has no layout engine: give the canvas a fixed size at the page origin.
  svg.getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 0, top: 0, width: WIDTH, height: HEIGHT, right: WIDTH, bottom: HEIGHT }) as DOMRect;
  svg.setPointerCapture = () => {};

  graph = new Graph();
  onChange = vi.fn();
  onMessage = vi.fn();
  editor = new GraphEditor(svg, graph, { onChange, onMessage });
});

// ------------------------------------------------------------------ helpers

function pointer(target: Element, type: string, x: number, y: number, button = 0): void {
  target.dispatchEvent(
    new PointerEvent(type, { clientX: x, clientY: y, button, pointerId: 1, bubbles: true }),
  );
}

/** Press on `target`; move and release are delivered to the svg, as with pointer capture. */
function clickOn(target: Element, x: number, y: number): void {
  pointer(target, 'pointerdown', x, y);
  pointer(svg, 'pointerup', x, y);
}

function clickBackground(x: number, y: number): void {
  clickOn(svg, x, y);
}

function nodeEl(id: number): SVGGElement {
  const el = svg.querySelector<SVGGElement>(`[data-node-id="${id}"]`);
  if (!el) throw new Error(`node ${id} not rendered`);
  return el;
}

function clickNode(id: number): void {
  const { x, y } = graph.getNode(id)!;
  clickOn(nodeEl(id).querySelector('circle')!, x, y);
}

function edgeEl(a: number, b: number): SVGGElement | null {
  return svg.querySelector<SVGGElement>(`[data-edge-a="${a}"][data-edge-b="${b}"]`);
}

function lastMessage(): [string, string] {
  return onMessage.mock.lastCall as [string, string];
}

/** Adds nodes 0..n-1 spaced along a row. */
function addRow(n: number): void {
  for (let i = 0; i < n; i++) clickBackground(100 + i * 150, 300);
}

// -------------------------------------------------------------------- tests

describe('GraphEditor', () => {
  it('sets up the rendering layers', () => {
    expect(svg.querySelector('g.edges')).not.toBeNull();
    expect(svg.querySelector('g.nodes')).not.toBeNull();
    expect(svg.querySelector<SVGLineElement>('.preview-line')!.style.display).toBe('none');
  });

  describe('adding nodes', () => {
    it('adds a node where the background is clicked', () => {
      clickBackground(200, 150);
      expect(graph.getNodes()).toEqual([{ id: 0, x: 200, y: 150 }]);
      expect(nodeEl(0).getAttribute('transform')).toBe('translate(200 150)');
      expect(nodeEl(0).querySelector('text')!.textContent).toBe('0');
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(lastMessage()[0]).toBe('Added node 0.');
    });

    it('keeps new nodes fully inside the canvas', () => {
      clickBackground(2, 2);
      clickBackground(WIDTH - 1, HEIGHT - 1);
      const [a, b] = graph.getNodes();
      expect(a.x).toBeGreaterThanOrEqual(NODE_RADIUS);
      expect(a.y).toBeGreaterThanOrEqual(NODE_RADIUS);
      expect(b.x).toBeLessThanOrEqual(WIDTH - NODE_RADIUS);
      expect(b.y).toBeLessThanOrEqual(HEIGHT - NODE_RADIUS);
    });

    it('refuses to place a node overlapping another', () => {
      clickBackground(200, 200);
      onChange.mockClear();
      clickBackground(200 + NODE_RADIUS + 5, 200); // outside node 0, but too close
      expect(graph.nodeCount).toBe(1);
      expect(onChange).not.toHaveBeenCalled();
      expect(lastMessage()).toEqual([expect.stringContaining('Too close to node 0'), 'warn']);
    });

    it('does not add a node when the press turns into a drag', () => {
      pointer(svg, 'pointerdown', 100, 100);
      pointer(svg, 'pointermove', 160, 100);
      pointer(svg, 'pointerup', 160, 100);
      expect(graph.nodeCount).toBe(0);
    });

    it('ignores non-primary buttons', () => {
      pointer(svg, 'pointerdown', 100, 100, 2);
      pointer(svg, 'pointerup', 100, 100, 2);
      expect(graph.nodeCount).toBe(0);
    });
  });

  describe('selecting and connecting', () => {
    beforeEach(() => {
      addRow(3);
      onChange.mockClear();
    });

    it('selects a node on click', () => {
      clickNode(1);
      expect(nodeEl(1).classList.contains('selected')).toBe(true);
      expect(svg.classList.contains('has-selection')).toBe(true);
      expect(lastMessage()[0]).toContain('Node 1 selected');
    });

    it('connects two nodes clicked in sequence and clears the selection', () => {
      clickNode(0);
      clickNode(2);
      expect(graph.getEdges()).toEqual([[0, 2]]);
      expect(edgeEl(0, 2)).not.toBeNull();
      expect(svg.querySelectorAll('.selected')).toHaveLength(0);
      expect(svg.classList.contains('has-selection')).toBe(false);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(lastMessage()[0]).toBe('Added edge 0 — 2.');
    });

    it('positions edge lines on the node centres', () => {
      clickNode(0);
      clickNode(1);
      for (const line of edgeEl(0, 1)!.querySelectorAll('line')) {
        expect(line.getAttribute('x1')).toBe('100');
        expect(line.getAttribute('y1')).toBe('300');
        expect(line.getAttribute('x2')).toBe('250');
        expect(line.getAttribute('y2')).toBe('300');
      }
    });

    it('clicking the selected node again deselects it', () => {
      clickNode(1);
      clickNode(1);
      expect(nodeEl(1).classList.contains('selected')).toBe(false);
      expect(graph.edgeCount).toBe(0);
    });

    it('warns about duplicate edges and keeps the selection', () => {
      clickNode(0);
      clickNode(1);
      onChange.mockClear();
      clickNode(1);
      clickNode(0);
      expect(graph.edgeCount).toBe(1);
      expect(onChange).not.toHaveBeenCalled();
      expect(lastMessage()).toEqual(['Nodes 1 and 0 are already connected.', 'warn']);
      expect(nodeEl(1).classList.contains('selected')).toBe(true);
    });

    it('clicking the background while a node is selected cancels instead of adding', () => {
      clickNode(0);
      clickBackground(600, 100);
      expect(graph.nodeCount).toBe(3);
      expect(svg.querySelectorAll('.selected')).toHaveLength(0);
      expect(lastMessage()[0]).toBe('Selection cleared.');
    });

    it('shows a preview line from the selected node to the cursor', () => {
      const preview = svg.querySelector<SVGLineElement>('.preview-line')!;
      clickNode(0);
      pointer(svg, 'pointermove', 400, 500);
      expect(preview.style.display).toBe('');
      expect(preview.getAttribute('x1')).toBe('100');
      expect(preview.getAttribute('y1')).toBe('300');
      expect(preview.getAttribute('x2')).toBe('400');
      expect(preview.getAttribute('y2')).toBe('500');

      svg.dispatchEvent(new PointerEvent('pointerleave'));
      expect(preview.style.display).toBe('none');
    });
  });

  describe('deleting', () => {
    beforeEach(() => {
      addRow(3);
      clickNode(0);
      clickNode(1);
      clickNode(1);
      clickNode(2);
      onChange.mockClear();
    });

    it('removes an edge when it is clicked', () => {
      clickOn(edgeEl(0, 1)!.querySelector('.edge-hit')!, 175, 300);
      expect(graph.getEdges()).toEqual([[1, 2]]);
      expect(edgeEl(0, 1)).toBeNull();
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(lastMessage()[0]).toBe('Removed edge 0 — 1.');
    });

    it('removes a node and its edges on right-click', () => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      nodeEl(1).querySelector('circle')!.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(graph.getNodes().map((n) => n.id)).toEqual([0, 2]);
      expect(graph.edgeCount).toBe(0);
      expect(svg.querySelectorAll('.node')).toHaveLength(2);
      expect(svg.querySelectorAll('.edge')).toHaveLength(0);
    });

    it('leaves the browser context menu alone on empty space', () => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      svg.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(graph.nodeCount).toBe(3);
    });

    it('Delete removes the selected node', () => {
      clickNode(2);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
      expect(graph.getNode(2)).toBeUndefined();
      expect(graph.getEdges()).toEqual([[0, 1]]);
    });

    it('Backspace removes the selected node', () => {
      clickNode(0);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
      expect(graph.getNode(0)).toBeUndefined();
    });

    it('Escape cancels the selection without deleting', () => {
      clickNode(0);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(graph.nodeCount).toBe(3);
      expect(svg.querySelectorAll('.selected')).toHaveLength(0);
    });

    it('Delete does nothing without a selection', () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
      expect(graph.nodeCount).toBe(3);
    });

    it('clear() empties the graph and the canvas', () => {
      editor.clear();
      expect(graph.nodeCount).toBe(0);
      expect(svg.querySelectorAll('.node, .edge')).toHaveLength(0);
      expect(onChange).toHaveBeenCalledTimes(1);
    });
  });

  describe('dragging', () => {
    beforeEach(() => {
      addRow(2);
      clickNode(0);
      clickNode(1);
    });

    it('moves the node and its edges, without selecting it', () => {
      const circle = nodeEl(0).querySelector('circle')!;
      pointer(circle, 'pointerdown', 105, 305); // grab slightly off-centre
      expect(svg.classList.contains('dragging')).toBe(false);
      pointer(svg, 'pointermove', 205, 405);
      expect(svg.classList.contains('dragging')).toBe(true);
      pointer(svg, 'pointerup', 205, 405);

      expect(graph.getNode(0)).toMatchObject({ x: 200, y: 400 });
      expect(nodeEl(0).getAttribute('transform')).toBe('translate(200 400)');
      expect(edgeEl(0, 1)!.querySelector('line')!.getAttribute('x1')).toBe('200');
      expect(nodeEl(0).classList.contains('selected')).toBe(false);
      expect(svg.classList.contains('dragging')).toBe(false);
    });

    it('treats tiny movements as a click', () => {
      const circle = nodeEl(0).querySelector('circle')!;
      pointer(circle, 'pointerdown', 100, 300);
      pointer(svg, 'pointermove', 102, 301);
      pointer(svg, 'pointerup', 102, 301);
      expect(graph.getNode(0)).toMatchObject({ x: 100, y: 300 });
      expect(nodeEl(0).classList.contains('selected')).toBe(true);
    });

    it('keeps a dragged node inside the canvas', () => {
      const circle = nodeEl(1).querySelector('circle')!;
      pointer(circle, 'pointerdown', 250, 300);
      pointer(svg, 'pointermove', WIDTH + 500, -500);
      pointer(svg, 'pointerup', WIDTH + 500, -500);
      expect(graph.getNode(1)!.x).toBeLessThanOrEqual(WIDTH - NODE_RADIUS);
      expect(graph.getNode(1)!.y).toBeGreaterThanOrEqual(NODE_RADIUS);
    });

    it('pointercancel ends the drag', () => {
      const circle = nodeEl(0).querySelector('circle')!;
      pointer(circle, 'pointerdown', 100, 300);
      pointer(svg, 'pointermove', 150, 300);
      svg.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }));
      expect(svg.classList.contains('dragging')).toBe(false);
      // A later background click works normally.
      clickBackground(600, 100);
      expect(graph.nodeCount).toBe(3);
    });
  });
});

describe('GraphEditor randomise', () => {
  const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  it('on an empty canvas: scatters nodes clear of each other and the overlays, and connects them', () => {
    // A second editor, on a canvas of its own, that reports a toolbar and a status bar.
    document.body.innerHTML = '<svg id="canvas"></svg>';
    svg = document.querySelector<SVGSVGElement>('#canvas')!;
    svg.getBoundingClientRect = () =>
      ({ x: 0, y: 0, left: 0, top: 0, width: WIDTH, height: HEIGHT, right: WIDTH, bottom: HEIGHT }) as DOMRect;
    graph = new Graph();
    const insetEditor = new GraphEditor(svg, graph, { onMessage, canvasInsets: () => ({ top: 60, bottom: 96 }) });
    insetEditor.randomise(seeded(7));
    const nodes = graph.getNodes();
    expect(nodes.length).toBeGreaterThanOrEqual(5);
    expect(nodes.length).toBeLessThanOrEqual(10);
    for (const n of nodes) {
      expect(n.x).toBeGreaterThanOrEqual(NODE_RADIUS);
      expect(n.x).toBeLessThanOrEqual(WIDTH - NODE_RADIUS);
      expect(n.y).toBeGreaterThanOrEqual(60 + NODE_RADIUS);
      expect(n.y).toBeLessThanOrEqual(HEIGHT - 96 - NODE_RADIUS);
      for (const m of nodes) if (m !== n) expect(Math.hypot(n.x - m.x, n.y - m.y)).toBeGreaterThanOrEqual(NODE_RADIUS * 2 + 56);
    }
    expect(graph.connectedComponents()).toHaveLength(1);
    expect(svg.querySelectorAll('.node')).toHaveLength(nodes.length);
    expect(lastMessage()[0]).toBe(
      `Random undirected, unweighted graph: ${nodes.length} nodes and ${graph.getArcs().length} edges.`,
    );
  });

  /** The stored arcs grouped by pair: how many pairs are joined both ways, and every weight. */
  const arcSummary = () => {
    const arcs = graph.getArcs();
    const pairs = new Set(arcs.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`));
    return { arcs, bothWays: arcs.length - pairs.size, weights: arcs.map(([a, b]) => graph.arcWeight(a, b)!) };
  };

  it('undirected, unweighted: one arc per pair (either way round), all of weight 0', () => {
    editor.randomise(seeded(3));
    const { arcs, bothWays, weights } = arcSummary();
    expect(arcs.length).toBeGreaterThanOrEqual(graph.nodeCount - 1);
    expect(bothWays).toBe(0);
    expect(weights.every((w) => w === 0)).toBe(true);
    // Stored as directed arcs, not all from the lower id to the higher.
    expect(arcs.some(([a, b]) => a > b) && arcs.some(([a, b]) => a < b)).toBe(true);
  });

  it('undirected, weighted: one arc per pair, weights 1–20', () => {
    editor.setWeighted(true);
    editor.randomise(seeded(3));
    const { bothWays, weights } = arcSummary();
    expect(bothWays).toBe(0);
    expect(weights.every((w) => Number.isInteger(w) && w >= 1 && w <= 20)).toBe(true);
    expect(lastMessage()[0]).toMatch(/^Random undirected, weighted graph: /);
  });

  it('directed: some pairs are joined both ways; the edge count is the arc count', () => {
    editor.setDirected(true);
    let seen = 0;
    for (let seed = 1; seed <= 10 && !seen; seed++) {
      editor.clear();
      editor.randomise(seeded(seed));
      const { arcs, bothWays, weights } = arcSummary();
      seen = bothWays;
      expect(weights.every((w) => w === 0)).toBe(true);
      expect(graph.edgeCount).toBe(arcs.length);
      expect(lastMessage()[0]).toBe(`Random directed, unweighted graph: ${graph.nodeCount} nodes and ${arcs.length} edges.`);
    }
    expect(seen).toBeGreaterThan(0);
    // Weighted: each arc of a two-way pair has its own weight.
    editor.setWeighted(true);
    editor.randomise(seeded(2));
    expect(arcSummary().weights.every((w) => w >= 1 && w <= 20)).toBe(true);
  });

  it('with nodes placed: keeps them where they are and replaces their edges', () => {
    addRow(4);
    clickNode(0);
    clickNode(3); // an edge to be replaced
    clickNode(1); // and a selection to be dropped
    onChange.mockClear();
    // Lay the row out as a square so several edges are possible.
    graph.moveNode(0, 200, 150);
    graph.moveNode(1, 500, 150);
    graph.moveNode(2, 200, 450);
    graph.moveNode(3, 500, 450);
    const square = graph.getNodes().map((n) => [n.x, n.y]);
    editor.randomise(seeded(11));
    expect(graph.getNodes().map((n) => [n.x, n.y])).toEqual(square);
    expect(graph.connectedComponents()).toHaveLength(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(svg.querySelectorAll('.selected')).toHaveLength(0);
    expect(lastMessage()[0]).toBe(`Random undirected, unweighted edges between the 4 nodes: ${graph.getArcs().length} edges.`);
  });

  it('a single node has nothing to connect to', () => {
    clickBackground(300, 300);
    editor.randomise(seeded(1));
    expect(graph.nodeCount).toBe(1);
    expect(graph.getArcs()).toEqual([]);
    expect(lastMessage()).toEqual(['Randomise needs at least two nodes to connect.', 'warn']);
  });

  it('does nothing while the graph is locked', () => {
    editor.setLocked(true);
    editor.randomise(seeded(1));
    expect(graph.nodeCount).toBe(0);
  });
});

describe('GraphEditor auto-layout', () => {
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {
      frames = [];
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Runs queued animation frames (each may queue the next) and returns how many ran. */
  function flushFrames(max = 2000): number {
    let ran = 0;
    while (frames.length && ran < max) {
      frames.shift()!(performance.now());
      ran++;
    }
    return ran;
  }

  function minPairDistance(): number {
    const nodes = graph.getNodes();
    let min = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        min = Math.min(min, Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y));
      }
    }
    return min;
  }

  /** Four nodes in a cramped 2×2 cluster, connected as a path 0-1-2-3. */
  function addCrampedPath(): void {
    clickBackground(380, 280);
    clickBackground(440, 280);
    clickBackground(440, 340);
    clickBackground(380, 340);
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [2, 3],
    ]) {
      clickNode(a);
      clickNode(b);
    }
  }

  it('is off by default and never animates', () => {
    expect(editor.autoLayoutEnabled).toBe(false);
    addCrampedPath();
    expect(frames).toHaveLength(0);
    expect(graph.getNode(0)).toMatchObject({ x: 380, y: 280 });
  });

  it('spreads out a cramped graph when turned on', () => {
    addCrampedPath();
    const before = minPairDistance();
    editor.setAutoLayout(true);
    expect(editor.autoLayoutEnabled).toBe(true);
    expect(lastMessage()[0]).toContain('Auto-layout on');

    const ran = flushFrames();
    expect(ran).toBeGreaterThan(1); // animated over several frames
    expect(frames).toHaveLength(0); // ...then stopped by itself
    expect(minPairDistance()).toBeGreaterThan(before * 1.5);
    // The DOM follows the model.
    const n0 = graph.getNode(0)!;
    expect(nodeEl(0).getAttribute('transform')).toBe(`translate(${n0.x} ${n0.y})`);
  });

  it('does not report layout movement as a structural change', () => {
    addCrampedPath();
    onChange.mockClear();
    editor.setAutoLayout(true);
    flushFrames();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('re-runs the layout when the graph changes', () => {
    addCrampedPath();
    editor.setAutoLayout(true);
    flushFrames();
    const settled = graph.getNodes().map((n) => ({ ...n }));

    clickNode(0);
    clickNode(3); // close the cycle
    expect(frames.length).toBeGreaterThan(0);
    flushFrames();
    expect(graph.getNodes()).not.toEqual(settled);
  });

  it('freezes nodes in place when turned off', () => {
    addCrampedPath();
    editor.setAutoLayout(true);
    flushFrames(5);
    editor.setAutoLayout(false);
    expect(lastMessage()[0]).toContain('Auto-layout off');
    const frozen = graph.getNodes().map((n) => ({ ...n }));

    flushFrames();
    clickBackground(700, 500); // structural change while off
    flushFrames();
    expect(graph.getNodes().slice(0, 4)).toEqual(frozen);
  });

  it('keeps a dragged node under the pointer while the others react', () => {
    addCrampedPath();
    editor.setAutoLayout(true);
    flushFrames();

    const n0 = graph.getNode(0)!;
    pointer(nodeEl(0).querySelector('circle')!, 'pointerdown', n0.x, n0.y);
    pointer(svg, 'pointermove', 150, 120);
    flushFrames(30); // layout frames while the button is still held
    expect(graph.getNode(0)).toMatchObject({ x: 150, y: 120 });

    pointer(svg, 'pointerup', 150, 120);
    flushFrames();
    expect(frames).toHaveLength(0);
  });

  it('turning it on twice is a no-op', () => {
    editor.setAutoLayout(true);
    onMessage.mockClear();
    editor.setAutoLayout(true);
    expect(onMessage).not.toHaveBeenCalled();
  });
});

describe('GraphEditor directed / undirected mode', () => {
  beforeEach(() => {
    addRow(3); // nodes 0, 1, 2 at x = 100, 250, 400 (y = 300)
    onChange.mockClear();
  });

  function edgeGroups(): SVGGElement[] {
    return [...svg.querySelectorAll<SVGGElement>('.edge')];
  }

  it('starts undirected, with no arrow styling', () => {
    expect(editor.directed).toBe(false);
    expect(svg.classList.contains('directed')).toBe(false);
    expect(svg.querySelector('defs marker#arrow')).not.toBeNull();
  });

  it('switching mode re-renders, reports a change and explains the mode', () => {
    editor.setDirected(true);
    expect(editor.directed).toBe(true);
    expect(graph.directed).toBe(true);
    expect(svg.classList.contains('directed')).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(lastMessage()[0]).toContain('Directed');
    editor.setDirected(true); // no-op
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('clicking A then B stores the arc A → B in either mode', () => {
    clickNode(2);
    clickNode(0);
    expect(graph.getArcs()).toEqual([[2, 0]]);
    editor.setDirected(true);
    clickNode(0);
    clickNode(1);
    expect(graph.getArcs()).toEqual([
      [0, 1],
      [2, 0],
    ]);
    expect(lastMessage()[0]).toBe('Added edge 0 → 1.');
  });

  it('undirected: a single stored arc is drawn as one plain line, centre to centre', () => {
    clickNode(2);
    clickNode(0); // arc 2 → 0
    const [g] = edgeGroups();
    expect(edgeGroups()).toHaveLength(1);
    expect(g.dataset.edgeA).toBe('0'); // pair keyed as [min, max]
    expect(g.dataset.edgeB).toBe('2');
    expect(g.querySelector('.edge-line')!.getAttribute('x1')).toBe('100');
    expect(g.querySelector('.edge-line')!.getAttribute('x2')).toBe('400');
  });

  it('directed: an arc is a line that stops at the target node’s rim', () => {
    editor.setDirected(true);
    clickNode(0);
    clickNode(1);
    const line = svg.querySelector('[data-edge-a="0"][data-edge-b="1"] .edge-line')!;
    expect(line.tagName).toBe('line');
    expect(line.getAttribute('x1')).toBe('100');
    expect(Number(line.getAttribute('x2'))).toBeCloseTo(250 - NODE_RADIUS - 1);
  });

  it('directed: arcs both ways are drawn as two separate curves', () => {
    editor.setDirected(true);
    clickNode(0);
    clickNode(1);
    clickNode(1);
    clickNode(0);
    expect(edgeGroups()).toHaveLength(2);
    const there = svg.querySelector('[data-edge-a="0"][data-edge-b="1"] .edge-line')!;
    const back = svg.querySelector('[data-edge-a="1"][data-edge-b="0"] .edge-line')!;
    expect(there.tagName).toBe('path');
    expect(back.tagName).toBe('path');
    expect(there.getAttribute('d')).not.toBe(back.getAttribute('d'));
  });

  it('undirected: arcs both ways collapse into a single edge', () => {
    editor.setDirected(true);
    clickNode(0);
    clickNode(1);
    clickNode(1);
    clickNode(0);
    editor.setDirected(false);
    expect(edgeGroups()).toHaveLength(1);
    expect(graph.edgeCount).toBe(1);
  });

  it('undirected: connecting an already-connected pair the other way is refused', () => {
    clickNode(0);
    clickNode(1);
    clickNode(1);
    clickNode(0);
    expect(graph.getArcs()).toEqual([[0, 1]]);
    expect(lastMessage()).toEqual(['Nodes 1 and 0 are already connected.', 'warn']);
  });

  it('directed: a duplicate arc is refused, the reverse arc is not', () => {
    editor.setDirected(true);
    clickNode(0);
    clickNode(1);
    clickNode(0);
    clickNode(1);
    expect(lastMessage()).toEqual(['Edge 0 → 1 already exists.', 'warn']);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); // 0 stays selected after a refusal
    clickNode(1);
    clickNode(0);
    expect(graph.getArcs()).toEqual([
      [0, 1],
      [1, 0],
    ]);
  });

  it('directed: clicking an arc deletes only that arc', () => {
    editor.setDirected(true);
    clickNode(0);
    clickNode(1);
    clickNode(1);
    clickNode(0);
    clickOn(svg.querySelector('[data-edge-a="1"][data-edge-b="0"] .edge-hit')!, 175, 300);
    expect(graph.getArcs()).toEqual([[0, 1]]);
    expect(lastMessage()[0]).toBe('Removed edge 1 → 0.');
  });

  it('undirected: clicking the edge deletes the arcs in both directions', () => {
    editor.setDirected(true);
    clickNode(0);
    clickNode(1);
    clickNode(1);
    clickNode(0);
    editor.setDirected(false);
    clickOn(svg.querySelector('[data-edge-a="0"][data-edge-b="1"] .edge-hit')!, 175, 300);
    expect(graph.getArcs()).toEqual([]);
    expect(lastMessage()[0]).toBe('Removed edge 0 — 1.');
  });

  it('switching mode does not move any node', () => {
    clickNode(0);
    clickNode(1);
    const before = graph.getNodes().map((n) => ({ ...n }));
    editor.setDirected(true);
    editor.setDirected(false);
    expect(graph.getNodes()).toEqual(before);
  });
});

describe('GraphEditor weighted mode', () => {
  beforeEach(() => {
    addRow(3); // nodes 0, 1, 2 at x = 100, 250, 400 (y = 300)
    clickNode(0);
    clickNode(1); // arc 0 → 1, weight 0
    onChange.mockClear();
  });

  const page = () => window.innerHeight;

  /** Dispatches a wheel event on `target`; returns whether the page scroll was prevented. */
  function wheel(target: Element, deltaY: number, init: WheelEventInit = {}): boolean {
    const event = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true, ...init });
    // happy-dom's WheelEvent ignores modifier keys in its init dictionary.
    if (init.ctrlKey) Object.defineProperty(event, 'ctrlKey', { value: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }

  const hit = (a: number, b: number) => svg.querySelector(`[data-edge-a="${a}"][data-edge-b="${b}"] .edge-hit`)!;
  const label = (a: number, b: number) => svg.querySelector(`[data-edge-a="${a}"][data-edge-b="${b}"] .edge-weight text`)!;

  it('starts unweighted: scrolling does nothing and is not intercepted', () => {
    expect(editor.weighted).toBe(false);
    expect(svg.classList.contains('weighted')).toBe(false);
    expect(wheel(hit(0, 1), -page())).toBe(false);
    expect(graph.arcWeight(0, 1)).toBe(0);
  });

  it('switching to weighted shows labels, reports a change and explains scrolling', () => {
    editor.setWeighted(true);
    expect(editor.weighted).toBe(true);
    expect(graph.weighted).toBe(true);
    expect(svg.classList.contains('weighted')).toBe(true);
    expect(label(0, 1).textContent).toBe('0');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(lastMessage()[0]).toContain('scroll over an edge');
  });

  it(`one page of scrolling up adds ${WEIGHT_PER_PAGE}; down subtracts`, () => {
    editor.setWeighted(true);
    expect(wheel(hit(0, 1), -page())).toBe(true);
    expect(graph.arcWeight(0, 1)).toBe(WEIGHT_PER_PAGE);
    expect(label(0, 1).textContent).toBe(String(WEIGHT_PER_PAGE));
    expect(lastMessage()[0]).toBe(`Weight of edge 0 — 1: ${WEIGHT_PER_PAGE}`);

    wheel(hit(0, 1), 2 * page());
    expect(graph.arcWeight(0, 1)).toBe(-WEIGHT_PER_PAGE); // negative weights are allowed
  });

  it('is linear: small scrolls add up, with fractions carried over', () => {
    editor.setWeighted(true);
    const tenth = page() / 10; // 1.5 weight units each
    for (let i = 0; i < 10; i++) wheel(hit(0, 1), -tenth);
    expect(graph.arcWeight(0, 1)).toBe(WEIGHT_PER_PAGE);
    wheel(hit(0, 1), -tenth); // +1.5 → +1, carry 0.5
    expect(graph.arcWeight(0, 1)).toBe(WEIGHT_PER_PAGE + 1);
    wheel(hit(0, 1), -tenth); // 0.5 + 1.5 = 2
    expect(graph.arcWeight(0, 1)).toBe(WEIGHT_PER_PAGE + 3);
  });

  it('keeps weights whole numbers', () => {
    editor.setWeighted(true);
    wheel(hit(0, 1), -page() / 7);
    expect(Number.isInteger(graph.arcWeight(0, 1))).toBe(true);
  });

  it('understands line- and page-based wheel deltas', () => {
    editor.setWeighted(true);
    wheel(hit(0, 1), -1, { deltaMode: 2 }); // one page
    expect(graph.arcWeight(0, 1)).toBe(WEIGHT_PER_PAGE);
    const lines = page() / 16; // one page's worth of 16px lines
    wheel(hit(0, 1), lines, { deltaMode: 1 });
    expect(graph.arcWeight(0, 1)).toBeCloseTo(0, 0);
  });

  it('the carry does not leak from one edge to another', () => {
    editor.setWeighted(true);
    clickNode(1);
    clickNode(2);
    wheel(hit(0, 1), -page() / 20); // +0.75, nothing applied yet
    wheel(hit(1, 2), -page() / 20); // a different edge starts from 0 again
    expect(graph.arcWeight(0, 1)).toBe(0);
    expect(graph.arcWeight(1, 2)).toBe(0);
  });

  it('scrolling over the weight label works too', () => {
    editor.setWeighted(true);
    wheel(label(0, 1), -page());
    expect(graph.arcWeight(0, 1)).toBe(WEIGHT_PER_PAGE);
  });

  it('ignores ctrl+wheel (browser zoom) and scrolling over empty space', () => {
    editor.setWeighted(true);
    expect(wheel(hit(0, 1), -page(), { ctrlKey: true })).toBe(false);
    expect(wheel(svg, -page())).toBe(false);
    expect(graph.arcWeight(0, 1)).toBe(0);
  });

  it('does not re-run the layout or count as a structural edit beyond the panel refresh', () => {
    editor.setWeighted(true);
    onChange.mockClear();
    wheel(hit(0, 1), -page());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(graph.getArcs()).toEqual([[0, 1]]);
  });

  it('directed: changes only the arc under the pointer', () => {
    editor.setDirected(true);
    editor.setWeighted(true);
    clickNode(1);
    clickNode(0); // add 1 → 0 (two curved arcs now)
    wheel(hit(1, 0), -page());
    expect(graph.arcWeight(1, 0)).toBe(WEIGHT_PER_PAGE);
    expect(graph.arcWeight(0, 1)).toBe(0);
    expect(lastMessage()[0]).toBe(`Weight of edge 1 → 0: ${WEIGHT_PER_PAGE}`);
  });

  it('undirected: shows the smaller of two arcs, and editing sets both', () => {
    editor.setDirected(true);
    clickNode(1);
    clickNode(0);
    graph.setWeight(0, 1, 8);
    graph.setWeight(1, 0, 3);
    editor.setDirected(false);
    editor.setWeighted(true);
    expect(label(0, 1).textContent).toBe('3');

    wheel(hit(0, 1), -page());
    expect(graph.arcWeight(0, 1)).toBe(3 + WEIGHT_PER_PAGE);
    expect(graph.arcWeight(1, 0)).toBe(3 + WEIGHT_PER_PAGE);
  });

  it('new edges in weighted mode mention their weight', () => {
    editor.setWeighted(true);
    clickNode(1);
    clickNode(2);
    expect(lastMessage()[0]).toBe('Added edge 1 — 2 with weight 0. Scroll over it to change the weight.');
  });

  it('switching weighting never changes stored weights or moves nodes', () => {
    editor.setWeighted(true);
    wheel(hit(0, 1), -page());
    const nodes = graph.getNodes().map((n) => ({ ...n }));
    editor.setWeighted(false);
    expect(graph.arcWeight(0, 1)).toBe(WEIGHT_PER_PAGE);
    expect(graph.getNodes()).toEqual(nodes);
  });
});

describe('GraphEditor lock and algorithm highlight', () => {
  beforeEach(() => {
    addRow(3); // 0, 1, 2 at x = 100, 250, 400
    clickNode(0);
    clickNode(1);
    clickNode(1);
    clickNode(2);
    onChange.mockClear();
  });

  it('locking clears the selection and marks the canvas', () => {
    clickNode(0);
    expect(editor.selectedNode).toBe(0);
    editor.setLocked(true);
    expect(editor.isLocked).toBe(true);
    expect(editor.selectedNode).toBeNull();
    expect(svg.classList.contains('locked')).toBe(true);
  });

  it('while locked, clicks add, select, connect and delete nothing', () => {
    editor.setLocked(true);
    clickBackground(600, 500);
    clickNode(0);
    clickNode(2);
    clickOn(svg.querySelector('[data-edge-a="0"][data-edge-b="1"] .edge-hit')!, 175, 300);
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    nodeEl(2).querySelector('circle')!.dispatchEvent(event);

    expect(graph.nodeCount).toBe(3);
    expect(graph.getEdges()).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(editor.selectedNode).toBeNull();
    expect(event.defaultPrevented).toBe(true); // no browser menu either
    expect(onChange).not.toHaveBeenCalled();
    expect(lastMessage()).toEqual(['The graph is locked while the algorithm runs. Press Stop to edit it.', 'warn']);
  });

  it('while locked, nodes can still be dragged', () => {
    editor.setLocked(true);
    pointer(nodeEl(0).querySelector('circle')!, 'pointerdown', 100, 300);
    pointer(svg, 'pointermove', 160, 200);
    pointer(svg, 'pointerup', 160, 200);
    expect(graph.getNode(0)).toMatchObject({ x: 160, y: 200 });
  });

  it('while locked, weights cannot be scrolled', () => {
    editor.setWeighted(true);
    editor.setLocked(true);
    const event = new WheelEvent('wheel', { deltaY: -window.innerHeight, bubbles: true, cancelable: true });
    svg.querySelector('[data-edge-a="0"][data-edge-b="1"] .edge-hit')!.dispatchEvent(event);
    expect(graph.arcWeight(0, 1)).toBe(0);
    expect(event.defaultPrevented).toBe(false);
  });

  it('unlocking restores editing', () => {
    editor.setLocked(true);
    editor.setLocked(false);
    clickBackground(600, 500);
    expect(graph.nodeCount).toBe(4);
    expect(svg.classList.contains('locked')).toBe(false);
  });

  it('draws the highlight: current, finished vertices and active edges', () => {
    editor.setHighlight({ current: 1, done: [0], activeEdges: [[1, 0]] }); // [1,0] = the 0—1 edge (undirected)
    expect(nodeEl(1).classList.contains('sim-current')).toBe(true);
    expect(nodeEl(0).classList.contains('sim-done')).toBe(true);
    expect(nodeEl(2).classList.contains('sim-current') || nodeEl(2).classList.contains('sim-done')).toBe(false);
    expect(svg.querySelector('[data-edge-a="0"][data-edge-b="1"]')!.classList.contains('sim-active')).toBe(true);
    expect(svg.querySelector('[data-edge-a="1"][data-edge-b="2"]')!.classList.contains('sim-active')).toBe(false);

    editor.setHighlight(null);
    expect(svg.querySelectorAll('.sim-current, .sim-done, .sim-active')).toHaveLength(0);
  });

  it('draws running vertices (e.g. DFS on the recursion stack) yellow-ringed; current wins', () => {
    editor.setHighlight({ current: 1, done: [2], running: [0, 1], activeEdges: [] });
    expect(nodeEl(0).classList.contains('sim-running')).toBe(true);
    expect(nodeEl(1).classList.contains('sim-running')).toBe(true); // CSS draws current on top
    expect(nodeEl(1).classList.contains('sim-current')).toBe(true);
    expect(nodeEl(2).classList.contains('sim-running')).toBe(false);
    editor.setHighlight(null);
    expect(svg.querySelectorAll('.sim-running')).toHaveLength(0);
  });

  it('with explored edges given, the rest are marked unexplored; explored ones carry their tag', () => {
    const edge = (a: number, b: number) => svg.querySelector<SVGGElement>(`[data-edge-a="${a}"][data-edge-b="${b}"]`)!;
    editor.setHighlight({ current: 0, done: [], activeEdges: [] });
    expect(svg.querySelectorAll('.sim-unexplored, .sim-explored')).toHaveLength(0); // BFS: no tracking

    // The fixture is the path 0 — 1 — 2.
    editor.setHighlight({ current: 1, done: [], activeEdges: [], exploredEdges: [{ from: 0, to: 1 }] });
    expect(edge(0, 1).classList.contains('sim-unexplored')).toBe(false);
    expect(edge(1, 2).classList.contains('sim-unexplored')).toBe(true);

    editor.setHighlight({
      current: 2,
      done: [],
      activeEdges: [],
      exploredEdges: [
        { from: 0, to: 1 },
        { from: 2, to: 1, label: 'backward' }, // undirected: the 1—2 edge
      ],
    });
    expect(edge(0, 1).classList.contains('sim-explored')).toBe(true);
    expect(edge(0, 1).dataset.tag).toBeUndefined(); // tree edge: plain
    expect(edge(1, 2).classList.contains('sim-explored')).toBe(true);
    expect(edge(1, 2).dataset.tag).toBe('backward');
    expect(edge(1, 2).querySelector('.edge-tag text')!.textContent).toBe('backward');
    expect(svg.querySelectorAll('.edge.sim-unexplored')).toHaveLength(0);

    editor.setHighlight(null);
    expect(svg.querySelectorAll('.sim-unexplored, .sim-explored, [data-tag]')).toHaveLength(0);
  });

  it('explored edges marked done (e.g. Prim’s tree edges) are drawn in the finished colour', () => {
    const edge = (a: number, b: number) => svg.querySelector<SVGGElement>(`[data-edge-a="${a}"][data-edge-b="${b}"]`)!;
    editor.setHighlight({
      current: 2,
      done: [0, 1],
      activeEdges: [[1, 2]],
      exploredEdges: [{ from: 1, to: 0, done: true }], // undirected: the 0—1 edge
    });
    expect(edge(0, 1).classList.contains('sim-tree')).toBe(true);
    expect(edge(0, 1).classList.contains('sim-unexplored')).toBe(false);
    expect(edge(1, 2).classList.contains('sim-tree')).toBe(false);
    expect(edge(1, 2).classList.contains('sim-active')).toBe(true); // about to be added
    editor.setHighlight(null);
    expect(svg.querySelectorAll('.sim-tree')).toHaveLength(0);
  });

  it('draws a cut as one side’s Voronoi territory and its border', () => {
    // Settled cuts (reduced motion: no move between them).
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    // The fixture: 0, 1, 2 in a row at x = 100, 250, 400 (y = 300), joined 0 — 1 — 2; the
    // canvas is 800 × 600.
    const region = svg.querySelector('.cut-region')!;
    const border = svg.querySelector('.cut-border')!;
    const points = (d: string) =>
      [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
    /** The border's x coordinates (it is a vertical line here), to the nearest tenth. */
    const borderXs = () => [...new Set(points(border.getAttribute('d')!).map((p) => Math.round(p.x * 10) / 10))];
    /** Is p in the shaded territory (its loops, filled even-odd)? */
    const inTerritory = (p: { x: number; y: number }) => {
      let inside = false;
      for (const loop of region.getAttribute('d')!.split('Z').filter((part) => part.trim())) {
        const ps = points(loop);
        for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) {
          const [a, b] = [ps[i], ps[j]];
          if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
        }
      }
      return inside;
    };
    editor.setHighlight({ current: 1, done: [0], activeEdges: [], cut: [0] });
    expect(svg.classList.contains('has-cut')).toBe(true);
    // 0's territory is everything left of the bisector with 1, x = 175 (1 — 2 is on the
    // other side, and farther away).
    expect(borderXs()).toEqual([175]);
    const ys = points(border.getAttribute('d')!).map((p) => p.y);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([0, 600]); // across the whole canvas
    expect(inTerritory({ x: 170, y: 20 })).toBe(true);
    expect(inTerritory({ x: 180, y: 20 })).toBe(false);

    editor.setHighlight({ current: 2, done: [0, 1], activeEdges: [], cut: [0, 1] });
    expect(borderXs()).toEqual([325]); // between 1 and 2 now

    // The border follows a dragged vertex.
    pointer(nodeEl(2).querySelector('circle')!, 'pointerdown', 400, 300);
    pointer(svg, 'pointermove', 500, 300);
    pointer(svg, 'pointerup', 500, 300);
    expect(borderXs()).toEqual([375]);

    // Non-crossing edges belong to their side: with 0 alone on its side, the edge 1 — 2
    // (dragged down out of line) still keeps 0's territory from reaching it.
    pointer(nodeEl(2).querySelector('circle')!, 'pointerdown', 500, 300);
    pointer(svg, 'pointermove', 100, 500);
    pointer(svg, 'pointerup', 100, 500);
    editor.setHighlight({ current: 1, done: [0], activeEdges: [], cut: [0] });
    // (150, 380): its nearest vertex is 0 (94 px; 1 and 2 are 128 and 130 px away), so by
    // vertices alone it would be 0's. But the edge 1 — 2, from (250, 300) to (100, 500), is
    // only 32 px away, and that edge does not cross the cut: the point is on its side.
    expect(inTerritory({ x: 150, y: 380 })).toBe(false);
    expect(inTerritory({ x: 110, y: 310 })).toBe(true); // right next to 0

    // Every vertex on S's side: the territory is everything, with no border, and fades out.
    editor.setHighlight({ current: null, done: [0, 1, 2], activeEdges: [], cut: [0, 1, 2] });
    expect(svg.classList.contains('has-cut')).toBe(false);
    expect(border.getAttribute('d')).toBe('');
    expect(inTerritory({ x: 790, y: 590 })).toBe(true);
    editor.setHighlight(null);
    expect(region.hasAttribute('d')).toBe(false);
    vi.unstubAllGlobals();
  });

  it('edges between finished vertices outside the result (Prim) are marked to draw dashed green', () => {
    const edge = (a: number, b: number) => svg.querySelector<SVGGElement>(`[data-edge-a="${a}"][data-edge-b="${b}"]`)!;
    editor.setHighlight({
      current: null,
      done: [0, 1],
      activeEdges: [],
      exploredEdges: [{ from: 0, to: 1, within: true }],
    });
    expect(edge(0, 1).classList.contains('sim-within')).toBe(true);
    expect(edge(0, 1).classList.contains('sim-tree')).toBe(false);
    expect(edge(0, 1).classList.contains('sim-unexplored')).toBe(false);
    editor.setHighlight(null);
    expect(svg.querySelectorAll('.sim-within')).toHaveLength(0);
  });

  it('crossing edges (e.g. Prim’s cut) are marked so they draw solid grey', () => {
    const edge = (a: number, b: number) => svg.querySelector<SVGGElement>(`[data-edge-a="${a}"][data-edge-b="${b}"]`)!;
    editor.setHighlight({
      current: 1,
      done: [0],
      activeEdges: [],
      exploredEdges: [{ from: 0, to: 1, crossing: true }],
    });
    expect(edge(0, 1).classList.contains('sim-crossing')).toBe(true);
    expect(edge(0, 1).classList.contains('sim-unexplored')).toBe(false);
    expect(edge(1, 2).classList.contains('sim-unexplored')).toBe(true); // not crossing: dashed
    editor.setHighlight(null);
    expect(svg.querySelectorAll('.sim-crossing')).toHaveLength(0);
  });

  it('explored directed edges match the exact arc', () => {
    editor.setDirected(true);
    editor.setHighlight({ current: 0, done: [], activeEdges: [], exploredEdges: [{ from: 1, to: 0, label: 'x' }] });
    expect(svg.querySelectorAll('.sim-explored')).toHaveLength(0); // the arc is 0 → 1
    editor.setHighlight({ current: 0, done: [], activeEdges: [], exploredEdges: [{ from: 0, to: 1, label: 'x' }] });
    expect(svg.querySelector('[data-edge-a="0"][data-edge-b="1"]')!.classList.contains('sim-explored')).toBe(true);
  });

  it('shrinks long vertex labels (DFS "d,f") to fit inside the circle', () => {
    editor.setHighlight({ current: null, done: [], activeEdges: [], labels: { 0: '1,', 1: '10,13' } });
    const size = (id: number) => nodeEl(id).querySelector<SVGTextElement>('.sim-label')!.style.fontSize;
    expect(nodeEl(1).querySelector('.sim-label')!.textContent).toBe('10,13');
    expect(size(0)).toBe('');
    expect(parseFloat(size(1))).toBeLessThan(14);
  });

  it('compact highlights mark the canvas; peeks show ids or labels; clearing resets both', () => {
    editor.setHighlight({ current: null, done: [0], activeEdges: [], labels: { 0: '0', 1: '4' }, compact: true });
    expect(svg.classList.contains('sim-compact')).toBe(true);
    editor.setPeek('labels');
    expect([svg.classList.contains('peek-labels'), svg.classList.contains('peek-ids')]).toEqual([true, false]);
    editor.setPeek('ids'); // switching straight from one to the other
    expect([svg.classList.contains('peek-labels'), svg.classList.contains('peek-ids')]).toEqual([false, true]);
    editor.setPeek(null);
    expect([svg.classList.contains('peek-labels'), svg.classList.contains('peek-ids')]).toEqual([false, false]);
    editor.setPeek('labels');
    editor.setHighlight(null);
    expect(svg.classList.contains('sim-compact')).toBe(false);
    expect(svg.classList.contains('peek-labels')).toBe(false);
    editor.setHighlight({ current: 0, done: [], activeEdges: [] }); // BFS-like: not compact
    expect(svg.classList.contains('sim-compact')).toBe(false);
  });

  it('directed highlight matches the exact arc only', () => {
    editor.setDirected(true);
    editor.setHighlight({ current: 1, done: [], activeEdges: [[1, 0]] }); // no arc 1 → 0 exists
    expect(svg.querySelectorAll('.sim-active')).toHaveLength(0);
    editor.setHighlight({ current: 0, done: [], activeEdges: [[0, 1]] });
    expect(svg.querySelector('[data-edge-a="0"][data-edge-b="1"]')!.classList.contains('sim-active')).toBe(true);
  });
});

describe('GraphEditor arc diagram (topological sort)', () => {
  let frames: FrameRequestCallback[];
  let now: number;
  let onAutoLayoutChange: Mock<(enabled: boolean) => void>;

  beforeEach(() => {
    frames = [];
    now = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    onAutoLayoutChange = vi.fn();
    freshCanvas();
    editor = new GraphEditor(svg, graph, { onChange, onMessage, onAutoLayoutChange });
    // 0 → 1 → 2, 0 → 2, 3 → 2, drawn in a row in id order.
    addRow(4);
    editor.setDirected(true);
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [0, 2],
      [3, 2],
    ]) {
      clickNode(a);
      clickNode(b);
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** A new canvas and graph (the outer beforeEach's editor stays on the old canvas). */
  function freshCanvas(): void {
    document.body.innerHTML = '<svg id="canvas"></svg>';
    svg = document.querySelector<SVGSVGElement>('#canvas')!;
    svg.getBoundingClientRect = () =>
      ({ x: 0, y: 0, left: 0, top: 0, width: WIDTH, height: HEIGHT, right: WIDTH, bottom: HEIGHT }) as DOMRect;
    svg.setPointerCapture = () => {};
    graph = new Graph();
  }

  /** As DFS from 0 finds it: order by decreasing finish time 3, 0, 1, 2. */
  const DIAGRAM = {
    order: [3, 0, 1, 2],
    spine: [
      [0, 1],
      [1, 2],
    ] as Array<[number, number]>,
    below: [[3, 2]] as Array<[number, number]>,
  };

  /** Runs animation frames, 16 ms apart, until none are queued. */
  function flush(max = 500): number {
    let ran = 0;
    while (frames.length && ran < max) {
      now += 16;
      frames.shift()!(now);
      ran++;
    }
    return ran;
  }

  const xs = (ids: number[]) => ids.map((id) => graph.getNode(id)!.x);
  /** The y coordinates along an edge's drawn path (or line). */
  function pathYs(a: number, b: number): number[] {
    const line = edgeEl(a, b)!.querySelector('.edge-line')!;
    if (line.tagName === 'line') return [Number(line.getAttribute('y1')), Number(line.getAttribute('y2'))];
    return [...line.getAttribute('d')!.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[2]));
  }

  it('glides the vertices into the order, left to right on one centred row', () => {
    const start = xs([0, 1, 2, 3]);
    editor.showArcDiagram(DIAGRAM);
    expect(editor.arcDiagramActive).toBe(true);
    expect(svg.classList.contains('arc-diagram')).toBe(true);
    now += 100;
    frames.shift()!(now);
    const midway = xs([0, 1, 2, 3]);
    expect(midway).not.toEqual(start); // moving…
    flush();
    const end = xs(DIAGRAM.order);
    expect(midway).not.toEqual(xs([0, 1, 2, 3])); // …and it took more than one frame
    for (let i = 1; i < end.length; i++) expect(end[i]).toBeGreaterThan(end[i - 1]);
    expect((end[0] + end[3]) / 2).toBeCloseTo(WIDTH / 2); // centred
    expect(new Set(DIAGRAM.order.map((id) => graph.getNode(id)!.y)).size).toBe(1); // one row
  });

  it('turns auto-layout off (and says so through the callback)', () => {
    editor.setAutoLayout(true);
    editor.showArcDiagram(DIAGRAM);
    expect(editor.autoLayoutEnabled).toBe(false);
    expect(onAutoLayoutChange.mock.calls).toEqual([[true], [false]]);
  });

  it('spine edges between neighbours lie straight and white; the rest are half circles, cross edges below', () => {
    editor.showArcDiagram(DIAGRAM);
    flush();
    const rowY = graph.getNode(0)!.y;
    // 0 → 1 and 1 → 2 join neighbours in the order: straight, on the centre line, highlighted.
    for (const [a, b] of DIAGRAM.spine) {
      expect(edgeEl(a, b)!.dataset.shape).toBe('line');
      expect(edgeEl(a, b)!.classList.contains('sim-spine')).toBe(true);
      expect(pathYs(a, b)).toEqual([rowY, rowY]);
    }
    // 0 → 2 (forward) arcs above the line, 3 → 2 (cross) below.
    expect(edgeEl(0, 2)!.dataset.shape).toBe('path');
    expect(edgeEl(0, 2)!.classList.contains('sim-spine')).toBe(false);
    expect(Math.max(...pathYs(0, 2))).toBeLessThanOrEqual(rowY + 0.01);
    expect(Math.min(...pathYs(0, 2))).toBeLessThan(rowY - 50);
    expect(Math.min(...pathYs(3, 2))).toBeGreaterThanOrEqual(rowY - 0.01);
    expect(Math.max(...pathYs(3, 2))).toBeGreaterThan(rowY + 50);
  });

  it('a spine edge that skips over a vertex arcs (still highlighted) instead of running behind it', () => {
    editor.showArcDiagram({ ...DIAGRAM, spine: [...DIAGRAM.spine, [0, 2]] });
    flush();
    expect(edgeEl(0, 2)!.dataset.shape).toBe('path');
    expect(edgeEl(0, 2)!.classList.contains('sim-spine')).toBe(true);
    expect(Math.min(...pathYs(0, 2))).toBeLessThan(graph.getNode(0)!.y - 50);
  });

  it('turning auto-layout back on leaves the diagram: edges straighten out', () => {
    editor.showArcDiagram(DIAGRAM);
    flush();
    editor.setAutoLayout(true);
    expect(editor.arcDiagramActive).toBe(false);
    expect(svg.classList.contains('arc-diagram')).toBe(false);
    expect(svg.querySelectorAll('.sim-spine')).toHaveLength(0);
    flush(2000);
    expect([...svg.querySelectorAll<SVGGElement>('.edge')].every((g) => g.dataset.shape === 'line')).toBe(true);
    // …and it can be shown again.
    editor.setAutoLayout(false);
    editor.showArcDiagram(DIAGRAM);
    flush();
    expect(editor.arcDiagramActive).toBe(true);
    expect(edgeEl(3, 2)!.dataset.shape).toBe('path');
  });

  it('null leaves it with the vertices where they are', () => {
    editor.showArcDiagram(DIAGRAM);
    flush();
    const placed = xs([0, 1, 2, 3]);
    editor.showArcDiagram(null);
    flush();
    expect(xs([0, 1, 2, 3])).toEqual(placed);
    expect(editor.arcDiagramActive).toBe(false);
    expect([...svg.querySelectorAll<SVGGElement>('.edge')].every((g) => g.dataset.shape === 'line')).toBe(true);
  });

  it('keeps clear of the overlays the page reports', () => {
    freshCanvas();
    for (let i = 0; i < 4; i++) graph.addNode(100 + i * 150, 300);
    const insetEditor = new GraphEditor(svg, graph, { canvasInsets: () => ({ top: 400, bottom: 100 }) });
    insetEditor.showArcDiagram(DIAGRAM);
    flush();
    expect(graph.getNode(0)!.y).toBeCloseTo(400 + (HEIGHT - 400 - 100) / 2);
  });

  it('with reduced motion, jumps straight into place', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    editor.showArcDiagram(DIAGRAM);
    expect(frames).toHaveLength(0);
    const end = xs(DIAGRAM.order);
    for (let i = 1; i < end.length; i++) expect(end[i]).toBeGreaterThan(end[i - 1]);
    expect(edgeEl(3, 2)!.dataset.shape).toBe('path');
    expect(Math.max(...pathYs(3, 2))).toBeGreaterThan(graph.getNode(3)!.y + 50);
  });

  describe('forest view', () => {
    /** DFS from 0: 0 (1,6) → 1 (2,5) → 2 (3,4), then 3 (7,8) on its own; 0 → 2 forward, 3 → 2 cross. */
    const FOREST = {
      places: [
        { id: 0, column: 3.5, row: 0 },
        { id: 1, column: 3.5, row: 1 },
        { id: 2, column: 3.5, row: 2 },
        { id: 3, column: 7.5, row: 0 },
      ],
      spine: [
        [0, 1],
        [1, 2],
      ] as Array<[number, number]>,
    };
    const ys = (ids: number[]) => ids.map((id) => graph.getNode(id)!.y);
    /** The x coordinates along an edge's drawn path. */
    const pathXs = (a: number, b: number) =>
      [...edgeEl(a, b)!.querySelector('.edge-line')!.getAttribute('d')!.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) =>
        Number(m[1]),
      );

    it('glides the vertices into trees: rows by depth, columns by time, centred', () => {
      editor.showForest(FOREST);
      expect(editor.arrangement).toBe('forest');
      expect(editor.arcDiagramActive).toBe(true);
      expect(svg.classList.contains('forest-view')).toBe(true);
      expect(onAutoLayoutChange).not.toHaveBeenCalledWith(true);
      flush();
      const [x0, x1, x2, x3] = xs([0, 1, 2, 3]);
      expect(x1).toBeCloseTo(x0);
      expect(x2).toBeCloseTo(x0);
      expect(x3 - x0).toBeCloseTo(4 * 72); // 4 time units at the widest unit
      expect((x0 + x3) / 2).toBeCloseTo(WIDTH / 2);
      const [y0, y1, y2, y3] = ys([0, 1, 2, 3]);
      expect(y3).toBeCloseTo(y0);
      expect(y1 - y0).toBeCloseTo(y2 - y1);
      expect(y1).toBeGreaterThan(y0);
    });

    it('tree edges are straight and white; other edges bow out to the left of their direction', () => {
      editor.showForest(FOREST);
      flush();
      expect(edgeEl(0, 1)!.classList.contains('sim-spine')).toBe(true);
      expect(edgeEl(0, 2)!.classList.contains('sim-spine')).toBe(false);
      const x0 = graph.getNode(0)!.x;
      // 0 → 1 runs straight down (as a path, so it can blend between views).
      expect(edgeEl(0, 1)!.dataset.shape).toBe('path');
      expect(pathXs(0, 1).every((x) => Math.abs(x - x0) < 0.01)).toBe(true);
      // 0 → 2 runs down the chain past 1: it bows to the left of downward, i.e. to the right.
      expect(Math.max(...pathXs(0, 2))).toBeGreaterThan(x0 + 30);
      expect(Math.min(...pathXs(0, 2))).toBeGreaterThan(x0 - 0.01);
    });

    it('switches from the topological sort straight over, blending each edge into its new shape', () => {
      editor.showArcDiagram(DIAGRAM);
      flush();
      // In the line, 0 → 2 skips 1 and arcs above it.
      const above = Math.min(...pathYs(0, 2));
      expect(above).toBeLessThan(graph.getNode(0)!.y - 50);
      editor.showForest(FOREST);
      expect(editor.arrangement).toBe('forest');
      expect(svg.classList.contains('arc-diagram')).toBe(true);
      // Part-way, 0 → 2 is still curved: it never snaps straight (the bend stays at 1).
      now += 200;
      frames.shift()!(now);
      const yMid = pathYs(0, 2);
      const xMid = pathXs(0, 2);
      const sag = Math.max(...xMid) - Math.min(...xMid) + Math.max(...yMid) - Math.min(...yMid);
      expect(sag).toBeGreaterThan(40);
      flush();
      const x0 = graph.getNode(0)!.x;
      expect(Math.max(...pathXs(0, 2))).toBeGreaterThan(x0 + 30);
      // And back to the line.
      editor.showArcDiagram(DIAGRAM);
      expect(editor.arrangement).toBe('line');
      expect(svg.classList.contains('forest-view')).toBe(false);
      flush();
      expect(Math.min(...pathYs(0, 2))).toBeCloseTo(above, 0);
    });

    it('leaves like the line: edges straighten, vertices stay where they are', () => {
      editor.showForest(FOREST);
      flush();
      const placed = xs([0, 1, 2, 3]);
      editor.showArcDiagram(null);
      expect(editor.arrangement).toBe(null);
      expect(svg.classList.contains('forest-view')).toBe(false);
      flush();
      expect(xs([0, 1, 2, 3])).toEqual(placed);
      expect(editor.arcDiagramActive).toBe(false);
      expect(svg.querySelectorAll('.sim-spine')).toHaveLength(0);
    });

    it('auto-layout leaves it too', () => {
      editor.showForest(FOREST);
      flush();
      editor.setAutoLayout(true);
      expect(editor.arrangement).toBe(null);
    });

    it("as BFS's tree: vertices aside wait on the right, tree edges are not white, and the tree grows", () => {
      // 0 — 1 so far; 2 and 3 not reached yet.
      editor.showForest(
        { places: [{ id: 0, column: 0, row: 0 }, { id: 1, column: 0, row: 1 }], spine: [[0, 1]], aside: [2, 3], highlightSpine: false },
        'tree',
      );
      expect(editor.arrangement).toBe('tree');
      flush();
      const [x0, x1, x2, x3] = xs([0, 1, 2, 3]);
      expect(x2).toBeCloseTo(x3); // one column…
      expect(x2).toBeGreaterThan(x0 + 200); // …to the right of the tree
      expect(x1).toBeCloseTo(x0);
      expect(svg.querySelectorAll('.sim-spine')).toHaveLength(0);
      // 1 → 2 leaves the tree for the group: it only sags a little, below the line.
      const y1 = graph.getNode(1)!.y;
      const sag = Math.max(...pathYs(1, 2)) - Math.max(y1, graph.getNode(2)!.y);
      expect(sag).toBeGreaterThan(5);
      // 2 joins: it glides from the group into the tree.
      const was = { ...graph.getNode(2)! };
      editor.showForest(
        {
          places: [{ id: 0, column: 1, row: 0 }, { id: 1, column: 0, row: 1 }, { id: 2, column: 2, row: 1 }],
          spine: [[0, 1], [0, 2]],
          aside: [3],
          highlightSpine: false,
        },
        'tree',
      );
      now += 200;
      frames.shift()!(now);
      const mid = graph.getNode(2)!;
      expect(mid.x).toBeLessThan(was.x);
      expect(mid.x).toBeGreaterThan(graph.getNode(0)!.x - 1000); // still on its way
      flush();
      expect(graph.getNode(2)!.y).toBeCloseTo(graph.getNode(1)!.y); // on row 1 now
      expect(graph.getNode(2)!.x).toBeLessThan(graph.getNode(3)!.x);
    });
  });
});

describe('GraphEditor cut transitions', () => {
  let frames: FrameRequestCallback[];
  let now: number;

  beforeEach(() => {
    frames = [];
    now = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    // 0, 1, 2 in a row at x = 100, 250, 400 (y = 300), joined 0 — 1 — 2.
    addRow(3);
    clickNode(0);
    clickNode(1);
    clickNode(1);
    clickNode(2);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const border = () => svg.querySelector('.cut-border')!.getAttribute('d') ?? '';
  /** The border's x position (a vertical line in this fixture). */
  const borderX = () => {
    const xs = [...border().matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[1]));
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
  };
  /** Runs one animation frame, `ms` later. */
  const frame = (ms: number) => {
    now += ms;
    const queued = frames;
    frames = [];
    for (const cb of queued) cb(now);
  };

  it('moves the border continuously to its new place instead of jumping', () => {
    editor.setHighlight({ current: null, done: [0], activeEdges: [], cut: [0] });
    for (let i = 0; i < 60 && frames.length; i++) frame(16); // settle the first cut
    expect(borderX()).toBeCloseTo(175, 0);

    editor.setHighlight({ current: null, done: [0, 1], activeEdges: [], cut: [0, 1] });
    expect(svg.classList.contains('cut-moving')).toBe(true);
    expect(borderX()).toBeCloseTo(175, 0); // starts where it was
    const xs: number[] = [];
    while (frames.length) {
      frame(16);
      xs.push(borderX());
    }
    expect(borderX()).toBeCloseTo(325, 0); // ends at the new bisector
    expect(svg.classList.contains('cut-moving')).toBe(false);
    // On the way it passed through many places in between, never going backwards, in
    // steps much smaller than the whole move.
    const between = xs.filter((x) => x > 180 && x < 320);
    expect(between.length).toBeGreaterThan(10);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1] - 0.5);
      expect(xs[i] - xs[i - 1]).toBeLessThan(40);
    }
  });

  it('a first cut grows from its vertex', () => {
    editor.setHighlight({ current: null, done: [0], activeEdges: [], cut: [0] });
    expect(svg.querySelector('.cut-region')!.getAttribute('d')).toBe(''); // nothing yet
    frame(200);
    const early = borderX();
    while (frames.length) frame(16);
    expect(early).toBeLessThan(170); // part-way out from 0 (at x = 100) towards x = 175
    expect(borderX()).toBeCloseTo(175, 0);
  });

  it('with reduced motion, the border jumps straight to its new place', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    editor.setHighlight({ current: null, done: [0], activeEdges: [], cut: [0] });
    editor.setHighlight({ current: null, done: [0, 1], activeEdges: [], cut: [0, 1] });
    expect(frames).toHaveLength(0);
    expect(svg.classList.contains('cut-moving')).toBe(false);
    expect(borderX()).toBeCloseTo(325, 0);
  });
});
