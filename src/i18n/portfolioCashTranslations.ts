export const portfolioCashZh = {
  portfolio_cash_mode: '现金计算方式',
  portfolio_cash_manual: '手动填写现金',
  portfolio_cash_calculated: '按初始金额倒减',
  portfolio_cash_initial: '初始金额',
  portfolio_cash_formula: '现金 = 初始金额 + 已实现盈利 − 已实现亏损 − 持仓市值',
  portfolio_cash_formula_note: '已实现盈亏自动包含已清仓持仓；持仓市值按当前股数和价格计算，更新持仓或交易后自动倒减。',
  portfolio_cash_preview: '计算后现金',
  portfolio_cash_calculated_badge: '自动倒减',
  portfolio_cash_invalid: '请填写有效的非负金额（最多两位小数）。',
  portfolio_cash_save_failed: '现金设置未保存，请重试。',
};

export const portfolioCashEn = {
  portfolio_cash_mode: 'Cash calculation',
  portfolio_cash_manual: 'Enter cash manually',
  portfolio_cash_calculated: 'Subtract holdings from initial amount',
  portfolio_cash_initial: 'Initial amount',
  portfolio_cash_formula: 'Cash = initial amount + realised gains − realised losses − holdings market value',
  portfolio_cash_formula_note: 'Realised P&L includes closed holdings. Market value uses current quantities and prices. Cash recalculates when holdings or trades change.',
  portfolio_cash_preview: 'Calculated cash',
  portfolio_cash_calculated_badge: 'Calculated',
  portfolio_cash_invalid: 'Enter a valid non-negative amount with no more than two decimal places.',
  portfolio_cash_save_failed: 'Cash settings could not be saved. Please try again.',
};
