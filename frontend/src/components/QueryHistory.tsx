import {useEffect, useState, useRef} from 'react';
import {useTranslation} from 'react-i18next';
import {GetQueryHistoryPaged, ClearQueryHistory} from '../../wailsjs/go/main/App';
import type {store} from '../../wailsjs/go/models';

interface Props {
    onSelectQuery: (queryText: string) => void;
    refreshToken: number;
}

const SUMMARY_LENGTH = 60;
const PAGE_SIZE = 25;

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
    const [totalCount, setTotalCount] = useState<number>(0);
    const [search, setSearch] = useState<string>('');
    const [debouncedSearch, setDebouncedSearch] = useState<string>('');
    const [loading, setLoading] = useState<boolean>(false);
    const [loadingMore, setLoadingMore] = useState<boolean>(false);

    // Debounce search input by 200ms
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
        }, 200);
        return () => clearTimeout(timer);
    }, [search]);

    async function loadInitialHistory(searchTerm: string) {
        setLoading(true);
        try {
            const page = await GetQueryHistoryPaged(searchTerm, PAGE_SIZE, 0);
            setEntries(page.entries ?? []);
            setTotalCount(page.totalCount ?? 0);
        } catch {
            setEntries([]);
            setTotalCount(0);
        } finally {
            setLoading(false);
        }
    }

    async function handleLoadMore() {
        if (loadingMore || entries.length >= totalCount) return;
        setLoadingMore(true);
        try {
            const page = await GetQueryHistoryPaged(debouncedSearch, PAGE_SIZE, entries.length);
            if (page.entries && page.entries.length > 0) {
                setEntries(prev => [...prev, ...page.entries]);
            }
            setTotalCount(page.totalCount ?? 0);
        } finally {
            setLoadingMore(false);
        }
    }

    async function handleClear() {
        if (!window.confirm(t('queryHistory.clearConfirm'))) return;
        try {
            await ClearQueryHistory();
            setEntries([]);
            setTotalCount(0);
        } catch {
            // Error handling
        }
    }

    // Triggered on debounce search change or refreshToken
    const isFirstMount = useRef(true);
    useEffect(() => {
        loadInitialHistory(debouncedSearch);
    }, [debouncedSearch, refreshToken]);

    return (
        <aside className="history-panel">
            <div className="sidebar-header">
                <span className="sidebar-heading">{t('queryHistory.heading')}</span>
                <div style={{display: 'flex', gap: 4}}>
                    {entries.length > 0 && (
                        <button
                            className="sidebar-refresh-btn"
                            onClick={handleClear}
                            disabled={loading}
                            title={t('queryHistory.clearTitle')}
                        >
                            {t('queryHistory.clear')}
                        </button>
                    )}
                    <button
                        className="sidebar-refresh-btn"
                        onClick={() => loadInitialHistory(debouncedSearch)}
                        disabled={loading}
                        title={t('queryHistory.refreshTitle')}
                    >
                        {loading ? t('queryHistory.loading') : t('queryHistory.refresh')}
                    </button>
                </div>
            </div>

            <div className="sidebar-search" style={{padding: '6px 8px'}}>
                <input
                    className="sidebar-search-input"
                    type="text"
                    placeholder={t('queryHistory.searchPlaceholder')}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
            </div>

            <div className="history-list">
                {entries.length === 0 && !loading && (
                    <div className="sidebar-empty" style={{padding: '16px 8px'}}>
                        <span>{search ? t('queryHistory.noResults') : t('queryHistory.empty')}</span>
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

                {entries.length < totalCount && (
                    <div style={{padding: '8px', textAlign: 'center'}}>
                        <button
                            className="btn btn-secondary btn-sm"
                            style={{width: '100%'}}
                            onClick={handleLoadMore}
                            disabled={loadingMore}
                        >
                            {loadingMore ? t('queryHistory.loading') : t('queryHistory.loadMore', {count: entries.length, total: totalCount})}
                        </button>
                    </div>
                )}
            </div>
        </aside>
    );
}
