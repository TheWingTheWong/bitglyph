import { describe, expect, it } from 'vitest';
import { BDFParseError, parseBDF, resolveGlyph } from '../src/bdf.js';
import { FONTS_DIR, bundledFonts, loadFont } from '../src/node.js';
import { bdfSource, tinyFont } from './helpers.js';

const bits = (g: { bitmap: Uint8Array; bbx: { width: number } }) => {
  const rows: string[] = [];
  for (let i = 0; i < g.bitmap.length; i += g.bbx.width) {
    rows.push([...g.bitmap.slice(i, i + g.bbx.width)].map((b) => (b ? '#' : '.')).join(''));
  }
  return rows;
};

describe('parseBDF', () => {
  it('reads font-level metadata and properties', () => {
    const font = parseBDF(
      bdfSource({
        bbox: [4, 6, 0, -1],
        ascent: 5,
        descent: 1,
        defaultChar: 0x3f,
        extraProps: ['FAMILY_NAME "Tiny ""Test"" Sans"', 'PIXEL_SIZE 6', 'FOUNDRY "misc"'],
        glyphs: [{ cp: 0x41, advance: 4, rows: ['.##.', '#..#', '####', '#..#', '#..#', '....'] }],
      }),
    );
    expect(font.name).toBe('-test-fixture-medium-r-normal--6-60-72-72-C-40-ISO10646-1');
    expect(font.family).toBe('Tiny "Test" Sans');
    expect(font.size).toBe(6);
    expect(font.ascent).toBe(5);
    expect(font.descent).toBe(1);
    expect(font.defaultChar).toBe(0x3f);
    expect(font.boundingBox).toEqual({ width: 4, height: 6, xOffset: 0, yOffset: -1 });
    expect(font.properties.get('PIXEL_SIZE')).toBe(6);
    expect(font.properties.get('FOUNDRY')).toBe('misc');
  });

  it('derives ascent and descent from FONTBOUNDINGBOX when properties are absent', () => {
    const font = parseBDF(bdfSource({ bbox: [8, 16, 0, -4], glyphs: [] }));
    expect(font.ascent).toBe(12);
    expect(font.descent).toBe(4);
    expect(font.family).toBe(font.name);
  });

  it('decodes bitmaps MSB-first and keeps BBX offsets', () => {
    const font = tinyFont();
    const g = font.glyphs.get(0x67)!;
    expect(g.bbx).toEqual({ width: 3, height: 4, xOffset: 0, yOffset: -1 });
    expect(g.advance).toBe(4);
    expect(bits(g)).toEqual(['###', '#.#', '###', '..#']);
  });

  it('decodes glyphs wider than one byte', () => {
    const font = parseBDF(
      bdfSource({
        bbox: [10, 2, 0, 0],
        glyphs: [{ cp: 0x57, advance: 11, bbx: [10, 2, 1, 0], rows: ['#........#', '.########.'] }],
      }),
    );
    const g = font.glyphs.get(0x57)!;
    expect(bits(g)).toEqual(['#........#', '.########.']);
    expect(g.bbx.xOffset).toBe(1);
    expect(g.advance).toBe(11);
  });

  it('falls back to the font box and font-wide DWIDTH for glyphs that omit them', () => {
    const src = bdfSource({ bbox: [3, 2, 0, 0], glyphs: [{ cp: 0x2e, rows: ['...', '.#.'] }] }).replace(
      'STARTPROPERTIES',
      'DWIDTH 5 0\nSTARTPROPERTIES',
    );
    const g = parseBDF(src).glyphs.get(0x2e)!;
    expect(g.bbx).toEqual({ width: 3, height: 2, xOffset: 0, yOffset: 0 });
    expect(g.advance).toBe(5);
    expect(bits(g)).toEqual(['...', '.#.']);
  });

  it('uses the font box width as advance when there is no DWIDTH at all', () => {
    const g = parseBDF(bdfSource({ bbox: [3, 1, 0, 0], glyphs: [{ cp: 0x2d, rows: ['###'] }] })).glyphs.get(0x2d)!;
    expect(g.advance).toBe(3);
  });

  it('skips unencoded glyphs but honours an alternate encoding', () => {
    const src = bdfSource({
      bbox: [2, 1, 0, 0],
      glyphs: [
        { cp: 0x41, advance: 2, rows: ['#.'] },
        { cp: 0x42, advance: 2, rows: ['.#'] },
      ],
    })
      .replace('ENCODING 65', 'ENCODING -1')
      .replace('ENCODING 66', 'ENCODING -1 67');
    const font = parseBDF(src);
    expect([...font.glyphs.keys()]).toEqual([0x43]);
  });

  it('accepts CRLF line endings, lowercase hex and short or surplus rows', () => {
    const src = [
      'STARTFONT 2.1',
      'FONTBOUNDINGBOX 8 3 0 0',
      'STARTCHAR a',
      'ENCODING 97',
      'DWIDTH 8 0',
      'BBX 8 3 0 0',
      'BITMAP',
      'ff',
      '8',
      'ENDCHAR',
      'STARTCHAR b',
      'ENCODING 98',
      'BBX 8 1 0 0',
      'BITMAP',
      '0f',
      'f0',
      'ENDCHAR',
      'ENDFONT',
    ].join('\r\n');
    const font = parseBDF(src);
    expect(bits(font.glyphs.get(97)!)).toEqual(['########', '#.......', '........']);
    expect(bits(font.glyphs.get(98)!)).toEqual(['....####']);
  });

  it('reports errors with line numbers', () => {
    expect(() => parseBDF('')).toThrow(BDFParseError);
    expect(() => parseBDF('hello')).toThrow(/line 1: expected STARTFONT/);
    expect(() => parseBDF('STARTFONT 2.1\nFONTBOUNDINGBOX 4 x 0 0')).toThrow(/line 2: .*not an integer/);
    expect(() => parseBDF('STARTFONT 2.1\nSTARTCHAR a\nENCODING 97')).toThrow(/before FONTBOUNDINGBOX/);
    const truncated = 'STARTFONT 2.1\nFONTBOUNDINGBOX 4 1 0 0\nSTARTCHAR a\nENCODING 97\nBITMAP\nF0';
    expect(() => parseBDF(truncated)).toThrow(/missing ENDCHAR/);
    const badHex = 'STARTFONT 2.1\nFONTBOUNDINGBOX 4 1 0 0\nSTARTCHAR a\nENCODING 97\nBITMAP\nZZ\nENDCHAR';
    try {
      parseBDF(badHex);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BDFParseError);
      expect((err as BDFParseError).line).toBe(6);
    }
  });
});

