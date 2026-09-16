import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {GetQueryHistory} from '../../wailsjs/go/main/App';
import type {store} from '../../wailsjs/go/models';

// Painel de histórico de queries: lista as últimas execuções registradas
// (ver App.GetQueryHistory) e preenche o editor ao clicar numa entrada —
// mesmo padrão de callback do Sidebar (onSelectTable).
interface Props {
    onSelectQuery: (queryText: string) => void;
    refreshToken: number;
}

const SUMMARY_LENGTH = 60;

function summarize(text: string): string {
    const single = text.replace(/\s+/g, ' ').trim();
    if (single.length <= SUMMARY_LENGTH) {
        return single;
    }
    return single.slice(0, SUMMARY_LENGTH) + '…';
}

function formatTime(executedAt: any): string {
    if (!executedAt) {
        return '';
    }
    return new Date(executedAt).toLocaleString();
}

export default function QueryHistory({onSelectQuery, refreshToken}: Props) {
    const {t} = useTranslation();
    const [entries, setEntries] = useState<store.QueryHistoryEntry[]>([]);
    const [loading, setLoading] = useState(false);

    async function loadHistory() {
        setLoading(true);
        try {
            const result = await GetQueryHistory(20);
            setEntries(result ?? []);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadHistory();
    }, [refreshToken]);

    return (
        <aside className="history-panel">
            <div className="sidebar-header">
                <span className="sidebar-heading">{t('queryHistory.heading')}</span>
                <button className="sidebar-refresh-btn" onClick={loadHistory} disabled={loading} title={t('queryHistory.refreshTitle')}>
                    {loading ? t('queryHistory.loading') : t('queryHistory.refresh')}
                </button>
            </div>

            <div className="history-list">
                {entries.length === 0 && !loading && (
                    <div className="sidebar-empty" style={{padding: '16px 8px'}}>
                        <span>{t('queryHistory.empty')}</span>
                    </div>
                )}

                <ul className="tree-list">
                    {entries.map(entry => (
                        <li
                            key={entry.ID}
                            className="history-item"
                            onClick={() => onSelectQuery(entry.QueryText)}
                            title={t('queryHistory.itemTitle')}
                        >
                            <div className="history-summary">{summarize(entry.QueryText)}</div>
                            <div className="history-meta">
                                <span className={`history-status history-status-${entry.Status}`}>
                                    {entry.Status}
                                </span>
                                <span>{entry.DurationMs} ms</span>
                                <span>{formatTime(entry.ExecutedAt)}</span>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </aside>
    );
}
