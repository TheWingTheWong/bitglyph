import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { EFFECTS, render, type AnyEffectOptions, type Effect } from './effects.js';
import { layoutText, type Align } from './layout.js';
import { bundledFonts, loadFont } from './node.js';
import type { CaretStyle } from './svg.js';
import type { Texture } from './document.js';

export interface CliIO {
  stdout(text: string): void;
  stderr(text: string): void;
  /** Read all of standard input. */
  readStdin(): Promise<string>;
  stdinIsTTY: boolean;
  cwd: string;
}

const HELP = `bitglyph - render text in bitmap fonts as crisp SVG

Usage
  bitglyph [options] <text>
  echo "text" | bitglyph [options]

  "\\n" in <text> starts a new line.

Output
  -o, --output <file>     write the SVG to a file (default: stdout)
  -f, --font <name|path>  bundled font name or path to a .bdf (default: spleen-8x16)
  -s, --scale <n>         output pixels per font pixel (default: 4)
      --list-fonts        print bundled font names and exit

Layout
      --tracking <px>     extra space between characters (--tracking=-1 to tighten)
      --line-height <px>  distance between baselines
      --align <a>         left | center | right
  -p, --padding <px>      space around the text, in font pixels
      --fallback <char>   character drawn for glyphs the font lacks

Style
  -c, --color <c[,c..]>   fill colour; several colours make a gradient
      --gradient <dir>    vertical | horizontal (default: vertical)
  -b, --background <c>    background colour
      --radius <px>       background corner radius, in font pixels
      --texture <t>       none | dots | squares | scanlines
      --texture-size <f>  size of a textured pixel, 0-1
      --unlit <c>         colour of unlit cells (with --texture)
      --caret <style>     block | bar | underline | none
      --per-glyph         one <path> per glyph, for your own CSS animation
      --title <text>      accessible title (default: the text)

Effects
  -e, --effect <name>     none | scroller | typewriter | wave
      --speed <n>         scroller: px/s (48)   typewriter: chars/s (12)
      --amplitude <px>    scroller and wave: wave height
      --wavelength <px>   scroller: wave length
      --width <px>        scroller: window width
      --hold <s>          typewriter: seconds the full text stays up (2.5)
      --once              typewriter: type once instead of looping
      --period <s>        wave: seconds per oscillation (1.6)
      --smooth            scroller and wave: sub-pixel motion

  -h, --help              show this help
  -v, --version           show the version

Example
  bitglyph "hello world" --font spleen-8x16 --scale 6 --effect scroller -o banner.svg
`;

