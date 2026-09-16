import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ListSavedConnections} from '../../wailsjs/go/main/App';
import {ConnectSaved} from '../lib/tabApi';
import type {store} from '../../wailsjs/go/models';
import ConnectionModal from './ConnectionModal';

interface Props {
    tabId: string;
    connected: boolean;
    status: string;
    onDisconnect: () => void;
    onConnected: (connectionId: string, connectionName?: string, driver?: string) => void;
    onError: (err: string) => void;
}

// Barra de conexões reformulada: dropdown com conexões salvas + modal estruturado
// (substituindo totalmente o campo de DSN cru anterior).
export default function ConnectionBar({
    tabId, connected, status,
    onDisconnect, onConnected, onError,
}: Props) {
    const {t} = useTranslation();
    const [saved, setSaved] = useState<store.SavedConnection[]>([]);
    const [selectedId, setSelectedId] = useState<string>('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [connecting, setConnecting] = useState(false);

    async function refreshSaved() {
        try {
            const list = await ListSavedConnections();
            const safeList = list ?? [];
            setSaved(safeList);
            // Se tiver conexões salvas e o selecionado não for válido, seleciona o primeiro
            if (safeList.length > 0) {
                if (!selectedId || !safeList.some(c => c.ID === selectedId)) {
                    setSelectedId(safeList[0].ID);
                }
            } else {
                setSelectedId('');
            }
        } catch (err) {
            console.error('Erro ao listar conexões:', err);
        }
    }

    useEffect(() => {
        refreshSaved();
    }, []);

    async function handleConnect() {
        if (!selectedId) {
            setIsModalOpen(true);
            return;
        }

        setConnecting(true);
        try {
            await ConnectSaved(tabId, selectedId);
            const found = saved.find(c => c.ID === selectedId);
            onConnected(selectedId, found?.Name, found?.Driver);
        } catch (err) {
            onError(String(err));
        } finally {
            setConnecting(false);
        }
    }

    const isConnected = connected;
    const isError = status.toLowerCase().startsWith('erro');
    const selectedConn = saved.find(c => c.ID === selectedId);

    return (
        <>
            <header className="topbar">
                <div className="topbar-row">
                    <div className="connection-selector-group">
                        <svg className="conn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <ellipse cx="12" cy="5" rx="9" ry="3" />
                            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                        </svg>

                        <select
                            className="input-control connection-select"
                            value={selectedId}
                            onChange={e => setSelectedId(e.target.value)}
                            disabled={connected || saved.length === 0}
                            title={t('connectionBar.selectTitle')}
                        >
                            {saved.length === 0 ? (
                                <option value="">{t('connectionBar.noConnections')}</option>
                            ) : (
                                saved.map(c => (
                                    <option key={c.ID} value={c.ID}>
                                        {c.Name} — [{c.Driver.toUpperCase()}]
                                    </option>
                                ))
                            )}
                        </select>
                    </div>

                    {!connected ? (
                        <button
                            className="btn btn-primary"
                            onClick={handleConnect}
                            disabled={connecting || saved.length === 0}
                            title={saved.length === 0 ? t('connectionBar.connectDisabledTitle') : t('connectionBar.connectTitle')}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 2v8M4.93 10.93l1.41 1.41M2 18h2M20 18h2M19.07 10.93l-1.41 1.41M22 22H2M15 15l4 4M9 15l-4 4" />
                            </svg>
                            {connecting ? t('connectionBar.connecting') : t('connectionBar.connect')}
                        </button>
                    ) : (
                        <button
                            className="btn btn-disconnect"
                            onClick={onDisconnect}
                            title={t('connectionBar.disconnectTitle')}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                            {t('connectionBar.disconnect')}
                        </button>
                    )}

                    <button
                        className="btn btn-secondary"
                        onClick={() => setIsModalOpen(true)}
                        title={t('connectionBar.manageTitle')}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        {t('connectionBar.manage')}
                    </button>

                    {isConnected && selectedConn && (
                        <div className="active-conn-tag">
                            <span className="driver-pill">{selectedConn.Driver}</span>
                            <span className="active-conn-name">{selectedConn.Name}</span>
                        </div>
                    )}

                    <div className="status-badge" title={t('connectionBar.statusTitle')}>
                        <span className={`status-dot ${isConnected ? 'connected' : isError ? 'error' : ''}`} />
                        <span>{status}</span>
                    </div>
                </div>
            </header>

            <ConnectionModal
                isOpen={isModalOpen}
                tabId={tabId}
                onClose={() => setIsModalOpen(false)}
                onConnected={(id, name, driver) => {
                    setSelectedId(id);
                    onConnected(id, name, driver);
                    refreshSaved();
                }}
                onConnectionsChanged={refreshSaved}
            />
        </>
    );
}
