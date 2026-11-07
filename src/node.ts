/**
 * Node.js helpers: load fonts from disk, including the bundled Spleen fonts.
 * The core of bitglyph (`bitglyph`) has no Node dependencies; this entry
 * point (`bitglyph/node`) does.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBDF, type BitmapFont } from './bdf.js';

/** Directory holding the bundled `.bdf` files. */
export const FONTS_DIR = fileURLToPath(new URL('../fonts/', import.meta.url));

/** Names of the bundled fonts, e.g. `spleen-8x16`. */
export function bundledFonts(): string[] {
  return readdirSync(FONTS_DIR)
    .filter((f) => extname(f) === '.bdf')
    .map((f) => basename(f, '.bdf'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

const cache = new Map<string, BitmapFont>();

/**
 * Load a font by bundled name (`spleen-8x16`) or by path to a `.bdf` file.
 * Parsed fonts are cached per path.
 */
export function loadFont(nameOrPath: string): BitmapFont {
  const path = isBundledName(nameOrPath) ? `${FONTS_DIR}${nameOrPath}.bdf` : nameOrPath;
  let font = cache.get(path);
  if (!font) {
    let source: string;
    try {
      source = readFileSync(path, 'utf8');
    } catch (err) {
      const known = bundledFonts().join(', ');
      throw new Error(`cannot read font "${nameOrPath}" (bundled fonts: ${known})`, { cause: err });
    }
    font = parseBDF(source);
    cache.set(path, font);
  }
  return font;
}

function isBundledName(s: string): boolean {
  return /^[\w.-]+$/.test(s) && !s.endsWith('.bdf') && bundledFonts().includes(s);
}
