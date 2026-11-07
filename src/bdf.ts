/**
 * A small, strict-but-forgiving parser for the Glyph Bitmap Distribution
 * Format (BDF 2.1 / 2.2), the plain-text bitmap font format used by X11.
 *
 * Only horizontal writing metrics are interpreted. Everything else is kept
 * around (properties) or ignored (METRICSSET, vertical metrics, SWIDTH).
 */

/** A glyph's black-box: size of the bitmap and its offset from the origin. */
export interface BoundingBox {
  /** Bitmap width in pixels. */
  width: number;
  /** Bitmap height in pixels. */
  height: number;
  /** Horizontal offset of the bitmap's left edge from the pen position. */
  xOffset: number;
  /** Vertical offset of the bitmap's bottom edge from the baseline (up is positive). */
  yOffset: number;
}

export interface Glyph {
  /** Unicode code point (BDF `ENCODING`). */
  codePoint: number;
  /** Glyph name from `STARTCHAR`. */
  name: string;
  /** Horizontal advance in pixels (BDF `DWIDTH`). */
  advance: number;
  /** Bitmap bounding box (BDF `BBX`). */
  bbx: BoundingBox;
  /**
   * Row-major bitmap, `bbx.width * bbx.height` entries, 1 = ink.
   * Row 0 is the top row of the bounding box.
   */
  bitmap: Uint8Array;
}

export type PropertyValue = string | number;

export interface BitmapFont {
  /** XLFD name from the `FONT` line. */
  name: string;
  /** `FAMILY_NAME` property, falling back to the XLFD name. */
  family: string;
  /** Nominal pixel size (`SIZE`). */
  size: number;
  /** Pixels above the baseline (`FONT_ASCENT`, or derived from the bounding box). */
  ascent: number;
  /** Pixels below the baseline (`FONT_DESCENT`, or derived from the bounding box). */
  descent: number;
  /** `FONTBOUNDINGBOX`. */
  boundingBox: BoundingBox;
  /** Code point used for missing glyphs, if the font declares `DEFAULT_CHAR`. */
  defaultChar: number | undefined;
  /** All parsed `STARTPROPERTIES` entries. */
  properties: ReadonlyMap<string, PropertyValue>;
  /** Glyphs keyed by code point. */
  glyphs: ReadonlyMap<number, Glyph>;
}

export class BDFParseError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`BDF parse error on line ${line}: ${message}`);
    this.name = 'BDFParseError';
    this.line = line;
  }
}

const REPLACEMENT_CHARACTER = 0xfffd;
const QUESTION_MARK = 0x3f;

/**
 * Parse BDF source text into a {@link BitmapFont}.
 *
 * Unencoded glyphs (`ENCODING -1` without an alternate code) are skipped,
 * since they cannot be reached from text.
 */
export function parseBDF(source: string): BitmapFont {
  const lines = source.split(/\r\n|\r|\n/);
  let i = 0;

  let name = '';
  let size = 0;
  let fontBBox: BoundingBox | undefined;
  let fontAdvance: number | undefined;
  const properties = new Map<string, PropertyValue>();
  const glyphs = new Map<number, Glyph>();
  let sawStart = false;
  let sawEnd = false;

  const fail = (message: string): never => {
    throw new BDFParseError(message, i + 1);
  };

  const ints = (args: string[], count: number, keyword: string): number[] => {
    if (args.length < count) fail(`${keyword} expects ${count} values, got ${args.length}`);
    const out: number[] = [];
    for (let k = 0; k < count; k++) {
      const n = Number(args[k]);
      if (!Number.isInteger(n)) fail(`${keyword} value "${args[k]}" is not an integer`);
      out.push(n);
    }
    return out;
  };

  const toBBox = (args: string[], keyword: string): BoundingBox => {
    const [width, height, xOffset, yOffset] = ints(args, 4, keyword) as [number, number, number, number];
    if (width < 0 || height < 0) fail(`${keyword} has a negative size`);
    return { width, height, xOffset, yOffset };
  };

  for (; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === '' || line.startsWith('COMMENT')) continue;
    const [keyword, ...args] = line.split(/\s+/) as [string, ...string[]];

    if (!sawStart) {
      if (keyword !== 'STARTFONT') fail('expected STARTFONT');
      sawStart = true;
      continue;
    }

    switch (keyword) {
      case 'FONT':
        name = line.slice(4).trim();
        break;
      case 'SIZE':
        size = ints(args, 1, keyword)[0]!;
        break;
      case 'FONTBOUNDINGBOX':
        fontBBox = toBBox(args, keyword);
        break;
      case 'DWIDTH':
        // Font-wide DWIDTH (BDF 2.2) is a default for glyphs that omit it.
        fontAdvance = ints(args, 1, keyword)[0]!;
        break;
      case 'STARTPROPERTIES':
        i = parseProperties(lines, i + 1, properties, fail);
        break;
      case 'STARTCHAR': {
        if (!fontBBox) fail('STARTCHAR before FONTBOUNDINGBOX');
        const result = parseGlyph(lines, i, line.slice(9).trim(), fontBBox!, fontAdvance, fail, (n) => (i = n));
        if (result) glyphs.set(result.codePoint, result);
        break;
      }
      case 'ENDFONT':
        sawEnd = true;
        break;
      default:
        // CHARS, METRICSSET, SWIDTH, CONTENTVERSION, vertical metrics... not needed.
        break;
    }
    if (sawEnd) break;
  }

  if (!sawStart) throw new BDFParseError('empty input: expected STARTFONT', 1);
  if (!fontBBox) throw new BDFParseError('missing FONTBOUNDINGBOX', lines.length);

  const ascentProp = properties.get('FONT_ASCENT');
  const descentProp = properties.get('FONT_DESCENT');
  const ascent = typeof ascentProp === 'number' ? ascentProp : fontBBox.height + fontBBox.yOffset;
  const descent = typeof descentProp === 'number' ? descentProp : -fontBBox.yOffset;
  const defaultProp = properties.get('DEFAULT_CHAR');
  const family = properties.get('FAMILY_NAME');

  return {
    name,
    family: typeof family === 'string' && family !== '' ? family : name,
    size: size || ascent + descent,
    ascent,
    descent,
    boundingBox: fontBBox,
    defaultChar: typeof defaultProp === 'number' ? defaultProp : undefined,
    properties,
    glyphs,
  };
}

