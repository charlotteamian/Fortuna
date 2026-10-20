# Dividend reading and compact workbench — 1.9.1

## Changes

The workbench now exposes a compact assistant entry, budget overview and stock/fund cards. Budget editing, imports, grids, sources, methodology and fund comparison are disclosures. AI model configuration lives in Settings, outside Q&A.

Advice uses a separate full-screen hash-history page. The workbench stays mounted, scroll position survives return, and back button/browser back share the same return path. An intentional horizontal swipe from the left 48 pixels invokes that path; vertical reading scroll and interactive controls are excluded. Android system back is dispatched to the same history path only while the reading route is active; other pages retain normal system back behaviour. Background content is inert while reading. Markdown renders headings, emphasis, lists and tables; raw HTML, external images and dangerous URLs are excluded.

The API receives human-readable concepts with prices in yuan and weights in percent. The prompt prioritises the active strategy and everyday language. An older historical high is a baseline, not automatically expired; dated price/index-yield observations must be verified only when needed to determine the configured both/either rule. Refresh never silently changes manually entered dates.

## Validation

- 251 Node tests, including Markdown rendering and unsafe content, swipe recognition, stock/fund context units and independent condition freshness.
- Lint, TypeScript, production build, Android Capacitor sync, iOS version and asset readiness.
- Browser QA with explicitly fictitious records on an isolated localhost origin and a local simulated model response; no real provider credentials or private financial records used.
- 390×844 and 320×740 viewports; normal and large font. Stock and fund disclosures default closed. No horizontal document overflow observed.
- Reading title/emphasis/lists/table rendered; external image and raw script produced no elements. Browser back restored the original workbench scroll offset (179 px).
- Settings contains separate screenshot recognition and dividend AI configuration. The focused dividend setting view saves and reloads the assistant configuration without recreating the workbench.
- Release verification is recorded separately in release-verification.json after publication.

## Limits

The actual configured provider's writing style is governed by the revised prompt and source context, but only simulated provider responses were exercised here. Gesture detection is unit tested; the full touch gesture and signed package cover-install/data retention have not been exercised on a physical Android device.
