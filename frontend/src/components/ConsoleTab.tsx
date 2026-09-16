import {useState, useRef, useEffect, useImperativeHandle, forwardRef} from 'react';
import {useTranslation} from 'react-i18next';
// Lib pronta de formatação SQL (ver ADR 0005) — formata o editor inteiro,
// sem parser próprio no Wisp.
import {format} from 'sql-formatter';
import type {SqlLanguage} from 'sql-formatter';
import {SaveScript, UpdateScript, CancelQuery, ListScripts} from '../../wailsjs/go/main/App';
import {RunQuery, FetchRows, Disconnect, ListSchemas, IntrospectSchemaTables, IntrospectTable} from '../lib/tabApi';
import type {db} from '../../wailsjs/go/models';
import {detectSingleTable, type SingleTableRef} from '../lib/detectSingleTable';
import i18n from '../i18n';
import SqlEditor, {AUTO_UPPERCASE_STORAGE_KEY, readAutoUppercasePreference} from './SqlEditor';
import ResultGrid, {type EditContext} from './ResultGrid';
import Sidebar from './Sidebar';
import QueryHistory from './QueryHistory';
import ScriptsPanel from './ScriptsPanel';
import ConnectionBar from './ConnectionBar';
import {useDragResize} from '../lib/useDragResize';
import {withQueue} from '../lib/tabCallQueue';
import {explainQuery} from '../lib/explainQuery';

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
    status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
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

// Persistência do "último script aberto" (localStorage, mesmo padrão de
// AUTO_UPPERCASE_STORAGE_KEY/wisp:sidebarWidth) — usada só pela aba de
// console inicial da sessão (ver Props.restoreLastScriptOnMount em App.tsx)
// pra recarregar sozinha o script que o usuário tinha aberto da última vez
// que fechou o app, em vez de sempre começar em branco.
const LAST_SCRIPT_STORAGE_KEY = 'wisp:lastOpenScript';

function rememberLastScript(id: string, name: string) {
    try {
        localStorage.setItem(LAST_SCRIPT_STORAGE_KEY, JSON.stringify({id, name}));
    } catch {
        // localStorage indisponível — sem persistência, sem crash.
    }
}

function forgetLastScript() {
    try {
        localStorage.removeItem(LAST_SCRIPT_STORAGE_KEY);
    } catch {
        // idem
    }
}

