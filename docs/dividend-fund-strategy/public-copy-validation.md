# Public copy and dividend fund comparison

Checked on 2026-10-08. Browser checks used isolated local origins (`127.0.0.1:5182` and `localhost:5182`) with empty ledgers or synthetic plan data.

## Changes

- Chinese and English interface copy uses generic strategy explanations and editable entry references. Private provenance has been removed from the interface and the local release description.
- Long-term holding, annual 70:30 rebalancing, pullback trading and their existing calculations remain unchanged. No database schema or account data changes are required.
- Ten dividend fund examples compare codes, index, product type, venue, annual management/custody fees and public source links. A separate 161716 bond example explains the bond reserve.
- Selecting an example opens an editable plan. It does not save automatically. Selecting a saved code reopens that plan and retains its allocation and notes.
- The comparison has no live quote, yield or ranking. Costs use publicly disclosed annual fees; the checked date is shown, and each row links to its source. Historical performance and scale figures have not been presented as current data.

## Public product sources

| Code | Management / custody per year | Source |
| --- | --- | --- |
| 512890 | 0.50% / 0.10% | [Fund disclosure on SSE](https://www.sse.com.cn/disclosure/fund/announcement/c/new/2026-03-18/512890_20260318_FNWM.pdf) |
| 563020 | 0.15% / 0.05% | [E Fund](https://www.efunds.com.cn/fund/563020.shtml) |
| 005561 | 0.50% / 0.10% | [Fund summary hosted by Bank of China](https://e.boc.cn/cmsimage/ezcms/public/89968496/20241213/eb1dd17987474d1ba3a8c87c64e31f85.pdf) |
| 159547 | 0.15% / 0.05% | [ChinaAMC](https://fund.chinaamc.com/fund/159547/jijinfeilv.shtml) |
| 560150 | 0.40% / 0.10% | [Taikang](https://www.tkfunds.com.cn/products/ETF/560150/feilv/index.html) |
| 515180 | 0.15% / 0.05% | [E Fund](https://www.efunds.com.cn/fund/515180.shtml) |
| 515080 | 0.20% / 0.10% | [China Merchants Fund](https://static.cmfchina.com/web/fundDetail/515080/index.html) |
| 100032 | 1.20% / 0.20% | [Fullgoal](https://www.fullgoal.com.cn/fundDetail/100032/index.html) |
| 090010 | 0.75% / 0.15% | [Dacheng annual report](https://www.dcfund.com.cn/plat_files/upload/ann_upload/20260330/202603301774868519904.pdf) |
| 159581 | 0.50% / 0.10% | [Wanjia](https://www.wjasset.com/products/etf/159581/index.html) |
| 161716 | 0.40% / 0.10% | [China Merchants Fund](https://www.cmfchina.com/web/fundDetail/161716/) |

These are management and custody fees, not total investor costs. Share classes, transaction costs and later fee changes require checking the relevant product documents.

## Verification

- `npm test`: 179 tests passed. The public-copy regression check includes private workflow and provenance terms in both languages; locale keys and interpolation also match.
- `npm run lint`, `npm run build`, `git diff --check`: passed. The final production build was copied with `npx cap sync android`.
- Chinese and English at 320px: body width 320px, app content width 316px, ten catalogue rows, no private provenance text. The Chinese name cell and caption each occupy the full 264.8125px table width.
- Chinese at 390px: body width 390px, app content width 386px, ten catalogue rows and zero saved plans in the screenshot origin.
- From 563020: name, code and index were prefilled; cancelling left no saved plan. Saving a 40% synthetic allocation and note created one plan. Selecting it again opened Edit; refreshing retained the name, code, 40% allocation and note.
- Screenshots: [generic strategy copy](public-copy/01-neutral-strategy-390.jpg), [fund comparison](public-copy/02-comparison-390.jpg).

Release version: 1.6.1, Android version code 13. See the [release notes](../../release/github/v1.6.1.md) for update details. Browser checks do not establish physical Android installation or on-device behaviour.
