/**
 * Voronoi cells and the border between two groups of sites, for drawing an algorithm's
 * cut (S, V − S) as territories on the canvas: every point of the canvas belongs to its
 * nearest vertex, the cells of S's vertices together form S's territory, and the border
 * is where a cell of S meets a cell of V − S.
 *
 * This is the Voronoi-diagram view of a vertex partition that GMap (Gansner, Hu &
 * Kobourov, "GMap: Visualizing Graphs and Clusters as Maps", IEEE PacificVis 2010) starts
 * from. It depends only on where the vertices are, so the border exists even when no
 * edge crosses the cut, and it always separates the two groups exactly.
 *
 * Each cell is computed exactly: the bounding rectangle clipped by the perpendicular
 * bisector with every other site (Sutherland–Hodgman), remembering which site produced
 * each edge of the cell. O(n²) clips, which is nothing at the sizes drawn here. Pure
 * functions, no DOM.
 */
/** A cell edge's origin: the index of the neighbouring site whose bisector it lies on, or −1 for the rectangle. */
const RECT = -1;
/**
 * The Voronoi cell of every site within `bounds` (the rectangle from (0, 0)). Sites at
 * the same position split nothing between them: each gets the cell they share.
 */
export function voronoiCells(sites, bounds) {
    const { width: w, height: h } = bounds;
    return sites.map((site, i) => {
        let cell = {
            points: [
                { x: 0, y: 0 },
                { x: w, y: 0 },
                { x: w, y: h },
                { x: 0, y: h },
            ],
            edge: [RECT, RECT, RECT, RECT],
        };
        for (let j = 0; j < sites.length && cell.points.length; j++) {
            if (j !== i)
                cell = clip(cell, site, sites[j], j);
        }
        return cell;
    });
}
/** Keeps the part of `cell` at least as close to `a` as to `b`; new edges get origin `label`. */
function clip(cell, a, b, label) {
    const nx = b.x - a.x;
    const ny = b.y - a.y;
    if (Math.abs(nx) < 1e-9 && Math.abs(ny) < 1e-9)
        return cell; // same position
    // g(p) ≤ 0 ⇔ p is at least as close to a as to b (g is the bisector's signed distance, scaled).
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const g = (p) => (p.x - mx) * nx + (p.y - my) * ny;
    const points = [];
    const edge = [];
    const n = cell.points.length;
    for (let k = 0; k < n; k++) {
        const p = cell.points[k];
        const q = cell.points[(k + 1) % n];
        const gp = g(p);
        const gq = g(q);
        const cross = () => {
            const t = gp / (gp - gq);
            return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
        };
        if (gp <= 0) {
            points.push(p);
            edge.push(cell.edge[k]);
            // Leaving the kept side: the edge from the crossing to where the polygon comes back
            // in lies along the bisector.
            if (gq > 0) {
                points.push(cross());
                edge.push(label);
            }
        }
        else if (gq <= 0) {
            // Coming back in: the rest of this edge belongs to the original edge.
            points.push(cross());
            edge.push(cell.edge[k]);
        }
    }
    return { points, edge };
}
/**
 * The territory of the sites in `inside` and its border with the others. When either
 * side is empty there is no border (and the region is everything or nothing).
 */
export function territory(sites, inside, bounds) {
    const cells = voronoiCells(sites, bounds);
    const region = [];
    const border = [];
    cells.forEach((cell, i) => {
        if (!inside.has(i) || cell.points.length < 3)
            return;
        region.push(cell.points);
        const n = cell.points.length;
        for (let k = 0; k < n; k++) {
            const origin = cell.edge[k];
            if (origin === RECT || inside.has(origin))
                continue;
            const p = cell.points[k];
            const q = cell.points[(k + 1) % n];
            if (Math.hypot(q.x - p.x, q.y - p.y) > 1e-6)
                border.push([p, q]);
        }
    });
    return { region, border };
}
/** SVG path data for polygons (closed) and for loose segments. */
export function polygonsPath(polygons) {
    return polygons.map((ps) => `M ${ps.map((p) => `${round(p.x)} ${round(p.y)}`).join(' L ')} Z`).join(' ');
}
export function segmentsPath(segments) {
    return segments.map(([p, q]) => `M ${round(p.x)} ${round(p.y)} L ${round(q.x)} ${round(q.y)}`).join(' ');
}
function round(v) {
    return Math.round(v * 100) / 100;
}
//# sourceMappingURL=voronoi.js.map