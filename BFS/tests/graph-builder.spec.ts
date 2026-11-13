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

/**
 * Reads the boxed adjacency list back as text, one "vertex: neighbours" line per row
 * ("—" for none), or "No nodes yet." when the graph is empty.
 */
async function adjacencyText(page: Page): Promise<string> {
  return page.locator('#adjacency').evaluate((root) => {
    const rows = [...root.querySelectorAll('.adj-row')];
    if (rows.length === 0) return root.textContent?.trim() ?? '';
    return rows
      .map((row) => {
        const vertex = row.querySelector('.adj-vertex')!.textContent;
        // Read only the neighbour id (weighted boxes also contain the weight).
        const boxes = [...row.querySelectorAll('.adj-box')].map((b) => (b.querySelector('.adj-id') ?? b).textContent);
        return `${vertex}: ${boxes.length ? boxes.join(', ') : '—'}`;
      })
      .join('\n');
  });
}

/** Waits until the adjacency list shows exactly `expected` (in adjacencyText's format). */
async function expectAdjacency(page: Page, expected: string): Promise<void> {
  await expect.poll(() => adjacencyText(page)).toBe(expected);
}

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
  page.on('requestfailed', (r) => {
    // With several candidate icons (SVG + PNG), Chrome may cancel the ones it doesn't pick.
    // That abort is harmless; a missing icon would still show up as a 404 response above.
    if (r.url().includes('/icons/favicon-') && r.failure()?.errorText === 'net::ERR_ABORTED') return;
    failures.push(`failed ${r.url()} (${r.failure()?.errorText})`);
  });
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
  await expectAdjacency(page, 'No nodes yet.');
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
  await expectAdjacency(page, '0: —\n1: —\n2: —');
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
  await expectAdjacency(page, '0: 1\n1: 0\n2: —');
});

test('builds a triangle and reports the adjacency list', async ({ page }) => {
  await addTriangleNodes();
  await connect(P.a, P.b);
  await connect(P.b, P.c);
  await connect(P.c, P.a);

  await expect(cv.edges).toHaveCount(3);
  await expect(page.locator('#stats')).toHaveText('3 nodes · 3 edges');
  await expectAdjacency(page, '0: 1, 2\n1: 0, 2\n2: 0, 1');
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
  await expectAdjacency(page, '0: 2\n2: 0');
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
  await expectAdjacency(page, 'No nodes yet.');
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
    await expectAdjacency(page, '0: 1\n1: 0\n2: —');
  });

  test('clicks inside the panel do not touch the graph', async ({ page }) => {
    await menu(page).click();
    await panel(page).getByRole('heading', { name: 'How to use' }).click();
    await panel(page).getByRole('tab', { name: 'Adjacency matrix' }).click();
    await panel(page).getByRole('tab', { name: 'Adjacency list' }).click();
    await expect(cv.nodes).toHaveCount(0);
  });
});

