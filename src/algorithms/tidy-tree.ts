import type { NodeId } from '../graph.js';
import type { ForestDiagram } from './types.js';

/**
 * Places a tree, given by each vertex's parent (the root's is null), as a tidy tree for
 * "Show as tree": rows by depth (the root on row 0); leaves two column units apart, in the
 * order a depth-first walk meets them (children in the order they appear in `parent`);
 * each parent centred over its first and last child. Vertices not connected to `root`
 * through `parent` are left out. Pure.
 */
export function tidyTree(root: NodeId, parent: ReadonlyMap<NodeId, NodeId | null>): ForestDiagram['places'] {
  const children = new Map<NodeId, NodeId[]>();
  for (const [v, u] of parent) {
    if (u === null) continue;
    children.set(u, [...(children.get(u) ?? []), v]);
  }
  const places: ForestDiagram['places'] = [];
  let slot = 0;
  const place = (v: NodeId, row: number): number => {
    const kids = children.get(v) ?? [];
    let column: number;
    if (kids.length === 0) column = 2 * slot++;
    else {
      const cols = kids.map((kid) => place(kid, row + 1));
      column = (cols[0] + cols[cols.length - 1]) / 2;
    }
    places.push({ id: v, column, row });
    return column;
  };
  place(root, 0);
  return places;
}
