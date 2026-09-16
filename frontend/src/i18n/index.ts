import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import en from './locales/en.json';
import ptBR from './locales/pt-BR.json';

export const STORAGE_KEY = 'wisp:language';

function detectLanguage(): string {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'pt-BR') return saved;
    return navigator.language.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
}

i18n.use(initReactI18next).init({
    resources: {
        en: {translation: en},
        'pt-BR': {translation: ptBR},
    },
    lng: detectLanguage(),
    fallbackLng: 'en',
    interpolation: {escapeValue: false},
});

export function setLanguage(lang: 'en' | 'pt-BR') {
    localStorage.setItem(STORAGE_KEY, lang);
    i18n.changeLanguage(lang);
}

export default i18n;
