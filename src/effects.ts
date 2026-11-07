/**
 * Animated SVG effects. Everything is plain CSS inside the SVG, so the
 * output animates as an `<img>` on GitHub, in browsers and in most SVG
 * viewers, with no JavaScript. Every effect honours
 * `prefers-reduced-motion` by falling back to a still frame.
 */
import type { BitmapFont } from './bdf.js';
import { blinkCss, fmt, reducedMotion, svgDocument, type Box } from './document.js';
import type { Layout } from './layout.js';
import {
  caretBox,
  caretRect,
  caretStyleOf,
  glyphPath,
  inked,
  prepare,
  renderSVG,
  type CaretStyle,
  type RenderOptions,
} from './svg.js';

export interface ScrollerOptions extends RenderOptions {
  /** Visible window width in font pixels. Default: the text width, capped at 40 cells. */
  width?: number;
  /** Peak wave displacement in font pixels. Default: a quarter of the line height. */
  amplitude?: number;
  /** Wave length in font pixels. Default: two thirds of the window width. */
  wavelength?: number;
  /** Scroll speed in font pixels per second. Default `48`. */
  speed?: number;
  /** Width of each wave slice in font pixels. Default `1`. */
  sliceWidth?: number;
  /** Snap the wave and the scroll to whole font pixels. Default `true`. */
  crisp?: boolean;
}

export interface TypewriterOptions extends RenderOptions {
  /** Characters typed per second. Default `12`. */
  speed?: number;
  /** Seconds the finished text stays on screen before it is wiped. Default `2.5`. */
  hold?: number;
  /** Repeat forever (type, hold, wipe). With `false` it types once and stays. Default `true`. */
  loop?: boolean;
}

export interface WaveOptions extends RenderOptions {
  /** Peak displacement of each glyph in font pixels. Default `2`. */
  amplitude?: number;
  /** Seconds per full oscillation. Default `1.6`. */
  period?: number;
  /** Phase shift between neighbouring characters, in turns. Default `0.08`. */
  spread?: number;
  /** Snap displacement to whole font pixels. Default `true`. */
  crisp?: boolean;
}

export type Effect = 'none' | 'scroller' | 'typewriter' | 'wave';

export const EFFECTS: readonly Effect[] = ['none', 'scroller', 'typewriter', 'wave'];

export type AnyEffectOptions = ScrollerOptions & TypewriterOptions & WaveOptions;

/** Render with the named effect; `'none'` is {@link renderSVG}. */
export function render(
  font: BitmapFont,
  text: string,
  options: AnyEffectOptions & { effect?: Effect } = {},
): string {
  const { effect = 'none', ...rest } = options;
  switch (effect) {
    case 'none':
      return renderSVG(font, text, rest);
    case 'scroller':
      return scroller(font, text, rest);
    case 'typewriter':
      return typewriter(font, text, rest);
    case 'wave':
      return wave(font, text, rest);
    default:
      throw new RangeError(`unknown effect "${String(effect)}" (expected ${EFFECTS.join(', ')})`);
  }
}

/**
 * Sine scroller, demoscene style. Text scrolls right to left through a
 * window while a sine wave bends it. The wave is fixed to the screen, not
 * to the text: each character rises and falls as it travels across.
 *
 * How: the text is defined once and the window is cut into vertical
 * slices. Each slice is a nested `<svg>` (which clips to its viewport) at a
 * fixed vertical offset taken from the sine at that slice's x position, and
 * shows the text through a `<use>`. Every `<use>` runs the same horizontal
 * scroll animation, so the only moving part is one shared translateX.
 * Neighbouring slices with the same offset are merged.
 */
