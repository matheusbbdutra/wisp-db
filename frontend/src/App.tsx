import {useState} from 'react';
import './App.css';
import {Execute, Disconnect, CancelQuery} from '../wailsjs/go/main/App';
import SqlEditor from './components/SqlEditor';
import ResultGrid from './components/ResultGrid';
import Sidebar from './components/Sidebar';
import QueryHistory from './components/QueryHistory';
import ConnectionBar from './components/ConnectionBar';

const TAB_ID = 'tab-dev-1';

function App() {
    const [query, setQuery] = useState('SELECT * FROM customers ORDER BY id');
    const [connected, setConnected] = useState(false);
    const [status, setStatus] = useState('desconectado');
    const [columns, setColumns] = useState<string[]>([]);
    const [rows, setRows] = useState<any[][]>([]);
    const [running, setRunning] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [historyToken, setHistoryToken] = useState(0);

    function handleConnected(connName?: string) {
        setConnected(true);
        setStatus(connName ? `conectado: ${connName}` : 'conectado');
    }

    function handleError(err: string) {
        setStatus(`erro: ${err}`);
    }

    async function handleDisconnect() {
        await Disconnect(TAB_ID);
        setConnected(false);
        setStatus('desconectado');
        setColumns([]);
        setRows([]);
    }

    // textOverride roda um trecho específico (seleção ou statement sob o
    // cursor, ver SqlEditor.onRunSelectionRequested) sem substituir o
    // conteúdo do editor — sem override, roda o editor inteiro.
    async function handleRun(textOverride?: string) {
        setRunning(true);
        try {
            const result = await Execute(TAB_ID, textOverride ?? query);
            setColumns(result.Columns ?? []);
            setRows(result.Rows ?? []);
            setStatus(`ok — ${result.Rows?.length ?? 0} linha(s)`);
        } catch (err) {
            setStatus(`erro ao executar: ${err}`);
        } finally {
            setRunning(false);
            setHistoryToken(t => t + 1);
        }
    }

    async function handleCancel() {
        await CancelQuery(TAB_ID);
    }

    function handleSelectTable(schema: string, table: string) {
        setQuery(`SELECT * FROM ${schema === 'main' ? table : `${schema}.${table}`} LIMIT 200`);
    }

    return (
        <div id="App">
            <ConnectionBar
                tabId={TAB_ID}
                connected={connected}
                status={status}
                onDisconnect={handleDisconnect}
                onConnected={handleConnected}
                onError={handleError}
            />

            <div className="workspace">
                <Sidebar tabId={TAB_ID} connected={connected} onSelectTable={handleSelectTable} />

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
                            {running ? (
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
                        </div>
                        <div className="editor-actions-right">
                            <button
                                className="btn btn-secondary"
                                onClick={() => setShowHistory(v => !v)}
                                title="Mostrar/ocultar histórico de queries"
                            >
                                Histórico
                            </button>
                            <span title="ID da sessão ativa">{TAB_ID}</span>
                        </div>
                    </div>
                    <ResultGrid columns={columns} rows={rows} />
                </main>

                {showHistory && (
                    <QueryHistory onSelectQuery={setQuery} refreshToken={historyToken} />
                )}
            </div>
        </div>
    )
}

export default App
