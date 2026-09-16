import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ListScripts, UpdateScript, DeleteScript} from '../../wailsjs/go/main/App';
import type {store} from '../../wailsjs/go/models';

// Painel de scripts SQL salvos: diferente do histórico (log automático de
// execuções), aqui o usuário nomeia e reabre scripts deliberadamente — ver
// App.SaveScript/ListScripts/UpdateScript/DeleteScript.
interface Props {
    activeScriptId: string | null;
    onSelectScript: (id: string, name: string, queryText: string) => void;
    refreshToken: number;
}

function formatTime(updatedAt: any): string {
    if (!updatedAt) {
        return '';
    }
    return new Date(updatedAt).toLocaleString();
}

export default function ScriptsPanel({activeScriptId, onSelectScript, refreshToken}: Props) {
    const {t} = useTranslation();
    const [scripts, setScripts] = useState<store.SavedScript[]>([]);
    const [loading, setLoading] = useState(false);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameInput, setRenameInput] = useState('');

    async function loadScripts() {
        setLoading(true);
        try {
            const result = await ListScripts();
            setScripts(result ?? []);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadScripts();
    }, [refreshToken]);

    async function handleDelete(id: string) {
        await DeleteScript(id);
        await loadScripts();
    }

    async function commitRename(script: store.SavedScript) {
        const name = renameInput.trim();
        setRenamingId(null);
        if (!name || name === script.Name) {
            return;
        }
        await UpdateScript(script.ID, name, script.QueryText);
        await loadScripts();
    }

    return (
        <aside className="history-panel">
            <div className="sidebar-header">
                <span className="sidebar-heading">{t('scriptsPanel.heading')}</span>
                <button className="sidebar-refresh-btn" onClick={loadScripts} disabled={loading} title={t('scriptsPanel.refreshTitle')}>
                    {loading ? t('scriptsPanel.loading') : t('scriptsPanel.refresh')}
                </button>
            </div>

            <div className="history-list">
                {scripts.length === 0 && !loading && (
                    <div className="sidebar-empty" style={{padding: '16px 8px'}}>
                        <span>{t('scriptsPanel.empty')}</span>
                    </div>
                )}

                <ul className="tree-list">
                    {scripts.map(script => (
                        <li
                            key={script.ID}
                            className={`history-item ${script.ID === activeScriptId ? 'active' : ''}`}
                            title={t('scriptsPanel.itemTitle')}
                        >
                            {renamingId === script.ID ? (
                                <input
                                    className="input-control"
                                    autoFocus
                                    value={renameInput}
                                    onChange={e => setRenameInput(e.target.value)}
                                    onClick={e => e.stopPropagation()}
                                    onBlur={() => commitRename(script)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') commitRename(script);
                                        if (e.key === 'Escape') setRenamingId(null);
                                    }}
                                />
                            ) : (
                                <div
                                    className="history-summary"
                                    onClick={() => onSelectScript(script.ID, script.Name, script.QueryText)}
                                    onDoubleClick={e => {
                                        e.stopPropagation();
                                        setRenamingId(script.ID);
                                        setRenameInput(script.Name);
                                    }}
                                    title={t('scriptsPanel.renameTitle')}
                                >
                                    {script.Name}
                                </div>
                            )}
                            <div className="history-meta">
                                <span>{formatTime(script.UpdatedAt)}</span>
                                <button
                                    className="btn btn-secondary"
                                    style={{padding: '1px 6px', fontSize: '11px'}}
                                    onClick={e => {
                                        e.stopPropagation();
                                        handleDelete(script.ID);
                                    }}
                                    title={t('scriptsPanel.deleteTitle')}
                                >
                                    {t('scriptsPanel.delete')}
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </aside>
    );
}
