import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Account } from '../db';
import { saveAccountOrder } from '../services/assetService';

interface Group { category: string; type: Account['type']; accounts: Account[]; }

function initialGroups(accounts: Account[]): Group[] {
  const groups: Group[] = [];
  for (const type of ['asset', 'liability'] as const) {
    for (const account of accounts.filter(item => item.type === type)) {
      const group = groups.find(item => item.type === type && item.category === account.category);
      if (group) group.accounts.push(account);
      else groups.push({ category: account.category, type, accounts: [account] });
    }
  }
  return groups;
}

export default function HomeAssetOrderDialog({ accounts, onClose, onSaved }: {
  accounts: Account[]; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const [groups, setGroups] = useState(() => initialGroups(accounts));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const moveGroup = (index: number, delta: number) => setGroups(previous => {
    const next = [...previous];
    const target = index + delta;
    if (!next[target] || next[target].type !== next[index].type) return previous;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const moveAccount = (groupIndex: number, index: number, delta: number) => setGroups(previous => previous.map((group, current) => {
    if (current !== groupIndex) return group;
    const next = [...group.accounts];
    const target = index + delta;
    if (!next[target]) return group;
    [next[index], next[target]] = [next[target], next[index]];
    return { ...group, accounts: next };
  }));
  const save = async () => {
    if (saving) return;
    setSaving(true); setError('');
    try {
      await saveAccountOrder(groups.flatMap(group => group.accounts.map(account => account.id)));
      await onSaved();
    } catch (cause) {
      setError(t(cause instanceof Error && cause.message === 'ACCOUNT_ORDER_CHANGED' ? 'home_sort_changed' : 'home_sort_error'));
    } finally { setSaving(false); }
  };
  return <dialog className="home-order-dialog" ref={dialog} aria-labelledby="home-order-title" onCancel={event => {
    event.preventDefault(); if (!saving) onClose();
  }}>
    <header><h2 id="home-order-title">{t('home_sort_title')}</h2><button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>{t('cancel')}</button></header>
    <div className="home-order-scroll">
      <p>{t('home_sort_intro')}</p>
      {groups.map((group, groupIndex) => <section className="home-order-group" key={`${group.type}:${group.category}`}>
        {(groupIndex === 0 || groups[groupIndex - 1].type !== group.type) && <h3>{t(group.type === 'asset' ? 'assets' : 'liabilities')}</h3>}
        <div className="home-order-category"><strong>{t(group.category)}</strong><span className="home-order-controls">
          <button type="button" disabled={saving || groups[groupIndex - 1]?.type !== group.type} onClick={() => moveGroup(groupIndex, -1)} aria-label={t('home_sort_up', { name: t(group.category) })}>↑</button>
          <button type="button" disabled={saving || groups[groupIndex + 1]?.type !== group.type} onClick={() => moveGroup(groupIndex, 1)} aria-label={t('home_sort_down', { name: t(group.category) })}>↓</button>
        </span></div>
        {group.accounts.map((account, index) => <div className="home-order-account" key={account.id}><span>{account.name}<small>{account.institution}</small></span><span className="home-order-controls">
          <button type="button" disabled={saving || index === 0} onClick={() => moveAccount(groupIndex, index, -1)} aria-label={t('home_sort_up', { name: account.name })}>↑</button>
          <button type="button" disabled={saving || index === group.accounts.length - 1} onClick={() => moveAccount(groupIndex, index, 1)} aria-label={t('home_sort_down', { name: account.name })}>↓</button>
        </span></div>)}
      </section>)}
    </div>
    <footer>{error && <p role="alert">{error}</p>}<button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>{t(saving ? 'home_sort_saving' : 'save')}</button></footer>
  </dialog>;
}