function parseProperties(
  lines: string[],
  start: number,
  into: Map<string, PropertyValue>,
  fail: (message: string) => never,
): number {
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === '' || line.startsWith('COMMENT')) continue;
    if (line === 'ENDPROPERTIES') return i;
    const match = /^(\S+)\s*(.*)$/.exec(line)!;
    const key = match[1]!;
    const raw = match[2]!.trim();
    if (raw.startsWith('"')) {
      // Strings are double-quoted; a literal quote is written as "".
      const end = raw.lastIndexOf('"');
      into.set(key, raw.slice(1, end > 0 ? end : undefined).replace(/""/g, '"'));
    } else {
      const n = Number(raw);
      into.set(key, raw !== '' && Number.isFinite(n) ? n : raw);
    }
  }
  return fail('STARTPROPERTIES without ENDPROPERTIES');
}

function parseGlyph(
  lines: string[],
  start: number,
  glyphName: string,
  fontBBox: BoundingBox,
  fontAdvance: number | undefined,
  fail: (message: string) => never,
  seek: (line: number) => void,
): Glyph | undefined {
  let codePoint: number | undefined;
  let advance: number | undefined;
  let bbx: BoundingBox | undefined;
  let bitmap: Uint8Array | undefined;

  for (let i = start + 1; i < lines.length; i++) {
    seek(i);
    const line = lines[i]!.trim();
    if (line === '' || line.startsWith('COMMENT')) continue;
    const [keyword, ...args] = line.split(/\s+/) as [string, ...string[]];

    switch (keyword) {
      case 'ENCODING': {
        const primary = Number(args[0]);
        const alternate = args[1] !== undefined ? Number(args[1]) : undefined;
        if (!Number.isInteger(primary)) fail(`invalid ENCODING "${args[0]}"`);
        codePoint = primary >= 0 ? primary : alternate !== undefined && alternate >= 0 ? alternate : undefined;
        break;
      }
      case 'DWIDTH': {
        const n = Number(args[0]);
        if (!Number.isInteger(n)) fail(`invalid DWIDTH "${args[0]}"`);
        advance = n;
        break;
      }
      case 'BBX': {
        const [width, height, xOffset, yOffset] = args.map(Number);
        if (![width, height, xOffset, yOffset].every((n) => Number.isInteger(n))) fail('BBX expects 4 integers');
        if (width! < 0 || height! < 0) fail('BBX has a negative size');
        bbx = { width: width!, height: height!, xOffset: xOffset!, yOffset: yOffset! };
        break;
      }
      case 'BITMAP': {
        const box = bbx ?? fontBBox;
        bitmap = new Uint8Array(box.width * box.height);
        const hexPerRow = Math.ceil(box.width / 8) * 2;
        let row = 0;
        for (i = i + 1; i < lines.length; i++) {
          seek(i);
          const hex = lines[i]!.trim();
          if (hex === 'ENDCHAR') break;
          if (hex === '') continue;
          if (!/^[0-9a-fA-F]+$/.test(hex)) fail(`invalid bitmap row "${hex}"`);
          if (row >= box.height) continue; // tolerate surplus rows
          decodeRow(hex.padEnd(hexPerRow, '0'), box.width, bitmap, row * box.width);
          row++;
        }
        if (lines[i]?.trim() !== 'ENDCHAR') fail(`glyph "${glyphName}" is missing ENDCHAR`);
        return finish();
      }
      case 'ENDCHAR':
        bitmap = new Uint8Array(0);
        return finish();
      default:
        break;
    }
  }
  return fail(`glyph "${glyphName}" is missing ENDCHAR`);

  function finish(): Glyph | undefined {
    if (codePoint === undefined) return undefined;
    const box = bbx ?? fontBBox;
    return {
      codePoint,
      name: glyphName,
      advance: advance ?? fontAdvance ?? fontBBox.width,
      bbx: { ...box },
      bitmap: bitmap!.length === box.width * box.height ? bitmap! : new Uint8Array(box.width * box.height),
    };
  }
}

function decodeRow(hex: string, width: number, out: Uint8Array, offset: number): void {
  for (let x = 0; x < width; x++) {
    const nibble = parseInt(hex[x >> 2]!, 16);
    out[offset + x] = (nibble >> (3 - (x & 3))) & 1;
  }
}

/**
 * Look up the glyph for a code point, falling back to the font's
 * `DEFAULT_CHAR`, then U+FFFD, then `?`. Returns `undefined` only when
 * none of those exist.
 */
export function resolveGlyph(font: BitmapFont, codePoint: number): { glyph: Glyph | undefined; missing: boolean } {
  const direct = font.glyphs.get(codePoint);
  if (direct) return { glyph: direct, missing: false };
  for (const fallback of [font.defaultChar, REPLACEMENT_CHARACTER, QUESTION_MARK]) {
    if (fallback === undefined) continue;
    const glyph = font.glyphs.get(fallback);
    if (glyph) return { glyph, missing: true };
  }
  return { glyph: undefined, missing: true };
}
