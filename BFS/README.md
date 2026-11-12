# BFS · Graph Builder

Interactive editor for building an undirected, unweighted graph in the browser (TypeScript + Vite, no runtime dependencies).

## Run

```sh
npm install
npm run dev      # open the printed URL
npm run build    # type-check + production build into dist/
```

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