const OPTIONS = {
  output: { type: 'string', short: 'o' },
  font: { type: 'string', short: 'f' },
  scale: { type: 'string', short: 's' },
  'list-fonts': { type: 'boolean' },
  tracking: { type: 'string' },
  'line-height': { type: 'string' },
  align: { type: 'string' },
  padding: { type: 'string', short: 'p' },
  fallback: { type: 'string' },
  color: { type: 'string', short: 'c' },
  gradient: { type: 'string' },
  background: { type: 'string', short: 'b' },
  radius: { type: 'string' },
  texture: { type: 'string' },
  'texture-size': { type: 'string' },
  unlit: { type: 'string' },
  caret: { type: 'string' },
  'per-glyph': { type: 'boolean' },
  title: { type: 'string' },
  effect: { type: 'string', short: 'e' },
  speed: { type: 'string' },
  amplitude: { type: 'string' },
  wavelength: { type: 'string' },
  width: { type: 'string' },
  hold: { type: 'string' },
  once: { type: 'boolean' },
  period: { type: 'string' },
  smooth: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

class UsageError extends Error {}

/** Run the CLI. Returns the process exit code. */
export async function run(argv: string[], io: CliIO): Promise<number> {
  try {
    return await main(argv, io);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.stderr(`bitglyph: ${message}\n`);
    if (err instanceof UsageError || err instanceof RangeError) {
      io.stderr(`Try 'bitglyph --help'.\n`);
      return 2;
    }
    return 1;
  }
}

async function main(argv: string[], io: CliIO): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
  const { values: v, positionals } = parsed;

  if (v.help) {
    io.stdout(HELP);
    return 0;
  }
  if (v.version) {
    io.stdout(`${version()}\n`);
    return 0;
  }
  if (v['list-fonts']) {
    io.stdout(bundledFonts().join('\n') + '\n');
    return 0;
  }

  let text: string;
  if (positionals.length > 0 && !(positionals.length === 1 && positionals[0] === '-')) {
    text = positionals.join(' ').replace(/\\n/g, '\n');
  } else if (!io.stdinIsTTY || positionals[0] === '-') {
    text = (await io.readStdin()).replace(/\r?\n$/, '');
  } else {
    throw new UsageError('no text given');
  }
  if (text.trim() === '') throw new UsageError('text is empty');

  const effect = (v.effect ?? 'none') as Effect;
  if (!EFFECTS.includes(effect)) throw new UsageError(`unknown effect "${effect}" (expected ${EFFECTS.join(', ')})`);

  const options: AnyEffectOptions = {
    scale: num(v.scale, 'scale') ?? 4,
    tracking: num(v.tracking, 'tracking'),
    lineHeight: num(v['line-height'], 'line-height'),
    align: oneOf(v.align, 'align', ['left', 'center', 'right'] as const satisfies readonly Align[]),
    padding: num(v.padding, 'padding'),
    fallback: v.fallback,
    color: colors(v.color),
    gradient: oneOf(v.gradient, 'gradient', ['vertical', 'horizontal'] as const),
    background: v.background,
    radius: num(v.radius, 'radius'),
    texture: oneOf(v.texture, 'texture', ['none', 'dots', 'squares', 'scanlines'] as const satisfies readonly Texture[]),
    textureSize: num(v['texture-size'], 'texture-size'),
    unlitColor: v.unlit,
    perGlyph: v['per-glyph'],
    title: v.title,
    speed: num(v.speed, 'speed'),
    amplitude: num(v.amplitude, 'amplitude'),
    wavelength: num(v.wavelength, 'wavelength'),
    width: num(v.width, 'width'),
    hold: num(v.hold, 'hold'),
    loop: v.once ? false : undefined,
    period: num(v.period, 'period'),
    crisp: v.smooth ? false : undefined,
  };
  if (v.caret !== undefined) {
    const caret = oneOf(v.caret, 'caret', ['block', 'bar', 'underline', 'none'] as const);
    options.caret = caret === 'none' ? false : (caret as CaretStyle);
  }
  // Drop unset keys so library defaults apply.
  for (const key of Object.keys(options) as (keyof AnyEffectOptions)[]) {
    if (options[key] === undefined) delete options[key];
  }

  const font = loadFont(v.font ?? 'spleen-8x16');
  const missing = layoutText(font, text, options).missing;
  if (missing.length > 0) {
    io.stderr(`bitglyph: warning: font has no glyph for ${missing.map((c) => JSON.stringify(c)).join(' ')}\n`);
  }

  const svg = render(font, text, { ...options, effect });
  if (v.output && v.output !== '-') {
    writeFileSync(resolve(io.cwd, v.output), svg);
  } else {
    io.stdout(svg);
  }
  return 0;
}

/** "a" -> "a", "a, b" -> ["a", "b"]. */
function colors(value: string | undefined): string | string[] | undefined {
  if (value === undefined) return undefined;
  const list = value.split(',').map((c) => c.trim()).filter(Boolean);
  if (list.length === 0) throw new UsageError('--color is empty');
  return list.length === 1 ? list[0] : list;
}

function num(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (value.trim() === '' || !Number.isFinite(n)) throw new UsageError(`--${name} expects a number, got "${value}"`);
  return n;
}

function oneOf<T extends string>(value: string | undefined, name: string, allowed: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new UsageError(`--${name} must be one of ${allowed.join(', ')}, got "${value}"`);
  }
  return value as T;
}

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}
