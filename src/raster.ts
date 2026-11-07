import { glyphOrigin, type PlacedGlyph } from './layout.js';

/** A horizontal run of lit pixels on one row. */
export interface Run {
  x: number;
  y: number;
  length: number;
}

/** An axis-aligned block of lit pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Horizontal runs of one placed glyph, in layout coordinates. */
export function glyphRuns(g: PlacedGlyph): Run[] {
  const glyph = g.glyph;
  if (!glyph) return [];
  const { width, height } = glyph.bbx;
  const { x: ox, y: oy } = glyphOrigin(g);
  const runs: Run[] = [];
  for (let row = 0; row < height; row++) {
    let start = -1;
    for (let col = 0; col <= width; col++) {
      const lit = col < width && glyph.bitmap[row * width + col] === 1;
      if (lit && start < 0) start = col;
      else if (!lit && start >= 0) {
        runs.push({ x: ox + start, y: oy + row, length: col - start });
        start = -1;
      }
    }
  }
  return runs;
}

/**
 * Merge runs that touch or overlap on the same row. Neighbouring glyphs
 * often meet edge to edge (think `==` or box-drawing characters); merging
 * them removes the seam and shortens the path.
 *
 * Output is sorted by row, then column.
 */
export function mergeRuns(runs: Iterable<Run>): Run[] {
  const sorted = [...runs].filter((r) => r.length > 0).sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Run[] = [];
  for (const run of sorted) {
    const last = out[out.length - 1];
    if (last && last.y === run.y && run.x <= last.x + last.length) {
      last.length = Math.max(last.length, run.x + run.length - last.x);
    } else {
      out.push({ ...run });
    }
  }
  return out;
}

/**
 * Stack identical runs on consecutive rows into rectangles. Vertical stems
 * collapse from one subpath per row into a single rectangle.
 *
 * Expects the sorted, merged output of {@link mergeRuns}.
 */
export function runsToRects(runs: readonly Run[]): Rect[] {
  const rects: Rect[] = [];
  // Rectangles that end on the previous row, keyed by "x:length".
  let open = new Map<string, Rect>();
  let row = Number.NaN;
  let next = new Map<string, Rect>();
  for (const run of runs) {
    if (run.y !== row) {
      open = run.y === row + 1 ? next : new Map();
      next = new Map();
      row = run.y;
    }
    const key = `${run.x}:${run.length}`;
    const rect = open.get(key);
    if (rect) {
      rect.height++;
      open.delete(key);
      next.set(key, rect);
    } else {
      const fresh = { x: run.x, y: run.y, width: run.length, height: 1 };
      rects.push(fresh);
      next.set(key, fresh);
    }
  }
  return rects.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Runs of several glyphs merged into rectangles, ready for {@link rectsToPath}. */
export function rasterize(glyphs: Iterable<PlacedGlyph>, options: { mergeVertical?: boolean } = {}): Rect[] {
  const runs: Run[] = [];
  for (const g of glyphs) runs.push(...glyphRuns(g));
  const merged = mergeRuns(runs);
  if (options.mergeVertical === false) {
    return merged.map((r) => ({ x: r.x, y: r.y, width: r.length, height: 1 }));
  }
  return runsToRects(merged);
}

/**
 * Encode rectangles as one compact SVG path. The first subpath uses an
 * absolute move; later ones move relative to the previous subpath's start
 * (where `z` leaves the pen), keeping every number small.
 *
 *     M3 2h5v1h-5z m-1 1h1v5h-1z ...
 */
export function rectsToPath(rects: readonly Rect[], offset: { x: number; y: number } = { x: 0, y: 0 }): string {
  let d = '';
  let px = 0;
  let py = 0;
  rects.forEach((r, i) => {
    const x = r.x + offset.x;
    const y = r.y + offset.y;
    d += i === 0 ? `M${x}${sep(y)}${y}` : `m${x - px}${sep(y - py)}${y - py}`;
    d += `h${r.width}v${r.height}h${-r.width}z`;
    px = x;
    py = y;
  });
  return d;
}

/** A minus sign already separates two numbers in path data. */
function sep(n: number): string {
  return n < 0 ? '' : ' ';
}

/** Number of lit pixels covered by a set of rectangles. */
export function pixelCount(rects: readonly Rect[]): number {
  return rects.reduce((sum, r) => sum + r.width * r.height, 0);
}