export function scroller(font: BitmapFont, text: string, options: ScrollerOptions = {}): string {
  const p = prepare(font, text, { ...options, caret: false }, 'scroller');
  const { layout, ids, bounds } = p;
  const crisp = options.crisp ?? true;
  const cell = font.glyphs.get(0x20)?.advance ?? font.boundingBox.width;
  const view = Math.max(1, Math.round(options.width ?? Math.min(bounds.width, 40 * cell)));
  const amplitude = options.amplitude ?? Math.round(layout.lineHeight / 4);
  const wavelength = options.wavelength ?? Math.max(1, (view * 2) / 3);
  const speed = options.speed ?? 48;
  const slice = options.sliceWidth ?? 1;
  for (const [name, v] of [['width', view], ['wavelength', wavelength], ['speed', speed], ['sliceWidth', slice]] as const) {
    if (!(Number.isFinite(v) && v > 0)) throw new RangeError(`${name} must be a positive number`);
  }
  if (!(Number.isFinite(amplitude) && amplitude >= 0)) throw new RangeError('amplitude must be a non-negative number');

  const pad = p.padding;
  const lift = Math.ceil(amplitude);
  const contentHeight = bounds.height;

  // The text, once, at the origin of its own coordinate system.
  const textId = ids.id('text');
  const defs = [`<g id="${textId}"><path d="${glyphPath(layout.glyphs, { x: -bounds.x, y: -bounds.y })}"/></g>`];

  // Slice the window; merge runs of slices that share an offset.
  const slices: { x: number; width: number; dy: number }[] = [];
  for (let x = 0; x < view; x += slice) {
    const width = Math.min(slice, view - x);
    const raw = amplitude * Math.sin((2 * Math.PI * (x + width / 2)) / wavelength);
    const dy = crisp ? Math.round(raw) : raw;
    const prev = slices[slices.length - 1];
    if (prev && prev.dy === dy) prev.width += width;
    else slices.push({ x, width, dy });
  }

  const scrollCls = ids.cls('scroll');
  const body = slices
    .map(
      (s) =>
        `<svg x="${fmt(pad + s.x)}" y="${fmt(pad + lift + s.dy)}" width="${fmt(s.width)}" height="${fmt(contentHeight)}" viewBox="${fmt(s.x)} 0 ${fmt(s.width)} ${fmt(contentHeight)}"><use href="#${textId}" class="${scrollCls}"/></svg>`,
    )
    .join('');

  // Enter at the right edge, leave fully past the left edge.
  const distance = view + bounds.width;
  const duration = distance / speed;
  const timing = crisp ? `steps(${Math.round(distance)})` : 'linear';
  const keyframes = ids.cls('scroll-kf');
  const css = [
    `.${scrollCls}{animation:${keyframes} ${fmt(duration)}s ${timing} infinite}`,
    `@keyframes ${keyframes}{from{transform:translateX(${fmt(view)}px)}to{transform:translateX(${fmt(-bounds.width)}px)}}`,
    reducedMotion(`.${scrollCls}{animation:none}`),
  ];

  return svgDocument(ids, options, p.title, {
    width: view + 2 * pad,
    height: contentHeight + 2 * lift + 2 * pad,
    // The gradient is applied in the text's own coordinates (inside <use>).
    paintBox: { x: 0, y: 0, width: bounds.width, height: bounds.height },
    body,
    defs,
    css,
  });
}

/**
 * Typewriter reveal. Characters appear one at a time behind a caret, the
 * finished text holds, then is wiped in reading order and typed again.
 *
 * All glyphs share one keyframe rule; only their `animation-delay` differs.
 * Because each glyph is visible for the same span of its own cycle, they
 * appear in order and disappear in order, which is what makes a single rule
 * enough. The caret is a separate element whose keyframes track the pen.
 */
export function typewriter(font: BitmapFont, text: string, options: TypewriterOptions = {}): string {
  const caret: CaretStyle | undefined = options.caret === undefined ? 'block' : caretStyleOf(options.caret);
  const speed = options.speed ?? 12;
  const hold = options.hold ?? 2.5;
  const loop = options.loop ?? true;
  if (!(Number.isFinite(speed) && speed > 0)) throw new RangeError('speed must be a positive number');
  if (!(Number.isFinite(hold) && hold >= 0)) throw new RangeError('hold must be a non-negative number');

  const step = 1 / speed;
  const at = (i: number) => (i + 1) * step; // glyph i appears at this time
  const p = prepare(font, text, { ...options, caret: false }, 'typewriter', (layout) =>
    caret ? caretStops(layout).map((s) => offsetBox(caretBox(font, layout, caret), s.x, s.baseline)) : [],
  );
  const { layout, ids, origin } = p;

  const n = layout.glyphs.length;
  const typing = n * step;
  const visible = typing + hold; // how long each glyph stays up per cycle
  const period = visible + typing + 0.6; // wipe takes as long as typing, then a short pause

  const glyphCls = ids.cls('type');
  const glyphKf = ids.cls('type-kf');
  const body: string[] = [];
  for (const g of inked(layout.glyphs)) {
    body.push(
      `<path class="${glyphCls}" style="--i:${g.index};animation-delay:${fmt(at(g.index))}s" d="${glyphPath([g], origin)}"/>`,
    );
  }

  const css: string[] = [];
  if (loop) {
    css.push(
      `.${glyphCls}{opacity:0;animation:${glyphKf} ${fmt(period)}s step-end infinite}`,
      `@keyframes ${glyphKf}{0%{opacity:1}${pct(visible / period)}{opacity:0}}`,
    );
  } else {
    css.push(
      `.${glyphCls}{opacity:0;animation:${glyphKf} 1ms step-end forwards}`,
      `@keyframes ${glyphKf}{from,to{opacity:1}}`,
    );
  }
  const still = [`.${glyphCls}{opacity:1;animation:none}`];

  if (caret) {
    const box = caretBox(font, layout, caret);
    const stops = caretStops(layout);
    const moveCls = ids.cls('pen');
    const moveKf = ids.cls('pen-kf');
    const span = loop ? period : typing || step;
    const last = stops[stops.length - 1]!;
    const translate = (s: { x: number; baseline: number }) =>
      `translate(${fmt(s.x + origin.x)}px,${fmt(s.baseline + origin.y)}px)`;
    const frames = stops.map((s) => `${pct(s.time / span)}{transform:${translate(s)}}`).join('');
    const iteration = loop ? 'infinite' : '1 forwards';
    body.push(`<g class="${moveCls}">${caretRect(ids, box)}</g>`);
    css.push(
      `.${moveCls}{transform:${translate(last)};animation:${moveKf} ${fmt(span)}s step-end ${iteration}}`,
      `@keyframes ${moveKf}{${frames}}`,
      blinkCss(ids),
    );
    still.push(`.${moveCls},.${ids.cls('caret')}{animation:none}`);
  }
  css.push(reducedMotion(still.join('')));

  return svgDocument(ids, options, p.title, {
    width: p.bounds.width + 2 * p.padding,
    height: p.bounds.height + 2 * p.padding,
    paintBox: { x: origin.x, y: origin.y, width: layout.width, height: layout.height },
    body: body.join(''),
    css,
  });

  /** Where the pen sits, and from when: start of text, then after each character. */
  function caretStops(l: Layout): { time: number; x: number; baseline: number }[] {
    const first = l.lines[0]!;
    const stops = [{ time: 0, x: first.x, baseline: first.baseline }];
    for (const g of l.glyphs) stops.push({ time: at(g.index), x: g.x + g.advance, baseline: g.baseline });
    return stops;
  }
}

