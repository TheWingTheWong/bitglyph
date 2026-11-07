import { resolveGlyph, type BitmapFont, type Glyph } from './bdf.js';

export type Align = 'left' | 'center' | 'right';

export interface LayoutOptions {
  /** Extra pixels between glyphs (may be negative). Default `0`. */
  tracking?: number;
  /** Distance between baselines in font pixels. Default `ascent + descent`. */
  lineHeight?: number;
  /** Horizontal alignment of lines against the widest line. Default `'left'`. */
  align?: Align;
  /** Spaces per tab character. Default `4`. */
  tabSize?: number;
  /**
   * Character to draw for code points the font lacks. Defaults to the
   * font's own fallback chain (DEFAULT_CHAR, U+FFFD, `?`).
   */
  fallback?: string;
}

export interface PlacedGlyph {
  /** The source character (one code point). */
  char: string;
  codePoint: number;
  /** Glyph actually drawn (may be a fallback); `undefined` draws nothing. */
  glyph: Glyph | undefined;
  /** True when the font had no glyph for `codePoint`. */
  missing: boolean;
  /** Index of this character among all placed characters, across lines. */
  index: number;
  /** Line number, from 0. */
  line: number;
  /** Pen position (left edge of the advance box), in font pixels. */
  x: number;
  /** Baseline position, in font pixels, measured down from the top. */
  baseline: number;
  /** Horizontal advance including tracking. */
  advance: number;
}

export interface LayoutLine {
  /** Left edge after alignment. */
  x: number;
  baseline: number;
  /** Advance width of the line (tracking between glyphs, not after the last). */
  width: number;
  glyphs: PlacedGlyph[];
}

export interface Layout {
  lines: LayoutLine[];
  /** All glyphs in reading order. */
  glyphs: PlacedGlyph[];
  /** Width of the widest line. */
  width: number;
  /** `(lines - 1) * lineHeight + ascent + descent`. */
  height: number;
  ascent: number;
  descent: number;
  lineHeight: number;
  /** Distinct characters that had no glyph in the font. */
  missing: string[];
}

/** Ink extents of a layout; may extend past the metric box. */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Place every character of `text` on a pixel grid. Coordinates are integer
 * font pixels with the origin at the top-left of the first line's cell.
 */
export function layoutText(font: BitmapFont, text: string, options: LayoutOptions = {}): Layout {
  const tracking = options.tracking ?? 0;
  const lineHeight = options.lineHeight ?? font.ascent + font.descent;
  const tab = ' '.repeat(options.tabSize ?? 4);
  const fallbackCp = options.fallback ? options.fallback.codePointAt(0) : undefined;
  const missing = new Set<string>();

  if (!Number.isFinite(tracking)) throw new RangeError('tracking must be a finite number');
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) throw new RangeError('lineHeight must be a positive number');

  const rawLines = text.replace(/\r\n?/g, '\n').replace(/\t/g, tab).split('\n');
  const lines: LayoutLine[] = [];
  const all: PlacedGlyph[] = [];

  rawLines.forEach((raw, lineIndex) => {
    const baseline = lineIndex * lineHeight + font.ascent;
    const placed: PlacedGlyph[] = [];
    let pen = 0;
    for (const char of raw) {
      const codePoint = char.codePointAt(0)!;
      if (codePoint < 0x20 || codePoint === 0x7f) continue; // other control characters
      let { glyph, missing: isMissing } = resolveGlyph(font, codePoint);
      if (isMissing) {
        missing.add(char);
        if (fallbackCp !== undefined) glyph = font.glyphs.get(fallbackCp) ?? glyph;
      }
      const advance = (glyph?.advance ?? font.boundingBox.width) + tracking;
      placed.push({ char, codePoint, glyph, missing: isMissing, index: 0, line: lineIndex, x: pen, baseline, advance });
      pen += advance;
    }
    // Tracking separates glyphs; it does not pad the end of the line.
    const width = placed.length > 0 ? Math.max(0, pen - tracking) : 0;
    lines.push({ x: 0, baseline, width, glyphs: placed });
  });

  const width = Math.max(0, ...lines.map((l) => l.width));
  const align = options.align ?? 'left';
  for (const line of lines) {
    const slack = width - line.width;
    // Round so glyphs stay on the pixel grid.
    line.x = align === 'center' ? Math.floor(slack / 2) : align === 'right' ? slack : 0;
    for (const g of line.glyphs) {
      g.x += line.x;
      g.index = all.length;
      all.push(g);
    }
  }

  return {
    lines,
    glyphs: all,
    width,
    height: (lines.length - 1) * lineHeight + font.ascent + font.descent,
    ascent: font.ascent,
    descent: font.descent,
    lineHeight,
    missing: [...missing],
  };
}

/** Measure text without keeping the placement details. */
export function measureText(
  font: BitmapFont,
  text: string,
  options: LayoutOptions = {},
): { width: number; height: number; lines: number[] } {
  const layout = layoutText(font, text, options);
  return { width: layout.width, height: layout.height, lines: layout.lines.map((l) => l.width) };
}

/** Top-left pixel of a placed glyph's bitmap. */
export function glyphOrigin(g: PlacedGlyph): { x: number; y: number } {
  const bbx = g.glyph!.bbx;
  return { x: g.x + bbx.xOffset, y: g.baseline - (bbx.yOffset + bbx.height) };
}

/**
 * Union of the metric box `(0, 0, width, height)` and every glyph's bitmap
 * box, so glyphs that overhang their cell are never clipped.
 */
export function layoutBounds(layout: Layout): Bounds {
  let x0 = 0;
  let y0 = 0;
  let x1 = layout.width;
  let y1 = layout.height;
  for (const g of layout.glyphs) {
    if (!g.glyph || g.glyph.bitmap.length === 0) continue;
    const { x, y } = glyphOrigin(g);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + g.glyph.bbx.width);
    y1 = Math.max(y1, y + g.glyph.bbx.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
