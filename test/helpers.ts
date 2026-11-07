import { parseBDF, type BitmapFont } from '../src/bdf.js';

export interface FixtureGlyph {
  cp: number;
  name?: string;
  advance?: number;
  /** "w h xoff yoff"; omitted to test the font-box fallback. */
  bbx?: [number, number, number, number];
  /** Rows of '#' (ink) and '.' (blank). */
  rows: string[];
}

/** Build BDF source from ASCII-art glyphs. */
export function bdfSource(opts: {
  bbox?: [number, number, number, number];
  ascent?: number;
  descent?: number;
  defaultChar?: number;
  extraProps?: string[];
  glyphs: FixtureGlyph[];
}): string {
  const [bw, bh, bx, by] = opts.bbox ?? [4, 6, 0, -1];
  const props: string[] = [];
  if (opts.ascent !== undefined) props.push(`FONT_ASCENT ${opts.ascent}`);
  if (opts.descent !== undefined) props.push(`FONT_DESCENT ${opts.descent}`);
  if (opts.defaultChar !== undefined) props.push(`DEFAULT_CHAR ${opts.defaultChar}`);
  props.push(...(opts.extraProps ?? []));
  const out = [
    'STARTFONT 2.1',
    'COMMENT test fixture',
    'FONT -test-fixture-medium-r-normal--6-60-72-72-C-40-ISO10646-1',
    `SIZE ${bh} 72 72`,
    `FONTBOUNDINGBOX ${bw} ${bh} ${bx} ${by}`,
    `STARTPROPERTIES ${props.length}`,
    ...props,
    'ENDPROPERTIES',
    `CHARS ${opts.glyphs.length}`,
  ];
  for (const g of opts.glyphs) {
    const width = g.bbx ? g.bbx[0] : bw;
    out.push(`STARTCHAR ${g.name ?? `U+${g.cp.toString(16).padStart(4, '0')}`}`, `ENCODING ${g.cp}`, 'SWIDTH 500 0');
    if (g.advance !== undefined) out.push(`DWIDTH ${g.advance} 0`);
    if (g.bbx) out.push(`BBX ${g.bbx.join(' ')}`);
    out.push('BITMAP');
    const bytes = Math.ceil(width / 8);
    for (const row of g.rows) {
      let bits = 0n;
      for (let x = 0; x < bytes * 8; x++) bits = (bits << 1n) | (row[x] === '#' ? 1n : 0n);
      out.push(bits.toString(16).toUpperCase().padStart(bytes * 2, '0'));
    }
    out.push('ENDCHAR');
  }
  out.push('ENDFONT', '');
  return out.join('\n');
}

/**
 * A 4x6 monospace test font, baseline one pixel above the bottom.
 * 'I' is a 1px stem, '=' two bars spanning the full cell width, 'g' has a
 * descender, '?' is the fallback.
 */
export function tinyFont(extra: Partial<Parameters<typeof bdfSource>[0]> = {}): BitmapFont {
  return parseBDF(
    bdfSource({
      ascent: 5,
      descent: 1,
      glyphs: [
        { cp: 0x20, advance: 4, bbx: [4, 6, 0, -1], rows: ['....', '....', '....', '....', '....', '....'] },
        { cp: 0x49, advance: 4, bbx: [4, 6, 0, -1], rows: ['.#..', '.#..', '.#..', '.#..', '.#..', '....'] },
        { cp: 0x3d, advance: 4, bbx: [4, 6, 0, -1], rows: ['....', '####', '....', '####', '....', '....'] },
        { cp: 0x67, advance: 4, bbx: [3, 4, 0, -1], rows: ['###', '#.#', '###', '..#'] },
        { cp: 0x3f, advance: 4, bbx: [4, 6, 0, -1], rows: ['###.', '...#', '.##.', '....', '.#..', '....'] },
      ],
      ...extra,
    }),
  );
}

/** Decode an `M/m h v z` path (as written by rectsToPath) back into lit pixels. */
export function pathPixels(d: string): Set<string> {
  const pixels = new Set<string>();
  const tokens = d.match(/[MmhvHVz]|-?\d*\.?\d+/g) ?? [];
  let i = 0;
  let sx = 0;
  let sy = 0;
  const next = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === 'M' || cmd === 'm') {
      const x = next();
      const y = next();
      if (cmd === 'M') [sx, sy] = [x, y];
      else [sx, sy] = [sx + x, sy + y];
      if (tokens[i++] !== 'h') throw new Error('expected h');
      const w = next();
      if (tokens[i++] !== 'v') throw new Error('expected v');
      const h = next();
      if (tokens[i++] !== 'h' || next() !== -w || tokens[i++] !== 'z') throw new Error('malformed rect');
      for (let yy = sy; yy < sy + h; yy++) for (let xx = sx; xx < sx + w; xx++) {
        const key = `${xx},${yy}`;
        if (pixels.has(key)) throw new Error(`pixel ${key} drawn twice`);
        pixels.add(key);
      }
    } else {
      throw new Error(`unexpected token ${cmd}`);
    }
  }
  return pixels;
}

/** Minimal XML well-formedness check: balanced tags, quoted attributes. */
export function assertWellFormed(xml: string): void {
  const stack: string[] = [];
  const body = xml.replace(/<style>[\s\S]*?<\/style>/g, '');
  const re = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/g;
  let consumed = '';
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(body))) {
    consumed += body.slice(last, m.index).replace(/[^<]/g, '');
    last = re.lastIndex;
    const [, close, name, , selfClose] = m;
    if (close) {
      const open = stack.pop();
      if (open !== name) throw new Error(`mismatched </${name}>, expected </${open}>`);
    } else if (!selfClose) {
      stack.push(name!);
    }
  }
  consumed += body.slice(last).replace(/[^<]/g, '');
  if (consumed.length) throw new Error('stray "<" or unparsable tag');
  if (stack.length) throw new Error(`unclosed <${stack.join('>, <')}>`);
}

/** Read an attribute of the root <svg>. */
export function rootAttr(svg: string, name: string): string | undefined {
  const root = /<svg\b[^>]*>/.exec(svg)?.[0] ?? '';
  return new RegExp(`\\s${name}="([^"]*)"`).exec(root)?.[1];
}
