// Regenerates everything in examples/. Run with `npm run examples`.
//
// Every gallery file except banner.svg is the exact output of the CLI
// command printed next to it in the README; the commands below mirror them
// through the library API. banner.svg is a composition: two renders placed
// on a drawn sheet of line-printer paper.
//
// Palette: a sheet of continuous-form listing paper and a worn two-colour
// ribbon. Black ink does the work; red is used once per image at most.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, renderSVG } from '../dist/index.js';
import { loadFont } from '../dist/node.js';

const PAPER = '#f2eee3';
const BAR = '#dfe7d5';
const HOLE = '#d6d0c1';
const INK = '#1d1b17';
const RED = '#a8321f';
const UNLIT = '#e2dccd';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
mkdirSync(out, { recursive: true });

const s8 = loadFont('spleen-8x16');
const s12 = loadFont('spleen-12x24');
const s6 = loadFont('spleen-6x12');

const files = {
  // bitglyph "sine scroller: the wave stays put, the text moves through it" -e scroller -s 4 -p 4 --width 180 -c "#1d1b17" -b "#f2eee3"
  'scroller.svg': render(s8, 'sine scroller: the wave stays put, the text moves through it', {
    effect: 'scroller',
    scale: 4,
    padding: 4,
    width: 180,
    color: INK,
    background: PAPER,
  }),

  // bitglyph '$ npx bitglyph "hello, world"' -e typewriter -s 3 -p 6 -c "#1d1b17" -b "#f2eee3"
  'typewriter.svg': render(s8, '$ npx bitglyph "hello, world"', {
    effect: 'typewriter',
    scale: 3,
    padding: 6,
    color: INK,
    background: PAPER,
  }),

  // bitglyph "DEPARTURES 09:41" -f spleen-12x24 -s 4 -p 3 --texture dots --texture-size 0.9 --unlit "#e2dccd" -c "#a8321f" -b "#f2eee3"
  'dot-matrix.svg': renderSVG(s12, 'DEPARTURES 09:41', {
    scale: 4,
    padding: 3,
    texture: 'dots',
    textureSize: 0.9,
    unlitColor: UNLIT,
    color: RED,
    background: PAPER,
  }),

  // bitglyph "per-glyph wave" -e wave -f spleen-12x24 -s 4 -p 3 --amplitude 3 -c "#1d1b17" -b "#f2eee3"
  'wave.svg': render(s12, 'per-glyph wave', {
    effect: 'wave',
    scale: 4,
    padding: 3,
    amplitude: 3,
    color: INK,
    background: PAPER,
  }),

  // printf '┌──────────────────────┐\n│ bitglyph 0.1.0       │\n│ 3 fonts, 0 webfonts  │\n└──────────────────────┘' | bitglyph -s 3 -p 6 -c "#1d1b17" -b "#f2eee3"
  'box-drawing.svg': renderSVG(
    s8,
    ['┌──────────────────────┐', '│ bitglyph 0.1.0       │', '│ 3 fonts, 0 webfonts  │', '└──────────────────────┘'].join('\n'),
    { scale: 3, padding: 6, color: INK, background: PAPER },
  ),
};

// One word, four pixel treatments.
for (const texture of ['none', 'squares', 'dots', 'scanlines']) {
  // bitglyph "pixel" -f spleen-12x24 -s 5 -p 2 --texture <t> -c "#1d1b17" -b "#f2eee3"
  files[`texture-${texture}.svg`] = renderSVG(s12, 'pixel', {
    scale: 5,
    padding: 2,
    texture,
    color: INK,
    background: PAPER,
  });
}

// The three bundled fonts at the same scale, so their sizes compare directly.
for (const [name, font] of [['spleen-6x12', s6], ['spleen-8x16', s8], ['spleen-12x24', s12]]) {
  // bitglyph "spleen-8x16\nGlib jocks quiz\nnymph to vex dwarf." -f spleen-8x16 -s 2 -p 4 -c "#1d1b17" -b "#f2eee3"
  files[`font-${name}.svg`] = renderSVG(font, `${name}\nGlib jocks quiz\nnymph to vex dwarf.`, {
    scale: 2,
    padding: 4,
    color: INK,
    background: PAPER,
  });
}

files['banner.svg'] = banner();

for (const [name, svg] of Object.entries(files)) {
  writeFileSync(join(out, name), svg);
  console.log(`${name.padEnd(26)} ${String(svg.length).padStart(6)} bytes`);
}

/** A sheet of green-bar listing paper with the title printed on it. */
function banner() {
  const W = 840;
  const H = 300;
  const BAND = 30; // one green bar per three printed lines
  const MARGIN = 46; // tractor-feed strip on each side

  const title = renderSVG(s12, 'bitglyph', {
    scale: 7,
    texture: 'dots',
    textureSize: 1,
    color: INK,
    title: false,
    idPrefix: 'bt',
  });
  const subtitle = renderSVG(s8, 'BDF bitmap fonts as SVG pixel geometry', {
    scale: 2,
    color: RED,
    title: false,
    idPrefix: 'bs',
  });

  const size = (svg) => /width="(\d+)" height="(\d+)"/.exec(svg).slice(1).map(Number);
  const place = (svg, x, y) => svg.trim().replace('<svg ', `<svg x="${x}" y="${y}" `).replace(' role="img"', '');
  const [tw, th] = size(title);
  const [sw, sh] = size(subtitle);
  const tx = Math.round((W - tw) / 2);
  const ty = 52;
  const sx = Math.round((W - sw) / 2);
  const sy = ty + th + 22;

  const bars = [];
  for (let y = BAND; y < H; y += BAND * 2) bars.push(`<rect x="${MARGIN}" y="${y}" width="${W - 2 * MARGIN}" height="${BAND}"/>`);
  const holes = [];
  for (let y = 15; y < H; y += 30) holes.push(`<circle cx="23" cy="${y}" r="6"/><circle cx="${W - 23}" cy="${y}" r="6"/>`);
  const perforation = [MARGIN, W - MARGIN]
    .map((x) => `<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`)
    .join('');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">`,
    '<title>bitglyph: BDF bitmap fonts as SVG pixel geometry</title>',
    `<rect width="${W}" height="${H}" fill="${PAPER}"/>`,
    `<g fill="${BAR}">${bars.join('')}</g>`,
    `<g fill="${HOLE}">${holes.join('')}</g>`,
    `<g stroke="${HOLE}" stroke-width="1" stroke-dasharray="3 4">${perforation}</g>`,
    place(title, tx, ty),
    place(subtitle, sx, sy),
    '</svg>',
    '',
  ].join('\n');
}
