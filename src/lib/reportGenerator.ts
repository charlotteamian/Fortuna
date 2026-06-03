import type { AccountWithLatest } from '../services/assetService';
import type { Settings } from '../db';
import { getFieldsForCategory } from './categoryFields';

export interface ReportOpts {
  accounts: AccountWithLatest[];
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  settings: Settings;
  t: (key: string) => string;
  isEn: boolean;
  assetColor: string;
  liabilityColor: string;
}

function fmtNum(n: number, isEn: boolean, t: (k: string) => string): string {
  if (isEn) {
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + t('unit_yi');
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + t('unit_wan');
    return n.toFixed(0);
  }
  if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + t('unit_yi');
  if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(2) + t('unit_wan');
  return n.toFixed(0);
}

function fmtAmount(amt: number, currency: string): string {
  return currency + ' ' + amt.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function wrapTextToLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (!text) return [];
  const parts = text.split(' · ');
  const lines: string[] = [];
  let current = '';
  for (const part of parts) {
    const candidate = current ? current + ' · ' + part : part;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = part;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function generateReportCanvas(opts: ReportOpts): HTMLCanvasElement {
  const { accounts, totalAssets, totalLiabilities, netWorth, settings, t, isEn, assetColor, liabilityColor } = opts;

  const W = 900;
  const PAD = 44;
  const primary = settings.primaryCurrency;

  // Group by category
  const catMap: Record<string, { accounts: AccountWithLatest[]; assets: number; liabilities: number; type: 'asset' | 'liability' }> = {};
  for (const a of accounts) {
    const key = a.category;
    if (!catMap[key]) catMap[key] = { accounts: [], assets: 0, liabilities: 0, type: a.type };
    catMap[key].accounts.push(a);
    if (a.type === 'asset') catMap[key].assets += a.convertedAmount;
    else catMap[key].liabilities += a.convertedAmount;
  }
  const insts = Object.entries(catMap)
    .filter(([, v]) => v.accounts.length > 0)
    .sort(([, a], [, b]) => {
      if (a.type !== b.type) return a.type === 'asset' ? -1 : 1;
      const totalA = a.type === 'asset' ? a.assets : a.liabilities;
      const totalB = b.type === 'asset' ? b.assets : b.liabilities;
      return totalB - totalA;
    });

  // Sort accounts within category by amount desc
  for (const [, v] of insts) {
    v.accounts.sort((a, b) => b.convertedAmount - a.convertedAmount);
  }

  // Pre-measure heights with an offscreen canvas
  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d')!;
  const FONT = '-apple-system, "PingFang SC", "Noto Sans CJK SC", "Segoe UI", sans-serif';

  const HEADER_H = 90;       // title + date
  const RULE_GAP = 18;
  const SUMMARY_H = 42;
  const INST_HEADER_H = 38;
  const ACCT_NAME_H = 26;
  const ACCT_META_LINE_H = 20;
  const ACCT_GAP = 10;
  const INST_GAP = 22;
  const FOOTER_H = 56;
  const detailMaxW = W - PAD * 2 - 20;

  // Precompute meta lines per account
  const acctMetaLines: Map<string, string[]> = new Map();
  mctx.font = `14px ${FONT}`;
  for (const [, v] of insts) {
    for (const a of v.accounts) {
      const fields = getFieldsForCategory(a.category, settings, t);
      const entries: string[] = [];
      for (const f of fields) {
        const raw = a.productData?.[f.key];
        if (raw && raw.trim()) entries.push(`${f.label}: ${raw.trim()}`);
      }
      const joined = entries.join(' · ');
      acctMetaLines.set(a.id, joined ? wrapTextToLines(mctx, joined, detailMaxW) : []);
    }
  }

  // Compute height
  let H = PAD + HEADER_H + RULE_GAP + SUMMARY_H + RULE_GAP + 6;
  for (const [, v] of insts) {
    H += INST_HEADER_H;
    for (const a of v.accounts) {
      const metaLines = acctMetaLines.get(a.id) || [];
      H += ACCT_NAME_H + metaLines.length * ACCT_META_LINE_H + ACCT_GAP;
    }
    H += INST_GAP;
  }
  H += FOOTER_H + PAD;
  H = Math.max(H, 640);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const HEADING = '#0f172a';
  const MUTED = '#94a3b8';
  const RULE = '#e2e8f0';
  const BG = '#ffffff';

  // Background
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  let y = PAD;

  // === Header ===
  const dateStr = new Date().toLocaleDateString(isEn ? 'en-US' : 'zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

  ctx.fillStyle = HEADING;
  ctx.font = `bold 32px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(isEn ? 'Fortuna Wealth Report' : 'Fortuna 资产报告', PAD, y + 34);

  ctx.fillStyle = MUTED;
  ctx.font = `16px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(dateStr, W - PAD, y + 34);
  ctx.textAlign = 'left';

  y += 54;

  // Rule
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();

  y += 22;

  // === Summary ===
  const summaryItems = [
    { label: t('total_assets'), value: totalAssets, color: assetColor },
    { label: t('total_liabilities_val'), value: totalLiabilities, color: liabilityColor },
    { label: t('net_worth_val'), value: netWorth, color: netWorth >= 0 ? assetColor : liabilityColor },
  ];

  ctx.font = `15px ${FONT}`;
  // measure widths to lay out evenly
  let cursorX = PAD;
  const gap = 32;
  for (const item of summaryItems) {
    ctx.fillStyle = MUTED;
    ctx.font = `15px ${FONT}`;
    const labelText = item.label + ': ';
    ctx.fillText(labelText, cursorX, y + 18);
    const labelW = ctx.measureText(labelText).width;

    ctx.fillStyle = item.color;
    ctx.font = `bold 17px ${FONT}`;
    const valText = `${primary} ${fmtNum(item.value, isEn, t)}`;
    ctx.fillText(valText, cursorX + labelW, y + 18);
    const valW = ctx.measureText(valText).width;

    cursorX += labelW + valW + gap;
  }

  y += 36;

  // Rule under summary
  ctx.strokeStyle = RULE;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();

  y += 18;

  // === Categories ===
  for (let ii = 0; ii < insts.length; ii++) {
    const [catName, v] = insts[ii];

    // Category header
    ctx.fillStyle = HEADING;
    ctx.font = `bold 22px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(t(catName), PAD, y + 22);

    const catTotal = v.type === 'asset' ? v.assets : v.liabilities;
    const catColor = v.type === 'asset' ? assetColor : liabilityColor;
    const countText = `(${v.accounts.length})`;
    const totalText = `${primary} ${fmtNum(catTotal, isEn, t)}`;

    ctx.font = `14px ${FONT}`;
    ctx.fillStyle = MUTED;
    ctx.textAlign = 'right';
    const totalW = (() => {
      ctx.font = `bold 18px ${FONT}`;
      return ctx.measureText(totalText).width;
    })();
    ctx.font = `14px ${FONT}`;
    ctx.fillStyle = MUTED;
    ctx.fillText(countText, W - PAD - totalW - 8, y + 22);

    ctx.font = `bold 18px ${FONT}`;
    ctx.fillStyle = catColor;
    ctx.fillText(totalText, W - PAD, y + 22);

    ctx.textAlign = 'left';
    y += INST_HEADER_H;

    // Accounts
    for (const a of v.accounts) {
      const color = a.type === 'asset' ? assetColor : liabilityColor;

      // Dot
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(PAD + 6, y + 11, 4, 0, Math.PI * 2);
      ctx.fill();

      // Name
      ctx.fillStyle = HEADING;
      ctx.font = `600 16px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(a.name, PAD + 20, y + 16);

      // Institution label (inline, muted)
      const inst = a.institution?.trim();
      if (inst) {
        const nameW = ctx.measureText(a.name).width;
        ctx.font = `italic 13px ${FONT}`;
        ctx.fillStyle = MUTED;
        ctx.fillText(' · ' + inst, PAD + 20 + nameW, y + 16);
      }

      // Amount on right
      const signedAmt = a.type === 'liability' ? -a.latestAmount : a.latestAmount;
      const amtText = fmtAmount(signedAmt, a.currency);
      ctx.fillStyle = color;
      ctx.font = `600 16px ${FONT}`;
      ctx.textAlign = 'right';

      if (a.currency !== primary && a.latestAmount > 0) {
        const signedConv = a.type === 'liability' ? -a.convertedAmount : a.convertedAmount;
        const convText = ` ≈ ${primary} ${fmtNum(signedConv, isEn, t)}`;
        ctx.font = `14px ${FONT}`;
        ctx.fillStyle = MUTED;
        const convW = ctx.measureText(convText).width;
        ctx.fillText(convText, W - PAD, y + 16);

        ctx.font = `600 16px ${FONT}`;
        ctx.fillStyle = color;
        ctx.textAlign = 'right';
        ctx.fillText(amtText, W - PAD - convW, y + 16);
      } else {
        ctx.fillText(amtText, W - PAD, y + 16);
      }
      ctx.textAlign = 'left';

      y += ACCT_NAME_H;

      // Meta lines
      const metaLines = acctMetaLines.get(a.id) || [];
      ctx.fillStyle = MUTED;
      ctx.font = `14px ${FONT}`;
      for (const line of metaLines) {
        ctx.fillText(line, PAD + 20, y + 14);
        y += ACCT_META_LINE_H;
      }

      y += ACCT_GAP;
    }

    // Subtle horizontal rule between institutions (not after last)
    if (ii < insts.length - 1) {
      ctx.strokeStyle = RULE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD, y + 4);
      ctx.lineTo(W - PAD, y + 4);
      ctx.stroke();
    }

    y += INST_GAP;
  }

  // === Footer ===
  const footerY = H - PAD - 20;
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, footerY);
  ctx.lineTo(W - PAD, footerY);
  ctx.stroke();

  ctx.fillStyle = MUTED;
  ctx.font = `13px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText(`Powered by Fortuna · ${dateStr}`, PAD, footerY + 22);

  return canvas;
}
