import {useState, useRef, useEffect, useImperativeHandle, forwardRef} from 'react';
import {useTranslation} from 'react-i18next';
// Lib pronta de formatação SQL (ver ADR 0005) — formata o editor inteiro,
// sem parser próprio no Wisp.
import {format} from 'sql-formatter';
import type {SqlLanguage} from 'sql-formatter';
import type {db} from '../../wailsjs/go/models';
import SqlEditor, {AUTO_UPPERCASE_STORAGE_KEY, readAutoUppercasePreference, type SqlEditorHandle} from './SqlEditor';
import ResultGrid from './ResultGrid';
import Sidebar from './Sidebar';
import QueryHistory from './QueryHistory';
import ScriptsPanel from './ScriptsPanel';
import ConnectionBar from './ConnectionBar';
import ConsoleToolbar from './ConsoleToolbar';
import ConsoleRunBar from './ConsoleRunBar';
import ResultTabBar from './ResultTabBar';
import CloseConfirmModal from './CloseConfirmModal';
import {useDragResize} from '../lib/useDragResize';
import {explainQuery} from '../lib/explainQuery';
import {useConnection} from '../lib/useConnection';
import {useResultExecution, DEFAULT_BATCH_SIZE} from '../lib/useResultExecution';
import {useScriptState} from '../lib/useScriptState';

interface Props {
    tabId: string;
    hidden: boolean;
    onConnectedChange: (connected: boolean) => void;
    onOpenTable: (connectionId: string, schema: string, table: string) => void;
    onOpenSchema: (connectionId: string, schema: string) => void;
    // true só na aba de console inicial da sessão (ver App.tsx) — recarrega
    // sozinha o último script aberto (ver lastScript.ts), em vez
    // de sempre começar em branco. Abas criadas via "+" não recebem isso:
    // seriam sempre em branco de propósito, sem essa surpresa.
    restoreLastScriptOnMount?: boolean;
}

// Exposto via ref pra App.tsx perguntar, ANTES de fechar a aba, se há SQL
// não salvo no editor — App.tsx não tem acesso ao estado interno (query/
// activeScriptId) de cada ConsoleTab, então o fechamento precisa desse
// handle imperativo em vez de prop dessendo.
export interface ConsoleTabHandle {
    // Resolve true se pode fechar (nada pra salvar, ou o usuário decidiu
    // salvar/descartar), false se o usuário cancelou o fechamento.
    confirmClose: () => Promise<boolean>;
}

