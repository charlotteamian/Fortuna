export const release370Zh = {
  // ---- Settings: minimum commission and default stamp duty ----
  default_min_commission: '最低佣金（每笔成交，账户币种）',
  default_min_commission_hint: '单笔佣金低于此金额时按此金额收取，设为 0 表示不设最低佣金。只影响之后新增的成交；历史手续费已按成交当时的条件保存。',
  default_min_commission_invalid: '请输入有效的最低佣金（0 到 1000000）。',
  default_min_commission_saved: '最低佣金已保存',
  default_stamp_duty_rate: '默认印花税率 (%)',
  default_stamp_duty_rate_hint: '仅在某个持仓开启印花税时作为预填值使用，不会自动对所有持仓生效。卖出按成交额收取，ETF 与基金默认不收。',
  default_stamp_duty_rate_invalid: '请输入有效的印花税率（0 到 10）。',
  default_stamp_duty_rate_saved: '默认印花税率已保存',
  recalc_auto_fees: '重新计算全部自动手续费',
  recalc_auto_fees_confirm_title: '重新计算自动手续费？',
  recalc_auto_fees_confirm_message: '将按当前的费率、最低佣金与印花税重新计算所有自动手续费。手动填写的单笔手续费不受影响，此操作无法撤销。',
  recalc_auto_fees_yes: '重新计算',
  recalc_auto_fees_done: '已重新计算 {{count}} 笔手续费',
  recalc_auto_fees_none: '没有需要重新计算的手续费',
  recalc_auto_fees_error: '重新计算失败，请重试。',
  recalc_auto_fees_busy: '正在重新计算…',

  // ---- Holding form: stamp duty and recalculate option ----
  holding_stamp_duty_rate_label: '印花税率 (%)（卖出）',
  holding_stamp_duty_rate_ph: '免印花税',
  holding_stamp_duty_rate_hint: '留空表示该持仓免印花税；填 0.05 表示卖出按成交额 0.05% 收取。只影响之后新增的成交。',
  holding_stamp_duty_rate_invalid: '请输入有效的印花税率（0 到 10）。',
  holding_stamp_duty_default_btn: '预填 {{rate}}%',
  holding_recalc_fees: '同时重新计算该持仓的自动手续费',
  holding_recalc_fees_hint: '按当前费率、最低佣金与印花税重新计算历史自动手续费；手动填写的单笔手续费不受影响。',

  // ---- Transaction form: fee terms preview ----
  holding_txn_fee_hint: '留空按本标的费率 {{rate}}% 自动计算（最低佣金 {{min}}，卖出另收印花税 {{stamp}}%）；也可填入实际手续费覆盖单笔。',
  holding_txn_fee_terms_note: '最低佣金 {{min}}；卖出印花税 {{stamp}}%',
};

export const release370En = {
  // ---- Settings: minimum commission and default stamp duty ----
  default_min_commission: 'Minimum commission (per fill, account currency)',
  default_min_commission_hint: 'Commission below this amount is raised to it; 0 disables the minimum. New fills only: past fees are stored with each fill.',
  default_min_commission_invalid: 'Enter a valid minimum commission between 0 and 1000000.',
  default_min_commission_saved: 'Minimum commission saved',
  default_stamp_duty_rate: 'Default stamp duty rate (%)',
  default_stamp_duty_rate_hint: 'Only a prefill value when stamp duty is switched on for a holding; it never applies on its own. Charged on sells, never on ETFs or funds by default.',
  default_stamp_duty_rate_invalid: 'Enter a valid stamp duty rate between 0 and 10.',
  default_stamp_duty_rate_saved: 'Default stamp duty rate saved',
  recalc_auto_fees: 'Recalculate all automatic fees',
  recalc_auto_fees_confirm_title: 'Recalculate automatic fees?',
  recalc_auto_fees_confirm_message: 'Every automatic fee will be repriced at the current rate, minimum and stamp duty. Manual per-fill fees are untouched, and this cannot be undone.',
  recalc_auto_fees_yes: 'Recalculate',
  recalc_auto_fees_done: 'Recalculated {{count}} fees',
  recalc_auto_fees_none: 'No automatic fees needed recalculation',
  recalc_auto_fees_error: 'Recalculation failed. Please try again.',
  recalc_auto_fees_busy: 'Recalculating…',

  // ---- Holding form: stamp duty and recalculate option ----
  holding_stamp_duty_rate_label: 'Stamp duty rate (%) (sell)',
  holding_stamp_duty_rate_ph: 'No stamp duty',
  holding_stamp_duty_rate_hint: 'Leave blank for no stamp duty; enter 0.05 to charge 0.05% of the trade value on sells. New fills only.',
  holding_stamp_duty_rate_invalid: 'Enter a valid stamp duty rate between 0 and 10.',
  holding_stamp_duty_default_btn: 'Prefill {{rate}}%',
  holding_recalc_fees: 'Also recalculate this holding\u2019s automatic fees',
  holding_recalc_fees_hint: 'Reprice past automatic fees at the current rate, minimum and stamp duty; manual per-fill fees are untouched.',

  // ---- Transaction form: fee terms preview ----
  holding_txn_fee_hint: 'Leave blank to auto-calculate at {{rate}}% (minimum commission {{min}}, sells also pay {{stamp}}% stamp duty), or enter an exact fee to override this fill.',
  holding_txn_fee_terms_note: 'Minimum commission {{min}}; sell stamp duty {{stamp}}%',
};
