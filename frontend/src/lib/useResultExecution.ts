// Execução de queries da aba de console: abas de resultado, fila
// serializada, streaming por lote e detecção de contexto de edição.
// Extraído do ConsoleTab sem mudança de comportamento.
import {useRef, useState} from 'react';
import type {RefObject} from 'react';
import {useTranslation} from 'react-i18next';
import {CancelQuery} from '../../wailsjs/go/main/App';
import {RunQuery, FetchRows, IntrospectTable, ListForeignKeys} from './tabApi';
import type {db} from '../../wailsjs/go/models';
import {detectSingleTable, type SingleTableRef} from './detectSingleTable';
import {extractForeignKeyReferences} from './foreignKeyNav';
import {normalizeDialect} from './sqlDialect';
import {makeResultLabel} from './resultTabLabel';
import {splitStatements} from './sqlStatements';
import {withQueue} from './tabCallQueue';
import type {EditContext} from '../components/ResultGrid';

export const DEFAULT_BATCH_SIZE = 200;
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
export interface ResultTabState {
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

interface UseResultExecutionArgs {
    tabId: string;
    batchSize: number;
    driver: string | undefined;
    catalog: db.Table[];
    setStatus: React.Dispatch<React.SetStateAction<string>>;
    pendingQueryCountRef: RefObject<number>;
    catalogCancelledRef: RefObject<boolean>;
}

export function useResultExecution({tabId, batchSize, driver, catalog, setStatus, pendingQueryCountRef, catalogCancelledRef}: UseResultExecutionArgs) {
    const {t} = useTranslation();
    // Abas de resultado (ver ResultTabState acima) — uma por execução.
    const [resultTabs, setResultTabs] = useState<ResultTabState[]>([]);
    const [activeResultId, setActiveResultId] = useState<string | null>(null);
    const [scriptRunning, setScriptRunning] = useState(false);
    const scriptRunningRef = useRef(false);
    const scriptCancelledRef = useRef(false);
    const resultSeqRef = useRef(0);
    const cancelledQueryIdsRef = useRef(new Set<string>());
    const [historyToken, setHistoryToken] = useState(0);

    // "Executar" fica sempre clicável quando conectado (enfileira mais uma
    // execução, ver handleRun) — "Cancelar" só interrompe a que está
    // rodando de verdade agora (a fila garante que só uma roda por vez).
    const anyRunning = resultTabs.some(tab => tab.status === 'running' || tab.status === 'queued') || scriptRunning;
    const activeResult = resultTabs.find(tab => tab.id === activeResultId) ?? null;
    const activeFetching = activeResult?.fetching ?? false;

    function updateResultTab(id: string, updater: (tab: ResultTabState) => ResultTabState) {
        setResultTabs(prev => prev.map(tab => (tab.id === id ? updater(tab) : tab)));
    }

    // Limpa as abas de resultado (usado ao desconectar — o hook de conexão
    // não conhece este domínio).
    function resetResults() {
        setResultTabs([]);
        setActiveResultId(null);
        setScriptRunning(false);
        scriptRunningRef.current = false;
        scriptCancelledRef.current = false;
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
        let fks: db.ForeignKey[] = [];
        try {
            fks = (await ListForeignKeys(tabId, schema, ref.table)) ?? [];
        } catch {
            // Falha ao obter FKs não impede visualização ou edição
        }
        const foreignKeys = extractForeignKeyReferences(fks, schema);

        const dialect = normalizeDialect(driver ?? '');
        const pkColumns = cols.filter(c => c.IsPrimaryKey).map(c => c.Name);
        if (pkColumns.length === 0) {
            updateResultTab(id, tab => ({
                ...tab,
                editContext: {schema, table: ref.table, pkColumns: [], editableColumns: [], allColumns: cols, foreignKeys, dialect},
                readOnlyNotice: t('consoleTab.readOnlyNoPk', {schema, table: ref.table}),
            }));
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
            updateResultTab(id, tab => ({
                ...tab,
                editContext: {schema, table: ref.table, pkColumns: [], editableColumns: [], allColumns: cols, foreignKeys, dialect},
                readOnlyNotice: t('consoleTab.readOnlyNoEditable', {schema, table: ref.table}),
            }));
            return;
        }
        updateResultTab(id, tab => ({
            ...tab,
            editContext: {schema, table: ref.table, pkColumns, editableColumns, allColumns: cols, foreignKeys, dialect},
            readOnlyNotice: null,
        }));
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

    // Por padrão REAPROVEITA a aba de resultado ativa — estilo DBeaver: rodar
    // de novo substitui o resultado na mesma aba em vez de acumular uma nova
    // a cada execução. Só cria uma aba nova quando: não há aba ativa
    // reaproveitável, a ativa está running/queued (trabalho em voo nunca é
    // descartado), ou o usuário pediu explicitamente via forceNewTab.
    async function handleRun(text: string, forceNewTab: boolean, connected: boolean) {
        // Guarda contra os atalhos de teclado do editor — eles chamam
        // handleRun direto, sem passar pelo `disabled` do botão "Executar".
        // Bug real: rodava query sem sessão ativa, estourando "nenhuma
        // sessão ativa para tabId".
        if (!connected) {
            setStatus(t('consoleTab.errorNoConnection'));
            return;
        }
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

    async function handleRunScript(
        text: string,
        connected: boolean,
        onStatementError?: (start: number, end: number) => void
    ) {
        if (!connected) {
            setStatus(t('consoleTab.errorNoConnection'));
            return;
        }
        const stmts = splitStatements(text);
        if (stmts.length === 0) {
            setStatus(t('consoleTab.scriptNoStatements'));
            return;
        }

        pendingQueryCountRef.current += 1;
        catalogCancelledRef.current = true;
        scriptCancelledRef.current = false;
        scriptRunningRef.current = true;
        setScriptRunning(true);

        await withQueue(`${tabId}:query`, async () => {
            let executedCount = 0;
            let totalDurationMs = 0;
            try {
                for (let i = 0; i < stmts.length; i++) {
                    if (scriptCancelledRef.current) {
                        setStatus(t('consoleTab.scriptCancelled', {executed: executedCount, total: stmts.length}));
                        break;
                    }
                    const stmt = stmts[i];
                    setStatus(t('consoleTab.scriptProgress', {current: i + 1, total: stmts.length}));

                    let meta: {Columns?: string[] | null; Types?: string[] | null; DurationMs?: number};
                    try {
                        meta = await RunQuery(tabId, stmt.text);
                    } catch (err) {
                        onStatementError?.(stmt.start, stmt.end);
                        resultSeqRef.current += 1;
                        const errorTabId = crypto.randomUUID();
                        const errorTab: ResultTabState = {
                            id: errorTabId,
                            queryText: stmt.text,
                            label: makeResultLabel(stmt.text, resultSeqRef.current),
                            status: 'error',
                            columns: [],
                            rows: [],
                            hasMore: false,
                            fetching: false,
                            durationMs: null,
                            errorMsg: String(err),
                            editContext: null,
                            readOnlyNotice: null,
                            editSourceRef: null,
                        };
                        setResultTabs(prev => {
                            const frozen = prev.map(tab => (tab.hasMore ? {...tab, hasMore: false} : tab));
                            const next = [...frozen, errorTab];
                            if (next.length <= MAX_RESULT_TABS) return next;
                            const removable = next.filter(tab => tab.status === 'done' || tab.status === 'error');
                            const toDrop = next.length - MAX_RESULT_TABS;
                            const dropIds = new Set(removable.slice(0, toDrop).map(tab => tab.id));
                            return next.filter(tab => !dropIds.has(tab.id));
                        });
                        setActiveResultId(errorTabId);
                        setStatus(t('consoleTab.scriptErrorAtStatement', {index: i + 1, total: stmts.length, error: String(err)}));
                        break;
                    }

                    totalDurationMs += meta.DurationMs ?? 0;
                    executedCount++;

                    const resultColumns = meta.Columns ?? [];
                    if (resultColumns.length > 0) {
                        resultSeqRef.current += 1;
                        const id = crypto.randomUUID();
                        const freshTab: ResultTabState = {
                            id,
                            queryText: stmt.text,
                            label: makeResultLabel(stmt.text, resultSeqRef.current),
                            status: 'running',
                            columns: resultColumns,
                            rows: [],
                            hasMore: false,
                            fetching: false,
                            durationMs: meta.DurationMs ?? null,
                            errorMsg: null,
                            editContext: null,
                            readOnlyNotice: null,
                            editSourceRef: null,
                        };
                        setResultTabs(prev => {
                            const frozen = prev.map(tab => (tab.hasMore ? {...tab, hasMore: false} : tab));
                            const next = [...frozen, freshTab];
                            if (next.length <= MAX_RESULT_TABS) return next;
                            const removable = next.filter(tab => tab.status === 'done' || tab.status === 'error');
                            const toDrop = next.length - MAX_RESULT_TABS;
                            const dropIds = new Set(removable.slice(0, toDrop).map(tab => tab.id));
                            return next.filter(tab => !dropIds.has(tab.id));
                        });
                        setActiveResultId(id);

                        const fetched = await fetchBatchFor(id, [], true);
                        const ref = detectSingleTable(stmt.text);
                        updateResultTab(id, tab => ({...tab, editSourceRef: ref}));
                        if (ref) {
                            await tryComputeEditContext(id, ref, resultColumns, !fetched.hasMore);
                        }
                        updateResultTab(id, tab => ({...tab, status: 'done'}));
                    }

                    if (scriptCancelledRef.current) {
                        setStatus(t('consoleTab.scriptCancelled', {executed: executedCount, total: stmts.length}));
                        break;
                    }
                }

                if (!scriptCancelledRef.current && executedCount === stmts.length) {
                    setStatus(t('consoleTab.scriptSuccess', {count: executedCount, durationMs: totalDurationMs}));
                }
            } finally {
                scriptRunningRef.current = false;
                setScriptRunning(false);
                pendingQueryCountRef.current = Math.max(0, pendingQueryCountRef.current - 1);
                setHistoryToken(n => n + 1);
            }
        });
    }

    async function handleCancel() {
        if (scriptRunningRef.current) {
            scriptCancelledRef.current = true;
            await CancelQuery(tabId);
            return;
        }
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

    return {
        resultTabs,
        activeResultId,
        setActiveResultId,
        activeResult,
        anyRunning,
        scriptRunning,
        activeFetching,
        historyToken,
        handleRun,
        handleRunScript,
        handleLoadMore,
        handleCancel,
        handleCloseResultTab,
        handleCellSaved,
        handleRowDeleted,
        handleRowInserted,
        resetResults,
    };
}
