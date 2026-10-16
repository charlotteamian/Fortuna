export interface ColorTheme {
  id: string;
  name: string;
  assetColor: string;
  assetDim: string;
  liabilityColor: string;
  liabilityDim: string;
}

export const COLOR_THEMES: ColorTheme[] = [
  { id: 'emerald-rose', name: '资产翠绿 / 负债玫红', assetColor: '#34d399', assetDim: 'rgba(52,211,153,0.10)', liabilityColor: '#fb7185', liabilityDim: 'rgba(251,113,133,0.10)' },
  { id: 'rose-emerald', name: '资产玫红 / 负债翠绿', assetColor: '#fb7185', assetDim: 'rgba(251,113,133,0.10)', liabilityColor: '#34d399', liabilityDim: 'rgba(52,211,153,0.10)' },
  { id: 'sky-amber', name: '资产天蓝 / 负债琥珀', assetColor: '#60a5fa', assetDim: 'rgba(96,165,250,0.10)', liabilityColor: '#fbbf24', liabilityDim: 'rgba(251,191,36,0.10)' },
  { id: 'cyan-violet', name: '资产青碧 / 负债紫罗', assetColor: '#22d3ee', assetDim: 'rgba(34,211,238,0.10)', liabilityColor: '#c084fc', liabilityDim: 'rgba(192,132,252,0.10)' },
  { id: 'teal-pink', name: '资产松石 / 负债桃粉', assetColor: '#2dd4bf', assetDim: 'rgba(45,212,191,0.10)', liabilityColor: '#f472b6', liabilityDim: 'rgba(244,114,182,0.10)' },
  { id: 'violet-gold', name: '资产紫晶 / 负债香槟', assetColor: '#c4b5fd', assetDim: 'rgba(196,181,253,0.10)', liabilityColor: '#fcd34d', liabilityDim: 'rgba(252,211,77,0.10)' },
  { id: 'coral-cyan', name: '资产珊瑚 / 负债海蓝', assetColor: '#ff9b73', assetDim: 'rgba(255,155,115,0.10)', liabilityColor: '#67e8f9', liabilityDim: 'rgba(103,232,249,0.10)' },
  { id: 'indigo-peach', name: '资产靛蓝 / 负债杏橙', assetColor: '#a5b4fc', assetDim: 'rgba(165,180,252,0.10)', liabilityColor: '#fdba74', liabilityDim: 'rgba(253,186,116,0.10)' },
  { id: 'mint-lilac', name: '资产青竹 / 负债丁香', assetColor: '#a7f3d0', assetDim: 'rgba(167,243,208,0.10)', liabilityColor: '#e9a8f2', liabilityDim: 'rgba(233,168,242,0.10)' },
  { id: 'gold-slate', name: '资产蜜金 / 负债烟灰', assetColor: '#facc15', assetDim: 'rgba(250,204,21,0.10)', liabilityColor: '#cbd5e1', liabilityDim: 'rgba(203,213,225,0.10)' },
  { id: 'rose-ice', name: '资产蔷薇 / 负债冰蓝', assetColor: '#f9a8d4', assetDim: 'rgba(249,168,212,0.10)', liabilityColor: '#bae6fd', liabilityDim: 'rgba(186,230,253,0.10)' },
  { id: 'electric-lime', name: '资产电光青柠 / 负债霓虹桃', assetColor: '#c8ff3d', assetDim: 'rgba(200,255,61,0.10)', liabilityColor: '#ff81cd', liabilityDim: 'rgba(255,129,205,0.10)' },
  { id: 'ultraviolet-tangerine', name: '资产极光紫 / 负债日落橙', assetColor: '#c8a0ff', assetDim: 'rgba(200,160,255,0.10)', liabilityColor: '#ffad5c', liabilityDim: 'rgba(255,173,92,0.10)' },
  { id: 'cobalt-lime', name: '资产电光蓝 / 负债柠檬黄', assetColor: '#7db5ff', assetDim: 'rgba(125,181,255,0.10)', liabilityColor: '#ddf44c', liabilityDim: 'rgba(221,244,76,0.10)' },
  { id: 'cherry-aqua', name: '资产樱桃红 / 负债薄荷海', assetColor: '#ff7297', assetDim: 'rgba(255,114,151,0.10)', liabilityColor: '#41eddd', liabilityDim: 'rgba(65,237,221,0.10)' },
  { id: 'solar-orchid', name: '资产太阳金 / 负债兰花紫', assetColor: '#ffdc48', assetDim: 'rgba(255,220,72,0.10)', liabilityColor: '#ed8eff', liabilityDim: 'rgba(237,142,255,0.10)' },
  { id: 'azure-coral', name: '资产晴空青 / 负债珊瑚红', assetColor: '#58dcff', assetDim: 'rgba(88,220,255,0.10)', liabilityColor: '#ff9582', liabilityDim: 'rgba(255,149,130,0.10)' },
  { id: 'flamingo-lime', name: '资产火烈鸟 / 负债热带绿', assetColor: '#ff8bc5', assetDim: 'rgba(255,139,197,0.10)', liabilityColor: '#b8f568', liabilityDim: 'rgba(184,245,104,0.10)' },
  { id: 'jade-electric', name: '资产翡翠光 / 负债电兰紫', assetColor: '#64f4a8', assetDim: 'rgba(100,244,168,0.10)', liabilityColor: '#e6b0ff', liabilityDim: 'rgba(230,176,255,0.10)' },
];

