import {useState, useEffect, useLayoutEffect, useRef} from 'react';
import {useTranslation} from 'react-i18next';
import type {Dialect} from '../lib/sqlDialect';
import {qualifyTable, quoteIdent} from '../lib/sqlDialect';
import {
    generateSelect,
    generateInsert,
    generateUpdate,
    generateDelete,
    generateCreateTable,
} from '../lib/sqlGenerator';
import {IntrospectTable, GetTableDDL, RunQuery} from '../lib/tabApi';
import {copyToClipboard} from '../lib/gridCopyFormats';

export type SidebarContextTarget =
    | { type: 'schema'; schema: string }
    | { type: 'table'; schema: string; table: string }
    | { type: 'view'; schema: string; view: string };

export interface DangerModalState {
    type: 'truncate' | 'drop';
    schema: string;
    name: string;
    isView?: boolean;
}

interface SidebarContextMenuProps {
    x: number;
    y: number;
    target: SidebarContextTarget;
    tabId: string;
    dialect: Dialect;
    onClose: () => void;
    onInsertSql: (sql: string) => void;
    onOpenTable?: (schema: string, table: string) => void;
    onRefreshSchema?: (schema: string) => void;
    onRefreshAll?: () => void;
}

export default function SidebarContextMenu({
    x,
    y,
    target,
    tabId,
    dialect,
    onClose,
    onInsertSql,
    onOpenTable,
    onRefreshSchema,
    onRefreshAll,
}: SidebarContextMenuProps) {
    const {t} = useTranslation();
    const menuRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({x, y});
    const [dangerAction, setDangerAction] = useState<DangerModalState | null>(null);
    const [confirmInput, setConfirmInput] = useState('');
    const [executing, setExecuting] = useState(false);
    const [error, setError] = useState('');

    // Ajusta coordenadas para nunca vazar fora dos limites da janela
    useLayoutEffect(() => {
        if (!menuRef.current || dangerAction) return;
        const rect = menuRef.current.getBoundingClientRect();
        let nextX = x;
        let nextY = y;
        if (nextX + rect.width > window.innerWidth - 8) {
            nextX = Math.max(8, window.innerWidth - rect.width - 8);
        }
        if (nextY + rect.height > window.innerHeight - 8) {
            nextY = Math.max(8, window.innerHeight - rect.height - 8);
        }
        setPos({x: nextX, y: nextY});
    }, [x, y, dangerAction]);

    // Fecha o menu ao clicar fora, rolar ou pressionar Escape (quando modal não estiver ativo)
    useEffect(() => {
        if (dangerAction) return;

        function handlePointerDown(e: PointerEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        }
        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') {
                onClose();
            }
        }
        function handleScroll() {
            onClose();
        }

        window.addEventListener('pointerdown', handlePointerDown);
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('scroll', handleScroll, true);
        return () => {
            window.removeEventListener('pointerdown', handlePointerDown);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('scroll', handleScroll, true);
        };
    }, [dangerAction, onClose]);

    // Fecha modal de perigo com Escape
    useEffect(() => {
        if (!dangerAction) return;
        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape' && !executing) {
                onClose();
            }
        }
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [dangerAction, executing, onClose]);

    const targetName =
        target.type === 'schema'
            ? target.schema
            : target.type === 'table'
            ? target.table
            : target.view;

    async function handleCopyName() {
        await copyToClipboard(targetName);
        onClose();
    }

    async function handleCopyQualifiedName() {
        const qualified =
            target.type === 'schema'
                ? quoteIdent(target.schema, dialect)
                : qualifyTable(target.schema, targetName, dialect);
        await copyToClipboard(qualified);
        onClose();
    }

    function handleGenerateSelect() {
        const sql = generateSelect(target.schema, targetName, dialect);
        onInsertSql(sql);
        onClose();
    }

    async function handleGenerateInsert() {
        if (target.type !== 'table') return;
        try {
            const tableObj = await IntrospectTable(tabId, target.schema, target.table);
            const sql = generateInsert(target.schema, target.table, tableObj?.Columns ?? [], dialect);
            onInsertSql(sql);
            onClose();
        } catch (err) {
            console.error('Failed to introspect table for INSERT:', err);
        }
    }

    async function handleGenerateUpdate() {
        if (target.type !== 'table') return;
        try {
            const tableObj = await IntrospectTable(tabId, target.schema, target.table);
            const sql = generateUpdate(target.schema, target.table, tableObj?.Columns ?? [], dialect);
            onInsertSql(sql);
            onClose();
        } catch (err) {
            console.error('Failed to introspect table for UPDATE:', err);
        }
    }

    async function handleGenerateDelete() {
        if (target.type !== 'table') return;
        try {
            const tableObj = await IntrospectTable(tabId, target.schema, target.table);
            const pkCols = (tableObj?.Columns ?? []).filter(c => c.IsPrimaryKey).map(c => c.Name);
            const sql = generateDelete(target.schema, target.table, pkCols, dialect);
            onInsertSql(sql);
            onClose();
        } catch (err) {
            console.error('Failed to introspect table for DELETE:', err);
        }
    }

    async function handleGetDdl() {
        try {
            const ddl = await GetTableDDL(tabId, target.schema, targetName);
            if (ddl) {
                onInsertSql(ddl);
                onClose();
            }
        } catch (err) {
            console.error('Failed to get DDL:', err);
        }
    }

    function handleOpenTable() {
        if (target.type === 'table' && onOpenTable) {
            onOpenTable(target.schema, target.table);
            onClose();
        }
    }

    function handleRefreshSchema() {
        if (target.type === 'schema' && onRefreshSchema) {
            onRefreshSchema(target.schema);
            onClose();
        }
    }

    function handleNewTable() {
        if (target.type === 'schema') {
            const sql = generateCreateTable(target.schema, 'new_table', dialect);
            onInsertSql(sql);
            onClose();
        }
    }

    async function handleExecuteDanger() {
        if (!dangerAction) return;
        setExecuting(true);
        setError('');
        const dangerTarget = qualifyTable(dangerAction.schema, dangerAction.name, dialect);
        const dangerSql =
            dangerAction.type === 'truncate'
                ? dialect === 'sqlite'
                    ? `DELETE FROM ${dangerTarget};`
                    : `TRUNCATE TABLE ${dangerTarget};`
                : dangerAction.isView
                ? `DROP VIEW ${dangerTarget};`
                : `DROP TABLE ${dangerTarget};`;

        try {
            await RunQuery(tabId, dangerSql);
            if (onRefreshAll) {
                onRefreshAll();
            } else if (onRefreshSchema) {
                onRefreshSchema(dangerAction.schema);
            }
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setExecuting(false);
        }
    }

    // Se ação perigosa foi acionada, exibe o modal de confirmação segura
    if (dangerAction) {
        const dangerTarget = qualifyTable(dangerAction.schema, dangerAction.name, dialect);
        const dangerSql =
            dangerAction.type === 'truncate'
                ? dialect === 'sqlite'
                    ? `DELETE FROM ${dangerTarget};`
                    : `TRUNCATE TABLE ${dangerTarget};`
                : dangerAction.isView
                ? `DROP VIEW ${dangerTarget};`
                : `DROP TABLE ${dangerTarget};`;

        const isConfirmValid =
            dangerAction.type === 'truncate' ||
            confirmInput.trim() === dangerAction.name;

        return (
            <div className="modal-backdrop" onClick={onClose}>
                <div
                    className="modal-container"
                    onClick={e => e.stopPropagation()}
                    style={{maxWidth: 480}}
                >
                    <div className="modal-header">
                        <div className="modal-title-group">
                            <h2 className="modal-title">
                                {dangerAction.type === 'truncate'
                                    ? t('sidebar.truncateConfirmTitle')
                                    : t('sidebar.dropConfirmTitle', {
                                          kind: dangerAction.isView ? t('sidebar.view') : t('sidebar.table'),
                                      })}
                            </h2>
                            <span className="modal-subtitle">
                                {dangerAction.type === 'truncate'
                                    ? t('sidebar.truncateConfirmMessage', {table: dangerAction.name})
                                    : t('sidebar.dropConfirmMessage')}
                            </span>
                        </div>
                        <button
                            className="modal-close-btn"
                            onClick={onClose}
                            title={t('sidebar.cancel')}
                            disabled={executing}
                        >
                            ✕
                        </button>
                    </div>

                    <div className="modal-body">
                        {error && <div className="modal-error-banner" style={{marginBottom: 12}}>{error}</div>}

                        {dangerAction.type === 'drop' && (
                            <div style={{marginBottom: 12}}>
                                <div style={{fontWeight: 600, color: 'var(--text-main)', marginBottom: 6}}>
                                    <code>{dangerAction.name}</code>
                                </div>
                                <input
                                    className="input-control modal-input"
                                    autoFocus
                                    placeholder={t('sidebar.typeToConfirmPlaceholder')}
                                    value={confirmInput}
                                    onChange={e => setConfirmInput(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && isConfirmValid && !executing) {
                                            void handleExecuteDanger();
                                        }
                                    }}
                                    disabled={executing}
                                />
                            </div>
                        )}

                        <div style={{fontSize: '11px', color: 'var(--text-muted)', marginBottom: 4}}>
                            {t('sidebar.dangerPreview')}
                        </div>
                        <div className="sidebar-danger-sql-preview">
                            <code>{dangerSql}</code>
                        </div>

                        <div
                            className="modal-actions"
                            style={{marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end'}}
                        >
                            <button
                                className="btn btn-secondary"
                                onClick={onClose}
                                disabled={executing}
                            >
                                {t('sidebar.cancel')}
                            </button>
                            <button
                                className="btn btn-danger"
                                onClick={handleExecuteDanger}
                                disabled={!isConfirmValid || executing}
                            >
                                {executing
                                    ? t('sidebar.executing')
                                    : dangerAction.type === 'truncate'
                                    ? t('sidebar.truncateConfirmBtn')
                                    : t('sidebar.dropConfirmBtn', {
                                          kind: dangerAction.isView ? t('sidebar.view') : t('sidebar.table'),
                                      })}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            ref={menuRef}
            className="sidebar-context-menu"
            style={{top: pos.y, left: pos.x}}
            onClick={e => e.stopPropagation()}
        >
            {/* SCHEMA MENU */}
            {target.type === 'schema' && (
                <>
                    <button className="sidebar-context-menu-item" onClick={handleCopyName}>
                        📋 {t('sidebar.copyName')}
                    </button>
                    <button className="sidebar-context-menu-item" onClick={handleRefreshSchema}>
                        🔄 {t('sidebar.refreshSchemaAction')}
                    </button>
                    <button className="sidebar-context-menu-item" onClick={handleNewTable}>
                        ➕ {t('sidebar.newTableAction')}
                    </button>
                </>
            )}

            {/* TABLE MENU */}
            {target.type === 'table' && (
                <>
                    <button className="sidebar-context-menu-item" onClick={handleCopyName}>
                        📋 {t('sidebar.copyName')}
                    </button>
                    <button className="sidebar-context-menu-item" onClick={handleCopyQualifiedName}>
                        📋 {t('sidebar.copyQualifiedName')}
                    </button>

                    <div className="sidebar-context-menu-separator" />
                    <div className="sidebar-context-menu-group-label">{t('sidebar.generateSql')}</div>

                    <button className="sidebar-context-menu-item" onClick={handleGenerateSelect}>
                        🔍 {t('sidebar.generateSelect')}
                    </button>
                    <button className="sidebar-context-menu-item" onClick={handleGenerateInsert}>
                        📥 {t('sidebar.generateInsert')}
                    </button>
                    <button className="sidebar-context-menu-item" onClick={handleGenerateUpdate}>
                        ✏️ {t('sidebar.generateUpdate')}
                    </button>
                    <button className="sidebar-context-menu-item" onClick={handleGenerateDelete}>
                        🗑️ {t('sidebar.generateDelete')}
                    </button>
                    <button className="sidebar-context-menu-item" onClick={handleGetDdl}>
                        📄 {t('sidebar.createTableDdl')}
                    </button>

                    {onOpenTable && (
                        <>
                            <div className="sidebar-context-menu-separator" />
                            <button className="sidebar-context-menu-item" onClick={handleOpenTable}>
                                ↗️ {t('sidebar.openTableAction')}
                            </button>
                        </>
                    )}

                    <div className="sidebar-context-menu-separator" />
                    <div className="sidebar-context-menu-group-label sidebar-context-menu-item-danger">
                        {t('sidebar.dangerZone')}
                    </div>

                    <button
                        className="sidebar-context-menu-item sidebar-context-menu-item-danger"
                        onClick={() =>
                            setDangerAction({
                                type: 'truncate',
                                schema: target.schema,
                                name: target.table,
                            })
                        }
                    >
                        🧹 {t('sidebar.truncateTable')}
                    </button>
                    <button
                        className="sidebar-context-menu-item sidebar-context-menu-item-danger"
                        onClick={() =>
                            setDangerAction({
                                type: 'drop',
                                schema: target.schema,
                                name: target.table,
                                isView: false,
                            })
                        }
                    >
                        🗑️ {t('sidebar.dropTable')}
                    </button>
                </>
            )}

            {/* VIEW MENU */}
            {target.type === 'view' && (
                <>
                    <button className="sidebar-context-menu-item" onClick={handleCopyName}>
                        📋 {t('sidebar.copyName')}
                    </button>
                    <button className="sidebar-context-menu-item" onClick={handleCopyQualifiedName}>
                        📋 {t('sidebar.copyQualifiedName')}
                    </button>

                    <div className="sidebar-context-menu-separator" />
                    <button className="sidebar-context-menu-item" onClick={handleGenerateSelect}>
                        🔍 {t('sidebar.generateSelect')}
                    </button>
                    <button className="sidebar-context-menu-item" onClick={handleGetDdl}>
                        📄 {t('sidebar.viewDdl')}
                    </button>

                    <div className="sidebar-context-menu-separator" />
                    <button
                        className="sidebar-context-menu-item sidebar-context-menu-item-danger"
                        onClick={() =>
                            setDangerAction({
                                type: 'drop',
                                schema: target.schema,
                                name: target.view,
                                isView: true,
                            })
                        }
                    >
                        🗑️ {t('sidebar.dropView')}
                    </button>
                </>
            )}
        </div>
    );
}