/**
 * Per-glyph sine wave: every character bobs up and down, each a little
 * behind its left neighbour. Unlike {@link scroller}, the wave travels with
 * the text. The motion is a sampled sine in keyframes, snapped to whole
 * pixels unless `crisp` is off.
 */
export function wave(font: BitmapFont, text: string, options: WaveOptions = {}): string {
  const amplitude = options.amplitude ?? 2;
  const period = options.period ?? 1.6;
  const spread = options.spread ?? 0.08;
  const crisp = options.crisp ?? true;
  if (!(Number.isFinite(amplitude) && amplitude >= 0)) throw new RangeError('amplitude must be a non-negative number');
  if (!(Number.isFinite(period) && period > 0)) throw new RangeError('period must be a positive number');
  if (!Number.isFinite(spread)) throw new RangeError('spread must be a finite number');

  const lift = Math.ceil(amplitude);
  const p = prepare(font, text, { ...options, caret: false }, 'wave', (layout) => [
    { x: 0, y: -lift, width: layout.width, height: layout.height + 2 * lift },
  ]);
  const { layout, ids, origin } = p;

  const cls = ids.cls('wave');
  const kf = ids.cls('wave-kf');
  const body = inked(layout.glyphs)
    .map((g) => {
      const phase = (((g.index * spread) % 1) + 1) % 1; // in [0, 1)
      const delay = -phase * period; // negative: start mid-cycle, no idle wait
      return `<path class="${cls}" style="--i:${g.index};animation-delay:${fmt(delay)}s" d="${glyphPath([g], origin)}"/>`;
    })
    .join('');

  const samples = 24;
  const frames: string[] = [];
  for (let k = 0; k < samples; k++) {
    const raw = -amplitude * Math.sin((2 * Math.PI * k) / samples);
    const y = crisp ? Math.round(raw) : raw;
    frames.push(`${pct(k / samples)}{transform:translateY(${fmt(y)}px)}`);
  }
  frames.push(`100%{transform:translateY(0px)}`);

  const css = [
    `.${cls}{animation:${kf} ${fmt(period)}s ${crisp ? 'step-end' : 'linear'} infinite}`,
    `@keyframes ${kf}{${frames.join('')}}`,
    reducedMotion(`.${cls}{animation:none}`),
  ];

  return svgDocument(ids, options, p.title, {
    width: p.bounds.width + 2 * p.padding,
    height: p.bounds.height + 2 * p.padding,
    paintBox: { x: origin.x, y: origin.y, width: layout.width, height: layout.height },
    body,
    css,
  });
}

function pct(fraction: number): string {
  return `${fmt(Math.min(100, Math.max(0, fraction * 100)))}%`;
}

function offsetBox(b: Box, x: number, y: number): Box {
  return { ...b, x: b.x + x, y: b.y + y };
}
