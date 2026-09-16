// Barra de abas de resultado (estilo DBeaver "Result Sets").
// Extraído do ConsoleTab sem mudança de comportamento.
import {useTranslation} from 'react-i18next';
import type {ResultTabState} from '../lib/useResultExecution';

interface ResultTabBarProps {
    resultTabs: ResultTabState[];
    activeResultId: string | null;
    onSelect: (id: string) => void;
    onClose: (id: string) => void;
}

export default function ResultTabBar({resultTabs, activeResultId, onSelect, onClose}: ResultTabBarProps) {
    const {t} = useTranslation();
    if (resultTabs.length === 0) return null;
    return (
        <div className="result-tab-bar" role="tablist">
            {resultTabs.map(resultTab => (
                <button
                    key={resultTab.id}
                    role="tab"
                    aria-selected={resultTab.id === activeResultId}
                    className={`result-tab-pill ${resultTab.id === activeResultId ? 'active' : ''} result-tab-${resultTab.status}`}
                    onClick={() => onSelect(resultTab.id)}
                    title={resultTab.queryText}
                >
                    <span className={`result-tab-dot result-tab-dot-${resultTab.status}`} />
                    <span className="result-tab-label">{resultTab.label}</span>
                    {resultTab.status === 'queued' && <span className="result-tab-hint">{t('consoleTab.queued')}</span>}
                    {resultTab.status === 'running' && <span className="result-tab-hint">{t('consoleTab.running')}</span>}
                    {resultTab.status === 'cancelled' && <span className="result-tab-hint">{t('consoleTab.cancelled')}</span>}
                    <span
                        className="result-tab-close"
                        onClick={e => {
                            e.stopPropagation();
                            onClose(resultTab.id);
                        }}
                        title={t('consoleTab.closeResultTitle')}
                    >
                        ×
                    </span>
                </button>
            ))}
        </div>
    );
}
