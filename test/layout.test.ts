import { describe, expect, it } from 'vitest';
import { glyphOrigin, layoutBounds, layoutText, measureText } from '../src/layout.js';
import { parseBDF } from '../src/bdf.js';
import { loadFont } from '../src/node.js';
import { bdfSource, tinyFont } from './helpers.js';

const font = tinyFont();

describe('layoutText metrics', () => {
  it('sums advances along a line', () => {
    const l = layoutText(font, 'I=I');
    expect(l.width).toBe(12);
    expect(l.glyphs.map((g) => g.x)).toEqual([0, 4, 8]);
    expect(l.height).toBe(6);
    expect(l.ascent).toBe(5);
    expect(l.descent).toBe(1);
  });

  it('adds tracking between glyphs but not after the last', () => {
    expect(layoutText(font, 'III', { tracking: 2 }).width).toBe(16);
    expect(layoutText(font, 'III', { tracking: 2 }).glyphs.map((g) => g.x)).toEqual([0, 6, 12]);
    expect(layoutText(font, 'III', { tracking: -1 }).width).toBe(10);
    expect(layoutText(font, 'I', { tracking: 5 }).width).toBe(4);
  });

  it('stacks lines by line height, defaulting to ascent + descent', () => {
    const l = layoutText(font, 'I\nI\nI');
    expect(l.lines.map((line) => line.baseline)).toEqual([5, 11, 17]);
    expect(l.height).toBe(18);
    const spaced = layoutText(font, 'I\nI', { lineHeight: 9 });
    expect(spaced.lines.map((line) => line.baseline)).toEqual([5, 14]);
    expect(spaced.height).toBe(15);
  });

  it('aligns lines against the widest one, staying on whole pixels', () => {
    const text = 'IIII\nI\nII';
    expect(layoutText(font, text, { align: 'left' }).lines.map((l) => l.x)).toEqual([0, 0, 0]);
    expect(layoutText(font, text, { align: 'right' }).lines.map((l) => l.x)).toEqual([0, 12, 8]);
    expect(layoutText(font, text, { align: 'center' }).lines.map((l) => l.x)).toEqual([0, 6, 4]);
    const odd = layoutText(font, 'III\nI', { align: 'center', tracking: 1 });
    expect(odd.lines[1]!.x).toBe(Math.floor((14 - 4) / 2));
    expect(odd.glyphs[3]!.x).toBe(odd.lines[1]!.x);
  });

  it('positions bitmaps using BBX offsets relative to the baseline', () => {
    const l = layoutText(font, 'gg\ng');
    // bbx 3x4 at yOffset -1: top = baseline - (yOffset + height) = baseline - 3
    expect(glyphOrigin(l.glyphs[0]!)).toEqual({ x: 0, y: 2 });
    expect(glyphOrigin(l.glyphs[1]!)).toEqual({ x: 4, y: 2 });
    expect(glyphOrigin(l.glyphs[2]!)).toEqual({ x: 0, y: 8 });
  });

  it('numbers glyphs in reading order across lines', () => {
    const l = layoutText(font, 'I=\n\ng');
    expect(l.glyphs.map((g) => [g.char, g.index, g.line])).toEqual([
      ['I', 0, 0],
      ['=', 1, 0],
      ['g', 2, 2],
    ]);
    expect(l.lines[1]!.width).toBe(0);
  });

  it('normalises CRLF, expands tabs and drops control characters', () => {
    const l = layoutText(font, 'I\tI\r\nI\u0007', { tabSize: 2 });
    expect(l.lines).toHaveLength(2);
    expect(l.lines[0]!.glyphs.map((g) => g.char).join('')).toBe('I  I');
    expect(l.lines[1]!.glyphs).toHaveLength(1);
  });

  it('treats astral characters as one glyph', () => {
    const l = layoutText(font, 'I😀I');
    expect(l.glyphs).toHaveLength(3);
    expect(l.glyphs[1]!.codePoint).toBe(0x1f600);
  });

  it('reports missing characters and draws the fallback glyph', () => {
    const l = layoutText(font, 'I☃I☃');
    expect(l.missing).toEqual(['☃']);
    expect(l.glyphs[1]!.missing).toBe(true);
    expect(l.glyphs[1]!.glyph?.codePoint).toBe(0x3f);
    expect(layoutText(font, '☃', { fallback: '=' }).glyphs[0]!.glyph?.codePoint).toBe(0x3d);
  });

  it('rejects nonsensical options', () => {
    expect(() => layoutText(font, 'I', { lineHeight: 0 })).toThrow(RangeError);
    expect(() => layoutText(font, 'I', { tracking: Number.NaN })).toThrow(RangeError);
  });
});

describe('measureText', () => {
  it('matches the Spleen cell grid', () => {
    const spleen = loadFont('spleen-8x16');
    expect(measureText(spleen, 'hello world')).toEqual({ width: 88, height: 16, lines: [88] });
    expect(measureText(spleen, 'ab\nabcd', { tracking: 1 })).toEqual({ width: 35, height: 32, lines: [17, 35] });
  });
});

describe('layoutBounds', () => {
  it('equals the metric box when glyphs stay inside their cells', () => {
    expect(layoutBounds(layoutText(font, 'I=g'))).toEqual({ x: 0, y: 0, width: 12, height: 6 });
  });

  it('grows to include glyphs that overhang their cell', () => {
    const overhang = parseBDF(
      bdfSource({
        ascent: 2,
        descent: 0,
        bbox: [2, 2, 0, 0],
        glyphs: [
          // A 4x4 glyph shifted 1px left and 1px down, wider than its 2px advance.
          { cp: 0x56, advance: 2, bbx: [4, 4, -1, -1], rows: ['#..#', '#..#', '.##.', '.##.'] },
        ],
      }),
    );
    const l = layoutText(overhang, 'V');
    expect(l.width).toBe(2);
    expect(layoutBounds(l)).toEqual({ x: -1, y: -1, width: 4, height: 4 });
  });
});
