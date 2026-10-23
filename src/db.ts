import { isPriceMonitor, type PriceMonitor } from './lib/priceMonitor';
import { isDividendStock, type DividendStock } from './lib/dividendWorkbench';
import { isDividendSelectionPrinciples, type DividendSelectionPrinciples } from './lib/dividendResearch';
import { isDividendPricingMethod, type DividendPricingMethod } from './lib/dividendPricing';
import { isDividendFundPlan, type DividendFundPlan, type DividendStrategy } from './lib/dividendFundPlan';
import Dexie, { type Table } from 'dexie';
import i18n from './i18n';
import { getHoldingMode, type HoldingMode } from './lib/productPortfolio';
import { getBalanceFlowActionKey, getBalanceFlowConfig } from './lib/balanceFlow';
import { getTargetRefKeys } from './lib/allocationPlan';
import { getHoldingContractMultiplier, type UsOptionRight } from './lib/usOption';
import { CURRENT_AUTOMATIC_SNAPSHOT_SCHEMA_VERSION } from './lib/snapshotSchema';
import { describeExcelBackupError, normalizeExcelBackupNumber, type ExcelBackupFailure, type ExcelBackupFailureCode, type ExcelBackupValidationReason } from './lib/excelBackup';

export { CURRENT_AUTOMATIC_SNAPSHOT_SCHEMA_VERSION } from './lib/snapshotSchema';
export { COLOR_THEMES, getTheme, type ColorTheme } from './lib/colorThemes';

export interface Account {
  id: string;
  name: string;
  category: string;
  type: 'asset' | 'liability';
  currency: string;
  icon?: string;
  createdAt: number;
  sortOrder: number;
  metalType?: string;      // XAU, XAG, XPT, XPD — only for 贵金属
  unit?: 'currency' | 'gram'; // gram for precious metals
  institution?: string;
  productData?: Record<string, string>;
  portfolio?: boolean;     // platform-managed equity account: holdings live in `holdings`/`holdingTxns`
  cashBalance?: number;    // portfolio accounts: idle cash on the platform (account currency)
  archivedAt?: number;     // archived accounts are hidden from active totals but keep all history
  includeInTotals?: boolean; // false = keep tracking, but exclude from asset/liability/net-worth totals
  hidden?: boolean;        // presentation-only: hidden from regular overviews/charts until restored in Settings
}

export interface AccountRecord {
  id: string;
  accountId: string;
  date: string;
  amount: number;          // grams if unit=gram (remaining holding after this txn), else currency amount
  note?: string;
  createdAt: number;
  // --- Precious-metal transactional fields ---
  kind?: 'buy' | 'sell';   // metals: a buy(+) or sell(-) transaction
  deltaGrams?: number;     // metals: grams traded in this txn (always a positive magnitude)
  pricePerGram?: number;   // metals: cost price (buy) or sale price (sell) per gram, in account currency
  deltaAmount?: number;    // debt/principal ledgers: amount added or repaid in this record
  balanceAdjustment?: boolean; // debt/principal ledgers: direct balance snapshot, excluded from principal-flow totals
}

export interface ExchangeRate {
  id: string; base: string; quote: string; rate: number; date: string; updatedAt: number;
}

export interface CustomField {
  key: string;
  label: string;
  placeholder?: string;
  options?: string[];
}

export interface CategoryDef {
  name: string; type: 'asset' | 'liability'; icon: string;
  fields?: CustomField[];
}

