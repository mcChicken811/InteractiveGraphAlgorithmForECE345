# BFS · Graph Builder

Interactive editor for building an undirected, unweighted graph in the browser (TypeScript + Vite, no runtime dependencies).

## Run

```sh
npm install
npm run dev      # open the printed URL
npm run build    # type-check + production build into dist/
```

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
- `unit_tests/editor.test.ts`: `GraphEditor` interactions driven by synthetic pointer and keyboard events in a simulated DOM.
- `tests/graph-builder.spec.ts`: end-to-end tests that click, drag, right-click, type and tap in a real browser. Playwright starts its own Vite server on port 5199.

### Isolated browser-test environment (Docker)

`npm run test:e2e` runs `scripts/e2e-docker.sh`, which builds `docker/playwright.Dockerfile` and runs the tests inside the container. Docker Desktop must be running.

- **Image:** the official `mcr.microsoft.com/playwright` image, which includes Chromium and its system libraries. Nothing is installed into the host's browser caches.
- **Dependencies:** a Linux `node_modules` is installed inside the image with `npm ci`, separate from the host's `node_modules`.
- **User:** the container runs as the unprivileged `pwuser` with all Linux capabilities dropped and `no-new-privileges` set.
- **Network:** `--network none`. The tests only use the Vite server running inside the same container.
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

## Code layout

- `src/graph.ts` — `Graph` model (adjacency list of `Set`s, plus node positions). `neighbors(id)` returns ids in sorted order, giving BFS a deterministic visiting order.
- `src/editor.ts` — `GraphEditor`: SVG rendering and pointer/keyboard interaction.
- `src/main.ts` — wires the editor to the stats, status message and adjacency-list panel.
