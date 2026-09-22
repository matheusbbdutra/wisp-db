import {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ConnectSaved, Disconnect, RunQuery, FetchRows, IntrospectTable, GetTableDDL, ListTriggers, ListFunctions, ListIndexes, ListForeignKeys} from '../lib/tabApi';
import type {db} from '../../wailsjs/go/models';
import SqlEditor from './SqlEditor';
import ResultGrid, {type EditContext} from './ResultGrid';
import {withQueue} from '../lib/tabCallQueue';
import {extractForeignKeyReferences} from '../lib/foreignKeyNav';
import {formatPreviewValue} from '../lib/gridEditPreview';

type SubTab = 'dados' | 'colunas' | 'indices' | 'fks' | 'ddl' | 'triggers' | 'funcoes';

const BATCH_SIZE = 200;

interface Props {
    tabId: string;
    connectionId: string;
    schema: string;
    table: string;
    initialFilter?: { column: string; value: any };
    hidden: boolean;
    onConnectedChange: (connected: boolean) => void;
    // Abre a definição completa de um trigger/função numa aba própria (App.tsx
    // cuida de criar) — a lista de Triggers/Funções mostra só o nome, sem
    // despejar o DDL de todos inline (ver comentário em handleSelectSub).
    onOpenRoutine: (kind: 'trigger' | 'function', name: string, definition: string) => void;
    onOpenTable?: (connectionId: string, schema: string, table: string, initialFilter?: { column: string; value: any }) => void;
}