test.describe('panel cards (How to use / Graph representation)', () => {
  const helpToggle = (page: Page) => page.getByRole('button', { name: 'How to use' });
  const repToggle = (page: Page) => page.getByRole('button', { name: 'Graph representation' });
  const helpCard = (page: Page) => page.getByRole('region', { name: 'How to use' });
  const repCard = (page: Page) => page.getByRole('region', { name: 'Graph representation' });

  test.beforeEach(async ({ page }) => {
    await page.getByRole('button', { name: 'Help and adjacency list' }).click();
    // Let the panel's slide-in animation finish so measured positions are final.
    await page.locator('#info-panel').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  });

  test('are two separate cards, How to use on top, representation below', async ({ page }) => {
    await expect(helpCard(page)).toBeVisible();
    await expect(repCard(page)).toBeVisible();
    const [h, r] = await page.locator('.info-card').evaluateAll((cards) =>
      cards.map((c) => {
        const b = c.getBoundingClientRect();
        return { x: b.x, top: b.top, bottom: b.bottom, width: b.width };
      }),
    );
    expect(h.bottom).toBeLessThan(r.top); // separate, with a gap
    expect(h.x).toBeCloseTo(r.x, 0); // aligned in one column
    expect(h.width).toBeCloseTo(r.width, 0);
  });

  test('both start expanded', async ({ page }) => {
    await expect(helpToggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(repToggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#help-body')).toBeVisible();
    await expect(page.locator('#representation-body')).toBeVisible();
  });

  test('clicking a title collapses and expands only that card', async ({ page }) => {
    await helpToggle(page).click();
    await expect(helpToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#help-body')).toBeHidden();
    await expect(helpToggle(page)).toBeVisible(); // the title stays
    await expect(page.locator('#representation-body')).toBeVisible();

    await repToggle(page).click();
    await expect(page.locator('#representation-body')).toBeHidden();
    await expect(page.getByRole('tab', { name: 'Adjacency list' })).toBeHidden();

    await helpToggle(page).click();
    await expect(page.locator('#help-body')).toBeVisible();
    await expect(page.locator('#representation-body')).toBeHidden();
  });

  test('a collapsed card shrinks to its title, moving the next card up', async ({ page }) => {
    const repTop = () => repCard(page).evaluate((el) => el.getBoundingClientRect().top);
    const before = await repTop();
    await helpToggle(page).click();
    await expect.poll(repTop).toBeLessThan(before - 50);
  });

  test('works from the keyboard', async ({ page }) => {
    await helpToggle(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#help-body')).toBeHidden();
    await page.keyboard.press('Space');
    await expect(page.locator('#help-body')).toBeVisible();
  });

  test('remembers which cards are collapsed after a reload', async ({ page }) => {
    await helpToggle(page).click();
    await page.reload();
    await page.getByRole('button', { name: 'Help and adjacency list' }).click();
    await expect(helpToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#help-body')).toBeHidden();
    await expect(repToggle(page)).toHaveAttribute('aria-expanded', 'true');
  });

  test('the ☰ button still opens and closes both together', async ({ page }) => {
    await page.getByRole('button', { name: 'Help and adjacency list' }).click();
    await expect(helpCard(page)).toBeHidden();
    await expect(repCard(page)).toBeHidden();
    await page.getByRole('button', { name: 'Help and adjacency list' }).click();
    await expect(helpCard(page)).toBeVisible();
    await expect(repCard(page)).toBeVisible();
  });

  test('with lots of content, both titles stay on screen and each card scrolls itself', async ({ page }) => {
    // 12 nodes → a long adjacency list; together with the help it overflows the panel.
    for (let i = 0; i < 12; i++) await cv.click(80 + (i % 6) * 100, 200 + Math.floor(i / 6) * 150);
    const canvas = (await cv.canvas.boundingBox())!;
    for (const toggle of [helpToggle(page), repToggle(page)]) {
      const b = (await toggle.boundingBox())!;
      expect(b.y).toBeGreaterThanOrEqual(canvas.y);
      expect(b.y + b.height).toBeLessThanOrEqual(canvas.y + canvas.height);
    }
    const scrolls = await page
      .locator('.card-body')
      .evaluateAll((bodies) => bodies.map((b) => b.scrollHeight > b.clientHeight));
    expect(scrolls).toContain(true); // the overflow is handled inside the cards
  });

  test('the gap between the cards lets clicks through to the canvas', async ({ page }) => {
    const [h, r] = await page.locator('.info-card').evaluateAll((cards) =>
      cards.map((c) => {
        const b = c.getBoundingClientRect();
        return { x: b.x, top: b.top, bottom: b.bottom, width: b.width };
      }),
    );
    const canvas = (await cv.canvas.boundingBox())!;
    const x = h.x + h.width / 2 - canvas.x;
    const y = (h.bottom + r.top) / 2 - canvas.y;
    await cv.click(x, y);
    await expect(cv.nodes).toHaveCount(1);
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

    // Measure both tabs in one go: the panel slides in, so separate measurements could
    // land on different animation frames.
    const [l, m] = await page.getByRole('tab').evaluateAll((tabs) =>
      tabs.map((t) => {
        const r = t.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width };
      }),
    );
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
    await expectAdjacency(page, '0: 2\n2: 0');

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

test.describe('boxed adjacency list', () => {
  test.beforeEach(async ({ page }) => {
    await page.getByRole('button', { name: 'Help and adjacency list' }).click();
  });

  type Box = { x: number; y: number; width: number; height: number };
  const boxesOf = (page: Page, selector: string): Promise<Box[]> =>
    page.locator(selector).evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    );

  test('vertices form a left column of boxes, neighbours a joined strip after a gap', async ({ page }) => {
    await addTriangleNodes();
    await connect(P.a, P.b);
    await connect(P.a, P.c);
    await expectAdjacency(page, '0: 1, 2\n1: 0\n2: 0');

    // The vertex boxes line up in one column, one row each, top to bottom.
    const vertices = await boxesOf(page, '#adjacency .adj-vertex');
    expect(vertices).toHaveLength(3);
    for (const v of vertices) expect(v.x).toBeCloseTo(vertices[0].x, 0);
    expect(vertices[1].y).toBeGreaterThan(vertices[0].y + vertices[0].height - 1);
    expect(vertices[2].y).toBeGreaterThan(vertices[1].y + vertices[1].height - 1);

    // Row 0's neighbours: boxes stacked left to right, touching (shared border).
    const row0 = await boxesOf(page, '#adjacency .adj-row:first-child .adj-box');
    expect(row0).toHaveLength(2);
    expect(row0[1].x).toBeGreaterThan(row0[0].x);
    expect(row0[1].x - (row0[0].x + row0[0].width)).toBeLessThanOrEqual(0); // no gap between them
    expect(Math.abs(row0[1].y - row0[0].y)).toBeLessThan(1); // same line

    // A clear space separates the vertex column from the neighbour strip.
    const gap = row0[0].x - (vertices[0].x + vertices[0].width);
    expect(gap).toBeGreaterThanOrEqual(10);

    // Every neighbour strip starts at the same x.
    const firsts = await boxesOf(page, '#adjacency .adj-box:first-child');
    for (const f of firsts) expect(f.x).toBeCloseTo(firsts[0].x, 0);
  });

  test('a vertex without neighbours shows an empty marker instead of boxes', async ({ page }) => {
    await addTriangleNodes();
    await expect(page.locator('#adjacency .adj-row').nth(2).locator('.adj-box')).toHaveCount(0);
    await expect(page.locator('#adjacency .adj-row').nth(2).locator('.adj-none')).toHaveText('∅');
  });

  test('is announced as nested lists', async ({ page }) => {
    await addTriangleNodes();
    await connect(P.a, P.b);
    const list = page.getByRole('list', { name: 'Adjacency list' });
    await expect(list).toBeVisible();
    await expect(page.getByRole('list', { name: 'Neighbours of 0' }).getByRole('listitem')).toHaveText(['1']);

    await page.locator('label[for="mode-directed"]').click();
    await expect(page.getByRole('list', { name: 'Out-neighbours of 1' }).getByRole('listitem')).toHaveCount(0);
  });

  test('keeps the vertex column aligned with two-digit ids, and long rows scroll in the panel', async ({ page }) => {
    // 12 nodes, node 0 connected to all others: ids reach 11 and row 0 is long.
    const spots: Array<[number, number]> = [];
    for (let i = 0; i < 12; i++) spots.push([90 + (i % 6) * 110, 200 + Math.floor(i / 6) * 160]);
    for (const p of spots) await cv.click(...p);
    for (let i = 1; i < 12; i++) await connect(spots[0], spots[i]);
    await expect(page.locator('#adjacency .adj-row').first().locator('.adj-box')).toHaveCount(11);

    const vertices = await boxesOf(page, '#adjacency .adj-vertex');
    for (const v of vertices) {
      expect(v.x).toBeCloseTo(vertices[0].x, 0);
      expect(v.width).toBeCloseTo(vertices[0].width, 0);
    }

    const overflow = await page.locator('#adjacency').evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });
});

test.describe('directed / undirected switch', () => {
  const undirected = (page: Page) => page.getByRole('radio', { name: 'Undirected', exact: true });
  const directed = (page: Page) => page.getByRole('radio', { name: 'Directed', exact: true });
  /** Picks a mode the way a user does: by clicking its visible label (the radio itself is visually hidden). */
  const choose = (page: Page, mode: 'undirected' | 'directed') => page.locator(`label[for="mode-${mode}"]`).click();

  /** Canvas-local point halfway along an edge's drawn shape (line or curve). */
  async function edgeMidpoint(a: number, b: number): Promise<[number, number]> {
    return cv
      .edge(a, b)
      .locator('.edge-line')
      .evaluate((el) => {
        const shape = el as SVGGeometryElement;
        const p = shape.getPointAtLength(shape.getTotalLength() / 2);
        return [p.x, p.y] as [number, number];
      });
  }

  async function matrixRows(page: Page): Promise<string[][]> {
    return page
      .getByRole('table', { name: 'Adjacency matrix' })
      .locator('tbody tr')
      .evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent ?? '')));
  }

  test('sits top-left next to Auto-layout and starts undirected', async ({ page }) => {
    await expect(undirected(page)).toBeChecked();
    await expect(directed(page)).not.toBeChecked();
    const sw = (await page.getByRole('group', { name: 'Edge type' }).boundingBox())!;
    const auto = (await page.getByRole('button', { name: 'Auto-layout' }).boundingBox())!;
    const c = (await cv.canvas.boundingBox())!;
    expect(sw.x).toBeGreaterThan(auto.x + auto.width - 1); // right of Auto-layout
    expect(Math.abs(sw.y + sw.height / 2 - (auto.y + auto.height / 2))).toBeLessThan(4); // same row
    expect(sw.x + sw.width).toBeLessThan(c.x + c.width / 2); // still in the left half
    expect(sw.y - c.y).toBeLessThan(24);
  });

  test('directed: clicking A then B draws an arrow A → B', async ({ page }) => {
    await choose(page, 'directed');
    await expect(page.locator('#message')).toContainText('Directed');
    await addTriangleNodes();
    await connect(P.b, P.a); // 1 → 0

    await expect(cv.edge(1, 0)).toHaveCount(1);
    await expect(cv.edge(0, 1)).toHaveCount(0);
    await expect(cv.edge(1, 0).locator('.edge-line')).toHaveCSS('marker-end', 'url("#arrow")');
    await expect(page.locator('#stats')).toHaveText('3 nodes · 1 edge');
    await expectAdjacency(page, '0: —\n1: 0\n2: —');

    await page.getByRole('button', { name: 'Help and adjacency list' }).click();
    await page.getByRole('tab', { name: 'Adjacency matrix' }).click();
    expect(await matrixRows(page)).toEqual([
      ['0', '0', '0'],
      ['1', '0', '0'],
      ['0', '0', '0'],
    ]);
    await expect(page.locator('#matrix-note')).toContainText('need not be symmetric');
  });

  test('undirected: the same stored arc shows as an undirected edge everywhere', async ({ page }) => {
    await choose(page, 'directed');
    await addTriangleNodes();
    await connect(P.b, P.a); // stored as 1 → 0
    await choose(page, 'undirected');

    await expect(cv.edge(0, 1)).toHaveCount(1);
    await expect(cv.edge(0, 1).locator('.edge-line')).toHaveCSS('marker-end', 'none');
    await expect(page.locator('#stats')).toHaveText('3 nodes · 1 edge');
    await expectAdjacency(page, '0: 1\n1: 0\n2: —');

    await page.getByRole('button', { name: 'Help and adjacency list' }).click();
    await page.getByRole('tab', { name: 'Adjacency matrix' }).click();
    expect(await matrixRows(page)).toEqual([
      ['0', '1', '0'],
      ['1', '0', '0'],
      ['0', '0', '0'],
    ]);
    await expect(page.locator('#matrix-note')).toContainText('symmetric because edges are undirected');
  });

  test('arcs both ways: two curved arrows when directed, one edge when undirected', async ({ page }) => {
    await choose(page, 'directed');
    await addTriangleNodes();
    await connect(P.a, P.b);
    await connect(P.b, P.a);

    await expect(cv.edges).toHaveCount(2);
    await expect(page.locator('#stats')).toHaveText('3 nodes · 2 edges');
    expect(await cv.edge(0, 1).locator('.edge-line').evaluate((el) => el.tagName)).toBe('path');
    const there = await edgeMidpoint(0, 1);
    const back = await edgeMidpoint(1, 0);
    expect(Math.hypot(there[0] - back[0], there[1] - back[1])).toBeGreaterThan(30); // visibly apart

    await choose(page, 'undirected');
    await expect(cv.edges).toHaveCount(1);
    await expect(page.locator('#stats')).toHaveText('3 nodes · 1 edge');
    await expectAdjacency(page, '0: 1\n1: 0\n2: —');
  });

  test('directed: clicking one of two opposite arcs deletes only that one', async ({ page }) => {
    await choose(page, 'directed');
    await addTriangleNodes();
    await connect(P.a, P.b);
    await connect(P.b, P.a);

    await cv.click(...(await edgeMidpoint(1, 0)));
    await expect(cv.edge(1, 0)).toHaveCount(0);
    await expect(cv.edge(0, 1)).toHaveCount(1);
    await expect(page.locator('#message')).toHaveText('Removed edge 1 → 0.');
    // The remaining arc straightens out.
    expect(await cv.edge(0, 1).locator('.edge-line').evaluate((el) => el.tagName)).toBe('line');
  });

  test('undirected: deleting the edge removes the arcs in both directions', async ({ page }) => {
    await choose(page, 'directed');
    await addTriangleNodes();
    await connect(P.a, P.b);
    await connect(P.b, P.a);
    await choose(page, 'undirected');

    await cv.click(...mid(P.a, P.b));
    await expect(cv.edges).toHaveCount(0);
    await choose(page, 'directed');
    await expect(cv.edges).toHaveCount(0); // nothing left hidden in directed mode either
  });

  test('undirected: connecting the reverse of an existing arc is refused', async ({ page }) => {
    await addTriangleNodes();
    await connect(P.a, P.b);
    await connect(P.b, P.a);
    await expect(page.locator('#message')).toHaveText('Nodes 1 and 0 are already connected.');
    await choose(page, 'directed');
    await expect(cv.edges).toHaveCount(1); // only the one arc 0 → 1 was stored
    await expect(cv.edge(0, 1)).toHaveCount(1);
  });

  test('the preview line shows an arrow while picking the target in directed mode', async ({ page }) => {
    await choose(page, 'directed');
    await addTriangleNodes();
    await cv.click(...P.a);
    await cv.move(380, 300);
    await expect(cv.canvas.locator('.preview-line')).toHaveCSS('marker-end', 'url("#arrow-preview")');
  });

  test('switching mode never moves nodes', async ({ page }) => {
    await addTriangleNodes();
    await connect(P.a, P.b);
    const before = await cv.canvas
      .locator('[data-node-id]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('transform')));
    await choose(page, 'directed');
    await choose(page, 'undirected');
    const after = await cv.canvas
      .locator('[data-node-id]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('transform')));
    expect(after).toEqual(before);
  });

  test('is keyboard operable (arrow keys move between the two options)', async ({ page }) => {
    await undirected(page).focus();
    await page.keyboard.press('ArrowRight');
    await expect(directed(page)).toBeChecked();
    await expect(cv.canvas).toHaveClass(/directed/);
    await page.keyboard.press('ArrowLeft');
    await expect(undirected(page)).toBeChecked();
    await expect(cv.canvas).not.toHaveClass(/directed/);
  });
});

test.describe('weighted / unweighted switch', () => {
  const unweighted = (page: Page) => page.getByRole('radio', { name: 'Unweighted', exact: true });
  const weighted = (page: Page) => page.getByRole('radio', { name: 'Weighted', exact: true });
  const choose = (page: Page, id: 'weights-on' | 'weights-off' | 'mode-directed' | 'mode-undirected') =>
    page.locator(`label[for="${id}"]`).click();
  const weightLabel = (a: number, b: number) => cv.edge(a, b).locator('.edge-weight text');

  /** Moves the mouse onto the middle of an edge (line or curve), in page coordinates. */
  async function hoverEdge(a: number, b: number): Promise<void> {
    const [x, y] = await cv
      .edge(a, b)
      .locator('.edge-line')
      .evaluate((el) => {
        const shape = el as SVGGeometryElement;
        const p = shape.getPointAtLength(shape.getTotalLength() / 2);
        return [p.x, p.y];
      });
    await cv.move(x, y);
  }

  /** Scrolls by a fraction of the page (the window height); negative = up. */
  async function scrollPages(page: Page, pages: number): Promise<void> {
    await page.mouse.wheel(0, pages * page.viewportSize()!.height);
  }

  test('sits next to the Undirected/Directed switch and starts unweighted', async ({ page }) => {
    await expect(unweighted(page)).toBeChecked();
    const w = (await page.getByRole('group', { name: 'Edge weights' }).boundingBox())!;
    const d = (await page.getByRole('group', { name: 'Edge type' }).boundingBox())!;
    expect(w.x).toBeGreaterThan(d.x + d.width - 1);
    expect(Math.abs(w.y - d.y)).toBeLessThan(2);
    const c = (await cv.canvas.boundingBox())!;
    expect(w.x + w.width).toBeLessThan(c.x + c.width / 2);
  });

  test('unweighted: no weight labels, and scrolling over an edge changes nothing', async ({ page }) => {
    await addTriangleNodes();
    await connect(P.a, P.b);
    await expect(weightLabel(0, 1)).toBeHidden();
    await hoverEdge(0, 1);
    await scrollPages(page, -1);
    await choose(page, 'weights-on');
    await expect(weightLabel(0, 1)).toHaveText('0');
  });

  test('weighted: edges show their weight, 0 by default', async ({ page }) => {
    await choose(page, 'weights-on');
    await expect(weighted(page)).toBeChecked();
    await addTriangleNodes();
    await connect(P.a, P.b);
    await expect(weightLabel(0, 1)).toBeVisible();
    await expect(weightLabel(0, 1)).toHaveText('0');
    await expect(page.locator('#message')).toContainText('weight 0');
  });

  test('scrolling one page up over an edge adds 15, down subtracts', async ({ page }) => {
    await choose(page, 'weights-on');
    await addTriangleNodes();
    await connect(P.a, P.b);
    await hoverEdge(0, 1);
    await scrollPages(page, -1);
    await expect(weightLabel(0, 1)).toHaveText('15');
    await expect(page.locator('#message')).toHaveText('Weight of edge 0 — 1: 15');
    await scrollPages(page, 2);
    await expect(weightLabel(0, 1)).toHaveText('-15');
  });

  test('the change is linear in the scroll distance', async ({ page }) => {
    await choose(page, 'weights-on');
    await addTriangleNodes();
    await connect(P.a, P.b);
    await hoverEdge(0, 1);
    for (let i = 0; i < 10; i++) await scrollPages(page, -0.1); // 1.5 each
    await expect(weightLabel(0, 1)).toHaveText('15');
    for (let i = 0; i < 4; i++) await scrollPages(page, -0.05); // 0.75 each → +3
    await expect(weightLabel(0, 1)).toHaveText('18');
  });

  test('scrolling over empty canvas does not change any weight', async ({ page }) => {
    await choose(page, 'weights-on');
    await addTriangleNodes();
    await connect(P.a, P.b);
    await cv.move(...P.d);
    await scrollPages(page, -1);
    await expect(weightLabel(0, 1)).toHaveText('0');
  });

  test('directed: each of two opposite arcs has its own weight', async ({ page }) => {
    await choose(page, 'mode-directed');
    await choose(page, 'weights-on');
    await addTriangleNodes();
    await connect(P.a, P.b);
    await connect(P.b, P.a);
    await hoverEdge(1, 0);
    await scrollPages(page, -1);
    await expect(weightLabel(1, 0)).toHaveText('15');
    await expect(weightLabel(0, 1)).toHaveText('0');
  });

  test('undirected: arcs both ways show the smaller weight; editing sets both', async ({ page }) => {
    await choose(page, 'mode-directed');
    await choose(page, 'weights-on');
    await addTriangleNodes();
    await connect(P.a, P.b);
    await connect(P.b, P.a);
    await hoverEdge(0, 1);
    await scrollPages(page, -1); // 0 → 1 = 15, 1 → 0 = 0

    await choose(page, 'mode-undirected');
    await expect(weightLabel(0, 1)).toHaveText('0'); // min(15, 0)
    await hoverEdge(0, 1);
    await scrollPages(page, -0.4); // +6
    await expect(weightLabel(0, 1)).toHaveText('6');

    await choose(page, 'mode-directed');
    await expect(weightLabel(0, 1)).toHaveText('6');
    await expect(weightLabel(1, 0)).toHaveText('6');
  });

  test('weights survive switching to unweighted and back', async ({ page }) => {
    await choose(page, 'weights-on');
    await addTriangleNodes();
    await connect(P.a, P.b);
    await hoverEdge(0, 1);
    await scrollPages(page, -1);
    await choose(page, 'weights-off');
    await expect(weightLabel(0, 1)).toBeHidden();
    await choose(page, 'weights-on');
    await expect(weightLabel(0, 1)).toHaveText('15');
  });

  test('the panel shows weights in the list and the matrix only in weighted mode', async ({ page }) => {
    await addTriangleNodes();
    await connect(P.a, P.b);
    await connect(P.b, P.c);
    await choose(page, 'weights-on');
    await hoverEdge(1, 2);
    await scrollPages(page, -0.2); // 3

    await page.getByRole('button', { name: 'Help and adjacency list' }).click();
    const rowWeights = (i: number) => page.locator('#adjacency .adj-row').nth(i).locator('.adj-weight');
    await expect(rowWeights(1)).toHaveText(['0', '3']); // 1: 0 (w 0), 2 (w 3)
    await expect(page.locator('#list-note')).toContainText('edge weight');

    await page.getByRole('tab', { name: 'Adjacency matrix' }).click();
    const cells = await page
      .getByRole('table', { name: 'Adjacency matrix' })
      .locator('tbody tr')
      .evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent)));
    expect(cells).toEqual([
      ['—', '0', '—'],
      ['0', '—', '3'],
      ['—', '3', '—'],
    ]);
    await expect(page.locator('#matrix-note')).toContainText('— means no edge');

    await choose(page, 'weights-off');
    await expect(page.locator('#adjacency .adj-weight')).toHaveCount(0);
    const plain = await page
      .getByRole('table', { name: 'Adjacency matrix' })
      .locator('tbody tr')
      .evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent)));
    expect(plain).toEqual([
      ['0', '1', '0'],
      ['1', '0', '1'],
      ['0', '1', '0'],
    ]);
  });

  test('is keyboard operable', async ({ page }) => {
    await unweighted(page).focus();
    await page.keyboard.press('ArrowRight');
    await expect(weighted(page)).toBeChecked();
    await expect(cv.canvas).toHaveClass(/weighted/);
  });
});