function readLastScript(): {id: string; name: string} | null {
    try {
        const raw = localStorage.getItem(LAST_SCRIPT_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (typeof parsed?.id === 'string' && typeof parsed?.name === 'string') return parsed;
        return null;
    } catch {
        return null;
    }
}

// Nome da aba de resultado: prefere a tabela detectada (mesma detecção que
// já embasa a edição inline, ver detectSingleTable) — "s_solicitacao" em vez
// de "SELECT * FROM sigfacil.s_solicitacao_..." truncado, que ficava sempre
// igual pra queries diferentes na mesma tabela e nunca cabia na pill (ver
// bug real do "×" escondido, corrigido separadamente com truncamento CSS).
// Sem tabela única detectável (JOIN, DDL, etc.), cai pro texto truncado.
function makeResultLabel(text: string, seq: number): string {
    const trimmed = text.trim();
    if (!trimmed) return i18n.t('consoleTab.resultLabel', {seq});
    const ref = detectSingleTable(trimmed);
    if (ref) return ref.schema ? `${ref.schema}.${ref.table}` : ref.table;
    const firstLine = trimmed.split('\n')[0]?.trim();
    if (!firstLine) return i18n.t('consoleTab.resultLabel', {seq});
    return firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine;
}

interface Props {
    tabId: string;
    hidden: boolean;
    onConnectedChange: (connected: boolean) => void;
    onOpenTable: (connectionId: string, schema: string, table: string) => void;
    onOpenSchema: (connectionId: string, schema: string) => void;
    // true só na aba de console inicial da sessão (ver App.tsx) — recarrega
    // sozinha o último script aberto (ver LAST_SCRIPT_STORAGE_KEY), em vez
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
const ConsoleTab = forwardRef<ConsoleTabHandle, Props>(function ConsoleTab({tabId, hidden, onConnectedChange, onOpenTable, onOpenSchema, restoreLastScriptOnMount}, ref) {
    const {t} = useTranslation();
    // Editor começa vazio — "SELECT * FROM customers" era resquício de teste
    // (nenhuma base do usuário tem essa tabela por padrão).
    const [query, setQuery] = useState('');
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
    const [connected, setConnected] = useState(false);
    const [status, setStatus] = useState(() => t('consoleTab.disconnected'));
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
    const catalogCancelledRef = useRef(false);
    const catalogLoadingRef = useRef(false);
    const catalogConnectionRef = useRef<{id: string; name?: string; driver?: string} | null>(null);
    const pendingQueryCountRef = useRef(0);
    const cancelledQueryIdsRef = useRef(new Set<string>());
    const [showSaveForm, setShowSaveForm] = useState(false);
    const [saveNameInput, setSaveNameInput] = useState('');
    const [savingScript, setSavingScript] = useState(false);
    // Conteúdo do editor no momento do último save bem-sucedido (ou '' antes
    // de qualquer save) — "sujo" (não salvo) é query !== lastSavedQueryRef,
    // usado por confirmClose (ver ConsoleTabHandle) pra perguntar antes de
    // fechar a aba com SQL não salvo, em vez de descartar silenciosamente.
    const lastSavedQueryRef = useRef('');
    // Promise pendente do confirmClose enquanto o modal de "fechar sem
    // salvar?" está aberto — resolvida por qualquer um dos 3 botões do modal.
    const [closeConfirm, setCloseConfirm] = useState<{resolve: (proceed: boolean) => void} | null>(null);
    const [closeSaveNameInput, setCloseSaveNameInput] = useState('');
    const [closeSaving, setCloseSaving] = useState(false);
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
    const anyRunning = resultTabs.some(tab => tab.status === 'running' || tab.status === 'queued');
    const activeResult = resultTabs.find(tab => tab.id === activeResultId) ?? null;
    const activeFetching = activeResult?.fetching ?? false;

    function updateResultTab(id: string, updater: (tab: ResultTabState) => ResultTabState) {
        setResultTabs(prev => prev.map(tab => (tab.id === id ? updater(tab) : tab)));
    }

    async function loadCatalog(connectionId: string, connName?: string) {
        if (catalogLoadingRef.current) return;
        catalogLoadingRef.current = true;
        catalogCancelledRef.current = false;
        // Let a query submitted immediately after connecting enter the queue first.
        await new Promise(resolve => window.setTimeout(resolve, 150));
        if (catalogCancelledRef.current || pendingQueryCountRef.current > 0) {
            catalogLoadingRef.current = false;
            return;
        }
        try {
            setStatus(prev => t('consoleTab.loadingCatalog', {status: prev}));
            await withQueue(`${tabId}:query`, async () => {
                if (catalogCancelledRef.current || pendingQueryCountRef.current > 0) return;
                const schemas = await ListSchemas(tabId);
                const detailed: db.Table[] = [];
                for (const schema of schemas ?? []) {
                    if (catalogCancelledRef.current || pendingQueryCountRef.current > 0) return;
                    try {
                        const tables = await IntrospectSchemaTables(tabId, schema);
                        detailed.push(...(tables ?? []));
                    } catch (schemaErr) {
                        console.error(`erro ao introspectar schema ${schema} para autocomplete:`, schemaErr);
                    }
                    setCatalog([...detailed]);
                }
            });
            if (!catalogCancelledRef.current && catalogConnectionRef.current?.id === connectionId) {
                setStatus(connName ? t('consoleTab.connectedNamed', {name: connName}) : t('consoleTab.connected'));
            }
        } catch (err) {
            if (!catalogCancelledRef.current) {
                console.error('erro ao carregar catálogo para autocomplete:', err);
                setCatalog([]);
                setStatus(connName ? t('consoleTab.connectedNamed', {name: connName}) : t('consoleTab.connected'));
            }
        } finally {
            catalogLoadingRef.current = false;
            if (catalogCancelledRef.current && pendingQueryCountRef.current === 0 && catalogConnectionRef.current?.id === connectionId) {
                window.setTimeout(() => void loadCatalog(connectionId, connName), 0);
            }
        }
    }

    async function handleConnected(connectionId: string, connName?: string, activeDriver?: string) {
        setConnected(true);
        onConnectedChange(true);
        setConnectionId(connectionId);
        setDriver(activeDriver);
        catalogConnectionRef.current = {id: connectionId, name: connName, driver: activeDriver};
        catalogCancelledRef.current = false;
        setStatus(connName ? t('consoleTab.connectedNamed', {name: connName}) : t('consoleTab.connected'));
        // Catálogo completo pro autocomplete (ListSchemas + uma query batched
        // por schema via IntrospectSchemaTables — nunca mais um IntrospectTable
        // por tabela). Barato: o schema cache do backend (TTL 15min) evita
        // round-trip ao banco numa reconexão dentro do TTL.
        //
        // Sequencial POR SCHEMA, nunca Promise.all: a sessão de uma aba usa
        // uma única conexão (*sql.Conn/pgx) dedicada (ver internal/session),
        // que não suporta uso concorrente. Bug real: com 2+ schemas as
        // chamadas em paralelo colidiam com erro "conn busy" e derrubavam o
        // catálogo inteiro (ver memória wisp-autocomplete-conn-busy-concurrency).
        //
        // Tudo dentro de withQueue(`${tabId}:query`, ...) — mesma chave de
        // handleRun/handleLoadMore: sem isso, uma chamada deste loop pode
        // entrar bem no meio de um RunQuery+FetchRows já em andamento e
        // quebrar o cursor de streaming aberto — "conn busy" real, mesma
        // causa raiz corrigida em TableTab.tsx. O carregamento é interrompível
        // e retomado quando consultas de primeiro plano terminam.
        void loadCatalog(connectionId, connName);
    }

    function handleError(err: string) {
        setStatus(t('consoleTab.error', {error: err}));
    }

    async function handleDisconnect() {
        catalogCancelledRef.current = true;
        catalogConnectionRef.current = null;
        await Disconnect(tabId);
        setConnected(false);
        onConnectedChange(false);
        setStatus(t('consoleTab.disconnected'));
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
        const schemas = [...new Set(catalog.filter(entry => entry.Name === table).map(entry => entry.Schema))];
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
            updateResultTab(id, tab => ({...tab, editContext: null, readOnlyNotice: t('consoleTab.readOnlyMultiSchema', {table: ref.table})}));
            return;
        }
        let full: db.Table | null = null;
        try {
            full = await IntrospectTable(tabId, schema, ref.table);
        } catch {
            if (exhausted) {
                updateResultTab(id, tab => ({...tab, editContext: null, readOnlyNotice: t('consoleTab.readOnlyPkCheck', {schema, table: ref.table})}));
            }
            return;
        }
        const cols = full?.Columns ?? [];
        if (cols.length === 0) {
            updateResultTab(id, tab => ({...tab, editContext: null, readOnlyNotice: t('consoleTab.readOnlyNotFound', {schema, table: ref.table})}));
            return;
        }
        const pkColumns = cols.filter(c => c.IsPrimaryKey).map(c => c.Name);
        if (pkColumns.length === 0) {
            updateResultTab(id, tab => ({...tab, editContext: null, readOnlyNotice: t('consoleTab.readOnlyNoPk', {schema, table: ref.table})}));
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
            updateResultTab(id, tab => ({...tab, editContext: null, readOnlyNotice: t('consoleTab.readOnlyNoEditable', {schema, table: ref.table})}));
            return;
        }
        updateResultTab(id, tab => ({...tab, editContext: {schema, table: ref.table, pkColumns, editableColumns, allColumns: cols}, readOnlyNotice: null}));
    }

    async function fetchBatchFor(id: string, currentRows: any[][], replace: boolean) {
        updateResultTab(id, tab => ({...tab, fetching: true}));
        try {
            const batch = await FetchRows(tabId, batchSize);
            const combined = replace ? (batch.Rows ?? []) : [...currentRows, ...(batch.Rows ?? [])];
            updateResultTab(id, tab => ({...tab, rows: combined, hasMore: batch.HasMore, fetching: false}));
            setStatus(t('consoleTab.okRowsLoaded', {count: combined.length, more: batch.HasMore ? t('consoleTab.moreAvailable') : ''}));
            return {rows: combined, hasMore: batch.HasMore};
        } catch (err) {
            updateResultTab(id, tab => ({...tab, fetching: false}));
            setStatus(t('consoleTab.errorFetchRows', {error: err}));
            return {rows: currentRows, hasMore: false};
        }
    }

    // Por padrão (Ctrl+Enter/botão Executar) REAPROVEITA a aba de resultado
    // ativa — estilo DBeaver: rodar de novo substitui o resultado na mesma
    // aba em vez de acumular uma nova a cada execução. Só cria uma aba nova
    // quando: não há aba ativa reaproveitável, a ativa está running/queued
    // (trabalho em voo nunca é descartado), ou o usuário pediu explicitamente
    // via forceNewTab (Ctrl+Alt+Enter, ver SqlEditor.tsx — Ctrl+\ do DBeaver
    // quebrava Ctrl+Enter em teclado ABNT2, trocado por essa combinação).
    async function handleRun(textOverride?: string, forceNewTab = false) {
        // Guarda contra os atalhos de teclado do editor (Ctrl+Enter /
        // Ctrl+Shift+Enter/Ctrl+Alt+Enter, ver SqlEditor.tsx) — eles chamam handleRun
        // direto, sem passar pelo `disabled` do botão "Executar". Bug real:
        // rodava query sem sessão ativa, estourando "nenhuma sessão ativa
        // para tabId".
        if (!connected) {
            setStatus(t('consoleTab.errorNoConnection'));
            return;
        }
        const text = textOverride ?? query;
        pendingQueryCountRef.current += 1;
        catalogCancelledRef.current = true;
        const reusable = !forceNewTab && activeResult && activeResult.status !== 'running' && activeResult.status !== 'queued'
            ? activeResult
            : null;
        const id = reusable?.id ?? crypto.randomUUID();
        resultSeqRef.current += 1;
        const freshTab: ResultTabState = {
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
            const frozen = prev.map(tab => (tab.hasMore && tab.id !== id ? {...tab, hasMore: false} : tab));
            if (reusable) {
                return frozen.map(tab => (tab.id === id ? freshTab : tab));
            }
            const next = [...frozen, freshTab];
            if (next.length <= MAX_RESULT_TABS) return next;
            // Descarta as mais antigas já terminadas (done/error) antes de
            // qualquer uma rodando/na fila — nunca descarta trabalho em voo.
            const removable = next.filter(tab => tab.status === 'done' || tab.status === 'error');
            const toDrop = next.length - MAX_RESULT_TABS;
            const dropIds = new Set(removable.slice(0, toDrop).map(tab => tab.id));
            return next.filter(tab => !dropIds.has(tab.id));
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
            updateResultTab(id, tab => ({...tab, status: 'running'}));
            try {
                if (cancelledQueryIdsRef.current.has(id)) {
                    updateResultTab(id, tab => ({...tab, status: 'cancelled'}));
                    return;
                }
                const meta = await RunQuery(tabId, text);
                const resultColumns = meta.Columns ?? [];
                updateResultTab(id, tab => ({...tab, columns: resultColumns, durationMs: meta.DurationMs}));
                const fetched = await fetchBatchFor(id, [], true);
                // Detecção de tabela única após o fetch (sequencial, nunca
                // Promise.all — mesma regra de conexão single-conn do
                // handleConnected). Sem match, o grid segue read-only sem aviso.
                const ref = detectSingleTable(text);
                updateResultTab(id, tab => ({...tab, editSourceRef: ref}));
                if (ref) {
                    await tryComputeEditContext(id, ref, resultColumns, !fetched.hasMore);
                }
                updateResultTab(id, tab => ({...tab, status: 'done'}));
            } catch (err) {
                updateResultTab(id, tab => ({...tab, status: 'error', errorMsg: String(err)}));
                setStatus(t('consoleTab.errorRun', {error: err}));
            } finally {
                pendingQueryCountRef.current = Math.max(0, pendingQueryCountRef.current - 1);
                if (pendingQueryCountRef.current === 0 && catalogConnectionRef.current && !catalogLoadingRef.current) {
                    window.setTimeout(() => void loadCatalog(catalogConnectionRef.current!.id, catalogConnectionRef.current!.name), 0);
                }
                setHistoryToken(n => n + 1);
            }
        });
    }

    async function handleLoadMore() {
        if (!activeResult) return;
        const id = activeResult.id;
        const rows = activeResult.rows;
        const editSourceRef = activeResult.editSourceRef;
        const editContext = activeResult.editContext;
        const cols = activeResult.columns;
        // Mesma chave usada em handleRun — obrigatório: sem isso, abrir
        // DDL/Triggers/Funções (TableTab) ou rodar uma query nova enquanto
        // "Carregar mais" está em voo intercala outra query no meio do
        // cursor de streaming aberto do FetchRows — "conn busy" real
        // (bug de produção, mesma causa raiz corrigida em TableTab.tsx).
        await withQueue(`${tabId}:query`, async () => {
            const fetched = await fetchBatchFor(id, rows, false);
            // Retry da detecção adiada: se o cursor estava aberto no primeiro
            // fetch, a introspecção pode ter sido adiada sem aviso — tenta de
            // novo agora que o resultado avançou (ou se esgotou).
            if (editSourceRef && !editContext) {
                await tryComputeEditContext(id, editSourceRef, cols, !fetched.hasMore);
            }
        });
    }

    function handleCellSaved(rowIndex: number, colIndex: number, newValue: any) {
        if (!activeResultId) return;
        updateResultTab(activeResultId, tab => ({
            ...tab,
            rows: tab.rows.map((r, i) => (i === rowIndex ? r.map((v, j) => (j === colIndex ? newValue : v)) : r)),
        }));
    }

    function handleRowDeleted(rowIndex: number) {
        if (!activeResultId) return;
        updateResultTab(activeResultId, tab => ({...tab, rows: tab.rows.filter((_, i) => i !== rowIndex)}));
    }

    function handleRowInserted(row: any[]) {
        if (!activeResultId) return;
        updateResultTab(activeResultId, tab => ({...tab, rows: [...tab.rows, row]}));
    }

    async function handleCancel() {
        const active = resultTabs.find(tab => tab.id === activeResultId);
        if (active?.status === 'queued') {
            cancelledQueryIdsRef.current.add(active.id);
            updateResultTab(active.id, tab => ({...tab, status: 'cancelled'}));
            return;
        }
        await CancelQuery(tabId);
    }

    function handleCloseResultTab(id: string) {
        setResultTabs(prev => {
            const next = prev.filter(tab => tab.id !== id);
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
            const match = catalog.find(entry => entry.Schema.toLowerCase() === target.schema.toLowerCase());
            if (!match) return;
            onOpenSchema(connectionId, match.Schema);
            return;
        }
        const {schema, table} = target;
        let match: db.Table | undefined;
        if (schema) {
            match = catalog.find(entry => entry.Schema.toLowerCase() === schema.toLowerCase() && entry.Name.toLowerCase() === table.toLowerCase());
        } else {
            const candidates = catalog.filter(entry => entry.Name.toLowerCase() === table.toLowerCase());
            match = candidates.length === 1 ? candidates[0] : candidates.find(entry => entry.Schema === 'public');
        }
        if (!match) return;
        onOpenTable(connectionId, match.Schema, match.Name);
    }

    function handleSelectScript(id: string, name: string, queryText: string) {
        setActiveScriptId(id);
        setActiveScriptName(name);
        setQuery(queryText);
        lastSavedQueryRef.current = queryText;
        rememberLastScript(id, name);
    }

    // Sem script ativo, "Salvar" abre um campo de nome inline (novo script).
    // Com script ativo, sobrescreve o mesmo script direto — mesmo
    // comportamento de "salvar" de um editor de arquivos comum.
    async function handleSaveClick() {
        if (activeScriptId) {
            setSavingScript(true);
            try {
                await UpdateScript(activeScriptId, activeScriptName, query);
                lastSavedQueryRef.current = query;
                setScriptsToken(n => n + 1);
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
            lastSavedQueryRef.current = query;
            rememberLastScript(id, name);
            setShowSaveForm(false);
            setScriptsToken(n => n + 1);
        } finally {
            setSavingScript(false);
        }
    }

    function handleNewScript() {
        setActiveScriptId(null);
        setActiveScriptName('');
        setShowSaveForm(false);
        lastSavedQueryRef.current = '';
        forgetLastScript();
    }

    // Fecha o modal de "SQL não salvo" e resolve a Promise que confirmClose
    // devolveu pra App.tsx — proceed=true libera o fechamento da aba.
    function resolveCloseConfirm(proceed: boolean) {
        closeConfirm?.resolve(proceed);
        setCloseConfirm(null);
        setCloseSaveNameInput('');
    }

    // "Salvar e fechar": sobrescreve o script ativo, ou — sem script ativo —
    // salva um novo com o nome digitado no próprio modal (mescla o fluxo de
    // handleConfirmSaveNew aqui pra não precisar encadear dois diálogos).
    async function handleCloseSaveAndClose() {
        setCloseSaving(true);
        try {
            if (activeScriptId) {
                await UpdateScript(activeScriptId, activeScriptName, query);
            } else {
                const name = closeSaveNameInput.trim();
                if (!name) return;
                await SaveScript(name, query);
                setScriptsToken(n => n + 1);
            }
            lastSavedQueryRef.current = query;
            resolveCloseConfirm(true);
        } finally {
            setCloseSaving(false);
        }
    }

    useImperativeHandle(ref, () => ({
        confirmClose: () => {
            const dirty = query.trim() !== '' && query !== lastSavedQueryRef.current;
            if (!dirty) return Promise.resolve(true);
            return new Promise<boolean>(resolve => {
                setCloseSaveNameInput('');
                setCloseConfirm({resolve});
            });
        },
    }), [query]);

    // Recarrega o último script aberto (ver LAST_SCRIPT_STORAGE_KEY) só na
    // aba de console inicial da sessão — nunca sobrescreve texto que o
    // usuário já tenha digitado nesta aba antes deste efeito rodar (guarda
    // `query === ''`, ainda que na prática essa aba comece sempre vazia).
    // Script apagado/renomeado fora do Wisp entre sessões (ex.: usuário
    // limpou o banco local) — falha silenciosa, cai pra aba em branco normal.
    useEffect(() => {
        if (!restoreLastScriptOnMount) return;
        const last = readLastScript();
        if (!last) return;
        let cancelled = false;
        ListScripts()
            .then(scripts => {
                if (cancelled) return;
                const found = (scripts ?? []).find(s => s.ID === last.id);
                if (!found || query !== '') return;
                setActiveScriptId(found.ID);
                setActiveScriptName(found.Name);
                setQuery(found.QueryText);
                lastSavedQueryRef.current = found.QueryText;
            })
            .catch(() => {
                // Sem sorte restaurando — segue com a aba em branco normal.
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function handleFormatQuery() {
        const dialect: SqlLanguage = driver === 'postgres' ? 'postgresql' : driver === 'sqlite' ? 'sqlite' : 'sql';
        try {
            setQuery(format(query, {language: dialect}));
        } catch (err) {
            setStatus(t('consoleTab.errorFormat', {error: err}));
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
                            placeholder={t('consoleTab.scriptNamePlaceholder')}
                            value={saveNameInput}
                            onChange={e => setSaveNameInput(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') handleConfirmSaveNew();
                                if (e.key === 'Escape') setShowSaveForm(false);
                            }}
                        />
                        <button className="btn btn-success" onClick={handleConfirmSaveNew} disabled={savingScript || !saveNameInput.trim()}>
                            {t('consoleTab.confirm')}
                        </button>
                        <button className="btn btn-secondary" onClick={() => setShowSaveForm(false)}>
                            {t('consoleTab.cancel')}
                        </button>
                    </span>
                ) : (
                    <button
                        className="btn btn-secondary"
                        onClick={handleSaveClick}
                        disabled={savingScript || !query.trim()}
                        title={activeScriptId ? t('consoleTab.overwriteScriptTitle', {name: activeScriptName}) : t('consoleTab.saveAsNewTitle')}
                    >
                        {activeScriptId ? t('consoleTab.saveScriptNamed', {name: activeScriptName}) : t('consoleTab.saveScript')}
                    </button>
                )}
                {activeScriptId && (
                    <button className="btn btn-secondary" onClick={handleNewScript} title={t('consoleTab.newScriptTitle')}>
                        {t('consoleTab.new')}
                    </button>
                )}
                <button
                    className={`btn btn-secondary ${showScripts ? 'active' : ''}`}
                    onClick={() => setShowScripts(v => !v)}
                    title={t('consoleTab.scriptsToggleTitle')}
                >
                    {t('consoleTab.scripts')}
                </button>
                <button
                    className={`btn btn-secondary ${showHistory ? 'active' : ''}`}
                    onClick={() => setShowHistory(v => !v)}
                    title={t('consoleTab.historyToggleTitle')}
                >
                    {t('consoleTab.history')}
                </button>
                <button
                    className="btn btn-secondary"
                    onClick={handleFormatQuery}
                    disabled={!query.trim()}
                    title={t('consoleTab.formatTitle')}
                >
                    {t('consoleTab.format')}
                </button>
                <label className="auto-uppercase-toggle" title={t('consoleTab.autoUppercaseTitle')}>
                    <input
                        type="checkbox"
                        checked={autoUppercase}
                        onChange={e => handleAutoUppercaseChange(e.target.checked)}
                    />
                    {t('consoleTab.autoUppercase')}
                </label>
            </div>

            <div className="workspace">
                {sidebarCollapsed ? (
                    <button className="sidebar-reopen-rail" onClick={toggleSidebarCollapsed} title={t('consoleTab.expandSidebarTitle')}>
                        ›
                    </button>
                ) : (
                    <>
                        <Sidebar
                            tabId={tabId}
                            connected={connected}
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
                            value={query}
                            onChange={setQuery}
                            onRunRequested={() => handleRun()}
                            onRunSelectionRequested={text => handleRun(text)}
                            onRunNewTabRequested={() => handleRun(undefined, true)}
                            catalog={catalog}
                            driver={driver}
                            autoUppercase={autoUppercase}
                            onOpenIdentifier={handleOpenIdentifier}
                        />
                    </div>
                    <div className="resize-handle resize-handle-h" onMouseDown={editorResize.onMouseDown} title={t('consoleTab.resizeTitle')} />
                    <div className="editor-actions">
                        <div className="editor-actions-left">
                            <button className="btn btn-success" onClick={() => handleRun()} disabled={!connected} title={t('consoleTab.runTitle')}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                    <polygon points="5 3 19 12 5 21 5 3" />
                                </svg>
                                {t('consoleTab.run')}
                                <kbd className="kbd-shortcut">Ctrl+Enter</kbd>
                                <kbd className="kbd-shortcut" title={t('consoleTab.runSelectionTitle')}>Ctrl+Shift+Enter</kbd>
                            </button>
                            <button className="btn btn-secondary" onClick={() => handleRun(undefined, true)} disabled={!connected} title={t('consoleTab.runNewTabTitle')}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 5v14M5 12h14" />
                                </svg>
                                {t('consoleTab.newResultTab')}
                                <kbd className="kbd-shortcut">Ctrl+Alt+Enter</kbd>
                            </button>
                            <button
                                className="btn btn-secondary"
                                onClick={() => handleRun(explainQuery(query, driver), true)}
                                disabled={!connected || !query.trim()}
                                title={t('consoleTab.explainTitle')}
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4M9 3v6h6M9 3l11 11" />
                                </svg>
                                {t('consoleTab.explain')}
                            </button>
                            {anyRunning && (
                                <button className="btn btn-danger" onClick={handleCancel} title={t('consoleTab.cancelQueryTitle')}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                        <rect x="4" y="4" width="16" height="16" rx="2" />
                                    </svg>
                                    {t('consoleTab.cancelQuery')}
                                </button>
                            )}

                            {activeResult?.durationMs != null && (
                                <span className="duration-badge" title={t('consoleTab.durationTitle')}>
                                    {activeResult.durationMs} ms
                                </span>
                            )}
                        </div>
                        <div className="editor-actions-right">
                            <label className="batch-size-field" title={t('consoleTab.batchSizeTitle')}>
                                {t('consoleTab.fetch')}
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
                                {t('consoleTab.atATime')}
                            </label>
                        </div>
                    </div>

                    {resultTabs.length > 0 && (
                        <div className="result-tab-bar" role="tablist">
                            {resultTabs.map(resultTab => (
                                <button
                                    key={resultTab.id}
                                    role="tab"
                                    aria-selected={resultTab.id === activeResultId}
                                    className={`result-tab-pill ${resultTab.id === activeResultId ? 'active' : ''} result-tab-${resultTab.status}`}
                                    onClick={() => setActiveResultId(resultTab.id)}
                                    title={resultTab.queryText}
                                >
                                    <span className={`result-tab-dot result-tab-dot-${resultTab.status}`} />
                                    <span className="result-tab-label">{resultTab.label}</span>
                                    {resultTab.status === 'queued' && <span className="result-tab-hint">{t('consoleTab.queued')}</span>}
                                    {resultTab.status === 'running' && <span className="result-tab-hint">{t('consoleTab.running')}</span>}
                                    {resultTab.status === 'cancelled' && <span className="result-tab-hint">{t('consoleTab.cancelled')}</span>}
                                    <span
                                        className="result-tab-close"
                                        onClick={e => {
                                            e.stopPropagation();
                                            handleCloseResultTab(resultTab.id);
                                        }}
                                        title={t('consoleTab.closeResultTitle')}
                                    >
                                        ×
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}

                    {activeResult && activeResult.status === 'error' && (
                        <div className="result-error-banner">{t('consoleTab.errorBanner', {error: activeResult.errorMsg})}</div>
                    )}

                    <ResultGrid
                        columns={activeResult?.columns ?? []}
                        rows={activeResult?.rows ?? []}
                        tabId={tabId}
                        editContext={activeResult?.editContext ?? null}
                        readOnlyNotice={activeResult?.readOnlyNotice ?? null}
                        onCellSaved={handleCellSaved}
                        onRowDeleted={handleRowDeleted}
                        onRowInserted={handleRowInserted}
                        onStatus={setStatus}
                    />
                    {activeResult?.hasMore && (
                        <div className="load-more-bar">
                            <button className="btn btn-secondary" onClick={handleLoadMore} disabled={activeFetching}>
                                {activeFetching ? t('consoleTab.loading') : t('consoleTab.loadMore', {count: batchSize})}
                            </button>
                            <span className="load-more-hint">{t('consoleTab.loadMoreHint')}</span>
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

            {closeConfirm && (
                <div className="modal-backdrop" onClick={() => resolveCloseConfirm(false)}>
                    <div className="modal-container" onClick={e => e.stopPropagation()} style={{maxWidth: 420}}>
                        <div className="modal-header">
                            <div className="modal-title-group">
                                <h2 className="modal-title">{t('consoleTab.closeUnsavedTitle')}</h2>
                                <span className="modal-subtitle">{t('consoleTab.closeUnsavedSubtitle')}</span>
                            </div>
                            <button className="modal-close-btn" onClick={() => resolveCloseConfirm(false)} title={t('consoleTab.cancel')}>✕</button>
                        </div>
                        <div className="modal-body">
                            {!activeScriptId && (
                                <input
                                    className="input-control"
                                    autoFocus
                                    placeholder={t('consoleTab.scriptNamePlaceholder')}
                                    value={closeSaveNameInput}
                                    onChange={e => setCloseSaveNameInput(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && closeSaveNameInput.trim()) handleCloseSaveAndClose();
                                    }}
                                />
                            )}
                            <div className="modal-actions" style={{marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end'}}>
                                <button className="btn btn-secondary" onClick={() => resolveCloseConfirm(false)}>
                                    {t('consoleTab.cancel')}
                                </button>
                                <button className="btn btn-secondary" onClick={() => resolveCloseConfirm(true)}>
                                    {t('consoleTab.closeWithoutSaving')}
                                </button>
                                <button
                                    className="btn btn-success"
                                    onClick={handleCloseSaveAndClose}
                                    disabled={closeSaving || (!activeScriptId && !closeSaveNameInput.trim())}
                                    title={activeScriptId ? t('consoleTab.overwriteScriptTitle', {name: activeScriptName}) : t('consoleTab.saveAsNewCloseTitle')}
                                >
                                    {activeScriptId ? t('consoleTab.saveAndCloseNamed', {name: activeScriptName}) : t('consoleTab.saveAndClose')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

export default ConsoleTab;
