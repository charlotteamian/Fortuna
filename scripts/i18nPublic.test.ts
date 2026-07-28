import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const loadMessages = (locale: 'zh' | 'en') => JSON.parse(
  readFileSync(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8'),
) as Record<string, string>;

const zh = loadMessages('zh');
const en = loadMessages('en');
const privateTerms = /哨兵|GPT|Claude|快账户/i;
const singleBraceInterpolation = /\{[A-Za-z_][A-Za-z0-9_.-]*\}/u;

test('Chinese and English translation resources have matching keys', () => {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
});

test('public translation values contain no private workflow terms', () => {
  for (const [locale, messages] of Object.entries({ zh, en })) {
    for (const [key, value] of Object.entries(messages)) {
      assert.doesNotMatch(value, privateTerms, `${locale}.${key}`);
    }
  }
});

test('translation interpolation uses double braces instead of single braces', () => {
  for (const [locale, messages] of Object.entries({ zh, en })) {
    for (const [key, value] of Object.entries(messages)) {
      const withoutDoubleBraceTokens = value.replace(/\{\{[^{}]+\}\}/gu, '');
      assert.doesNotMatch(withoutDoubleBraceTokens, singleBraceInterpolation, `${locale}.${key}`);
    }
  }
});
