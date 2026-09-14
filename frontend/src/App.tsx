import {useState} from 'react';
import './App.css';
import {Connect, Execute, Disconnect} from '../wailsjs/go/main/App';
import SqlEditor from './components/SqlEditor';
import ResultGrid from './components/ResultGrid';
import Sidebar from './components/Sidebar';
import ConnectionBar from './components/ConnectionBar';

const TAB_ID = 'tab-dev-1';

function App() {
    const [driver, setDriver] = useState('sqlite');
    const [dsn, setDsn] = useState('/home/matheusdutra/Projects/wisp/testdata/sample.db');
    const [query, setQuery] = useState('SELECT * FROM customers ORDER BY id');
    const [connected, setConnected] = useState(false);
    const [status, setStatus] = useState('desconectado');
    const [columns, setColumns] = useState<string[]>([]);
    const [rows, setRows] = useState<any[][]>([]);

    async function handleConnect() {
        try {
            await Connect(TAB_ID, driver, dsn);
            setConnected(true);
            setStatus('conectado');
        } catch (err) {
            setStatus(`erro ao conectar: ${err}`);
        }
    }

    function handleConnected() {
        setConnected(true);
        setStatus('conectado (via conexão salva)');
    }

    async function handleDisconnect() {
        await Disconnect(TAB_ID);
        setConnected(false);
        setStatus('desconectado');
        setColumns([]);
        setRows([]);
    }

    async function handleRun() {
        try {
            const result = await Execute(TAB_ID, query);
            setColumns(result.Columns ?? []);
            setRows(result.Rows ?? []);
            setStatus(`ok — ${result.Rows?.length ?? 0} linha(s)`);
        } catch (err) {
            setStatus(`erro ao executar: ${err}`);
        }
    }

    function handleSelectTable(schema: string, table: string) {
        setQuery(`SELECT * FROM ${schema === 'main' ? table : `${schema}.${table}`} LIMIT 200`);
    }

    return (
        <div id="App">
            <ConnectionBar
                tabId={TAB_ID}
                driver={driver}
                dsn={dsn}
                connected={connected}
                status={status}
                onDriverChange={setDriver}
                onDsnChange={setDsn}
                onConnect={handleConnect}
                onDisconnect={handleDisconnect}
                onConnected={handleConnected}
            />

            <div className="workspace">
                <Sidebar tabId={TAB_ID} connected={connected} onSelectTable={handleSelectTable} />

                <main className="main-panel">
                    <div className="editor-pane">
                        <SqlEditor value={query} onChange={setQuery} onRunRequested={handleRun} readOnly={!connected} />
                    </div>
                    <div className="editor-actions">
                        <button onClick={handleRun} disabled={!connected}>Executar (Ctrl+Enter)</button>
                    </div>
                    <ResultGrid columns={columns} rows={rows} />
                </main>
            </div>
        </div>
    )
}

export default App
