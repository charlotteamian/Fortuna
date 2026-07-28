import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demoDir = path.join(rootDir, 'demo');
const jsonPath = path.join(demoDir, 'fortuna-demo-data.json');
const workbookPath = path.join(demoDir, 'Fortuna-Demo-Portfolio.xlsx');

const createdAt = (day, offset = 0) => Date.parse(`${day}T08:00:00Z`) + offset;
const categories = [
  { name: '银行存款', type: 'asset', icon: '🏦' },
  { name: '现金', type: 'asset', icon: '💵' },
  { name: '股票/ETF', type: 'asset', icon: '📈' },
  { name: '场外基金', type: 'asset', icon: '📊' },
  { name: '债券', type: 'asset', icon: '📃' },
  { name: '理财产品', type: 'asset', icon: '💹' },
  { name: '贵金属', type: 'asset', icon: '🥇' },
  { name: '债权', type: 'asset', icon: '📜' },
  { name: '房产', type: 'asset', icon: '🏠' },
  { name: '数字货币', type: 'asset', icon: '₿' },
  { name: '其他资产', type: 'asset', icon: '💎' },
  { name: '信用卡', type: 'liability', icon: '💳' },
  { name: '房贷', type: 'liability', icon: '🏗️' },
  { name: '车贷', type: 'liability', icon: '🚗' },
  { name: '消费贷', type: 'liability', icon: '📋' },
  { name: '其他负债', type: 'liability', icon: '⚠️' },
];

const accounts = [
  { id: 'demo-daily-bank', name: '日常账户（演示）', category: '银行存款', type: 'asset', currency: 'CNY', institution: '远山银行（虚构）', createdAt: createdAt('2025-08-01'), sortOrder: 0 },
  { id: 'demo-emergency', name: '应急储备（演示）', category: '银行存款', type: 'asset', currency: 'CNY', institution: '远山银行（虚构）', productData: { interestRate: '1.65%', maturityDate: '2027-06-30' }, createdAt: createdAt('2025-08-01', 1), sortOrder: 1 },
  { id: 'demo-broker', name: '星河证券（演示）', category: '股票/ETF', type: 'asset', currency: 'CNY', institution: '星河证券（虚构）', portfolio: true, cashBalance: 18500, createdAt: createdAt('2025-08-01', 2), sortOrder: 2 },
  { id: 'demo-fund-platform', name: '稳健产品账户（演示）', category: '场外基金', type: 'asset', currency: 'CNY', institution: '青屿基金（虚构）', portfolio: true, cashBalance: 0, createdAt: createdAt('2025-08-01', 3), sortOrder: 3 },
  { id: 'demo-usd-savings', name: '旅行储备（演示）', category: '银行存款', type: 'asset', currency: 'USD', institution: '海风银行（虚构）', createdAt: createdAt('2025-08-01', 4), sortOrder: 4 },
  { id: 'demo-home', name: '自住房产（演示）', category: '房产', type: 'asset', currency: 'CNY', productData: { location: '示例市中心区', area: '89 ㎡' }, createdAt: createdAt('2025-08-01', 5), sortOrder: 5 },
  { id: 'demo-mortgage', name: '住房贷款（演示）', category: '房贷', type: 'liability', currency: 'CNY', institution: '远山银行（虚构）', createdAt: createdAt('2025-08-01', 6), sortOrder: 6 },
  { id: 'demo-card', name: '日常信用卡（演示）', category: '信用卡', type: 'liability', currency: 'CNY', institution: '海风银行（虚构）', createdAt: createdAt('2025-08-01', 7), sortOrder: 7 },
];