export interface ProductEntry {
  id: string;
  sectionId: string;   // 'bank_deposit' | 'financial_product' | 'fund_exchange' | 'fund_otc' | 'us_stock' | 'gold' | 'insurance' | 'debt' | 'cashflow'
  data: Record<string, string>;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface PlanResourceAllocation {
  refKey: string;          // 'h:<holdingId>' | 'c:<accountId>' | 'a:<accountId>'
  amountMinor?: number;    // source-currency amount × 100; omitted = use remaining value
}

// A bucket of the user's target asset allocation. Each entry of `categories` is a scope:
// a whole category ('银行存款'), a market slice ('股票/ETF@us'), one account ('acct:<id>'),
// one holding ('hold:<id>') or one portfolio cash pool ('cash:<accountId>').
export interface PlanItem {
  id: string;
  name: string;
  targetPercent: number;   // 0–100
  plannedPurchases?: string; // user's purchase intentions, independent of existing holdings
  categories: string[];    // scopes covered by this bucket
  allocations?: PlanResourceAllocation[]; // explicit shares for exact holding/cash/account scopes
  sortOrder: number;
  createdAt: number;
}

// A second-level allocation subcategory inside a PlanItem. Products are third-level
// links whose current values roll up into this target; they never replace its label.
export interface PlanTarget {
  id: string;
  planItemId: string;
  label: string;           // subcategory name, independent from linked product names
  refKeys?: string[];      // linked resources: holding 'h:', cash 'c:' or account 'a:'
  allocations?: PlanResourceAllocation[]; // amount assigned from each linked resource
  refKey?: string;         // legacy single-product link; normalized into refKeys on read
  targetPercent?: number;  // 0–100, share of the plan base (optional only for legacy records)
  targetAmount?: number;   // legacy fixed amount; read only to migrate older on-device records
  currency?: string;       // legacy fixed-amount currency; new derived amounts use the primary currency
  sortOrder: number;
  createdAt: number;
}

// One security held inside a portfolio (platform-managed) account.
export interface Holding {
  id: string;
  accountId: string;
  name: string;
  symbol?: string;         // ticker / fund code
  market?: string;         // A股 / 美股 / 港股 ...
  instrumentType?: 'us_option'; // undefined = regular security / legacy holding
  optionUnderlying?: string;
  optionExpiration?: string; // YYYY-MM-DD
  optionRight?: UsOptionRight;
  optionStrikeMilli?: number; // strike × 1000 (OSI precision)
  contractMultiplier?: number; // normally 100 for US equity options
  mode?: HoldingMode;      // unit = quantity × price, balance = current balance tracked by amount deltas
  productData?: Record<string, string>; // per-product metadata, e.g. deposit rate and maturity
  lastPrice: number;       // latest quote, manually maintained (account currency)
  priceDate?: string;
  sortOrder: number;
  createdAt: number;
}

export interface HoldingTxn {
  id: string;
  accountId: string;
  holdingId: string;
  date: string;
  kind: 'buy' | 'sell';
  shares: number;          // positive magnitude
  price: number;           // per share, account currency
  balanceSnapshot?: number; // balance-mode holdings: direct balance anchor, excluded from principal-flow totals
  quantitySnapshot?: number; // unit holdings: direct quantity anchor, never a synthetic buy/sell
  costPriceSnapshot?: number; // optional average buy cost per share at the quantity anchor
  brokerRef?: string; // optional broker fill/reference ID, scoped to this holding for import deduplication
  note?: string;
  createdAt: number;
}

export interface Settings {
  id: string;
  primaryCurrency: string;
  categories: CategoryDef[];
  currencies: string[];
  colorTheme: string;        // theme id
  amountVisible: boolean;    // false = masked by default
  showArchivedAccounts?: boolean; // whether archived accounts are expanded on the asset overview
  themeMode?: 'light' | 'dark' | 'auto';
  fontSize?: 'small' | 'normal' | 'large';
  language?: 'auto' | 'zh' | 'en';
  goldPriceSource?: GoldPriceSource;  // which gold price convention to value precious metals with
  metalTxnMigrated?: boolean;         // legacy metal snapshot records converted to buy/sell deltas
  dividendBudgetMinor?: number; // CNY cents
  dividendWorkbenchInitialized?: boolean;
  dividendHomeCollapsedCodes?: string[];
  dividendStrategy?: DividendStrategy;
  dividendFundPlan?: DividendFundPlan;
  dividendSelectionPrinciples?: DividendSelectionPrinciples;
  dividendPricingMethod?: DividendPricingMethod;
  planTargetTotal?: number;           // optional target total assets for the allocation plan (primary currency)
  onboardingVersion?: number;         // 0 = show first-install guide; current version = completed/skipped
  snapshotFocusAccountIds?: string[]; // optional focus labels in the portable automatic snapshot
  automaticSnapshotSchemaVersion?: number; // last portable snapshot schema successfully handled on this install
}

// Keep reading the former private-build field without exposing it in the public schema.
const LEGACY_SNAPSHOT_FOCUS_KEY = ['imper', 'iumSyncAccountIds'].join('');

function getLegacySnapshotFocusIds(value: object): string[] | undefined {
  const candidate = (value as Record<string, unknown>)[LEGACY_SNAPSHOT_FOCUS_KEY];
  return Array.isArray(candidate) && candidate.every(item => typeof item === 'string')
    ? candidate as string[]
    : undefined;
}

export const CURRENT_ONBOARDING_VERSION = 1;

// Both persisted modes use global spot. 'domestic' keeps the legacy CNY-per-gram
// conversion path for compatibility; it is not a Shanghai Gold Exchange quote.
export type GoldPriceSource = 'international' | 'domestic';

// ---- Precious Metals ----
export const METAL_TYPES = [
  { code: 'XAU', name: '黄金', icon: '🥇' },
  { code: 'XAG', name: '白银', icon: '🥈' },
  { code: 'XPT', name: '铂金', icon: '⬜' },
  { code: 'XPD', name: '钯金', icon: '🔘' },
];
export const TROY_OZ_TO_GRAM = 31.1035;

// ---- Default Data ----
export const DEFAULT_CATEGORIES: CategoryDef[] = [
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

export const DEFAULT_CURRENCIES = ['CNY', 'USD', 'EUR', 'GBP', 'JPY', 'HKD', 'SGD', 'AUD', 'CAD', 'CHF'];

const LOCALE_CURRENCY: Record<string, string> = {
  AT: 'EUR', AU: 'AUD', BE: 'EUR', BR: 'BRL', CA: 'CAD', CH: 'CHF', CN: 'CNY',
  CY: 'EUR', CZ: 'CZK', DE: 'EUR', DK: 'DKK', EE: 'EUR', ES: 'EUR', FI: 'EUR',
  FR: 'EUR', GB: 'GBP', GR: 'EUR', HK: 'HKD', HR: 'EUR', HU: 'HUF', ID: 'IDR',
  IE: 'EUR', IL: 'ILS', IN: 'INR', IT: 'EUR', JP: 'JPY', KR: 'KRW', LT: 'EUR',
  LU: 'EUR', LV: 'EUR', MT: 'EUR', MX: 'MXN', MY: 'MYR', NL: 'EUR', NO: 'NOK',
  NZ: 'NZD', PH: 'PHP', PL: 'PLN', PT: 'EUR', RU: 'RUB', SE: 'SEK', SG: 'SGD',
  SI: 'EUR', SK: 'EUR', TH: 'THB', TR: 'TRY', TW: 'TWD', US: 'USD', ZA: 'ZAR',
};

function getDefaultCurrency(): string {
  if (typeof navigator === 'undefined') return 'CNY';
  const locale = navigator.language || '';
  const region = locale.match(/[-_]([A-Za-z]{2})$/)?.[1]?.toUpperCase();
  if (region && LOCALE_CURRENCY[region]) return LOCALE_CURRENCY[region];
  if (locale.toLowerCase().startsWith('zh')) return 'CNY';
  return 'USD';
}

export const CURRENCY_NAMES: Record<string, string> = {
  CNY: '人民币', USD: '美元', EUR: '欧元', GBP: '英镑', JPY: '日元',
  HKD: '港币', SGD: '新加坡元', AUD: '澳元', CAD: '加拿大元', CHF: '瑞士法郎',
  KRW: '韩元', TWD: '新台币', THB: '泰铢', MYR: '马来西亚林吉特', INR: '印度卢比',
  NZD: '新西兰元', SEK: '瑞典克朗', NOK: '挪威克朗', DKK: '丹麦克朗', RUB: '俄罗斯卢布',
  BRL: '巴西雷亚尔', ZAR: '南非兰特', MXN: '墨西哥比索', PHP: '菲律宾比索',
  IDR: '印尼盾', PLN: '波兰兹罗提', CZK: '捷克克朗', HUF: '匈牙利福林',
  TRY: '土耳其里拉', ILS: '以色列谢克尔',
};

// ---- Database ----
class AssetManagerDB extends Dexie {
  accounts!: Table<Account>;
  records!: Table<AccountRecord>;
  exchangeRates!: Table<ExchangeRate>;
  settings!: Table<Settings>;
  products!: Table<ProductEntry>;
  planItems!: Table<PlanItem>;
  planTargets!: Table<PlanTarget>;
  holdings!: Table<Holding>;
  holdingTxns!: Table<HoldingTxn>;
  dividendStocks!: Table<DividendStock>;
  priceMonitors!: Table<PriceMonitor>;

  constructor() {
    super('AssetManagerDB');
    this.version(3).stores({
      accounts: 'id, name, category, type, currency, sortOrder',
      records: 'id, accountId, date, createdAt',
      exchangeRates: 'id, base, quote',
      settings: 'id',
    });
    this.version(4).stores({
      accounts: 'id, name, category, type, currency, sortOrder',
      records: 'id, accountId, date, createdAt',
      exchangeRates: 'id, base, quote',
      settings: 'id',
      products: 'id, sectionId, sortOrder, createdAt',
    });
    this.version(5).stores({
      accounts: 'id, name, category, type, currency, sortOrder, institution',
      records: 'id, accountId, date, createdAt',
      exchangeRates: 'id, base, quote',
      settings: 'id',
      products: 'id, sectionId, sortOrder, createdAt',
    });
    this.version(6).stores({
      accounts: 'id, name, category, type, currency, sortOrder, institution',
      records: 'id, accountId, date, createdAt',
      exchangeRates: 'id, base, quote',
      settings: 'id',
      products: 'id, sectionId, sortOrder, createdAt',
      planItems: 'id, sortOrder',
      holdings: 'id, accountId, sortOrder',
      holdingTxns: 'id, accountId, holdingId, date, createdAt',
    });
    this.version(7).stores({
      accounts: 'id, name, category, type, currency, sortOrder, institution',
      records: 'id, accountId, date, createdAt',
      exchangeRates: 'id, base, quote',
      settings: 'id',
      products: 'id, sectionId, sortOrder, createdAt',
      planItems: 'id, sortOrder',
      planTargets: 'id, planItemId, sortOrder',
      holdings: 'id, accountId, sortOrder',
      holdingTxns: 'id, accountId, holdingId, date, createdAt',
    });
    this.version(8).stores({
      accounts: 'id, name, category, type, currency, sortOrder, institution, archivedAt',
      records: 'id, accountId, date, createdAt',
      exchangeRates: 'id, base, quote',
      settings: 'id',
      products: 'id, sectionId, sortOrder, createdAt',
      planItems: 'id, sortOrder',
      planTargets: 'id, planItemId, sortOrder',
      holdings: 'id, accountId, sortOrder',
      holdingTxns: 'id, accountId, holdingId, date, createdAt',
    });
    this.version(9).stores({
      accounts: 'id, name, category, type, currency, sortOrder, institution, archivedAt',
      records: 'id, accountId, date, createdAt',
      exchangeRates: 'id, base, quote',
      settings: 'id',
      products: 'id, sectionId, sortOrder, createdAt',
      planItems: 'id, sortOrder',
      planTargets: 'id, planItemId, sortOrder',
      holdings: 'id, accountId, sortOrder',
      holdingTxns: 'id, accountId, holdingId, date, createdAt',
    });
    this.version(10).stores({ dividendStocks: 'code, group' });
    this.version(11).stores({ priceMonitors: 'id, kind, status, accountId, createdAt' });
  }
}

export const db = new AssetManagerDB();

let settingsInitialization: Promise<Settings> | null = null;

export async function initializeSettings(): Promise<Settings> {
  if (!settingsInitialization) settingsInitialization = initializeSettingsOnce();
  try {
    return await settingsInitialization;
  } finally {
    settingsInitialization = null;
  }
}

/** Persist only edited fields so stale page state cannot replace newer budgets or preferences. */
export async function updateSettings(updates: Partial<Omit<Settings, 'id'>>): Promise<Settings> {
  await initializeSettings();
  return db.transaction('rw', db.settings, async () => {
    await db.settings.update('main', updates);
    const settings = await db.settings.get('main');
    if (!settings) throw new Error('SETTINGS_NOT_FOUND');
    return settings;
  });
}

function createDefaultSettings(): Settings {
  const primaryCurrency = getDefaultCurrency();
  const currencies = DEFAULT_CURRENCIES.includes(primaryCurrency)
    ? [...DEFAULT_CURRENCIES]
    : [primaryCurrency, ...DEFAULT_CURRENCIES];
  return {
    id: 'main', primaryCurrency,
    categories: [...DEFAULT_CATEGORIES], currencies,
    colorTheme: 'emerald-rose', amountVisible: false,
    showArchivedAccounts: true,
    themeMode: 'auto', fontSize: 'normal',
    language: 'auto',
    goldPriceSource: primaryCurrency === 'CNY' ? 'domestic' : 'international',
    onboardingVersion: 0,
    snapshotFocusAccountIds: [],
    automaticSnapshotSchemaVersion: CURRENT_AUTOMATIC_SNAPSHOT_SCHEMA_VERSION,
  };
}

async function initializeSettingsOnce(): Promise<Settings> {
  let settings = await db.settings.get('main');
  const isNewInstall = !settings;
  if (!settings) {
    settings = createDefaultSettings();
    await db.settings.put(settings);
  }
  // Migrate old settings missing new fields
  let updated = false;
  if (settings.colorTheme === undefined) {
    settings.colorTheme = 'emerald-rose';
    settings.amountVisible = true;
    updated = true;
  }
  if (settings.themeMode === undefined) {
    settings.themeMode = 'auto';
    settings.fontSize = 'normal';
    updated = true;
  }
  if (settings.showArchivedAccounts === undefined) {
    settings.showArchivedAccounts = true;
    updated = true;
  }
  if (settings.language === undefined) {
    settings.language = 'auto';
    updated = true;
  }
  if (settings.goldPriceSource === undefined) {
    // CNY users default to the legacy CNY-per-gram conversion; others use direct account-currency conversion.
    settings.goldPriceSource = settings.primaryCurrency === 'CNY' ? 'domestic' : 'international';
    updated = true;
  }
  if (settings.onboardingVersion === undefined) {
    // Existing installations should not be interrupted by an upgrade-only onboarding modal.
    settings.onboardingVersion = isNewInstall ? 0 : CURRENT_ONBOARDING_VERSION;
    updated = true;
  }
  if (settings.snapshotFocusAccountIds === undefined) {
    settings.snapshotFocusAccountIds = getLegacySnapshotFocusIds(settings) ?? [];
    updated = true;
  }
  if (settings.automaticSnapshotSchemaVersion === undefined) {
    // Existing installs may have a configured on-disk snapshot that needs one idle rewrite.
    settings.automaticSnapshotSchemaVersion = isNewInstall ? CURRENT_AUTOMATIC_SNAPSHOT_SCHEMA_VERSION : 0;
    updated = true;
  }
  if (LEGACY_SNAPSHOT_FOCUS_KEY in (settings as unknown as Record<string, unknown>)) {
    delete (settings as unknown as Record<string, unknown>)[LEGACY_SNAPSHOT_FOCUS_KEY];
    updated = true;
  }
  // Migrate old "股票" category → "股票/ETF"
  const oldStockIdx = settings.categories.findIndex(c => c.name === '股票');
  if (oldStockIdx >= 0) {
    settings.categories[oldStockIdx].name = '股票/ETF';
    updated = true;
    // Also update existing accounts that reference the old name
    const oldAccounts = await db.accounts.where('category').equals('股票').toArray();
    for (const a of oldAccounts) {
      await db.accounts.update(a.id!, { category: '股票/ETF' });
    }
  }
  if (updated) {
    await db.settings.put(settings);
  }
  // One-time conversion of legacy metal "snapshot" records into buy/sell deltas
  if (!settings.metalTxnMigrated) {
    try {
      await migrateMetalRecords();
    } catch (e) {
      console.warn('Metal record migration failed', e);
    }
    settings.metalTxnMigrated = true;
    await db.settings.put(settings);
  }
  return settings;
}

/**
 * Legacy precious-metal records stored `amount` as the running total grams (a snapshot).
 * The new model keeps that snapshot but also records each transaction as a buy/sell delta.
 * This backfills kind/deltaGrams from consecutive snapshot diffs so edits/recompute work.
 */
async function migrateMetalRecords(): Promise<void> {
  const metalAccounts = await db.accounts.filter(a => a.unit === 'gram').toArray();
  for (const acct of metalAccounts) {
    const recs = (await db.records.where('accountId').equals(acct.id).toArray())
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
    const seedCost = acct.productData?.avg_cost ? parseFloat(acct.productData.avg_cost.replace(/[^\d.]/g, '')) : NaN;
    let prev = 0;
    for (const r of recs) {
      if (r.kind || r.deltaGrams != null) { prev = r.amount; continue; }  // already transactional
      const delta = r.amount - prev;
      const kind: 'buy' | 'sell' = delta >= 0 ? 'buy' : 'sell';
      const update: Partial<AccountRecord> = { kind, deltaGrams: Math.abs(delta) };
      if (kind === 'buy' && !isNaN(seedCost) && seedCost > 0) update.pricePerGram = seedCost;
      await db.records.update(r.id, update);
      prev = r.amount;
    }
  }
}

// ---- Data Import / Export ----
export async function hasLedgerData(): Promise<boolean> {
  const tables = [db.accounts, db.records, db.products, db.planItems, db.planTargets, db.holdings, db.holdingTxns, db.dividendStocks, db.priceMonitors];
  return db.transaction('r', tables, async () => (await Promise.all(tables.map(table => table.count()))).some(count => count > 0));
}

async function readBackupTables() {
  // Keep all tables at the same point in time; concurrent writes wait until this
  // read transaction ends, so exports cannot contain orphan records/holdings.
  return db.transaction('r', [db.accounts, db.records, db.exchangeRates, db.settings, db.products, db.planItems, db.planTargets, db.holdings, db.holdingTxns, db.dividendStocks, db.priceMonitors], async () => {
    const [accounts, records, exchangeRates, settings, products, planItems, planTargets, holdings, holdingTxns, dividendStocks, priceMonitors] = await Promise.all([
      db.accounts.toArray(), db.records.toArray(), db.exchangeRates.toArray(), db.settings.toArray(), db.products.toArray(),
      db.planItems.toArray(), db.planTargets.toArray(), db.holdings.toArray(), db.holdingTxns.toArray(), db.dividendStocks.toArray(), db.priceMonitors.toArray(),
    ]);
    return { accounts, records, exchangeRates, settings, products, planItems, planTargets, holdings, holdingTxns, dividendStocks, priceMonitors };
  });
}

export async function exportData(): Promise<string> {
  const data = { version: 14, timestamp: Date.now(), ...await readBackupTables() };
  return JSON.stringify(data);
}

export async function importData(jsonData: string): Promise<boolean> {
  try {
    const data = JSON.parse(jsonData);
    if (!data.accounts || !data.records || !data.settings) return false;
    if (!Array.isArray(data.settings) || !data.settings.every((row: Settings) => row && (row.dividendPricingMethod === undefined || isDividendPricingMethod(row.dividendPricingMethod)) && (row.dividendSelectionPrinciples === undefined || isDividendSelectionPrinciples(row.dividendSelectionPrinciples)) && (row.dividendFundPlan === undefined || isDividendFundPlan(row.dividendFundPlan)) && (row.dividendStrategy === undefined || ['stocks', 'funds'].includes(row.dividendStrategy)))) return false;
    if (data.dividendStocks !== undefined && (!Array.isArray(data.dividendStocks) || !data.dividendStocks.every(isDividendStock))) return false;

    if (data.priceMonitors !== undefined && (!Array.isArray(data.priceMonitors) || !data.priceMonitors.every(isPriceMonitor) || new Set(data.priceMonitors.map((plan: PriceMonitor) => plan.id)).size !== data.priceMonitors.length)) return false;

    await db.transaction('rw', [db.accounts, db.records, db.exchangeRates, db.settings, db.products, db.planItems, db.planTargets, db.holdings, db.holdingTxns, db.dividendStocks, db.priceMonitors], async () => {
      await db.accounts.clear();
      await db.records.clear();
      await db.settings.clear();
      if (Array.isArray(data.exchangeRates)) await db.exchangeRates.clear();
      await db.products.clear();
      await db.planItems.clear();
      await db.planTargets.clear();
      await db.holdings.clear();
      await db.holdingTxns.clear();
      await db.dividendStocks.clear();
      await db.priceMonitors.clear();

      if (data.accounts.length > 0) await db.accounts.bulkAdd(data.accounts);
      if (data.records.length > 0) await db.records.bulkAdd(data.records);
      if (data.settings.length > 0) await db.settings.bulkAdd(data.settings);
      if (Array.isArray(data.exchangeRates) && data.exchangeRates.length > 0) await db.exchangeRates.bulkAdd(data.exchangeRates);
      if (data.products && data.products.length > 0) await db.products.bulkAdd(data.products);
      if (data.planItems && data.planItems.length > 0) await db.planItems.bulkAdd(data.planItems);
      if (data.planTargets && data.planTargets.length > 0) await db.planTargets.bulkAdd(data.planTargets);
      if (data.holdings && data.holdings.length > 0) await db.holdings.bulkAdd(data.holdings);
      if (data.holdingTxns && data.holdingTxns.length > 0) await db.holdingTxns.bulkAdd(data.holdingTxns);
      if (data.dividendStocks?.length) await db.dividendStocks.bulkAdd(data.dividendStocks);
      if (data.priceMonitors?.length) await db.priceMonitors.bulkAdd(data.priceMonitors);
    });
    return true;
  } catch (e) {
    console.error('Import failed', e);
    return false;
  }
}

export async function exportToExcel(): Promise<string> {
  const XLSX = await import('xlsx');
  const { accounts, records, exchangeRates, settings: settingsRows, products, planItems, planTargets, holdings, holdingTxns, dividendStocks, priceMonitors } = await readBackupTables();
  const settingsExport = settingsRows.map(row => {
    const publicRow = { ...row } as Record<string, unknown>;
    delete publicRow[LEGACY_SNAPSHOT_FOCUS_KEY];
    return {
      ...publicRow,
      categories: JSON.stringify(row.categories),
      currencies: JSON.stringify(row.currencies),
      snapshotFocusAccountIds: JSON.stringify(row.snapshotFocusAccountIds ?? []),
      dividendFundPlan: row.dividendFundPlan === undefined ? '' : JSON.stringify(row.dividendFundPlan),
      dividendSelectionPrinciples: row.dividendSelectionPrinciples === undefined ? '' : JSON.stringify(row.dividendSelectionPrinciples),
      dividendPricingMethod: row.dividendPricingMethod === undefined ? '' : JSON.stringify(row.dividendPricingMethod),
    };
  });
  const metadataExport = [{
    format: 'Fortuna Excel Backup',
    version: 6,
    exportedAt: new Date().toISOString(),
  }];

  const accountsExport = accounts.map(acct => {
    const acctRecords = records.filter(r => r.accountId === acct.id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    const { productData, ...rest } = acct;
    return {
      ...rest,
      productData: productData ? JSON.stringify(productData) : '',
      latestBalance: acctRecords.length > 0 ? acctRecords[0].amount : 0
    };
  });
  
  // Flatten products data for excel export
  const productsExport = products.map(p => ({
    id: p.id,
    sectionId: p.sectionId,
    sortOrder: p.sortOrder,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    ...p.data
  }));
  
  // Category names are user-defined and may contain the legacy "|" separator.
  const planExport = planItems.map(p => ({
    ...p,
    categories: JSON.stringify(p.categories),
    allocations: JSON.stringify(p.allocations ?? []),
  }));
  const planTargetsExport = planTargets.map(target => ({
    ...target,
    refKeys: getTargetRefKeys(target).join('|'),
    allocations: JSON.stringify(target.allocations ?? []),
  }));
  const holdingsExport = holdings.map(holding => ({
    ...holding,
    productData: holding.productData ? JSON.stringify(holding.productData) : '',
  }));

  // Human-readable trade history of portfolio holdings (names joined in, localized headers).
  // Read-only companion sheet — import still uses the raw HoldingTxns sheet.
  const t = i18n.t.bind(i18n);
  const acctById = new Map(accounts.map(a => [a.id, a]));
  const holdingById = new Map(holdings.map(h => [h.id, h]));
  const historyExport = holdingTxns
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
    .map(tx => {
      const acct = acctById.get(tx.accountId);
      const h = holdingById.get(tx.holdingId);
      const multiplier = h ? getHoldingContractMultiplier(h) : 1;
      const balanceFlow = acct && h && getHoldingMode(acct.category, h) === 'balance'
        ? getBalanceFlowConfig(acct.category, acct.type)
        : null;
      const isBalanceAdjustment = tx.balanceSnapshot != null;
      const isPositionAdjustment = tx.quantitySnapshot != null;
      return {
        [t('xh_date')]: tx.date,
        [t('xh_account')]: acct?.name ?? tx.accountId,
        [t('xh_category')]: acct ? t(acct.category) : '',
        [t('xh_name')]: h?.name ?? tx.holdingId,
        [t('xh_symbol')]: h?.symbol ?? '',
        [t('xh_market')]: h?.market ?? '',
        [t('xh_action')]: isPositionAdjustment
          ? t('holding_position_adjustment')
          : isBalanceAdjustment
          ? t('balance_adjustment')
          : balanceFlow
          ? t(getBalanceFlowActionKey(balanceFlow, tx.kind))
          : (tx.kind === 'buy' ? t('xh_buy') : t('xh_sell')),
        [t('xh_shares')]: isPositionAdjustment ? tx.quantitySnapshot : isBalanceAdjustment ? '' : tx.shares,
        [t('xh_price')]: isBalanceAdjustment || isPositionAdjustment ? '' : tx.price,
        [t('holding_cost_price')]: isPositionAdjustment ? tx.costPriceSnapshot ?? '' : '',
        [t('xh_amount')]: isPositionAdjustment ? '' : isBalanceAdjustment
          ? tx.balanceSnapshot
          : Math.round(tx.shares * tx.price * multiplier * 100) / 100,
        [t('xh_currency')]: acct?.currency ?? '',
        [t('xh_note')]: tx.note ?? '',
      };
    });

  const wb = XLSX.utils.book_new();
  const wsAccounts = XLSX.utils.json_to_sheet(accountsExport);
  const wsRecords = XLSX.utils.json_to_sheet(records);
  const wsMetadata = XLSX.utils.json_to_sheet(metadataExport);
  const wsSettings = XLSX.utils.json_to_sheet(settingsExport);
  const wsExchangeRates = XLSX.utils.json_to_sheet(exchangeRates);
  const wsProducts = XLSX.utils.json_to_sheet(productsExport);
  const wsPlan = XLSX.utils.json_to_sheet(planExport);
  const wsPlanTargets = XLSX.utils.json_to_sheet(planTargetsExport);
  const wsHoldings = XLSX.utils.json_to_sheet(holdingsExport);
  const wsHoldingTxns = XLSX.utils.json_to_sheet(holdingTxns);
  const wsHistory = XLSX.utils.json_to_sheet(historyExport);

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dividendStocks.map(s => ({ code: s.code, data: JSON.stringify(s) }))), "DividendStocks");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(priceMonitors.map(plan => ({ id: plan.id, data: JSON.stringify(plan) }))), "PriceMonitors");
  XLSX.utils.book_append_sheet(wb, wsMetadata, "BackupInfo");
  XLSX.utils.book_append_sheet(wb, wsSettings, "Settings");
  XLSX.utils.book_append_sheet(wb, wsExchangeRates, "ExchangeRates");
  XLSX.utils.book_append_sheet(wb, wsAccounts, "Accounts");
  XLSX.utils.book_append_sheet(wb, wsRecords, "Records");
  XLSX.utils.book_append_sheet(wb, wsProducts, "Products");
  XLSX.utils.book_append_sheet(wb, wsPlan, "Plan");
  XLSX.utils.book_append_sheet(wb, wsPlanTargets, "PlanTargets");
  XLSX.utils.book_append_sheet(wb, wsHoldings, "Holdings");
  XLSX.utils.book_append_sheet(wb, wsHoldingTxns, "HoldingTxns");
  XLSX.utils.book_append_sheet(wb, wsHistory, t('xh_sheet_history'));

  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}

