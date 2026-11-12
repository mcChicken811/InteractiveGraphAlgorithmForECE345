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
  });
});
