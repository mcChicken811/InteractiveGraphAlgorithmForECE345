import { expect, test, type Locator, type Page } from '@playwright/test';

/** Mouse helpers that work in canvas-local coordinates. */
class CanvasDriver {
  readonly canvas: Locator;

  constructor(private readonly page: Page) {
    this.canvas = page.locator('#canvas');
  }

  private async origin(): Promise<{ x: number; y: number }> {
    const box = await this.canvas.boundingBox();
    if (!box) throw new Error('canvas not visible');
    return { x: box.x, y: box.y };
  }

  async click(x: number, y: number, button: 'left' | 'right' = 'left'): Promise<void> {
    const o = await this.origin();
    await this.page.mouse.click(o.x + x, o.y + y, { button });
  }

  async move(x: number, y: number): Promise<void> {
    const o = await this.origin();
    await this.page.mouse.move(o.x + x, o.y + y);
  }

  async drag(from: [number, number], to: [number, number]): Promise<void> {
    const o = await this.origin();
    await this.page.mouse.move(o.x + from[0], o.y + from[1]);
    await this.page.mouse.down();
    await this.page.mouse.move(o.x + to[0], o.y + to[1], { steps: 8 });
    await this.page.mouse.up();
  }

  node(id: number): Locator {
    return this.canvas.locator(`[data-node-id="${id}"]`);
  }

  edge(a: number, b: number): Locator {
    return this.canvas.locator(`[data-edge-a="${a}"][data-edge-b="${b}"]`);
  }

  get nodes(): Locator {
    return this.canvas.locator('.node');
  }

  get edges(): Locator {
    return this.canvas.locator('.edge');
  }
}

/** Canvas-local positions used across tests (well apart from each other and the edges). */
const P = {
  a: [150, 150],
  b: [450, 150],
  c: [300, 400],
  d: [600, 400],
} as const satisfies Record<string, [number, number]>;

const mid = (p: readonly [number, number], q: readonly [number, number]): [number, number] => [
  (p[0] + q[0]) / 2,
  (p[1] + q[1]) / 2,
];

let cv: CanvasDriver;

test.beforeEach(async ({ page }) => {
  // Relative to baseURL (…/BFS/), i.e. the same URL Live Server opens.
  await page.goto('index.html');
  cv = new CanvasDriver(page);
});

test('loads every resource from a plain static server without errors', async ({ page }) => {
  // Regression: index.html once referenced "/src/main.ts", which only Vite's dev server
  // could serve, so under Live Server the script 404'd and clicks did nothing.
  const failures: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
  });
  page.on('requestfailed', (r) => failures.push(`failed ${r.url()}`));
  page.on('console', (m) => {
    if (m.type() === 'error') failures.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (err) => failures.push(`pageerror: ${err.message}`));

  await page.goto('index.html');
  await expect(page.locator('#message')).not.toContainText("didn't load");
  await cv.click(...P.a);
  await expect(cv.nodes).toHaveCount(1);
  expect(failures).toEqual([]);
});

/** Builds nodes 0, 1, 2 at P.a, P.b, P.c. */
async function addTriangleNodes(): Promise<void> {
  await cv.click(...P.a);
  await cv.click(...P.b);
  await cv.click(...P.c);
}

async function connect(a: readonly [number, number], b: readonly [number, number]): Promise<void> {
  await cv.click(...a);
  await cv.click(...b);
}

test('shows an empty editor on load', async ({ page }) => {
  await expect(page).toHaveTitle('BFS Graph Builder');
  await expect(page.locator('#stats')).toHaveText('0 nodes · 0 edges');
  await expect(page.locator('#message')).toHaveText('Click empty space to add a node.');
  await expect(page.locator('#adjacency')).toHaveText('No nodes yet.');
  await expect(page.getByRole('button', { name: 'Clear graph' })).toBeDisabled();
  await expect(cv.nodes).toHaveCount(0);
});

