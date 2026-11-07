import { describe, expect, it } from 'vitest';
import { glyphOrigin, layoutText } from '../src/layout.js';
import { glyphRuns, mergeRuns, pixelCount, rasterize, rectsToPath, runsToRects } from '../src/raster.js';
import { loadFont } from '../src/node.js';
import { pathPixels, tinyFont } from './helpers.js';

describe('glyphRuns', () => {
  it('emits one run per horizontal stretch of ink, in layout coordinates', () => {
    const layout = layoutText(tinyFont(), 'Ig');
    const [I, g] = layout.glyphs;
    expect(glyphRuns(I!)).toEqual([0, 1, 2, 3, 4].map((y) => ({ x: 1, y, length: 1 })));
    // 'g' is 3x4 with yOffset -1: its top row sits 3 pixels above the baseline (y=5).
    expect(glyphOrigin(g!)).toEqual({ x: 4, y: 2 });
    expect(glyphRuns(g!)).toEqual([
      { x: 4, y: 2, length: 3 },
      { x: 4, y: 3, length: 1 },
      { x: 6, y: 3, length: 1 },
      { x: 4, y: 4, length: 3 },
      { x: 6, y: 5, length: 1 },
    ]);
  });
});

describe('mergeRuns', () => {
  it('joins runs that touch or overlap on the same row', () => {
    expect(
      mergeRuns([
        { x: 4, y: 0, length: 4 },
        { x: 0, y: 0, length: 4 },
        { x: 6, y: 0, length: 5 },
      ]),
    ).toEqual([{ x: 0, y: 0, length: 11 }]);
  });

  it('keeps gaps, separate rows and sorts by row then column', () => {
    expect(
      mergeRuns([
        { x: 5, y: 1, length: 1 },
        { x: 0, y: 1, length: 2 },
        { x: 3, y: 0, length: 1 },
        { x: 0, y: 2, length: 0 },
      ]),
    ).toEqual([
      { x: 3, y: 0, length: 1 },
      { x: 0, y: 1, length: 2 },
      { x: 5, y: 1, length: 1 },
    ]);
  });

  it('does not mutate its input', () => {
    const input = [
      { x: 0, y: 0, length: 2 },
      { x: 2, y: 0, length: 2 },
    ];
    mergeRuns(input);
    expect(input[0]).toEqual({ x: 0, y: 0, length: 2 });
  });

  it('merges across glyph boundaries: "==" becomes two full-width bars', () => {
    const layout = layoutText(tinyFont(), '==');
    const runs = mergeRuns(layout.glyphs.flatMap(glyphRuns));
    expect(runs).toEqual([
      { x: 0, y: 1, length: 8 },
      { x: 0, y: 3, length: 8 },
    ]);
  });
});

describe('runsToRects', () => {
  it('stacks identical runs on consecutive rows', () => {
    const rects = runsToRects(mergeRuns(layoutText(tinyFont(), 'I').glyphs.flatMap(glyphRuns)));
    expect(rects).toEqual([{ x: 1, y: 0, width: 1, height: 5 }]);
  });

  it('does not stack across a blank row or differing runs', () => {
    const rects = runsToRects([
      { x: 0, y: 0, length: 2 },
      { x: 0, y: 1, length: 2 },
      { x: 0, y: 3, length: 2 },
      { x: 0, y: 4, length: 3 },
    ]);
    expect(rects).toEqual([
      { x: 0, y: 0, width: 2, height: 2 },
      { x: 0, y: 3, width: 2, height: 1 },
      { x: 0, y: 4, width: 3, height: 1 },
    ]);
  });

  it('tracks several columns at once', () => {
    const rects = runsToRects([
      { x: 0, y: 0, length: 1 },
      { x: 3, y: 0, length: 1 },
      { x: 0, y: 1, length: 1 },
      { x: 3, y: 1, length: 1 },
      { x: 0, y: 2, length: 4 },
    ]);
    expect(rects).toEqual([
      { x: 0, y: 0, width: 1, height: 2 },
      { x: 3, y: 0, width: 1, height: 2 },
      { x: 0, y: 2, width: 4, height: 1 },
    ]);
  });
});

describe('rectsToPath', () => {
  it('uses an absolute first move and relative moves after', () => {
    const d = rectsToPath([
      { x: 3, y: 2, width: 5, height: 1 },
      { x: 2, y: 3, width: 1, height: 5 },
      { x: 4, y: 1, width: 2, height: 2 },
    ]);
    expect(d).toBe('M3 2h5v1h-5zm-1 1h1v5h-1zm2-2h2v2h-2z');
  });

  it('applies an offset and returns an empty string for no rects', () => {
    expect(rectsToPath([{ x: 0, y: 0, width: 1, height: 1 }], { x: 2, y: 3 })).toBe('M2 3h1v1h-1z');
    expect(rectsToPath([])).toBe('');
  });
});

describe('rasterize round trip', () => {
  const font = loadFont('spleen-8x16');
  const text = 'The quick brown fox\n== jumps over 0x1F ==\n|||||| ▒░▓ ╔═╗';

  const expected = () => {
    const pixels = new Set<string>();
    for (const g of layoutText(font, text).glyphs) {
      if (!g.glyph) continue;
      const { x, y } = glyphOrigin(g);
      const { width, height } = g.glyph.bbx;
      for (let r = 0; r < height; r++)
        for (let c = 0; c < width; c++) if (g.glyph.bitmap[r * width + c]) pixels.add(`${x + c},${y + r}`);
    }
    return pixels;
  };

  it.each([true, false])('draws every lit pixel exactly once (mergeVertical=%s)', (mergeVertical) => {
    const rects = rasterize(layoutText(font, text).glyphs, { mergeVertical });
    const drawn = pathPixels(rectsToPath(rects));
    expect(drawn).toEqual(expected());
    expect(pixelCount(rects)).toBe(expected().size);
  });

  it('vertical merging produces fewer subpaths than row runs alone', () => {
    const glyphs = layoutText(font, text).glyphs;
    const rows = rasterize(glyphs, { mergeVertical: false }).length;
    const rects = rasterize(glyphs).length;
    expect(rects).toBeLessThan(rows * 0.75);
  });
});