const monthlyDates = ['2025-08-31', '2025-09-30', '2025-10-31', '2025-11-30', '2025-12-31', '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30', '2026-07-28'];
const series = {
  'demo-daily-bank': [31800, 29200, 34600, 30200, 38600, 33200, 36100, 40500, 37400, 42100, 39800, 45600],
  'demo-emergency': [96000, 98000, 100000, 102000, 104000, 106000, 108000, 110000, 112000, 114000, 117000, 120000],
  'demo-broker': [74800, 76200, 74100, 78500, 80100, 82400, 80600, 83600, 85100, 87200, 86100, 88880],
  'demo-fund-platform': [93000, 96000, 98500, 101000, 104500, 106000, 109000, 111500, 114000, 116000, 118000, 120000],
  'demo-usd-savings': [9500, 9700, 9900, 10100, 10300, 10500, 10700, 10900, 11100, 11400, 11700, 12000],
  'demo-home': [1750000, 1750000, 1750000, 1750000, 1780000, 1780000, 1780000, 1780000, 1800000, 1800000, 1800000, 1800000],
  'demo-mortgage': [968000, 962000, 956000, 950000, 944000, 938000, 932000, 926000, 920000, 914000, 908000, 902000],
  'demo-card': [3200, 2800, 4100, 3600, 5200, 2900, 3900, 3300, 4700, 3100, 3800, 4200],
};
const records = Object.entries(series).flatMap(([accountId, amounts], accountIndex) => amounts.map((amount, index) => ({
  id: `demo-record-${accountIndex + 1}-${String(index + 1).padStart(2, '0')}`,
  accountId,
  date: monthlyDates[index],
  amount,
  note: index === amounts.length - 1 ? '演示月末记录' : undefined,
  createdAt: createdAt(monthlyDates[index], accountIndex),
})));

const holdings = [
  { id: 'demo-h-global', accountId: 'demo-broker', name: '全球宽基指数（演示）', symbol: 'DEMO-GLOBAL', market: '其他', lastPrice: 26.4, priceDate: '2026-07-28', sortOrder: 0, createdAt: createdAt('2025-08-05') },
  { id: 'demo-h-bond', accountId: 'demo-broker', name: '短债 ETF（演示）', symbol: 'DEMO-BOND', market: '其他', lastPrice: 10.25, priceDate: '2026-07-28', sortOrder: 1, createdAt: createdAt('2025-08-05', 1) },
  { id: 'demo-h-archived', accountId: 'demo-broker', name: '科技主题基金（已归档演示）', symbol: 'DEMO-TECH', market: '其他', lastPrice: 16.2, priceDate: '2026-02-18', sortOrder: 2, createdAt: createdAt('2025-08-05', 2) },
  { id: 'demo-h-balanced', accountId: 'demo-fund-platform', name: '稳健混合组合（演示）', symbol: 'DEMO-BAL', market: '其他', mode: 'balance', productData: { riskLevel: 'R2', manager: '虚构管理人' }, lastPrice: 1, priceDate: '2026-07-28', sortOrder: 0, createdAt: createdAt('2025-08-06') },
  { id: 'demo-h-income', accountId: 'demo-fund-platform', name: '现金增利组合（演示）', symbol: 'DEMO-CASH', market: '其他', mode: 'balance', productData: { riskLevel: 'R1', manager: '虚构管理人' }, lastPrice: 1, priceDate: '2026-07-28', sortOrder: 1, createdAt: createdAt('2025-08-06', 1) },
  { id: 'demo-h-fund-archived', accountId: 'demo-fund-platform', name: '90 天理财（已归档演示）', symbol: 'DEMO-90D', market: '其他', mode: 'balance', lastPrice: 1, priceDate: '2026-04-01', sortOrder: 2, createdAt: createdAt('2025-08-06', 2) },
];

