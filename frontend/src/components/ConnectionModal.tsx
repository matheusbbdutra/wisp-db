import {useState, useEffect} from 'react';
import {SaveConnection, ConnectSaved, DeleteSavedConnection, PickSQLiteFile, ListSavedConnections, TestConnection} from '../../wailsjs/go/main/App';
import type {store} from '../../wailsjs/go/models';

interface Props {
    isOpen: boolean;
    tabId: string;
    onClose: () => void;
    onConnected: (connectionId: string, name: string) => void;
    onConnectionsChanged: () => void;
}

export default function ConnectionModal({isOpen, tabId, onClose, onConnected, onConnectionsChanged}: Props) {
    const [activeTab, setActiveTab] = useState<'new' | 'manage'>('new');
    const [driver, setDriver] = useState<'sqlite' | 'postgres'>('sqlite');
    const [name, setName] = useState('');

    // Alterna entre preencher campos estruturados ou colar a DSN/link de
    // conexão completo direto — pedido do usuário, os dois jeitos coexistem.
    const [rawDsnMode, setRawDsnMode] = useState(false);
    const [rawDsn, setRawDsn] = useState('');

    // SQLite states
    const [sqlitePath, setSqlitePath] = useState('');

    // Postgres states
    const [pgHost, setPgHost] = useState('localhost');
    const [pgPort, setPgPort] = useState('5432');
    const [pgDatabase, setPgDatabase] = useState('postgres');
    const [pgUser, setPgUser] = useState('postgres');
    const [pgPassword, setPgPassword] = useState('');
    const [pgSslMode, setPgSslMode] = useState('disable');

    const [savedList, setSavedList] = useState<store.SavedConnection[]>([]);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ok: boolean; message: string} | null>(null);

    useEffect(() => {
        if (isOpen) {
            loadSaved();
            setError('');
            setTestResult(null);
        }
    }, [isOpen]);

    async function loadSaved() {
        try {
            const list = await ListSavedConnections();
            setSavedList(list ?? []);
        } catch (err) {
            console.error('Erro ao listar conexões:', err);
        }
    }

    if (!isOpen) return null;

    async function handlePickFile() {
        try {
            setError('');
            const selected = await PickSQLiteFile();
            if (selected) {
                setSqlitePath(selected);
                // Se o nome estiver vazio, sugere o nome do arquivo sem caminho e extensão
                if (!name.trim()) {
                    const filename = selected.split(/[/\\]/).pop() || '';
                    const baseName = filename.replace(/\.[^/.]+$/, '');
                    setName(baseName || 'SQLite');
                }
            }
        } catch (err) {
            setError(`Erro ao selecionar arquivo: ${err}`);
        }
    }

    function buildDsn(): {driver: string; dsn: string} | null {
        if (rawDsnMode) {
            if (!rawDsn.trim()) {
                setError('Cole a DSN/link de conexão completo.');
                return null;
            }
            return {driver, dsn: rawDsn.trim()};
        }

        if (driver === 'sqlite') {
            if (!sqlitePath.trim()) {
                setError('Escolha ou digite o caminho de um arquivo de banco SQLite.');
                return null;
            }
            return {driver: 'sqlite', dsn: sqlitePath.trim()};
        }

        // Postgres
        const host = pgHost.trim() || 'localhost';
        const port = pgPort.trim() || '5432';
        const db = pgDatabase.trim() || 'postgres';
        const user = pgUser.trim() || 'postgres';

        // Escapar usuário e senha obrigatoriamente para evitar quebra de parse de DSN
        const encUser = encodeURIComponent(user);
        const encPass = encodeURIComponent(pgPassword);
        const auth = encPass ? `${encUser}:${encPass}` : encUser;
        const ssl = pgSslMode || 'disable';

        const dsn = `postgres://${auth}@${host}:${port}/${db}?sslmode=${ssl}`;
        return {driver: 'postgres', dsn};
    }

    // Testa a conexão sem persistir nada — só abre e fecha. Existe pra dar
    // confiança antes de salvar (evita salvar uma conexão com erro de
    // digitação, ex. nome de banco errado).
    async function handleTest() {
        setError('');
        setTestResult(null);
        const built = buildDsn();
        if (!built) return;

        setTesting(true);
        try {
            await TestConnection(built.driver, built.dsn);
            setTestResult({ok: true, message: 'Conexão bem-sucedida.'});
        } catch (err) {
            setTestResult({ok: false, message: String(err)});
        } finally {
            setTesting(false);
        }
    }

    // Sempre valida a conexão antes de persistir (mesma checagem de
    // handleTest) — salvar uma conexão quebrada silenciosamente já causou
    // confusão real (precisava depois ir excluir manualmente na aba
    // "Conexões Salvas").
    async function handleSave(connectAfter = false) {
        setError('');
        const trimmedName = name.trim();
        if (!trimmedName) {
            setError('Informe um nome amigável para a conexão.');
            return;
        }

        const built = buildDsn();
        if (!built) return;

        setSaving(true);
        try {
            await TestConnection(built.driver, built.dsn);

            const newId = await SaveConnection(trimmedName, built.driver, built.dsn);
            onConnectionsChanged();

            if (connectAfter) {
                await ConnectSaved(tabId, newId);
                onConnected(newId, trimmedName);
                onClose();
            } else {
                // Limpa form e recarrega
                setName('');
                setSqlitePath('');
                setPgPassword('');
                setRawDsn('');
                setTestResult(null);
                await loadSaved();
                setActiveTab('manage');
            }
        } catch (err) {
            setError(`Erro ao conectar — nada foi salvo: ${err}`);
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete(id: string) {
        try {
            await DeleteSavedConnection(id);
            await loadSaved();
            onConnectionsChanged();
        } catch (err) {
            setError(`Erro ao remover conexão: ${err}`);
        }
    }

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-container" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <div className="modal-title-group">
                        <h2 className="modal-title">Gerenciar Conexões</h2>
                        <span className="modal-subtitle">Configure ou gerencie suas fontes de dados salvas com segurança</span>
                    </div>
                    <button className="modal-close-btn" onClick={onClose} title="Fechar">✕</button>
                </div>

                <div className="modal-tabs">
                    <button
                        className={`modal-tab-btn ${activeTab === 'new' ? 'active' : ''}`}
                        onClick={() => setActiveTab('new')}
                    >
                        + Nova Conexão
                    </button>
                    <button
                        className={`modal-tab-btn ${activeTab === 'manage' ? 'active' : ''}`}
                        onClick={() => setActiveTab('manage')}
                    >
                        Conexões Salvas ({savedList.length})
                    </button>
                </div>

                {error && (
                    <div className="modal-error-banner">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        <span>{error}</span>
                    </div>
                )}

                {activeTab === 'new' ? (
                    <div className="modal-body">
                        <div className="form-group">
                            <label className="form-label">Tipo de Banco (Driver)</label>
                            <div className="driver-selector-pills">
                                <button
                                    type="button"
                                    className={`driver-pill-btn ${driver === 'sqlite' ? 'active' : ''}`}
                                    onClick={() => {setDriver('sqlite'); setTestResult(null);}}
                                >
                                    <span className="driver-pill-title">SQLite</span>
                                    <span className="driver-pill-desc">Arquivo local (.db, .sqlite)</span>
                                </button>
                                <button
                                    type="button"
                                    className={`driver-pill-btn ${driver === 'postgres' ? 'active' : ''}`}
                                    onClick={() => {setDriver('postgres'); setTestResult(null);}}
                                >
                                    <span className="driver-pill-title">PostgreSQL</span>
                                    <span className="driver-pill-desc">Servidor de banco relacional</span>
                                </button>
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Nome da Conexão *</label>
                            <input
                                className="input-control modal-input"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="Ex: Produção, Local Dev, Chinook..."
                                autoFocus
                            />
                        </div>

                        <div className="form-group">
                            <button
                                type="button"
                                className="raw-dsn-toggle"
                                onClick={() => {setRawDsnMode(v => !v); setTestResult(null); setError('');}}
                            >
                                {rawDsnMode ? '← Voltar a preencher campos separados' : 'Prefere colar a DSN/link de conexão direto? →'}
                            </button>
                        </div>

                        {rawDsnMode ? (
                            <div className="form-group">
                                <label className="form-label">
                                    DSN de Conexão Completa *
                                </label>
                                <input
                                    className="input-control modal-input"
                                    value={rawDsn}
                                    onChange={e => setRawDsn(e.target.value)}
                                    placeholder={driver === 'sqlite'
                                        ? '/caminho/para/banco.db'
                                        : 'postgres://usuario:senha@host:5432/banco?sslmode=disable'}
                                />
                                <span className="form-hint">
                                    {driver === 'sqlite'
                                        ? 'Caminho absoluto do arquivo SQLite.'
                                        : 'Link completo de conexão — usuário e senha com caracteres especiais devem estar url-encoded.'}
                                </span>
                            </div>
                        ) : driver === 'sqlite' ? (
                            <div className="form-group">
                                <label className="form-label">Arquivo de Banco SQLite *</label>
                                <div className="file-picker-field">
                                    <input
                                        className="input-control modal-input file-path-input"
                                        value={sqlitePath}
                                        onChange={e => setSqlitePath(e.target.value)}
                                        placeholder="Nenhum arquivo selecionado ou digite o caminho..."
                                    />
                                    <button
                                        type="button"
                                        className="btn btn-secondary file-picker-btn"
                                        onClick={handlePickFile}
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                                        </svg>
                                        Procurar arquivo...
                                    </button>
                                </div>
                                <span className="form-hint">Use o seletor nativo ou digite o caminho manualmente.</span>
                            </div>
                        ) : (
                            <div className="postgres-form-grid">
                                <div className="form-group col-span-8">
                                    <label className="form-label">Host *</label>
                                    <input
                                        className="input-control modal-input"
                                        value={pgHost}
                                        onChange={e => setPgHost(e.target.value)}
                                        placeholder="localhost ou db.exemplo.com"
                                    />
                                </div>
                                <div className="form-group col-span-4">
                                    <label className="form-label">Porta *</label>
                                    <input
                                        className="input-control modal-input"
                                        value={pgPort}
                                        onChange={e => setPgPort(e.target.value)}
                                        placeholder="5432"
                                    />
                                </div>
                                <div className="form-group col-span-12">
                                    <label className="form-label">Banco de Dados (Database) *</label>
                                    <input
                                        className="input-control modal-input"
                                        value={pgDatabase}
                                        onChange={e => setPgDatabase(e.target.value)}
                                        placeholder="postgres"
                                    />
                                </div>
                                <div className="form-group col-span-6">
                                    <label className="form-label">Usuário *</label>
                                    <input
                                        className="input-control modal-input"
                                        value={pgUser}
                                        onChange={e => setPgUser(e.target.value)}
                                        placeholder="postgres"
                                    />
                                </div>
                                <div className="form-group col-span-6">
                                    <label className="form-label">Senha</label>
                                    <input
                                        type="password"
                                        className="input-control modal-input"
                                        value={pgPassword}
                                        onChange={e => setPgPassword(e.target.value)}
                                        placeholder="••••••••"
                                    />
                                </div>
                                <div className="form-group col-span-12">
                                    <label className="form-label">Modo SSL</label>
                                    <select
                                        className="input-control modal-select"
                                        value={pgSslMode}
                                        onChange={e => setPgSslMode(e.target.value)}
                                    >
                                        <option value="disable">disable (desativado / local)</option>
                                        <option value="require">require (exigir TLS/SSL)</option>
                                        <option value="prefer">prefer (tentar SSL se disponível)</option>
                                    </select>
                                </div>
                            </div>
                        )}

                        {testResult && (
                            <div className={`test-result-banner ${testResult.ok ? 'ok' : 'error'}`}>
                                {testResult.ok ? '✓' : '✕'} {testResult.message}
                            </div>
                        )}

                        <div className="modal-footer">
                            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
                                Cancelar
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={handleTest}
                                disabled={saving || testing}
                                title="Testa a conexão sem salvar nada"
                            >
                                {testing ? 'Testando...' : 'Testar conexão'}
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => handleSave(false)}
                                disabled={saving || testing}
                            >
                                {saving ? 'Salvando...' : 'Salvar'}
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={() => handleSave(true)}
                                disabled={saving || testing}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M12 2v8M4.93 10.93l1.41 1.41M2 18h2M20 18h2M19.07 10.93l-1.41 1.41M22 22H2M15 15l4 4M9 15l-4 4" />
                                </svg>
                                {saving ? 'Conectando...' : 'Salvar e Conectar'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="modal-body">
                        {savedList.length === 0 ? (
                            <div className="modal-empty-state">
                                <p>Nenhuma conexão salva encontrada.</p>
                                <button
                                    type="button"
                                    className="btn btn-primary"
                                    onClick={() => setActiveTab('new')}
                                    style={{marginTop: '12px'}}
                                >
                                    + Criar Primeira Conexão
                                </button>
                            </div>
                        ) : (
                            <div className="saved-manage-list">
                                {savedList.map(c => (
                                    <div key={c.ID} className="saved-manage-item">
                                        <div className="saved-manage-info">
                                            <span className="driver-pill">{c.Driver}</span>
                                            <span className="saved-manage-name">{c.Name}</span>
                                        </div>
                                        <div className="saved-manage-actions">
                                            <button
                                                type="button"
                                                className="btn btn-primary btn-sm"
                                                onClick={async () => {
                                                    await ConnectSaved(tabId, c.ID);
                                                    onConnected(c.ID, c.Name);
                                                    onClose();
                                                }}
                                            >
                                                Conectar
                                            </button>
                                            <button
                                                type="button"
                                                className="btn btn-danger btn-sm"
                                                onClick={() => handleDelete(c.ID)}
                                                title="Excluir conexão salva"
                                            >
                                                Excluir
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="modal-footer" style={{marginTop: '20px'}}>
                            <button type="button" className="btn btn-secondary" onClick={onClose}>
                                Fechar
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
