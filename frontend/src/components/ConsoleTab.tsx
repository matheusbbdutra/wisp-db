import {useState, useRef} from 'react';
// Lib pronta de formatação SQL (ver ADR 0005) — formata o editor inteiro,
// sem parser próprio no Wisp.
import {format} from 'sql-formatter';
import type {SqlLanguage} from 'sql-formatter';
import {SaveScript, UpdateScript, CancelQuery} from '../../wailsjs/go/main/App';
import {RunQuery, FetchRows, Disconnect, ListSchemas, ListTables, IntrospectTable} from '../lib/tabApi';
import type {db} from '../../wailsjs/go/models';
import {detectSingleTable, type SingleTableRef} from '../lib/detectSingleTable';
import SqlEditor, {AUTO_UPPERCASE_STORAGE_KEY, readAutoUppercasePreference} from './SqlEditor';
import ResultGrid, {type EditContext} from './ResultGrid';
import Sidebar from './Sidebar';
import QueryHistory from './QueryHistory';
import ScriptsPanel from './ScriptsPanel';
import ConnectionBar from './ConnectionBar';
import {useDragResize} from '../lib/useDragResize';
import {withQueue} from '../lib/tabCallQueue';

const DEFAULT_BATCH_SIZE = 200;
// Abas de resultado por console — limite pra não crescer memória sem parar
// numa sessão longa com muitas execuções (ver ResultTabState abaixo).
const MAX_RESULT_TABS = 10;

// Um resultado de execução, numa aba própria (estilo DBeaver "Result Sets").
// Cada handleRun cria uma nova entrada em vez de sobrescrever um estado
// único — múltiplas execuções não perdem resultados anteriores.
//
// Restrição real do backend (não contornável sem reabrir o Session Manager):
// uma sessão só mantém UM cursor de streaming ativo por vez — uma nova
// ExecuteStreaming fecha o cursor anterior (ver internal/db/driver.go,
// internal/session). Por isso, ao iniciar uma NOVA execução, TODAS as abas
// de resultado anteriores têm hasMore forçado pra false ("congela" — não
// tentam mais "Carregar mais", pois o cursor delas já foi fechado de
// verdade no backend). Só a aba mais recente pode ter hasMore=true.
interface ResultTabState {
    id: string;
    queryText: string;
    label: string;
    status: 'queued' | 'running' | 'done' | 'error';
    columns: string[];
    rows: any[][];
    hasMore: boolean;
    fetching: boolean;
    durationMs: number | null;
    errorMsg: string | null;
    editContext: EditContext | null;
    readOnlyNotice: string | null;
    editSourceRef: SingleTableRef | null;
}

function makeResultLabel(text: string, seq: number): string {
    const firstLine = text.trim().split('\n')[0]?.trim();
    if (!firstLine) return `Resultado ${seq}`;
    return firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine;
}

interface Props {
    tabId: string;
    hidden: boolean;
    onConnectedChange: (connected: boolean) => void;
    onOpenTable: (connectionId: string, schema: string, table: string) => void;
    onOpenSchema: (connectionId: string, schema: string) => void;
}

