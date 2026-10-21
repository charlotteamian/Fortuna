import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from './locales/zh.json';
import en from './locales/en.json';
import { dividendAiWorkspaceEn, dividendAiWorkspaceZh } from './i18n/dividendAiWorkspaceTranslations';
import { dividendHomeEn, dividendHomeZh } from './i18n/dividendHomeTranslations';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: { ...en, ...dividendAiWorkspaceEn, ...dividendHomeEn } },
      zh: { translation: { ...zh, ...dividendAiWorkspaceZh, ...dividendHomeZh } }
    },
    lng: 'zh', // Will be overridden by settings
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false 
    }
  });

export default i18n;
