import type { BitmapFont } from './bdf.js';
import {
  blinkCss,
  createIds,
  defaultPrefix,
  fmt,
  reducedMotion,
  svgDocument,
  validateStyle,
  type Box,
  type Ids,
  type StyleOptions,
} from './document.js';
import { layoutBounds, layoutText, type Layout, type LayoutOptions, type PlacedGlyph } from './layout.js';
import { rasterize, rectsToPath } from './raster.js';

export type CaretStyle = 'block' | 'bar' | 'underline';

export interface RenderOptions extends LayoutOptions, StyleOptions {
  /**
   * Emit one `<path>` per glyph instead of a single merged path, so each
   * glyph can be animated. Paths get the class `<prefix>-glyph` and a
   * `--i` custom property holding the character index.
   */
  perGlyph?: boolean;
  /** Stack identical runs on consecutive rows into rectangles. Default `true`. */
  mergeVertical?: boolean;
  /** Draw a blinking caret after the text. `true` means `'block'`. */
  caret?: boolean | CaretStyle;
}

/** Everything an effect needs after layout. */
export interface Prepared {
  layout: Layout;
  ids: Ids;
  title: string;
  /** Ink + metric bounds of the text (and caret, if any) in layout coordinates. */
  bounds: Box;
  /** Translation from layout coordinates to canvas coordinates. */
  origin: { x: number; y: number };
  padding: number;
}

/** Validate options, lay out the text and work out the canvas mapping. */
export function prepare(
  font: BitmapFont,
  text: string,
  options: RenderOptions,
  effect: string,
  extraBoxes: (layout: Layout) => Box[] = () => [],
): Prepared {
  validateStyle(options);
  const layout = layoutText(font, text, options);
  let bounds = layoutBounds(layout);
  for (const b of extraBoxes(layout)) bounds = union(bounds, b);
  const padding = options.padding ?? 0;
  const ids = createIds(options.idPrefix ?? defaultPrefix(effect, font.name, text, options));
  const title = options.title === false ? '' : (options.title ?? text);
  return { layout, ids, title, bounds, padding, origin: { x: padding - bounds.x, y: padding - bounds.y } };
}

export function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** Path data for a set of glyphs, translated into canvas coordinates. */
export function glyphPath(glyphs: Iterable<PlacedGlyph>, origin: { x: number; y: number }, mergeVertical = true): string {
  return rectsToPath(rasterize(glyphs, { mergeVertical }), origin);
}

/** Glyphs that produce ink. */
export function inked(glyphs: readonly PlacedGlyph[]): PlacedGlyph[] {
  return glyphs.filter((g) => g.glyph && g.glyph.bitmap.includes(1));
}

/** Width of one character cell: the space advance, else the font box. */
export function cellWidth(font: BitmapFont): number {
  return font.glyphs.get(0x20)?.advance ?? font.boundingBox.width;
}

/** Caret rectangle relative to a pen position on the baseline. */
export function caretBox(font: BitmapFont, layout: Layout, style: CaretStyle): Box {
  const cell = cellWidth(font);
  const full = layout.ascent + layout.descent;
  switch (style) {
    case 'bar':
      return { x: 0, y: -layout.ascent, width: Math.max(1, Math.round(cell / 8)), height: full };
    case 'underline': {
      const h = Math.max(1, Math.round(full / 16));
      return { x: 0, y: layout.descent - h, width: cell, height: h };
    }
    default:
      return { x: 0, y: -layout.ascent, width: cell, height: full };
  }
}

/** Pen position just after the last character of the text. */
export function endPosition(layout: Layout): { x: number; baseline: number } {
  const line = layout.lines[layout.lines.length - 1]!;
  const last = line.glyphs[line.glyphs.length - 1];
  return { x: last ? last.x + last.advance : line.x, baseline: line.baseline };
}

export function caretStyleOf(caret: RenderOptions['caret']): CaretStyle | undefined {
  if (!caret) return undefined;
  return caret === true ? 'block' : caret;
}

/** `<rect>` markup for a caret box. */
export function caretRect(ids: Ids, box: Box): string {
  return `<rect class="${ids.cls('caret')}" x="${fmt(box.x)}" y="${fmt(box.y)}" width="${fmt(box.width)}" height="${fmt(box.height)}"/>`;
}

/**
 * Render text as a static SVG. By default the whole text becomes a single
 * `<path>`; with `perGlyph` every glyph gets its own element for animation.
 */
export function renderSVG(font: BitmapFont, text: string, options: RenderOptions = {}): string {
  const caret = caretStyleOf(options.caret);
  const p = prepare(font, text, options, 'static', (layout) => {
    if (!caret) return [];
    const end = endPosition(layout);
    const box = caretBox(font, layout, caret);
    return [{ ...box, x: box.x + end.x, y: box.y + end.baseline }];
  });
  const { layout, ids, origin } = p;
  const mergeVertical = options.mergeVertical ?? true;

  let body: string;
  if (options.perGlyph) {
    body = inked(layout.glyphs)
      .map(
        (g) =>
          `<path class="${ids.cls('glyph')}" style="--i:${g.index}" d="${glyphPath([g], origin, mergeVertical)}"/>`,
      )
      .join('');
  } else {
    body = `<path d="${glyphPath(layout.glyphs, origin, mergeVertical)}"/>`;
  }

  const css: string[] = [];
  if (caret) {
    const end = endPosition(layout);
    const box = caretBox(font, layout, caret);
    body += caretRect(ids, { ...box, x: box.x + end.x + origin.x, y: box.y + end.baseline + origin.y });
    css.push(blinkCss(ids), reducedMotion(`.${ids.cls('caret')}{animation:none}`));
  }

  return svgDocument(ids, options, p.title, {
    width: p.bounds.width + 2 * p.padding,
    height: p.bounds.height + 2 * p.padding,
    paintBox: { x: origin.x, y: origin.y, width: layout.width, height: layout.height },
    body,
    css,
  });
}