const holdingTxns = [
  { id: 'demo-t-global-1', accountId: 'demo-broker', holdingId: 'demo-h-global', date: '2025-08-05', kind: 'buy', shares: 1800, price: 22.5, note: '演示初始仓位', createdAt: createdAt('2025-08-05') },
  { id: 'demo-t-global-2', accountId: 'demo-broker', holdingId: 'demo-h-global', date: '2026-03-12', kind: 'buy', shares: 400, price: 24.8, note: '演示定投', createdAt: createdAt('2026-03-12') },
  { id: 'demo-t-bond-1', accountId: 'demo-broker', holdingId: 'demo-h-bond', date: '2025-09-10', kind: 'buy', shares: 1200, price: 10.05, note: '演示防守仓位', createdAt: createdAt('2025-09-10') },
  { id: 'demo-t-archived-1', accountId: 'demo-broker', holdingId: 'demo-h-archived', date: '2025-10-08', kind: 'buy', shares: 500, price: 15, note: '演示交易', createdAt: createdAt('2025-10-08') },
  { id: 'demo-t-archived-2', accountId: 'demo-broker', holdingId: 'demo-h-archived', date: '2026-02-18', kind: 'sell', shares: 500, price: 16.2, note: '演示清仓', createdAt: createdAt('2026-02-18') },
  { id: 'demo-t-balanced-1', accountId: 'demo-fund-platform', holdingId: 'demo-h-balanced', date: '2025-08-06', kind: 'buy', shares: 0, price: 1, balanceSnapshot: 65000, note: '演示初始余额', createdAt: createdAt('2025-08-06') },
  { id: 'demo-t-balanced-2', accountId: 'demo-fund-platform', holdingId: 'demo-h-balanced', date: '2026-07-28', kind: 'buy', shares: 0, price: 1, balanceSnapshot: 80000, note: '演示最新余额', createdAt: createdAt('2026-07-28') },
  { id: 'demo-t-income-1', accountId: 'demo-fund-platform', holdingId: 'demo-h-income', date: '2025-08-06', kind: 'buy', shares: 0, price: 1, balanceSnapshot: 28000, note: '演示初始余额', createdAt: createdAt('2025-08-06', 1) },
  { id: 'demo-t-income-2', accountId: 'demo-fund-platform', holdingId: 'demo-h-income', date: '2026-07-28', kind: 'buy', shares: 0, price: 1, balanceSnapshot: 40000, note: '演示最新余额', createdAt: createdAt('2026-07-28', 1) },
  { id: 'demo-t-fund-old-1', accountId: 'demo-fund-platform', holdingId: 'demo-h-fund-archived', date: '2025-11-01', kind: 'buy', shares: 0, price: 1, balanceSnapshot: 20000, note: '演示初始余额', createdAt: createdAt('2025-11-01') },
  { id: 'demo-t-fund-old-2', accountId: 'demo-fund-platform', holdingId: 'demo-h-fund-archived', date: '2026-04-01', kind: 'buy', shares: 0, price: 1, balanceSnapshot: 0, note: '演示到期归档', createdAt: createdAt('2026-04-01') },
];

const planItems = [
  { id: 'demo-plan-growth', name: '长期增长', targetPercent: 25, categories: ['股票/ETF'], allocations: [], sortOrder: 0, createdAt: createdAt('2026-01-01') },
  { id: 'demo-plan-stable', name: '稳健储备', targetPercent: 25, categories: ['银行存款', '场外基金'], allocations: [], sortOrder: 1, createdAt: createdAt('2026-01-01', 1) },
  { id: 'demo-plan-home', name: '居住资产', targetPercent: 50, categories: ['房产'], allocations: [], sortOrder: 2, createdAt: createdAt('2026-01-01', 2) },
];
const planTargets = [
  { id: 'demo-target-global', planItemId: 'demo-plan-growth', label: '全球股票', refKeys: ['h:demo-h-global'], allocations: [], targetPercent: 18, sortOrder: 0, createdAt: createdAt('2026-01-01') },
  { id: 'demo-target-bond', planItemId: 'demo-plan-growth', label: '短期债券', refKeys: ['h:demo-h-bond'], allocations: [], targetPercent: 7, sortOrder: 1, createdAt: createdAt('2026-01-01', 1) },
  { id: 'demo-target-cash', planItemId: 'demo-plan-stable', label: '流动性储备', refKeys: ['a:demo-daily-bank', 'a:demo-emergency', 'c:demo-broker'], allocations: [], targetPercent: 15, sortOrder: 0, createdAt: createdAt('2026-01-01', 2) },
  { id: 'demo-target-funds', planItemId: 'demo-plan-stable', label: '稳健产品', refKeys: ['h:demo-h-balanced', 'h:demo-h-income'], allocations: [], targetPercent: 10, sortOrder: 1, createdAt: createdAt('2026-01-01', 3) },
  { id: 'demo-target-home', planItemId: 'demo-plan-home', label: '自住房产', refKeys: ['a:demo-home'], allocations: [], targetPercent: 50, sortOrder: 0, createdAt: createdAt('2026-01-01', 4) },
];

