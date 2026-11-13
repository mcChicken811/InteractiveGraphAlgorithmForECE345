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

- `unit_tests/status-bar.test.ts`: when the status bar hides and reappears (fake timers).
- `unit_tests/queue-view.test.ts`: the queue and stack strips' contents, order, arrows, labels, reuse of elements, empty state.
- `unit_tests/dfs.test.ts`: the DFS simulation against CLRS: discovery and finish times, edge classes, every step's message, stack snapshots, the outer loop over all vertices, and (on random graphs) the parenthesis theorem and each class's time rules. Also the topological sort: decreasing finish times, and (checked against Kahn's algorithm on random graphs) offered exactly when the graph is acyclic, with every edge pointing forward.
- `unit_tests/prim.test.ts`: Prim's algorithm against CLRS: keys, every step's message, the tree, tie-breaking, negative weights, the unweighted view, graphs that are not connected. On random graphs it checks the crossing edges against brute force, that the white edge is always a light edge, and that the total weight matches an independent Kruskal implementation.
- `unit_tests/voronoi.test.ts`: the cut's border lies halfway between the two groups' features (within a pixel), each side holds its own vertices and non-crossing edges, contours close, and empty or full cuts behave. While moving between cuts, every step changes only a little of the territory, the territory only grows when a vertex joins, nearer points change sides sooner, a first cut grows from its vertex, and a full one floods the canvas.
- `unit_tests/label-fit.test.ts`: label font shrinking.
- `unit_tests/timeline-view.test.ts`: the timestamp chart's bars, rows, axis and now line, and expanding into the dialog and back (button, Esc, backdrop click).
- `unit_tests/arc-diagram.test.ts`: the topological sort's row layout (centring, wrapping, room for arcs) and half-circle geometry.
- `unit_tests/select-menu.test.ts`: the picker's mouse and keyboard behaviour, disabling, and outside clicks.
- `unit_tests/bfs.test.ts`: the BFS simulation (order, steps, highlights, messages, unreachable vertices, directed vs. undirected).
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

### Known flakiness

The browser tests drive a UI that animates almost everything, so most flakiness is about timing. These cases have been seen, and are handled as described:

| Symptom | Cause | Handling |
| --- | --- | --- |
| A hover test fails about 1 run in 25: the ids don't come back after hovering a strip ("shows the times in the circles; hovering the stack shows the ids…") | After an Update, the Timestamps card can grow a row (a 0.34 s transition), which moves the cards above it. The strip slides out from under the still pointer, `pointerleave` fires, and the peek switches off. | Wait for `document.getAnimations()` to finish before hovering. Any new test that hovers or measures the side panel right after an Update should do the same. |
| A position or size is off by a few dozen px ("expands to the middle of the screen…": the card came back 24 px higher than measured) | The "before" value was read while the panel was still reflowing (same cause as above), or during a FLIP move or the status bar's resize. | Let animations finish before measuring, or read everything in one `page.evaluate` call. |
| "scrolls when the axis overflows…" fails about 2 runs in 25: the current-time label is a few px outside the chart | The Timestamps chart scrolls *smoothly* to the current time, and the label was measured while it was still scrolling. | Poll until the label is inside the chart instead of measuring once. |
| A weight set by a scripted scroll is one less than intended (4 becomes 3) | Weights step in whole numbers, and the browser can deliver a fraction of a pixel less scroll than the test asked for. | Scroll a little past the target (*w* + 0.4 steps), as the Prim tests' `build` does. |
| An edge's colour reads as an in-between value | The edge's stroke has a 0.12 s transition, and the colour was read part-way. | Check state by class, and colours with the auto-retrying `toHaveCSS`. |
| The page-load test reports a failed request for the favicon | Chrome sometimes cancels a duplicate favicon request with `net::ERR_ABORTED`. | The load test ignores aborted favicon requests only; every other failed request still fails it. `src/favicon.ts` only changes the icon when it actually differs. |
| Edges are missing and a DFS test times out waiting for a button | With auto-layout on while the graph is being built, nodes drift away from the test's scripted clicks. | Turn auto-layout on only after building the graph. |

Checking a test for flakiness: `npm run test:e2e:local -- --grep "<name>" --repeat-each=25`.

Checking that a test can fail: break the feature in `src/`, not in `build/`. Playwright's web server runs `npm run build` before every run, which overwrites any edit to `build/`, so the test would quietly run against the real code.

**Not covered by the tests.** The suite runs only in Chromium, so engine-specific rendering bugs can slip through:

- **Safari (WebKit) left trails of stale rings** behind the vertices gliding into a topological sort. The fix is `will-change: transform` on `#canvas` (see the comment in `src/style.css`); a test only checks that the property is set.
- **Screenshots can't show stale paint:** Playwright screenshots force a full repaint, so they always look clean.
- **Reproducing in WebKit:** install WebKit into the project with `PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers npx playwright install webkit` (`.pw-browsers/` is git-ignored). Run it headed with `recordVideo`, and inspect the last frames of the video.
- **Docker:** the Docker run (`npm run test:e2e`) was last run before the DFS work. The suite has only been run locally since.

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
| **☰** button (top-right of the canvas), or Esc to close | Show/hide two cards floating over the canvas: **How to use** (top) and **Graph representation** (below) |
| Click a card's **title** | Collapse/expand that card; remembered in this browser |
| **Algorithm picker + Run** (header, top right) | Start a step-by-step simulation (see below); **Update** steps, **Stop** / **Finish** end it |
| **Adjacency list / Adjacency matrix** switch (in the ☰ panel; ← / → when focused) | Choose which representation of the graph to show |

## Algorithm simulation

The header's picker lists the available algorithms: **Breadth-first search**, **Depth-first search** and **Prim's algorithm** (minimum spanning tree).

- **Run** starts the simulation from the **selected node**, or from the lowest id if none is selected.
- **Run** turns into **Update** and **Stop**. **Update** takes one step; after the last step it becomes **Finish**.
- **Finish** and **Stop** both end the run: they clear the highlighting and release every lock.
- **While running, the graph is locked:**
  - **Edits are blocked:** you can't add, connect, delete or re-weight anything, and Clear is disabled. Dragging nodes and auto-layout still work.
  - **Undirected / Directed** is locked. DFS also forces **Directed**, and Prim forces **Undirected**.
  - **Weighting:** the weighting the algorithm needs is forced and its switch is greyed out. BFS and DFS force **Unweighted**. Prim reads the weights but accepts either setting, so the switch keeps your choice and is only locked for the run.
  - Stop / Finish restore the direction and weighting you had chosen before.

**Seeing the vertex numbers.** While any algorithm runs, hovering the adjacency list or matrix in the Graph representation card shows the vertex numbers on the canvas (growing Prim's compact vertices back), so vertices can be matched to rows and columns.

**BFS steps.** The canvas always shows what the next Update will do:

- **White:** the vertex at the front of the queue, which the next Update pops, and the edges that Update will travel (from it to neighbours not discovered yet). Right after Run, that's the start vertex.
- **Green:** vertices already popped.

Each Update pops the front vertex (it turns green) and appends its undiscovered neighbours to the queue in ascending id order; the new front vertex turns white. The status message lists the whole queue, front (white) vertex first, for example "Popped 0: discovered 1, 2. Queue: 1, 2." A start vertex with *n* reachable vertices takes exactly *n* Updates, then Update becomes Finish.

**Distance labels.** While BFS runs, each vertex shows its shortest-path length (number of edges) from the start vertex instead of its id. The label appears the moment BFS discovers the vertex, which is when that length is known, so undiscovered vertices show no number. The Queue card's circles show distances too: along the queue they never decrease, and differ by at most 1. **Hovering or focusing the queue strip** smoothly crossfades every vertex, on the canvas and in the queue, back to its id; leaving it switches back.

**Queue card.** While BFS runs, a **Queue** card appears at the bottom of the ☰ panel. It shows the queue as a horizontal strip: `← pop  (front) … (back)  (incoming…)  ← push`.

- **Front:** the first vertex is the one the next Update pops, with the same white ring as on the canvas.
- **Incoming:** after the back of the queue come the vertices that Update will push, greyed out.
- **Circles** are smaller copies of the canvas nodes.
- **Animation on Update:** the popped vertex turns green and slides out to the left, the rest glide into place, the incoming vertices fill in as they join, and the next incoming ones fade in. With "reduce motion" it updates instantly.
- **Overflow:** a long queue scrolls sideways inside the strip, with an always-visible themed scrollbar.
- **Collapsing:** the card collapses from its title like the other cards.

BFS runs from a single source, so vertices it can't reach stay uncoloured, and the final message counts them. On the light theme, white highlights get a thin dark outline so they stay visible.

### Depth-first search

DFS follows *Introduction to Algorithms* (CLRS, 4th ed., §20.3) exactly: `DFS(G)` runs `DFS-VISIT` from every vertex that is still white, so the whole graph is searched and every vertex gets a discovery time *d* and a finish time *f* from one shared clock. The outer loop takes the selected node (or the lowest id) first, then the other vertices in ascending id order. Adjacency lists are in ascending id order too. DFS runs on the **directed, unweighted** view.

**Steps.** Each Update does one of three things:

- **Discover a new root:** push it on the recursion stack. This happens at the start, and again whenever a tree is finished and white vertices remain.
- **Explore the next edge** (*u*, *v*) of the vertex on top of the stack, and classify it. A tree edge also discovers *v* and pushes it.
- **Finish the top vertex**, once it has no edges left: pop it.

A graph with *n* vertices, *m* edges and *t* trees takes *n* + *m* + *t* Updates.

**Colours.** The canvas always shows what the next Update will do:

- **White:** the vertex it works on (the top of the stack, or the next root) and the edge it will explore next.
- **Yellow:** running vertices (gray in CLRS: discovered, not finished, on the recursion stack).
- **Green:** finished vertices (black in CLRS).

**Times.** While DFS runs, each vertex shows its times as `d,f`: `3,` while running, `3,8` once finished, and nothing before it is discovered. Long labels shrink to fit inside the circle.

**Edges.** Every edge starts dashed and faded. Once explored it is drawn solid and tagged with its class, which is decided by the colour of *v* when the edge is explored:

| Class | When | Tag |
| --- | --- | --- |
| Tree | *v* is white: the search goes on into *v* | none |
| Back | *v* is gray: an ancestor of *u*, still running | `backward` |
| Forward | *v* is black and *u.d* < *v.d*: a finished descendant of *u* | `forward` |
| Cross | *v* is black and *u.d* > *v.d*: finished earlier, in another branch or tree | `crossed` |

**Recursion stack card.** While DFS runs, a **Recursion stack** card appears at the bottom of the ☰ panel. It shows the stack, top first: `← pop / → push  (incoming)  (top) … (bottom)`.

- **Arrows:** both are at the open (left) end, pop above push. The one the next Update uses is drawn at full strength; an Update that only classifies an edge uses neither.
- **Rings:** the top has the white ring (it is the canvas's white vertex), the vertices below it are yellow (running), and a vertex about to be pushed is greyed out where it will land.
- **Animation:** a finished vertex turns green and slides out of the top.
- **Labels:** the circles show the times, and hovering or focusing the strip shows the ids, on the canvas too.

**Timestamps card.** Below the Recursion stack card, a **Timestamps** card charts every discovered vertex as a bar from its discovery time *d* to its finish time *f*, on a time axis 1 … 2*n*.

- **Rows:** each vertex sits on the row of its depth in the depth-first forest (roots on top), so by the parenthesis theorem a descendant's bar lies below, and inside, its ancestor's.
- **Colours:** running vertices' bars are yellow and reach the current time, trailing off past it. Finished bars are green, and the bar of the vertex the next Update works on has the white ring, as on the canvas.
- **Current time:** a line marks it, and its axis label is highlighted. Bars grow and move with smooth transitions.
- **Scrolling:** when the chart doesn't fit, it scrolls both ways and follows the current time. The axis stays in view at the bottom.
- **Expanding:** hovering the chart (or focusing it) shows a button in its bottom-right corner. Pressing it moves the whole card to the middle of the screen, enlarged, over a darkened, blurred page (a modal `<dialog>` and its `::backdrop`).
- **Shrinking back:** the same button, in the same corner, sends the card back to its place in the panel. Esc and a click on the darkened page do the same.
- **Motion:** both ways animate. The chart's time steps widen to fill the space, and with "reduce motion" everything happens instantly.

### Topological sort

When DFS has finished, a **Topological sort** button appears next to **Finish**. CLRS's TOPOLOGICAL-SORT (§20.4) is DFS followed by listing the vertices by **decreasing finish time**. A directed graph has a topological order exactly when DFS finds no back edge (Lemma 20.11), so the button is greyed out when a backward edge was found, and its tooltip and the final message say why.

- **Line-up:** pressing it glides the vertices into a line, left to right in that order and centred. If they don't fit across the canvas, about 88 px apart at the closest, the line continues on the next row down, like text. The line stays clear of the canvas toolbar and the status bar.
- **Edges:** every edge now points left to right.
  - **Tree edges** are highlighted white. Between neighbouring vertices they lie straight on the centre line. A tree edge that skips over other vertices would run behind them, so it arcs above instead (still white).
  - **Other edges** are half circles whose diameter runs from one vertex to the other: forward edges above the line, crossed edges below. Two such arcs only overlap if they join the same two vertices, which can't happen. Arcs are flattened into half ellipses where a full half circle would leave the canvas or reach the next row.
  - **Transitions:** edges bend smoothly from straight lines into arcs while the vertices glide into place.
- **Auto-layout:** it is switched off, since it would move the vertices. Switching it back on leaves the line-up (the edges straighten out), but the run goes on, and pressing **Topological sort** again comes back.
- **Ending:** the run is not over until **Finish** or **Stop**. Ending it straightens the edges and leaves the vertices where they are.
- **Reduced motion:** with "reduce motion", everything jumps straight into place.

### Prim's algorithm

Prim's algorithm follows `MST-PRIM(G, w, r)` in *Introduction to Algorithms* (CLRS, 4th ed., §21.2). Every vertex starts in a min-priority queue with key ∞, except the root *r* (the selected node, or the lowest id), whose key is 0. Each Update is one iteration of the loop:

1. **Extract the minimum:** the vertex *u* with the smallest key leaves the queue and joins the tree, by the edge (*u.π*, *u*). Ties go to the lowest id.
2. **Update keys:** for each neighbour *v* still in the queue with *w*(*u*, *v*) < *v.key*, set *v.π* = *u* and lower *v.key* to *w*(*u*, *v*).

A graph with *n* vertices takes exactly *n* Updates.

- **Undirected only:** CLRS defines the minimum-spanning-tree problem for a connected, *undirected*, weighted graph (Chapter 21), so Run forces **Undirected** and locks it. Where arcs run both ways with different weights, the undirected edge has the smaller one.
- **Weights:** in weighted mode Prim uses the edge weights (negative ones are fine). In unweighted mode every edge counts as 1, so any spanning tree is minimum and the result is simply a spanning tree.
- **The cut:** between Updates, the tree's vertices *S* and the queue's vertices *V* − *S* form a cut (*S*, *V* − *S*) (CLRS §21.1). An edge *crosses* the cut when it has one end on each side, and a crossing edge of minimum weight is a *light edge*. Each queued vertex's key is the weight of its lightest edge into the tree, so the next vertex's joining edge is always a light edge. The status message counts the crossing edges and names the light edge.
- **Colours:** the canvas always shows what the next Update will do.
  - **White:** the light edge that will join the next vertex to the tree. No vertex is ringed white (or yellow): vertices still in the queue keep their normal ring.
  - **Grey (solid):** the other edges crossing the cut.
  - **Green:** vertices in the tree and the tree's edges (solid). Edges between two tree vertices that are not tree edges are dashed green.
  - **Dashed:** edges with both ends still outside the tree.
- **The border:** the cut is also drawn on the canvas.
  - **How:** the tree's *territory* is tinted green, and a dashed green line marks the border with the rest. A side's territory is every point of the canvas nearer to that side than to the other: nearer to one of its vertices, or to one of its *non-crossing edges* (both ends on that side, including the tree's edges).
  - **Edges take part:** a non-crossing edge therefore stays on its own side of the border, and only crossing edges cross it. The border curves around edges where they come close to the other side's vertices. Without this, an edge between two queued vertices passing near the tree would cut through the tree's territory.
  - **Without crossing edges:** the border depends only on where the vertices and edges are, so it is there even when no edge crosses the cut (a graph that is not connected, between trees).
  - **Moving smoothly:** when a vertex joins the tree, the border does not jump. The new territory is revealed by a front spreading out from the old tree at a steady speed (0.65 s), so the area along the new tree edge fills in from the tree's end towards the vertex that joined.
    - A vertex that joins with no edge to the tree (the first one, or a new tree's root in a graph that is not connected) grows a territory of its own.
    - On the last step the tree's territory floods the canvas, then fades out.
    - The territory only ever grows during a step; with "reduce motion" the border jumps straight to its new place.
  - **Live:** it follows vertices as they are dragged or moved by auto-layout.
  - **Source:** this is the Voronoi view of a partition that GMap starts from (Gansner, Hu & Kobourov, *GMap: Visualizing Graphs and Clusters as Maps*, IEEE PacificVis 2010), extended to edges.
  - **Computation (`src/voronoi.ts`):** the border is the zero line of a distance field, f(p) = (distance to the tree's nearest vertex or inner edge) − (distance to the rest's), using exact point-to-segment distances (the exact Voronoi diagram of points and segments, with its curved borders). The field is sampled on a 7 px grid and traced with marching squares, each crossing refined by bisection on the exact field (the border is within a pixel of the true one). A padding frame closes every contour, so the territory comes out as loops filled even-odd.
  - **The sweep:** while a vertex joins, the field drawn is g = max(f_new, min(f_old, d − r(t))), where d is the distance to the old tree's features and r(t) grows at a steady rate until the new territory is covered. That is, region(t) = old territory ∪ (new territory ∩ within r(t) of the old tree).
    - I considered blending the two fields linearly, f_t = (1 − t)·f_old + t·f_new — the classic implicit-shape morph (Turk & O'Brien, SIGGRAPH 1999) — but it can open a separate patch at the joining vertex before the old border reaches it. It is kept as the fallback for cuts that shrink.
    - I also considered growing sample points along the new edges. It moves continuously along the edges, but the joining vertex still flips sides at the end and takes half of its region with it.
  - **Cost:** a 1200 × 700 canvas with 20 vertices and 40 edges takes about 7 ms per frame while moving, and nothing is recomputed when nothing has moved.
- **Compact vertices:** while Prim runs, every vertex shrinks to half size (animated) and is filled with its colour — green in the tree, the normal blue in the queue — with no number inside.
- **Keys:** each vertex's key is ∞ until some edge reaches it from the tree. Hovering (or focusing) the priority queue grows the vertices back to full size and shows their keys. Unlike BFS and DFS, unreached vertices are not blank: every vertex is in the queue from the start, and ∞ is the value that orders it.
- **Priority queue card:** a **Priority queue** card appears at the bottom of the ☰ panel, listing the queue as `← min  (smallest key) … (largest key)`. The front vertex is the next to be extracted, marked by its place at the min end (no ring colour). On Update the extracted vertex turns green and slides out, and vertices whose keys dropped glide to their new places. The strip always shows keys; hovering it shows the keys on the canvas too.
- **Graphs that are not connected:** CLRS assumes a connected graph, but the pseudocode still terminates. When only keys of ∞ are left, the extracted vertex has no joining edge and starts a new tree, so the result is a minimum spanning forest, one tree per connected part. The final message says so.

### Adding another algorithm

1. Implement `Simulation` (in `src/algorithms/types.ts`). An algorithm with a queue can also implement `queueSnapshot()`, returning `{ items, incoming }`, to get the animated Queue card. One with a min-priority queue can implement `priorityQueueSnapshot()` (same shape, smallest key first) to get the Priority queue card. One with a recursion stack can implement `stackSnapshot()`, returning `{ items, incoming, popping }` (top first), to get the Recursion stack card. One with timestamps can implement `timestamps()`, returning `{ clock, end, intervals, current }`, to get the Timestamps card. It works on a read-only `GraphView`, takes one step per `step()`, and reports `highlight()` (current vertex, finished vertices, active edges) and `describe()` (the status message).
2. Export an `AlgorithmDefinition` from its own file: `id`, `name`, `requires` (e.g. `{ weighted: true }` for Dijkstra; DFS uses `{ weighted: false, directed: true }`; Prim uses `{ directed: false }`), and `create(view, start)`. An algorithm that reads weights but accepts either weighting sets `usesWeights: true`, which locks the weight switch at the user's choice without forcing it. By convention `highlight()` previews the *next* step: `current` is what it will process and `activeEdges` what it will travel. It may also return:
   - `labels` (vertex → text) to draw inside the vertices instead of their ids, as BFS does with distances and DFS with times; Dijkstra could do the same with tentative distances.
   - `running` (vertices drawn yellow).
   - `cut` (one side *S* of a cut): the canvas tints *S*'s Voronoi territory and draws its border with the rest, as Prim does with its tree.
   - `exploredEdges` (`{ from, to, label?, done?, crossing?, within? }`). When present, every other edge is drawn dashed, as DFS does. The flags restyle an edge, as Prim does:
     - `done: true`: solid green (tree edges).
     - `crossing: true`: solid grey (edges crossing its cut).
     - `within: true`: dashed green (edges between tree vertices that are not tree edges).
   - Once finished, a simulation can also offer `topologicalSort()`, returning an `ArcDiagram` (`order`, `spine`, `below`) or null. The Topological sort button then appears next to Finish.
3. Add it to `ALGORITHMS` in `src/algorithms/index.ts`. The picker, the locks and the drawing then work without further changes.

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
- `src/algorithms/` — step-by-step algorithm simulations: `types.ts` (the `Simulation` / `AlgorithmDefinition` interfaces), `bfs.ts` (`BfsSimulation`, which also exposes `order`, `parent` and `distance`), `dfs.ts` (`DfsSimulation`, which also exposes `discovery`, `finish`, `parent`, `edges` with their classes, and `trees`), `prim.ts` (`PrimSimulation`, which also exposes `key`, `parent`, `order`, `treeEdges`, `roots` and `totalWeight`), `index.ts` (the `ALGORITHMS` registry).
- `src/select-menu.ts` — `SelectMenu`: the styled program picker. It replaces a native `<select>`, whose open list the browser draws and which can't be styled or positioned (on macOS it pops up over the box). It follows the WAI-ARIA "select-only combobox" pattern: mouse, ↑/↓/Home/End/Enter/Space/Esc/Tab, and closes on an outside click. The list drops down below the box, in the page's panel style, with the option text in line with the box's text.
- `src/queue-view.ts` — `QueueView`: the side panel's animated queue strip (BFS), or with `kind: 'priority'` the min-priority queue strip (Prim), or with `kind: 'stack'` the recursion stack strip (DFS). Elements are reused by vertex id, and changes are animated with the FLIP technique (record positions, update, play from the old positions).
- `src/arc-diagram.ts` — `rowLayout` (vertices in a centred line that wraps into rows) and `halfEllipse` (an edge as a half circle over its two ends, trimmed to the node rims), for the topological sort; pure, no DOM.
- `src/timeline-view.ts` — `TimelineView`: the Timestamps card's chart (bars positioned with CSS custom properties, so they animate and rescale) and its expand / shrink into a centred modal dialog (animated between the two positions).
- `src/voronoi.ts` — `cutShape`: the territory of a cut and its border, as the zero line of a distance field (vertices and non-crossing edges as sites), traced with marching squares; also the smooth move between two cuts (a front sweeping out from the old side). For drawing Prim's cut; pure, no DOM.
- `src/label-fit.ts` — `fitFontSize`: shrinks a label's font so long labels (DFS's `d,f`) fit inside a vertex circle.
- `src/status-bar.ts` — `StatusBar`: every status message goes through `show(text, tone)`.
  - **Hiding:** 5 s after the last message, with the pointer neither on the bar nor near it, the bar slides slowly down out of view.
  - **Revealing:** a new message, or the pointer coming near the bottom edge where the bar hides (or a tap there), slides it quickly back.
  - **Staying up:** it stays up while hovered or approached.
  - **Resizing:** a new message never snaps the bar to its new size. Its width and height animate (0.26 s, ease-out) while the new text fades in, and from the first frame the text is laid out exactly as it will end up (same width, same line breaks). While the bar is still smaller, it clips whatever doesn't fit yet. A message arriving mid-resize continues from the current size.
  - **Reduced motion:** with "reduce motion" on, it hides, shows and resizes instantly.
- `src/runner.ts` — `AlgorithmRunner`: the header's picker and Run / Update / Finish / Stop buttons, the locks, and passing each step's highlight to the editor.
- `src/collapsible.ts` — collapsible cards: a title button (`aria-expanded` / `aria-controls`) shows or hides its card body, and the state is remembered in `localStorage`.
- `src/favicon.ts` — points the favicon links at the light or dark icon to match the page's colour scheme (`prefers-color-scheme`), and updates them when it changes.
- `icons/` — the favicon: a graph node without its number, in the page's light and dark palettes (`favicon-{light,dark}.svg`), plus 64×64 PNG fallbacks for browsers without SVG favicons (e.g. Safari). After editing an SVG, run `npm run icons` (`scripts/render-favicons.mjs`, uses the installed Chrome) to re-render the PNGs.
- `build/` — compiled JavaScript loaded by the page. It is committed so the page works from a fresh clone, so rebuild it before committing changes to `src/`. Imports in `src/` use `.js` extensions because the browser loads them unbundled.