export async function importFromExcel(data: string | ArrayBuffer | Uint8Array, onFailure?: (failure: ExcelBackupFailure) => void): Promise<boolean> {
  let stage: ExcelBackupFailureCode = 'unreadable_workbook';
  let sheet: string | undefined;
  const fail = (code: ExcelBackupFailureCode, sheet?: string, issue?: Pick<ExcelBackupFailure, 'row' | 'field' | 'reason'>): false => {
    onFailure?.({ code, sheet, ...issue });
    return false;
  };
  try {
    const xlsxModule = await import('xlsx');
    const XLSX = xlsxModule.default ?? xlsxModule;
    const wb = XLSX.read(data, { type: typeof data === 'string' ? 'base64' : 'array' });
    stage = 'invalid_data';
    const wsAccounts = wb.Sheets["Accounts"];
    const wsRecords = wb.Sheets["Records"];
    const wsProducts = wb.Sheets["Products"];
    const wsPlan = wb.Sheets["Plan"];
    const wsPlanTargets = wb.Sheets["PlanTargets"];
    const wsHoldings = wb.Sheets["Holdings"];
    const wsHoldingTxns = wb.Sheets["HoldingTxns"];
    const wsSettings = wb.Sheets["Settings"];
    const wsExchangeRates = wb.Sheets["ExchangeRates"];
    const wsMetadata = wb.Sheets["BackupInfo"];
    if (!wsAccounts || !wsRecords) return fail('not_backup');
    sheet = 'DividendStocks';
    const dividendStocks: DividendStock[] = wb.Sheets.DividendStocks
      ? XLSX.utils.sheet_to_json<{ data: string }>(wb.Sheets.DividendStocks).map(row => JSON.parse(row.data)) : [];
    if (!dividendStocks.every(isDividendStock) || new Set(dividendStocks.map(s => s.code)).size !== dividendStocks.length) return fail('invalid_data', sheet);
    sheet = 'PriceMonitors';
    const priceMonitors: PriceMonitor[] = wb.Sheets.PriceMonitors
      ? XLSX.utils.sheet_to_json<{ data: string }>(wb.Sheets.PriceMonitors).map(row => JSON.parse(row.data)) : [];
    if (!priceMonitors.every(isPriceMonitor) || new Set(priceMonitors.map(plan => plan.id)).size !== priceMonitors.length) return fail('invalid_data', sheet);
    sheet = 'BackupInfo';
    const metadata = wsMetadata
      ? XLSX.utils.sheet_to_json<Record<string, unknown>>(wsMetadata)[0]
      : undefined;
    const recognizedBackup = metadata?.format === 'Fortuna Excel Backup';
    const backupVersion = Number(metadata?.version) || 0;
    if (recognizedBackup && backupVersion > 6) return fail('unsupported_version');
    const needsLegacyMetalMigration = !recognizedBackup || backupVersion < 2;
    
    const parseBoolean = (value: unknown, fallback: boolean): boolean => {
      if (value === undefined || value === null || value === '') return fallback;
      return value === true || value === 1 || String(value).toLowerCase() === 'true';
    };
    sheet = 'Accounts';
    const rawAccounts = XLSX.utils.sheet_to_json<Record<string, unknown>>(wsAccounts);
    const accounts: Account[] = rawAccounts.map((row) => {
      const { productData, latestBalance: _latestBalance, ...rest } = row;
      void _latestBalance;
      return {
        ...rest,
        includeInTotals: parseBoolean(rest.includeInTotals, true),
        hidden: parseBoolean(rest.hidden, false),
        productData: typeof productData === 'string' ? (() => { try { return JSON.parse(productData) as Record<string, string>; } catch { return undefined; } })() : undefined,
      } as Account;
    });
    sheet = 'Records';
    const records = XLSX.utils.sheet_to_json<AccountRecord>(wsRecords);
    sheet = 'Products';
    const productsRaw = wsProducts ? XLSX.utils.sheet_to_json<Record<string, unknown>>(wsProducts) : [];
    
    // Reconstruct nested data object for products
    const products: ProductEntry[] = productsRaw.map(p => {
      const { id, sectionId, sortOrder, createdAt, updatedAt, ...data } = p;
      return {
        id: String(id),
        sectionId: String(sectionId),
        sortOrder: Number(sortOrder),
        createdAt: Number(createdAt),
        updatedAt: Number(updatedAt),
        data: Object.fromEntries(
          Object.entries(data)
            .filter(([, value]) => value !== undefined && value !== null && value !== '')
            .map(([key, value]) => [key, String(value)])
        ),
      };
    });
    
    sheet = 'Plan';
    const planRaw = wsPlan ? XLSX.utils.sheet_to_json<Record<string, unknown>>(wsPlan) : [];
    const parsePlanCategories = (value: unknown): string[] => {
      if (!recognizedBackup || backupVersion < 5) {
        return typeof value === 'string' && value ? value.split('|') : [];
      }
      const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : undefined;
      if (!Array.isArray(parsed) || !parsed.every(category => typeof category === 'string')) {
        throw new Error('Invalid plan categories');
      }
      return parsed;
    };
    const parseAllocations = (value: unknown): PlanResourceAllocation[] => {
      if (typeof value !== 'string' || !value) return [];
      try {
        const parsed = JSON.parse(value) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed.flatMap(allocation => {
          if (!allocation || typeof allocation !== 'object') return [];
          const row = allocation as Record<string, unknown>;
          if (typeof row.refKey !== 'string' || !row.refKey) return [];
          const amountMinor = row.amountMinor === undefined || row.amountMinor === null || row.amountMinor === ''
            ? undefined
            : Number(row.amountMinor);
          return [{ refKey: row.refKey, amountMinor: Number.isFinite(amountMinor) ? amountMinor : undefined }];
        });
      } catch {
        return [];
      }
    };
    const planItems: PlanItem[] = planRaw.map(p => ({
      id: String(p.id),
      name: String(p.name ?? ''),
      targetPercent: Number(p.targetPercent) || 0,
      plannedPurchases: typeof p.plannedPurchases === 'string' ? p.plannedPurchases : undefined,
      categories: parsePlanCategories(p.categories),
      allocations: parseAllocations(p.allocations),
      sortOrder: Number(p.sortOrder) || 0,
      createdAt: Number(p.createdAt) || Date.now(),
    }));
    sheet = 'PlanTargets';
    const planTargetRaw = wsPlanTargets ? XLSX.utils.sheet_to_json<Record<string, unknown>>(wsPlanTargets) : [];
    const planTargets: PlanTarget[] = planTargetRaw.map(target => {
      const legacyRefKey = typeof target.refKey === 'string' && target.refKey ? target.refKey : undefined;
      const refKeys = typeof target.refKeys === 'string' && target.refKeys
        ? String(target.refKeys).split('|').filter(Boolean)
        : legacyRefKey ? [legacyRefKey] : [];
      const rawPercent = target.targetPercent;
      const rawAmount = target.targetAmount;
      return {
        id: String(target.id),
        planItemId: String(target.planItemId),
        label: String(target.label ?? ''),
        refKeys,
        allocations: parseAllocations(target.allocations),
        refKey: legacyRefKey,
        targetPercent: rawPercent === undefined || rawPercent === null || rawPercent === ''
          ? undefined
          : Number(rawPercent),
        targetAmount: rawAmount === undefined || rawAmount === null || rawAmount === ''
          ? undefined
          : Number(rawAmount),
        currency: typeof target.currency === 'string' && target.currency ? target.currency : undefined,
        sortOrder: Number(target.sortOrder) || 0,
        createdAt: Number(target.createdAt) || Date.now(),
      };
    });
    sheet = 'Holdings';
    const holdings = wsHoldings
      ? XLSX.utils.sheet_to_json<Record<string, unknown>>(wsHoldings).map(row => {
          const { productData, ...rest } = row;
          return {
            ...rest,
            productData: typeof productData === 'string'
              ? (() => { try { return JSON.parse(productData) as Record<string, string>; } catch { return undefined; } })()
              : undefined,
          } as Holding;
        })
      : [];
    sheet = 'HoldingTxns';
    const holdingTxnRows = wsHoldingTxns ? XLSX.utils.sheet_to_json<Record<string, unknown>>(wsHoldingTxns) : [];
    const holdingTxns = holdingTxnRows.map(row => {
      const normalized = { ...row };
      for (const field of ['shares', 'price', 'createdAt']) normalized[field] = normalizeExcelBackupNumber(row[field]);
      for (const field of ['balanceSnapshot', 'quantitySnapshot', 'costPriceSnapshot']) {
        const value = row[field];
        // Edited workbooks can write empty strings where an exported optional cell was absent.
        if (value == null || (typeof value === 'string' && value.trim() === '')) delete normalized[field];
        else normalized[field] = normalizeExcelBackupNumber(value);
      }
      if (typeof row.date === 'number' && Number.isInteger(row.date)) {
        const date = XLSX.SSF.parse_date_code(row.date, { date1904: parseBoolean(wb.Workbook?.WBProps?.date1904, false) });
        if (date) normalized.date = `${String(date.y).padStart(4, '0')}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
      } else if (typeof row.date === 'string') {
        const date = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(row.date.trim());
        if (date) normalized.date = `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}`;
      }
      return normalized as unknown as HoldingTxn;
    });

    const parseJson = <T,>(value: unknown, fallback: T): T => {
      if (typeof value !== 'string' || !value) return fallback;
      try { return JSON.parse(value) as T; } catch { return fallback; }
    };
    sheet = 'Settings';
    const settingsRaw = wsSettings ? XLSX.utils.sheet_to_json<Record<string, unknown>>(wsSettings) : [];
    if (!settingsRaw.every(row => (row.dividendPricingMethod === undefined || row.dividendPricingMethod === '' || (typeof row.dividendPricingMethod === 'string' && isDividendPricingMethod(JSON.parse(row.dividendPricingMethod)))) && (row.dividendSelectionPrinciples === undefined || row.dividendSelectionPrinciples === '' || (typeof row.dividendSelectionPrinciples === 'string' && isDividendSelectionPrinciples(JSON.parse(row.dividendSelectionPrinciples)))) && (row.dividendFundPlan === undefined || row.dividendFundPlan === '' || (typeof row.dividendFundPlan === 'string' && isDividendFundPlan(JSON.parse(row.dividendFundPlan)))) && (row.dividendStrategy === undefined || ['stocks', 'funds'].includes(String(row.dividendStrategy))))) return fail('invalid_data', sheet);
    const restoredSettings: Settings[] = settingsRaw.flatMap(row => {
      const categories = parseJson<CategoryDef[]>(row.categories, []);
      const currencies = parseJson<string[]>(row.currencies, []);
      if (categories.length === 0 || currencies.length === 0) return [];
      const restored: Settings = {
        id: String(row.id || 'main'),
        primaryCurrency: String(row.primaryCurrency || 'CNY'),
        categories,
        currencies,
        colorTheme: String(row.colorTheme || 'emerald-rose'),
        amountVisible: parseBoolean(row.amountVisible, true),
        showArchivedAccounts: parseBoolean(row.showArchivedAccounts, true),
        themeMode: (row.themeMode === 'light' || row.themeMode === 'dark' ? row.themeMode : 'auto'),
        fontSize: (row.fontSize === 'small' || row.fontSize === 'large' ? row.fontSize : 'normal'),
        language: (row.language === 'zh' || row.language === 'en' ? row.language : 'auto'),
        goldPriceSource: row.goldPriceSource === 'domestic' ? 'domestic' : 'international',
        metalTxnMigrated: needsLegacyMetalMigration ? false : parseBoolean(row.metalTxnMigrated, true),
        onboardingVersion: Number(row.onboardingVersion) || CURRENT_ONBOARDING_VERSION,
        snapshotFocusAccountIds: parseJson<string[]>(
          row.snapshotFocusAccountIds ?? getLegacySnapshotFocusIds(row),
          [],
        ),
        automaticSnapshotSchemaVersion: Number(row.automaticSnapshotSchemaVersion) || 0,
        dividendWorkbenchInitialized: parseBoolean(row.dividendWorkbenchInitialized, false),
        dividendBudgetMinor: Number.isSafeInteger(Number(row.dividendBudgetMinor)) && Number(row.dividendBudgetMinor) >= 0 ? Number(row.dividendBudgetMinor) : undefined,
        dividendStrategy: row.dividendStrategy === 'funds' ? 'funds' : 'stocks',
        dividendFundPlan: parseJson<DividendFundPlan | undefined>(row.dividendFundPlan, undefined),
        dividendSelectionPrinciples: parseJson<DividendSelectionPrinciples | undefined>(row.dividendSelectionPrinciples, undefined),
        dividendPricingMethod: parseJson<DividendPricingMethod | undefined>(row.dividendPricingMethod, undefined),
      };
      const targetTotal = Number(row.planTargetTotal);
      if (Number.isFinite(targetTotal) && targetTotal > 0) restored.planTargetTotal = targetTotal;
      return [restored];
    });
    if (restoredSettings.length !== settingsRaw.length) return fail('invalid_data', 'Settings');
    sheet = 'ExchangeRates';
    const exchangeRates = wsExchangeRates
      ? XLSX.utils.sheet_to_json<ExchangeRate>(wsExchangeRates)
      : [];

    const validId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
    const uniqueIds = (rows: { id: string }[]) => new Set(rows.map(row => row.id)).size === rows.length;
    const accountIds = new Set(accounts.map(account => account.id));
    const holdingsById = new Map(holdings.map(holding => [holding.id, holding]));
    if (!recognizedBackup && accounts.length === 0 && records.length === 0) return fail('not_backup');
    if (!uniqueIds(accounts) || !accounts.every(account => (
      validId(account.id)
      && validId(account.name)
      && validId(account.category)
      && (account.type === 'asset' || account.type === 'liability')
      && validId(account.currency)
      && Number.isFinite(account.createdAt)
      && Number.isFinite(account.sortOrder)
    ))) return fail('invalid_data', 'Accounts');
    if (!uniqueIds(records) || !records.every(record => (
      validId(record.id)
      && validId(record.accountId)
      && accountIds.has(record.accountId)
      && validId(record.date)
      && Number.isFinite(record.amount)
      && Number.isFinite(record.createdAt)
    ))) return fail('invalid_data', 'Records');
    if (!uniqueIds(holdings) || !holdings.every(holding => (
      validId(holding.id)
      && accountIds.has(holding.accountId)
      && validId(holding.name)
      && Number.isFinite(holding.lastPrice)
      && Number.isFinite(holding.createdAt)
      && Number.isFinite(holding.sortOrder)
    ))) return fail('invalid_data', 'Holdings');
    const transactionIds = new Set<string>();
    for (const [index, transaction] of holdingTxns.entries()) {
      const failTransaction = (field: keyof HoldingTxn, reason: ExcelBackupValidationReason) => fail('invalid_data', 'HoldingTxns', {
        row: Number(holdingTxnRows[index].__rowNum__) + 1,
        field,
        reason,
      });
      if (!validId(transaction.id)) return failTransaction('id', 'missing_value');
      if (transactionIds.has(transaction.id)) return failTransaction('id', 'duplicate_id');
      transactionIds.add(transaction.id);
      if (!accountIds.has(transaction.accountId)) return failTransaction('accountId', 'missing_account');
      const holding = holdingsById.get(transaction.holdingId);
      if (!holding) return failTransaction('holdingId', 'missing_holding');
      if (holding.accountId !== transaction.accountId) return failTransaction('accountId', 'holding_account_mismatch');
      const date = typeof transaction.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(transaction.date)
        ? new Date(`${transaction.date}T00:00:00Z`) : undefined;
      if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== transaction.date) return failTransaction('date', 'invalid_date');
      if (transaction.kind !== 'buy' && transaction.kind !== 'sell') return failTransaction('kind', 'invalid_kind');
      for (const field of ['shares', 'price', 'createdAt', 'quantitySnapshot', 'costPriceSnapshot', 'balanceSnapshot'] as const) {
        const value = transaction[field];
        if (value === undefined && ['quantitySnapshot', 'costPriceSnapshot', 'balanceSnapshot'].includes(field)) continue;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return failTransaction(field, 'invalid_number');
      }
      if (transaction.costPriceSnapshot !== undefined && transaction.quantitySnapshot === undefined) return failTransaction('costPriceSnapshot', 'requires_quantity_snapshot');
    }
    if (!uniqueIds(products)) return fail('invalid_data', 'Products');
    if (!uniqueIds(planItems)) return fail('invalid_data', 'Plan');
    if (!uniqueIds(planTargets)) return fail('invalid_data', 'PlanTargets');
    if (!uniqueIds(restoredSettings) || !restoredSettings.every(row => validId(row.id))) return fail('invalid_data', 'Settings');
    if (!uniqueIds(exchangeRates) || !exchangeRates.every(rate => (
      validId(rate.id)
      && validId(rate.base)
      && validId(rate.quote)
      && Number.isFinite(rate.rate)
      && rate.rate > 0
      && Number.isFinite(rate.updatedAt)
    ))) return fail('invalid_data', 'ExchangeRates');

    stage = 'restore_failed';
    sheet = undefined;
    await db.transaction('rw', [db.accounts, db.records, db.exchangeRates, db.settings, db.products, db.planItems, db.planTargets, db.holdings, db.holdingTxns, db.dividendStocks, db.priceMonitors], async () => {
      await db.accounts.clear();
      await db.records.clear();
      await db.products.clear();
      await db.planItems.clear();
      await db.planTargets.clear();
      await db.holdings.clear();
      await db.holdingTxns.clear();
      await db.dividendStocks.clear();
      await db.priceMonitors.clear();
      await db.settings.clear();
      await db.exchangeRates.clear();
      if (accounts.length > 0) await db.accounts.bulkAdd(accounts);
      if (records.length > 0) await db.records.bulkAdd(records);
      if (products.length > 0) await db.products.bulkAdd(products);
      if (planItems.length > 0) await db.planItems.bulkAdd(planItems);
      if (planTargets.length > 0) await db.planTargets.bulkAdd(planTargets);
      if (holdings.length > 0) await db.holdings.bulkAdd(holdings);
      if (holdingTxns.length > 0) await db.holdingTxns.bulkAdd(holdingTxns);
      if (dividendStocks.length) await db.dividendStocks.bulkAdd(dividendStocks);
      if (priceMonitors.length) await db.priceMonitors.bulkAdd(priceMonitors);
      if (restoredSettings.length > 0) await db.settings.bulkAdd(restoredSettings);
      else {
        await db.settings.add({ ...createDefaultSettings(), onboardingVersion: CURRENT_ONBOARDING_VERSION,
          dividendWorkbenchInitialized: dividendStocks.length > 0, dividendStrategy: 'stocks', metalTxnMigrated: !needsLegacyMetalMigration });
      }
      if (exchangeRates.length > 0) await db.exchangeRates.bulkAdd(exchangeRates);
    });
    return true;
  } catch (e) {
    console.error('Excel Import failed', e);
    onFailure?.({ code: stage, sheet, detail: describeExcelBackupError(e) });
    return false;
  }
}
