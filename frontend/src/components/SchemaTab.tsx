import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ConnectSaved, Disconnect} from '../lib/tabApi';
import {withQueue} from '../lib/tabCallQueue';
import {useSchemaObjects, type SchemaCategory} from '../lib/useSchemaObjects';
import SchemaObjectList from './SchemaObjectList';

interface Props {
    tabId: string;
    connectionId: string;
    schema: string;
    hidden: boolean;
    onConnectedChange: (connected: boolean) => void;
    onOpenTable: (connectionId: string, schema: string, table: string) => void;
    onOpenRoutine?: (kind: 'trigger' | 'function', name: string, definition: string) => void;
}

export default function SchemaTab({
    tabId,
    connectionId,
    schema,
    hidden,
    onConnectedChange,
    onOpenTable,
    onOpenRoutine,
}: Props) {
    const {t} = useTranslation();
    const [connected, setConnected] = useState(false);
    const [status, setStatus] = useState(() => t('schemaTab.statusConnecting'));

    useEffect(() => {
        let cancelled = false;
        async function init() {
            await withQueue(`${tabId}:mount`, async () => {
                try {
                    await ConnectSaved(tabId, connectionId);
                } catch (err) {
                    if (cancelled) return;
                    setStatus(t('schemaTab.statusError', {error: String(err)}));
                    return;
                }
                if (cancelled) {
                    await Disconnect(tabId).catch(() => {});
                    return;
                }
                setConnected(true);
                onConnectedChange(true);
                setStatus(t('schemaTab.statusConnected', {schema}));
            });
        }
        void init();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const {
        activeCategory,
        setActiveCategory,
        loading,
        error,
        search,
        setSearch,
        counts,
        filteredTables,
        filteredViews,
        filteredFunctions,
        filteredSequences,
    } = useSchemaObjects({tabId, schema, connected});

    const isError = status.toLowerCase().startsWith('erro');

    const categories: {key: SchemaCategory; label: string; count: number}[] = [
        {key: 'tables', label: t('schemaTab.tables', 'Tabelas'), count: counts.tables},
        {key: 'views', label: t('schemaTab.views', 'Views'), count: counts.views},
        {key: 'functions', label: t('schemaTab.functions', 'Funções'), count: counts.functions},
        {key: 'sequences', label: t('schemaTab.sequences', 'Sequences'), count: counts.sequences},
    ];

    return (
        <div className="table-tab" hidden={hidden}>
            <div className="toolbar-secondary" style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12}}>
                <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
                    <span className="table-tab-title" title={t('schemaTab.title', {schema})}>{schema}</span>
                    <div className="status-badge" title={t('schemaTab.statusTitle')}>
                        <span className={`status-dot ${connected ? 'connected' : isError ? 'error' : ''}`} />
                        <span>{status}</span>
                    </div>
                </div>

                <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                    <input
                        type="text"
                        className="sidebar-search-input"
                        style={{width: 180, height: 24, fontSize: '11.5px'}}
                        placeholder={t('schemaTab.filterPlaceholder', 'Filtrar objetos...')}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
            </div>

            <div style={{display: 'flex', gap: 6, padding: '8px 12px', background: 'var(--bg-panel)', borderBottom: '1px solid var(--border-default)'}}>
                {categories.map(cat => (
                    <button
                        key={cat.key}
                        type="button"
                        className={`result-tab-pill ${activeCategory === cat.key ? 'active' : ''}`}
                        onClick={() => setActiveCategory(cat.key)}
                        style={{display: 'inline-flex', alignItems: 'center', gap: 6}}
                    >
                        <span>{cat.label}</span>
                        <span style={{opacity: 0.6, fontSize: '10.5px'}}>({cat.count})</span>
                    </button>
                ))}
            </div>

            <div className="table-meta-pane">
                {loading && <div className="meta-empty">{t('schemaTab.loading')}</div>}
                {error && <div className="meta-empty">{t('schemaTab.loadError', {error})}</div>}
                {!loading && !error && (
                    <SchemaObjectList
                        category={activeCategory}
                        schema={schema}
                        connectionId={connectionId}
                        tables={filteredTables}
                        views={filteredViews}
                        functions={filteredFunctions}
                        sequences={filteredSequences}
                        onOpenTable={onOpenTable}
                        onOpenRoutine={onOpenRoutine}
                    />
                )}
            </div>
        </div>
    );
}
