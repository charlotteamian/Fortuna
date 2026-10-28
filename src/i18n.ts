import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from './locales/zh.json';
import en from './locales/en.json';
import { dividendAiWorkspaceEn, dividendAiWorkspaceZh } from './i18n/dividendAiWorkspaceTranslations';
import { dividendHomeEn, dividendHomeZh } from './i18n/dividendHomeTranslations';
import { dividendGridEn, dividendGridZh } from './i18n/dividendGridTranslations';
import { dividendReviewEn, dividendReviewZh } from './i18n/dividendReviewTranslations';
import { dividendSimplifiedEn, dividendSimplifiedZh } from './i18n/dividendSimplifiedTranslations';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: { ...en, ...dividendAiWorkspaceEn, ...dividendHomeEn, ...dividendGridEn, ...dividendReviewEn, ...dividendSimplifiedEn } },
      zh: { translation: { ...zh, ...dividendAiWorkspaceZh, ...dividendHomeZh, ...dividendGridZh, ...dividendReviewZh, ...dividendSimplifiedZh } }
    },
    lng: 'zh', // Will be overridden by settings
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false 
    }
  });

export default i18n;
