import {useEffect, useRef, useState} from 'react';
import {ConnectSaved, Disconnect, RunQuery, FetchRows, IntrospectTable, GetTableDDL, ListTriggers, ListFunctions} from '../lib/tabApi';
import type {db} from '../../wailsjs/go/models';
import SqlEditor from './SqlEditor';
import ResultGrid, {type EditContext} from './ResultGrid';
import {withQueue} from '../lib/tabCallQueue';

type SubTab = 'dados' | 'colunas' | 'ddl' | 'triggers' | 'funcoes';

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
    // Espelho em state só pra sub-aba "Colunas" renderizar (ref não dispara
    // re-render) — mesmos dados de tableColumnsRef, sem chamada extra.
    const [tableColumns, setTableColumns] = useState<db.Column[]>([]);

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
            // Chave `${tabId}:query` (NUNCA tabId sozinho — os bindings
            // dentro deste bloco já passam pela fila geral da aba via
            // lib/tabApi.ts; reusar a mesma causaria deadlock). Esta fila
            // serve DOIS propósitos com a MESMA chave, de propósito: (1)
            // serializa a decisão "conectar → sou a montagem válida? senão
            // desconecto" entre duas montagens do StrictMode (dev); (2) —
            // motivo real de um bug em produção — garante que NENHUMA outra
            // operação (GetTableDDL/ListTriggers/ListFunctions/"Carregar
            // mais", ver handleSelectSub/handleLoadMore abaixo) rode
            // intercalada entre um RunQuery e o(s) FetchRows que o seguem.
            // A fila geral da aba (tabId puro) só impede DUAS chamadas em
            // voo ao MESMO tempo — não impede uma chamada de ENTRAR NO MEIO
            // de um par RunQuery+FetchRows que precisa ficar contíguo (o
            // cursor de streaming do pgx fica aberto entre os dois; qualquer
            // outra query na mesma conexão nesse intervalo quebra com "conn
            // busy"). Por isso todo bloco que faz RunQuery/FetchRows ou
            // qualquer outra query nesta aba usa esta MESMA chave.
            await withQueue(`${tabId}:query`, async () => {
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
                    setTableColumns(tableColumnsRef.current);
                } catch {
                    // Introspecção falhou: Dados carrega mesmo assim, o grid
                    // fica read-only com aviso (sem os dados de PK).
                    if (cancelled) return;
                    tableColumnsRef.current = [];
                    setTableColumns([]);
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
        // Mesma chave de loadDados/handleSelectSub — ver comentário no
        // useEffect de conexão sobre por que isso é obrigatório (cursor de
        // streaming não pode ter outra query intercalada na mesma conexão).
        await withQueue(`${tabId}:query`, async () => {
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
        });
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
        // "Colunas" não busca nada novo — usa tableColumns, já disponível
        // desde o mount (mesma introspecção que já embasa o editContext).
        if (next === 'dados' || next === 'colunas' || metaLoading) {
            return;
        }
        // Mesma chave de loadDados/handleLoadMore: sem isso, clicar numa
        // sub-aba enquanto "Dados" ainda está buscando as primeiras linhas
        // intercala esta query no meio do cursor de streaming aberto —
        // bug real de produção, ver comentário completo no useEffect acima.
        await withQueue(`${tabId}:query`, async () => {
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
        });
    }

    const isError = status.toLowerCase().startsWith('erro');

    return (
        <div className="table-tab" hidden={hidden}>
            <div className="toolbar-secondary">
                <span className="table-tab-title" title={`Tabela ${schema}.${table}`}>{table}</span>
                <div className="table-subbar" role="tablist">
                    {(['dados', 'colunas', 'ddl', 'triggers', 'funcoes'] as SubTab[]).map(s => (
                        <button
                            key={s}
                            role="tab"
                            aria-selected={subTab === s}
                            className={`btn btn-secondary ${subTab === s ? 'active' : ''}`}
                            disabled={metaLoading && subTab !== s}
                            onClick={() => handleSelectSub(s)}
                        >
                            {s === 'dados' ? 'Dados' : s === 'colunas' ? 'Colunas' : s === 'ddl' ? 'DDL' : s === 'triggers' ? 'Triggers' : 'Funções'}
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

            {subTab === 'colunas' && (
                <div className="table-meta-pane">
                    {tableColumns.length === 0 && (
                        <div className="meta-empty">Não foi possível carregar as colunas desta tabela.</div>
                    )}
                    {tableColumns.length > 0 && (
                        <table className="columns-table">
                            <thead>
                                <tr>
                                    <th>Nome</th>
                                    <th>Tipo</th>
                                    <th>Nulo?</th>
                                    <th>PK</th>
                                    <th>Gerada</th>
                                </tr>
                            </thead>
                            <tbody>
                                {tableColumns.map(c => (
                                    <tr key={c.Name}>
                                        <td>{c.Name}</td>
                                        <td>{c.Type}</td>
                                        <td>{c.Nullable ? 'sim' : 'não'}</td>
                                        <td>{c.IsPrimaryKey ? '🔑' : ''}</td>
                                        <td>{c.IsGenerated ? 'sim' : ''}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
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
