/**
 * Shared SVG document assembly: canvas, paint (solid or gradient), pixel
 * textures, background and accessibility metadata. The static renderer and
 * every effect build on this so they stay visually consistent.
 *
 * All lengths are in font pixels. The root `viewBox` is in font pixels and
 * `width`/`height` carry the scale, so one source unit is one font pixel and
 * CSS `px` values in transforms are font pixels too.
 */

export type Texture = 'none' | 'dots' | 'squares' | 'scanlines';

export interface StyleOptions {
  /** Output pixels per font pixel. Default `4`. */
  scale?: number;
  /** Empty space around the text, in font pixels. Default `0`. */
  padding?: number;
  /**
   * Fill colour. Pass several colours for a gradient across the text.
   * Default `'currentColor'`.
   */
  color?: string | readonly string[];
  /** Direction of a multi-colour fill. Default `'vertical'`. */
  gradient?: 'vertical' | 'horizontal';
  /** Canvas background. Transparent when omitted. */
  background?: string;
  /** Corner radius of the background, in font pixels. */
  radius?: number;
  /** Draw each font pixel as a dot, inset square or scanline. Default `'none'`. */
  texture?: Texture;
  /** Size of the textured pixel as a fraction of the cell, 0–1. */
  textureSize?: number;
  /** With a texture: colour of unlit cells, giving a dot-matrix panel look. */
  unlitColor?: string;
  /** Accessible title. Defaults to the rendered text; `false` omits it. */
  title?: string | false;
  /**
   * Prefix for ids, classes and keyframes. Defaults to a short hash of the
   * input so several SVGs can be inlined into one HTML page.
   */
  idPrefix?: string;
  /** Extra CSS appended to the document's `<style>`. */
  css?: string;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DocumentParts {
  /** Canvas size in font pixels, padding included. */
  width: number;
  height: number;
  /** Markup drawn with the text paint (and texture mask), in canvas coordinates. */
  body: string;
  /** Region the gradient spans, in canvas coordinates. */
  paintBox: Box;
  defs?: string[];
  css?: string[];
}

export interface Ids {
  readonly prefix: string;
  id(name: string): string;
  url(name: string): string;
  cls(name: string): string;
}

const DEFAULT_TEXTURE_SIZE: Record<Exclude<Texture, 'none'>, number> = {
  dots: 0.82,
  squares: 0.8,
  scanlines: 0.6,
};

export function createIds(prefix: string): Ids {
  if (!/^[A-Za-z][\w-]*$/.test(prefix)) throw new TypeError(`invalid idPrefix "${prefix}"`);
  return {
    prefix,
    id: (name) => `${prefix}-${name}`,
    url: (name) => `url(#${prefix}-${name})`,
    cls: (name) => `${prefix}-${name}`,
  };
}

/** Deterministic default prefix: `b` + FNV-1a hash of the inputs, base 36. */
export function defaultPrefix(...inputs: unknown[]): string {
  let h = 0x811c9dc5;
  // Sorted keys: the same options in a different order give the same prefix.
  const s = JSON.stringify(inputs, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
      : value,
  );
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return 'b' + (h >>> 0).toString(36);
}

/** Format a number for SVG/CSS: at most 3 decimals, no trailing zeros. */
export function fmt(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": 'apos' }[c]};`);
}

export function validateStyle(o: StyleOptions): void {
  const positive = (v: number | undefined, name: string) => {
    if (v !== undefined && !(Number.isFinite(v) && v > 0)) throw new RangeError(`${name} must be a positive number`);
  };
  positive(o.scale, 'scale');
  if (o.padding !== undefined && !(Number.isInteger(o.padding) && o.padding >= 0)) {
    throw new RangeError('padding must be a non-negative integer');
  }
  if (o.textureSize !== undefined && !(o.textureSize > 0 && o.textureSize <= 1)) {
    throw new RangeError('textureSize must be in (0, 1]');
  }
  if (o.texture !== undefined && !['none', 'dots', 'squares', 'scanlines'].includes(o.texture)) {
    throw new RangeError(`unknown texture "${o.texture}"`);
  }
  if (Array.isArray(o.color) && o.color.length === 0) throw new RangeError('color list is empty');
}

/** Assemble the final SVG string. */
export function svgDocument(ids: Ids, style: StyleOptions, title: string, parts: DocumentParts): string {
  const scale = style.scale ?? 4;
  const { width, height } = parts;
  const defs = [...(parts.defs ?? [])];
  const css = [...(parts.css ?? [])];
  if (style.css) css.push(style.css);

  const colors = typeof style.color === 'string' ? [style.color] : (style.color ?? ['currentColor']);
  let fill: string;
  if (colors.length === 1) {
    fill = colors[0]!;
  } else {
    const b = parts.paintBox;
    const horizontal = style.gradient === 'horizontal';
    const [x1, y1, x2, y2] = horizontal ? [b.x, b.y, b.x + b.width, b.y] : [b.x, b.y, b.x, b.y + b.height];
    const stops = colors
      .map((c, i) => `<stop offset="${fmt(i / (colors.length - 1))}" stop-color="${escapeXml(c)}"/>`)
      .join('');
    defs.push(
      `<linearGradient id="${ids.id('paint')}" gradientUnits="userSpaceOnUse" x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}">${stops}</linearGradient>`,
    );
    fill = ids.url('paint');
  }

  const texture = style.texture ?? 'none';
  let unlit = '';
  let maskAttr = '';
  if (texture !== 'none') {
    const size = style.textureSize ?? DEFAULT_TEXTURE_SIZE[texture];
    defs.push(texturePattern(ids.id('cell'), texture, size, '#fff'));
    defs.push(
      `<mask id="${ids.id('mask')}" maskUnits="userSpaceOnUse" x="0" y="0" width="${fmt(width)}" height="${fmt(height)}"><rect width="${fmt(width)}" height="${fmt(height)}" fill="${ids.url('cell')}"/></mask>`,
    );
    maskAttr = ` mask="${ids.url('mask')}"`;
    if (style.unlitColor) {
      defs.push(texturePattern(ids.id('unlit'), texture, size, style.unlitColor));
      unlit = `<rect width="${fmt(width)}" height="${fmt(height)}" fill="${ids.url('unlit')}"/>`;
    }
  }

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width * scale)}" height="${fmt(height * scale)}" viewBox="0 0 ${fmt(width)} ${fmt(height)}" role="img">`,
  );
  if (title) out.push(`<title>${escapeXml(title)}</title>`);
  if (css.length) out.push(`<style>${css.join('')}</style>`);
  if (defs.length) out.push(`<defs>${defs.join('')}</defs>`);
  if (style.background) {
    const r = style.radius ? ` rx="${fmt(style.radius)}"` : '';
    out.push(`<rect width="${fmt(width)}" height="${fmt(height)}"${r} fill="${escapeXml(style.background)}"/>`);
  }
  if (unlit) out.push(unlit);
  out.push(`<g fill="${escapeXml(fill)}" shape-rendering="crispEdges"${maskAttr}>${parts.body}</g>`);
  out.push('</svg>');
  return out.join('\n') + '\n';
}

function texturePattern(id: string, texture: Exclude<Texture, 'none'>, size: number, color: string): string {
  const c = escapeXml(color);
  const inset = fmt((1 - size) / 2);
  const shape =
    texture === 'dots'
      ? `<circle cx=".5" cy=".5" r="${fmt(size / 2)}" fill="${c}"/>`
      : texture === 'squares'
        ? `<rect x="${inset}" y="${inset}" width="${fmt(size)}" height="${fmt(size)}" fill="${c}"/>`
        : `<rect width="1" height="${fmt(size)}" fill="${c}"/>`;
  return `<pattern id="${id}" width="1" height="1" patternUnits="userSpaceOnUse">${shape}</pattern>`;
}

/** Blinking-caret rule shared by the static renderer and effects. */
export function blinkCss(ids: Ids, period = 1.06): string {
  const k = ids.cls('blink');
  return `.${ids.cls('caret')}{animation:${k} ${fmt(period)}s step-end infinite}@keyframes ${k}{50%{opacity:0}}`;
}

/** Turns animations off for people who asked for less motion. */
export function reducedMotion(rules: string): string {
  return `@media (prefers-reduced-motion:reduce){${rules}}`;
}
