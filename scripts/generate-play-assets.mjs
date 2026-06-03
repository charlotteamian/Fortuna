import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const outDir = path.join(root, 'release', 'play-store', 'assets');
const iconPath = path.join(root, 'assets', 'icon.png');

await fs.mkdir(outDir, { recursive: true });

async function pngFromSvg(fileName, width, height, svg) {
  await sharp(Buffer.from(svg))
    .resize(width, height)
    .flatten({ background: bg })
    .png()
    .toFile(path.join(outDir, fileName));
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[m]));
}

const bg = '#06080f';
const panel = '#101624';
const border = '#243047';
const text = '#f6f8ff';
const muted = '#8b95a8';
const green = '#34d399';
const rose = '#fb7185';
const blue = '#818cf8';
const amber = '#fbbf24';

const iconData = await fs.readFile(iconPath);
await sharp(iconData).resize(512, 512, { fit: 'cover' }).png().toFile(path.join(outDir, 'icon-512.png'));

const featureSvg = `
<svg width="1024" height="500" viewBox="0 0 1024 500" xmlns="http://www.w3.org/2000/svg">
  <rect width="1024" height="500" fill="${bg}"/>
  <path d="M0 390 C210 310 300 430 505 345 C712 258 832 328 1024 235 L1024 500 L0 500 Z" fill="#0b1f1d"/>
  <path d="M0 431 C230 364 332 456 522 384 C721 310 846 372 1024 294" fill="none" stroke="${green}" stroke-width="4" opacity="0.65"/>
  <g transform="translate(76 76)">
    <rect x="0" y="0" width="108" height="108" rx="24" fill="#0c1422"/>
    <image href="data:image/png;base64,${iconData.toString('base64')}" x="14" y="14" width="80" height="80"/>
  </g>
  <text x="76" y="242" font-family="Inter, Arial, sans-serif" font-size="68" font-weight="800" fill="${text}">Fortuna</text>
  <text x="80" y="296" font-family="Inter, Arial, sans-serif" font-size="28" fill="${muted}">Personal wealth tracker</text>
  <text x="80" y="338" font-family="Inter, Arial, sans-serif" font-size="24" fill="${green}">Assets · Net worth · Local-first records</text>
  <g transform="translate(654 58)">
    <rect x="0" y="0" width="260" height="390" rx="34" fill="#080d16" stroke="${border}" stroke-width="2"/>
    <rect x="22" y="28" width="216" height="334" rx="22" fill="${panel}"/>
    <text x="42" y="74" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" fill="${text}">Net Worth</text>
    <text x="42" y="124" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="800" fill="${green}">¥ 1.28M</text>
    <polyline points="42,218 78,185 112,198 146,156 182,171 218,122" fill="none" stroke="${green}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="42" y="260" width="176" height="18" rx="9" fill="#172235"/>
    <rect x="42" y="292" width="132" height="18" rx="9" fill="#172235"/>
    <circle cx="54" cy="330" r="8" fill="${green}"/>
    <circle cx="94" cy="330" r="8" fill="${blue}"/>
    <circle cx="134" cy="330" r="8" fill="${amber}"/>
    <circle cx="174" cy="330" r="8" fill="${rose}"/>
  </g>
</svg>`;
await pngFromSvg('feature-graphic-1024x500.png', 1024, 500, featureSvg);

const shots = [
  {
    file: 'phone-01-overview.png',
    title: 'Track every account',
    subtitle: 'Assets, liabilities and net worth in one private dashboard.',
    screenTitle: 'Fortuna',
    metric: '¥ 1,284,600',
    accent: green,
    blocks: ['Bank deposits', 'Stocks / ETF', 'Precious metals', 'Credit cards'],
  },
  {
    file: 'phone-02-charts.png',
    title: 'Understand your trend',
    subtitle: 'Visualize net worth, allocation and currency exposure.',
    screenTitle: 'Net Worth',
    metric: '+ 8.4% YTD',
    accent: blue,
    blocks: ['Total assets', 'Category allocation', 'By institution', 'Currency ratio'],
  },
  {
    file: 'phone-03-account.png',
    title: 'Keep clean records',
    subtitle: 'Add balances, notes, product fields and reminders.',
    screenTitle: 'Account Detail',
    metric: '¥ 246,800',
    accent: amber,
    blocks: ['Latest balance', 'History records', 'Product info', 'Excel backup'],
  },
];

for (const shot of shots) {
  const blockRows = shot.blocks.map((b, i) => `
    <g transform="translate(92 ${1110 + i * 92})">
      <rect x="0" y="0" width="896" height="68" rx="16" fill="${panel}" stroke="${border}"/>
      <circle cx="38" cy="34" r="12" fill="${i % 2 ? blue : shot.accent}"/>
      <text x="70" y="43" font-family="Inter, Arial, sans-serif" font-size="28" fill="${text}">${esc(b)}</text>
      <text x="760" y="43" font-family="Inter, Arial, sans-serif" font-size="24" fill="${muted}">${i % 2 ? 'view' : 'sync'}</text>
    </g>`).join('');

  const svg = `
  <svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">
    <rect width="1080" height="1920" fill="${bg}"/>
    <path d="M0 1510 C238 1390 374 1525 576 1432 C795 1331 887 1385 1080 1268 L1080 1920 L0 1920 Z" fill="#0b1f1d"/>
    <text x="74" y="158" font-family="Inter, Arial, sans-serif" font-size="64" font-weight="800" fill="${text}">${esc(shot.title)}</text>
    <text x="76" y="218" font-family="Inter, Arial, sans-serif" font-size="30" fill="${muted}">${esc(shot.subtitle)}</text>
    <g transform="translate(170 330)">
      <rect x="0" y="0" width="740" height="1180" rx="64" fill="#080d16" stroke="${border}" stroke-width="3"/>
      <rect x="52" y="70" width="636" height="1040" rx="38" fill="#0b101b"/>
      <text x="92" y="150" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="800" fill="${text}">${esc(shot.screenTitle)}</text>
      <rect x="92" y="204" width="556" height="190" rx="28" fill="${panel}" stroke="${border}"/>
      <text x="126" y="266" font-family="Inter, Arial, sans-serif" font-size="26" fill="${muted}">Primary value</text>
      <text x="126" y="338" font-family="Inter, Arial, sans-serif" font-size="54" font-weight="800" fill="${shot.accent}">${esc(shot.metric)}</text>
      <polyline points="104,602 190,538 270,574 348,486 438,524 546,420 632,458" fill="none" stroke="${shot.accent}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="92" y="666" width="252" height="150" rx="24" fill="${panel}" stroke="${border}"/>
      <rect x="396" y="666" width="252" height="150" rx="24" fill="${panel}" stroke="${border}"/>
      <text x="122" y="730" font-family="Inter, Arial, sans-serif" font-size="24" fill="${muted}">Assets</text>
      <text x="426" y="730" font-family="Inter, Arial, sans-serif" font-size="24" fill="${muted}">Liabilities</text>
      <text x="122" y="782" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="700" fill="${green}">74%</text>
      <text x="426" y="782" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="700" fill="${rose}">26%</text>
      ${blockRows.replaceAll('translate(92 ', 'translate(92 ')}
    </g>
  </svg>`;
  await pngFromSvg(shot.file, 1080, 1920, svg);
}

console.log(`Generated Play Store assets in ${outDir}`);
