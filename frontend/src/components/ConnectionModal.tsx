import {useState, useEffect} from 'react';
import {useTranslation} from 'react-i18next';
import {
    SaveConnection,
    SaveConnectionWithSSH,
    DeleteSavedConnection,
    GetConnectionForEdit,
    PickSQLiteFile,
    PickSSHKeyFile,
    ListSavedConnections,
    TestConnection,
    TestConnectionWithSSH,
} from '../../wailsjs/go/main/App';
import {ConnectSaved} from '../lib/tabApi';
import type {store, sshtunnel} from '../../wailsjs/go/models';

type DriverKind = 'sqlite' | 'postgres' | 'mysql' | 'mariadb';

interface Props {
    isOpen: boolean;
    tabId: string;
    onClose: () => void;
    onConnected: (connectionId: string, name: string, driver: string) => void;
    onConnectionsChanged: () => void;
    // When set, the modal opens with the given connection's DSN pre-filled in raw-DSN
    // mode for the clone flow. The caller (ConnectionBar) is responsible for setting it
    // and clearing it after the modal closes — the modal itself never modifies it.
    cloneSourceId?: string;
    // Fired when the user clicks "Clonar" on a saved connection in the manage tab.
    // Caller (ConnectionBar) sets cloneSourceId + opens the modal in response.
    onCloneRequest?: (connectionId: string) => void;
}

