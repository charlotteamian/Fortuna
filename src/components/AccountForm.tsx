import type React from 'react';
import { useState } from 'react';
import { createAccount, addRecord, addMetalTransaction } from '../services/assetService';
import { type Settings, METAL_TYPES } from '../db';
import { useTranslation } from 'react-i18next';
import { getFieldsForCategory } from '../lib/categoryFields';
import { defaultsToProductPortfolio, getDefaultHoldingModeForCategory, isProductPortfolioCategory } from '../lib/productPortfolio';
import { formatLocalDate } from '../lib/localDate';

interface Props { settings: Settings; onClose: () => void; onCreated: (id: string) => void; }

export default function AccountForm({ settings, onClose, onCreated }: Props) {
  const { t } = useTranslation();
  const assetCats = settings.categories.filter(c => c.type === 'asset');
  const liabCats = settings.categories.filter(c => c.type === 'liability');
  const initialCategory = assetCats[0]?.name || '';
  const [type, setType] = useState<'asset' | 'liability'>('asset');
  const [category, setCategory] = useState(initialCategory);
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [currency, setCurrency] = useState(settings.primaryCurrency);
  const [metalType, setMetalType] = useState('XAU');
  const [productData, setProductData] = useState<Record<string, string>>({});
  const [initShares, setInitShares] = useState('');
  const [initPrice, setInitPrice] = useState('');
  const [metalGrams, setMetalGrams] = useState('');
  const [metalCost, setMetalCost] = useState('');
  const [portfolioMode, setPortfolioMode] = useState(defaultsToProductPortfolio(initialCategory, 'asset'));
  const [includeInTotals, setIncludeInTotals] = useState(true);

  const setField = (key: string, val: string) => setProductData(prev => ({ ...prev, [key]: val }));

  const cats = type === 'asset' ? assetCats : liabCats;
  const isMetal = category === '贵金属';
  const supportsPortfolio = isProductPortfolioCategory(category, type);
  const isPortfolio = supportsPortfolio && portfolioMode;
  const isUnitProduct = getDefaultHoldingModeForCategory(category) === 'unit';
  const extraFields = getFieldsForCategory(category, settings, t);
  const renderedExtraFields = isPortfolio ? [] : isUnitProduct ? extraFields.filter(f => f.key !== 'cost') : extraFields;

  const handleTypeChange = (t: 'asset' | 'liability') => {
    setType(t);
    const newCats = t === 'asset' ? assetCats : liabCats;
    if (!newCats.find(c => c.name === category)) {
      const nextCategory = newCats[0]?.name || '';
      setCategory(nextCategory);
      setPortfolioMode(defaultsToProductPortfolio(nextCategory, t));
    }
    setProductData({});
  };

  const handleCategoryChange = (c: string) => {
    setCategory(c);
    setPortfolioMode(defaultsToProductPortfolio(c, type));
    setProductData({});
    if (c === '贵金属' && !name) {
      const m = METAL_TYPES.find(m => m.code === metalType);
      if (m) setName(t(m.name));
    }
  };

  const handleMetalChange = (code: string) => {
    setMetalType(code);
    const m = METAL_TYPES.find(m => m.code === code);
    if (m && (!name || METAL_TYPES.some(mt => mt.name === name || t(mt.name) === name))) setName(t(m.name));
  };

  const handleSave = async () => {
    if (!name.trim() || !category || !cats.some(candidate => candidate.name === category)) return;
    const icon = isMetal
      ? METAL_TYPES.find(m => m.code === metalType)?.icon
      : settings.categories.find(c => c.name === category)?.icon;
    const finalProductData = { ...productData };
    if (isUnitProduct && !isPortfolio) {
      const price = parseFloat(initPrice);
      if (!isNaN(price) && price > 0) finalProductData.cost = initPrice;
    }
    const id = await createAccount({
      name: name.trim(), category, type, currency, icon,
      institution: institution.trim() || undefined,
      includeInTotals,
      productData: Object.keys(finalProductData).length > 0 ? finalProductData : undefined,
      ...(isMetal ? { metalType, unit: 'gram' as const } : {}),
      ...(isPortfolio ? { portfolio: true } : {}),
    });
    if (isUnitProduct && !isPortfolio) {
      const shares = parseFloat(initShares);
      const price = parseFloat(initPrice);
      if (!isNaN(shares) && !isNaN(price) && shares > 0 && price > 0) {
        const today = formatLocalDate();
        await addRecord(id, today, shares * price);
      }
    }
    if (isMetal) {
      const grams = parseFloat(metalGrams);
      const cost = parseFloat(metalCost);
      if (!isNaN(grams) && grams > 0) {
        const today = formatLocalDate();
        await addMetalTransaction(id, { date: today, kind: 'buy', grams, pricePerGram: !isNaN(cost) && cost > 0 ? cost : 0 });
      }
    }
    onCreated(id);
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="add-account-title" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title" id="add-account-title">{t('add_account')}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t('close')}>✕</button>
        </div>

        {/* Type toggle */}
        <div className="form-group">
          <div style={S.typeRow}>
            <button type="button" style={{ ...S.typeBtn, ...(type === 'asset' ? { background: 'var(--asset-color)', color: 'var(--theme-on-asset)' } : S.typeBtnInactive) }}
              onClick={() => handleTypeChange('asset')}>{t('assets')}</button>
            <button type="button" style={{ ...S.typeBtn, ...(type === 'liability' ? { background: 'var(--liability-color)', color: '#fff' } : S.typeBtnInactive) }}
              onClick={() => handleTypeChange('liability')}>{t('liabilities')}</button>
          </div>
        </div>

        {/* Category chips */}
        <div className="form-group">
          <label className="form-label">{t('category')}</label>
          <div style={S.chipRow}>
            {cats.map(c => (
              <button type="button" key={c.name}
                style={{ ...S.chip, ...(category === c.name ? S.chipActive : {}) }}
                onClick={() => handleCategoryChange(c.name)}>
                {t(c.name)}
              </button>
            ))}
          </div>
          {cats.length === 0 && <div className="form-error" role="alert">{t('category_required')}</div>}
        </div>

        {/* Product management mode: one account per platform (holdings inside) vs one per product */}
        {supportsPortfolio && (
          <div className="form-group">
            <label className="form-label">{t('manage_mode')}</label>
            <div style={S.typeRow}>
              <button style={{ ...S.typeBtn, ...(portfolioMode ? { background: 'var(--asset-color)', color: '#000' } : S.typeBtnInactive) }}
                onClick={() => setPortfolioMode(true)}>{t('mode_portfolio')}</button>
              <button style={{ ...S.typeBtn, ...(!portfolioMode ? { background: 'var(--asset-color)', color: '#000' } : S.typeBtnInactive) }}
                onClick={() => setPortfolioMode(false)}>{t('mode_single')}</button>
            </div>
            {portfolioMode && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8, padding: '8px 12px', background: 'var(--bg-glass)', borderRadius: 8 }}>
                {t('portfolio_hint')}
              </div>
            )}
          </div>
        )}

        {/* Metal type */}
        {isMetal && (
          <div className="form-group">
            <label className="form-label">{t('metal_type')}</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {METAL_TYPES.map(m => (
                <button key={m.code} className={`btn ${metalType === m.code ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => handleMetalChange(m.code)}>{t(m.name)}</button>
              ))}
            </div>
          </div>
        )}

        {/* Institution */}
        <div className="form-group">
          <label className="form-label">{t('institution')}</label>
          <input className="form-input" placeholder={t('institution_ph')}
            value={institution} onChange={e => setInstitution(e.target.value)} />
        </div>

        {/* Account name */}
        <div className="form-group">
          <label className="form-label">{t('name')}</label>
          <input className="form-input"
            placeholder={isMetal ? t('metal_placeholder') : isPortfolio ? t('portfolio_name_ph') : t('account_placeholder')}
            value={name} onChange={e => setName(e.target.value)} />
        </div>

        {/* Currency */}
        <div className="form-group">
          <label className="form-label">{isMetal ? t('precious_metal_label') : t('currency_label')}</label>
          <select className="form-select" value={currency} onChange={e => setCurrency(e.target.value)}>
            {settings.currencies.map(c => <option key={c} value={c}>{c} - {t(c + '_name')}</option>)}
          </select>
        </div>

        {isMetal && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 16, padding: '8px 12px', background: 'var(--bg-glass)', borderRadius: 8 }}>
            {t('metal_hint', { currency })}
            <div style={{ marginTop: 4 }}>{t('metal_channel_hint')}</div>
          </div>
        )}

        {/* Metal quick-add: initial holding (optional) */}
        {isMetal && (
          <>
            <div style={S.divider}><span style={S.dividerText}>{t('metal_initial_position')}</span></div>
            <div className="form-group">
              <label className="form-label">{t('grams_label')}</label>
              <input className="form-input mono" type="number" inputMode="decimal" step="0.01" min="0"
                placeholder={`0.00 ${t('unit_gram')}`} value={metalGrams} onChange={e => setMetalGrams(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">{t('cost_price')} ({currency}/{t('unit_gram')})</label>
              <input className="form-input mono" type="number" inputMode="decimal" step="0.01" min="0"
                placeholder={t('cost_price_optional')} value={metalCost} onChange={e => setMetalCost(e.target.value)} />
            </div>
            {metalGrams && metalCost && !isNaN(parseFloat(metalGrams)) && !isNaN(parseFloat(metalCost)) && parseFloat(metalGrams) > 0 && parseFloat(metalCost) > 0 && (
              <div style={{ background: 'var(--bg-glass)', borderRadius: 10, padding: '10px 14px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>{t('grams_label')} × {t('cost_price')}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--asset-color)' }}>
                  {(parseFloat(metalGrams) * parseFloat(metalCost)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}
                </span>
              </div>
            )}
          </>
        )}

        {/* Category-specific product fields */}
        {renderedExtraFields.length > 0 && (
          <>
            <div style={S.divider}><span style={S.dividerText}>{t('product_info')}</span></div>
            {renderedExtraFields.map(field => (
              <div className="form-group" key={field.key}>
                <label className="form-label">{field.label}</label>
                {field.options ? (
                  <div style={S.optionRow}>
                    {field.options.map(optVal => (
                      <button type="button" key={optVal}
                        style={{ ...S.optBtn, ...(productData[field.key] === optVal ? S.optBtnActive : {}) }}
                        onClick={() => setField(field.key, productData[field.key] === optVal ? '' : optVal)}>
                        {optVal}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input className="form-input"
                    placeholder={field.placeholder || ''}
                    value={productData[field.key] || ''}
                    onChange={e => setField(field.key, e.target.value)} />
                )}
              </div>
            ))}
          </>
        )}

        {/* Unit-product quick-add: initial position (single-product mode only) */}
        {isUnitProduct && !isPortfolio && (
          <>
            <div style={S.divider}><span style={S.dividerText}>{t('initial_position')}</span></div>
            <div className="form-group">
              <label className="form-label">{t('shares')}</label>
              <input className="form-input mono" type="number" inputMode="decimal" step="1" min="0"
                value={initShares} onChange={e => setInitShares(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">{t('price_per_share')} ({currency})</label>
              <input className="form-input mono" type="number" inputMode="decimal" step="0.0001" min="0"
                value={initPrice} onChange={e => setInitPrice(e.target.value)} />
            </div>
            {initShares && initPrice && !isNaN(parseFloat(initShares)) && !isNaN(parseFloat(initPrice)) && parseFloat(initShares) > 0 && parseFloat(initPrice) > 0 && (
              <div style={{ background: 'var(--bg-glass)', borderRadius: 10, padding: '10px 14px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>{t('market_value')} = {t('shares')} × {t('price_per_share')}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--asset-color)' }}>
                  {(parseFloat(initShares) * parseFloat(initPrice)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            )}
          </>
        )}

        <div className="form-group">
          <div className="preference-toggle-card">
            <div className="preference-toggle-copy">
              <div className="preference-toggle-title">{t('include_in_totals')}</div>
              <div className="preference-toggle-hint">{t('include_in_totals_hint')}</div>
            </div>
            <button type="button"
              className={`toggle-switch ${includeInTotals ? 'active' : ''}`}
              role="switch" aria-checked={includeInTotals}
              aria-label={t('include_in_totals')}
              onClick={() => setIncludeInTotals(value => !value)}>
              <span />
            </button>
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary btn-block" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn btn-primary btn-block" disabled={!name.trim() || !category || !cats.some(candidate => candidate.name === category)} onClick={handleSave}>{t('create')}</button>
        </div>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  typeRow: { display: 'flex', gap: 8 },
  typeBtn: { flex: 1, padding: '10px', borderRadius: 12, border: 'none', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' },
  typeBtnInactive: { background: 'var(--bg-glass)', color: 'var(--text-secondary)', border: '1px solid var(--border)' },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  chip: { padding: '6px 12px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--bg-glass)', color: 'var(--text-secondary)', fontSize: '0.78rem', cursor: 'pointer', flexShrink: 0 },
  chipActive: { background: 'var(--asset-dim)', border: '1px solid var(--asset-color)', color: 'var(--asset-color)', fontWeight: 600 },
  divider: { display: 'flex', alignItems: 'center', margin: '4px 0 12px', gap: 8 },
  dividerText: { fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' },
  optionRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  optBtn: { padding: '5px 11px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--bg-glass)', color: 'var(--text-secondary)', fontSize: '0.75rem', cursor: 'pointer' },
  optBtnActive: { background: 'var(--asset-dim)', border: '1px solid var(--asset-color)', color: 'var(--asset-color)', fontWeight: 600 },
};
