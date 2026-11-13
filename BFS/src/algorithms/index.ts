import { bfs } from './bfs.js';
import { dfs } from './dfs.js';
import type { AlgorithmDefinition } from './types.js';

/** Algorithms offered in the header's picker, in order. Add new simulations here. */
export const ALGORITHMS: readonly AlgorithmDefinition[] = [bfs, dfs];

export type { AlgorithmDefinition, Highlight, Simulation } from './types.js';
