import {useEffect, useState} from 'react';
import {SaveConnection, ListSavedConnections, ConnectSaved, DeleteSavedConnection} from '../../wailsjs/go/main/App';
import type {store} from '../../wailsjs/go/models';

interface Props {
    tabId: string;
    driver: string;
    dsn: string;
    connected: boolean;
    status: string;
    onDriverChange: (v: string) => void;
    onDsnChange: (v: string) => void;
    onConnect: () => void;
    onDisconnect: () => void;
    onConnected: () => void;
}

// Barra de conexão: conectar por DSN direta, salvar a conexão atual
// (cifrada via Credential Vault, ver internal/vault) e reconectar a partir
// de uma conexão salva sem redigitar a DSN.
export default function ConnectionBar({
    tabId, driver, dsn, connected, status,
    onDriverChange, onDsnChange, onConnect, onDisconnect, onConnected,
}: Props) {
    const [saved, setSaved] = useState<store.SavedConnection[]>([]);
    const [saveName, setSaveName] = useState('');

    async function refreshSaved() {
        const list = await ListSavedConnections();
        setSaved(list ?? []);
    }

    useEffect(() => {
        refreshSaved();
    }, []);

    async function handleSave() {
        if (!saveName.trim()) return;
        await SaveConnection(saveName.trim(), driver, dsn);
        setSaveName('');
        await refreshSaved();
    }

    async function handleConnectSaved(id: string) {
        await ConnectSaved(tabId, id);
        onConnected();
    }

    async function handleDelete(id: string) {
        await DeleteSavedConnection(id);
        await refreshSaved();
    }

    const isConnected = connected;
    const isError = status.toLowerCase().startsWith('erro');

    return (
        <header className="topbar">
            <div className="topbar-row">
                <select
                    className="input-control driver-select"
                    value={driver}
                    onChange={e => onDriverChange(e.target.value)}
                    disabled={connected}
                    title="Dialeto de banco de dados"
                >
                    <option value="sqlite">SQLite</option>
                    <option value="postgres">PostgreSQL</option>
                </select>

                <input
                    className="input-control dsn-input"
                    value={dsn}
                    onChange={e => onDsnChange(e.target.value)}
                    disabled={connected}
                    placeholder="DSN de conexão (ex: /caminho/banco.db ou postgres://user:pass@host:5432/db)"
                    title="Data Source Name (DSN)"
                />

                {!connected ? (
                    <button className="btn btn-primary" onClick={onConnect}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 2v8M4.93 10.93l1.41 1.41M2 18h2M20 18h2M19.07 10.93l-1.41 1.41M22 22H2M15 15l4 4M9 15l-4 4" />
                        </svg>
                        Conectar
                    </button>
                ) : (
                    <button className="btn btn-disconnect" onClick={onDisconnect}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                        Desconectar
                    </button>
                )}

                <div className="status-badge" title="Status da sessão atual">
                    <span className={`status-dot ${isConnected ? 'connected' : isError ? 'error' : ''}`} />
                    <span>{status}</span>
                </div>
            </div>

            <div className="topbar-row saved-section">
                <span className="saved-label">Salvar conexão:</span>
                <input
                    className="input-control save-name-input"
                    value={saveName}
                    onChange={e => setSaveName(e.target.value)}
                    placeholder="Nome do favorito..."
                />
                <button className="btn btn-secondary" onClick={handleSave} disabled={!saveName.trim()}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                        <polyline points="17 21 17 13 7 13 7 21" />
                        <polyline points="7 3 7 8 15 8" />
                    </svg>
                    Salvar
                </button>

                {saved.length > 0 && (
                    <div className="saved-connections">
                        <span className="saved-label" style={{marginLeft: '8px'}}>Salvas:</span>
                        {saved.map(c => (
                            <span key={c.ID} className="saved-chip" title={`Conectar a ${c.Name} (${c.Driver})`}>
                                <button
                                    className="saved-chip-btn"
                                    onClick={() => handleConnectSaved(c.ID)}
                                    disabled={connected}
                                >
                                    <span className="driver-pill">{c.Driver}</span>
                                    <span>{c.Name}</span>
                                </button>
                                <button
                                    className="delete-chip"
                                    onClick={() => handleDelete(c.ID)}
                                    title="Remover conexão salva"
                                >
                                    ×
                                </button>
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </header>
    );
}
