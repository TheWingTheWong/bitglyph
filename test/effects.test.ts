import { describe, expect, it } from 'vitest';
import { render, scroller, typewriter, wave } from '../src/effects.js';
import { renderSVG } from '../src/svg.js';
import { loadFont } from '../src/node.js';
import { assertWellFormed, rootAttr } from './helpers.js';

const spleen = loadFont('spleen-8x16');

const slices = (svg: string) =>
  [...svg.matchAll(/<svg x="([\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)" viewBox="([\d.]+) 0 [\d.]+ [\d.]+"><use href="#([\w-]+)" class="([\w-]+)"\/><\/svg>/g)].map(
    (m) => ({ x: +m[1]!, y: +m[2]!, width: +m[3]!, height: +m[4]!, viewX: +m[5]!, href: m[6]!, cls: m[7]! }),
  );

describe('scroller', () => {
  const svg = scroller(spleen, 'hello world', { width: 64, amplitude: 4, wavelength: 32, idPrefix: 's', padding: 2 });

  it('is well formed and sized to the window plus wave room', () => {
    assertWellFormed(svg);
    expect(rootAttr(svg, 'viewBox')).toBe(`0 0 ${64 + 4} ${16 + 8 + 4}`);
  });

  it('tiles the window with slices that show the same text', () => {
    const s = slices(svg);
    expect(s.length).toBeGreaterThan(4);
    expect(s[0]!.x).toBe(2);
    let x = 0;
    for (const slice of s) {
      expect(slice.x).toBe(x + 2);
      expect(slice.viewX).toBe(x);
      expect(slice.href).toBe('s-text');
      expect(slice.cls).toBe('s-scroll');
      x += slice.width;
    }
    expect(x).toBe(64);
    expect(svg.match(/<g id="s-text">/g)).toHaveLength(1);
  });

  it('fixes the wave to the screen: offsets follow a sine of screen x, and only the text moves', () => {
    for (const slice of slices(svg)) {
      for (let px = slice.viewX; px < slice.viewX + slice.width; px++) {
        expect(slice.y - 2 - 4).toBe(Math.round(4 * Math.sin((2 * Math.PI * (px + 0.5)) / 32)) + 0);
      }
    }
    // The slices carry no animation; the single keyframe rule only translates horizontally.
    expect(svg).not.toMatch(/<svg x[^>]*class=/);
    expect(svg).toContain('@keyframes s-scroll-kf{from{transform:translateX(64px)}to{transform:translateX(-88px)}}');
  });

  it('snaps the scroll to whole pixels unless smooth', () => {
    // (64px window + 88px text) at 48px/s, one step per font pixel
    expect(svg).toContain('animation:s-scroll-kf 3.167s steps(152) infinite');
    const smooth = scroller(spleen, 'hi', { crisp: false, idPrefix: 's' });
    expect(smooth).toContain('linear infinite');
    expect(slices(smooth).some((s) => !Number.isInteger(s.y))).toBe(true);
  });

  it('merges neighbouring slices with equal offsets', () => {
    const flat = scroller(spleen, 'flat', { amplitude: 0, width: 50 });
    expect(slices(flat)).toHaveLength(1);
    expect(slices(flat)[0]!.width).toBe(50);
  });

  it('stops moving under prefers-reduced-motion', () => {
    expect(svg).toContain('@media (prefers-reduced-motion:reduce){.s-scroll{animation:none}}');
  });

  it('validates its options', () => {
    expect(() => scroller(spleen, 'x', { speed: 0 })).toThrow(/speed/);
    expect(() => scroller(spleen, 'x', { amplitude: -1 })).toThrow(/amplitude/);
  });
});

