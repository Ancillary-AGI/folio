/**
 * HDI routing discipline (microvias, layer pairs, escape discipline).
 * Part 1 of 2: types + via/stackup rules.
 */

export interface HdiLayer {
  id: string;
  kind: 'signal' | 'plane' | 'dielectric' | 'microvia';
  /** Thickness in millimetres. */
  thicknessMm: number;
}

export interface HdiStackup {
  layers: HdiLayer[];
  /** Microvia drill diameter in millimetres (laser-drilled, typically 0.075-0.15). */
  microviaDrillMm: number;
  /** Microvia pad diameter in millimetres. */
  microviaPadMm: number;
  /** Minimum microvia span in layers (1 = adjacent layers only). */
  microviaSpan: number;
}

export interface Microvia {
  id: string;
  position: { x: number; y: number };
  fromLayer: string;
  toLayer: string;
  drillMm: number;
  padMm: number;
  net: string;
}

export class HdiRoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HdiRoutingError';
  }
}

export const STD_HDI_RULES = {
  microviaDrillMm: 0.1,
  microviaPadMm: 0.25,
  microviaSpan: 1,
  minAnnularRingMm: 0.075,
} as const;

/** Validate a via span against the stackup: microvias span exactly adjacent layers. */
export function validateViaSpan(stackup: HdiStackup, fromLayer: string, toLayer: string): void {
  const from = stackup.layers.findIndex((l) => l.id === fromLayer);
  const to = stackup.layers.findIndex((l) => l.id === toLayer);
  if (from < 0) throw new HdiRoutingError(`unknown layer ${fromLayer}`);
  if (to < 0) throw new HdiRoutingError(`unknown layer ${toLayer}`);
  const span = Math.abs(to - from);
  if (span === 0) throw new HdiRoutingError('via from a layer to itself');
  if (span > stackup.microviaSpan) {
    throw new HdiRoutingError(`via ${fromLayer}→${toLayer} spans ${span} layers, max microvia span is ${stackup.microviaSpan}; use a buried/plated through via`);
  }
}

export interface GridPoint {
  x: number;
  y: number;
}

/**
 * Reconstruct the actual A* path instead of discarding it for an L-shape.
 * Takes the visited-parent map from a grid search and returns the cell path
 * from start to end. Throws when no path exists rather than returning a
 * straight line through obstacles.
 */
export function reconstructPath(
  parent: Map<string, GridPoint | null>,
  start: GridPoint,
  end: GridPoint,
): GridPoint[] {
  const key = (p: GridPoint): string => `${p.x},${p.y}`;
  if (!parent.has(key(end))) throw new HdiRoutingError('no routed path to the target');
  const path: GridPoint[] = [];
  let current: GridPoint | null | undefined = end;
  const guard = parent.size + 2;
  while (current) {
    path.push(current);
    if (current.x === start.x && current.y === start.y) break;
    current = parent.get(key(current));
    if (path.length > guard) throw new HdiRoutingError('routing parent chain is cyclic');
  }
  if (path.length === 0 || path[path.length - 1].x !== start.x || path[path.length - 1].y !== start.y) {
    throw new HdiRoutingError('routing parent chain does not reach the start');
  }
  return path.reverse();
}

/**
 * A* over a single-layer blocked-cell grid (`blocked[y][x]`), returning the
 * real Manhattan path and its length in cells. Layer changes are not modelled
 * here; use the microvia rules above for span validation.
 */
export function routeGrid(
  blocked: boolean[][],
  start: GridPoint,
  end: GridPoint,
): { path: GridPoint[]; lengthCells: number } {
  const height = blocked.length;
  const width = blocked[0]?.length ?? 0;
  const key = (p: GridPoint): string => `${p.x},${p.y}`;
  const inBounds = (p: GridPoint): boolean => p.x >= 0 && p.x < width && p.y >= 0 && p.y < height;
  if (!inBounds(start) || !inBounds(end)) throw new HdiRoutingError('route endpoint outside the grid');
  if (blocked[start.y][start.x]) throw new HdiRoutingError('route start is blocked');
  if (blocked[end.y][end.x]) throw new HdiRoutingError('route end is blocked');
  if (start.x === end.x && start.y === end.y) return { path: [start], lengthCells: 0 };

  const gScore = new Map<string, number>([[key(start), 0]]);
  const parent = new Map<string, GridPoint | null>([[key(start), null]]);
  const open: Array<{ p: GridPoint; f: number }> = [];
  const closed = new Set<string>();

  /**
   * Binary min-heap keyed on f. Sorting the open set on every expansion is
   * O(n log n) per node and dominates on realistic escape grids; the heap
   * keeps each push/pop logarithmic.
   */
  const pushOpen = (node: { p: GridPoint; f: number }): void => {
    open.push(node);
    let index = open.length - 1;
    while (index > 0) {
      const parentIndex = (index - 1) >> 1;
      if (open[parentIndex].f <= open[index].f) break;
      [open[parentIndex], open[index]] = [open[index], open[parentIndex]];
      index = parentIndex;
    }
  };
  const popOpen = (): { p: GridPoint; f: number } => {
    const top = open[0];
    const last = open.pop()!;
    if (open.length > 0) {
      open[0] = last;
      let index = 0;
      for (;;) {
        const left = 2 * index + 1;
        const right = left + 1;
        let smallest = index;
        if (left < open.length && open[left].f < open[smallest].f) smallest = left;
        if (right < open.length && open[right].f < open[smallest].f) smallest = right;
        if (smallest === index) break;
        [open[smallest], open[index]] = [open[index], open[smallest]];
        index = smallest;
      }
    }
    return top;
  };

  pushOpen({ p: start, f: Math.abs(end.x - start.x) + Math.abs(end.y - start.y) });

  while (open.length > 0) {
    const current = popOpen().p;
    const ckey = key(current);
    if (closed.has(ckey)) continue;
    closed.add(ckey);
    if (current.x === end.x && current.y === end.y) {
      const path = reconstructPath(parent, start, end);
      return { path, lengthCells: path.length - 1 };
    }
    const g = gScore.get(ckey) ?? Infinity;
    for (const next of [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ]) {
      if (!inBounds(next) || blocked[next.y][next.x] || closed.has(key(next))) continue;
      const tentative = g + 1;
      if (tentative < (gScore.get(key(next)) ?? Infinity)) {
        gScore.set(key(next), tentative);
        parent.set(key(next), current);
        pushOpen({ p: next, f: tentative + Math.abs(end.x - next.x) + Math.abs(end.y - next.y) });
      }
    }
  }
  throw new HdiRoutingError('no routed path to the target');
}

