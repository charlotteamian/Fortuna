import type { Settings } from '../db';

export interface CategoryFieldDef {
  key: string;
  labelKey: string;
  placeholderKey?: string;
  optionKeys?: string[];
}

export const CATEGORY_FIELDS: Record<string, CategoryFieldDef[]> = {
  '银行存款': [
    { key: 'type', labelKey: 'f_type', placeholderKey: 'f_type_bank_ph', optionKeys: ['opt_demand','opt_term_3m','opt_term_6m','opt_term_1y','opt_term_2y','opt_term_3y','opt_term_5y','opt_cd'] },
    { key: 'rate', labelKey: 'f_rate', placeholderKey: 'f_rate_ph' },
    { key: 'maturity', labelKey: 'f_maturity', placeholderKey: 'f_maturity_ph' },
  ],
  '现金（类）': [
    { key: 'rate_7day', labelKey: 'f_7day_rate', placeholderKey: 'f_7day_rate_ph' },
  ],
  '现金': [],
  '理财产品': [
    { key: 'level', labelKey: 'f_risk_level', optionKeys: ['opt_r1','opt_r2','opt_r3','opt_r4','opt_r5'] },
    { key: 'mode', labelKey: 'f_mode', optionKeys: ['opt_closed','opt_open','opt_regular_open'] },
    { key: 'benchmark', labelKey: 'f_benchmark', placeholderKey: 'f_benchmark_ph' },
    { key: 'maturity', labelKey: 'f_maturity', placeholderKey: 'f_maturity_fin_ph' },
    { key: 'underlying', labelKey: 'f_underlying', placeholderKey: 'f_underlying_ph' },
  ],
  '股票/ETF': [
    { key: 'market', labelKey: 'f_market', optionKeys: ['opt_a_share','opt_us_market','opt_hk_market'] },
    { key: 'code', labelKey: 'f_code', placeholderKey: 'f_code_ph' },
    { key: 'cost', labelKey: 'f_cost', placeholderKey: 'f_cost_ph' },
  ],
  '场外基金': [
    { key: 'market', labelKey: 'f_market', optionKeys: ['opt_a_share','opt_us_market','opt_hk_market'] },
    { key: 'code', labelKey: 'f_code', placeholderKey: 'f_code_otc_ph' },
    { key: 'cost', labelKey: 'f_cost', placeholderKey: 'f_cost_ph' },
    { key: 'duration', labelKey: 'f_duration', placeholderKey: 'f_duration_ph' },
    { key: 'platform', labelKey: 'f_platform', optionKeys: ['opt_alipay','opt_tiantian','opt_cmb','opt_other'] },
  ],
  '债券': [
    { key: 'rate', labelKey: 'f_rate', placeholderKey: 'f_rate_ph' },
    { key: 'maturity', labelKey: 'f_maturity', placeholderKey: 'f_maturity_ph' },
  ],
  '贵金属': [
    { key: 'metal_form', labelKey: 'f_type', optionKeys: ['opt_physical_gold','opt_bank_gold','opt_gold_etf','opt_paper_gold','opt_physical_silver','opt_silver_etf','opt_physical_platinum','opt_other'] },
    { key: 'avg_cost', labelKey: 'f_avg_cost', placeholderKey: 'f_avg_cost_ph' },
  ],
  '债权': [
    { key: 'counterparty', labelKey: 'f_counterparty', placeholderKey: 'f_counterparty_ph' },
    { key: 'rate', labelKey: 'f_agreed_rate', placeholderKey: 'f_agreed_rate_ph' },
    { key: 'due', labelKey: 'f_repay_due', placeholderKey: 'f_repay_due_ph' },
    { key: 'risk', labelKey: 'f_repay_risk', placeholderKey: 'f_repay_risk_ph' },
  ],
  '房产': [
    { key: 'note', labelKey: 'note', placeholderKey: 'note_placeholder' },
  ],
  '数字货币': [
    { key: 'platform', labelKey: 'f_platform', placeholderKey: 'f_platform_ph' },
    { key: 'note', labelKey: 'note', placeholderKey: 'note_placeholder' },
  ],
  '保险': [
    { key: 'ins_type', labelKey: 'f_ins_type', optionKeys: ['opt_annuity','opt_life','opt_critical','opt_medical','opt_accident','opt_term_life','opt_other'] },
    { key: 'insured', labelKey: 'f_insured', placeholderKey: 'f_insured_ph' },
    { key: 'coverage', labelKey: 'f_coverage', placeholderKey: 'f_coverage_ph' },
    { key: 'premium', labelKey: 'f_premium', placeholderKey: 'f_premium_ph' },
    { key: 'note', labelKey: 'f_ins_note', placeholderKey: 'f_ins_note_ph' },
  ],
  '信用卡': [
    { key: 'limit', labelKey: 'f_card_limit', placeholderKey: 'f_card_limit_ph' },
    { key: 'bill_day', labelKey: 'f_bill_day', placeholderKey: 'f_bill_day_ph' },
    { key: 'due_day', labelKey: 'f_due_day', placeholderKey: 'f_due_day_ph' },
  ],
  '房贷': [
    { key: 'rate', labelKey: 'f_rate', placeholderKey: 'f_rate_ph' },
    { key: 'monthly', labelKey: 'f_monthly', placeholderKey: 'f_monthly_ph' },
    { key: 'deadline', labelKey: 'f_deadline', placeholderKey: 'f_deadline_ph' },
  ],
  '车贷': [
    { key: 'rate', labelKey: 'f_rate', placeholderKey: 'f_rate_ph' },
    { key: 'monthly', labelKey: 'f_monthly', placeholderKey: 'f_monthly_ph' },
    { key: 'deadline', labelKey: 'f_deadline', placeholderKey: 'f_deadline_ph' },
  ],
  '消费贷': [
    { key: 'rate', labelKey: 'f_rate', placeholderKey: 'f_rate_ph' },
    { key: 'monthly', labelKey: 'f_monthly', placeholderKey: 'f_monthly_ph' },
    { key: 'deadline', labelKey: 'f_deadline', placeholderKey: 'f_deadline_ph' },
  ],
  '其他资产': [
    { key: 'note', labelKey: 'note', placeholderKey: 'note_placeholder' },
  ],
  '其他负债': [
    { key: 'note', labelKey: 'note', placeholderKey: 'note_placeholder' },
  ],
};

export interface ResolvedField {
  key: string;
  label: string;
  placeholder?: string;
  options?: string[];
}

export function getFieldsForCategory(catName: string, settings: Settings, t: (key: string) => string): ResolvedField[] {
  const cat = settings.categories.find(c => c.name === catName);
  if (cat?.fields && cat.fields.length > 0) {
    return cat.fields.map(f => ({
      key: f.key,
      label: f.label,
      placeholder: f.placeholder,
      options: f.options && f.options.length > 0 ? f.options : undefined,
    }));
  }
  const builtin = CATEGORY_FIELDS[catName] || CATEGORY_FIELDS[catName === '股票' ? '股票/ETF' : ''] || [];
  return builtin.map(f => ({
    key: f.key,
    label: t(f.labelKey),
    placeholder: f.placeholderKey ? t(f.placeholderKey) : undefined,
    options: f.optionKeys?.map(k => t(k)),
  }));
}
