import Dexie, { type Table } from 'dexie';
import * as XLSX from 'xlsx';
import type { HoldingMode } from './lib/productPortfolio';

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

// A bucket of the user's target asset allocation. Each entry of `categories` is a scope:
// a whole category ('银行存款'), a market slice ('股票/ETF@us') or one account ('acct:<id>').
export interface PlanItem {
  id: string;
  name: string;
  targetPercent: number;   // 0–100
  categories: string[];    // scopes covered by this bucket
  sortOrder: number;
  createdAt: number;
}

// A concrete security/asset target inside a plan item, with its own planned amount.
export interface PlanTarget {
  id: string;
  planItemId: string;
  label: string;           // display name (snapshot for linked refs, free text otherwise)
  refKey?: string;         // 'h:<holdingId>' linked holding, 'a:<accountId>' linked account
  targetAmount: number;    // planned amount in `currency`
  currency?: string;       // currency of the planned amount; linked targets use the asset's own currency
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
  mode?: HoldingMode;      // unit = quantity × price, balance = current balance tracked by amount deltas
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
  themeMode?: 'light' | 'dark' | 'auto';
  fontSize?: 'small' | 'normal' | 'large';
  language?: 'auto' | 'zh' | 'en';
  goldPriceSource?: GoldPriceSource;  // which gold price convention to value precious metals with
  metalTxnMigrated?: boolean;         // legacy metal snapshot records converted to buy/sell deltas
  planTargetTotal?: number;           // optional target total assets for the allocation plan (primary currency)
}

// 'international' = global spot (XAU/USD per troy ounce, the mainstream overseas method)
// 'domestic'      = Shanghai gold convention (CNY per gram); for CNY users this matches local buying prices
export type GoldPriceSource = 'international' | 'domestic';

// ---- Color Themes ----
export const COLOR_THEMES: ColorTheme[] = [
  { id: 'emerald-rose', name: '资产翠绿 / 负债玫红', assetColor: '#34d399', assetDim: 'rgba(52,211,153,0.10)', liabilityColor: '#fb7185', liabilityDim: 'rgba(251,113,133,0.10)' },
  { id: 'rose-emerald', name: '资产玫红 / 负债翠绿', assetColor: '#fb7185', assetDim: 'rgba(251,113,133,0.10)', liabilityColor: '#34d399', liabilityDim: 'rgba(52,211,153,0.10)' },
  { id: 'sky-amber', name: '资产天蓝 / 负债琥珀', assetColor: '#60a5fa', assetDim: 'rgba(96,165,250,0.10)', liabilityColor: '#fbbf24', liabilityDim: 'rgba(251,191,36,0.10)' },
  { id: 'cyan-violet', name: '资产青碧 / 负债紫罗', assetColor: '#22d3ee', assetDim: 'rgba(34,211,238,0.10)', liabilityColor: '#c084fc', liabilityDim: 'rgba(192,132,252,0.10)' },
  { id: 'teal-pink', name: '资产松石 / 负债桃粉', assetColor: '#2dd4bf', assetDim: 'rgba(45,212,191,0.10)', liabilityColor: '#f472b6', liabilityDim: 'rgba(244,114,182,0.10)' },
];

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
  }
}

export const db = new AssetManagerDB();

