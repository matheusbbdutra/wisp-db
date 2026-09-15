import {useEffect, useRef, useState} from 'react';
import {ConnectSaved, Disconnect, RunQuery, FetchRows, IntrospectTable, GetTableDDL, ListTriggers, ListFunctions} from '../lib/tabApi';
import type {db} from '../../wailsjs/go/models';
import SqlEditor from './SqlEditor';
import ResultGrid, {type EditContext} from './ResultGrid';
import {withQueue} from '../lib/tabCallQueue';

type SubTab = 'dados' | 'ddl' | 'triggers' | 'funcoes';

const BATCH_SIZE = 200;

interface Props {
    tabId: string;
    connectionId: string;
    schema: string;
    table: string;
    hidden: boolean;
    onConnectedChange: (connected: boolean) => void;
}

// Aba de tabela (nível superior, irmã do Console): tem tabId e conexão
// PRÓPRIOS — reconecta no mount via ConnectSaved com o mesmo connectionId
// salvo da origem, nunca reusa a sessão do console (ver CLAUDE.md:
// 1 tabId = 1 conexão dedicada). Disconnect centralizado em App.tsx.
export default function TableTab({tabId, connectionId, schema, table, hidden, onConnectedChange}: Props) {
    const [connected, setConnected] = useState(false);
    const [status, setStatus] = useState('conectando…');
    const [subTab, setSubTab] = useState<SubTab>('dados');

    // Colunas reais da tabela (via IntrospectTable, antes de qualquer cursor
    // aberto) — base pro editContext, computado após o primeiro fetch.
    const tableColumnsRef = useRef<db.Column[]>([]);

    // --- Dados ---
    const [columns, setColumns] = useState<string[]>([]);
    const [rows, setRows] = useState<any[][]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [fetching, setFetching] = useState(false);
    const [dadosLoaded, setDadosLoaded] = useState(false);
    const [dadosError, setDadosError] = useState<string | null>(null);
    const [editContext, setEditContext] = useState<EditContext | null>(null);
    const [readOnlyNotice, setReadOnlyNotice] = useState<string | null>(null);

    // --- Meta (lazy por sub-aba, cacheado — trocar e voltar não refaz) ---
    const [ddl, setDdl] = useState<string | null>(null);
    const [triggers, setTriggers] = useState<db.Trigger[] | null>(null);
    const [funcoes, setFuncoes] = useState<db.Function[] | null>(null);
    const [metaLoading, setMetaLoading] = useState(false);
    const [metaError, setMetaError] = useState<string | null>(null);

    // Nome qualificado com identificadores entre aspas (nomes com espaço,
    // maiúsculas ou palavra reservada não quebram o SELECT).
    const qualified = schema === 'main' ? `"${table}"` : `"${schema}"."${table}"`;

    // Mount: conecta a sessão própria e já carrega a sub-aba Dados.
    // Sequencial, nunca Promise.all — a sessão usa uma única conexão
    // dedicada, que não suporta uso concorrente (mesma regra do ConsoleTab).
    useEffect(() => {
        let cancelled = false;
        async function init() {
            // Chave DIFERENTE de tabId sozinho (`${tabId}:mount`) — de
            // propósito: os bindings dentro deste bloco (ConnectSaved,
            // IntrospectTable, RunQuery...) já passam pela fila geral da aba
            // (tabId puro, ver lib/tabApi.ts); usar a MESMA chave aqui
            // causaria deadlock (a chamada de dentro nunca entraria na fila
            // porque este bloco externo ainda não liberou). Esta fila
            // separada serializa só a decisão "conectar → sou a montagem
            // válida? senão desconecto" entre duas montagens do StrictMode
            // (dev) — sem ela, as duas chamadas a ConnectSaved corririam
            // concorrentes e o Manager.Open (backend) poderia cancelar a
            // sessão da montagem "vencedora" fora de ordem.
            await withQueue(`${tabId}:mount`, async () => {
                try {
                    await ConnectSaved(tabId, connectionId);
                } catch (err) {
                    if (cancelled) return;
                    setStatus(`erro: ${err}`);
                    setDadosError(String(err));
                    return;
                }
                if (cancelled) {
                    // Esta montagem já foi descartada (StrictMode) antes do
                    // connect terminar — desfaz, pra não deixar sessão órfã
                    // que a próxima montagem teria que disputar.
                    await Disconnect(tabId).catch(() => {});
                    return;
                }
                setConnected(true);
                onConnectedChange(true);
                setStatus(`conectado: ${schema}.${table}`);
                try {
                    const full = await IntrospectTable(tabId, schema, table);
                    if (cancelled) return;
                    tableColumnsRef.current = full?.Columns ?? [];
                } catch {
                    // Introspecção falhou: Dados carrega mesmo assim, o grid
                    // fica read-only com aviso (sem os dados de PK).
                    if (cancelled) return;
                    tableColumnsRef.current = [];
                }
                if (cancelled) return;
                await loadDados();
            });
        }
        void init();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function computeEditContext(resultColumns: string[]) {
        const cols = tableColumnsRef.current;
        if (cols.length === 0) {
            setEditContext(null);
            setReadOnlyNotice(`Tabela ${schema}.${table} não encontrada no catálogo — grade somente leitura.`);
            return;
        }
        const pkColumns = cols.filter(c => c.IsPrimaryKey).map(c => c.Name);
        if (pkColumns.length === 0) {
            setEditContext(null);
            setReadOnlyNotice(`Tabela ${schema}.${table} sem chave primária — grade somente leitura.`);
            return;
        }
        const byName = new Map(cols.map(c => [c.Name, c]));
        const editableColumns = resultColumns.filter(name => {
            const c = byName.get(name);
            return !!c && !c.IsGenerated && !c.IsPrimaryKey;
        });
        if (editableColumns.length === 0) {
            setEditContext(null);
            setReadOnlyNotice(`Nenhuma coluna editável em ${schema}.${table} (só expressões ou colunas geradas) — grade somente leitura.`);
            return;
        }
        setEditContext({schema, table, pkColumns, editableColumns});
        setReadOnlyNotice(null);
    }

    async function loadDados() {
        setFetching(true);
        setDadosError(null);
        try {
            const meta = await RunQuery(tabId, `SELECT * FROM ${qualified} LIMIT ${BATCH_SIZE}`);
            const resultColumns = meta.Columns ?? [];
            setColumns(resultColumns);
            const batch = await FetchRows(tabId, BATCH_SIZE);
            setRows(batch.Rows ?? []);
            setHasMore(batch.HasMore);
            computeEditContext(resultColumns);
            setDadosLoaded(true);
        } catch (err) {
            setDadosError(String(err));
        } finally {
            setFetching(false);
        }
    }

    async function handleLoadMore() {
        setFetching(true);
        try {
            const batch = await FetchRows(tabId, BATCH_SIZE);
            setRows(prev => [...prev, ...(batch.Rows ?? [])]);
            setHasMore(batch.HasMore);
        } catch (err) {
            setStatus(`erro ao buscar linhas: ${err}`);
        } finally {
            setFetching(false);
        }
    }

    function handleCellSaved(rowIndex: number, colIndex: number, newValue: any) {
        setRows(prev => prev.map((r, i) => (i === rowIndex ? r.map((v, j) => (j === colIndex ? newValue : v)) : r)));
    }

    // Troca de sub-aba com lazy-load: só busca na primeira ativação.
    // Guarda metaLoading desabilita os botões durante o fetch, impedindo
    // chamadas concorrentes na mesma conexão (regra single-conn por aba).
    async function handleSelectSub(next: SubTab) {
        setSubTab(next);
        setMetaError(null);
        if (next === 'dados' || metaLoading) {
            return;
        }
        try {
            if (next === 'ddl' && ddl === null) {
                setMetaLoading(true);
                setDdl(await GetTableDDL(tabId, schema, table));
            } else if (next === 'triggers' && triggers === null) {
                setMetaLoading(true);
                setTriggers((await ListTriggers(tabId, schema, table)) ?? []);
            } else if (next === 'funcoes' && funcoes === null) {
                setMetaLoading(true);
                setFuncoes((await ListFunctions(tabId, schema)) ?? []);
            }
        } catch (err) {
            setMetaError(String(err));
        } finally {
            setMetaLoading(false);
        }
    }

    const isError = status.toLowerCase().startsWith('erro');

    return (
        <div className="table-tab" hidden={hidden}>
            <div className="toolbar-secondary">
                <span className="table-tab-title" title={`Tabela ${schema}.${table}`}>{table}</span>
                <div className="table-subbar" role="tablist">
                    {(['dados', 'ddl', 'triggers', 'funcoes'] as SubTab[]).map(s => (
                        <button
                            key={s}
                            role="tab"
                            aria-selected={subTab === s}
                            className={`btn btn-secondary ${subTab === s ? 'active' : ''}`}
                            disabled={metaLoading && subTab !== s}
                            onClick={() => handleSelectSub(s)}
                        >
                            {s === 'dados' ? 'Dados' : s === 'ddl' ? 'DDL' : s === 'triggers' ? 'Triggers' : 'Funções'}
                        </button>
                    ))}
                </div>
                <div className="status-badge" title="Status da sessão desta aba">
                    <span className={`status-dot ${connected ? 'connected' : isError ? 'error' : ''}`} />
                    <span>{status}</span>
                </div>
            </div>

            {subTab === 'dados' && (
                <div className="table-dados-pane">
                    {dadosError && !dadosLoaded ? (
                        <div className="meta-empty">Erro ao carregar dados: {dadosError}</div>
                    ) : (
                        <>
                            <ResultGrid
                                columns={columns}
                                rows={rows}
                                tabId={tabId}
                                editContext={editContext}
                                readOnlyNotice={readOnlyNotice}
                                onCellSaved={handleCellSaved}
                                onStatus={setStatus}
                            />
                            {hasMore && (
                                <div className="load-more-bar">
                                    <button className="btn btn-secondary" onClick={handleLoadMore} disabled={fetching}>
                                        {fetching ? 'Carregando…' : `Carregar mais ${BATCH_SIZE}`}
                                    </button>
                                    <span className="load-more-hint">Mais linhas disponíveis no resultado.</span>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {subTab === 'ddl' && (
                <div className="table-meta-pane">
                    {metaLoading && ddl === null && <div className="meta-empty">Carregando DDL…</div>}
                    {metaError && ddl === null && <div className="meta-empty">Erro ao carregar DDL: {metaError}</div>}
                    {ddl !== null && (
                        <div className="ddl-editor-pane">
                            <SqlEditor value={ddl} onChange={() => {}} onRunRequested={() => {}} readOnly />
                        </div>
                    )}
                </div>
            )}

            {subTab === 'triggers' && (
                <div className="table-meta-pane">
                    {metaLoading && triggers === null && <div className="meta-empty">Carregando triggers…</div>}
                    {metaError && triggers === null && <div className="meta-empty">Erro ao carregar triggers: {metaError}</div>}
                    {triggers !== null && triggers.length === 0 && (
                        <div className="meta-empty">Nenhum trigger nesta tabela.</div>
                    )}
                    {triggers !== null && triggers.length > 0 && (
                        <div className="meta-list">
                            {triggers.map(t => (
                                <div key={t.Name} className="meta-item">
                                    <div className="meta-name">{t.Name}</div>
                                    <pre className="meta-def">{t.Definition}</pre>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {subTab === 'funcoes' && (
                <div className="table-meta-pane">
                    {metaLoading && funcoes === null && <div className="meta-empty">Carregando funções…</div>}
                    {metaError && funcoes === null && <div className="meta-empty">Erro ao carregar funções: {metaError}</div>}
                    {funcoes !== null && funcoes.length === 0 && (
                        <div className="meta-empty">
                            Nenhuma função encontrada neste schema.
                            <span className="meta-hint">SQLite não possui funções de usuário — neste caso a lista é sempre vazia.</span>
                        </div>
                    )}
                    {funcoes !== null && funcoes.length > 0 && (
                        <div className="meta-list">
                            {funcoes.map(f => (
                                <div key={f.Name} className="meta-item">
                                    <div className="meta-name">{f.Name}</div>
                                    <pre className="meta-def">{f.Definition}</pre>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
