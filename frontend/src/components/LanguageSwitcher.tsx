import {useTranslation} from 'react-i18next';
import {setLanguage} from '../i18n';

export default function LanguageSwitcher() {
    const {i18n} = useTranslation();

    return (
        <select
            className="language-switcher"
            value={i18n.language}
            onChange={e => setLanguage(e.target.value as 'en' | 'pt-BR')}
            title="Language / Idioma"
        >
            <option value="en">EN</option>
            <option value="pt-BR">PT-BR</option>
        </select>
    );
}