test('clicking empty space spawns numbered nodes', async ({ page }) => {
  await addTriangleNodes();

  await expect(cv.nodes).toHaveCount(3);
  await expect(cv.node(0)).toHaveText('0');
  await expect(cv.node(2)).toHaveText('2');
  await expect(cv.node(1)).toHaveAttribute('transform', `translate(${P.b[0]} ${P.b[1]})`);
  await expect(page.locator('#stats')).toHaveText('3 nodes · 0 edges');
  await expect(page.locator('#message')).toHaveText('Added node 2.');
  await expect(page.locator('#adjacency')).toHaveText('0: —\n1: —\n2: —');
  await expect(page.getByRole('button', { name: 'Clear graph' })).toBeEnabled();
});

test('clicking too close to a node does not create an overlapping node', async ({ page }) => {
  await cv.click(...P.a);
  await cv.click(P.a[0] + 30, P.a[1]);

  await expect(cv.nodes).toHaveCount(1);
  await expect(page.locator('#message')).toContainText('Too close to node 0');
  await expect(page.locator('#message')).toHaveAttribute('data-tone', 'warn');
});

test('clicking one node then another creates an edge', async ({ page }) => {
  await addTriangleNodes();

  await cv.click(...P.a);
  await expect(cv.node(0)).toHaveClass(/selected/);
  await expect(page.locator('#message')).toContainText('Node 0 selected');

  // The dashed preview line follows the cursor while picking a target.
  await cv.move(380, 300);
  const preview = cv.canvas.locator('.preview-line');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('x2', '380');

  await cv.click(...P.b);
  await expect(cv.edge(0, 1)).toHaveCount(1);
  await expect(cv.node(0)).not.toHaveClass(/selected/);
  await expect(preview).toBeHidden();
  await expect(page.locator('#stats')).toHaveText('3 nodes · 1 edge');
  await expect(page.locator('#adjacency')).toHaveText('0: 1\n1: 0\n2: —');
});

test('builds a triangle and reports the adjacency list', async ({ page }) => {
  await addTriangleNodes();
  await connect(P.a, P.b);
  await connect(P.b, P.c);
  await connect(P.c, P.a);

  await expect(cv.edges).toHaveCount(3);
  await expect(page.locator('#stats')).toHaveText('3 nodes · 3 edges');
  await expect(page.locator('#adjacency')).toHaveText('0: 1, 2\n1: 0, 2\n2: 0, 1');
});

test('connecting an already connected pair is rejected', async ({ page }) => {
  await addTriangleNodes();
  await connect(P.a, P.b);
  await connect(P.b, P.a);

  await expect(cv.edges).toHaveCount(1);
  await expect(page.locator('#message')).toHaveText('Nodes 1 and 0 are already connected.');
});

test('clicking a node twice or clicking empty space cancels the selection', async ({ page }) => {
  await addTriangleNodes();

  await cv.click(...P.a);
  await cv.click(...P.a);
  await expect(cv.canvas.locator('.selected')).toHaveCount(0);

  await cv.click(...P.a);
  await cv.click(...P.d); // empty space: cancels instead of adding a node
  await expect(cv.canvas.locator('.selected')).toHaveCount(0);
  await expect(cv.nodes).toHaveCount(3);
  await expect(page.locator('#message')).toHaveText('Selection cleared.');
});

test('Escape cancels the selection', async ({ page }) => {
  await addTriangleNodes();
  await cv.click(...P.a);
  await page.keyboard.press('Escape');
  await expect(cv.canvas.locator('.selected')).toHaveCount(0);
});

test('clicking an edge deletes it', async ({ page }) => {
  await addTriangleNodes();
  await connect(P.a, P.b);
  await connect(P.b, P.c);

  await cv.move(...mid(P.a, P.b));
  await expect(cv.edge(0, 1).locator('.edge-line')).toHaveCSS('stroke-dasharray', '6px, 5px');

  await cv.click(...mid(P.a, P.b));
  await expect(cv.edge(0, 1)).toHaveCount(0);
  await expect(cv.edge(1, 2)).toHaveCount(1);
  await expect(page.locator('#stats')).toHaveText('3 nodes · 1 edge');
  await expect(page.locator('#message')).toHaveText('Removed edge 0 — 1.');
  await expect(cv.nodes).toHaveCount(3); // the click did not spawn a node
});

