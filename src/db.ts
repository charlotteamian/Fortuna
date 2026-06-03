import Dexie, { type Table } from 'dexie';
import * as XLSX from 'xlsx';

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
}

export interface AccountRecord {
  id: string;
  accountId: string;
  date: string;
  amount: number;          // grams if unit=gram, else currency amount
  note?: string;
  createdAt: number;
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
}

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
  return settings;
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
  const data = { version: 5, timestamp: Date.now(), accounts, records, settings, products };
  return JSON.stringify(data);
}

export async function importData(jsonData: string): Promise<boolean> {
  try {
    const data = JSON.parse(jsonData);
    if (!data.accounts || !data.records || !data.settings) return false;
    
    await db.transaction('rw', db.accounts, db.records, db.settings, db.products, async () => {
      await db.accounts.clear();
      await db.records.clear();
      await db.settings.clear();
      await db.products.clear();
      
      if (data.accounts.length > 0) await db.accounts.bulkAdd(data.accounts);
      if (data.records.length > 0) await db.records.bulkAdd(data.records);
      if (data.settings.length > 0) await db.settings.bulkAdd(data.settings);
      if (data.products && data.products.length > 0) await db.products.bulkAdd(data.products);
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
  
  const wb = XLSX.utils.book_new();
  const wsAccounts = XLSX.utils.json_to_sheet(accountsExport);
  const wsRecords = XLSX.utils.json_to_sheet(records);
  const wsProducts = XLSX.utils.json_to_sheet(productsExport);
  
  XLSX.utils.book_append_sheet(wb, wsAccounts, "Accounts");
  XLSX.utils.book_append_sheet(wb, wsRecords, "Records");
  XLSX.utils.book_append_sheet(wb, wsProducts, "Products");
  
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}

export async function importFromExcel(base64Data: string): Promise<boolean> {
  try {
    const wb = XLSX.read(base64Data, { type: 'base64' });
    const wsAccounts = wb.Sheets["Accounts"];
    const wsRecords = wb.Sheets["Records"];
    const wsProducts = wb.Sheets["Products"];
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
    
    await db.transaction('rw', db.accounts, db.records, db.products, async () => {
      await db.accounts.clear();
      await db.records.clear();
      await db.products.clear();
      if (accounts.length > 0) await db.accounts.bulkAdd(accounts);
      if (records.length > 0) await db.records.bulkAdd(records);
      if (products.length > 0) await db.products.bulkAdd(products);
    });
    return true;
  } catch (e) {
    console.error('Excel Import failed', e);
    return false;
  }
}