describe('typewriter', () => {
  const svg = typewriter(spleen, 'ab c', { speed: 10, hold: 1, idPrefix: 't' });

  it('reveals glyphs in order with one shared keyframe rule', () => {
    assertWellFormed(svg);
    const delays = [...svg.matchAll(/class="t-type" style="--i:(\d+);animation-delay:([\d.]+)s"/g)].map((m) => [
      +m[1]!,
      +m[2]!,
    ]);
    // The space (index 2) takes time but draws nothing.
    expect(delays).toEqual([
      [0, 0.1],
      [1, 0.2],
      [3, 0.4],
    ]);
    expect(svg.match(/@keyframes t-type-kf/g)).toHaveLength(1);
  });

  it('keeps every glyph up for the same span so the loop is consistent', () => {
    // typing 0.4s + hold 1s visible, wipe 0.4s, pause 0.6s => period 2.4s
    expect(svg).toContain('.t-type{opacity:0;animation:t-type-kf 2.4s step-end infinite}');
    expect(svg).toContain('@keyframes t-type-kf{0%{opacity:1}58.333%{opacity:0}}');
  });

  it('moves a caret along with the pen', () => {
    const frames = /@keyframes t-pen-kf\{(.*?)\}@/.exec(svg)![1]!;
    expect(frames.match(/translate\(/g)).toHaveLength(5);
    expect(frames.startsWith('0%{transform:translate(0px,12px)}')).toBe(true);
    expect(frames).toContain('16.667%{transform:translate(32px,12px)}');
    expect(svg).toContain('<rect class="t-caret" x="0" y="-12" width="8" height="16"/>');
    expect(rootAttr(svg, 'viewBox')).toBe('0 0 40 16');
  });

  it('can type once and stop', () => {
    const once = typewriter(spleen, 'ab', { loop: false, idPrefix: 'o' });
    expect(once).toContain('animation:o-type-kf 1ms step-end forwards');
    expect(once).toContain('step-end 1 forwards');
  });

  it('can omit the caret', () => {
    expect(typewriter(spleen, 'ab', { caret: false })).not.toContain('caret');
  });

  it('shows the finished text under prefers-reduced-motion', () => {
    expect(svg).toMatch(/prefers-reduced-motion:reduce\)\{\.t-type\{opacity:1;animation:none\}/);
  });

  it('handles multi-line text', () => {
    const multi = typewriter(spleen, 'a\nb', { idPrefix: 'm' });
    assertWellFormed(multi);
    expect(multi).toContain('translate(8px,28px)');
  });
});

describe('wave', () => {
  const svg = wave(spleen, 'wave', { amplitude: 3, idPrefix: 'w' });

  it('adds room above and below for the motion', () => {
    assertWellFormed(svg);
    expect(rootAttr(svg, 'viewBox')).toBe('0 0 32 22');
  });

  it('offsets each glyph in phase and samples a whole-pixel sine', () => {
    const delays = [...svg.matchAll(/animation-delay:(-?[\d.]+)s/g)].map((m) => +m[1]!);
    expect(delays).toEqual([0, -0.128, -0.256, -0.384]);
    const values = [...svg.matchAll(/translateY\((-?[\d.]+)px\)/g)].map((m) => +m[1]!);
    expect(values.every(Number.isInteger)).toBe(true);
    expect(Math.max(...values)).toBe(3);
    expect(Math.min(...values)).toBe(-3);
  });
});

describe('render', () => {
  it('dispatches by effect name', () => {
    expect(render(spleen, 'x')).toBe(renderSVG(spleen, 'x'));
    expect(render(spleen, 'x', { effect: 'scroller' })).toContain('<use ');
    expect(render(spleen, 'x', { effect: 'typewriter' })).toContain('-type-kf');
    expect(render(spleen, 'x', { effect: 'wave' })).toContain('-wave-kf');
    expect(() => render(spleen, 'x', { effect: 'spin' as never })).toThrow(/unknown effect/);
  });

  it('layers texture and background under every effect', () => {
    for (const effect of ['scroller', 'typewriter', 'wave'] as const) {
      const svg = render(spleen, 'fx', { effect, texture: 'dots', background: '#000', unlitColor: '#222' });
      assertWellFormed(svg);
      expect(svg).toMatch(/mask="url\(#b[0-9a-z]+-mask\)"/);
    }
  });
});
