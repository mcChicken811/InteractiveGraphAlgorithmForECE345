# BFS · Graph Builder

Interactive editor for building an undirected, unweighted graph in the browser (TypeScript, no runtime dependencies).

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
| Click a node, then another node | Add an edge between them |
| Click an edge | Delete the edge |
| Drag a node | Move it |
| Right-click a node, or select it and press Delete | Delete the node and its edges |
| Esc, or click empty space while a node is selected | Cancel the selection |
| **Auto-layout** button (top-left of the canvas) | Turn automatic spacing on/off |
| **☰** button (top-right of the canvas), or Esc to close | Show/hide the help and the live adjacency list, floating over the canvas |

## Auto-layout

The **Auto-layout** toggle runs a force-directed layout ([src/layout.ts](src/layout.ts)) that spaces the graph out. Each step does the following:

1. **Split into connected components** using breadth-first search (`Graph.connectedComponents()`).
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

- `src/graph.ts` — `Graph` model (adjacency list of `Set`s, plus node positions), including BFS-based `connectedComponents()`. `neighbors(id)` returns ids in sorted order, giving BFS a deterministic visiting order.
- `src/editor.ts` — `GraphEditor`: SVG rendering, pointer/keyboard interaction, and driving the auto-layout animation.
- `src/layout.ts` — `ForceLayout` (per-component force-directed layout, fitting and packing) and `packRows`; pure, no DOM.
- `src/main.ts` — wires the editor to the stats, status message, Auto-layout toggle and the ☰ help/adjacency-list panel.
- `src/style.css` — styles, linked directly from `index.html`.
- `build/` — compiled JavaScript loaded by the page. It is committed so the page works from a fresh clone, so rebuild it before committing changes to `src/`. Imports in `src/` use `.js` extensions because the browser loads them unbundled.
