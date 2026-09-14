import {useState} from 'react';
import './App.css';
import {Connect, Execute, Disconnect} from '../wailsjs/go/main/App';

// UI mínima de teste manual do skeleton (Fase 1). Editor Monaco e data grid
// virtualizado entram nas Fases 1-2 reais (ver docs/ROADMAP.md) — isto aqui
// só existe para validar Connect/Execute/Disconnect ponta a ponta.
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

    return (
        <div id="App">
            <h2>Wisp — teste manual do skeleton</h2>

            <div className="panel">
                <select value={driver} onChange={e => setDriver(e.target.value)} disabled={connected}>
                    <option value="sqlite">sqlite</option>
                    <option value="postgres">postgres</option>
                </select>
                <input
                    value={dsn}
                    onChange={e => setDsn(e.target.value)}
                    disabled={connected}
                    placeholder="DSN (arquivo .db ou postgres://...)"
                />
                {!connected
                    ? <button onClick={handleConnect}>Conectar</button>
                    : <button onClick={handleDisconnect}>Desconectar</button>}
            </div>

            <textarea
                rows={4}
                value={query}
                onChange={e => setQuery(e.target.value)}
                disabled={!connected}
            />
            <button onClick={handleRun} disabled={!connected}>Executar</button>

            <p className="status">{status}</p>

            {columns.length > 0 && (
                <table>
                    <thead>
                        <tr>{columns.map(c => <th key={c}>{c}</th>)}</tr>
                    </thead>
                    <tbody>
                        {rows.map((row, i) => (
                            <tr key={i}>{row.map((v, j) => <td key={j}>{String(v)}</td>)}</tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    )
}

export default App
