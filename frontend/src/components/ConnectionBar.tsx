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

    return (
        <header className="topbar">
            <div className="topbar-row">
                <select value={driver} onChange={e => onDriverChange(e.target.value)} disabled={connected}>
                    <option value="sqlite">sqlite</option>
                    <option value="postgres">postgres</option>
                </select>
                <input
                    value={dsn}
                    onChange={e => onDsnChange(e.target.value)}
                    disabled={connected}
                    placeholder="DSN (arquivo .db ou postgres://...)"
                />
                {!connected
                    ? <button onClick={onConnect}>Conectar</button>
                    : <button onClick={onDisconnect}>Desconectar</button>}
                <span className="status">{status}</span>
            </div>

            <div className="topbar-row">
                <input
                    value={saveName}
                    onChange={e => setSaveName(e.target.value)}
                    placeholder="Nome para salvar esta conexão"
                />
                <button onClick={handleSave} disabled={!saveName.trim()}>Salvar conexão</button>

                {saved.length > 0 && (
                    <div className="saved-connections">
                        {saved.map(c => (
                            <span key={c.ID} className="saved-chip">
                                <button onClick={() => handleConnectSaved(c.ID)} disabled={connected}>
                                    {c.Name} ({c.Driver})
                                </button>
                                <button className="delete-chip" onClick={() => handleDelete(c.ID)}>×</button>
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </header>
    );
}