test.describe('favicon', () => {
  const iconHrefs = (page: Page) =>
    page.locator('link[rel="icon"]').evaluateAll((links) => links.map((l) => l.getAttribute('href')));

  /** The page's own node colours in the current scheme, and the colours drawn in an icon file. */
  async function colours(page: Page, iconHref: string) {
    const page_ = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      return { fill: css.getPropertyValue('--node-fill').trim(), stroke: css.getPropertyValue('--accent').trim() };
    });
    const res = await page.request.get(new URL(iconHref, page.url()).toString());
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/svg+xml');
    const svg = await res.text();
    return { page: page_, svg };
  }

  test('light mode: a node icon in the light palette, with no number inside', async ({ page }) => {
    await expect.poll(() => iconHrefs(page)).toEqual(['./icons/favicon-light.svg', './icons/favicon-light.png']);
    const { page: c, svg } = await colours(page, './icons/favicon-light.svg');
    expect(svg).toContain(`fill="${c.fill}"`);
    expect(svg).toContain(`stroke="${c.stroke}"`);
    expect(svg).toContain('<circle');
    expect(svg).not.toContain('<text'); // no index number
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('uses the dark palette', async ({ page }) => {
      await expect.poll(() => iconHrefs(page)).toEqual(['./icons/favicon-dark.svg', './icons/favicon-dark.png']);
      const { page: c, svg } = await colours(page, './icons/favicon-dark.svg');
      expect(svg).toContain(`fill="${c.fill}"`);
      expect(svg).toContain(`stroke="${c.stroke}"`);
    });
  });

  test('switches live when the colour scheme changes', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => iconHrefs(page)).toEqual(['./icons/favicon-dark.svg', './icons/favicon-dark.png']);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => iconHrefs(page)).toEqual(['./icons/favicon-light.svg', './icons/favicon-light.png']);
  });

  test('PNG fallbacks exist for both palettes', async ({ page }) => {
    for (const theme of ['light', 'dark']) {
      const res = await page.request.get(new URL(`./icons/favicon-${theme}.png`, page.url()).toString());
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toBe('image/png');
    }
  });
});

