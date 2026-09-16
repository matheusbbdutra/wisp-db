import {useState, useEffect} from 'react';
import {useTranslation} from 'react-i18next';
import {SaveConnection, DeleteSavedConnection, PickSQLiteFile, ListSavedConnections, TestConnection} from '../../wailsjs/go/main/App';
import {ConnectSaved} from '../lib/tabApi';
import type {store} from '../../wailsjs/go/models';

interface Props {
    isOpen: boolean;
    tabId: string;
    onClose: () => void;
    onConnected: (connectionId: string, name: string, driver: string) => void;
    onConnectionsChanged: () => void;
}

export default function ConnectionModal({isOpen, tabId, onClose, onConnected, onConnectionsChanged}: Props) {
    const {t} = useTranslation();
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
    // Padrão 'prefer' (tenta TLS, cai pra sem-TLS se o servidor não
    // suportar) em vez de 'disable' — achado de auditoria de segurança:
    // 'disable' como padrão facilita esquecer de habilitar TLS numa conexão
    // remota nova (localhost não é afetado, TLS não faz diferença ali).
    // Nunca quebra conexão já salva — só muda o padrão de conexões NOVAS.
    const [pgSslMode, setPgSslMode] = useState('prefer');

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
            setError(t('connectionModal.pickFileError', {error: String(err)}));
        }
    }

    function buildDsn(): {driver: string; dsn: string} | null {
        if (rawDsnMode) {
            const trimmedDsn = rawDsn.trim();
            if (!trimmedDsn) {
                setError(t('connectionModal.errorRawDsnEmpty'));
                return null;
            }
            if (driver === 'postgres' && !/^postgres(ql)?:\/\//i.test(trimmedDsn)) {
                setError(t('connectionModal.errorPostgresDsnFormat'));
                return null;
            }
            return {driver, dsn: trimmedDsn};
        }

        if (driver === 'sqlite') {
            if (!sqlitePath.trim()) {
                setError(t('connectionModal.errorSqlitePath'));
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
            setTestResult({ok: true, message: t('connectionModal.testSuccess')});
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
            setError(t('connectionModal.errorNameRequired'));
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
                onConnected(newId, trimmedName, built.driver);
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
            setError(t('connectionModal.saveError', {error: String(err)}));
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
            setError(t('connectionModal.deleteError', {error: String(err)}));
        }
    }

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-container" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <div className="modal-title-group">
                        <h2 className="modal-title">{t('connectionModal.title')}</h2>
                        <span className="modal-subtitle">{t('connectionModal.subtitle')}</span>
                    </div>
                    <button className="modal-close-btn" onClick={onClose} title={t('connectionModal.closeTitle')}>✕</button>
                </div>

                <div className="modal-tabs">
                    <button
                        className={`modal-tab-btn ${activeTab === 'new' ? 'active' : ''}`}
                        onClick={() => setActiveTab('new')}
                    >
                        {t('connectionModal.tabNew')}
                    </button>
                    <button
                        className={`modal-tab-btn ${activeTab === 'manage' ? 'active' : ''}`}
                        onClick={() => setActiveTab('manage')}
                    >
                        {t('connectionModal.tabManage', {count: savedList.length})}
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
                            <label className="form-label">{t('connectionModal.driverLabel')}</label>
                            <div className="driver-selector-pills">
                                <button
                                    type="button"
                                    className={`driver-pill-btn ${driver === 'sqlite' ? 'active' : ''}`}
                                    onClick={() => {setDriver('sqlite'); setTestResult(null);}}
                                >
                                    <span className="driver-pill-title">SQLite</span>
                                    <span className="driver-pill-desc">{t('connectionModal.sqliteDesc')}</span>
                                </button>
                                <button
                                    type="button"
                                    className={`driver-pill-btn ${driver === 'postgres' ? 'active' : ''}`}
                                    onClick={() => {setDriver('postgres'); setTestResult(null);}}
                                >
                                    <span className="driver-pill-title">PostgreSQL</span>
                                    <span className="driver-pill-desc">{t('connectionModal.postgresDesc')}</span>
                                </button>
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">{t('connectionModal.nameLabel')}</label>
                            <input
                                className="input-control modal-input"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder={t('connectionModal.namePlaceholder')}
                                autoFocus
                            />
                        </div>

                        <div className="form-group">
                            <button
                                type="button"
                                className="raw-dsn-toggle"
                                onClick={() => {setRawDsnMode(v => !v); setTestResult(null); setError('');}}
                            >
                                {rawDsnMode ? t('connectionModal.rawDsnBack') : t('connectionModal.rawDsnToggle')}
                            </button>
                        </div>

                        {rawDsnMode ? (
                            <div className="form-group">
                                <label className="form-label">
                                    {t('connectionModal.rawDsnLabel')}
                                </label>
                                <input
                                    className="input-control modal-input"
                                    value={rawDsn}
                                    onChange={e => setRawDsn(e.target.value)}
                                    placeholder={driver === 'sqlite'
                                        ? t('connectionModal.rawDsnPlaceholderSqlite')
                                        : t('connectionModal.rawDsnPlaceholderPostgres')}
                                />
                                <span className="form-hint">
                                    {driver === 'sqlite'
                                        ? t('connectionModal.rawDsnHintSqlite')
                                        : t('connectionModal.rawDsnHintPostgres')}
                                </span>
                            </div>
                        ) : driver === 'sqlite' ? (
                            <div className="form-group">
                                <label className="form-label">{t('connectionModal.sqliteFileLabel')}</label>
                                <div className="file-picker-field">
                                    <input
                                        className="input-control modal-input file-path-input"
                                        value={sqlitePath}
                                        onChange={e => setSqlitePath(e.target.value)}
                                        placeholder={t('connectionModal.sqliteFilePlaceholder')}
                                    />
                                    <button
                                        type="button"
                                        className="btn btn-secondary file-picker-btn"
                                        onClick={handlePickFile}
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                                        </svg>
                                        {t('connectionModal.browseFile')}
                                    </button>
                                </div>
                                <span className="form-hint">{t('connectionModal.sqliteFileHint')}</span>
                            </div>
                        ) : (
                            <div className="postgres-form-grid">
                                <div className="form-group col-span-8">
                                    <label className="form-label">{t('connectionModal.hostLabel')}</label>
                                    <input
                                        className="input-control modal-input"
                                        value={pgHost}
                                        onChange={e => setPgHost(e.target.value)}
                                        placeholder={t('connectionModal.hostPlaceholder')}
                                    />
                                </div>
                                <div className="form-group col-span-4">
                                    <label className="form-label">{t('connectionModal.portLabel')}</label>
                                    <input
                                        className="input-control modal-input"
                                        value={pgPort}
                                        onChange={e => setPgPort(e.target.value)}
                                        placeholder="5432"
                                    />
                                </div>
                                <div className="form-group col-span-12">
                                    <label className="form-label">{t('connectionModal.databaseLabel')}</label>
                                    <input
                                        className="input-control modal-input"
                                        value={pgDatabase}
                                        onChange={e => setPgDatabase(e.target.value)}
                                        placeholder="postgres"
                                    />
                                </div>
                                <div className="form-group col-span-6">
                                    <label className="form-label">{t('connectionModal.userLabel')}</label>
                                    <input
                                        className="input-control modal-input"
                                        value={pgUser}
                                        onChange={e => setPgUser(e.target.value)}
                                        placeholder="postgres"
                                    />
                                </div>
                                <div className="form-group col-span-6">
                                    <label className="form-label">{t('connectionModal.passwordLabel')}</label>
                                    <input
                                        type="password"
                                        className="input-control modal-input"
                                        value={pgPassword}
                                        onChange={e => setPgPassword(e.target.value)}
                                        placeholder="••••••••"
                                    />
                                </div>
                                <div className="form-group col-span-12">
                                    <label className="form-label">{t('connectionModal.sslLabel')}</label>
                                    <select
                                        className="input-control modal-select"
                                        value={pgSslMode}
                                        onChange={e => setPgSslMode(e.target.value)}
                                    >
                                        <option value="disable">{t('connectionModal.sslDisable')}</option>
                                        <option value="require">{t('connectionModal.sslRequire')}</option>
                                        <option value="prefer">{t('connectionModal.sslPrefer')}</option>
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
                                {t('connectionModal.cancel')}
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={handleTest}
                                disabled={saving || testing}
                                title={t('connectionModal.testTitle')}
                            >
                                {testing ? t('connectionModal.testing') : t('connectionModal.test')}
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => handleSave(false)}
                                disabled={saving || testing}
                            >
                                {saving ? t('connectionModal.saving') : t('connectionModal.save')}
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
                                {saving ? t('connectionModal.connecting') : t('connectionModal.saveAndConnect')}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="modal-body">
                        {savedList.length === 0 ? (
                            <div className="modal-empty-state">
                                <p>{t('connectionModal.emptySaved')}</p>
                                <button
                                    type="button"
                                    className="btn btn-primary"
                                    onClick={() => setActiveTab('new')}
                                    style={{marginTop: '12px'}}
                                >
                                    {t('connectionModal.createFirst')}
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
                                                    onConnected(c.ID, c.Name, c.Driver);
                                                    onClose();
                                                }}
                                            >
                                                {t('connectionModal.connect')}
                                            </button>
                                            <button
                                                type="button"
                                                className="btn btn-danger btn-sm"
                                                onClick={() => handleDelete(c.ID)}
                                                title={t('connectionModal.deleteTitle')}
                                            >
                                                {t('connectionModal.delete')}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="modal-footer" style={{marginTop: '20px'}}>
                            <button type="button" className="btn btn-secondary" onClick={onClose}>
                                {t('connectionModal.close')}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