// Aba de tabela (nível superior, irmã do Console): tem tabId e conexão
// PRÓPRIOS — reconecta no mount via ConnectSaved com o mesmo connectionId
// salvo da origem, nunca reusa a sessão do console (ver AGENTS.md:
// 1 tabId = 1 conexão dedicada). Disconnect centralizado em App.tsx.
export default function TableTab({tabId, connectionId, schema, table, initialFilter, hidden, onConnectedChange, onOpenRoutine, onOpenTable}: Props) {
    const {t} = useTranslation();
    const [connected, setConnected] = useState(false);
    const [status, setStatus] = useState(() => t('tableTab.statusConnecting'));
    const [subTab, setSubTab] = useState<SubTab>('dados');
    const [activeFilter, setActiveFilter] = useState<{ column: string; value: any } | null>(initialFilter ?? null);

    // Colunas reais da tabela (via IntrospectTable, antes de qualquer cursor
    // aberto) — base pro editContext, computado após o primeiro fetch.
    const tableColumnsRef = useRef<db.Column[]>([]);
    // Espelho em state só pra sub-aba "Colunas" renderizar (ref não dispara
    // re-render) — mesmos dados de tableColumnsRef, sem chamada extra.
    const [tableColumns, setTableColumns] = useState<db.Column[]>([]);
    const tableFksRef = useRef<db.ForeignKey[]>([]);

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
    const [indices, setIndices] = useState<db.Index[] | null>(null);
    const [foreignKeys, setForeignKeys] = useState<db.ForeignKey[] | null>(null);
    const [metaLoading, setMetaLoading] = useState(false);
    const [metaError, setMetaError] = useState<string | null>(null);

    // Nome qualificado com identificadores entre aspas (nomes com espaço,
    // maiúsculas ou palavra reservada não quebram o SELECT).
    const qualified = schema === 'main' ? `"${table}"` : `"${schema}"."${table}"`;

    const subTabLabel: Record<SubTab, string> = {
        dados: t('tableTab.subDados'),
        colunas: t('tableTab.subColunas'),
        indices: t('tableTab.subIndices'),
        fks: t('tableTab.subFks'),
        ddl: t('tableTab.subDdl'),
        triggers: t('tableTab.subTriggers'),
        funcoes: t('tableTab.subFuncoes'),
    };

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
                    setStatus(t('tableTab.statusError', {error: err}));
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
                setStatus(t('tableTab.statusConnected', {schema, table}));
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
                try {
                    const rawFks = (await ListForeignKeys(tabId, schema, table)) ?? [];
                    if (!cancelled) {
                        tableFksRef.current = rawFks;
                        setForeignKeys(rawFks);
                    }
                } catch {
                    if (!cancelled) {
                        tableFksRef.current = [];
                    }
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
        const foreignKeys = extractForeignKeyReferences(tableFksRef.current, schema);
        if (cols.length === 0) {
            setEditContext({schema, table, pkColumns: [], editableColumns: [], allColumns: cols, foreignKeys});
            setReadOnlyNotice(t('tableTab.readOnlyNotFound', {schema, table}));
            return;
        }
        const pkColumns = cols.filter(c => c.IsPrimaryKey).map(c => c.Name);
        if (pkColumns.length === 0) {
            setEditContext({schema, table, pkColumns: [], editableColumns: [], allColumns: cols, foreignKeys});
            setReadOnlyNotice(t('tableTab.readOnlyNoPk', {schema, table}));
            return;
        }
        const byName = new Map(cols.map(c => [c.Name, c]));
        const editableColumns = resultColumns.filter(name => {
            const c = byName.get(name);
            return !!c && !c.IsGenerated && !c.IsPrimaryKey;
        });
        if (editableColumns.length === 0) {
            setEditContext({schema, table, pkColumns: [], editableColumns: [], allColumns: cols, foreignKeys});
            setReadOnlyNotice(t('tableTab.readOnlyNoEditable', {schema, table}));
            return;
        }
        setEditContext({schema, table, pkColumns, editableColumns, allColumns: cols, foreignKeys});
        setReadOnlyNotice(null);
    }

    async function loadDados(filterOverride?: { column: string; value: any } | null) {
        setFetching(true);
        setDadosError(null);
        const filter = filterOverride !== undefined ? filterOverride : activeFilter;
        try {
            let sql = `SELECT * FROM ${qualified} LIMIT ${BATCH_SIZE}`;
            if (filter) {
                const whereClause = filter.value === null || filter.value === undefined
                    ? `"${filter.column}" IS NULL`
                    : `"${filter.column}" = ${formatPreviewValue(filter.value)}`;
                sql = `SELECT * FROM ${qualified} WHERE ${whereClause} LIMIT ${BATCH_SIZE}`;
            }
            const meta = await RunQuery(tabId, sql);
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

    async function handleClearFilter() {
        setActiveFilter(null);
        await withQueue(`${tabId}:query`, async () => {
            await loadDados(null);
        });
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
                setStatus(t('tableTab.errorFetchRows', {error: err}));
            } finally {
                setFetching(false);
            }
        });
    }

    function handleCellSaved(rowIndex: number, colIndex: number, newValue: any) {
        setRows(prev => prev.map((r, i) => (i === rowIndex ? r.map((v, j) => (j === colIndex ? newValue : v)) : r)));
    }

    function handleRowDeleted(rowIndex: number) {
        setRows(prev => prev.filter((_, i) => i !== rowIndex));
    }

    function handleRowInserted(row: any[]) {
        setRows(prev => [...prev, row]);
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
                } else if (next === 'indices' && indices === null) {
                    setMetaLoading(true);
                    setIndices((await ListIndexes(tabId, schema, table)) ?? []);
                } else if (next === 'fks' && foreignKeys === null) {
                    setMetaLoading(true);
                    setForeignKeys((await ListForeignKeys(tabId, schema, table)) ?? []);
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
                <span className="table-tab-title" title={t('tableTab.title', {schema, table})}>{table}</span>
                <div className="table-subbar" role="tablist">
                    {(['dados', 'colunas', 'indices', 'fks', 'ddl', 'triggers', 'funcoes'] as SubTab[]).map(s => (
                        <button
                            key={s}
                            role="tab"
                            aria-selected={subTab === s}
                            className={`btn btn-secondary ${subTab === s ? 'active' : ''}`}
                            disabled={metaLoading && subTab !== s}
                            onClick={() => handleSelectSub(s)}
                        >
                            {subTabLabel[s]}
                        </button>
                    ))}
                </div>
                <div className="status-badge" title={t('tableTab.statusTitle')}>
                    <span className={`status-dot ${connected ? 'connected' : isError ? 'error' : ''}`} />
                    <span>{status}</span>
                </div>
            </div>

            {subTab === 'dados' && (
                <div className="table-dados-pane">
                    {activeFilter && (
                        <div className="table-filter-banner">
                            <span>{t('tableTab.filteredBy', {column: activeFilter.column, value: String(activeFilter.value)})}</span>
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={handleClearFilter}
                                title={t('tableTab.clearFilterTitle')}
                            >
                                {t('tableTab.clearFilter')}
                            </button>
                        </div>
                    )}
                    {dadosError && !dadosLoaded ? (
                        <div className="meta-empty">{t('tableTab.loadDataError', {error: dadosError})}</div>
                    ) : (
                        <>
                            <ResultGrid
                                columns={columns}
                                rows={rows}
                                tabId={tabId}
                                editContext={editContext}
                                readOnlyNotice={readOnlyNotice}
                                onCellSaved={handleCellSaved}
                                onRowDeleted={handleRowDeleted}
                                onRowInserted={handleRowInserted}
                                onStatus={setStatus}
                                onNavigateForeignKey={(targetSchema, targetTable, targetColumn, val) => {
                                    onOpenTable?.(connectionId, targetSchema, targetTable, {column: targetColumn, value: val});
                                }}
                            />
                            {hasMore && (
                                <div className="load-more-bar">
                                    <button className="btn btn-secondary" onClick={handleLoadMore} disabled={fetching}>
                                        {fetching ? t('tableTab.loading') : t('tableTab.loadMore', {count: BATCH_SIZE})}
                                    </button>
                                    <span className="load-more-hint">{t('tableTab.loadMoreHint')}</span>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {subTab === 'colunas' && (
                <div className="table-meta-pane">
                    {tableColumns.length === 0 && (
                        <div className="meta-empty">{t('tableTab.columnsLoadError')}</div>
                    )}
                    {tableColumns.length > 0 && (
                        <table className="columns-table">
                            <thead>
                                <tr>
                                    <th>{t('tableTab.colName')}</th>
                                    <th>{t('tableTab.colType')}</th>
                                    <th>{t('tableTab.colNullable')}</th>
                                    <th>{t('tableTab.colPk')}</th>
                                    <th>{t('tableTab.colGenerated')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {tableColumns.map(c => (
                                    <tr key={c.Name}>
                                        <td>{c.Name}</td>
                                        <td>{c.Type}</td>
                                        <td>{c.Nullable ? t('tableTab.yes') : t('tableTab.no')}</td>
                                        <td>{c.IsPrimaryKey ? '🔑' : ''}</td>
                                        <td>{c.IsGenerated ? t('tableTab.yes') : ''}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {subTab === 'indices' && (
                <div className="table-meta-pane">
                    {metaLoading && indices === null && <div className="meta-empty">{t('tableTab.loadingIndexes')}</div>}
                    {metaError && indices === null && <div className="meta-empty">{t('tableTab.loadIndexesError', {error: metaError})}</div>}
                    {indices !== null && indices.length === 0 && (
                        <div className="meta-empty">{t('tableTab.emptyIndexes')}</div>
                    )}
                    {indices !== null && indices.length > 0 && (
                        <table className="columns-table">
                            <thead>
                                <tr>
                                    <th>{t('tableTab.colName')}</th>
                                    <th>{t('tableTab.idxColumns')}</th>
                                    <th>{t('tableTab.idxUnique')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {indices.map(idx => (
                                    <tr key={idx.Name} title={idx.Definition}>
                                        <td>{idx.Name}</td>
                                        <td>{(idx.Columns ?? []).join(', ')}</td>
                                        <td>{idx.Unique ? t('tableTab.yes') : t('tableTab.no')}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {subTab === 'fks' && (
                <div className="table-meta-pane">
                    {metaLoading && foreignKeys === null && <div className="meta-empty">{t('tableTab.loadingFks')}</div>}
                    {metaError && foreignKeys === null && <div className="meta-empty">{t('tableTab.loadFksError', {error: metaError})}</div>}
                    {foreignKeys !== null && foreignKeys.length === 0 && (
                        <div className="meta-empty">{t('tableTab.emptyFks')}</div>
                    )}
                    {foreignKeys !== null && foreignKeys.length > 0 && (
                        <table className="columns-table">
                            <thead>
                                <tr>
                                    <th>{t('tableTab.colName')}</th>
                                    <th>{t('tableTab.fkColumns')}</th>
                                    <th>{t('tableTab.fkReference')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {foreignKeys.map(fk => (
                                    <tr key={fk.Name} title={fk.Definition}>
                                        <td>{fk.Name}</td>
                                        <td>{(fk.Columns ?? []).join(', ')}</td>
                                        <td>{fk.RefSchema}.{fk.RefTable} ({(fk.RefColumns ?? []).join(', ')})</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {subTab === 'ddl' && (
                <div className="table-meta-pane">
                    {metaLoading && ddl === null && <div className="meta-empty">{t('tableTab.loadingDdl')}</div>}
                    {metaError && ddl === null && <div className="meta-empty">{t('tableTab.loadDdlError', {error: metaError})}</div>}
                    {ddl !== null && (
                        <div className="ddl-editor-pane">
                            <SqlEditor value={ddl} onChange={() => {}} onRunRequested={() => {}} readOnly />
                        </div>
                    )}
                </div>
            )}

            {subTab === 'triggers' && (
                <div className="table-meta-pane">
                    {metaLoading && triggers === null && <div className="meta-empty">{t('tableTab.loadingTriggers')}</div>}
                    {metaError && triggers === null && <div className="meta-empty">{t('tableTab.loadTriggersError', {error: metaError})}</div>}
                    {triggers !== null && triggers.length === 0 && (
                        <div className="meta-empty">{t('tableTab.emptyTriggers')}</div>
                    )}
                    {triggers !== null && triggers.length > 0 && (
                        <ul className="meta-name-list">
                            {triggers.map(trigger => (
                                <li
                                    key={trigger.Name}
                                    className="meta-name-item"
                                    onClick={() => onOpenRoutine('trigger', trigger.Name, trigger.Definition)}
                                    title={t('tableTab.openRoutineTitle', {name: trigger.Name})}
                                >
                                    {trigger.Name}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {subTab === 'funcoes' && (
                <div className="table-meta-pane">
                    {metaLoading && funcoes === null && <div className="meta-empty">{t('tableTab.loadingFunctions')}</div>}
                    {metaError && funcoes === null && <div className="meta-empty">{t('tableTab.loadFunctionsError', {error: metaError})}</div>}
                    {funcoes !== null && funcoes.length === 0 && (
                        <div className="meta-empty">
                            {t('tableTab.emptyFunctions')}
                            <span className="meta-hint">{t('tableTab.emptyFunctionsHint')}</span>
                        </div>
                    )}
                    {funcoes !== null && funcoes.length > 0 && (
                        <ul className="meta-name-list">
                            {funcoes.map(fn => (
                                <li
                                    key={fn.Name}
                                    className="meta-name-item"
                                    onClick={() => onOpenRoutine('function', fn.Name, fn.Definition)}
                                    title={t('tableTab.openRoutineTitle', {name: fn.Name})}
                                >
                                    {fn.Name}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}