// Estado e comportamento de um console isolado (uma aba). Extraído de App.tsx
// para suportar múltiplas abas: cada instância tem seu próprio tabId, que já
// é a chave de isolamento no backend (Session Manager, ver internal/session).
export default function ConsoleTab({tabId, hidden, onConnectedChange, onOpenTable, onOpenSchema}: Props) {
    const [query, setQuery] = useState('SELECT * FROM customers ORDER BY id');
    // Painéis redimensionáveis por arrasto (ver lib/useDragResize.ts) —
    // Wails só renderiza uma webview comum, isso é CSS/JS puro, sem
    // limitação de toolkit nativo.
    const sidebarResize = useDragResize({axis: 'x', initial: 250, min: 180, max: 480, storageKey: 'wisp:sidebarWidth'});
    const editorResize = useDragResize({axis: 'y', initial: 220, min: 120, max: 600, storageKey: 'wisp:editorHeight'});
    const [connected, setConnected] = useState(false);
    const [status, setStatus] = useState('desconectado');
    // Abas de resultado (ver ResultTabState acima) — uma por execução.
    const [resultTabs, setResultTabs] = useState<ResultTabState[]>([]);
    const [activeResultId, setActiveResultId] = useState<string | null>(null);
    const resultSeqRef = useRef(0);
    const [batchSize, setBatchSize] = useState(DEFAULT_BATCH_SIZE);
    const [batchSizeInput, setBatchSizeInput] = useState(String(DEFAULT_BATCH_SIZE));
    const [showHistory, setShowHistory] = useState(false);
    const [historyToken, setHistoryToken] = useState(0);
    const [showScripts, setShowScripts] = useState(false);
    const [scriptsToken, setScriptsToken] = useState(0);
    const [activeScriptId, setActiveScriptId] = useState<string | null>(null);
    const [activeScriptName, setActiveScriptName] = useState('');
    const [catalog, setCatalog] = useState<db.Table[]>([]);
    const [driver, setDriver] = useState<string | undefined>(undefined);
    // ID da conexão salva que originou a sessão desta aba — repassado pra
    // App.tsx ao abrir uma aba de tabela, que reconecta com ConnectSaved
    // (conexão própria por aba, nunca reusa a sessão do console).
    const [connectionId, setConnectionId] = useState<string | null>(null);
    const [showSaveForm, setShowSaveForm] = useState(false);
    const [saveNameInput, setSaveNameInput] = useState('');
    const [savingScript, setSavingScript] = useState(false);
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

    // "Executar" fica sempre clicável quando conectado (enfileira mais uma
    // execução, ver handleRun) — "Cancelar" só interrompe a que está
    // rodando de verdade agora (a fila garante que só uma roda por vez).
    const anyRunning = resultTabs.some(t => t.status === 'running' || t.status === 'queued');
    const activeResult = resultTabs.find(t => t.id === activeResultId) ?? null;
    const activeFetching = activeResult?.fetching ?? false;

    function updateResultTab(id: string, updater: (t: ResultTabState) => ResultTabState) {
        setResultTabs(prev => prev.map(t => (t.id === id ? updater(t) : t)));
    }

    async function handleConnected(connectionId: string, connName?: string, activeDriver?: string) {
        setConnected(true);
        onConnectedChange(true);
        setConnectionId(connectionId);
        setDriver(activeDriver);
        setStatus(connName ? `conectado: ${connName}` : 'conectado');
        // Catálogo completo pro autocomplete (ListTables é lazy por schema,
        // como a Sidebar usa). Barato: o schema cache do backend (TTL 15min)
        // evita round-trip ao banco a cada schema.
        //
        // Sequencial, nunca Promise.all: a sessão de uma aba usa uma única
        // conexão (*sql.Conn/pgx) dedicada (ver internal/session), que não
        // suporta uso concorrente. Bug real: com 2+ schemas as chamadas em
        // paralelo colidiam com erro "conn busy" e derrubavam o catálogo
        // inteiro (ver memória wisp-autocomplete-conn-busy-concurrency).
        try {
            const schemas = await ListSchemas(tabId);
            const shallow: db.Table[] = [];
            for (const schema of schemas ?? []) {
                const tables = await ListTables(tabId, schema);
                shallow.push(...(tables ?? []));
            }
            // ListTables só traz Schema/Name (sem Columns) — enriquece cada
            // tabela via IntrospectTable antes de gravar o catálogo, para o
            // autocomplete de colunas funcionar. Falha individual não
            // derruba o catálogo: mantém a entrada rasa daquela tabela.
            const detailed: db.Table[] = [];
            for (const table of shallow) {
                try {
                    const full = await IntrospectTable(tabId, table.Schema, table.Name);
                    detailed.push(full ?? table);
                } catch (tableErr) {
                    console.error(`erro ao introspectar ${table.Schema}.${table.Name} para autocomplete:`, tableErr);
                    detailed.push(table);
                }
            }
            setCatalog(detailed);
        } catch (err) {
            // Não falha a conexão por causa do catálogo de autocomplete, mas
            // não engole o erro — autocomplete sem dados fica silencioso pro
            // usuário, então pelo menos loga pra investigação futura.
            console.error('erro ao carregar catálogo para autocomplete:', err);
            setCatalog([]);
        }
    }

    function handleError(err: string) {
        setStatus(`erro: ${err}`);
    }

    async function handleDisconnect() {
        await Disconnect(tabId);
        setConnected(false);
        onConnectedChange(false);
        setStatus('desconectado');
        setResultTabs([]);
        setActiveResultId(null);
        setCatalog([]);
        setDriver(undefined);
        setConnectionId(null);
    }

    // Resolve o schema da tabela detectada pra chamar IntrospectTable (que
    // exige schema). Com schema explícito na query usa ele; sem schema,
    // SQLite é sempre "main" e Postgres procura a tabela no catálogo já
    // carregado (único match vence; ambíguo entre schemas → null, grid
    // read-only em vez de adivinhar a tabela errada).
    function resolveEditSchema(detected: string | null, table: string): string | null {
        if (detected) {
            return detected;
        }
        if (driver === 'sqlite') {
            return 'main';
        }
        const schemas = [...new Set(catalog.filter(t => t.Name === table).map(t => t.Schema))];
        if (schemas.length === 1) {
            return schemas[0];
        }
        if (schemas.length === 0) {
            return 'public';
        }
        if (schemas.includes('public')) {
            return 'public';
        }
        return null;
    }

    // Cruza as colunas do resultado com o catálogo real (IntrospectTable) e
    // computa pkColumns + editableColumns. Uma única chamada sequencial por
    // vez — nunca Promise.all (conexão single-conn por aba, ver
    // handleConnected). Falha/introspecção vazia → read-only com aviso, não
    // erro. Se o cursor ainda está aberto (hasMore), o banco pode recusar a
    // segunda query na mesma conexão — nesse caso adia sem aviso e tenta de
    // novo ao carregar o resto em handleLoadMore.
    async function tryComputeEditContext(id: string, ref: SingleTableRef, resultColumns: string[], exhausted: boolean) {
        const schema = resolveEditSchema(ref.schema, ref.table);
        if (!schema) {
            updateResultTab(id, t => ({...t, editContext: null, readOnlyNotice: `Tabela "${ref.table}" existe em mais de um schema — grade somente leitura.`}));
            return;
        }
        let full: db.Table | null = null;
        try {
            full = await IntrospectTable(tabId, schema, ref.table);
        } catch {
            if (exhausted) {
                updateResultTab(id, t => ({...t, editContext: null, readOnlyNotice: `Não foi possível verificar a chave primária de ${schema}.${ref.table} — grade somente leitura.`}));
            }
            return;
        }
        const cols = full?.Columns ?? [];
        if (cols.length === 0) {
            updateResultTab(id, t => ({...t, editContext: null, readOnlyNotice: `Tabela ${schema}.${ref.table} não encontrada no catálogo — grade somente leitura.`}));
            return;
        }
        const pkColumns = cols.filter(c => c.IsPrimaryKey).map(c => c.Name);
        if (pkColumns.length === 0) {
            updateResultTab(id, t => ({...t, editContext: null, readOnlyNotice: `Tabela ${schema}.${ref.table} sem chave primária — grade somente leitura.`}));
            return;
        }
        const byName = new Map(cols.map(c => [c.Name, c]));
        // Colunas de PK ficam de fora da edição inline: mudar o valor de
        // uma chave primária é raro e arriscado (referências de FK,
        // histórico de queries pela PK antiga) — mesma cautela que
        // DBeaver/outros clientes SQL aplicam por padrão.
        const editableColumns = resultColumns.filter(name => {
            const c = byName.get(name);
            return !!c && !c.IsGenerated && !c.IsPrimaryKey;
        });
        if (editableColumns.length === 0) {
            updateResultTab(id, t => ({...t, editContext: null, readOnlyNotice: `Nenhuma coluna editável em ${schema}.${ref.table} (só expressões ou colunas geradas) — grade somente leitura.`}));
            return;
        }
        updateResultTab(id, t => ({...t, editContext: {schema, table: ref.table, pkColumns, editableColumns}, readOnlyNotice: null}));
    }

    async function fetchBatchFor(id: string, currentRows: any[][], replace: boolean) {
        updateResultTab(id, t => ({...t, fetching: true}));
        try {
            const batch = await FetchRows(tabId, batchSize);
            const combined = replace ? (batch.Rows ?? []) : [...currentRows, ...(batch.Rows ?? [])];
            updateResultTab(id, t => ({...t, rows: combined, hasMore: batch.HasMore, fetching: false}));
            setStatus(`ok — ${combined.length} linha(s) carregada(s)${batch.HasMore ? ', mais disponíveis' : ''}`);
            return {rows: combined, hasMore: batch.HasMore};
        } catch (err) {
            updateResultTab(id, t => ({...t, fetching: false}));
            setStatus(`erro ao buscar linhas: ${err}`);
            return {rows: currentRows, hasMore: false};
        }
    }

    async function handleRun(textOverride?: string) {
        // Guarda contra os atalhos de teclado do editor (Ctrl+Enter /
        // Ctrl+Shift+Enter, ver SqlEditor.tsx) — eles chamam handleRun direto,
        // sem passar pelo `disabled` do botão "Executar". Bug real: rodava
        // query sem sessão ativa, estourando "nenhuma sessão ativa para tabId".
        if (!connected) {
            setStatus('erro: nenhuma conexão ativa');
            return;
        }
        const text = textOverride ?? query;
        const id = crypto.randomUUID();
        resultSeqRef.current += 1;
        const newTab: ResultTabState = {
            id,
            queryText: text,
            label: makeResultLabel(text, resultSeqRef.current),
            status: 'queued',
            columns: [],
            rows: [],
            hasMore: false,
            fetching: false,
            durationMs: null,
            errorMsg: null,
            editContext: null,
            readOnlyNotice: null,
            editSourceRef: null,
        };
        setResultTabs(prev => {
            // Cursor do backend só existe pra ÚLTIMA query executada (ver
            // comentário em ResultTabState) — qualquer aba anterior perde
            // "carregar mais" no instante em que uma execução nova começa,
            // porque o cursor dela já foi fechado de verdade no backend.
            const frozen = prev.map(t => (t.hasMore ? {...t, hasMore: false} : t));
            const next = [...frozen, newTab];
            if (next.length <= MAX_RESULT_TABS) return next;
            // Descarta as mais antigas já terminadas (done/error) antes de
            // qualquer uma rodando/na fila — nunca descarta trabalho em voo.
            const removable = next.filter(t => t.status === 'done' || t.status === 'error');
            const toDrop = next.length - MAX_RESULT_TABS;
            const dropIds = new Set(removable.slice(0, toDrop).map(t => t.id));
            return next.filter(t => !dropIds.has(t.id));
        });
        setActiveResultId(id);

        // withQueue com chave `${tabId}:query` (NUNCA `tabId` puro — os
        // bindings individuais abaixo já usam essa chave via lib/tabApi.ts;
        // reusar a mesma aqui causaria deadlock, mesmo cuidado de
        // TableTab.tsx) serializa a sequência INTEIRA (RunQuery+FetchRows+
        // detecção) de cada execução em relação às outras — é isso que
        // implementa a fila: clicar Executar de novo com uma já rodando só
        // adiciona ao fim da fila, sem bloquear a UI nem colidir na conexão.
        await withQueue(`${tabId}:query`, async () => {
            updateResultTab(id, t => ({...t, status: 'running'}));
            try {
                const meta = await RunQuery(tabId, text);
                const resultColumns = meta.Columns ?? [];
                updateResultTab(id, t => ({...t, columns: resultColumns, durationMs: meta.DurationMs}));
                const fetched = await fetchBatchFor(id, [], true);
                // Detecção de tabela única após o fetch (sequencial, nunca
                // Promise.all — mesma regra de conexão single-conn do
                // handleConnected). Sem match, o grid segue read-only sem aviso.
                const ref = detectSingleTable(text);
                updateResultTab(id, t => ({...t, editSourceRef: ref}));
                if (ref) {
                    await tryComputeEditContext(id, ref, resultColumns, !fetched.hasMore);
                }
                updateResultTab(id, t => ({...t, status: 'done'}));
            } catch (err) {
                updateResultTab(id, t => ({...t, status: 'error', errorMsg: String(err)}));
                setStatus(`erro ao executar: ${err}`);
            } finally {
                setHistoryToken(t => t + 1);
            }
        });
    }

    async function handleLoadMore() {
        if (!activeResult) return;
        const id = activeResult.id;
        const fetched = await fetchBatchFor(id, activeResult.rows, false);
        // Retry da detecção adiada: se o cursor estava aberto no primeiro
        // fetch, a introspecção pode ter sido adiada sem aviso — tenta de
        // novo agora que o resultado avançou (ou se esgotou).
        if (activeResult.editSourceRef && !activeResult.editContext) {
            await tryComputeEditContext(id, activeResult.editSourceRef, activeResult.columns, !fetched.hasMore);
        }
    }

    function handleCellSaved(rowIndex: number, colIndex: number, newValue: any) {
        if (!activeResultId) return;
        updateResultTab(activeResultId, t => ({
            ...t,
            rows: t.rows.map((r, i) => (i === rowIndex ? r.map((v, j) => (j === colIndex ? newValue : v)) : r)),
        }));
    }

    async function handleCancel() {
        await CancelQuery(tabId);
    }

    function handleCloseResultTab(id: string) {
        setResultTabs(prev => {
            const next = prev.filter(t => t.id !== id);
            if (activeResultId === id) {
                setActiveResultId(next.length > 0 ? next[next.length - 1].id : null);
            }
            return next;
        });
    }

    function handleSelectTable(schema: string, table: string) {
        handleNewScript();
        setQuery(`SELECT * FROM ${schema === 'main' ? table : `${schema}.${table}`} LIMIT 200`);
    }

    function handleOpenTableRequest(schema: string, table: string) {
        // Sem connectionId não há como reconectar a aba nova — Sidebar só
        // mostra tabelas quando conectado, então isso é só guarda defensiva.
        if (!connectionId) {
            return;
        }
        onOpenTable(connectionId, schema, table);
    }

    function handleOpenSchemaRequest(schema: string) {
        // Mesma guarda defensiva: sem connectionId não há como reconectar.
        if (!connectionId) {
            return;
        }
        onOpenSchema(connectionId, schema);
    }

    // Ctrl+click num identificador do editor (ver SqlEditor.onOpenIdentifier):
    // resolve contra o catálogo já carregado antes de abrir — identificador
    // que não corresponde a nada real (typo, palavra-chave) é ignorado
    // silenciosamente, nunca abre aba errada adivinhando.
    function handleOpenIdentifier(
        target: {kind: 'table'; schema: string | null; table: string} | {kind: 'schema'; schema: string}
    ) {
        if (!connectionId) {
            return;
        }
        if (target.kind === 'schema') {
            const match = catalog.find(t => t.Schema.toLowerCase() === target.schema.toLowerCase());
            if (!match) return;
            onOpenSchema(connectionId, match.Schema);
            return;
        }
        const {schema, table} = target;
        let match: db.Table | undefined;
        if (schema) {
            match = catalog.find(t => t.Schema.toLowerCase() === schema.toLowerCase() && t.Name.toLowerCase() === table.toLowerCase());
        } else {
            const candidates = catalog.filter(t => t.Name.toLowerCase() === table.toLowerCase());
            match = candidates.length === 1 ? candidates[0] : candidates.find(t => t.Schema === 'public');
        }
        if (!match) return;
        onOpenTable(connectionId, match.Schema, match.Name);
    }

    function handleSelectScript(id: string, name: string, queryText: string) {
        setActiveScriptId(id);
        setActiveScriptName(name);
        setQuery(queryText);
    }

    // Sem script ativo, "Salvar" abre um campo de nome inline (novo script).
    // Com script ativo, sobrescreve o mesmo script direto — mesmo
    // comportamento de "salvar" de um editor de arquivos comum.
    async function handleSaveClick() {
        if (activeScriptId) {
            setSavingScript(true);
            try {
                await UpdateScript(activeScriptId, activeScriptName, query);
                setScriptsToken(t => t + 1);
            } finally {
                setSavingScript(false);
            }
            return;
        }
        setSaveNameInput('');
        setShowSaveForm(true);
    }

    async function handleConfirmSaveNew() {
        const name = saveNameInput.trim();
        if (!name) {
            return;
        }
        setSavingScript(true);
        try {
            const id = await SaveScript(name, query);
            setActiveScriptId(id);
            setActiveScriptName(name);
            setShowSaveForm(false);
            setScriptsToken(t => t + 1);
        } finally {
            setSavingScript(false);
        }
    }

    function handleNewScript() {
        setActiveScriptId(null);
        setActiveScriptName('');
        setShowSaveForm(false);
    }

    function handleFormatQuery() {
        const dialect: SqlLanguage = driver === 'postgres' ? 'postgresql' : driver === 'sqlite' ? 'sqlite' : 'sql';
        try {
            setQuery(format(query, {language: dialect}));
        } catch (err) {
            setStatus(`erro ao formatar: ${err}`);
        }
    }

    return (
        <div className="console-tab" hidden={hidden}>
            <ConnectionBar
                tabId={tabId}
                connected={connected}
                status={status}
                onDisconnect={handleDisconnect}
                onConnected={handleConnected}
                onError={handleError}
            />

            <div className="toolbar-secondary">
                {showSaveForm ? (
                    <span className="script-save-form">
                        <input
                            className="input-control"
                            autoFocus
                            placeholder="Nome do script"
                            value={saveNameInput}
                            onChange={e => setSaveNameInput(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') handleConfirmSaveNew();
                                if (e.key === 'Escape') setShowSaveForm(false);
                            }}
                        />
                        <button className="btn btn-success" onClick={handleConfirmSaveNew} disabled={savingScript || !saveNameInput.trim()}>
                            Confirmar
                        </button>
                        <button className="btn btn-secondary" onClick={() => setShowSaveForm(false)}>
                            Cancelar
                        </button>
                    </span>
                ) : (
                    <button
                        className="btn btn-secondary"
                        onClick={handleSaveClick}
                        disabled={savingScript || !query.trim()}
                        title={activeScriptId ? `Sobrescrever script "${activeScriptName}"` : 'Salvar como novo script nomeado'}
                    >
                        {activeScriptId ? `Salvar "${activeScriptName}"` : 'Salvar script'}
                    </button>
                )}
                {activeScriptId && (
                    <button className="btn btn-secondary" onClick={handleNewScript} title="Desvincular do script atual (próximo Salvar cria um novo)">
                        Novo
                    </button>
                )}
                <button
                    className={`btn btn-secondary ${showScripts ? 'active' : ''}`}
                    onClick={() => setShowScripts(v => !v)}
                    title="Mostrar/ocultar scripts salvos"
                >
                    Scripts
                </button>
                <button
                    className={`btn btn-secondary ${showHistory ? 'active' : ''}`}
                    onClick={() => setShowHistory(v => !v)}
                    title="Mostrar/ocultar histórico de queries"
                >
                    Histórico
                </button>
                <button
                    className="btn btn-secondary"
                    onClick={handleFormatQuery}
                    disabled={!query.trim()}
                    title="Formatar o SQL do editor (pretty-print)"
                >
                    Formatar
                </button>
                <label className="auto-uppercase-toggle" title="Converter keywords SQL para maiúsculas automaticamente ao digitar">
                    <input
                        type="checkbox"
                        checked={autoUppercase}
                        onChange={e => handleAutoUppercaseChange(e.target.checked)}
                    />
                    Uppercase automático
                </label>
                <span className="toolbar-tab-id" title="ID da sessão ativa">{tabId}</span>
            </div>

            <div className="workspace">
                <Sidebar
                    tabId={tabId}
                    connected={connected}
                    onSelectTable={handleSelectTable}
                    onOpenTable={handleOpenTableRequest}
                    onOpenSchema={handleOpenSchemaRequest}
                    style={{width: sidebarResize.size, flex: '0 0 auto'}}
                />
                <div className="resize-handle resize-handle-v" onMouseDown={sidebarResize.onMouseDown} title="Arrastar para redimensionar" />

                <main className="main-panel">
                    <div className="editor-pane" style={{height: editorResize.size}}>
                        <SqlEditor
                            value={query}
                            onChange={setQuery}
                            onRunRequested={() => handleRun()}
                            onRunSelectionRequested={text => handleRun(text)}
                            catalog={catalog}
                            driver={driver}
                            autoUppercase={autoUppercase}
                            onOpenIdentifier={handleOpenIdentifier}
                        />
                    </div>
                    <div className="resize-handle resize-handle-h" onMouseDown={editorResize.onMouseDown} title="Arrastar para redimensionar" />
                    <div className="editor-actions">
                        <div className="editor-actions-left">
                            <button className="btn btn-success" onClick={() => handleRun()} disabled={!connected} title="Executar (Ctrl+Enter) — enfileira se outra já estiver rodando. Selecione um trecho e use Ctrl+Shift+Enter pra rodar só ele.">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                    <polygon points="5 3 19 12 5 21 5 3" />
                                </svg>
                                Executar
                                <kbd className="kbd-shortcut">Ctrl+Enter</kbd>
                                <kbd className="kbd-shortcut" title="Executar seleção ou statement atual">Ctrl+Shift+Enter</kbd>
                            </button>
                            {anyRunning && (
                                <button className="btn btn-danger" onClick={handleCancel} title="Cancelar a consulta em andamento agora">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                        <rect x="4" y="4" width="16" height="16" rx="2" />
                                    </svg>
                                    Cancelar
                                </button>
                            )}

                            {activeResult?.durationMs != null && (
                                <span className="duration-badge" title="Tempo de execução no servidor (não inclui o tempo de buscar as linhas)">
                                    {activeResult.durationMs} ms
                                </span>
                            )}
                        </div>
                        <div className="editor-actions-right">
                            <label className="batch-size-field" title="Quantidade de linhas buscada por vez (padrão 200, como o 'fetch size' do DBeaver)">
                                Buscar
                                <input
                                    type="number"
                                    min={1}
                                    max={1000000}
                                    value={batchSizeInput}
                                    onChange={e => {
                                        const raw = e.target.value;
                                        setBatchSizeInput(raw);
                                        const parsed = parseInt(raw, 10);
                                        if (!Number.isNaN(parsed) && parsed >= 1) {
                                            setBatchSize(parsed);
                                        }
                                    }}
                                    onBlur={() => {
                                        const parsed = parseInt(batchSizeInput, 10);
                                        if (Number.isNaN(parsed) || parsed < 1) {
                                            setBatchSizeInput(String(batchSize));
                                        }
                                    }}
                                    disabled={activeFetching}
                                />
                                por vez
                            </label>
                        </div>
                    </div>

                    {resultTabs.length > 0 && (
                        <div className="result-tab-bar" role="tablist">
                            {resultTabs.map(t => (
                                <button
                                    key={t.id}
                                    role="tab"
                                    aria-selected={t.id === activeResultId}
                                    className={`result-tab-pill ${t.id === activeResultId ? 'active' : ''} result-tab-${t.status}`}
                                    onClick={() => setActiveResultId(t.id)}
                                    title={t.queryText}
                                >
                                    <span className={`result-tab-dot result-tab-dot-${t.status}`} />
                                    {t.label}
                                    {t.status === 'queued' && <span className="result-tab-hint">na fila</span>}
                                    {t.status === 'running' && <span className="result-tab-hint">rodando…</span>}
                                    <span
                                        className="result-tab-close"
                                        onClick={e => {
                                            e.stopPropagation();
                                            handleCloseResultTab(t.id);
                                        }}
                                        title="Fechar este resultado"
                                    >
                                        ×
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}

                    {activeResult && activeResult.status === 'error' && (
                        <div className="result-error-banner">Erro: {activeResult.errorMsg}</div>
                    )}

                    <ResultGrid
                        columns={activeResult?.columns ?? []}
                        rows={activeResult?.rows ?? []}
                        tabId={tabId}
                        editContext={activeResult?.editContext ?? null}
                        readOnlyNotice={activeResult?.readOnlyNotice ?? null}
                        onCellSaved={handleCellSaved}
                        onStatus={setStatus}
                    />
                    {activeResult?.hasMore && (
                        <div className="load-more-bar">
                            <button className="btn btn-secondary" onClick={handleLoadMore} disabled={activeFetching}>
                                {activeFetching ? 'Carregando…' : `Carregar mais ${batchSize}`}
                            </button>
                            <span className="load-more-hint">Mais linhas disponíveis no resultado.</span>
                        </div>
                    )}
                </main>

                {showScripts && (
                    <ScriptsPanel activeScriptId={activeScriptId} onSelectScript={handleSelectScript} refreshToken={scriptsToken} />
                )}
                {showHistory && (
                    <QueryHistory onSelectQuery={text => { handleNewScript(); setQuery(text); }} refreshToken={historyToken} />
                )}
            </div>
        </div>
    );
}