const LIGHT_THEME_COLORS: Record<string, Pick<ColorTheme, 'assetColor' | 'assetDim' | 'liabilityColor' | 'liabilityDim'>> = {
  'emerald-rose': { assetColor: '#046a4c', assetDim: 'rgba(4,106,76,0.10)', liabilityColor: '#be123c', liabilityDim: 'rgba(190,18,60,0.10)' },
  'rose-emerald': { assetColor: '#be123c', assetDim: 'rgba(190,18,60,0.10)', liabilityColor: '#046a4c', liabilityDim: 'rgba(4,106,76,0.10)' },
  'sky-amber': { assetColor: '#0369a1', assetDim: 'rgba(3,105,161,0.10)', liabilityColor: '#92400e', liabilityDim: 'rgba(146,64,14,0.10)' },
  'cyan-violet': { assetColor: '#0d657c', assetDim: 'rgba(13,101,124,0.10)', liabilityColor: '#7e22ce', liabilityDim: 'rgba(126,34,206,0.10)' },
  'teal-pink': { assetColor: '#0c6861', assetDim: 'rgba(12,104,97,0.10)', liabilityColor: '#be185d', liabilityDim: 'rgba(190,24,93,0.10)' },
  'violet-gold': { assetColor: '#6d28d9', assetDim: 'rgba(109,40,217,0.10)', liabilityColor: '#92400e', liabilityDim: 'rgba(146,64,14,0.10)' },
  'coral-cyan': { assetColor: '#9a3412', assetDim: 'rgba(154,52,18,0.10)', liabilityColor: '#155e75', liabilityDim: 'rgba(21,94,117,0.10)' },
  'indigo-peach': { assetColor: '#4338ca', assetDim: 'rgba(67,56,202,0.10)', liabilityColor: '#9a3412', liabilityDim: 'rgba(154,52,18,0.10)' },
  'mint-lilac': { assetColor: '#065f46', assetDim: 'rgba(6,95,70,0.10)', liabilityColor: '#a21caf', liabilityDim: 'rgba(162,28,175,0.10)' },
  'gold-slate': { assetColor: '#854d0e', assetDim: 'rgba(133,77,14,0.10)', liabilityColor: '#475569', liabilityDim: 'rgba(71,85,105,0.10)' },
  'rose-ice': { assetColor: '#be185d', assetDim: 'rgba(190,24,93,0.10)', liabilityColor: '#075985', liabilityDim: 'rgba(7,89,133,0.10)' },
  'electric-lime': { assetColor: '#526500', assetDim: 'rgba(82,101,0,0.10)', liabilityColor: '#ad006b', liabilityDim: 'rgba(173,0,107,0.10)' },
  'ultraviolet-tangerine': { assetColor: '#6825b8', assetDim: 'rgba(104,37,184,0.10)', liabilityColor: '#9a3c00', liabilityDim: 'rgba(154,60,0,0.10)' },
  'cobalt-lime': { assetColor: '#1059ba', assetDim: 'rgba(16,89,186,0.10)', liabilityColor: '#626500', liabilityDim: 'rgba(98,101,0,0.10)' },
  'cherry-aqua': { assetColor: '#af1543', assetDim: 'rgba(175,21,67,0.10)', liabilityColor: '#006962', liabilityDim: 'rgba(0,105,98,0.10)' },
  'solar-orchid': { assetColor: '#6a5700', assetDim: 'rgba(106,87,0,0.10)', liabilityColor: '#92219f', liabilityDim: 'rgba(146,33,159,0.10)' },
  'azure-coral': { assetColor: '#00637a', assetDim: 'rgba(0,99,122,0.10)', liabilityColor: '#ad3326', liabilityDim: 'rgba(173,51,38,0.10)' },
  'flamingo-lime': { assetColor: '#a31570', assetDim: 'rgba(163,21,112,0.10)', liabilityColor: '#416b11', liabilityDim: 'rgba(65,107,17,0.10)' },
  'jade-electric': { assetColor: '#006b41', assetDim: 'rgba(0,107,65,0.10)', liabilityColor: '#7d2697', liabilityDim: 'rgba(125,38,151,0.10)' },
};

export function getTheme(id: string, appearance: 'dark' | 'light' = 'dark'): ColorTheme {
  const theme = COLOR_THEMES.find(t => t.id === id) || COLOR_THEMES[0];
  return appearance === 'light' && LIGHT_THEME_COLORS[theme.id]
    ? { ...theme, ...LIGHT_THEME_COLORS[theme.id] }
    : theme;
}
