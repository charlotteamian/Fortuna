import type React from 'react';
import { useState } from 'react';
import { createAccount, addRecord } from '../services/assetService';
import { type Settings, METAL_TYPES } from '../db';
import { useTranslation } from 'react-i18next';
import { getFieldsForCategory } from '../lib/categoryFields';

interface Props { settings: Settings; onClose: () => void; onCreated: (id: string) => void; }

export default function AccountForm({ settings, onClose, onCreated }: Props) {
  const { t } = useTranslation();
  const assetCats = settings.categories.filter(c => c.type === 'asset');
  const liabCats = settings.categories.filter(c => c.type === 'liability');
  const [type, setType] = useState<'asset' | 'liability'>('asset');
  const [category, setCategory] = useState(assetCats[0]?.name || '');
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [currency, setCurrency] = useState(settings.primaryCurrency);
  const [metalType, setMetalType] = useState('XAU');
  const [productData, setProductData] = useState<Record<string, string>>({});
  const [initShares, setInitShares] = useState('');
  const [initPrice, setInitPrice] = useState('');

  const setField = (key: string, val: string) => setProductData(prev => ({ ...prev, [key]: val }));

  const cats = type === 'asset' ? assetCats : liabCats;
  const isMetal = category === '贵金属';
  const isEquity = category === '股票/ETF' || category === '股票' || category === '场外基金';
  const extraFields = getFieldsForCategory(category, settings, t);
  const renderedExtraFields = isEquity ? extraFields.filter(f => f.key !== 'cost') : extraFields;

  const handleTypeChange = (t: 'asset' | 'liability') => {
    setType(t);
    const newCats = t === 'asset' ? assetCats : liabCats;
    if (!newCats.find(c => c.name === category)) setCategory(newCats[0]?.name || '');
    setProductData({});
  };

  const handleCategoryChange = (c: string) => {
    setCategory(c);
    setProductData({});
    if (c === '贵金属' && !name) {
      const m = METAL_TYPES.find(m => m.code === metalType);
      if (m) setName(m.name);
    }
  };

  const handleMetalChange = (code: string) => {
    setMetalType(code);
    const m = METAL_TYPES.find(m => m.code === code);
    if (m && (!name || METAL_TYPES.some(mt => mt.name === name))) setName(m.name);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    const icon = isMetal
      ? METAL_TYPES.find(m => m.code === metalType)?.icon
      : settings.categories.find(c => c.name === category)?.icon;
    const finalProductData = { ...productData };
    if (isEquity) {
      const price = parseFloat(initPrice);
      if (!isNaN(price) && price > 0) finalProductData.cost = initPrice;
    }
    const id = await createAccount({
      name: name.trim(), category, type, currency, icon,
      institution: institution.trim() || undefined,
      productData: Object.keys(finalProductData).length > 0 ? finalProductData : undefined,
      ...(isMetal ? { metalType, unit: 'gram' as const } : {}),
    });
    if (isEquity) {
      const shares = parseFloat(initShares);
      const price = parseFloat(initPrice);
      if (!isNaN(shares) && !isNaN(price) && shares > 0 && price > 0) {
        const today = new Date().toISOString().split('T')[0];
        await addRecord(id, today, shares * price);
      }
    }
    onCreated(id);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{t('add_account')}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Type toggle */}
        <div className="form-group">
          <div style={S.typeRow}>
            <button style={{ ...S.typeBtn, ...(type === 'asset' ? { background: 'var(--asset-color)', color: '#000' } : S.typeBtnInactive) }}
              onClick={() => handleTypeChange('asset')}>{t('assets')}</button>
            <button style={{ ...S.typeBtn, ...(type === 'liability' ? { background: 'var(--liability-color)', color: '#fff' } : S.typeBtnInactive) }}
              onClick={() => handleTypeChange('liability')}>{t('liabilities')}</button>
          </div>
        </div>

        {/* Category chips */}
        <div className="form-group">
          <label className="form-label">{t('category')}</label>
          <div style={S.chipRow}>
            {cats.map(c => (
              <button key={c.name}
                style={{ ...S.chip, ...(category === c.name ? S.chipActive : {}) }}
                onClick={() => handleCategoryChange(c.name)}>
                {t(c.name)}
              </button>
            ))}
          </div>
        </div>

        {/* Metal type */}
        {isMetal && (
          <div className="form-group">
            <label className="form-label">{t('metal_type')}</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {METAL_TYPES.map(m => (
                <button key={m.code} className={`btn ${metalType === m.code ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => handleMetalChange(m.code)}>{m.name}</button>
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
            placeholder={isMetal ? t('metal_placeholder') : t('account_placeholder')}
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
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16, padding: '8px 12px', background: 'var(--bg-glass)', borderRadius: 8 }}>
            {t('metal_hint', { currency })}
          </div>
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
                      <button key={optVal}
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

        {/* Equity quick-add: initial position */}
        {isEquity && (
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
              <div style={{ background: 'var(--bg-glass)', borderRadius: 10, padding: '10px 14px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--text-muted)' }}>{t('market_value')} = {t('shares')} × {t('price_per_share')}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--asset-color)' }}>
                  {(parseFloat(initShares) * parseFloat(initPrice)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            )}
          </>
        )}

        <div className="modal-actions">
          <button className="btn btn-secondary btn-block" onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-primary btn-block" onClick={handleSave}>{t('create')}</button>
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
  chipActive: { background: 'var(--asset-dim)', borderColor: 'var(--asset-color)', color: 'var(--asset-color)', fontWeight: 600 },
  divider: { display: 'flex', alignItems: 'center', margin: '4px 0 12px', gap: 8 },
  dividerText: { fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' },
  optionRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  optBtn: { padding: '5px 11px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--bg-glass)', color: 'var(--text-secondary)', fontSize: '0.75rem', cursor: 'pointer' },
  optBtnActive: { background: 'var(--asset-dim)', borderColor: 'var(--asset-color)', color: 'var(--asset-color)', fontWeight: 600 },
};
