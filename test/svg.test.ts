import { describe, expect, it } from 'vitest';
import { renderSVG } from '../src/svg.js';
import { loadFont } from '../src/node.js';
import { assertWellFormed, pathPixels, rootAttr, tinyFont } from './helpers.js';

const spleen = loadFont('spleen-8x16');
const paths = (svg: string) => [...svg.matchAll(/<path\b[^>]*\bd="([^"]*)"/g)].map((m) => m[1]!);

describe('renderSVG', () => {
  it('produces a well-formed document sized by scale', () => {
    const svg = renderSVG(spleen, 'hello world', { scale: 6 });
    assertWellFormed(svg);
    expect(rootAttr(svg, 'width')).toBe(String(88 * 6));
    expect(rootAttr(svg, 'height')).toBe(String(16 * 6));
    expect(rootAttr(svg, 'viewBox')).toBe('0 0 88 16');
    expect(svg).toContain('shape-rendering="crispEdges"');
  });

  it('draws the whole text as one path by default', () => {
    const svg = renderSVG(spleen, 'two\nlines');
    expect(paths(svg)).toHaveLength(1);
  });

  it('pads in font pixels and shifts the geometry accordingly', () => {
    const font = tinyFont();
    const plain = pathPixels(paths(renderSVG(font, 'I'))[0]!);
    const padded = renderSVG(font, 'I', { padding: 3, scale: 2 });
    expect(rootAttr(padded, 'viewBox')).toBe('0 0 10 12');
    expect(rootAttr(padded, 'width')).toBe('20');
    const shifted = new Set([...plain].map((p) => p.split(',').map(Number)).map(([x, y]) => `${x! + 3},${y! + 3}`));
    expect(pathPixels(paths(padded)[0]!)).toEqual(shifted);
  });

  it('emits one path per inked glyph with its index in per-glyph mode', () => {
    const svg = renderSVG(spleen, 'a b', { perGlyph: true, idPrefix: 'x' });
    assertWellFormed(svg);
    expect(svg.match(/<path class="x-glyph" style="--i:(\d+)"/g)).toEqual([
      '<path class="x-glyph" style="--i:0"',
      '<path class="x-glyph" style="--i:2"',
    ]);
  });

  it('per-glyph and merged output cover the same pixels', () => {
    const text = 'pixel==perfect';
    const merged = pathPixels(paths(renderSVG(spleen, text))[0]!);
    const split = new Set(paths(renderSVG(spleen, text, { perGlyph: true })).flatMap((d) => [...pathPixels(d)]));
    expect(split).toEqual(merged);
  });

  it('fills with a solid colour or a gradient across the text box', () => {
    expect(renderSVG(spleen, 'a', { color: '#c2410c' })).toContain('<g fill="#c2410c"');
    const svg = renderSVG(spleen, 'ab', { color: ['#111', '#222', '#333'], idPrefix: 'g', padding: 1 });
    expect(svg).toContain('<g fill="url(#g-paint)"');
    expect(svg).toContain('<linearGradient id="g-paint" gradientUnits="userSpaceOnUse" x1="1" y1="1" x2="1" y2="17">');
    expect(svg.match(/<stop /g)).toHaveLength(3);
    expect(svg).toContain('offset="0.5" stop-color="#222"');
    const horizontal = renderSVG(spleen, 'ab', { color: ['#111', '#222'], gradient: 'horizontal', idPrefix: 'g' });
    expect(horizontal).toContain('x1="0" y1="0" x2="16" y2="0"');
  });

  it('masks the text with a pixel texture and can draw unlit cells', () => {
    const svg = renderSVG(spleen, 'led', { texture: 'dots', unlitColor: '#333', idPrefix: 't' });
    assertWellFormed(svg);
    expect(svg).toContain('<pattern id="t-cell" width="1" height="1" patternUnits="userSpaceOnUse"><circle cx=".5" cy=".5" r="0.41" fill="#fff"/>');
    expect(svg).toContain('<mask id="t-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="16">');
    expect(svg).toContain('mask="url(#t-mask)"');
    expect(svg).toContain('<rect width="24" height="16" fill="url(#t-unlit)"/>');
    expect(renderSVG(spleen, 'x', { texture: 'squares', textureSize: 0.5, idPrefix: 's' })).toContain(
      '<rect x="0.25" y="0.25" width="0.5" height="0.5" fill="#fff"/>',
    );
    expect(renderSVG(spleen, 'x', { texture: 'scanlines', idPrefix: 's' })).toContain('<rect width="1" height="0.6" fill="#fff"/>');
    expect(renderSVG(spleen, 'x', { unlitColor: '#333' })).not.toContain('unlit');
  });

  it('draws a background with optional rounded corners', () => {
    expect(renderSVG(spleen, 'a', { background: '#f4f1ea', radius: 2 })).toContain(
      '<rect width="8" height="16" rx="2" fill="#f4f1ea"/>',
    );
  });

  it('adds a blinking caret after the text and widens the canvas for it', () => {
    const svg = renderSVG(spleen, 'ab', { caret: true, idPrefix: 'c' });
    expect(rootAttr(svg, 'viewBox')).toBe('0 0 24 16');
    expect(svg).toContain('<rect class="c-caret" x="16" y="0" width="8" height="16"/>');
    expect(svg).toContain('@keyframes c-blink');
    expect(svg).toContain('prefers-reduced-motion');
    expect(renderSVG(spleen, 'ab', { caret: 'bar', idPrefix: 'c' })).toContain('width="1" height="16"');
    expect(renderSVG(spleen, 'ab', { caret: 'underline', idPrefix: 'c' })).toContain('y="15" width="8" height="1"');
  });

  it('escapes the accessible title and can omit it', () => {
    const svg = renderSVG(spleen, '<a & "b">');
    assertWellFormed(svg);
    expect(svg).toContain('<title>&lt;a &amp; &quot;b&quot;&gt;</title>');
    expect(renderSVG(spleen, 'a', { title: false })).not.toContain('<title>');
    expect(renderSVG(spleen, 'a', { title: 'Logo' })).toContain('<title>Logo</title>');
  });

  it('derives a stable id prefix from the input', () => {
    const a = renderSVG(spleen, 'same', { texture: 'dots' });
    expect(renderSVG(spleen, 'same', { texture: 'dots' })).toBe(a);
    const id = /<mask id="([^"]+)-mask"/.exec(a)![1];
    const other = /<mask id="([^"]+)-mask"/.exec(renderSVG(spleen, 'diff', { texture: 'dots' }))![1];
    expect(id).toMatch(/^b[0-9a-z]+$/);
    expect(other).not.toBe(id);
    // Key order does not matter.
    const opts = { scale: 2, padding: 1, texture: 'dots' as const };
    expect(renderSVG(spleen, 'k', opts)).toBe(renderSVG(spleen, 'k', { texture: 'dots', padding: 1, scale: 2 }));
  });

  it('validates options', () => {
    expect(() => renderSVG(spleen, 'a', { scale: 0 })).toThrow(/scale/);
    expect(() => renderSVG(spleen, 'a', { padding: 1.5 })).toThrow(/padding/);
    expect(() => renderSVG(spleen, 'a', { textureSize: 2 })).toThrow(/textureSize/);
    expect(() => renderSVG(spleen, 'a', { color: [] })).toThrow(/color/);
    expect(() => renderSVG(spleen, 'a', { idPrefix: '1bad' })).toThrow(/idPrefix/);
    expect(() => renderSVG(spleen, 'a', { texture: 'plaid' as never })).toThrow(/texture/);
  });

  it('appends user CSS', () => {
    expect(renderSVG(spleen, 'a', { css: '.x{fill:red}' })).toContain('<style>.x{fill:red}</style>');
  });
});
