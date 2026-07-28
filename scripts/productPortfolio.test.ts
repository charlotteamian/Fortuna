import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDefaultHoldingModeForCategory,
  getProductHoldingFields,
  defaultsToProductPortfolio,
  isProductPortfolioCategory,
  shouldShowProductCodeForCategory,
  usesLiveQuotes,
} from '../src/lib/productPortfolio.ts';

test('product portfolio categories include product-like assets but exclude cash, metals, and property', () => {
  assert.equal(isProductPortfolioCategory('股票/ETF', 'asset'), true);
  assert.equal(isProductPortfolioCategory('场外基金', 'asset'), true);
  assert.equal(isProductPortfolioCategory('银行存款', 'asset'), true);
  assert.equal(isProductPortfolioCategory('理财产品', 'asset'), true);
  assert.equal(isProductPortfolioCategory('债券', 'asset'), true);
  assert.equal(isProductPortfolioCategory('债权', 'asset'), true);
  assert.equal(isProductPortfolioCategory('数字货币', 'asset'), true);
  assert.equal(isProductPortfolioCategory('其他资产', 'asset'), true);

  assert.equal(isProductPortfolioCategory('现金', 'asset'), false);
  assert.equal(isProductPortfolioCategory('贵金属', 'asset'), false);
  assert.equal(isProductPortfolioCategory('房产', 'asset'), false);
  assert.equal(isProductPortfolioCategory('信用卡', 'liability'), false);
});

test('custom asset categories support portfolios but default to a simple balance account', () => {
  assert.equal(isProductPortfolioCategory('收藏品', 'asset'), true);
  assert.equal(defaultsToProductPortfolio('收藏品', 'asset'), false);
  assert.equal(defaultsToProductPortfolio('银行存款', 'asset'), true);
  assert.equal(defaultsToProductPortfolio('信用卡', 'liability'), false);
});

test('portfolio holdings use unit mode only for tradable quote-like assets', () => {
  assert.equal(getDefaultHoldingModeForCategory('股票/ETF'), 'unit');
  assert.equal(getDefaultHoldingModeForCategory('场外基金'), 'unit');
  assert.equal(getDefaultHoldingModeForCategory('数字货币'), 'unit');

  assert.equal(getDefaultHoldingModeForCategory('银行存款'), 'balance');
  assert.equal(getDefaultHoldingModeForCategory('理财产品'), 'balance');
  assert.equal(getDefaultHoldingModeForCategory('债券'), 'balance');
});

test('live quotes stay limited to supported security and fund categories', () => {
  assert.equal(usesLiveQuotes('股票/ETF'), true);
  assert.equal(usesLiveQuotes('场外基金'), true);
  assert.equal(usesLiveQuotes('理财产品'), false);
  assert.equal(usesLiveQuotes('银行存款'), false);
  assert.equal(usesLiveQuotes('数字货币'), false);
});

test('bank deposit product entries require rate and maturity instead of product code', () => {
  assert.equal(shouldShowProductCodeForCategory('银行存款'), false);
  assert.deepEqual(getProductHoldingFields('银行存款').map(field => field.key), ['rate', 'maturity']);
  assert.equal(getProductHoldingFields('银行存款').every(field => field.required), true);

  assert.equal(shouldShowProductCodeForCategory('理财产品'), true);
  assert.deepEqual(getProductHoldingFields('理财产品'), []);
});

test('receivables use counterparty and repayment fields instead of a product code', () => {
  assert.equal(shouldShowProductCodeForCategory('债权'), false);
  assert.deepEqual(
    getProductHoldingFields('债权').map(field => field.key),
    ['counterparty', 'rate', 'due', 'risk'],
  );
});
