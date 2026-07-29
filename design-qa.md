**Design QA**

- Source visual truth: `/Users/restartday/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/zhangjiawei665856_f915/temp/RWTemp/2026-07/b2d55ebabe6b58298b99580f1338f2cb/74228f60e1bb4f7439853019269c60c4.jpg`
- Implementation screenshot: `/tmp/fortuna-balance-layout-clean.png`
- Combined comparison: `/tmp/fortuna-balance-comparison.png`
- Viewport: Android emulator, 1080 × 2400 physical pixels (approximately 360 CSS pixels wide)
- State: active mortgage liability with one direct balance adjustment of CNY 792,264.35

**Full-view comparison evidence**

- The source card forces the record type, date, equals sign, and large amount into one horizontal row, causing the amount to be clipped.
- The revised card keeps type/date/actions in the metadata row and gives the amount a full-width row below it.
- The revised 792,264.35 amount, currency, edit button, and delete button all remain inside the card at the tested narrow viewport.
- The source screenshot shows an archived account without record actions; the implementation uses an active account to verify the harder state where edit/delete actions also need to fit.

**Focused region comparison evidence**

- The combined comparison specifically shows the balance-history card region at the same large numeric value.
- Amount typography remains monospaced and visually primary.
- Currency is reduced to a supporting label and no longer competes with the numeric amount.
- A direct balance adjustment no longer repeats the same resulting balance in a second footer row.
- Notes use their own wrapping row; principal-flow records reserve a separate result row for the calculated remaining balance.

**Findings**

- No actionable P0/P1/P2 findings remain.
- P3: The revised card is slightly taller because the amount occupies a dedicated row. This is intentional and improves scanability and narrow-screen reliability.

**Required fidelity surfaces**

- Fonts and typography: existing app fonts and weights are preserved; numeric text uses the current mono font with tabular figures and responsive sizing.
- Spacing and layout rhythm: metadata, amount, note, and calculated result are separated into consistent vertical layers.
- Colors and visual tokens: existing background, border, muted-text, asset/liability, and radius tokens are reused.
- Image quality and asset fidelity: no image assets are involved in this component.
- Copy and content: existing localized action, date, currency, note, and balance labels are preserved.

**Interaction and runtime checks**

- Opened the balance-change modal on the Android emulator.
- Saved a direct balance adjustment and confirmed the updated record rendered in the history list.
- Confirmed edit and delete controls remain visible inside the card.
- No fatal Android or WebView runtime exception was observed after a clean relaunch; the emulator emitted only WebView cache/seed environment warnings.

**Comparison history**

- Initial P1: large balance values were clipped because all primary fields shared one non-wrapping row.
- Fix: split the record into metadata, amount, optional note, and calculated-result rows; added a narrow-screen fallback below 360px.
- Post-fix evidence: `/tmp/fortuna-balance-comparison.png` shows the complete value `792,264.35 CNY` inside the card with actions still visible.

**Implementation checklist**

- [x] Separate metadata from the amount.
- [x] Give large amounts full card width.
- [x] Remove duplicated balance text for direct snapshots.
- [x] Keep notes on a dedicated wrapping line.
- [x] Add a 360px responsive fallback.
- [x] Verify on an Android emulator.

final result: passed
