# BFS · Graph Builder

Interactive editor for building a graph in the browser. The graph is stored as weighted and directed, and can be viewed as directed or undirected, weighted or unweighted (TypeScript, no runtime dependencies).

## Setup

Run these commands from the `BFS/` directory:

```sh
npm install
```

## Compile

The browser can't run TypeScript, so `src/*.ts` is compiled to plain ES modules in `build/*.js` (with source maps). `index.html` loads `./build/main.js`.

| Command | What it runs | Use it to |
| --- | --- | --- |
| `npm run build` | `tsc -p tsconfig.build.json` | Compile once |
| `npm run dev` | `tsc -p tsconfig.build.json --watch` | Recompile on every save while editing |
| `npm run typecheck` | `tsc` | Type-check `src/`, the tests and the config files without writing output |

- `tsconfig.build.json` holds the compile settings (`src/` → `build/`) and extends `tsconfig.json`, which holds the shared type-check settings.
- Recompile after changing anything in `src/`, or the page keeps running the old code. If the page shows "The app script didn't load", `build/` is missing: run `npm run build`.
- Run `npm run build` before committing changes to `src/`, because `build/` is committed.

## Run

Any static file server works, because `index.html` loads everything by relative path:

- **VS Code Live Server:** keep `npm run dev` running and open `BFS/index.html` with Live Server. It reloads the page whenever `build/` changes.
- **No editor server:** run `npm run serve` and open http://127.0.0.1:5199/BFS/.

Opening the file directly (`file://`) does not work, because browsers block ES modules there.

## Tests

```sh
npm test           # unit tests (Vitest + happy-dom), unit_tests/
npm run test:watch # unit tests in watch mode
npm run test:e2e   # browser tests (Playwright) in an isolated Docker container, tests/
npm run test:all   # both
npm run test:e2e:local  # browser tests directly on this machine (uses installed Google Chrome)
```

Pass Playwright options after `--`, e.g. `npm run test:e2e -- --grep "edge"`.

- `unit_tests/graph.test.ts`: the `Graph` model (ids, edges, neighbors, removal).
- `unit_tests/editor.test.ts`: `GraphEditor` interactions driven by synthetic pointer and keyboard events in a simulated DOM, including auto-layout with manually stepped animation frames.
- `unit_tests/layout.test.ts`: `ForceLayout` behaviour:
  - pair spacing and equilateral triangles
  - grids unfold, and isolated or coincident nodes spread out
  - nodes stay in bounds and pinned nodes stay put
  - the layout settles and gives the same result every run
- `tests/graph-builder.spec.ts`: end-to-end tests that click, drag, right-click, type and tap in a real browser. Playwright runs `npm run build`, then starts `scripts/static-server.mjs` on port 5199. That server serves files as-is under `/BFS/`, the way Live Server does, so a page that only works through a dev server fails the tests.

### Isolated browser-test environment (Docker)

`npm run test:e2e` runs `scripts/e2e-docker.sh`, which builds `docker/playwright.Dockerfile` and runs the tests inside the container. Docker Desktop must be running.

- **Image:** the official `mcr.microsoft.com/playwright` image, which includes Chromium and its system libraries. Nothing is installed into the host's browser caches.
- **Dependencies:** a Linux `node_modules` is installed inside the image with `npm ci`, separate from the host's `node_modules`.
- **User:** the container runs as the unprivileged `pwuser` with all Linux capabilities dropped and `no-new-privileges` set.
- **Network:** `--network none`. The tests only use the static server running inside the same container. The project is compiled inside the container too.
- **Shared files:** only `test-results/` is mounted back to the host, so failure traces and screenshots can be inspected.

The image tag in `docker/playwright.Dockerfile` must match the exact `@playwright/test` version in `package.json` (pinned to `1.65.0`). When upgrading Playwright, update both together.

`npm run test:e2e:local` skips Docker and runs the same tests on the host in the installed Google Chrome.

## Controls

| Action | Result |
| --- | --- |
| Click empty space | Add a node |
| Click a node, then another node | Add an edge from the first to the second (stored as a directed arc) |
| Click an edge | Delete the edge |
| Drag a node | Move it |
| Right-click a node, or select it and press Delete | Delete the node and its edges |
| Esc, or click empty space while a node is selected | Cancel the selection |
| **Auto-layout** button (top-left of the canvas) | Turn automatic spacing on/off |
| **Undirected / Directed** switch (top-left, next to Auto-layout) | Choose how edges are interpreted (see below) |
| **Unweighted / Weighted** switch (top-left, next to Undirected / Directed) | Show or hide edge weights (see below) |
| Weighted mode: **scroll over an edge** (or its weight label) | Change its weight: 15 per page of scrolling, up = more |
| **☰** button (top-right of the canvas), or Esc to close | Show/hide the help and the live graph representation, floating over the canvas |
| **Adjacency list / Adjacency matrix** switch (in the ☰ panel; ← / → when focused) | Choose which representation of the graph to show |