export default function ConnectionModal({isOpen, tabId, onClose, onConnected, onConnectionsChanged, cloneSourceId, onCloneRequest}: Props) {
    const {t} = useTranslation();
    const [activeTab, setActiveTab] = useState<'new' | 'manage'>('new');
    const [driver, setDriver] = useState<DriverKind>('sqlite');
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

    // MySQL/MariaDB states — mesmo layout do Postgres, mas porta/SSL/sintaxe DSN
    // diferentes. MariaDB compartilha o driver (factory retorna o mesmo), então
    // os campos são idênticos aqui; só muda o nome do driver salvo.
    const [mysqlHost, setMysqlHost] = useState('localhost');
    const [mysqlPort, setMysqlPort] = useState('3306');
    const [mysqlDatabase, setMysqlDatabase] = useState('');
    const [mysqlUser, setMysqlUser] = useState('root');
    const [mysqlPassword, setMysqlPassword] = useState('');
    // MySQL sslmode preferido: 'preferred' (tenta TLS, cai pra sem-TLS) — mesma
    // justificativa do Postgres 'prefer'. Valores aceitos pelo driver: true,
    // false, preferred, required, skip-verify.
    const [mysqlSslMode, setMysqlSslMode] = useState('preferred');

    // SSH Tunnel states (Bastion host)
    const [sshEnabled, setSshEnabled] = useState(false);
    const [sshHost, setSshHost] = useState('');
    const [sshPort, setSshPort] = useState('22');
    const [sshUser, setSshUser] = useState('');
    const [sshAuthMethod, setSshAuthMethod] = useState<'key_file' | 'password' | 'agent'>('key_file');
    const [sshPassword, setSshPassword] = useState('');
    const [sshKeyPath, setSshKeyPath] = useState('');
    const [sshKeyPassphrase, setSshKeyPassphrase] = useState('');

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

    // Clone flow: when the caller hands us a connection ID, fetch its driver+DSN and
    // pre-fill the form so the user only edits the fields that actually differ (typically
    // host/port). The decrypted DSN is only ever shown in raw-DSN mode — keeps the
    // credential handling simple and consistent with the manual-entry UX.
    useEffect(() => {
        if (!isOpen || !cloneSourceId) return;
        let cancelled = false;
        (async () => {
            try {
                const edit = await GetConnectionForEdit(cloneSourceId);
                if (cancelled) return;
                setDriver(edit.driver as DriverKind);
                setRawDsn(edit.dsn);
                setRawDsnMode(true);
                if (edit.ssh && edit.ssh.enabled) {
                    setSshEnabled(true);
                    setSshHost(edit.ssh.host || '');
                    setSshPort(String(edit.ssh.port || 22));
                    setSshUser(edit.ssh.user || '');
                    setSshAuthMethod((edit.ssh.authMethod as any) || 'key_file');
                    setSshPassword(edit.ssh.password || '');
                    setSshKeyPath(edit.ssh.keyPath || '');
                    setSshKeyPassphrase(edit.ssh.keyPassphrase || '');
                } else {
                    setSshEnabled(false);
                }
                // Sugere nome como "<original> (cópia)" — usado como placeholder
                // visível, o usuário digita o nome final ao salvar.
                const src = savedList.find(c => c.ID === cloneSourceId);
                if (src) setName(`${src.Name} (cópia)`);
                setError('');
                setActiveTab('new');
            } catch (err) {
                if (!cancelled) setError(t('connectionModal.errorCloneLoad', {error: String(err)}));
            }
        })();
        return () => { cancelled = true; };
    }, [isOpen, cloneSourceId, savedList, t]);

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
            // MySQL/MariaDB não têm formato de URL oficial — o raw DSN é o formato
            // `user:pass@tcp(host:port)/db` do driver. Não dá pra validar com regex
            // simples sem falso-positivo; deixamos passar e o driver reclama se errado.
            return {driver, dsn: trimmedDsn};
        }

        if (driver === 'sqlite') {
            if (!sqlitePath.trim()) {
                setError(t('connectionModal.errorSqlitePath'));
                return null;
            }
            return {driver: 'sqlite', dsn: sqlitePath.trim()};
        }

        if (driver === 'mysql' || driver === 'mariadb') {
            const host = mysqlHost.trim() || 'localhost';
            const port = mysqlPort.trim() || '3306';
            const db = mysqlDatabase.trim();
            if (!db) {
                setError(t('connectionModal.errorMysqlDatabase'));
                return null;
            }
            const encUser = encodeURIComponent(mysqlUser.trim() || 'root');
            const encPass = encodeURIComponent(mysqlPassword);
            const auth = encPass ? `${encUser}:${encPass}` : encUser;
            // parseTime=true é OBRIGATÓRIO — sem isso colunas DATE/DATETIME viram
            // []byte no JSON IPC e ficam ilegíveis no grid (mesma lição documentada
            // no ADR 0007 pro backend).
            const ssl = mysqlSslMode || 'preferred';
            const dsn = `${auth}@tcp(${host}:${port})/${db}?parseTime=true&tls=${ssl}`;
            return {driver, dsn};
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

    async function handlePickSSHKeyFile() {
        try {
            setError('');
            const selected = await PickSSHKeyFile();
            if (selected) {
                setSshKeyPath(selected);
            }
        } catch (err) {
            setError(t('connectionModal.pickKeyError', {error: String(err)}));
        }
    }

    function buildSshConfig(): sshtunnel.SSHConfig | null {
        if (!sshEnabled || driver === 'sqlite') {
            return {
                enabled: false,
                host: '',
                port: 22,
                user: '',
                authMethod: 'password',
            } as sshtunnel.SSHConfig;
        }

        const host = sshHost.trim();
        if (!host) {
            setError(t('connectionModal.errorSshHost'));
            return null;
        }
        const user = sshUser.trim();
        if (!user) {
            setError(t('connectionModal.errorSshUser'));
            return null;
        }
        const port = parseInt(sshPort, 10) || 22;

        if (sshAuthMethod === 'key_file') {
            const keyPath = sshKeyPath.trim();
            if (!keyPath) {
                setError(t('connectionModal.errorSshKeyPath'));
                return null;
            }
            return {
                enabled: true,
                host,
                port,
                user,
                authMethod: 'key_file',
                keyPath,
                keyPassphrase: sshKeyPassphrase,
            } as sshtunnel.SSHConfig;
        }

        if (sshAuthMethod === 'agent') {
            return {
                enabled: true,
                host,
                port,
                user,
                authMethod: 'agent',
            } as sshtunnel.SSHConfig;
        }

        // password
        return {
            enabled: true,
            host,
            port,
            user,
            authMethod: 'password',
            password: sshPassword,
        } as sshtunnel.SSHConfig;
    }

    // Testa a conexão sem persistir nada — só abre e fecha. Existe pra dar
    // confiança antes de salvar (evita salvar uma conexão com erro de
    // digitação, ex. nome de banco errado).
    async function handleTest() {
        setError('');
        setTestResult(null);
        const built = buildDsn();
        if (!built) return;

        const sshCfg = buildSshConfig();
        if (!sshCfg) return;

        setTesting(true);
        try {
            await TestConnectionWithSSH(built.driver, built.dsn, sshCfg);
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

        const sshCfg = buildSshConfig();
        if (!sshCfg) return;

        setSaving(true);
        try {
            await TestConnectionWithSSH(built.driver, built.dsn, sshCfg);

            const newId = await SaveConnectionWithSSH(trimmedName, built.driver, built.dsn, sshCfg);
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
                setMysqlPassword('');
                setRawDsn('');
                setSshEnabled(false);
                setSshHost('');
                setSshPort('22');
                setSshUser('');
                setSshAuthMethod('key_file');
                setSshPassword('');
                setSshKeyPath('');
                setSshKeyPassphrase('');
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
                                <button
                                    type="button"
                                    className={`driver-pill-btn ${driver === 'mysql' ? 'active' : ''}`}
                                    onClick={() => {setDriver('mysql'); setTestResult(null);}}
                                >
                                    <span className="driver-pill-title">MySQL</span>
                                    <span className="driver-pill-desc">{t('connectionModal.mysqlDesc')}</span>
                                </button>
                                <button
                                    type="button"
                                    className={`driver-pill-btn ${driver === 'mariadb' ? 'active' : ''}`}
                                    onClick={() => {setDriver('mariadb'); setTestResult(null);}}
                                >
                                    <span className="driver-pill-title">MariaDB</span>
                                    <span className="driver-pill-desc">{t('connectionModal.mariadbDesc')}</span>
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
                                        : driver === 'postgres'
                                            ? t('connectionModal.rawDsnPlaceholderPostgres')
                                            : t('connectionModal.rawDsnPlaceholderMysql')}
                                />
                                <span className="form-hint">
                                    {driver === 'sqlite'
                                        ? t('connectionModal.rawDsnHintSqlite')
                                        : driver === 'postgres'
                                            ? t('connectionModal.rawDsnHintPostgres')
                                            : t('connectionModal.rawDsnHintMysql')}
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
                        ) : driver === 'postgres' ? (
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
                        ) : (
                            // MySQL / MariaDB — mesmo form, sslmode usa os valores do
                            // go-sql-driver/mysql (preferred em vez de prefer). parseTime=true
                            // é sempre adicionado ao DSN construído (ADR 0007).
                            <div className="postgres-form-grid">
                                <div className="form-group col-span-8">
                                    <label className="form-label">{t('connectionModal.hostLabel')}</label>
                                    <input
                                        className="input-control modal-input"
                                        value={mysqlHost}
                                        onChange={e => setMysqlHost(e.target.value)}
                                        placeholder={t('connectionModal.hostPlaceholder')}
                                    />
                                </div>
                                <div className="form-group col-span-4">
                                    <label className="form-label">{t('connectionModal.portLabel')}</label>
                                    <input
                                        className="input-control modal-input"
                                        value={mysqlPort}
                                        onChange={e => setMysqlPort(e.target.value)}
                                        placeholder="3306"
                                    />
                                </div>
                                <div className="form-group col-span-12">
                                    <label className="form-label">{t('connectionModal.databaseLabel')}</label>
                                    <input
                                        className="input-control modal-input"
                                        value={mysqlDatabase}
                                        onChange={e => setMysqlDatabase(e.target.value)}
                                        placeholder="myapp"
                                    />
                                </div>
                                <div className="form-group col-span-6">
                                    <label className="form-label">{t('connectionModal.userLabel')}</label>
                                    <input
                                        className="input-control modal-input"
                                        value={mysqlUser}
                                        onChange={e => setMysqlUser(e.target.value)}
                                        placeholder="root"
                                    />
                                </div>
                                <div className="form-group col-span-6">
                                    <label className="form-label">{t('connectionModal.passwordLabel')}</label>
                                    <input
                                        type="password"
                                        className="input-control modal-input"
                                        value={mysqlPassword}
                                        onChange={e => setMysqlPassword(e.target.value)}
                                        placeholder="••••••••"
                                    />
                                </div>
                                <div className="form-group col-span-12">
                                    <label className="form-label">{t('connectionModal.sslLabel')}</label>
                                    <select
                                        className="input-control modal-select"
                                        value={mysqlSslMode}
                                        onChange={e => setMysqlSslMode(e.target.value)}
                                    >
                                        <option value="false">{t('connectionModal.sslDisable')}</option>
                                        <option value="preferred">{t('connectionModal.sslPrefer')}</option>
                                        <option value="required">{t('connectionModal.sslRequire')}</option>
                                        <option value="skip-verify">{t('connectionModal.sslSkipVerify')}</option>
                                    </select>
                                </div>
                            </div>
                        )}

                        {driver !== 'sqlite' && (
                            <div className="ssh-tunnel-section" style={{marginTop: '16px', borderTop: '1px solid var(--color-border, rgba(255,255,255,0.08))', paddingTop: '12px'}}>
                                <div className="ssh-tunnel-header">
                                    <label style={{display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 500}}>
                                        <input
                                            type="checkbox"
                                            checked={sshEnabled}
                                            onChange={e => setSshEnabled(e.target.checked)}
                                        />
                                        <span>{t('connectionModal.sshEnable')}</span>
                                    </label>
                                </div>

                                {sshEnabled && (
                                    <div className="postgres-form-grid" style={{marginTop: '12px', padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px', border: '1px solid rgba(255, 255, 255, 0.06)'}}>
                                        <div className="form-group col-span-8">
                                            <label className="form-label">{t('connectionModal.sshHostLabel')}</label>
                                            <input
                                                className="input-control modal-input"
                                                value={sshHost}
                                                onChange={e => setSshHost(e.target.value)}
                                                placeholder="bastion.exemplo.com"
                                            />
                                        </div>
                                        <div className="form-group col-span-4">
                                            <label className="form-label">{t('connectionModal.sshPortLabel')}</label>
                                            <input
                                                className="input-control modal-input"
                                                value={sshPort}
                                                onChange={e => setSshPort(e.target.value)}
                                                placeholder="22"
                                            />
                                        </div>
                                        <div className="form-group col-span-6">
                                            <label className="form-label">{t('connectionModal.sshUserLabel')}</label>
                                            <input
                                                className="input-control modal-input"
                                                value={sshUser}
                                                onChange={e => setSshUser(e.target.value)}
                                                placeholder="ubuntu"
                                            />
                                        </div>
                                        <div className="form-group col-span-6">
                                            <label className="form-label">{t('connectionModal.sshAuthLabel')}</label>
                                            <select
                                                className="input-control modal-select"
                                                value={sshAuthMethod}
                                                onChange={e => setSshAuthMethod(e.target.value as any)}
                                            >
                                                <option value="key_file">{t('connectionModal.sshAuthKeyFile')}</option>
                                                <option value="password">{t('connectionModal.sshAuthPassword')}</option>
                                                <option value="agent">{t('connectionModal.sshAuthAgent')}</option>
                                            </select>
                                        </div>

                                        {sshAuthMethod === 'key_file' && (
                                            <>
                                                <div className="form-group col-span-12">
                                                    <label className="form-label">{t('connectionModal.sshKeyPathLabel')}</label>
                                                    <div style={{display: 'flex', gap: '8px'}}>
                                                        <input
                                                            className="input-control modal-input"
                                                            style={{flex: 1}}
                                                            value={sshKeyPath}
                                                            onChange={e => setSshKeyPath(e.target.value)}
                                                            placeholder="~/.ssh/id_ed25519"
                                                        />
                                                        <button
                                                            type="button"
                                                            className="btn btn-secondary"
                                                            onClick={handlePickSSHKeyFile}
                                                            title={t('connectionModal.sshPickKeyTitle')}
                                                        >
                                                            {t('connectionModal.browse')}
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="form-group col-span-12">
                                                    <label className="form-label">{t('connectionModal.sshPassphraseLabel')}</label>
                                                    <input
                                                        type="password"
                                                        className="input-control modal-input"
                                                        value={sshKeyPassphrase}
                                                        onChange={e => setSshKeyPassphrase(e.target.value)}
                                                        placeholder={t('connectionModal.sshPassphrasePlaceholder')}
                                                    />
                                                </div>
                                            </>
                                        )}

                                        {sshAuthMethod === 'password' && (
                                            <div className="form-group col-span-12">
                                                <label className="form-label">{t('connectionModal.sshPasswordLabel')}</label>
                                                <input
                                                    type="password"
                                                    className="input-control modal-input"
                                                    value={sshPassword}
                                                    onChange={e => setSshPassword(e.target.value)}
                                                    placeholder="••••••••"
                                                />
                                            </div>
                                        )}

                                        {sshAuthMethod === 'agent' && (
                                            <div className="form-group col-span-12" style={{fontSize: '12px', color: 'var(--color-text-muted, #888)'}}>
                                                {t('connectionModal.sshAgentNote')}
                                            </div>
                                        )}
                                    </div>
                                )}
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
                                                className="btn btn-secondary btn-sm"
                                                onClick={() => onCloneRequest?.(c.ID)}
                                                title={t('connectionModal.cloneTitle')}
                                            >
                                                {t('connectionModal.clone')}
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
