import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { homeAssetEn, homeAssetZh } from './i18n/homeAssetTranslations';
import { portfolioCashEn, portfolioCashZh } from './i18n/portfolioCashTranslations';
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
import { dividendCheckEn, dividendCheckZh } from './i18n/dividendCheckTranslations';
import { dividendDailyCheckEn, dividendDailyCheckZh } from './i18n/dividendDailyCheckTranslations';
import { dividendWorkbenchEn, dividendWorkbenchZh } from './i18n/dividendWorkbenchTranslations';
import { dividendClassicStrategyEn, dividendClassicStrategyZh } from './i18n/dividendClassicStrategyTranslations';

import { dividendFocusEn, dividendFocusZh } from './i18n/dividendFocusTranslations';
import { dividendFundFocusEn, dividendFundFocusZh } from './i18n/dividendFundFocusTranslations';
import { dividendReaderEn, dividendReaderZh } from './i18n/dividendReaderTranslations';
import { dividendPricingGuideEn, dividendPricingGuideZh } from './i18n/dividendPricingGuideTranslations';
import { dividendFundTodayEn, dividendFundTodayZh } from './i18n/dividendFundTodayTranslations';
import { dividendExperienceEn, dividendExperienceZh } from './i18n/dividendExperienceTranslations';
import { dividendV9En, dividendV9Zh } from './i18n/dividendV9Translations';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: { ...en, ...homeAssetEn, ...portfolioCashEn, ...dividendAiWorkspaceEn, ...dividendHomeEn, ...dividendGridEn, ...dividendReviewEn, ...dividendSimplifiedEn, ...dividendFinancialV5En, ...dividendLedgerV5En, ...dividendBatchEn, ...dividendCheckEn, ...dividendDailyCheckEn, ...dividendClassicStrategyEn, ...dividendWorkbenchEn, ...dividendFocusEn, ...dividendFundFocusEn, ...dividendReaderEn, ...dividendExperienceEn, ...dividendPricingGuideEn, ...dividendFundTodayEn, ...dividendV9En } },
      zh: { translation: { ...zh, ...homeAssetZh, ...portfolioCashZh, ...dividendAiWorkspaceZh, ...dividendHomeZh, ...dividendGridZh, ...dividendReviewZh, ...dividendSimplifiedZh, ...dividendFinancialV5Zh, ...dividendLedgerV5Zh, ...dividendBatchZh, ...dividendCheckZh, ...dividendDailyCheckZh, ...dividendClassicStrategyZh, ...dividendWorkbenchZh, ...dividendFocusZh, ...dividendFundFocusZh, ...dividendReaderZh, ...dividendExperienceZh, ...dividendPricingGuideZh, ...dividendFundTodayZh, ...dividendV9Zh } }
    },
    lng: 'zh', // Will be overridden by settings
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false 
    }
  });

export default i18n;
