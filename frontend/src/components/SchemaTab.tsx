import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ConnectSaved, Disconnect, ListTables} from '../lib/tabApi';
import type {db} from '../../wailsjs/go/models';
import {withQueue} from '../lib/tabCallQueue';

interface Props {
    tabId: string;
    connectionId: string;
    schema: string;
    hidden: boolean;
    onConnectedChange: (connected: boolean) => void;
    onOpenTable: (connectionId: string, schema: string, table: string) => void;
}

// Aba de schema (nível superior, irmã do Console/TableTab): tem tabId e
// conexão PRÓPRIOS — reconecta no mount via ConnectSaved com o mesmo
// connectionId salvo da origem, nunca reusa a sessão do console (ver
// CLAUDE.md: 1 tabId = 1 conexão dedicada). Disconnect centralizado em
// App.tsx. Lista simples, sem sub-abas: cada linha abre a TableTab daquela
// tabela via onOpenTable (App.tsx cuida de criar a aba).
export default function SchemaTab({tabId, connectionId, schema, hidden, onConnectedChange, onOpenTable}: Props) {
    const {t} = useTranslation();
    const [connected, setConnected] = useState(false);
    const [status, setStatus] = useState(() => t('schemaTab.statusConnecting'));
    const [tables, setTables] = useState<db.Table[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        async function init() {
            // Chave `${tabId}:mount` (não tabId puro) pra não colidir com a
            // fila geral de bindings da aba (lib/tabApi.ts) — ver comentário
            // completo em TableTab.tsx.
            await withQueue(`${tabId}:mount`, async () => {
                try {
                    await ConnectSaved(tabId, connectionId);
                } catch (err) {
                    if (cancelled) return;
                    setStatus(t('schemaTab.statusError', {error: String(err)}));
                    setError(String(err));
                    return;
                }
                if (cancelled) {
                    await Disconnect(tabId).catch(() => {});
                    return;
                }
                setConnected(true);
                onConnectedChange(true);
                setStatus(t('schemaTab.statusConnected', {schema}));
                setLoading(true);
                try {
                    const result = await ListTables(tabId, schema);
                    if (cancelled) return;
                    setTables(result ?? []);
                } catch (err) {
                    if (cancelled) return;
                    setError(String(err));
                } finally {
                    if (!cancelled) setLoading(false);
                }
            });
        }
        void init();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const isError = status.toLowerCase().startsWith('erro');

    return (
        <div className="table-tab" hidden={hidden}>
            <div className="toolbar-secondary">
                <span className="table-tab-title" title={t('schemaTab.title', {schema})}>{schema}</span>
                <div className="status-badge" title={t('schemaTab.statusTitle')}>
                    <span className={`status-dot ${connected ? 'connected' : isError ? 'error' : ''}`} />
                    <span>{status}</span>
                </div>
            </div>

            <div className="table-meta-pane">
                {loading && <div className="meta-empty">{t('schemaTab.loading')}</div>}
                {error && <div className="meta-empty">{t('schemaTab.loadError', {error})}</div>}
                {!loading && !error && tables.length === 0 && (
                    <div className="meta-empty">{t('schemaTab.empty')}</div>
                )}
                {!loading && !error && tables.length > 0 && (
                    <div className="meta-list">
                        {tables.map(table => (
                            <div
                                key={table.Name}
                                className="meta-item"
                                role="button"
                                tabIndex={0}
                                title={t('schemaTab.openTitle', {schema, table: table.Name})}
                                onClick={() => onOpenTable(connectionId, schema, table.Name)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        onOpenTable(connectionId, schema, table.Name);
                                    }
                                }}
                            >
                                <div className="meta-name">
                                    {table.Name}
                                    {table.Kind === 'view' && <span className="tree-leaf-badge" title={t('schemaTab.view')}> {t('schemaTab.viewLabel')}</span>}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