test('a click slightly off the edge line still hits it', async () => {
  await addTriangleNodes();
  await connect(P.a, P.b);

  const [mx, my] = mid(P.a, P.b);
  await cv.click(mx, my + 5);
  await expect(cv.edges).toHaveCount(0);
});

test('dragging a node moves it and its edges', async ({ page }) => {
  await addTriangleNodes();
  await connect(P.a, P.b);

  await cv.drag(P.a, P.d);

  await expect(cv.node(0)).toHaveAttribute('transform', `translate(${P.d[0]} ${P.d[1]})`);
  const line = cv.edge(0, 1).locator('.edge-line');
  await expect(line).toHaveAttribute('x1', String(P.d[0]));
  await expect(line).toHaveAttribute('y1', String(P.d[1]));
  // A drag is not a click: nothing selected, no extra node.
  await expect(cv.canvas.locator('.selected')).toHaveCount(0);
  await expect(page.locator('#stats')).toHaveText('3 nodes · 1 edge');
});

test('right-clicking a node deletes it with its edges', async ({ page }) => {
  await addTriangleNodes();
  await connect(P.a, P.b);
  await connect(P.b, P.c);
  await connect(P.a, P.c);

  await cv.click(...P.b, 'right');

  await expect(cv.node(1)).toHaveCount(0);
  await expect(cv.edges).toHaveCount(1);
  await expect(page.locator('#stats')).toHaveText('2 nodes · 1 edge');
  await expect(page.locator('#adjacency')).toHaveText('0: 2\n2: 0');
});

test('Delete key removes the selected node and its id is reused', async ({ page }) => {
  await addTriangleNodes();
  await connect(P.a, P.b);

  await cv.click(...P.a);
  await page.keyboard.press('Delete');
  await expect(cv.node(0)).toHaveCount(0);
  await expect(cv.edges).toHaveCount(0);

  await cv.click(...P.d);
  await expect(cv.node(0)).toHaveAttribute('transform', `translate(${P.d[0]} ${P.d[1]})`);
});

test('Clear graph removes everything', async ({ page }) => {
  await addTriangleNodes();
  await connect(P.a, P.b);

  await page.getByRole('button', { name: 'Clear graph' }).click();

  await expect(cv.nodes).toHaveCount(0);
  await expect(cv.edges).toHaveCount(0);
  await expect(page.locator('#stats')).toHaveText('0 nodes · 0 edges');
  await expect(page.locator('#adjacency')).toHaveText('No nodes yet.');
  await expect(page.getByRole('button', { name: 'Clear graph' })).toBeDisabled();
});