test.describe('algorithm simulation (BFS)', () => {
  const runBtn = (page: Page) => page.getByRole('button', { name: 'Run', exact: true });
  const updateBtn = (page: Page) => page.getByRole('button', { name: 'Update', exact: true });
  const finishBtn = (page: Page) => page.getByRole('button', { name: 'Finish', exact: true });
  const stopBtn = (page: Page) => page.getByRole('button', { name: 'Stop', exact: true });
  const picker = (page: Page) => page.getByRole('combobox', { name: 'Algorithm' });
  const weightSwitch = (page: Page) => page.getByRole('group', { name: 'Edge weights' });
  // Playwright's toBeDisabled checks form controls, so check the radios in each switch.
  const weightRadios = (page: Page) => weightSwitch(page).getByRole('radio');
  const directionRadios = (page: Page) => page.getByRole('group', { name: 'Edge type' }).getByRole('radio');

  /** Which nodes are current / finished, and which edges are highlighted. */
  async function simState(page: Page) {
    return page.evaluate(() => {
      const ids = (sel: string) => [...document.querySelectorAll(sel)].map((e) => Number((e as HTMLElement).dataset.nodeId));
      const edges = [...document.querySelectorAll<SVGGElement>('.edge.sim-active')].map(
        (e) => `${e.dataset.edgeA}-${e.dataset.edgeB}`,
      );
      return { current: ids('.node.sim-current'), done: ids('.node.sim-done').sort(), edges: edges.sort() };
    });
  }

  const strokeOf = (id: number) =>
    cv.node(id).locator('circle').evaluate((c) => getComputedStyle(c).stroke);

  /** Path 0 — 1 — 2 plus an isolated node 3. */
  async function buildPathAndIsland(): Promise<void> {
    await addTriangleNodes();
    await cv.click(...P.d);
    await connect(P.a, P.b);
    await connect(P.b, P.c);
  }

  test('the header has the program picker, then Run, on the right', async ({ page }) => {
    await expect(picker(page)).toBeVisible();
    await expect(picker(page)).toHaveText('Breadth-first search');
    await picker(page).click();
    await expect(page.getByRole('listbox', { name: 'Algorithm' }).getByRole('option')).toHaveText([
      'Breadth-first search',
      'Depth-first search',
    ]);
    await page.keyboard.press('Escape');
    await expect(runBtn(page)).toBeVisible();
    await expect(updateBtn(page)).toBeHidden();
    await expect(stopBtn(page)).toBeHidden();
    const sel = (await picker(page).boundingBox())!;
    const run = (await runBtn(page).boundingBox())!;
    expect(sel.x + sel.width).toBeLessThanOrEqual(run.x); // picker left of Run
    expect(run.x + run.width).toBeGreaterThan(page.viewportSize()!.width - 40); // at the right edge
  });

  test('the picker matches the buttons: same height and line, page styling, room for its text', async ({ page }) => {
    const [sel, run, clear] = await page.evaluate(() =>
      ['#algorithm', '#run-btn', '#clear-btn'].map((q) => {
        const el = document.querySelector<HTMLElement>(q)!;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          top: r.top,
          height: r.height,
          appearance: cs.appearance,
          radius: cs.borderTopLeftRadius,
          padLeft: parseFloat(cs.paddingLeft),
          padRight: parseFloat(cs.paddingRight),
          border: cs.borderTopColor,
          background: cs.backgroundColor,
        };
      }),
    );
    expect(sel.height).toBe(run.height);
    expect(sel.top).toBe(run.top);
    expect(clear.height).toBe(run.height);
    expect(sel.appearance).toBe('none'); // not the browser's default control
    expect(sel.radius).toBe(clear.radius);
    expect(sel.border).toBe(clear.border);
    expect(sel.background).toBe(clear.background);
    expect(sel.padLeft).toBeGreaterThanOrEqual(12);
    expect(sel.padRight).toBeGreaterThanOrEqual(32); // room for the chevron

    // The text fits without being clipped.
    const fits = await picker(page).evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(fits).toBe(true);

    // Hover uses the accent colour, like the other controls.
    await picker(page).hover();
    const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    const hovered = await picker(page).evaluate((el) => getComputedStyle(el).borderTopColor);
    const toRgb = (hex: string) =>
      `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
    expect(hovered).toBe(toRgb(accent));
  });

  test('the picker opens a page-styled list right below it, aligned with its text', async ({ page }) => {
    const list = page.getByRole('listbox', { name: 'Algorithm' });
    await expect(list).toBeHidden();
    await picker(page).click();
    await expect(list).toBeVisible();
    await expect(picker(page)).toHaveAttribute('aria-expanded', 'true');
    await list.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));

    const m = await page.evaluate(() => {
      const textLeft = (el: Element) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        return r.getBoundingClientRect().left;
      };
      const box = document.querySelector('#algorithm')!;
      const list = document.querySelector('#algorithm-list')!;
      const option = list.querySelector('[role="option"]')!;
      const b = box.getBoundingClientRect();
      const l = list.getBoundingClientRect();
      const ls = getComputedStyle(list);
      return {
        gap: l.top - b.bottom,
        leftDelta: l.left - b.left,
        widthDelta: l.width - b.width,
        textDelta: textLeft(option) - textLeft(box.querySelector('.select-value')!),
        radius: ls.borderTopLeftRadius,
        boxRadius: getComputedStyle(box).borderTopLeftRadius,
        background: ls.backgroundColor,
        panelBackground: getComputedStyle(document.querySelector('.topbar')!).backgroundColor,
      };
    });
    expect(m.gap).toBeGreaterThanOrEqual(0); // drops down, below the box
    expect(m.gap).toBeLessThanOrEqual(8);
    expect(m.leftDelta).toBe(0); // same left edge
    expect(m.widthDelta).toBeGreaterThanOrEqual(0); // at least as wide
    expect(Math.abs(m.textDelta)).toBeLessThan(0.5); // option text lines up with the box text
    expect(m.radius).toBe(m.boxRadius);
    expect(m.background).toBe(m.panelBackground); // the page's panel colour
    await expect(list.getByRole('option', { name: 'Breadth-first search' })).toHaveAttribute('aria-selected', 'true');
  });

  test('the picker list closes on choosing, on Esc and on clicking elsewhere', async ({ page }) => {
    const list = page.getByRole('listbox', { name: 'Algorithm' });
    await picker(page).click();
    await list.getByRole('option', { name: 'Breadth-first search' }).click();
    await expect(list).toBeHidden();
    await expect(picker(page)).toHaveAttribute('aria-expanded', 'false');

    await picker(page).click();
    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();

    await picker(page).click();
    await cv.click(...P.d); // clicking the canvas closes the list
    await expect(list).toBeHidden();
  });

  test('the picker works from the keyboard', async ({ page }) => {
    const list = page.getByRole('listbox', { name: 'Algorithm' });
    await picker(page).focus();
    await page.keyboard.press('ArrowDown');
    await expect(list).toBeVisible();
    await expect(picker(page)).toHaveAttribute('aria-activedescendant', /algorithm-list-option-0/);
    await page.keyboard.press('Enter');
    await expect(list).toBeHidden();
    await expect(picker(page)).toBeFocused();
  });

  test('the picker cannot be opened while an algorithm runs', async ({ page }) => {
    await cv.click(...P.a);
    await runBtn(page).click();
    await expect(picker(page)).toHaveAttribute('aria-disabled', 'true');
    await picker(page).click({ force: true });
    await expect(page.getByRole('listbox', { name: 'Algorithm' })).toBeHidden();
    await stopBtn(page).click();
    await expect(picker(page)).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('Run is disabled on an empty graph', async ({ page }) => {
    await expect(runBtn(page)).toBeDisabled();
    await cv.click(...P.a);
    await expect(runBtn(page)).toBeEnabled();
  });

  test('Run replaces itself with Update and Stop, and locks the graph', async ({ page }) => {
    await page.locator('label[for="weights-on"]').click(); // weighted before running
    await buildPathAndIsland();
    await runBtn(page).click();

    await expect(runBtn(page)).toBeHidden();
    await expect(updateBtn(page)).toBeVisible();
    await expect(stopBtn(page)).toBeVisible();
    await expect(picker(page)).toBeDisabled();
    await expect(page.locator('#message')).toHaveText('BFS from 0. Queue: 0. Press Update to pop 0.');

    // Forced unweighted, shown by the greyed-out switch.
    for (const radio of await weightRadios(page).all()) await expect(radio).toBeDisabled();
    await expect(page.getByRole('radio', { name: 'Unweighted', exact: true })).toBeChecked();
    expect(Number(await weightSwitch(page).evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(0.6);
    await expect(cv.edge(0, 1).locator('.edge-weight')).toBeHidden();
    // The direction switch and Clear are locked too.
    for (const radio of await directionRadios(page).all()) await expect(radio).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Clear graph' })).toBeDisabled();
  });

  test('white marks what the next Update pops and travels; popped vertices are green', async ({ page }) => {
    await buildPathAndIsland(); // 0 — 1 — 2, and 3 on its own
    await runBtn(page).click();

    // Before any Update: the source is at the front of the queue, with the edge it will travel.
    expect(await simState(page)).toEqual({ current: [0], done: [], edges: ['0-1'] });
    expect(await strokeOf(0)).toBe('rgb(255, 255, 255)');
    await expect(cv.edge(0, 1).locator('.edge-line')).toHaveCSS('stroke', 'rgb(255, 255, 255)');

    await updateBtn(page).click(); // pops 0, discovers 1
    expect(await simState(page)).toEqual({ current: [1], done: [0], edges: ['1-2'] });
    await expect(page.locator('#message')).toHaveText('Popped 0: discovered 1. Queue: 1.');
    expect(await strokeOf(0)).toBe('rgb(47, 158, 68)'); // green
    expect(await strokeOf(1)).toBe('rgb(255, 255, 255)');
    await expect(cv.edge(0, 1).locator('.edge-line')).not.toHaveCSS('stroke', 'rgb(255, 255, 255)');

    await updateBtn(page).click(); // pops 1, discovers 2
    expect(await simState(page)).toEqual({ current: [2], done: [0, 1], edges: [] }); // 2 has nothing left to travel
    await expect(page.locator('#message')).toHaveText('Popped 1: discovered 2. Queue: 2.');
  });

  test('the queue in the message always starts with the white vertex', async ({ page }) => {
    await addTriangleNodes();
    await connect(P.a, P.b);
    await connect(P.a, P.c); // 0 has two neighbours: the queue holds two vertices at once
    await runBtn(page).click();
    await expect(page.locator('#message')).toContainText('Queue: 0.');
    await updateBtn(page).click();
    await expect(page.locator('#message')).toHaveText('Popped 0: discovered 1, 2. Queue: 1, 2.');
    expect((await simState(page)).current).toEqual([1]); // the front of "1, 2"
    await updateBtn(page).click();
    await expect(page.locator('#message')).toHaveText('Popped 1: nothing new. Queue: 2.');
    expect((await simState(page)).current).toEqual([2]);
  });

  test('after the last step, Update becomes Finish; Finish ends the run and unlocks', async ({ page }) => {
    await page.locator('label[for="weights-on"]').click();
    await buildPathAndIsland();
    await runBtn(page).click();
    for (let i = 0; i < 2; i++) await updateBtn(page).click();
    await expect(updateBtn(page)).toBeVisible();
    await updateBtn(page).click(); // pops 2, the last reachable vertex: the queue is empty

    await expect(finishBtn(page)).toBeVisible();
    await expect(updateBtn(page)).toBeHidden();
    expect(await simState(page)).toEqual({ current: [], done: [0, 1, 2], edges: [] });
    await expect(page.locator('#message')).toHaveText(
      'BFS finished: visited 3 of 4 vertices (order 0, 1, 2). 1 not reachable from 0. Press Finish.',
    );

    await finishBtn(page).click();
    await expect(runBtn(page)).toBeVisible();
    await expect(finishBtn(page)).toBeHidden();
    await expect(stopBtn(page)).toBeHidden();
    expect(await simState(page)).toEqual({ current: [], done: [], edges: [] });
    for (const radio of await weightRadios(page).all()) await expect(radio).toBeEnabled();
    await expect(page.getByRole('radio', { name: 'Weighted', exact: true })).toBeChecked(); // restored
    await expect(cv.edge(0, 1).locator('.edge-weight')).toBeVisible();
    for (const radio of await directionRadios(page).all()) await expect(radio).toBeEnabled();
    await expect(picker(page)).toBeEnabled();
    await expect(page.locator('#message')).toHaveText('Finished. The graph can be edited again.');
  });

  test('Stop ends the run part-way and releases the locks', async ({ page }) => {
    await buildPathAndIsland();
    await runBtn(page).click();
    await updateBtn(page).click();
    await stopBtn(page).click();
    await expect(runBtn(page)).toBeVisible();
    expect(await simState(page)).toEqual({ current: [], done: [], edges: [] });
    await expect(page.locator('#message')).toHaveText('Stopped. The graph can be edited again.');

    // Editing works again.
    await cv.click(700, 600);
    await expect(cv.nodes).toHaveCount(5);
  });

  test('while running, clicks do not edit the graph, but nodes can be dragged', async ({ page }) => {
    await buildPathAndIsland();
    await runBtn(page).click();
    await cv.click(700, 600);
    await expect(cv.nodes).toHaveCount(4);
    await expect(page.locator('#message')).toContainText('locked');
    await cv.click(...mid(P.a, P.b)); // clicking an edge does not delete it
    await expect(cv.edges).toHaveCount(2);
    await cv.click(...P.d, 'right'); // nor does right-clicking a node
    await expect(cv.nodes).toHaveCount(4);

    await cv.drag(P.d, [700, 600]);
    await expect(cv.node(3)).toHaveAttribute('transform', 'translate(700 600)');
  });

  test('starts from the selected node', async ({ page }) => {
    await buildPathAndIsland();
    await cv.click(...P.c); // select node 2
    await runBtn(page).click();
    await expect(page.locator('#message')).toHaveText('BFS from 2. Queue: 2. Press Update to pop 2.');
    expect((await simState(page)).current).toEqual([2]);
  });

  test('directed: explores and highlights only outgoing edges', async ({ page }) => {
    await page.locator('label[for="mode-directed"]').click();
    await addTriangleNodes();
    await connect(P.a, P.b); // 0 → 1
    await connect(P.c, P.b); // 2 → 1 (cannot be followed from 1)
    await runBtn(page).click();
    expect(await simState(page)).toEqual({ current: [0], done: [], edges: ['0-1'] });
    await expect(cv.edge(0, 1).locator('.edge-line')).toHaveCSS('marker-end', 'url("#arrow-active")');
    await updateBtn(page).click(); // pops 0; 1 is next, and has no outgoing edges
    expect(await simState(page)).toEqual({ current: [1], done: [0], edges: [] });
    await updateBtn(page).click(); // pops 1: done
    await expect(finishBtn(page)).toBeVisible();
    await expect(page.locator('#message')).toContainText('visited 2 of 3 vertices');
  });

  test('the panel shows the unweighted representation while running', async ({ page }) => {
    await page.locator('label[for="weights-on"]').click();
    await buildPathAndIsland();
    await page.getByRole('button', { name: 'Help and adjacency list' }).click();
    await expect(page.locator('#adjacency .adj-weight')).not.toHaveCount(0);
    await runBtn(page).click();
    await expect(page.locator('#adjacency .adj-weight')).toHaveCount(0);
  });
});

test.describe('BFS queue card (side panel)', () => {
  const card = (page: Page) => page.getByRole('region', { name: 'Queue' });
  const strip = (page: Page) => page.getByRole('list', { name: 'Queue, front first' });
  const run = (page: Page) => page.getByRole('button', { name: 'Run', exact: true }).click();
  const update = (page: Page) => page.getByRole('button', { name: 'Update', exact: true }).click();

  /** Strip contents as tokens: 'pop', 'push', '<id>' (+ '*' front, '?' about to be pushed). */
  const tokens = (page: Page) =>
    page.locator('#queue-strip > [data-key]:not(.exiting)').evaluateAll((els) =>
      els.map((el) => {
        const key = (el as HTMLElement).dataset.key!;
        if (key === 'pop' || key === 'push') return key;
        const id = el.querySelector('.q-index')!.textContent!;
        return id + (el.classList.contains('front') ? '*' : '') + (el.classList.contains('incoming') ? '?' : '');
      }),
    );

  /** A star: 0 joined to 1, 2, 3; plus 1 — 4 (two levels, so the queue changes shape). */
  async function buildStar(): Promise<void> {
    const spots: Array<[number, number]> = [
      [400, 380],
      [240, 220],
      [400, 180],
      [560, 220],
      [120, 140],
    ];
    for (const p of spots) await cv.click(...p);
    for (const [a, b] of [
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 4],
    ]) await connect(spots[a], spots[b]);
  }

  test.beforeEach(async ({ page }) => {
    await page.getByRole('button', { name: 'Help and adjacency list' }).click();
  });

  test('appears at the bottom of the panel only while BFS runs', async ({ page }) => {
    await buildStar();
    await expect(card(page)).toBeHidden();
    await run(page);
    await expect(card(page)).toBeVisible();
    const [rep, queue] = await page.locator('.info-card:not([hidden])').evaluateAll((cards) =>
      cards.slice(-2).map((c) => c.getBoundingClientRect().top),
    );
    expect(queue).toBeGreaterThan(rep); // appended below the other cards
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(card(page)).toBeHidden();
  });

  test('shows ← pop, the queue front first, the greyed vertices about to be pushed, then ← push', async ({ page }) => {
    await buildStar();
    await run(page);
    expect(await tokens(page)).toEqual(['pop', '0*', '1?', '2?', '3?', 'push']);

    // Laid out left to right in that order, on one line.
    const boxes = await page.locator('#queue-strip > [data-key]').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, mid: r.top + r.height / 2 };
      }),
    );
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i].left).toBeGreaterThanOrEqual(boxes[i - 1].right - 0.5);
      expect(Math.abs(boxes[i].mid - boxes[0].mid)).toBeLessThan(2);
    }

    await update(page); // pop 0, push 1, 2, 3 → popping 1 next will push 4
    expect(await tokens(page)).toEqual(['pop', '1*', '2', '3', '4?', 'push']);
    await update(page); // pop 1, push 4
    expect(await tokens(page)).toEqual(['pop', '2*', '3', '4']);
  });

  test('vertices look like the canvas nodes, smaller, with the same states', async ({ page }) => {
    await buildStar();
    await run(page);
    const look = (sel: string) =>
      page.locator(sel).first().evaluate((el) => {
        const cs = getComputedStyle(el as HTMLElement);
        return {
          radius: cs.borderTopLeftRadius,
          width: el.getBoundingClientRect().width,
          border: cs.borderTopColor,
          opacity: Number(cs.opacity),
          text: el.querySelector('.q-index')!.textContent,
        };
      });
    const canvasNode = await cv.node(1).locator('circle').evaluate((c) => ({
      stroke: getComputedStyle(c).stroke,
      width: c.getBoundingClientRect().width,
    }));
    const front = await look('#queue-strip .q-node.front');
    const incoming = await look('#queue-strip .q-node.incoming');
    expect(front.radius).toBe('50%');
    expect(front.width).toBeLessThan(canvasNode.width); // shrunk
    expect(front.text).toBe('0');
    expect(front.border).toBe('rgb(255, 255, 255)'); // white, like the canvas's next vertex
    expect(incoming.border).toBe(canvasNode.stroke); // the normal node ring…
    expect(incoming.opacity).toBeLessThan(0.5); // …greyed out
  });

  test('Update animates the queue: the popped vertex slides out green, the rest glide over', async ({ page }) => {
    await buildStar();
    await run(page);
    await update(page);
    const popped = page.locator('#queue-strip > .exiting');
    await expect(popped).toHaveCount(1);
    await expect(popped.locator('.q-index')).toHaveText('0');
    await expect(popped).toHaveClass(/popped/);
    const animating = await page
      .locator('#queue-strip > [data-key]')
      .evaluateAll((els) => els.filter((el) => el.getAnimations().length > 0).length);
    expect(animating).toBeGreaterThan(1); // the popped one and the ones moving into place
    await expect(popped).toHaveCount(0, { timeout: 2000 }); // removed once it has slid out
  });

  test.describe('with reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('updates instantly, without animation', async ({ page }) => {
      await buildStar();
      await run(page);
      await update(page);
      await expect(page.locator('#queue-strip > .exiting')).toHaveCount(0);
      const animating = await page
        .locator('#queue-strip > [data-key]')
        .evaluateAll((els) => els.filter((el) => el.getAnimations().length > 0).length);
      expect(animating).toBe(0);
    });
  });

  test('a long queue scrolls sideways inside the strip', async ({ page }) => {
    // A hub joined to 10 others: 10 vertices waiting to be pushed.
    await cv.click(400, 420);
    const leaves: Array<[number, number]> = [];
    for (let i = 0; i < 10; i++) leaves.push([80 + (i % 5) * 150, 180 + Math.floor(i / 5) * 420]);
    for (const p of leaves) await cv.click(...p);
    for (const p of leaves) await connect([400, 420], p);
    await run(page);

    const s = await strip(page).evaluate((el) => ({
      overflowX: getComputedStyle(el).overflowX,
      scrollable: el.scrollWidth > el.clientWidth,
    }));
    expect(s).toEqual({ overflowX: 'auto', scrollable: true });

    // The user can scroll it to reach the back of the queue.
    await strip(page).hover();
    await page.mouse.wheel(400, 0);
    await expect.poll(() => strip(page).evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await expect(page.locator('#queue-strip .q-push')).toBeInViewport();
    // The page itself never scrolls sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });

  test('says the queue is empty once BFS is done', async ({ page }) => {
    await cv.click(...P.a);
    await run(page);
    expect(await tokens(page)).toEqual(['pop', '0*']);
    await update(page);
    await expect(page.locator('#queue-empty')).toBeVisible();
    await expect(strip(page)).toBeHidden();
  });

  test('collapses from its title like the other cards', async ({ page }) => {
    await buildStar();
    await run(page);
    await page.getByRole('button', { name: 'Queue', exact: true }).click();
    await expect(strip(page)).toBeHidden();
    await page.getByRole('button', { name: 'Queue', exact: true }).click();
    await expect(strip(page)).toBeVisible();
  });
});

test.describe('BFS distance labels', () => {
  const run = (page: Page) => page.getByRole('button', { name: 'Run', exact: true }).click();
  const update = (page: Page) => page.getByRole('button', { name: 'Update', exact: true }).click();
  const strip = (page: Page) => page.getByRole('list', { name: 'Queue, front first' });

  /** For each canvas vertex: its id, the label text, and which of the two is showing. */
  const canvasLabels = (page: Page) =>
    page.locator('#canvas [data-node-id]').evaluateAll((nodes) =>
      nodes.map((g) => ({
        id: g.querySelector('.node-index')!.textContent,
        label: g.querySelector('.sim-label')!.textContent,
        showing: Number(getComputedStyle(g.querySelector('.sim-label')!).opacity) === 1 ? 'label' : 'id',
      })),
    );

  /** Path 0 — 1 — 2 plus isolated 3, numbered so ids and distances differ: start from 2. */
  async function build(page: Page): Promise<void> {
    await addTriangleNodes();
    await cv.click(...P.d);
    await connect(P.a, P.b);
    await connect(P.b, P.c);
    await cv.click(...P.c); // select 2 as the start
    await page.getByRole('button', { name: 'Help and adjacency list' }).click();
  }

  test('while BFS runs, vertices show their distance from the start; undiscovered ones are blank', async ({ page }) => {
    await build(page);
    await run(page);
    await expect
      .poll(() => canvasLabels(page))
      .toEqual([
        { id: '0', label: '', showing: 'label' },
        { id: '1', label: '', showing: 'label' },
        { id: '2', label: '0', showing: 'label' }, // the start
        { id: '3', label: '', showing: 'label' },
      ]);
    await update(page); // pop 2 → discovers 1 at distance 1
    await update(page); // pop 1 → discovers 0 at distance 2
    const after = await canvasLabels(page);
    expect(after.map((n) => n.label)).toEqual(['2', '1', '0', '']); // 3 is unreachable: stays blank
  });

  test('the queue shows distances too, blank for vertices not found yet', async ({ page }) => {
    await build(page);
    await run(page);
    await update(page); // queue: 1 (distance 1); about to push 0
    const labels = await page
      .locator('#queue-strip .q-node:not(.exiting)')
      .evaluateAll((els) => els.map((el) => [el.querySelector('.q-index')!.textContent, el.querySelector('.q-label')!.textContent]));
    expect(labels).toEqual([
      ['1', '1'],
      ['0', ''],
    ]);
    await expect(strip(page).getByRole('listitem').first()).toHaveAttribute('aria-label', '1, distance 1, next to be popped');
  });

  test('hovering the queue smoothly switches every vertex back to its id, and leaving switches back', async ({ page }) => {
    await build(page);
    await run(page);
    await expect.poll(async () => (await canvasLabels(page))[2].showing).toBe('label');

    await strip(page).hover();
    await expect(cv.canvas).toHaveClass(/peek-ids/);
    // A CSS transition is fading the labels (not an instant swap).
    const fading = await cv.node(2).locator('.node-index').evaluate((el) =>
      el.getAnimations().some((a) => (a as CSSTransition).transitionProperty === 'opacity'),
    );
    expect(fading).toBe(true);
    await expect.poll(async () => (await canvasLabels(page)).map((n) => n.showing)).toEqual(['id', 'id', 'id', 'id']);
    // The queue's own circles switch too.
    await expect
      .poll(() => strip(page).locator('.q-index').first().evaluate((el) => Number(getComputedStyle(el).opacity)))
      .toBe(1);

    await cv.move(...P.d); // pointer leaves the queue
    await expect(cv.canvas).not.toHaveClass(/peek-ids/);
    await expect.poll(async () => (await canvasLabels(page))[2].showing).toBe('label');
  });

  test('keyboard focus on the queue also shows the ids', async ({ page }) => {
    await build(page);
    await run(page);
    await strip(page).focus();
    await expect(cv.canvas).toHaveClass(/peek-ids/);
    await page.getByRole('button', { name: 'Stop', exact: true }).focus();
    await expect(cv.canvas).not.toHaveClass(/peek-ids/);
  });

  test('stopping shows the ids again', async ({ page }) => {
    await build(page);
    await run(page);
    await strip(page).hover();
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(cv.canvas).not.toHaveClass(/sim-labels|peek-ids/);
    await expect.poll(async () => (await canvasLabels(page)).map((n) => n.showing)).toEqual(['id', 'id', 'id', 'id']);
    expect((await canvasLabels(page)).map((n) => n.label)).toEqual(['', '', '', '']);
  });

  test('outside a run, vertices show only their ids', async ({ page }) => {
    await build(page);
    await expect(cv.node(2)).toHaveText('2');
    expect((await canvasLabels(page)).every((n) => n.showing === 'id')).toBe(true);
  });

  test.describe('with reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('switches instantly', async ({ page }) => {
      await build(page);
      await run(page);
      const duration = await cv.node(2).locator('.sim-label').evaluate((el) => getComputedStyle(el).transitionDuration);
      expect(duration).toBe('0s');
    });
  });
});

test.describe('algorithm simulation (DFS)', () => {
  const run = (page: Page) => page.getByRole('button', { name: 'Run', exact: true }).click();
  const update = (page: Page) => page.getByRole('button', { name: 'Update', exact: true }).click();
  const message = (page: Page) => page.locator('#message');
  const stackCard = (page: Page) => page.getByRole('region', { name: 'Recursion stack' });
  const stackStrip = (page: Page) => page.getByRole('list', { name: 'Recursion stack, top first' });
  const radio = (page: Page, name: string) => page.getByRole('radio', { name, exact: true });

  const WHITE = 'rgb(255, 255, 255)';
  const YELLOW = 'rgb(242, 169, 0)';
  const GREEN = 'rgb(47, 158, 68)';
  const strokeOf = (id: number) => cv.node(id).locator('circle').evaluate((c) => getComputedStyle(c).stroke);

  /**
   * Arcs 0 → 1 → 2, 2 → 0, 0 → 2, 3 → 1, 3 → 4. DFS from 0 (CLRS):
   * 0 (1,6) → 1 (2,5) → 2 (3,4); 2 → 0 backward; 0 → 2 forward; then a new tree at
   * 3 (7,10): 3 → 1 crossed, 3 → 4 (8,9) a tree edge.
   */
  const S: Array<[number, number]> = [
    [150, 150],
    [450, 150],
    [300, 420],
    [640, 260],
    [800, 440],
  ];
  const ARCS: Array<[number, number]> = [
    [0, 1],
    [1, 2],
    [2, 0],
    [0, 2],
    [3, 1],
    [3, 4],
  ];

  /** Builds the graph (in directed mode), then leaves the switches as given. */
  async function build(page: Page, { directed = false, weighted = false, arcs = ARCS, spots = S } = {}): Promise<void> {
    for (const p of spots) await cv.click(...p);
    await page.locator('label[for="mode-directed"]').click();
    for (const [a, b] of arcs) await connect(spots[a], spots[b]);
    if (!directed) await page.locator('label[for="mode-undirected"]').click();
    if (weighted) await page.locator('label[for="weights-on"]').click();
    await page.getByRole('combobox', { name: 'Algorithm' }).click();
    await page.getByRole('option', { name: 'Depth-first search' }).click();
  }

  async function steps(page: Page, n: number): Promise<void> {
    for (let i = 0; i < n; i++) await update(page);
  }

  /** Each canvas vertex's label (in id order). */
  const labels = (page: Page) =>
    page.locator('#canvas [data-node-id]').evaluateAll((nodes) => nodes.map((g) => g.querySelector('.sim-label')!.textContent));

  /** Edge "a>b" → whether it is drawn dashed, and its tag. */
  const edgeLook = (page: Page) =>
    page.locator('#canvas .edge').evaluateAll((edges) =>
      Object.fromEntries(
        edges.map((e) => {
          const g = e as SVGGElement;
          const line = g.querySelector('.edge-line')!;
          return [
            `${g.dataset.edgeA}>${g.dataset.edgeB}`,
            { dashed: getComputedStyle(line).strokeDasharray !== 'none', tag: g.dataset.tag ?? '' },
          ];
        }),
      ),
    );

  /** Stack strip tokens: 'ends' (+ '<' pop lit, '>' push lit), then ids (+ '*' top, '?' incoming, '~' running). */
  const stackTokens = (page: Page) =>
    page.locator('#stack-strip > [data-key]:not(.exiting)').evaluateAll((els) =>
      els.map((el) => {
        if ((el as HTMLElement).dataset.key === 'ends') {
          return (
            'ends' +
            (el.querySelector('.q-pop')!.classList.contains('active') ? '<' : '') +
            (el.querySelector('.q-push')!.classList.contains('active') ? '>' : '')
          );
        }
        return (
          el.querySelector('.q-index')!.textContent! +
          (el.classList.contains('front') ? '*' : '') +
          (el.classList.contains('incoming') ? '?' : '') +
          (el.classList.contains('running') ? '~' : '')
        );
      }),
    );

  test('is offered in the picker', async ({ page }) => {
    await build(page);
    await expect(page.getByRole('combobox', { name: 'Algorithm' })).toHaveText('Depth-first search');
  });

  test('Run forces the directed, unweighted view and locks both switches; Stop restores them', async ({ page }) => {
    await build(page, { directed: false, weighted: true });
    await run(page);
    await expect(message(page)).toHaveText('DFS from 0. Time 0. Press Update to discover 0.');
    await expect(radio(page, 'Directed')).toBeChecked();
    await expect(radio(page, 'Unweighted')).toBeChecked();
    for (const name of ['Undirected', 'Directed', 'Unweighted', 'Weighted']) await expect(radio(page, name)).toBeDisabled();
    await expect(cv.canvas).toHaveClass(/directed/);
    await expect(cv.edge(2, 0)).toBeVisible(); // both arcs between 0 and 2 are drawn
    await expect(cv.edge(0, 2)).toBeVisible();
    await expect(cv.edge(0, 1).locator('.edge-weight')).toBeHidden();

    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(radio(page, 'Undirected')).toBeChecked();
    await expect(radio(page, 'Weighted')).toBeChecked();
    for (const name of ['Undirected', 'Directed', 'Unweighted', 'Weighted']) await expect(radio(page, name)).toBeEnabled();
    await expect(cv.canvas).not.toHaveClass(/directed/);
  });

  test('every edge starts dashed; explored edges turn solid', async ({ page }) => {
    await build(page);
    await run(page);
    const before = await edgeLook(page);
    expect(Object.keys(before)).toHaveLength(6);
    expect(Object.values(before).every((e) => e.dashed)).toBe(true);

    await steps(page, 2); // discover 0, explore 0 → 1
    const after = await edgeLook(page);
    expect(after['0>1'].dashed).toBe(false);
    expect(after['1>2'].dashed).toBe(false); // the white edge, explored next: drawn solid white
    expect(['2>0', '0>2', '3>1', '3>4'].every((k) => after[k].dashed)).toBe(true);
    await expect(cv.edge(0, 1).locator('.edge-line')).toHaveCSS('opacity', '1');
    await expect(cv.edge(3, 4).locator('.edge-line')).not.toHaveCSS('opacity', '1'); // faded too
  });

  test('white marks the vertex being considered and the next edge; running is yellow, finished green', async ({ page }) => {
    await build(page);
    await run(page);
    // Before the first step: 0 is about to be discovered.
    expect(await strokeOf(0)).toBe(WHITE);
    await expect(cv.canvas.locator('.edge.sim-active')).toHaveCount(0);

    await steps(page, 1); // discover 0 → next: explore 0 → 1
    expect(await strokeOf(0)).toBe(WHITE);
    await expect(cv.edge(0, 1).locator('.edge-line')).toHaveCSS('stroke', WHITE);

    await steps(page, 2); // 0 → 1, 1 → 2 → next: explore 2 → 0
    expect(await strokeOf(2)).toBe(WHITE);
    expect(await strokeOf(1)).toBe(YELLOW); // still running
    expect(await strokeOf(0)).toBe(YELLOW);
    await expect(cv.edge(2, 0).locator('.edge-line')).toHaveCSS('stroke', WHITE);
    await expect(cv.edge(0, 1).locator('.edge-line')).not.toHaveCSS('stroke', WHITE);

    await steps(page, 2); // 2 → 0 (backward), finish 2 → next: finish 1
    expect(await strokeOf(2)).toBe(GREEN);
    expect(await strokeOf(1)).toBe(WHITE);
    expect(await strokeOf(0)).toBe(YELLOW);
    await expect(cv.canvas.locator('.edge.sim-active')).toHaveCount(0); // finishing travels no edge
    await expect(message(page)).toHaveText('Finished 2 at time 4. Stack: 1, 0 (top first).');
  });

  test('vertices show "discovery,finish" times; undiscovered ones are blank', async ({ page }) => {
    await build(page);
    await run(page);
    expect(await labels(page)).toEqual(['', '', '', '', '']);
    await expect(cv.node(0).locator('.sim-label')).toHaveCSS('opacity', '1');
    await steps(page, 3);
    expect(await labels(page)).toEqual(['1,', '2,', '3,', '', '']);
    await steps(page, 2); // backward edge, finish 2
    expect(await labels(page)).toEqual(['1,', '2,', '3,4', '', '']);
    await steps(page, 8);
    expect(await labels(page)).toEqual(['1,6', '2,5', '3,4', '7,10', '8,9']);
    // A two-digit label still fits inside its circle.
    const fits = await cv.node(3).evaluate((g) => {
      const text = g.querySelector('.sim-label')!.getBoundingClientRect();
      const circle = g.querySelector('circle')!.getBoundingClientRect();
      return text.width < circle.width - 8;
    });
    expect(fits).toBe(true);
  });

  test('explored edges are labelled forward, backward and crossed; tree edges stay plain', async ({ page }) => {
    await build(page);
    await run(page);
    await steps(page, 4); // … 2 → 0
    expect((await edgeLook(page))['2>0'].tag).toBe('backward');
    await expect(cv.edge(2, 0).locator('.edge-tag')).toBeVisible();
    await expect(cv.edge(2, 0).locator('.edge-tag')).toHaveText('backward');
    await expect(message(page)).toHaveText(
      '2 → 0 is a backward edge: 0 is still running (an ancestor of 2). Stack: 2, 1, 0 (top first).',
    );

    await steps(page, 9);
    await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeVisible();
    expect(await edgeLook(page)).toEqual({
      '0>1': { dashed: false, tag: '' },
      '1>2': { dashed: false, tag: '' },
      '2>0': { dashed: false, tag: 'backward' },
      '0>2': { dashed: false, tag: 'forward' },
      '3>1': { dashed: false, tag: 'crossed' },
      '3>4': { dashed: false, tag: '' },
    });
    // Edges are drawn in arc order: 0 → 2 (forward) before 2 → 0 (backward).
    await expect(cv.canvas.locator('.edge-tag:visible')).toHaveText(['forward', 'backward', 'crossed']);
    await expect(message(page)).toHaveText(
      'DFS finished at time 10: 5 vertices in 2 trees; 3 tree, 1 backward, 1 forward, 1 crossed edges. ' +
        'A backward edge means a cycle, so there is no topological order. Press Finish.',
    );
  });

  test('Finish ends the run: dashes, tags and times are cleared and the switches restored', async ({ page }) => {
    await build(page);
    await run(page);
    await steps(page, 13);
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
    await expect(cv.canvas.locator('.sim-unexplored, .sim-explored, .sim-running, .sim-done, [data-tag]')).toHaveCount(0);
    expect(Object.values(await edgeLook(page)).every((e) => !e.dashed)).toBe(true);
    await expect(radio(page, 'Undirected')).toBeChecked();
    await expect(cv.node(3)).toHaveText(/^3/);
  });

  test('starts from the selected node', async ({ page }) => {
    await build(page);
    await cv.click(...S[3]);
    await run(page);
    await expect(message(page)).toHaveText('DFS from 3. Time 0. Press Update to discover 3.');
    expect(await strokeOf(3)).toBe(WHITE);
  });

  test('BFS still draws every edge solid', async ({ page }) => {
    await build(page);
    await page.getByRole('combobox', { name: 'Algorithm' }).click();
    await page.getByRole('option', { name: 'Breadth-first search' }).click();
    await run(page);
    await update(page);
    expect(Object.values(await edgeLook(page)).every((e) => !e.dashed)).toBe(true);
    await expect(radio(page, 'Undirected')).toBeChecked(); // BFS keeps the chosen direction
  });

  test.describe('topological sort', () => {
    /** The graph above without its back edge 2 → 0: acyclic. Finishes 0 (1,6) 1 (2,5) 2 (3,4) 3 (7,10) 4 (8,9). */
    const DAG = ARCS.filter(([a, b]) => !(a === 2 && b === 0));
    const DAG_STEPS = 2 + 5 + 5; // roots + edges + finishes
    const topoBtn = (page: Page) => page.getByRole('button', { name: 'Topological sort' });
    const finishBtn = (page: Page) => page.getByRole('button', { name: 'Finish', exact: true });
    const centre = (id: number) =>
      cv.node(id).evaluate((g) => {
        const r = g.querySelector('circle')!.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
    /** Waits until no vertex is moving any more, then returns their centres. */
    async function settled(ids: number[]) {
      let last = '';
      await expect
        .poll(async () => {
          const now = JSON.stringify(await Promise.all(ids.map(centre)));
          const same = now === last;
          last = now;
          return same;
        })
        .toBe(true);
      return Promise.all(ids.map(centre));
    }
    const edgeShape = (a: number, b: number) =>
      cv.edge(a, b).evaluate((g) => {
        const line = g.querySelector('.edge-line') as SVGGraphicsElement;
        const box = line.getBBox();
        return {
          tag: line.tagName,
          spine: g.classList.contains('sim-spine'),
          stroke: getComputedStyle(line).stroke,
          top: box.y,
          bottom: box.y + box.height,
        };
      });

    async function runToEnd(page: Page, arcs = DAG, n = DAG_STEPS): Promise<void> {
      await build(page, { arcs });
      await run(page);
      await steps(page, n);
    }

    test('appears next to Finish after the last Update', async ({ page }) => {
      await build(page, { arcs: DAG });
      await run(page);
      await steps(page, DAG_STEPS - 1);
      await expect(topoBtn(page)).toBeHidden();
      await update(page); // the last step
      await expect(finishBtn(page)).toBeVisible();
      await expect(topoBtn(page)).toBeVisible();
      await expect(topoBtn(page)).toBeEnabled();
      const [t, f] = await Promise.all([topoBtn(page).boundingBox(), finishBtn(page).boundingBox()]);
      expect(t!.x + t!.width).toBeLessThanOrEqual(f!.x); // right before Finish…
      expect(Math.abs(t!.y - f!.y)).toBeLessThan(1); // …on the same line
      await expect(message(page)).toContainText('No backward edge, so the graph is acyclic: press Topological sort, or Finish.');
    });

    test('is greyed out when DFS found a backward edge (a cycle)', async ({ page }) => {
      await runToEnd(page, ARCS, 13);
      await expect(topoBtn(page)).toBeVisible();
      await expect(topoBtn(page)).toBeDisabled();
      await expect(topoBtn(page)).toHaveAttribute('title', /cycle/);
      expect(Number(await topoBtn(page).evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(0.7);
    });

    test('glides the vertices into a line by decreasing finish time and turns auto-layout off', async ({ page }) => {
      await build(page, { arcs: DAG });
      await page.getByRole('button', { name: /Auto-layout/ }).click(); // on (after building, so the clicks hit)
      await run(page);
      await steps(page, DAG_STEPS);
      const before = await settled([0, 1, 2, 3, 4]);
      await topoBtn(page).click();
      await expect(page.getByRole('button', { name: /Auto-layout/ })).toHaveAttribute('aria-pressed', 'false');
      await expect(cv.canvas).toHaveClass(/arc-diagram/);
      await page.waitForTimeout(200);
      const during = await Promise.all([0, 1, 2, 3, 4].map(centre));
      const after = await settled([3, 4, 0, 1, 2]); // the order
      // Smooth: part-way there after 200 ms, not jumped.
      const moved = (i: number) => Math.hypot(during[i].x - before[i].x, during[i].y - before[i].y);
      const total = (i: number) => {
        const order = [3, 4, 0, 1, 2];
        const end = after[order.indexOf(i)];
        return Math.hypot(end.x - before[i].x, end.y - before[i].y);
      };
      const far = [0, 1, 2, 3, 4].sort((a, b) => total(b) - total(a))[0];
      expect(moved(far)).toBeGreaterThan(1);
      expect(moved(far)).toBeLessThan(total(far) - 1);
      // Left to right, on one line.
      for (let i = 1; i < after.length; i++) {
        expect(after[i].x).toBeGreaterThan(after[i - 1].x + 40);
        expect(after[i].y).toBeCloseTo(after[0].y, 0);
      }
      await expect(message(page)).toHaveText(
        'Topological order (decreasing finish time): 3, 4, 0, 1, 2. Every edge points left to right: ' +
          'tree edges in white, forward edges arc above, crossed edges below. Press Finish or Stop to end.',
      );
    });

    test('tree edges lie white on the line; the others are half circles, forward above and crossed below', async ({ page }) => {
      await runToEnd(page);
      await topoBtn(page).click();
      const [, , c0, c1, c2] = await settled([3, 4, 0, 1, 2]);
      const rowY = (await centre(0)).y - (await cv.canvas.boundingBox())!.y;
      for (const [a, b] of [
        [3, 4],
        [0, 1],
        [1, 2],
      ]) {
        const e = await edgeShape(a, b);
        expect(e).toMatchObject({ tag: 'line', spine: true, stroke: WHITE });
        expect(e.top).toBeCloseTo(rowY, 0);
        expect(e.bottom).toBeCloseTo(rowY, 0);
      }
      // 0 → 2 skips over 1: a half circle above, its height half the distance between them.
      const forward = await edgeShape(0, 2);
      expect(forward).toMatchObject({ tag: 'path', spine: false });
      expect(forward.stroke).not.toBe(WHITE);
      expect(forward.bottom).toBeLessThanOrEqual(rowY + 1);
      expect(rowY - forward.top).toBeCloseTo((c2.x - c0.x) / 2, -1);
      await expect(cv.edge(0, 2).locator('.edge-tag')).toHaveText('forward');
      // 3 → 1 (crossed) arcs below.
      const crossed = await edgeShape(3, 1);
      expect(crossed.tag).toBe('path');
      expect(crossed.top).toBeGreaterThanOrEqual(rowY - 1);
      expect(crossed.bottom).toBeGreaterThan(rowY + 50);
      expect(c1.x).toBeGreaterThan(c0.x);
    });

    test('the run goes on: Finish (or Stop) ends it, edges straighten and the vertices stay', async ({ page }) => {
      await runToEnd(page);
      await topoBtn(page).click();
      const placed = await settled([0, 1, 2, 3, 4]);
      await expect(finishBtn(page)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeHidden();
      await finishBtn(page).click();
      await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
      await expect(topoBtn(page)).toBeHidden();
      await expect(cv.canvas).not.toHaveClass(/arc-diagram/);
      await expect.poll(() => cv.canvas.locator('.edge path.edge-line').count()).toBe(0);
      await expect(cv.canvas.locator('.sim-spine')).toHaveCount(0);
      expect(await Promise.all([0, 1, 2, 3, 4].map(centre))).toEqual(placed);
    });

    test('turning auto-layout on leaves the line; Topological sort brings it back', async ({ page }) => {
      await runToEnd(page);
      await topoBtn(page).click();
      await settled([0, 1, 2, 3, 4]);
      await page.getByRole('button', { name: /Auto-layout/ }).click();
      await expect(cv.canvas).not.toHaveClass(/arc-diagram/);
      await expect(cv.canvas.locator('.sim-spine')).toHaveCount(0);
      await expect(message(page)).toHaveText(
        'Auto-layout on: left the topological order. Press Topological sort to line the vertices up again.',
      );
      await expect.poll(() => cv.canvas.locator('.edge path.edge-line').count()).toBe(0); // straight again
      await expect(finishBtn(page)).toBeVisible(); // still running
      await expect(topoBtn(page)).toBeEnabled();

      await topoBtn(page).click();
      await expect(cv.canvas).toHaveClass(/arc-diagram/);
      await expect(page.getByRole('button', { name: /Auto-layout/ })).toHaveAttribute('aria-pressed', 'false');
      const again = await settled([3, 4, 0, 1, 2]);
      for (let i = 1; i < again.length; i++) expect(again[i].x).toBeGreaterThan(again[i - 1].x);
    });

    test.describe('with reduced motion', () => {
      test.use({ reducedMotion: 'reduce' });

      test('jumps straight into the line', async ({ page }) => {
        await runToEnd(page);
        await topoBtn(page).click();
        const now = await Promise.all([3, 4, 0, 1, 2].map(centre));
        for (let i = 1; i < now.length; i++) expect(now[i].x).toBeGreaterThan(now[i - 1].x);
        await expect(cv.edge(0, 2).locator('path.edge-line')).toHaveCount(1);
      });
    });

    test.describe('on a phone-sized screen', () => {
      test.use({ viewport: { width: 390, height: 800 } });

      test('a line that does not fit wraps into rows, left to right then top to bottom', async ({ page }) => {
        // A chain 0 → 1 → … → 7: DFS from 0 finishes them in reverse, so the order is 0 … 7.
        const spots: Array<[number, number]> = [];
        for (let i = 0; i < 8; i++) spots.push([60 + (i % 4) * 90, 260 + Math.floor(i / 4) * 170]);
        const chain = Array.from({ length: 7 }, (_, i): [number, number] => [i, i + 1]);
        await build(page, { arcs: chain, spots });
        await run(page);
        await steps(page, 1 + 7 + 8);
        await topoBtn(page).click();
        const pos = await settled([0, 1, 2, 3, 4, 5, 6, 7]);
        const rows = [...new Set(pos.map((p) => Math.round(p.y)))];
        expect(rows.length).toBeGreaterThan(1);
        for (let i = 1; i < pos.length; i++) {
          const sameRow = Math.abs(pos[i].y - pos[i - 1].y) < 1;
          if (sameRow) expect(pos[i].x).toBeGreaterThan(pos[i - 1].x);
          else expect(pos[i].y).toBeGreaterThan(pos[i - 1].y); // continues on the next row down
        }
        // Clear of the canvas toolbar, and nothing scrolls sideways (the header wraps instead).
        const toolbarBottom = (await page.locator('.canvas-toolbar').boundingBox())!;
        expect(Math.min(...pos.map((p) => p.y)) - 20).toBeGreaterThan(toolbarBottom.y + toolbarBottom.height);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await expect(finishBtn(page)).toBeInViewport();
      });
    });
  });

  test.describe('recursion stack card', () => {
    test.beforeEach(async ({ page }) => {
      await page.getByRole('button', { name: 'Help and adjacency list' }).click();
    });

    test('appears at the bottom of the panel only while DFS runs (BFS shows its queue instead)', async ({ page }) => {
      await build(page);
      await expect(stackCard(page)).toBeHidden();
      await run(page);
      await expect(stackCard(page)).toBeVisible();
      await expect(page.getByRole('region', { name: 'Queue' })).toBeHidden();
      const tops = await page.locator('.info-card:not([hidden])').evaluateAll((cards) =>
        cards.map((c) => c.getBoundingClientRect().top),
      );
      expect(tops[tops.length - 1]).toBe(Math.max(...tops)); // the stack is the last card
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      await expect(stackCard(page)).toBeHidden();
    });

    test('pop and push arrows share the left end; the top comes first; the next push is greyed', async ({ page }) => {
      await build(page);
      await run(page);
      expect(await stackTokens(page)).toEqual(['ends>', '0?']); // about to push 0
      await update(page);
      expect(await stackTokens(page)).toEqual(['ends>', '1?', '0*']); // 0 → 1 pushes 1 next
      await steps(page, 2);
      expect(await stackTokens(page)).toEqual(['ends', '2*', '1~', '0~']); // 2 → 0: no push or pop
      await update(page);
      expect(await stackTokens(page)).toEqual(['ends<', '2*', '1~', '0~']); // finishing 2 pops it

      // Laid out left to right on one line: arrows, then the top, down to the bottom.
      await page
        .locator('#stack-strip')
        .evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
      const boxes = await page.locator('#stack-strip > [data-key]').evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, mid: r.top + r.height / 2 };
        }),
      );
      for (let i = 1; i < boxes.length; i++) {
        expect(boxes[i].left).toBeGreaterThanOrEqual(boxes[i - 1].right - 0.5);
        expect(Math.abs(boxes[i].mid - boxes[0].mid)).toBeLessThan(2);
      }
      // The pop arrow sits above the push arrow, and the lit one is drawn at full strength.
      const arrows = await page.locator('#stack-strip .q-ends .q-arrow').evaluateAll((els) =>
        els.map((el) => ({ top: el.getBoundingClientRect().top, opacity: Number(getComputedStyle(el).opacity) })),
      );
      expect(arrows[0].top).toBeLessThan(arrows[1].top);
      await expect.poll(() => page.locator('#stack-strip .q-pop').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
      expect(arrows[1].opacity).toBeLessThan(0.6);
    });

    test('stack vertices match the canvas: white top, yellow below, green when popped', async ({ page }) => {
      await build(page);
      await run(page);
      await steps(page, 4); // stack 2, 1, 0; next: finish 2
      const border = (sel: string) =>
        page.locator(sel).first().evaluate((el) => getComputedStyle(el).borderTopColor);
      await expect.poll(() => border('#stack-strip .q-node.front')).toBe(WHITE);
      await expect.poll(() => border('#stack-strip .q-node.running')).toBe(YELLOW);

      await update(page); // finish 2: it slides out of the top, green
      const popped = page.locator('#stack-strip > .exiting');
      await expect(popped).toHaveCount(1);
      await expect(popped.locator('.q-index')).toHaveText('2');
      await expect(popped).toHaveClass(/popped/);
      await expect(popped).toHaveCount(0, { timeout: 2000 });
      expect(await stackTokens(page)).toEqual(['ends<', '1*', '0~']);
    });

    test('shows the times in the circles; hovering the stack shows the ids, here and on the canvas', async ({ page }) => {
      await build(page);
      await run(page);
      await steps(page, 3);
      const stackLabels = await page
        .locator('#stack-strip .q-node:not(.exiting)')
        .evaluateAll((els) => els.map((el) => el.querySelector('.q-label')!.textContent));
      expect(stackLabels).toEqual(['3,', '2,', '1,']);
      await expect(stackStrip(page).getByRole('listitem').first()).toHaveAttribute('aria-label', '2, discovered at 3, top');

      await stackStrip(page).hover();
      await expect(cv.canvas).toHaveClass(/peek-ids/);
      await expect
        .poll(() => cv.node(2).locator('.node-index').evaluate((el) => Number(getComputedStyle(el).opacity)))
        .toBe(1);
      await expect
        .poll(() => stackStrip(page).locator('.q-index').first().evaluate((el) => Number(getComputedStyle(el).opacity)))
        .toBe(1);
      await cv.move(...S[4]);
      await expect(cv.canvas).not.toHaveClass(/peek-ids/);
    });

    test('says the stack is empty once DFS is done', async ({ page }) => {
      await build(page);
      await run(page);
      await steps(page, 13);
      await expect(stackStrip(page)).toBeHidden();
      await expect(page.locator('#stack-empty')).toBeVisible();
    });
  });
});

test.describe('status bar (auto-hiding message box)', () => {
  const bar = (page: Page) => page.locator('#message');

  /** Where the bar is relative to the canvas: 'shown' (fully inside), 'hidden' (fully below), or 'moving'. */
  const position = (page: Page) =>
    page.evaluate(() => {
      const b = document.querySelector('#message')!.getBoundingClientRect();
      const c = document.querySelector('#canvas')!.getBoundingClientRect();
      if (b.bottom <= c.bottom - 8) return 'shown';
      if (b.top >= c.bottom) return 'hidden';
      return 'moving';
    });

  test.beforeEach(async ({ page }) => {
    // Control the 5 s countdown; the slide animations still run in real time.
    await page.clock.install();
    await page.goto('index.html');
  });

  test('slides down out of view after 5 s without a new message', async ({ page }) => {
    await expect.poll(() => position(page)).toBe('shown');
    await page.clock.runFor(4900);
    await expect.poll(() => position(page)).toBe('shown');
    await page.clock.runFor(200);
    await expect(bar(page)).toHaveClass(/is-hidden/);
    await expect.poll(() => position(page), { timeout: 3000 }).toBe('hidden');
    // Out of view, without making the page scroll.
    expect(await page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight)).toBe(0);
    await expect(bar(page)).toHaveText('Click empty space to add a node.'); // the text is kept
  });

  test('hides slowly and reappears quickly', async ({ page }) => {
    const durations = await bar(page).evaluate((el) => {
      const shown = getComputedStyle(el).transitionDuration;
      el.classList.add('is-hidden');
      const hiding = getComputedStyle(el).transitionDuration;
      el.classList.remove('is-hidden');
      return { shown: parseFloat(shown), hiding: parseFloat(hiding) };
    });
    expect(durations.hiding).toBeGreaterThanOrEqual(0.6); // slow…
    expect(durations.shown).toBeLessThanOrEqual(0.3); // …quick back
    expect(await bar(page).evaluate((el) => getComputedStyle(el).transitionTimingFunction)).toContain('cubic-bezier');
  });

  test('a new message brings it back', async ({ page }) => {
    await page.clock.runFor(5100);
    await expect.poll(() => position(page), { timeout: 3000 }).toBe('hidden');
    await cv.click(...P.a);
    await expect(bar(page)).toHaveText('Added node 0.');
    await expect(bar(page)).not.toHaveClass(/is-hidden/);
    await expect.poll(() => position(page), { timeout: 1000 }).toBe('shown');
  });

  test('moving the mouse near where it hid brings it back, and it stays while the mouse is near', async ({ page }) => {
    await page.clock.runFor(5100);
    await expect.poll(() => position(page), { timeout: 3000 }).toBe('hidden');

    await cv.move(300, 300); // far from the bottom: nothing happens
    await expect(bar(page)).toHaveClass(/is-hidden/);

    const c = (await cv.canvas.boundingBox())!;
    await page.mouse.move(c.x + c.width / 2, c.y + c.height - 10); // just above where it hid
    await expect(bar(page)).not.toHaveClass(/is-hidden/);
    await expect.poll(() => position(page), { timeout: 1000 }).toBe('shown');

    await page.clock.runFor(10_000); // still near: stays up
    await expect(bar(page)).not.toHaveClass(/is-hidden/);

    await cv.move(300, 300); // move away: hides 5 s later
    await page.clock.runFor(5100);
    await expect(bar(page)).toHaveClass(/is-hidden/);
  });

  test('stays up while hovered, and hides 5 s after the mouse leaves', async ({ page }) => {
    await bar(page).hover();
    await page.clock.runFor(15_000);
    await expect(bar(page)).not.toHaveClass(/is-hidden/);
    await cv.move(300, 300);
    await page.clock.runFor(4900);
    await expect(bar(page)).not.toHaveClass(/is-hidden/);
    await page.clock.runFor(200);
    await expect(bar(page)).toHaveClass(/is-hidden/);
  });

  test('every part of the app reports through it (e.g. BFS steps)', async ({ page }) => {
    await cv.click(...P.a);
    await page.clock.runFor(5100);
    await expect(bar(page)).toHaveClass(/is-hidden/);
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(bar(page)).toHaveText('BFS from 0. Queue: 0. Press Update to pop 0.');
    await expect(bar(page)).not.toHaveClass(/is-hidden/);
  });

  /**
   * Shows a new message (by pressing Run: a much longer message than the start-up one) in
   * the same tick as it starts sampling, then records the bar's width every frame.
   */
  async function widthsWhileShowing(page: Page): Promise<number[]> {
    return page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const bar = document.querySelector('#message')!;
          const widths: number[] = [];
          (document.querySelector('#run-btn') as HTMLButtonElement).click();
          const t0 = performance.now();
          const frame = () => {
            widths.push(bar.getBoundingClientRect().width);
            if (performance.now() - t0 < 500) requestAnimationFrame(frame);
            else resolve(widths);
          };
          frame();
        }),
    );
  }

  test('a new message resizes the bar smoothly, not instantly', async ({ page }) => {
    await cv.click(...P.a); // "Added node 0." — short
    await page.waitForTimeout(400); // let that change settle
    const start = await bar(page).evaluate((el) => el.getBoundingClientRect().width);
    const widths = await widthsWhileShowing(page);
    const end = widths[widths.length - 1];
    expect(end).toBeGreaterThan(start + 100); // the new message is much longer
    // In between, the bar passes through intermediate widths, growing steadily.
    const between = widths.filter((w) => w > start + 2 && w < end - 2);
    expect(between.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1] - 0.5);
    // Once settled, the bar is exactly as wide as its text needs.
    const natural = await bar(page).evaluate((el) => {
      const text = el.querySelector('.message-text')!;
      const cs = getComputedStyle(el);
      return text.getBoundingClientRect().width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 2;
    });
    expect(Math.abs(end - natural)).toBeLessThan(1.5);
  });

  test('while resizing, the text is laid out at its final size from the start; the bar clips the rest', async ({ page }) => {
    await cv.click(...P.a); // short message
    await page.waitForTimeout(400);
    const frames = await page.evaluate(
      () =>
        new Promise<Array<{ textW: number; textH: number; barW: number }>>((resolve) => {
          const bar = document.querySelector('#message')!;
          const text = bar.querySelector('.message-text')!;
          const frames: Array<{ textW: number; textH: number; barW: number }> = [];
          (document.querySelector('#run-btn') as HTMLButtonElement).click(); // much longer message
          const t0 = performance.now();
          const frame = () => {
            const t = text.getBoundingClientRect();
            frames.push({ textW: t.width, textH: t.height, barW: bar.getBoundingClientRect().width });
            if (performance.now() - t0 < 500) requestAnimationFrame(frame);
            else resolve(frames);
          };
          frame();
        }),
    );
    const final = frames[frames.length - 1];
    const lineHeight = await page.locator('#message .message-text').evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
    expect(final.textH).toBeLessThan(lineHeight * 1.5); // the final message fits on one line
    expect(frames.some((f) => f.barW < final.barW - 20)).toBe(true); // the bar really was narrower for a while
    for (const f of frames) {
      expect(Math.abs(f.textH - final.textH)).toBeLessThan(1); // never wraps onto a second line
      expect(Math.abs(f.textW - final.textW)).toBeLessThan(1.5); // laid out at its final width throughout
    }
    // Whatever doesn't fit yet is clipped by the bar.
    expect(await page.locator('#message').evaluate((el) => getComputedStyle(el).overflow)).toBe('hidden');
  });

  test.describe('on a narrow screen', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('a message that wraps at its final size keeps exactly that wrapping while resizing', async ({ page }) => {
      await cv.click(80, 300);
      await page.waitForTimeout(400);
      const frames = await page.evaluate(
        () =>
          new Promise<number[]>((resolve) => {
            const text = document.querySelector('#message .message-text')!;
            const heights: number[] = [];
            (document.querySelector('#run-btn') as HTMLButtonElement).click();
            const t0 = performance.now();
            const frame = () => {
              heights.push(text.getBoundingClientRect().height);
              if (performance.now() - t0 < 500) requestAnimationFrame(frame);
              else resolve(heights);
            };
            frame();
          }),
      );
      const lineHeight = await page.locator('#message .message-text').evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
      const final = frames[frames.length - 1];
      expect(final).toBeGreaterThan(lineHeight * 1.5); // wraps at its final size on a phone…
      for (const h of frames) expect(Math.abs(h - final)).toBeLessThan(1); // …and the same throughout
      // Settled: back to normal, so it fits the screen.
      const box = (await page.locator('#message').boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    });
  });

  test('the new text fades in while the bar resizes', async ({ page }) => {
    await cv.click(...P.a);
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    const fading = await page
      .locator('#message .message-text')
      .evaluate((el) => el.getAnimations().some((a) => JSON.stringify((a.effect as KeyframeEffect).getKeyframes()).includes('opacity')));
    expect(fading).toBe(true);
  });

  test('messages arriving mid-resize continue smoothly from the current size', async ({ page }) => {
    await cv.click(...P.a);
    await page.waitForTimeout(400);
    const widths = await page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const bar = document.querySelector('#message')!;
          const widths: number[] = [];
          (document.querySelector('#run-btn') as HTMLButtonElement).click(); // long message
          let n = 0;
          const frame = () => {
            widths.push(bar.getBoundingClientRect().width);
            if (++n === 4) (document.querySelector('#stop-btn') as HTMLButtonElement).click(); // another message mid-way
            if (n < 40) requestAnimationFrame(frame);
            else resolve(widths);
          };
          frame();
        }),
    );
    // No jumps: consecutive frames never differ by more than a smooth step would.
    for (let i = 1; i < widths.length; i++) expect(Math.abs(widths[i] - widths[i - 1])).toBeLessThan(80);
  });

  test('a hidden bar slides in at its new size instead', async ({ page }) => {
    await page.clock.runFor(5100);
    await expect.poll(() => position(page), { timeout: 3000 }).toBe('hidden');
    await cv.click(...P.a);
    const resizing = await bar(page).evaluate((el) =>
      el.getAnimations().some((a) => JSON.stringify((a.effect as KeyframeEffect).getKeyframes()).includes('width')),
    );
    expect(resizing).toBe(false);
    await expect.poll(() => position(page), { timeout: 1000 }).toBe('shown');
  });

  test.describe('with reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('hides and shows without sliding', async ({ page }) => {
      expect(await bar(page).evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
      await page.clock.runFor(5100);
      await expect.poll(() => position(page)).toBe('hidden');
    });

    test('resizes instantly', async ({ page }) => {
      await cv.click(...P.a);
      await page.getByRole('button', { name: 'Run', exact: true }).click();
      expect(await bar(page).evaluate((el) => el.getAnimations().length)).toBe(0);
    });
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
    await page.touchscreen.tap(box.x + 80, box.y + 180); // below the (wrapped) toolbar
    await page.touchscreen.tap(box.x + 280, box.y + 320);
    await expect(cv.nodes).toHaveCount(2);

    await page.touchscreen.tap(box.x + 80, box.y + 180); // below the (wrapped) toolbar
    await page.touchscreen.tap(box.x + 280, box.y + 320);
    await expect(cv.edges).toHaveCount(1);
    // The panel opens within the screen, still floating over the canvas.
    await page.getByRole('button', { name: 'Help and adjacency list' }).tap();
    const panelBox = (await page.getByRole('complementary', { name: 'Help and adjacency list' }).boundingBox())!;
    expect(panelBox.x).toBeGreaterThanOrEqual(0);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(390);
    // ...and below the (wrapped) toolbar, so the Undirected/Directed switch stays reachable.
    const toolbar = (await page.locator('.canvas-toolbar').boundingBox())!;
    expect(panelBox.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height);
    await page.locator('label[for="mode-directed"]').tap();
    await expect(page.getByRole('radio', { name: 'Directed', exact: true })).toBeChecked();
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
    await expectAdjacency(page, '0: 1\n1: 0, 2\n2: 1, 3\n3: 2');
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
      await expectAdjacency(page, '0: 1, 3\n1: 0, 2\n2: 1, 3\n3: 0, 2');
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
