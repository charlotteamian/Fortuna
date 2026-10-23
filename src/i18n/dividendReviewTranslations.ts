export const dividendReviewZh = {
  div_v3_review_risks: '已识别风险（{{count}}）', div_v3_review_missing: '待补充（{{count}}）',
  div_v3_review_clear: '该组检查未发现异常', div_v3_review_passed: '已通过的指标（{{count}}）',
  div_v3_review_price_triggered: '已触发第 {{levels}} 档', div_v3_review_price_waiting: '未触发买入档位', div_v3_review_price_unknown: '价格触发待核实',
  div_v3_review_saved_grid: '按已保存的买入网格比较；安全边际只作参考，不作为恢复开关。',
  div_v3_review_saved_first: '首档买价 {{price}}；现价 {{current}}（{{date}}）。',
  div_v3_review_margin_reference: '安全边际参考 {{margin}}；不重复叠加到每档门槛。',
  div_v3_review_advisory: '以上风险与资料缺口供你判断，不会自动暂停；是否行动仍按价格档位、预算和持仓决定。',
  div_v3_review_acknowledge: '我已阅读本次提示，自主决定恢复已保存的网格', div_v3_review_active: '当前网格已启用，无需恢复。',
};
export const dividendReviewEn: Record<keyof typeof dividendReviewZh, string> = {
  div_v3_review_risks: 'Identified risks ({{count}})', div_v3_review_missing: 'Missing evidence ({{count}})',
  div_v3_review_clear: 'No exceptions identified in these checks', div_v3_review_passed: 'Checks passed ({{count}})',
  div_v3_review_price_triggered: 'Buy levels {{levels}} reached', div_v3_review_price_waiting: 'No buy level reached', div_v3_review_price_unknown: 'Price trigger unverified',
  div_v3_review_saved_grid: 'Compare against your saved buy grid. The safety margin is a reference, not a switch for resuming.',
  div_v3_review_saved_first: 'First buy price {{price}}; current {{current}} ({{date}}).',
  div_v3_review_margin_reference: 'Safety-margin reference {{margin}}; no extra margin is imposed on each level.',
  div_v3_review_advisory: 'These risks and evidence gaps inform your decision and do not pause buying automatically. Actions depend on price levels, budget and holdings.',
  div_v3_review_acknowledge: 'I have read this review and choose to resume the saved grid', div_v3_review_active: 'The grid is already enabled; resuming is unnecessary.',
};
