/** Copy for the explanation protocol and its locally rendered facts, not a
 * replacement dictionary for questions the model may explain. */
export const dividendAdvisorExplanationCopy = {
  zh: {
    fact: '已有依据', report: '报告期', published: '公布日', verified: '原文核验日', source: '已有来源',
    unknown: '待核实', pass: '符合', risk: '存在风险', value: '原值', threshold: '保存门槛',
    missing: '缺少可核对资料', stale: '资料不在所需期间', loss: '报告亏损', sector_specific: '需核对行业专用口径', not_covered: '已有资料尚未覆盖',
    financialMissing: '财务资料尚未提供；没有可核对的ROE原值、报告期及年化口径。',
    roeMissing: 'ROE原值未提供', roeMonthsMissing: '季度累计ROE未提供已报告月数，不能核验年化口径',
    roeAnnualisedMissing: '未提供可核对的年化ROE', roeBasisMissing: 'ROE报告口径未提供',
    roeAnnual: '年报ROE原值', roeInterim: '季度累计ROE原值', roeMonths: '已报告月数', roeAnnualised: '已有年化ROE',
    sourceDateMissing: '没有单独提供财务原文核验日',
    discussion: '研究卡资料（仅用于解释，不决定当前操作）', snapshotTime: '研究快照生成时间', downloadTime: '来源下载时间', sourcePeriod: '来源所属期或日期',
    authority: '价格、资格、触价、买卖操作状态和可确认动作由本地检查单独决定。解释不改变这些结果。',
    roeRule: 'ROE保留财报原值。季度累计ROE只有具备已报告月数时才按12除以该月数年化，并明确标注；不能当作全年盈利预测。',
    exampleRule: '教学例子使用明确假设，仅展示算式，不是任何证券的报价、分红、财务披露或操作建议。',
    hypothetical: '假设例子（非真实证券资料）', cashYield: '假设每股现金分红为{{a}}元，股价为{{b}}元。股息率＝{{a}}÷{{b}}×100%＝{{result}}%。',
    freeCashFlow: '假设经营活动现金流为{{a}}元，资本性支出为{{b}}元。此简化例子的自由现金流＝{{a}}−{{b}}＝{{result}}元。',
  },
  en: {
    fact: 'Existing evidence', report: 'Reporting period', published: 'Published', verified: 'Original document verified', source: 'Existing source',
    unknown: 'Unverified', pass: 'Meets rule', risk: 'Risk', value: 'Reported value', threshold: 'Saved threshold',
    missing: 'Comparable evidence is missing', stale: 'Evidence is outside the required period', loss: 'Reported loss', sector_specific: 'Sector-specific basis requires review', not_covered: 'Existing evidence does not cover this item',
    financialMissing: 'Financial evidence is unavailable; the reported ROE, reporting period and annualisation basis cannot be checked.',
    roeMissing: 'Reported ROE is missing', roeMonthsMissing: 'The reported month count for cumulative interim ROE is missing, so annualisation cannot be checked',
    roeAnnualisedMissing: 'A checkable annualised ROE is missing', roeBasisMissing: 'The ROE reporting basis is missing',
    roeAnnual: 'Reported annual ROE', roeInterim: 'Reported cumulative interim ROE', roeMonths: 'Reported months', roeAnnualised: 'Supplied annualised ROE',
    sourceDateMissing: 'No separate financial-document verification date was supplied',
    discussion: 'Research-card evidence (explanation only, not current operating conditions)', snapshotTime: 'Research snapshot generated', downloadTime: 'Source downloaded', sourcePeriod: 'Source period or date',
    authority: 'Local checks independently determine prices, eligibility, price triggers, buy/sell conditions and confirmable actions. Explanations do not change those results.',
    roeRule: 'Preserve reported ROE. Annualise a cumulative interim value only with a known reported month count, using 12 divided by those months and an explicit label. It is not a full-year profit forecast.',
    exampleRule: 'Teaching examples use explicit hypothetical inputs. They illustrate arithmetic, not any security quote, dividend, reported financial result or trading instruction.',
    hypothetical: 'Hypothetical example (not actual security data)', cashYield: 'Assume cash dividends per share of CNY {{a}} and a share price of CNY {{b}}. Dividend yield = {{a}} ÷ {{b}} × 100% = {{result}}%.',
    freeCashFlow: 'Assume operating cash flow of CNY {{a}} and capital expenditure of CNY {{b}}. Free cash flow in this simplified example = {{a}} − {{b}} = CNY {{result}}.',
  },
};

export const dividendExplanationUi = {
  zh: {
    localNeedsExplanation: '已有的本地说明和检查会保留。这个问题还需要结合已有资料进一步解释。',
    notConfigured: '尚未配置AI；本地说明与检查仍可使用。需要进一步解释时，可在设置中配置。',
    rejected: '本次AI解释含有无法核对的内容，未展示；本地结果仍保留。',
    uncheckedConcept: '这个概念尚未提供已核对的解释，可稍后重新提问；不会用未通过核对的模型内容替代。',
    exampleInputsMissing: '这个算式需要同时给出每股现金分红和股价（元）。缺少的数字保持未知，不用默认例子替换你提供的条件。',
    invalidTeachingInputs: '示例输入无法用于计算：股价必须大于零，分红不能为负，数字须在有效范围内。未生成结果。',
    unavailable: 'AI解释暂时不可用，本地说明与检查仍保留。稍后可继续追问。',
    explanationTitle: '解释与举例', localTitle: '本地检查',
  },
  en: {
    localNeedsExplanation: 'Existing local explanations and checks remain available. This question needs further explanation using the supplied evidence.',
    notConfigured: 'AI is not configured. Local explanations and checks remain available; configure AI in Settings for further explanation.',
    rejected: 'This AI explanation contained content that could not be checked and was not displayed. The local result is retained.',
    uncheckedConcept: 'A checked explanation for this concept was not available in this response. You can retry later; unchecked provider content is not substituted.',
    exampleInputsMissing: 'This calculation needs both cash dividends per share and a share price in CNY. Missing inputs remain unknown; default assumptions do not replace the inputs you supplied.',
    invalidTeachingInputs: 'The teaching inputs are invalid: the share price must be positive, the cash dividend non-negative, and values within the supported range. No result was calculated.',
    unavailable: 'AI explanation is temporarily unavailable. Local explanations and checks are retained; you can ask a follow-up later.',
    explanationTitle: 'Explanation and examples', localTitle: 'Local checks',
  },
};