// Estado e comportamento de um console isolado (uma aba). Extraído de App.tsx
// para suportar múltiplas abas: cada instância tem seu próprio tabId, que já
// é a chave de isolamento no backend (Session Manager, ver internal/session).
//
// Domínios extraídos (mesmo comportamento, arquivos próprios): conexão e
// catálogo (useConnection), execução e abas de resultado (useResultExecution),
// scripts e confirmação de fechamento (useScriptState), toolbar, barra de
// execução, barra de abas de resultado e modal de fechamento.
const ConsoleTab = forwardRef<ConsoleTabHandle, Props>(function ConsoleTab({tabId, hidden, onConnectedChange, onOpenTable, onOpenSchema, restoreLastScriptOnMount}, ref) {
    const {t} = useTranslation();
    // Editor começa vazio — "SELECT * FROM customers" era resquício de teste
    // (nenhuma base do usuário tem essa tabela por padrão).
    const [query, setQuery] = useState('');
    const sqlEditorRef = useRef<SqlEditorHandle>(null);
    // Painéis redimensionáveis por arrasto (ver lib/useDragResize.ts) —
    // Wails só renderiza uma webview comum, isso é CSS/JS puro, sem
    // limitação de toolkit nativo.
    const sidebarResize = useDragResize({axis: 'x', initial: 250, min: 180, max: 480, storageKey: 'wisp:sidebarWidth'});
    const editorResize = useDragResize({axis: 'y', initial: 220, min: 120, max: 600, storageKey: 'wisp:editorHeight'});
    // Colapso da Sidebar — separado do resize por arrasto (useDragResize não
    // expõe um "setSize", e reduzir a 0px perderia a largura preferida do
    // usuário). Colapsado = escondida (não ícone-only: é árvore de texto +
    // busca, uma faixa fina não sobra espaço pra nada legível).
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
        try {
            return localStorage.getItem('wisp:sidebarCollapsed') === '1';
        } catch {
            return false;
        }
    });
    // Colapsar desmonta a <Sidebar/> (perde busca/schemas expandidos em
    // memória) em vez de só escondê-la via CSS — aceito de propósito: elevar
    // esse estado pra cá furaria a convenção do projeto de não subir estado
    // sem necessidade real, e colapsar com busca ativa é caso raro.
    function toggleSidebarCollapsed() {
        setSidebarCollapsed(prev => {
            const next = !prev;
            try {
                localStorage.setItem('wisp:sidebarCollapsed', next ? '1' : '0');
            } catch {
                // localStorage indisponível — segue só em memória.
            }
            return next;
        });
    }
    const [status, setStatus] = useState(() => t('consoleTab.disconnected'));
    const [batchSize, setBatchSize] = useState(DEFAULT_BATCH_SIZE);
    const [batchSizeInput, setBatchSizeInput] = useState(String(DEFAULT_BATCH_SIZE));
    const [showHistory, setShowHistory] = useState(false);
    const [showScripts, setShowScripts] = useState(false);
    const pendingQueryCountRef = useRef(0);
    // Preferência global de edição (localStorage, padrão ligado). Cada aba lê
    // ao montar e grava ao mudar — sem estado global React formal.
    const [autoUppercase, setAutoUppercase] = useState(() => readAutoUppercasePreference());

    function handleAutoUppercaseChange(next: boolean) {
        setAutoUppercase(next);
        try {
            localStorage.setItem(AUTO_UPPERCASE_STORAGE_KEY, String(next));
        } catch {
            // localStorage indisponível (ex.: modo restrito): mantém só em memória.
        }
    }

    const connection = useConnection({tabId, onConnectedChange, setStatus, pendingQueryCountRef});
    const execution = useResultExecution({
        tabId,
        batchSize,
        driver: connection.driver,
        catalog: connection.catalog,
        setStatus,
        pendingQueryCountRef,
        catalogCancelledRef: connection.catalogCancelledRef,
    });
    const scripts = useScriptState({restoreLastScriptOnMount});

    async function handleDisconnect() {
        await connection.handleDisconnect();
        execution.resetResults();
        setStatus(t('consoleTab.disconnected'));
    }

    function handleSelectTable(schema: string, table: string) {
        scripts.handleNewScript();
        setQuery(`SELECT * FROM ${schema === 'main' ? table : `${schema}.${table}`} LIMIT 200`);
    }

    function handleOpenTableRequest(schema: string, table: string) {
        // Sem connectionId não há como reconectar a aba nova — Sidebar só
        // mostra tabelas quando conectado, então isso é só guarda defensiva.
        if (!connection.connectionId) {
            return;
        }
        onOpenTable(connection.connectionId, schema, table);
    }

    function handleOpenSchemaRequest(schema: string) {
        // Mesma guarda defensiva: sem connectionId não há como reconectar.
        if (!connection.connectionId) {
            return;
        }
        onOpenSchema(connection.connectionId, schema);
    }

    // Ctrl+click num identificador do editor (ver SqlEditor.onOpenIdentifier):
    // resolve contra o catálogo já carregado antes de abrir — identificador
    // que não corresponde a nada real (typo, palavra-chave) é ignorado
    // silenciosamente, nunca abre aba errada adivinhando.
    function handleOpenIdentifier(
        target: {kind: 'table'; schema: string | null; table: string} | {kind: 'schema'; schema: string}
    ) {
        if (!connection.connectionId) {
            return;
        }
        if (target.kind === 'schema') {
            const match = connection.catalog.find(entry => entry.Schema.toLowerCase() === target.schema.toLowerCase());
            if (!match) return;
            onOpenSchema(connection.connectionId, match.Schema);
            return;
        }
        const {schema, table} = target;
        let match: db.Table | undefined;
        if (schema) {
            match = connection.catalog.find(entry => entry.Schema.toLowerCase() === schema.toLowerCase() && entry.Name.toLowerCase() === table.toLowerCase());
        } else {
            const candidates = connection.catalog.filter(entry => entry.Name.toLowerCase() === table.toLowerCase());
            match = candidates.length === 1 ? candidates[0] : candidates.find(entry => entry.Schema === 'public');
        }
        if (!match) return;
        onOpenTable(connection.connectionId, match.Schema, match.Name);
    }

    function handleFormatQuery() {
        const dialect: SqlLanguage = connection.driver === 'postgres' ? 'postgresql' : connection.driver === 'sqlite' ? 'sqlite' : 'sql';
        try {
            setQuery(format(query, {language: dialect}));
        } catch (err) {
            setStatus(t('consoleTab.errorFormat', {error: err}));
        }
    }

    function handleBatchSizeInput(raw: string) {
        setBatchSizeInput(raw);
        const parsed = parseInt(raw, 10);
        if (!Number.isNaN(parsed) && parsed >= 1) {
            setBatchSize(parsed);
        }
    }

    function handleBatchSizeBlur() {
        const parsed = parseInt(batchSizeInput, 10);
        if (Number.isNaN(parsed) || parsed < 1) {
            setBatchSizeInput(String(batchSize));
        }
    }

    useImperativeHandle(ref, () => ({
        confirmClose: () => scripts.requestCloseConfirm(query),
    }), [query, scripts.requestCloseConfirm]);

    // Recarrega o último script aberto (ver useScriptState.restoreLastScript)
    // só na aba de console inicial da sessão.
    useEffect(() => {
        return scripts.restoreLastScript(setQuery, () => query);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="console-tab" hidden={hidden}>
            <ConnectionBar
                tabId={tabId}
                connected={connection.connected}
                status={status}
                onDisconnect={handleDisconnect}
                onConnected={connection.handleConnected}
                onError={connection.handleError}
            />

            <ConsoleToolbar
                showSaveForm={scripts.showSaveForm}
                saveNameInput={scripts.saveNameInput}
                savingScript={scripts.savingScript}
                queryEmpty={!query.trim()}
                activeScriptId={scripts.activeScriptId}
                activeScriptName={scripts.activeScriptName}
                showScripts={showScripts}
                showHistory={showHistory}
                autoUppercase={autoUppercase}
                onSaveNameChange={scripts.setSaveNameInput}
                onConfirmSaveNew={() => void scripts.handleConfirmSaveNew(query)}
                onCancelSaveForm={() => scripts.setShowSaveForm(false)}
                onSaveClick={() => void scripts.handleSaveClick(query)}
                onNewScript={scripts.handleNewScript}
                onToggleScripts={() => setShowScripts(v => !v)}
                onToggleHistory={() => setShowHistory(v => !v)}
                onFormat={handleFormatQuery}
                onAutoUppercaseChange={handleAutoUppercaseChange}
            />

            <div className="workspace">
                {sidebarCollapsed ? (
                    <button className="sidebar-reopen-rail" onClick={toggleSidebarCollapsed} title={t('consoleTab.expandSidebarTitle')}>
                        ›
                    </button>
                ) : (
                    <>
                        <Sidebar
                            tabId={tabId}
                            connected={connection.connected}
                            onSelectTable={handleSelectTable}
                            onOpenTable={handleOpenTableRequest}
                            onOpenSchema={handleOpenSchemaRequest}
                            onCollapse={toggleSidebarCollapsed}
                            style={{width: sidebarResize.size, flex: '0 0 auto'}}
                        />
                        <div className="resize-handle resize-handle-v" onMouseDown={sidebarResize.onMouseDown} title={t('consoleTab.resizeTitle')} />
                    </>
                )}

                <main className="main-panel">
                    <div className="editor-pane" style={{height: editorResize.size}}>
                        <SqlEditor
                            ref={sqlEditorRef}
                            value={query}
                            onChange={setQuery}
                            onRunRequested={text => void execution.handleRun(text, false, connection.connected)}
                            onRunSelectionRequested={text => void execution.handleRun(text, false, connection.connected)}
                            onRunNewTabRequested={text => void execution.handleRun(text, true, connection.connected)}
                            catalog={connection.catalog}
                            onCatalogNeeded={() => connection.connectionId ? connection.loadCatalog(connection.connectionId, connection.catalogConnectionRef.current?.name) : Promise.resolve()}
                            driver={connection.driver}
                            autoUppercase={autoUppercase}
                            onOpenIdentifier={handleOpenIdentifier}
                        />
                    </div>
                    <div className="resize-handle resize-handle-h" onMouseDown={editorResize.onMouseDown} title={t('consoleTab.resizeTitle')} />
                    <ConsoleRunBar
                        connected={connection.connected}
                        queryEmpty={!query.trim()}
                        anyRunning={execution.anyRunning}
                        durationMs={execution.activeResult?.durationMs ?? null}
                        batchSizeInput={batchSizeInput}
                        activeFetching={execution.activeFetching}
                        batchSize={batchSize}
                        onRun={() => void execution.handleRun(query, false, connection.connected)}
                        onRunNewTab={() => void execution.handleRun(query, true, connection.connected)}
                        onExplain={() => {
                            // Statement sob o cursor/seleção, nunca o editor
                            // inteiro — EXPLAIN só aceita UM statement (ver
                            // explainQuery.ts). Sem isso, um console com mais
                            // de uma query mandava tudo junto pro driver com
                            // "EXPLAIN" na frente e quebrava com erro de
                            // sintaxe (mesma causa raiz do bug corrigido em
                            // Ctrl+Enter, 2026-09-17).
                            const text = sqlEditorRef.current?.getStatementOrSelection() || query;
                            void execution.handleRun(explainQuery(text, connection.driver), true, connection.connected);
                        }}
                        onCancel={() => void execution.handleCancel()}
                        onBatchSizeInput={handleBatchSizeInput}
                        onBatchSizeBlur={handleBatchSizeBlur}
                    />

                    <ResultTabBar
                        resultTabs={execution.resultTabs}
                        activeResultId={execution.activeResultId}
                        onSelect={execution.setActiveResultId}
                        onClose={execution.handleCloseResultTab}
                    />

                    {execution.activeResult && execution.activeResult.status === 'error' && (
                        <div className="result-error-banner">{t('consoleTab.errorBanner', {error: execution.activeResult.errorMsg})}</div>
                    )}

                    <ResultGrid
                        columns={execution.activeResult?.columns ?? []}
                        rows={execution.activeResult?.rows ?? []}
                        tabId={tabId}
                        editContext={execution.activeResult?.editContext ?? null}
                        readOnlyNotice={execution.activeResult?.readOnlyNotice ?? null}
                        onCellSaved={execution.handleCellSaved}
                        onRowDeleted={execution.handleRowDeleted}
                        onRowInserted={execution.handleRowInserted}
                        onStatus={setStatus}
                    />
                    {execution.activeResult?.hasMore && (
                        <div className="load-more-bar">
                            <button className="btn btn-secondary" onClick={() => void execution.handleLoadMore()} disabled={execution.activeFetching}>
                                {execution.activeFetching ? t('consoleTab.loading') : t('consoleTab.loadMore', {count: batchSize})}
                            </button>
                            <span className="load-more-hint">{t('consoleTab.loadMoreHint')}</span>
                        </div>
                    )}
                </main>

                {showScripts && (
                    <ScriptsPanel activeScriptId={scripts.activeScriptId} onSelectScript={(id, name, queryText) => scripts.handleSelectScript(id, name, queryText, setQuery)} refreshToken={scripts.scriptsToken} />
                )}
                {showHistory && (
                    <QueryHistory onSelectQuery={text => { scripts.handleNewScript(); setQuery(text); }} refreshToken={execution.historyToken} />
                )}
            </div>

            {scripts.closeConfirm && (
                <CloseConfirmModal
                    activeScriptId={scripts.activeScriptId}
                    activeScriptName={scripts.activeScriptName}
                    saveNameInput={scripts.closeSaveNameInput}
                    closeSaving={scripts.closeSaving}
                    onSaveNameChange={scripts.setCloseSaveNameInput}
                    onCancel={() => scripts.resolveCloseConfirm(false)}
                    onDiscard={() => scripts.resolveCloseConfirm(true)}
                    onSaveAndClose={() => void scripts.handleCloseSaveAndClose(query)}
                />
            )}
        </div>
    );
});

export default ConsoleTab;
