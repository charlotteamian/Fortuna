import Dexie, { type Table } from 'dexie';
import i18n from './i18n';
import { getHoldingMode, type HoldingMode } from './lib/productPortfolio';
import { getBalanceFlowActionKey, getBalanceFlowConfig } from './lib/balanceFlow';
import { getTargetRefKeys } from './lib/allocationPlan';
import { getHoldingContractMultiplier, type UsOptionRight } from './lib/usOption';
import { CURRENT_AUTOMATIC_SNAPSHOT_SCHEMA_VERSION } from './lib/snapshotSchema';

export { CURRENT_AUTOMATIC_SNAPSHOT_SCHEMA_VERSION } from './lib/snapshotSchema';

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

export interface ColorTheme {
  id: string;
  name: string;
  assetColor: string;
  assetDim: string;
  liabilityColor: string;
  liabilityDim: string;
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

// ---- Color Themes ----
export const COLOR_THEMES: ColorTheme[] = [
  { id: 'emerald-rose', name: '资产翠绿 / 负债玫红', assetColor: '#34d399', assetDim: 'rgba(52,211,153,0.10)', liabilityColor: '#fb7185', liabilityDim: 'rgba(251,113,133,0.10)' },
  { id: 'rose-emerald', name: '资产玫红 / 负债翠绿', assetColor: '#fb7185', assetDim: 'rgba(251,113,133,0.10)', liabilityColor: '#34d399', liabilityDim: 'rgba(52,211,153,0.10)' },
  { id: 'sky-amber', name: '资产天蓝 / 负债琥珀', assetColor: '#60a5fa', assetDim: 'rgba(96,165,250,0.10)', liabilityColor: '#fbbf24', liabilityDim: 'rgba(251,191,36,0.10)' },
  { id: 'cyan-violet', name: '资产青碧 / 负债紫罗', assetColor: '#22d3ee', assetDim: 'rgba(34,211,238,0.10)', liabilityColor: '#c084fc', liabilityDim: 'rgba(192,132,252,0.10)' },
  { id: 'teal-pink', name: '资产松石 / 负债桃粉', assetColor: '#2dd4bf', assetDim: 'rgba(45,212,191,0.10)', liabilityColor: '#f472b6', liabilityDim: 'rgba(244,114,182,0.10)' },
];

const LIGHT_THEME_COLORS: Record<string, Pick<ColorTheme, 'assetColor' | 'assetDim' | 'liabilityColor' | 'liabilityDim'>> = {
  'emerald-rose': { assetColor: '#047857', assetDim: 'rgba(4,120,87,0.10)', liabilityColor: '#be123c', liabilityDim: 'rgba(190,18,60,0.10)' },
  'rose-emerald': { assetColor: '#be123c', assetDim: 'rgba(190,18,60,0.10)', liabilityColor: '#047857', liabilityDim: 'rgba(4,120,87,0.10)' },
  'sky-amber': { assetColor: '#0369a1', assetDim: 'rgba(3,105,161,0.10)', liabilityColor: '#92400e', liabilityDim: 'rgba(146,64,14,0.10)' },
  'cyan-violet': { assetColor: '#0e7490', assetDim: 'rgba(14,116,144,0.10)', liabilityColor: '#7e22ce', liabilityDim: 'rgba(126,34,206,0.10)' },
  'teal-pink': { assetColor: '#0f766e', assetDim: 'rgba(15,118,110,0.10)', liabilityColor: '#be185d', liabilityDim: 'rgba(190,24,93,0.10)' },
};

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

async function initializeSettingsOnce(): Promise<Settings> {
  let settings = await db.settings.get('main');
  const isNewInstall = !settings;
  if (!settings) {
    const primaryCurrency = getDefaultCurrency();
    const currencies = DEFAULT_CURRENCIES.includes(primaryCurrency)
      ? [...DEFAULT_CURRENCIES]
      : [primaryCurrency, ...DEFAULT_CURRENCIES];
    settings = {
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

export function getTheme(id: string, appearance: 'dark' | 'light' = 'dark'): ColorTheme {
  const theme = COLOR_THEMES.find(t => t.id === id) || COLOR_THEMES[0];
  return appearance === 'light' && LIGHT_THEME_COLORS[theme.id]
    ? { ...theme, ...LIGHT_THEME_COLORS[theme.id] }
    : theme;
}

// ---- Data Import / Export ----
export async function exportData(): Promise<string> {
  const accounts = await db.accounts.toArray();
  const records = await db.records.toArray();
  const exchangeRates = await db.exchangeRates.toArray();
  const settings = await db.settings.toArray();
  const products = await db.products.toArray();
  const planItems = await db.planItems.toArray();
  const planTargets = await db.planTargets.toArray();
  const holdings = await db.holdings.toArray();
  const holdingTxns = await db.holdingTxns.toArray();
  const data = { version: 12, timestamp: Date.now(), accounts, records, exchangeRates, settings, products, planItems, planTargets, holdings, holdingTxns };
  return JSON.stringify(data);
}

export async function importData(jsonData: string): Promise<boolean> {
  try {
    const data = JSON.parse(jsonData);
    if (!data.accounts || !data.records || !data.settings) return false;

    await db.transaction('rw', [db.accounts, db.records, db.exchangeRates, db.settings, db.products, db.planItems, db.planTargets, db.holdings, db.holdingTxns], async () => {
      await db.accounts.clear();
      await db.records.clear();
      await db.settings.clear();
      if (Array.isArray(data.exchangeRates)) await db.exchangeRates.clear();
      await db.products.clear();
      await db.planItems.clear();
      await db.planTargets.clear();
      await db.holdings.clear();
      await db.holdingTxns.clear();

      if (data.accounts.length > 0) await db.accounts.bulkAdd(data.accounts);
      if (data.records.length > 0) await db.records.bulkAdd(data.records);
      if (data.settings.length > 0) await db.settings.bulkAdd(data.settings);
      if (Array.isArray(data.exchangeRates) && data.exchangeRates.length > 0) await db.exchangeRates.bulkAdd(data.exchangeRates);
      if (data.products && data.products.length > 0) await db.products.bulkAdd(data.products);
      if (data.planItems && data.planItems.length > 0) await db.planItems.bulkAdd(data.planItems);
      if (data.planTargets && data.planTargets.length > 0) await db.planTargets.bulkAdd(data.planTargets);
      if (data.holdings && data.holdings.length > 0) await db.holdings.bulkAdd(data.holdings);
      if (data.holdingTxns && data.holdingTxns.length > 0) await db.holdingTxns.bulkAdd(data.holdingTxns);
    });
    return true;
  } catch (e) {
    console.error('Import failed', e);
    return false;
  }
}

export async function exportToExcel(): Promise<string> {
  const XLSX = await import('xlsx');
  const accounts = await db.accounts.toArray();
  const records = await db.records.toArray();
  const exchangeRates = await db.exchangeRates.toArray();
  const settingsRows = await db.settings.toArray();
  const products = await db.products.toArray();
  const planItems = await db.planItems.toArray();
  const planTargets = await db.planTargets.toArray();
  const holdings = await db.holdings.toArray();
  const holdingTxns = await db.holdingTxns.toArray();

  const settingsExport = settingsRows.map(row => {
    const publicRow = { ...row } as Record<string, unknown>;
    delete publicRow[LEGACY_SNAPSHOT_FOCUS_KEY];
    return {
      ...publicRow,
      categories: JSON.stringify(row.categories),
      currencies: JSON.stringify(row.currencies),
      snapshotFocusAccountIds: JSON.stringify(row.snapshotFocusAccountIds ?? []),
    };
  });
  const metadataExport = [{
    format: 'Fortuna Excel Backup',
    version: 3,
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
  
  // PlanItem.categories is an array — flatten to a delimited string for the sheet
  const planExport = planItems.map(p => ({
    ...p,
    categories: p.categories.join('|'),
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
      return {
        [t('xh_date')]: tx.date,
        [t('xh_account')]: acct?.name ?? tx.accountId,
        [t('xh_category')]: acct ? t(acct.category) : '',
        [t('xh_name')]: h?.name ?? tx.holdingId,
        [t('xh_symbol')]: h?.symbol ?? '',
        [t('xh_market')]: h?.market ?? '',
        [t('xh_action')]: isBalanceAdjustment
          ? t('balance_adjustment')
          : balanceFlow
          ? t(getBalanceFlowActionKey(balanceFlow, tx.kind))
          : (tx.kind === 'buy' ? t('xh_buy') : t('xh_sell')),
        [t('xh_shares')]: isBalanceAdjustment ? '' : tx.shares,
        [t('xh_price')]: isBalanceAdjustment ? '' : tx.price,
        [t('xh_amount')]: isBalanceAdjustment
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

export async function importFromExcel(base64Data: string): Promise<boolean> {
  try {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(base64Data, { type: 'base64' });
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
    if (!wsAccounts || !wsRecords) return false;
    const metadata = wsMetadata
      ? XLSX.utils.sheet_to_json<Record<string, unknown>>(wsMetadata)[0]
      : undefined;
    const recognizedBackup = metadata?.format === 'Fortuna Excel Backup';
    const backupVersion = Number(metadata?.version) || 0;
    const needsLegacyMetalMigration = !recognizedBackup || backupVersion < 2;
    
    const parseBoolean = (value: unknown, fallback: boolean): boolean => {
      if (value === undefined || value === null || value === '') return fallback;
      return value === true || value === 1 || String(value).toLowerCase() === 'true';
    };
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
    const records = XLSX.utils.sheet_to_json<AccountRecord>(wsRecords);
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
    
    const planRaw = wsPlan ? XLSX.utils.sheet_to_json<Record<string, unknown>>(wsPlan) : [];
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
      categories: typeof p.categories === 'string' && p.categories ? String(p.categories).split('|') : [],
      allocations: parseAllocations(p.allocations),
      sortOrder: Number(p.sortOrder) || 0,
      createdAt: Number(p.createdAt) || Date.now(),
    }));
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
    const holdingTxns = wsHoldingTxns ? XLSX.utils.sheet_to_json<HoldingTxn>(wsHoldingTxns) : [];

    const parseJson = <T,>(value: unknown, fallback: T): T => {
      if (typeof value !== 'string' || !value) return fallback;
      try { return JSON.parse(value) as T; } catch { return fallback; }
    };
    const settingsRaw = wsSettings ? XLSX.utils.sheet_to_json<Record<string, unknown>>(wsSettings) : [];
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
      };
      const targetTotal = Number(row.planTargetTotal);
      if (Number.isFinite(targetTotal) && targetTotal > 0) restored.planTargetTotal = targetTotal;
      return [restored];
    });
    const exchangeRates = wsExchangeRates
      ? XLSX.utils.sheet_to_json<ExchangeRate>(wsExchangeRates)
      : [];

    const validId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
    const uniqueIds = (rows: { id: string }[]) => new Set(rows.map(row => row.id)).size === rows.length;
    const accountIds = new Set(accounts.map(account => account.id));
    const holdingIds = new Set(holdings.map(holding => holding.id));
    if (!recognizedBackup && accounts.length === 0 && records.length === 0) return false;
    if (!uniqueIds(accounts) || !accounts.every(account => (
      validId(account.id)
      && validId(account.name)
      && validId(account.category)
      && (account.type === 'asset' || account.type === 'liability')
      && validId(account.currency)
      && Number.isFinite(account.createdAt)
      && Number.isFinite(account.sortOrder)
    ))) return false;
    if (!uniqueIds(records) || !records.every(record => (
      validId(record.id)
      && validId(record.accountId)
      && accountIds.has(record.accountId)
      && validId(record.date)
      && Number.isFinite(record.amount)
      && Number.isFinite(record.createdAt)
    ))) return false;
    if (!uniqueIds(holdings) || !holdings.every(holding => (
      validId(holding.id)
      && accountIds.has(holding.accountId)
      && validId(holding.name)
      && Number.isFinite(holding.lastPrice)
      && Number.isFinite(holding.createdAt)
      && Number.isFinite(holding.sortOrder)
    ))) return false;
    if (!uniqueIds(holdingTxns) || !holdingTxns.every(transaction => (
      validId(transaction.id)
      && accountIds.has(transaction.accountId)
      && holdingIds.has(transaction.holdingId)
      && validId(transaction.date)
      && (transaction.kind === 'buy' || transaction.kind === 'sell')
      && Number.isFinite(transaction.shares)
      && Number.isFinite(transaction.price)
      && Number.isFinite(transaction.createdAt)
    ))) return false;
    if (!uniqueIds(products) || !uniqueIds(planItems) || !uniqueIds(planTargets)) return false;
    if (restoredSettings.length > 0 && !restoredSettings.every(row => validId(row.id))) return false;
    if (!exchangeRates.every(rate => (
      validId(rate.id)
      && validId(rate.base)
      && validId(rate.quote)
      && Number.isFinite(rate.rate)
      && rate.rate > 0
      && Number.isFinite(rate.updatedAt)
    ))) return false;

    await db.transaction('rw', [db.accounts, db.records, db.exchangeRates, db.settings, db.products, db.planItems, db.planTargets, db.holdings, db.holdingTxns], async () => {
      await db.accounts.clear();
      await db.records.clear();
      await db.products.clear();
      await db.planItems.clear();
      await db.planTargets.clear();
      await db.holdings.clear();
      await db.holdingTxns.clear();
      if (restoredSettings.length > 0) await db.settings.clear();
      if (wsExchangeRates) await db.exchangeRates.clear();
      if (accounts.length > 0) await db.accounts.bulkAdd(accounts);
      if (records.length > 0) await db.records.bulkAdd(records);
      if (products.length > 0) await db.products.bulkAdd(products);
      if (planItems.length > 0) await db.planItems.bulkAdd(planItems);
      if (planTargets.length > 0) await db.planTargets.bulkAdd(planTargets);
      if (holdings.length > 0) await db.holdings.bulkAdd(holdings);
      if (holdingTxns.length > 0) await db.holdingTxns.bulkAdd(holdingTxns);
      if (restoredSettings.length > 0) await db.settings.bulkAdd(restoredSettings);
      else if (needsLegacyMetalMigration) await db.settings.update('main', { metalTxnMigrated: false });
      if (exchangeRates.length > 0) await db.exchangeRates.bulkAdd(exchangeRates);
    });
    return true;
  } catch (e) {
    console.error('Excel Import failed', e);
    return false;
  }
}