## Directed and undirected mode

Edges are always **stored as directed arcs**: clicking A, then B, records A → B. The **Undirected / Directed** switch only changes how the stored arcs are interpreted, so switching never loses data.

| | Directed | Undirected |
| --- | --- | --- |
| A → B only | one edge A → B (arrow) | one edge A — B |
| A → B and B → A | two edges, drawn as two curved arrows | **one** edge A — B |
| Adjacency list | out-neighbours (the nodes a node points to) | neighbours either way |
| Adjacency matrix | row A, column B is 1 if A → B; can be asymmetric | symmetric |
| Click A, then B, when B → A exists | adds A → B | refused: already connected |
| Click an edge to delete it | removes that one arc | removes the arcs in both directions |

`Graph.directed` holds the UI's mode. The mode-dependent methods on `Graph` (`hasEdge`, `neighbors`, `getEdges`, `edgeCount`, `addEdge`, `removeEdge`, `adjacencyList`, `adjacencyMatrix`) follow it. Code that needs a particular reading should use the views below instead. Auto-layout and `connectedComponents()` always ignore direction (for a directed graph, the components are its weakly connected components), so switching modes never moves nodes.

## Weighted and unweighted mode

Every stored arc carries a whole-number **weight**, which defaults to 0. The **Unweighted / Weighted** switch only changes how weights are shown and used; switching never changes them.

- **Weighted:**
  - every edge is labelled with its weight
  - the adjacency list shows each neighbour's id over the edge weight
  - the matrix shows weights, with "—" for "no edge" (0 is a real weight)
