import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';
import { assertWellFormed, rootAttr } from './helpers.js';

const dir = mkdtempSync(join(tmpdir(), 'bitglyph-cli-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function cli(args: string[], stdin?: string) {
  let stdout = '';
  let stderr = '';
  const code = await run(args, {
    stdout: (s) => void (stdout += s),
    stderr: (s) => void (stderr += s),
    readStdin: async () => stdin ?? '',
    stdinIsTTY: stdin === undefined,
    cwd: dir,
  });
  return { code, stdout, stderr };
}

describe('bitglyph CLI', () => {
  it('writes an SVG to stdout', async () => {
    const { code, stdout, stderr } = await cli(['hello']);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    assertWellFormed(stdout);
    expect(rootAttr(stdout, 'viewBox')).toBe('0 0 40 16');
    expect(rootAttr(stdout, 'width')).toBe('160');
  });

  it('runs the README example and writes the file', async () => {
    const { code } = await cli(['hello world', '--font', 'spleen-8x16', '--scale', '6', '--effect', 'scroller', '-o', 'banner.svg']);
    expect(code).toBe(0);
    const svg = readFileSync(join(dir, 'banner.svg'), 'utf8');
    assertWellFormed(svg);
    expect(svg).toContain('<use href=');
    expect(rootAttr(svg, 'width')).toBe(String(88 * 6));
  });

  it('reads text from stdin', async () => {
    const piped = await cli(['-s', '1'], 'piped\n');
    expect(piped.code).toBe(0);
    expect(piped.stdout).toContain('<title>piped</title>');
    const dash = await cli(['-'], 'dash');
    expect(dash.stdout).toContain('<title>dash</title>');
  });

  it('turns \\n in arguments into line breaks', async () => {
    const { stdout } = await cli(['one\\ntwo', '--align', 'center']);
    expect(rootAttr(stdout, 'viewBox')).toBe('0 0 24 32');
  });

  it('passes style options through', async () => {
    const { stdout } = await cli([
      'x', '-c', '#111, #222', '--gradient', 'horizontal', '-b', '#fff', '--radius', '2', '-p', '1',
      '--texture', 'squares', '--texture-size', '0.5', '--unlit', '#eee', '--caret', 'bar', '--title', 'Logo',
    ]);
    expect(stdout).toContain('<linearGradient');
    expect(stdout).toContain('stop-color="#222"');
    expect(stdout).toContain('rx="2" fill="#fff"');
    expect(stdout).toContain('width="0.5" height="0.5"');
    expect(stdout).toContain('-unlit');
    expect(stdout).toContain('-caret');
    expect(stdout).toContain('<title>Logo</title>');
  });

  it('passes effect options through', async () => {
    const tw = await cli(['ab', '-e', 'typewriter', '--speed', '5', '--hold', '0', '--caret', 'none']);
    expect(tw.stdout).toContain('animation-delay:0.2s');
    expect(tw.stdout).not.toContain('caret');
    const once = await cli(['ab', '-e', 'typewriter', '--once']);
    expect(once.stdout).toContain('forwards');
    const wave = await cli(['ab', '-e', 'wave', '--amplitude', '1', '--period', '2', '--smooth']);
    expect(wave.stdout).toContain('2s linear infinite');
    const scroll = await cli(['ab', '-e', 'scroller', '--width', '30', '--speed', '10', '--wavelength', '15']);
    expect(rootAttr(scroll.stdout, 'viewBox')).toMatch(/^0 0 30 /);
  });

  it('accepts negative numbers in --opt=value form', async () => {
    const { code, stdout } = await cli(['ab', '--tracking=-2']);
    expect(code).toBe(0);
    expect(rootAttr(stdout, 'viewBox')).toBe('0 0 14 16');
  });

  it('produces the same SVG as the equivalent library call', async () => {
    const { renderSVG } = await import('../src/svg.js');
    const { loadFont } = await import('../src/node.js');
    const { stdout } = await cli(['same', '-c', '#a8321f', '-s', '3', '--texture', 'dots']);
    expect(stdout).toBe(renderSVG(loadFont('spleen-8x16'), 'same', { color: '#a8321f', scale: 3, texture: 'dots' }));
  });

  it('per-glyph mode emits one path per glyph', async () => {
    const { stdout } = await cli(['abc', '--per-glyph']);
    expect(stdout.match(/<path /g)).toHaveLength(3);
  });

  it('accepts a path to any BDF font', async () => {
    const font = join(import.meta.dirname, '..', 'fonts', 'spleen-6x12.bdf');
    const { code, stdout } = await cli(['hi', '--font', font]);
    expect(code).toBe(0);
    expect(rootAttr(stdout, 'viewBox')).toBe('0 0 12 12');
  });

  it('warns about characters the font cannot draw', async () => {
    const { code, stderr } = await cli(['snow \u{1F328}']);
    expect(code).toBe(0);
    expect(stderr).toMatch(/warning: font has no glyph for "\u{1F328}"/u);
  });

  it('prints help, version and fonts', async () => {
    expect((await cli(['--help'])).stdout).toMatch(/^bitglyph - render text/);
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect((await cli(['-v'])).stdout).toBe(`${pkg.version}\n`);
    expect((await cli(['--list-fonts'])).stdout).toBe('spleen-6x12\nspleen-8x16\nspleen-12x24\n');
  });

  it.each([
    [[], /no text given/],
    [['x', '--scale', 'big'], /--scale expects a number/],
    [['x', '--effect', 'spin'], /unknown effect "spin"/],
    [['x', '--align', 'justify'], /--align must be one of left, center, right/],
    [['x', '--bogus'], /Unknown option '--bogus'/],
    [['x', '--padding=-1'], /padding must be a non-negative integer/],
    [['   '], /text is empty/],
  ])('exits 2 on usage errors: %j', async (args, message) => {
    const { code, stderr, stdout } = await cli(args as string[]);
    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toMatch(message);
    expect(stderr).toContain("Try 'bitglyph --help'.");
  });

  it('exits 1 when the font cannot be loaded', async () => {
    const { code, stderr } = await cli(['x', '--font', 'missing.bdf']);
    expect(code).toBe(1);
    expect(stderr).toMatch(/cannot read font "missing.bdf"/);
  });
});
