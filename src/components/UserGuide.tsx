import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  onClose: () => void;
}

const GUIDE_SECTIONS = [
  'quick_start',
  'navigation',
  'account_models',
  'records',
  'holdings',
  'quotes',
  'allocation',
  'charts',
  'archive',
  'backup',
  'snapshot',
  'calendar',
  'privacy',
  'limitations',
] as const;

export default function UserGuide({ onClose }: Props) {
  const { t } = useTranslation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.documentElement.classList.add('modal-open');
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])',
      )];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.documentElement.classList.remove('modal-open');
      window.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <section
        ref={dialogRef}
        className="modal-content guide-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-guide-title"
        onClick={event => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 className="modal-title" id="user-guide-title">{t('user_guide_title')}</h2>
            <p className="guide-intro">{t('guide_intro')}</p>
          </div>
          <button ref={closeRef} className="modal-close" onClick={onClose} aria-label={t('close')}>✕</button>
        </div>

        <div className="guide-sections">
          {GUIDE_SECTIONS.map((section, index) => (
            <details className="guide-section" key={section} open={index === 0}>
              <summary>{t(`guide_${section}_title`)}</summary>
              <div className="guide-section-body">{t(`guide_${section}_body`)}</div>
            </details>
          ))}
        </div>

        <div className="guide-disclaimer" role="note">{t('not_investment_advice')}</div>
        <div className="modal-actions">
          <button className="btn btn-primary btn-block" onClick={onClose}>{t('done')}</button>
        </div>
      </section>
    </div>
  );
}
