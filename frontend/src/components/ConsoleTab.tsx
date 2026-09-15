import {useState} from 'react';
import {RunQuery, FetchRows, Disconnect, CancelQuery} from '../../wailsjs/go/main/App';
import SqlEditor from './SqlEditor';
import ResultGrid from './ResultGrid';
import Sidebar from './Sidebar';
import QueryHistory from './QueryHistory';
import ConnectionBar from './ConnectionBar';

const DEFAULT_BATCH_SIZE = 200;

interface Props {
    tabId: string;
    hidden: boolean;
    onConnectedChange: (connected: boolean) => void;
}

// Estado e comportamento de um console isolado (uma aba). Extraído de App.tsx
// para suportar múltiplas abas: cada instância tem seu próprio tabId, que já
// é a chave de isolamento no backend (Session Manager, ver internal/session).
export default function ConsoleTab({tabId, hidden, onConnectedChange}: Props) {
    const [query, setQuery] = useState('SELECT * FROM customers ORDER BY id');
    const [connected, setConnected] = useState(false);
    const [status, setStatus] = useState('desconectado');
    const [columns, setColumns] = useState<string[]>([]);
    const [rows, setRows] = useState<any[][]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [running, setRunning] = useState(false);
    const [fetching, setFetching] = useState(false);
    const [durationMs, setDurationMs] = useState<number | null>(null);
    const [batchSize, setBatchSize] = useState(DEFAULT_BATCH_SIZE);
    const [batchSizeInput, setBatchSizeInput] = useState(String(DEFAULT_BATCH_SIZE));
    const [showHistory, setShowHistory] = useState(false);
    const [historyToken, setHistoryToken] = useState(0);

    const busy = running || fetching;

    function handleConnected(connName?: string) {
        setConnected(true);
        onConnectedChange(true);
        setStatus(connName ? `conectado: ${connName}` : 'conectado');
    }

    function handleError(err: string) {
        setStatus(`erro: ${err}`);
    }

    async function handleDisconnect() {
        await Disconnect(tabId);
        setConnected(false);
        onConnectedChange(false);
        setStatus('desconectado');
        setColumns([]);
        setRows([]);
        setHasMore(false);
        setDurationMs(null);
    }

    async function fetchBatch(currentRows: any[][], replace: boolean) {
        setFetching(true);
        try {
            const batch = await FetchRows(tabId, batchSize);
            const combined = replace ? (batch.Rows ?? []) : [...currentRows, ...(batch.Rows ?? [])];
            setRows(combined);
            setHasMore(batch.HasMore);
            setStatus(`ok — ${combined.length} linha(s) carregada(s)${batch.HasMore ? ', mais disponíveis' : ''}`);
            return combined;
        } catch (err) {
            setStatus(`erro ao buscar linhas: ${err}`);
            return currentRows;
        } finally {
            setFetching(false);
        }
    }

    async function handleRun(textOverride?: string) {
        const text = textOverride ?? query;
        setRunning(true);
        setColumns([]);
        setRows([]);
        setHasMore(false);
        setDurationMs(null);
        try {
            const meta = await RunQuery(tabId, text);
            setColumns(meta.Columns ?? []);
            setDurationMs(meta.DurationMs);
            setRunning(false);
            await fetchBatch([], true);
        } catch (err) {
            setStatus(`erro ao executar: ${err}`);
            setRunning(false);
        } finally {
            setHistoryToken(t => t + 1);
        }
    }

    async function handleLoadMore() {
        await fetchBatch(rows, false);
    }

    async function handleCancel() {
        await CancelQuery(tabId);
    }

    function handleSelectTable(schema: string, table: string) {
        setQuery(`SELECT * FROM ${schema === 'main' ? table : `${schema}.${table}`} LIMIT 200`);
    }

    return (
        <div className="console-tab" hidden={hidden}>
            <ConnectionBar
                tabId={tabId}
                connected={connected}
                status={status}
                onDisconnect={handleDisconnect}
                onConnected={handleConnected}
                onError={handleError}
            />

            <div className="workspace">
                <Sidebar tabId={tabId} connected={connected} onSelectTable={handleSelectTable} />

                <main className="main-panel">
                    <div className="editor-pane">
                        <SqlEditor
                            value={query}
                            onChange={setQuery}
                            onRunRequested={() => handleRun()}
                            onRunSelectionRequested={text => handleRun(text)}
                            readOnly={!connected}
                        />
                    </div>
                    <div className="editor-actions">
                        <div className="editor-actions-left">
                            {busy ? (
                                <button className="btn btn-danger" onClick={handleCancel} title="Cancelar consulta em andamento">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                        <rect x="4" y="4" width="16" height="16" rx="2" />
                                    </svg>
                                    Cancelar
                                </button>
                            ) : (
                                <button className="btn btn-success" onClick={() => handleRun()} disabled={!connected} title="Executar tudo (Ctrl+Enter) — ou selecione um trecho e use Ctrl+Shift+Enter para rodar só ele">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                        <polygon points="5 3 19 12 5 21 5 3" />
                                    </svg>
                                    Executar
                                    <kbd className="kbd-shortcut">Ctrl+Enter</kbd>
                                    <kbd className="kbd-shortcut" title="Executar seleção ou statement atual">Ctrl+Shift+Enter</kbd>
                                </button>
                            )}

                            {durationMs !== null && (
                                <span className="duration-badge" title="Tempo de execução no servidor (não inclui o tempo de buscar as linhas)">
                                    {durationMs} ms
                                </span>
                            )}
                        </div>
                        <div className="editor-actions-right">
                            <label className="batch-size-field" title="Quantidade de linhas buscada por vez (padrão 200, como o 'fetch size' do DBeaver)">
                                Buscar
                                <input
                                    type="number"
                                    min={1}
                                    max={1000000}
                                    value={batchSizeInput}
                                    onChange={e => {
                                        const raw = e.target.value;
                                        setBatchSizeInput(raw);
                                        const parsed = parseInt(raw, 10);
                                        if (!Number.isNaN(parsed) && parsed >= 1) {
                                            setBatchSize(parsed);
                                        }
                                    }}
                                    onBlur={() => {
                                        const parsed = parseInt(batchSizeInput, 10);
                                        if (Number.isNaN(parsed) || parsed < 1) {
                                            setBatchSizeInput(String(batchSize));
                                        }
                                    }}
                                    disabled={busy}
                                />
                                por vez
                            </label>
                            <button
                                className="btn btn-secondary"
                                onClick={() => setShowHistory(v => !v)}
                                title="Mostrar/ocultar histórico de queries"
                            >
                                Histórico
                            </button>
                            <span title="ID da sessão ativa">{tabId}</span>
                        </div>
                    </div>
                    <ResultGrid columns={columns} rows={rows} />
                    {hasMore && (
                        <div className="load-more-bar">
                            <button className="btn btn-secondary" onClick={handleLoadMore} disabled={busy}>
                                {fetching ? 'Carregando…' : `Carregar mais ${batchSize}`}
                            </button>
                            <span className="load-more-hint">Mais linhas disponíveis no resultado.</span>
                        </div>
                    )}
                </main>

                {showHistory && (
                    <QueryHistory onSelectQuery={setQuery} refreshToken={historyToken} />
                )}
            </div>
        </div>
    );
}
