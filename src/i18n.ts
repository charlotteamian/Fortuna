import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from './locales/zh.json';
import en from './locales/en.json';
import { dividendAiWorkspaceEn, dividendAiWorkspaceZh } from './i18n/dividendAiWorkspaceTranslations';
import { dividendHomeEn, dividendHomeZh } from './i18n/dividendHomeTranslations';
import { dividendGridEn, dividendGridZh } from './i18n/dividendGridTranslations';
import { dividendReviewEn, dividendReviewZh } from './i18n/dividendReviewTranslations';
import { dividendSimplifiedEn, dividendSimplifiedZh } from './i18n/dividendSimplifiedTranslations';

import { dividendFinancialV5En, dividendFinancialV5Zh } from './i18n/dividendFinancialV5Translations';
import { dividendLedgerV5En, dividendLedgerV5Zh } from './i18n/dividendLedgerV5Translations';
import { dividendBatchEn, dividendBatchZh } from './i18n/dividendBatchTranslations';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: { ...en, ...dividendAiWorkspaceEn, ...dividendHomeEn, ...dividendGridEn, ...dividendReviewEn, ...dividendSimplifiedEn, ...dividendFinancialV5En, ...dividendLedgerV5En, ...dividendBatchEn } },
      zh: { translation: { ...zh, ...dividendAiWorkspaceZh, ...dividendHomeZh, ...dividendGridZh, ...dividendReviewZh, ...dividendSimplifiedZh, ...dividendFinancialV5Zh, ...dividendLedgerV5Zh, ...dividendBatchZh } }
    },
    lng: 'zh', // Will be overridden by settings
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false 
    }
  });

export default i18n;