describe('resolveGlyph', () => {
  it('returns the glyph itself when present', () => {
    const font = tinyFont();
    expect(resolveGlyph(font, 0x49)).toEqual({ glyph: font.glyphs.get(0x49), missing: false });
  });

  it('prefers DEFAULT_CHAR, then U+FFFD, then "?"', () => {
    const withDefault = tinyFont({ defaultChar: 0x3d });
    expect(resolveGlyph(withDefault, 0x2603).glyph?.codePoint).toBe(0x3d);
    expect(resolveGlyph(withDefault, 0x2603).missing).toBe(true);
    expect(resolveGlyph(tinyFont(), 0x2603).glyph?.codePoint).toBe(0x3f);
  });

  it('returns undefined when no fallback exists', () => {
    const font = parseBDF(bdfSource({ glyphs: [] }));
    expect(resolveGlyph(font, 0x41)).toEqual({ glyph: undefined, missing: true });
  });
});

describe('bundled Spleen fonts', () => {
  it('ships three sizes', () => {
    expect(bundledFonts()).toEqual(['spleen-6x12', 'spleen-8x16', 'spleen-12x24']);
  });

  it.each([
    ['spleen-6x12', 6, 12],
    ['spleen-8x16', 8, 16],
    ['spleen-12x24', 12, 24],
  ])('%s parses with consistent metrics', (name, w, h) => {
    const font = loadFont(name);
    expect(font.family).toBe('Spleen');
    expect(font.ascent + font.descent).toBe(h);
    expect(font.glyphs.size).toBeGreaterThan(500);
    for (const cp of [0x20, 0x41, 0x67, 0x7e]) expect(font.glyphs.get(cp)?.advance).toBe(w);
    const A = font.glyphs.get(0x41)!;
    expect(A.bitmap.length).toBe(A.bbx.width * A.bbx.height);
    expect(A.bitmap.includes(1)).toBe(true);
  });

  it('caches parsed fonts and accepts file paths', () => {
    expect(loadFont('spleen-8x16')).toBe(loadFont('spleen-8x16'));
    expect(loadFont(`${FONTS_DIR}spleen-6x12.bdf`).ascent).toBe(loadFont('spleen-6x12').ascent);
    expect(() => loadFont('no-such-font')).toThrow(/bundled fonts: spleen-6x12/);
  });
});