test.describe('help & adjacency panel (hamburger menu)', () => {
  const menu = (page: Page) => page.getByRole('button', { name: 'Help and adjacency list' });
  const panel = (page: Page) => page.getByRole('complementary', { name: 'Help and adjacency list' });

  test('is closed by default, and the canvas uses the full width', async ({ page }) => {
    await expect(menu(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(panel(page)).toBeHidden();
    const canvas = (await cv.canvas.boundingBox())!;
    expect(canvas.width).toBe(page.viewportSize()!.width);
  });

  test('the hamburger sits in the canvas’s top-right corner', async ({ page }) => {
    const b = (await menu(page).boundingBox())!;
    const c = (await cv.canvas.boundingBox())!;
    expect(c.x + c.width - (b.x + b.width)).toBeGreaterThanOrEqual(0);
    expect(c.x + c.width - (b.x + b.width)).toBeLessThan(24);
    expect(b.y - c.y).toBeGreaterThanOrEqual(0);
    expect(b.y - c.y).toBeLessThan(24);
  });

  test('opens a panel floating over the canvas, and closes it again', async ({ page }) => {
    await menu(page).click();
    await expect(menu(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByRole('heading', { name: 'How to use' })).toBeVisible();
    await expect(panel(page).getByRole('tab', { name: 'Adjacency list' })).toBeVisible();
    await expect(panel(page).getByRole('tab', { name: 'Adjacency matrix' })).toBeVisible();

    // It hovers on top of the canvas rather than taking space beside it.
    const p = (await panel(page).boundingBox())!;
    const c = (await cv.canvas.boundingBox())!;
    expect(p.x).toBeGreaterThan(c.x);
    expect(p.x + p.width).toBeLessThanOrEqual(c.x + c.width);
    expect(p.y).toBeGreaterThan(c.y);
    expect(p.y + p.height).toBeLessThanOrEqual(c.y + c.height);
    expect(c.width).toBe(page.viewportSize()!.width);

    await menu(page).click();
    await expect(menu(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(panel(page)).toBeHidden();
  });

  test('Esc closes the panel', async ({ page }) => {
    await menu(page).click();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
    await expect(menu(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('works from the keyboard', async ({ page }) => {
    await menu(page).focus();
    await page.keyboard.press('Enter');
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press('Space');
    await expect(panel(page)).toBeHidden();
  });

  test('stays open while editing, with a live adjacency list', async ({ page }) => {
    await menu(page).click();
    await addTriangleNodes();
    await connect(P.a, P.b);
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).locator('#adjacency')).toHaveText('0: 1\n1: 0\n2: —');
  });

  test('clicks inside the panel do not touch the graph', async ({ page }) => {
    await menu(page).click();
    await panel(page).getByRole('heading', { name: 'How to use' }).click();
    await panel(page).getByRole('tab', { name: 'Adjacency matrix' }).click();
    await panel(page).getByRole('tab', { name: 'Adjacency list' }).click();
    await expect(cv.nodes).toHaveCount(0);
  });
});

test.describe('adjacency list / matrix switch', () => {
  const listTab = (page: Page) => page.getByRole('tab', { name: 'Adjacency list' });
  const matrixTab = (page: Page) => page.getByRole('tab', { name: 'Adjacency matrix' });
  const matrix = (page: Page) => page.getByRole('table', { name: 'Adjacency matrix' });

  /** The matrix as text rows: header row first, e.g. [['', '0', '1'], ['0', '0', '1'], …]. */
  async function matrixText(page: Page): Promise<string[][]> {
    return matrix(page)
      .locator('tr')
      .evaluateAll((rows) => rows.map((r) => [...r.children].map((c) => c.textContent ?? '')));
  }

  test.beforeEach(async ({ page }) => {
    await page.getByRole('button', { name: 'Help and adjacency list' }).click();
  });

  test('shows the adjacency list first, with the matrix on the right', async ({ page }) => {
    await expect(page.getByRole('tablist', { name: 'Graph representation' })).toBeVisible();
    await expect(listTab(page)).toHaveAttribute('aria-selected', 'true');
    await expect(matrixTab(page)).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('#adjacency')).toBeVisible();
    await expect(page.locator('#rep-matrix')).toBeHidden();

    const l = (await listTab(page).boundingBox())!;
    const m = (await matrixTab(page).boundingBox())!;
    expect(l.x + l.width).toBeLessThanOrEqual(m.x); // left / right
    expect(Math.abs(l.y - m.y)).toBeLessThan(1);
  });

  test('switches to the adjacency matrix and back', async ({ page }) => {
    await matrixTab(page).click();
    await expect(matrixTab(page)).toHaveAttribute('aria-selected', 'true');
    await expect(listTab(page)).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('#rep-matrix')).toBeVisible();
    await expect(page.locator('#adjacency')).toBeHidden();
    await expect(page.locator('#rep-matrix')).toContainText('No nodes yet.');

    await listTab(page).click();
    await expect(page.locator('#adjacency')).toBeVisible();
    await expect(page.locator('#rep-matrix')).toBeHidden();
  });

  test('arrow keys move between the two views', async ({ page }) => {
    await listTab(page).focus();
    await page.keyboard.press('ArrowRight');
    await expect(matrixTab(page)).toBeFocused();
    await expect(matrixTab(page)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(listTab(page)).toBeFocused();
    await expect(listTab(page)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(matrixTab(page)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(listTab(page)).toHaveAttribute('aria-selected', 'true');
  });

  test('the matrix is a symmetric 0/1 table of the graph, updated live', async ({ page }) => {
    await matrixTab(page).click();
    await addTriangleNodes();
    await connect(P.a, P.b);
    await connect(P.b, P.c);

    expect(await matrixText(page)).toEqual([
      ['', '0', '1', '2'],
      ['0', '0', '1', '0'],
      ['1', '1', '0', '1'],
      ['2', '0', '1', '0'],
    ]);
    // Edge cells are highlighted, and the diagonal is marked.
    await expect(matrix(page).locator('td.on')).toHaveCount(4);
    await expect(matrix(page).locator('td.diag')).toHaveCount(3);

    // Deleting an edge clears both symmetric cells.
    await cv.click(...mid(P.a, P.b));
    await expect(matrix(page).locator('td.on')).toHaveCount(2);
    expect((await matrixText(page))[1]).toEqual(['0', '0', '0', '0']);
  });

  test('both views describe the same graph, labelled by node id', async ({ page }) => {
    await addTriangleNodes();
    await connect(P.a, P.c);
    await cv.click(...P.b, 'right'); // remove node 1: ids are now 0 and 2
    await expect(page.locator('#adjacency')).toHaveText('0: 2\n2: 0');

    await matrixTab(page).click();
    expect(await matrixText(page)).toEqual([
      ['', '0', '2'],
      ['0', '0', '1'],
      ['2', '1', '0'],
    ]);
  });

  test('a large matrix scrolls inside the panel instead of widening the page', async ({ page }) => {
    await matrixTab(page).click();
    for (let i = 0; i < 16; i++) await cv.click(80 + (i % 8) * 70, 160 + Math.floor(i / 8) * 90);
    await expect(matrix(page).locator('thead th')).toHaveCount(16);

    const scroller = page.locator('#adjacency-matrix');
    const overflow = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeGreaterThan(0);
    const p = (await page.locator('#info-panel').boundingBox())!;
    const c = (await cv.canvas.boundingBox())!;
    expect(p.x + p.width).toBeLessThanOrEqual(c.x + c.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });
});

test.describe('on a phone-sized screen', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('lays out without horizontal scrolling and supports taps', async ({ page }) => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);

    const box = (await cv.canvas.boundingBox())!;
    await page.touchscreen.tap(box.x + 80, box.y + 80);
    await page.touchscreen.tap(box.x + 280, box.y + 200);
    await expect(cv.nodes).toHaveCount(2);

    await page.touchscreen.tap(box.x + 80, box.y + 80);
    await page.touchscreen.tap(box.x + 280, box.y + 200);
    await expect(cv.edges).toHaveCount(1);
    // The panel opens within the screen, still floating over the canvas.
    await page.getByRole('button', { name: 'Help and adjacency list' }).tap();
    const panelBox = (await page.getByRole('complementary', { name: 'Help and adjacency list' }).boundingBox())!;
    expect(panelBox.x).toBeGreaterThanOrEqual(0);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });
});

test.describe('auto-layout', () => {
  type Positions = Record<string, { x: number; y: number }>;

  /** Reads every node's position from its SVG transform. */
  async function positions(page: Page): Promise<Positions> {
    return page.locator('#canvas [data-node-id]').evaluateAll((els) =>
      Object.fromEntries(
        els.map((el) => {
          const [x, y] = (el.getAttribute('transform') ?? '').match(/-?[\d.]+/g)!.map(Number);
          return [el.getAttribute('data-node-id')!, { x, y }];
        }),
      ),
    );
  }

  function minPairDistance(pos: Positions): number {
    const pts = Object.values(pos);
    let min = Infinity;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        min = Math.min(min, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
      }
    }
    return min;
  }

  /** Waits until no node moves between two samples taken 300 ms apart. */
  async function waitUntilSettled(page: Page): Promise<Positions> {
    let last = await positions(page);
    await expect
      .poll(
        async () => {
          await page.waitForTimeout(300);
          const now = await positions(page);
          const same = JSON.stringify(now) === JSON.stringify(last);
          last = now;
          return same;
        },
        { timeout: 15_000, intervals: [0] },
      )
      .toBe(true);
    return last;
  }

  /** Four nodes in a cramped 2×2 cluster, connected as a path 0-1-2-3. */
  const CRAMPED: Array<[number, number]> = [
    [380, 280],
    [440, 280],
    [440, 340],
    [380, 340],
  ];

  async function addCrampedPath(): Promise<void> {
    for (const p of CRAMPED) await cv.click(...p);
    await connect(CRAMPED[0], CRAMPED[1]);
    await connect(CRAMPED[1], CRAMPED[2]);
    await connect(CRAMPED[2], CRAMPED[3]);
  }

  const toggle = (page: Page) => page.getByRole('button', { name: 'Auto-layout' });

  test('toggle sits in the top-left corner of the canvas and starts off', async ({ page }) => {
    const btn = toggle(page);
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await expect(btn).toContainText('Off');

    const b = (await btn.boundingBox())!;
    const c = (await cv.canvas.boundingBox())!;
    expect(b.x - c.x).toBeGreaterThanOrEqual(0);
    expect(b.x - c.x).toBeLessThan(24);
    expect(b.y - c.y).toBeGreaterThanOrEqual(0);
    expect(b.y - c.y).toBeLessThan(24);
  });

  test('clicking the toggle opens and closes auto-layout without adding nodes', async ({ page }) => {
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle(page)).toContainText('On');
    await expect(page.locator('#message')).toContainText('Auto-layout on');

    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle(page)).toContainText('Off');
    await expect(page.locator('#message')).toContainText('Auto-layout off');
    await expect(cv.nodes).toHaveCount(0);
  });

  test('the toggle is keyboard accessible', async ({ page }) => {
    await toggle(page).focus();
    await page.keyboard.press('Enter');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Space');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  });

  test('animates a cramped graph into a spaced-out layout', async ({ page }) => {
    await addCrampedPath();
    const before = await positions(page);
    expect(minPairDistance(before)).toBeLessThan(70);

    await toggle(page).click();
    // It animates: shortly after, nodes have started moving but are not done yet.
    await expect.poll(async () => JSON.stringify(await positions(page))).not.toBe(JSON.stringify(before));

    const settled = await waitUntilSettled(page);
    expect(minPairDistance(settled)).toBeGreaterThan(100);
    // Edges and the adjacency list are unchanged; only positions moved.
    await expect(cv.edges).toHaveCount(3);
    await expect(page.locator('#adjacency')).toHaveText('0: 1\n1: 0, 2\n2: 1, 3\n3: 2');
    // Edge lines follow their nodes.
    await expect(cv.edge(0, 1).locator('.edge-line')).toHaveAttribute('x1', String(settled['0'].x));
  });

  test('turning it off freezes the nodes where they are', async ({ page }) => {
    await addCrampedPath();
    await toggle(page).click();
    await page.waitForTimeout(400); // mid-animation
    await toggle(page).click();

    const frozen = await positions(page);
    await page.waitForTimeout(600);
    expect(await positions(page)).toEqual(frozen);

    // New nodes are placed exactly where clicked again.
    await cv.click(...P.d);
    await expect(cv.node(4)).toHaveAttribute('transform', `translate(${P.d[0]} ${P.d[1]})`);
  });

  test('separates disconnected parts and settles without drifting', async ({ page }) => {
    // A triangle, a separate edge and two isolated nodes, all crammed together.
    const pts: Array<[number, number]> = [
      [300, 300],
      [360, 300],
      [330, 350],
      [420, 300],
      [480, 300],
      [420, 360],
      [480, 360],
    ];
    for (const p of pts) await cv.click(...p);
    await connect(pts[0], pts[1]);
    await connect(pts[1], pts[2]);
    await connect(pts[2], pts[0]);
    await connect(pts[3], pts[4]);

    await toggle(page).click();
    const settled = await waitUntilSettled(page);

    // Each component's box (node circles included) is clear of every other's.
    const groups = [[0, 1, 2], [3, 4], [5], [6]].map((ids) => {
      const xs = ids.map((id) => settled[id].x);
      const ys = ids.map((id) => settled[id].y);
      return { x0: Math.min(...xs) - 20, x1: Math.max(...xs) + 20, y0: Math.min(...ys) - 20, y1: Math.max(...ys) + 20 };
    });
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i];
        const b = groups[j];
        expect(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1, `parts ${i} and ${j} overlap`).toBe(false);
      }
    }

    // Nothing is pressed against the canvas edges.
    const box = (await cv.canvas.boundingBox())!;
    for (const p of Object.values(settled)) {
      expect(p.x).toBeGreaterThan(30);
      expect(p.x).toBeLessThan(box.width - 30);
      expect(p.y).toBeGreaterThan(30);
      expect(p.y).toBeLessThan(box.height - 30);
    }

    // Adding another isolated node re-packs, but the triangle keeps its shape.
    const side = (pos: Positions, a: string, b: string) => Math.hypot(pos[a].x - pos[b].x, pos[a].y - pos[b].y);
    await cv.click(box.width - 80, box.height - 80);
    const after = await waitUntilSettled(page);
    expect(Object.keys(after)).toHaveLength(8);
    expect(side(after, '0', '1')).toBeCloseTo(side(settled, '0', '1'), 0);
  });

  test.describe('with reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('jumps straight to the settled layout', async ({ page }) => {
      await addCrampedPath();
      await toggle(page).click();
      // Settled in a single frame: no intermediate positions to wait through.
      await expect.poll(async () => minPairDistance(await positions(page)), { timeout: 1000 }).toBeGreaterThan(100);
      const settled = await positions(page);
      await page.waitForTimeout(300);
      expect(await positions(page)).toEqual(settled);
    });

    /** Builds the cramped path, turns auto-layout on, and waits for it to settle. */
    async function settledPath(page: Page): Promise<Positions> {
      await addCrampedPath();
      await toggle(page).click();
      return waitUntilSettled(page);
    }

    test('re-lays out when the graph is edited', async ({ page }) => {
      const before = await settledPath(page);
      expect(minPairDistance(before)).toBeGreaterThan(100);

      // Close the path into a cycle (clicking where the nodes are now): the layout adapts.
      await cv.click(before['0'].x, before['0'].y);
      await cv.click(before['3'].x, before['3'].y);
      await expect(cv.edge(0, 3)).toHaveCount(1);
      await expect(page.locator('#adjacency')).toHaveText('0: 1, 3\n1: 0, 2\n2: 1, 3\n3: 0, 2');
      await expect.poll(async () => JSON.stringify(await positions(page))).not.toBe(JSON.stringify(before));
    });

    test('a node being dragged stays under the pointer', async ({ page }) => {
      const start = (await settledPath(page))['0'];

      const o = (await cv.canvas.boundingBox())!;
      await page.mouse.move(o.x + start.x, o.y + start.y);
      await page.mouse.down();
      await page.mouse.move(o.x + 150, o.y + 120, { steps: 8 });
      await page.waitForTimeout(200); // layout keeps running while held
      const held = (await positions(page))['0'];
      expect(held.x).toBeCloseTo(150, 1); // laid-out positions are fractional
      expect(held.y).toBeCloseTo(120, 1);
      await page.mouse.up();
      // Released, it rejoins the layout and gets pulled back toward its neighbour.
      await expect.poll(async () => (await positions(page))['0'].x).toBeGreaterThan(160);
    });
  });
});