export async function initializeSettings(): Promise<Settings> {
  let settings = await db.settings.get('main');
  if (!settings) {
    settings = {
      id: 'main', primaryCurrency: 'CNY',
      categories: [...DEFAULT_CATEGORIES], currencies: [...DEFAULT_CURRENCIES],
      colorTheme: 'emerald-rose', amountVisible: true,
      themeMode: 'auto', fontSize: 'normal',
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
  if (settings.language === undefined) {
    settings.language = 'auto';
    updated = true;
  }
  if (settings.goldPriceSource === undefined) {
    // CNY users default to the domestic (Shanghai gold, 元/克) convention; others to international spot
    settings.goldPriceSource = settings.primaryCurrency === 'CNY' ? 'domestic' : 'international';
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

export function getTheme(id: string): ColorTheme {
  return COLOR_THEMES.find(t => t.id === id) || COLOR_THEMES[0];
}

// ---- Data Import / Export ----
export async function exportData(): Promise<string> {
  const accounts = await db.accounts.toArray();
  const records = await db.records.toArray();
  const settings = await db.settings.toArray();
  const products = await db.products.toArray();
  const planItems = await db.planItems.toArray();
  const planTargets = await db.planTargets.toArray();
  const holdings = await db.holdings.toArray();
  const holdingTxns = await db.holdingTxns.toArray();
  const data = { version: 8, timestamp: Date.now(), accounts, records, settings, products, planItems, planTargets, holdings, holdingTxns };
  return JSON.stringify(data);
}

export async function importData(jsonData: string): Promise<boolean> {
  try {
    const data = JSON.parse(jsonData);
    if (!data.accounts || !data.records || !data.settings) return false;

    await db.transaction('rw', [db.accounts, db.records, db.settings, db.products, db.planItems, db.planTargets, db.holdings, db.holdingTxns], async () => {
      await db.accounts.clear();
      await db.records.clear();
      await db.settings.clear();
      await db.products.clear();
      await db.planItems.clear();
      await db.planTargets.clear();
      await db.holdings.clear();
      await db.holdingTxns.clear();

      if (data.accounts.length > 0) await db.accounts.bulkAdd(data.accounts);
      if (data.records.length > 0) await db.records.bulkAdd(data.records);
      if (data.settings.length > 0) await db.settings.bulkAdd(data.settings);
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
  const accounts = await db.accounts.toArray();
  const records = await db.records.toArray();
  const products = await db.products.toArray();
  const planItems = await db.planItems.toArray();
  const planTargets = await db.planTargets.toArray();
  const holdings = await db.holdings.toArray();
  const holdingTxns = await db.holdingTxns.toArray();

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
  const planExport = planItems.map(p => ({ ...p, categories: p.categories.join('|') }));

  const wb = XLSX.utils.book_new();
  const wsAccounts = XLSX.utils.json_to_sheet(accountsExport);
  const wsRecords = XLSX.utils.json_to_sheet(records);
  const wsProducts = XLSX.utils.json_to_sheet(productsExport);
  const wsPlan = XLSX.utils.json_to_sheet(planExport);
  const wsPlanTargets = XLSX.utils.json_to_sheet(planTargets);
  const wsHoldings = XLSX.utils.json_to_sheet(holdings);
  const wsHoldingTxns = XLSX.utils.json_to_sheet(holdingTxns);

  XLSX.utils.book_append_sheet(wb, wsAccounts, "Accounts");
  XLSX.utils.book_append_sheet(wb, wsRecords, "Records");
  XLSX.utils.book_append_sheet(wb, wsProducts, "Products");
  XLSX.utils.book_append_sheet(wb, wsPlan, "Plan");
  XLSX.utils.book_append_sheet(wb, wsPlanTargets, "PlanTargets");
  XLSX.utils.book_append_sheet(wb, wsHoldings, "Holdings");
  XLSX.utils.book_append_sheet(wb, wsHoldingTxns, "HoldingTxns");

  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}

export async function importFromExcel(base64Data: string): Promise<boolean> {
  try {
    const wb = XLSX.read(base64Data, { type: 'base64' });
    const wsAccounts = wb.Sheets["Accounts"];
    const wsRecords = wb.Sheets["Records"];
    const wsProducts = wb.Sheets["Products"];
    const wsPlan = wb.Sheets["Plan"];
    const wsPlanTargets = wb.Sheets["PlanTargets"];
    const wsHoldings = wb.Sheets["Holdings"];
    const wsHoldingTxns = wb.Sheets["HoldingTxns"];
    if (!wsAccounts || !wsRecords) return false;
    
    const rawAccounts = XLSX.utils.sheet_to_json<Record<string, unknown>>(wsAccounts);
    const accounts: Account[] = rawAccounts.map((row) => {
      const { productData, ...rest } = row;
      return {
        ...rest,
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
    const planItems: PlanItem[] = planRaw.map(p => ({
      id: String(p.id),
      name: String(p.name ?? ''),
      targetPercent: Number(p.targetPercent) || 0,
      categories: typeof p.categories === 'string' && p.categories ? String(p.categories).split('|') : [],
      sortOrder: Number(p.sortOrder) || 0,
      createdAt: Number(p.createdAt) || Date.now(),
    }));
    const planTargets = wsPlanTargets ? XLSX.utils.sheet_to_json<PlanTarget>(wsPlanTargets) : [];
    const holdings = wsHoldings ? XLSX.utils.sheet_to_json<Holding>(wsHoldings) : [];
    const holdingTxns = wsHoldingTxns ? XLSX.utils.sheet_to_json<HoldingTxn>(wsHoldingTxns) : [];

    await db.transaction('rw', [db.accounts, db.records, db.products, db.planItems, db.planTargets, db.holdings, db.holdingTxns], async () => {
      await db.accounts.clear();
      await db.records.clear();
      await db.products.clear();
      await db.planItems.clear();
      await db.planTargets.clear();
      await db.holdings.clear();
      await db.holdingTxns.clear();
      if (accounts.length > 0) await db.accounts.bulkAdd(accounts);
      if (records.length > 0) await db.records.bulkAdd(records);
      if (products.length > 0) await db.products.bulkAdd(products);
      if (planItems.length > 0) await db.planItems.bulkAdd(planItems);
      if (planTargets.length > 0) await db.planTargets.bulkAdd(planTargets);
      if (holdings.length > 0) await db.holdings.bulkAdd(holdings);
      if (holdingTxns.length > 0) await db.holdingTxns.bulkAdd(holdingTxns);
    });
    return true;
  } catch (e) {
    console.error('Excel Import failed', e);
    return false;
  }
}
