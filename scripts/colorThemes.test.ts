import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COLOR_THEMES, getTheme } from '../src/lib/colorThemes.ts';

const rgb = (hex: string) => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16));
const luminance = (color: number[]) => color.map(value => {
  const s = value / 255;
  return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
const contrast = (text: number[], background: number[]) => {
  const a = luminance(text), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
};

test('new palettes have distinct stable IDs, translations, and independent light/dark colours', () => {
  assert.equal(new Set(COLOR_THEMES.map(theme => theme.id)).size, COLOR_THEMES.length);
  assert.equal(COLOR_THEMES.length, 11);
  for (const theme of COLOR_THEMES.slice(5)) {
    assert.notEqual(getTheme(theme.id, 'light').assetColor, theme.assetColor);
    assert.notEqual(getTheme(theme.id, 'light').liabilityColor, theme.liabilityColor);
    for (const locale of ['zh', 'en']) {
      const messages = JSON.parse(readFileSync(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8'));
      assert.equal(typeof messages[theme.id], 'string');
    }
  }
  assert.equal(getTheme('unknown').id, 'emerald-rose');
  assert.equal(getTheme('rose-emerald').assetColor, '#fb7185');
});

test('new palette amount colours remain readable on cards and their tinted backgrounds in both modes', () => {
  for (const appearance of ['dark', 'light'] as const) {
    const background = rgb(appearance === 'dark' ? '#121212' : '#f5f5f7');
    for (const entry of COLOR_THEMES.slice(5)) {
      const theme = getTheme(entry.id, appearance);
      for (const role of ['asset', 'liability'] as const) {
        const foreground = rgb(theme[`${role}Color`]);
        const tinted = foreground.map((value, index) => value * .1 + background[index] * .9);
        for (const surface of [background, tinted]) {
          assert.ok(contrast(foreground, surface) >= 4.5, `${theme.id} ${appearance} ${role} contrast=${contrast(foreground, surface)}`);
        }
      }
    }
  }
});