const settings = [{
  id: 'main', primaryCurrency: 'CNY', categories, currencies: ['CNY', 'USD', 'EUR', 'GBP', 'JPY', 'HKD', 'SGD', 'AUD', 'CAD', 'CHF'],
  colorTheme: 'emerald-rose', amountVisible: true, showArchivedAccounts: false, themeMode: 'dark', fontSize: 'normal', language: 'zh',
  goldPriceSource: 'international', metalTxnMigrated: true, planTargetTotal: 2200000, onboardingVersion: 1,
  snapshotFocusAccountIds: ['demo-broker', 'demo-fund-platform'], automaticSnapshotSchemaVersion: 6,
}];
const exchangeRates = [
  { id: 'USD_CNY', base: 'USD', quote: 'CNY', rate: 7.18, date: '2026-07-28', updatedAt: createdAt('2026-07-28') },
  { id: 'EUR_CNY', base: 'EUR', quote: 'CNY', rate: 8.35, date: '2026-07-28', updatedAt: createdAt('2026-07-28', 1) },
  { id: 'GBP_CNY', base: 'GBP', quote: 'CNY', rate: 9.62, date: '2026-07-28', updatedAt: createdAt('2026-07-28', 2) },
];

const demo = {
  metadata: {
    format: 'Fortuna Synthetic Demo Dataset',
    version: 1,
    generatedFor: 'Fortuna v1.2.0',
    synthetic: true,
    warning: '本数据集完全为虚构演示数据，不包含任何真实个人、账户或交易信息。',
  },
  accounts, records, exchangeRates, products: [], planItems, planTargets, holdings, holdingTxns, settings,
};

fs.mkdirSync(demoDir, { recursive: true });
fs.writeFileSync(jsonPath, `${JSON.stringify(demo, null, 2)}\n`, 'utf8');

const wb = XLSX.utils.book_new();
const rows = {
  BackupInfo: [{ format: 'Fortuna Excel Backup', version: 2, exportedAt: '2026-07-28T08:00:00.000Z', syntheticDemo: true }],
  Settings: settings.map(row => ({ ...row, categories: JSON.stringify(row.categories), currencies: JSON.stringify(row.currencies), snapshotFocusAccountIds: JSON.stringify(row.snapshotFocusAccountIds) })),
  ExchangeRates: exchangeRates,
  Accounts: accounts.map(({ productData, ...row }) => ({ ...row, productData: productData ? JSON.stringify(productData) : '', latestBalance: records.find(record => record.accountId === row.id)?.amount ?? 0 })),
  Records: records,
  Products: [],
  Plan: planItems.map(row => ({ ...row, categories: row.categories.join('|'), allocations: JSON.stringify(row.allocations) })),
  PlanTargets: planTargets.map(row => ({ ...row, refKeys: row.refKeys.join('|'), allocations: JSON.stringify(row.allocations) })),
  Holdings: holdings.map(({ productData, ...row }) => ({ ...row, productData: productData ? JSON.stringify(productData) : '' })),
  HoldingTxns: holdingTxns,
};
for (const [sheetName, data] of Object.entries(rows)) {
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), sheetName);
}
XLSX.writeFile(wb, workbookPath, { compression: true });

console.log(`Wrote ${path.relative(rootDir, jsonPath)}`);
console.log(`Wrote ${path.relative(rootDir, workbookPath)}`);
