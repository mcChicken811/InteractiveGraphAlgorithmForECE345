import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { Graph } from '../src/graph.js';
import { GraphEditor, NODE_RADIUS, type EditorCallbacks } from '../src/editor.js';

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
