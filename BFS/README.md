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

## Auto-layout

The **Auto-layout** toggle runs a force-directed layout ([src/layout.ts](src/layout.ts)) that spaces the graph out:

- **Fruchterman–Reingold (1991)**, a refinement of Eades' spring embedder (1984):
  - every pair of nodes repels with force k²/d
  - every edge pulls its endpoints together with force d²/k
  - k is the ideal edge length, worked out from the canvas area per node and clamped to 70–150 px
  - each step moves a node along its net force, capped by a "temperature" that cools so the layout settles
- **Repulsion cutoff:** nodes more than 2.5k apart ignore each other, as in FR's grid variant.
- **Center pull:** a weak pull toward the center keeps disconnected pieces on screen.
- **Animation:** in the style of d3-force, cooling runs one step per animation frame, and editing the graph, dragging, or resizing the window re-heats it. Nodes therefore glide into place, which takes up to ~6 s, with most movement in the first second.

While it is on, a node being dragged is held under the pointer and the rest of the graph reacts to it. Turning it off leaves every node where it is. With the OS "reduce motion" setting enabled, the layout jumps straight to its settled state instead of animating.

## Code layout

- `src/graph.ts` — `Graph` model (adjacency list of `Set`s, plus node positions). `neighbors(id)` returns ids in sorted order, giving BFS a deterministic visiting order.
- `src/editor.ts` — `GraphEditor`: SVG rendering, pointer/keyboard interaction, and driving the auto-layout animation.
- `src/layout.ts` — `ForceLayout`: the force-directed layout algorithm (pure, no DOM).
- `src/main.ts` — wires the editor to the stats, status message and adjacency-list panel.
- `src/style.css` — styles, linked directly from `index.html`.
- `build/` — compiled JavaScript loaded by the page. It is committed so the page works from a fresh clone, so rebuild it before committing changes to `src/`. Imports in `src/` use `.js` extensions because the browser loads them unbundled.
