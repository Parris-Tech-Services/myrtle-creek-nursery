// WCAG 2.1 AA contrast check for every text/background and component pair defined as CSS variables, light and dark.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
const vars = block => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map(m => [m[1], m[2]]));
const light = vars(css.match(/^:root\{([\s\S]*?)\n\}/m)[1]);
const dark = { ...light, ...vars(css.match(/prefers-color-scheme:dark\)\{\s*:root\{([\s\S]*?)\n\}/)[1]) };

const lum = hex => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [foreground, background, minimum ratio, what it is]
const TEXT = 4.5, UI = 3;
const PAIRS = [
  ['ink', 'paper', TEXT, 'body text'], ['ink', 'card', TEXT, 'text on cards'], ['muted', 'paper', TEXT, 'secondary text'], ['muted', 'card', TEXT, 'secondary text on cards'],
  ['olive-text', 'paper', TEXT, 'green text/links'], ['olive-text', 'card', TEXT, 'green text on cards, outline buttons'],
  ['brick', 'paper', TEXT, 'red text'], ['brick', 'card', TEXT, 'red text, danger buttons'], ['soil', 'paper', TEXT, 'brown text'],
  ['on-olive', 'olive', TEXT, 'primary button text'], ['on-brick', 'brick', TEXT, 'red banner text'],
  ['ink', 'sage-bg', TEXT, 'save/group rows'], ['banner-ink', 'straw-bg', TEXT, 'banner text'],
  ['muted', 'tint-out', TEXT, 'sold-out caption'], ['brick', 'tint-out', TEXT, 'sold-out label'],
  ['nav-ink', 'nav-bg', TEXT, 'tab text'], ['nav-on-ink', 'nav-on-bg', TEXT, 'active tab text'],
  ['ink', 'tag-bg', TEXT, 'tag'], ['tag-ok-ink', 'tag-ok-bg', TEXT, 'ok tag'], ['tag-bad-ink', 'tag-bad-bg', TEXT, 'warning tag'],
  ['ink', 'sage-bg', TEXT, 'summary text'],
  ['toast-ink', 'toast-bg', TEXT, 'toast'], ['toast-btn-ink', 'toast-btn-bg', TEXT, 'toast undo button'],
  // non-text: borders, focus ring, button edges, selection fills
  ['edge', 'paper', UI, 'input and card borders on paper'], ['edge', 'card', UI, 'input borders on cards'],
  ['focus', 'paper', UI, 'focus ring on paper'], ['focus', 'card', UI, 'focus ring on cards'],
  ['olive', 'paper', UI, 'primary button edge'], ['olive', 'card', UI, 'badge/primary on card'], ['olive-text', 'card', UI, 'outline button border'],
  ['brick', 'card', UI, 'danger border / brick tile edge'], ['soil', 'card', UI, 'tree tile edge'], ['nav-on-bg', 'nav-bg', UI, 'active tab shape'],
];
for (const [theme, v] of [['light', light], ['dark', dark]]) {
  test(`${theme} theme: all colour pairs meet WCAG AA`, () => {
    const fails = [];
    for (const [fg, bg, min, what] of PAIRS) {
      assert.ok(v[fg] && v[bg], `missing variable ${fg} or ${bg}`);
      const r = ratio(v[fg], v[bg]);
      if (r < min) fails.push(`${what}: ${fg} ${v[fg]} on ${bg} ${v[bg]} = ${r.toFixed(2)} (needs ${min})`);
    }
    assert.deepEqual(fails, []);
  });
}
