/**
 * Disjoint-set forest with union by rank and path compression, as in CLRS
 * (Introduction to Algorithms, 4th ed., §19.3):
 *
 *   MAKE-SET(x)        FIND-SET(x)                  LINK(x, y)
 *     x.p = x            if x ≠ x.p                   if x.rank > y.rank
 *     x.rank = 0           x.p = FIND-SET(x.p)          y.p = x
 *                        return x.p                   else x.p = y
 *   UNION(x, y)                                         if x.rank == y.rank
 *     LINK(FIND-SET(x), FIND-SET(y))                      y.rank = y.rank + 1
 *
 * Each set is a tree whose root is the set's representative.
 */
export class DisjointSet {
    p = new Map();
    rank = new Map();
    makeSet(x) {
        this.p.set(x, x);
        this.rank.set(x, 0);
    }
    /** The representative of x's set, compressing the path to it (FIND-SET). */
    findSet(x) {
        const parent = this.p.get(x);
        if (parent !== x)
            this.p.set(x, this.findSet(parent));
        return this.p.get(x);
    }
    union(x, y) {
        this.link(this.findSet(x), this.findSet(y));
    }
    /** The representative of x's set, without changing anything (for display). */
    representative(x) {
        let r = x;
        while (this.p.get(r) !== r)
            r = this.p.get(r);
        return r;
    }
    /** x's parent pointer (x.p) and rank, for inspection. */
    parentOf(x) {
        return this.p.get(x);
    }
    rankOf(x) {
        return this.rank.get(x);
    }
    link(x, y) {
        if (this.rank.get(x) > this.rank.get(y)) {
            this.p.set(y, x);
        }
        else {
            this.p.set(x, y);
            if (this.rank.get(x) === this.rank.get(y))
                this.rank.set(y, this.rank.get(y) + 1);
        }
    }
}
//# sourceMappingURL=disjoint-set.js.map