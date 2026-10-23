export const dividendGridZh = {
  div_grid_level: '第 {{level}} 档',
  div_grid_level_column: '档位',
  div_grid_triggered_level: '已触发第 {{level}} 档',
  div_grid_price_triggered: '价格已触发',
  div_grid_not_triggered: '尚未触发',
  div_grid_quote_pending: '报价待更新',
  div_grid_prices_pending: '档位待定价',
};

export const dividendGridEn: Record<keyof typeof dividendGridZh, string> = {
  div_grid_level: 'Level {{level}}',
  div_grid_level_column: 'Level',
  div_grid_triggered_level: 'Triggered through level {{level}}',
  div_grid_price_triggered: 'Price triggered',
  div_grid_not_triggered: 'Not triggered',
  div_grid_quote_pending: 'Refresh quote',
  div_grid_prices_pending: 'Level prices needed',
};
