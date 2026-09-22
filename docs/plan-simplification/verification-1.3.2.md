# Plan simplification verification — 1.3.2

Date: 2026-09-22. All UI values below are synthetic local browser fixtures.

## Requirements recovered from the previous request

Show each asset class's planned amount and share, its actual progress, and intended purchases, with a simpler daily workflow.

## Review and corrections

- Existing changes implement intended-purchase notes, amount/percentage input and visible editing.
- Collapsed the comparison chart and used two amount columns so the category name, values and purchases are easier to read on a phone.
- Expressed shortfalls as gaps to the plan, without suggesting that every shortfall requires a purchase. Removed the implicit 0.5% tolerance for claiming a plan is complete.
- Restored the removed legacy product-selection controls, including explicit allocations. Preserved stored reference keys and percentage precision when editing old subcategories.
- Made purchase tags and subcategory rows real keyboard-operable buttons.
- Made initial-plan generation atomic and prevented repeat generation over an existing plan; retained full percentage precision.

## Verification

- Node tests: 70 passed, including plan calculations, update-asset selection, actual-value allocation, legacy plans and backup restoration.
- Added isolated IndexedDB tests for purchase-note Excel round trips, existing product links, duplicate initialization and transaction rollback.
- ESLint and TypeScript/Vite production build passed.
- At 390×844 and 360×800 browser viewports, reviewed the plan and actual columns, progress, purchase list and advanced controls.
- Saved 350000.01 against a 1000000 plan base; current value remained 240000 and the unused allocation displayed 9999.99.
- Edited an existing 20% subcategory's product allocation to 120000; its detail row showed 120000 / 200000 while the parent retained the full 240000 actual value.
- Recorded two intended bank products with no corresponding current holdings; both appeared immediately on the bank-deposit plan.

## Signing

- Local September 19 debug APK: `71b7801a44bd4ee9227e4c0e97e40c5b4b9432db68622a18c0aa58e65c7bb048`.
- Existing formal release and pinned certificate: `b6898c38efabded0a7a2826ff1b83c5191b3d3be7f0723201984ecd0fc8cf62c`.
- 1.3.2 uses version code 7 and the existing GitHub signing secrets. The release workflow checks this fingerprint before publication.

Phone installation and the user's actual installed certificate cannot be tested without a connected authorized device. Public release and artifact verification is recorded separately after the GitHub build completes.