- **Unweighted:** labels are hidden, and the views treat every edge as weight 1, the usual convention (what BFS implicitly assumes).
- **Editing:** in weighted mode, scroll over an edge or its label to change the weight.
  - The change is linear: one page of scrolling (the window's height) changes it by `WEIGHT_PER_PAGE` = 15, and scrolling up increases it.
  - Fractions carry over between scroll events, so the rate stays exact while weights stay whole numbers.
  - Negative weights are allowed.
  - Ctrl+scroll is left to the browser for zooming.
- **Undirected weighted:** when arcs run both ways with different weights, the edge shows the **smaller** one (`UNDIRECTED_WEIGHT` in `src/graph-views.ts`). Editing an undirected edge sets both arcs to the new value, so they agree afterwards. Directed mode edits only the arc under the pointer.

### Reading the graph in code: directed/undirected and weighted/unweighted views

`src/graph-views.ts` adds a read-only layer over the stored weighted arcs. All four readings of the same graph are always available, regardless of the UI's modes:

```ts
graph.view('directed' | 'undirected', 'weighted' | 'unweighted'); // weighting defaults to 'unweighted'
graph.currentView; // the one the two switches select

// Stored arcs: 0 → 1, 1 → 0, 1 → 2, 3 → 2 (all weight 0)
const d = graph.directedView;    // = graph.view('directed')   (unweighted)
const u = graph.undirectedView;  // = graph.view('undirected') (unweighted)

u.neighbors(2);          // [1, 3]       neighbours either way, sorted
d.neighbors(2);          // []           out-neighbours
d.inNeighbors(2);        // [1, 3]       plus outDegree / inDegree
u.hasEdge(2, 3);         // true         d.hasEdge(2, 3) → false
u.edges();               // [[0,1],[1,2],[2,3]]   pairs once, as [min, max]
d.edges();               // [[0,1],[1,0],[1,2],[3,2]]   every arc
u.adjacencyList();       // [{ id: 0, neighbors: [1] }, …]
d.adjacencyMatrix();     // { ids: [0,1,2,3], matrix: [[0,1,0,0], …] }
u.connectedComponents(); // BFS components, ignoring direction

// Weight-aware methods, on every view (unweighted views report weight 1):
const w = graph.view('undirected', 'weighted');
w.weight(0, 1);              // stored weight; undefined if no edge
w.weightedNeighbors(1);      // [{ id: 0, weight: … }, { id: 2, weight: … }]
w.weightedEdges();           // [{ from: 0, to: 1, weight: … }, …]
w.weightedAdjacencyList();   // [{ id: 0, neighbors: [{ id: 1, weight: … }] }, …]
w.weightMatrix();            // { ids, matrix } with weights, null = no edge
```

Every view implements `GraphView`:

- **Description:** `orientation` and `directed`, `weighting` and `weighted`.
- **Structure:** `nodeIds`, `neighbors`, `degree`, `hasEdge`, `edges`, `edgeCount`, `adjacencyList`, and `adjacencyMatrix` (0/1, ignoring weights).
- **Weights:** `weight`, `weightedNeighbors`, `weightedEdges`, `weightedAdjacencyList`, `weightMatrix`.

Weights never change the structure: a weighted and an unweighted view with the same orientation always report the same neighbours, edges and 0/1 matrix.

- **Pure:** reading never changes the graph, and each call returns fresh arrays, so callers can keep or modify the results without affecting the graph.
- **Live:** each call reflects the graph's current state.
- **Sorted:** ids are always in ascending order, which gives algorithms such as BFS a deterministic visiting order.

The panel's renderers take a `GraphView`, so they can draw either reading.

## Auto-layout

The **Auto-layout** toggle runs a force-directed layout ([src/layout.ts](src/layout.ts)) that spaces the graph out. Each step does the following:

1. **Split into connected components** using breadth-first search (`graph.undirectedView.connectedComponents()`).
2. **Run Fruchterman–Reingold (1991) inside each component.** This is a refinement of Eades' spring embedder (1984):
   - every pair of nodes repels with force k²/d
   - every edge pulls its endpoints together with force d²/k
   - k is the ideal edge length, worked out from the canvas area per node
   - each node moves along its net force, capped by a "temperature" that cools so the layout settles
   - a small deterministic jiggle that fades as the layout cools breaks symmetric starts (such as nodes on one line), which pure Fruchterman–Reingold forces can never leave
3. **Separate overlapping nodes** with a collision pass, like d3's `forceCollide`.
4. **Fit to the canvas.** A long, thin component that doesn't fit is turned a few degrees per step toward the canvas's longer side, using its principal axis. If the drawing is still too big, every component and k shrink by the same factor. This keeps the drawing in balance, because Fruchterman–Reingold's balanced shape scales linearly with k.
5. **Pack the components.** Their bounding boxes are arranged in centered rows, trying several row widths and keeping the best fit. Each component then glides part of the way toward its slot.

### Why components are laid out separately

Repulsion acts between every pair of nodes, including nodes in unrelated components. The first version used one global simulation, with a repulsion cutoff and a weak pull toward the center, as in ForceAtlas2's gravity or d3's `forceX`/`forceY`. With that version, disconnected graphs:

- never settled, and kept drifting by up to ~110 px after every edit
- had isolated nodes pushed into the walls (12 of 20 in one test)
- could trap a lone node inside a cycle, with components overlapping

Laying out each component on its own and then packing the components is the standard remedy in graph-drawing tools:

- Graphviz `pack`
- OGDF `ComponentSplitterLayout` with `TileToRowsCCPacker`
- yFiles `ComponentLayout`

Freivalds, Dogrusoz & Kikusts study this approach in *Disconnected Graph Layout and the Polyomino Packing Approach* (Graph Drawing 2001). The unit tests in `unit_tests/layout.test.ts` ("disconnected graphs") fail on the old algorithm and pass on this one.

### Interaction

- **Animation:** cooling and packing run one step per animation frame. Editing the graph, dragging, or resizing the window starts it again. Nodes glide into place within a few seconds, with most of the movement in the first second.
- **Dragging:** a node being dragged stays under the pointer, and the rest of its component reacts to it. After release, the component glides back into its packed slot.
- **Turning it off** leaves every node where it is.
- **Reduced motion:** with the OS "reduce motion" setting enabled, the layout jumps straight to its settled state instead of animating.

## Code layout

- `src/graph.ts` — `Graph` model: stores nodes (with positions) and weighted arcs (out: target → weight maps; in: source sets), handles all edits (`addEdge(a, b, weight = 0)`, `setWeight`, …), and exposes the four views. Its mode-dependent readers follow `graph.directed` / `graph.weighted`.
- `src/graph-views.ts` — the read-only `GraphView` layer: `DirectedView` (with in/out neighbours and degrees) and `UndirectedView` (with BFS-based `connectedComponents()`), each available weighted or unweighted. `neighbors(id)` returns ids in sorted order, giving BFS a deterministic visiting order.
- `src/editor.ts` — `GraphEditor`: SVG rendering, pointer/keyboard interaction, and driving the auto-layout animation.
- `src/layout.ts` — `ForceLayout` (per-component force-directed layout, fitting and packing) and `packRows`; pure, no DOM.
- `src/main.ts` — wires the editor to the stats, status message, Auto-layout toggle and the ☰ help/adjacency-list panel.
- `src/representations.ts` — renders the adjacency list (a column of vertex boxes, then each vertex's neighbours as a joined strip of boxes) and the adjacency matrix, and the list/matrix switch (ARIA tabs). The data comes from `Graph.adjacencyList()` and `Graph.adjacencyMatrix()`.
- `src/style.css` — styles, linked directly from `index.html`.
- `build/` — compiled JavaScript loaded by the page. It is committed so the page works from a fresh clone, so rebuild it before committing changes to `src/`. Imports in `src/` use `.js` extensions because the browser loads them unbundled.
