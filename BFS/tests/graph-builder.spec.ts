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
    await expect(picker(page).locator('option')).toHaveText(['Breadth-first search']);
    await expect(runBtn(page)).toBeVisible();
    await expect(updateBtn(page)).toBeHidden();
    await expect(stopBtn(page)).toBeHidden();
    const sel = (await picker(page).boundingBox())!;
    const run = (await runBtn(page).boundingBox())!;
    expect(sel.x + sel.width).toBeLessThanOrEqual(run.x); // picker left of Run
    expect(run.x + run.width).toBeGreaterThan(page.viewportSize()!.width - 40); // at the right edge
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
    await expect(page.locator('#message')).toHaveText('BFS from 0: press Update to take the first step.');

    // Forced unweighted, shown by the greyed-out switch.
    for (const radio of await weightRadios(page).all()) await expect(radio).toBeDisabled();
    await expect(page.getByRole('radio', { name: 'Unweighted', exact: true })).toBeChecked();
    expect(Number(await weightSwitch(page).evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(0.6);
    await expect(cv.edge(0, 1).locator('.edge-weight')).toBeHidden();
    // The direction switch and Clear are locked too.
    for (const radio of await directionRadios(page).all()) await expect(radio).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Clear graph' })).toBeDisabled();
  });

  test('Update steps through BFS: current white with its edges, finished green', async ({ page }) => {
    await buildPathAndIsland();
    await runBtn(page).click();

    await updateBtn(page).click();
    expect(await simState(page)).toEqual({ current: [0], done: [], edges: ['0-1'] });
    await expect(page.locator('#message')).toHaveText('Visiting 0: discovered 1. Queue: 1.');
    expect(await strokeOf(0)).toBe('rgb(255, 255, 255)');
    await expect(cv.edge(0, 1).locator('.edge-line')).toHaveCSS('stroke', 'rgb(255, 255, 255)');

    await updateBtn(page).click();
    expect(await simState(page)).toEqual({ current: [1], done: [0], edges: ['0-1', '1-2'] });
    expect(await strokeOf(0)).toBe('rgb(47, 158, 68)'); // green
    expect(await strokeOf(1)).toBe('rgb(255, 255, 255)');

    await updateBtn(page).click();
    expect(await simState(page)).toEqual({ current: [2], done: [0, 1], edges: ['1-2'] });
    await expect(cv.edge(0, 1).locator('.edge-line')).not.toHaveCSS('stroke', 'rgb(255, 255, 255)');
  });

  test('after the last step, Update becomes Finish; Finish ends the run and unlocks', async ({ page }) => {
    await page.locator('label[for="weights-on"]').click();
    await buildPathAndIsland();
    await runBtn(page).click();
    for (let i = 0; i < 3; i++) await updateBtn(page).click();
    await expect(updateBtn(page)).toBeVisible();
    await updateBtn(page).click(); // finishes vertex 2: nothing left

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
    await expect(page.locator('#message')).toHaveText('BFS from 2: press Update to take the first step.');
    await updateBtn(page).click();
    expect((await simState(page)).current).toEqual([2]);
  });

  test('directed: explores and highlights only outgoing edges', async ({ page }) => {
    await page.locator('label[for="mode-directed"]').click();
    await addTriangleNodes();
    await connect(P.a, P.b); // 0 → 1
    await connect(P.c, P.b); // 2 → 1 (cannot be followed from 1)
    await runBtn(page).click();
    await updateBtn(page).click(); // 0
    expect(await simState(page)).toEqual({ current: [0], done: [], edges: ['0-1'] });
    await expect(cv.edge(0, 1).locator('.edge-line')).toHaveCSS('marker-end', 'url("#arrow-active")');
    await updateBtn(page).click(); // 1 — has no outgoing edges
    expect(await simState(page)).toEqual({ current: [1], done: [0], edges: [] });
    await updateBtn(page).click();
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
