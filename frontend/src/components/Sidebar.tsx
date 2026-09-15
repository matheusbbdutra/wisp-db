import {useState, useEffect, useMemo, type CSSProperties} from 'react';
import {ListSchemas, ListTables, RefreshSchema} from '../lib/tabApi';
import type {db} from '../../wailsjs/go/models';
import {isCtrlHeld} from '../lib/modifierKeyTracker';

// Árvore de schemas/tabelas com introspecção lazy: só busca tabelas de um
// schema quando ele é expandido, nunca faz dump completo do catálogo de
// uma vez (ver docs/ARCHITECTURE.md, "Fluxo de metadados"). ListSchemas/
// ListTables consultam o schema cache (TTL + invalidação, ver
// internal/schemacache) — "Atualizar" chama RefreshSchema primeiro pra
// forçar um fetch real em vez de servir do cache.
interface Props {
    tabId: string;
    connected: boolean;
    onSelectTable: (schema: string, table: string) => void;
    // Affordance separada do clique simples: abre a tabela numa aba própria
    // (TableTab, com conexão dedicada). Opcional pra não quebrar outros usos.
    onOpenTable?: (schema: string, table: string) => void;
    // Ctrl+click no nome do schema abre uma SchemaTab listando as tabelas.
    onOpenSchema?: (schema: string) => void;
    // Largura controlada por fora (redimensionamento por arrasto, ver
    // lib/useDragResize.ts em ConsoleTab.tsx) — inline style vence a largura
    // fixa do CSS.
    style?: CSSProperties;
    // Botão de colapsar no header — opcional pra não quebrar quem ainda não
    // usa a feature (ex. um host futuro sem esse controle).
    onCollapse?: () => void;
}

export default function Sidebar({tabId, connected, onSelectTable, onOpenTable, onOpenSchema, style, onCollapse}: Props) {
    const [schemas, setSchemas] = useState<string[]>([]);
    const [tablesBySchema, setTablesBySchema] = useState<Record<string, db.Table[]>>({});
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);
    // Busca client-side (nome de schema/tabela) — nunca dispara requery no
    // servidor; ver useEffect abaixo pro único caso em que ela busca dado
    // novo (tabelas de schemas ainda não expandidos, só enquanto há texto).
    const [search, setSearch] = useState('');
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchError, setSearchError] = useState('');

    async function handleRefresh() {
        setLoading(true);
        try {
            await RefreshSchema(tabId);
            const result = await ListSchemas(tabId);
            setSchemas(result ?? []);
            setTablesBySchema({});
            setExpanded(new Set());
        } finally {
            setLoading(false);
        }
    }

    // Bug real relatado: a sidebar exigia clicar "Atualizar" manualmente
    // depois de conectar — ficava em "Nenhum schema carregado" mesmo já
    // conectado. Carrega a lista sozinha ao conectar (ListSchemas, não
    // RefreshSchema — usa o schema cache do backend se já houver um válido,
    // não força ida ao banco). Reseta ao desconectar pra não deixar schemas
    // da conexão anterior aparentando ainda válidos.
    useEffect(() => {
        if (!connected) {
            setSchemas([]);
            setTablesBySchema({});
            setExpanded(new Set());
            return;
        }
        let cancelled = false;
        setLoading(true);
        ListSchemas(tabId)
            .then(result => {
                if (!cancelled) setSchemas(result ?? []);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connected, tabId]);

    // Buscar por nome de tabela exige ter a lista de tabelas de TODOS os
    // schemas carregada — a árvore normalmente é lazy (só busca ao expandir).
    // Debounce de 300ms pra não disparar 1 fetch por tecla; sequencial (nunca
    // Promise.all, mesma regra de qualquer loop de chamadas na mesma aba —
    // ver lib/tabApi.ts) porque a conexão da aba não suporta uso concorrente.
    useEffect(() => {
        setSearchLoading(false);
        setSearchError('');
        if (!search.trim() || !connected) {
            return;
        }
        const missing = schemas.filter(s => !tablesBySchema[s]);
        if (missing.length === 0) {
            return;
        }
        let cancelled = false;
        const timer = setTimeout(async () => {
            setSearchLoading(true);
            try {
                for (const schema of missing) {
                    if (cancelled) return;
                    try {
                        const tables = await ListTables(tabId, schema);
                        if (cancelled) return;
                        setTablesBySchema(prev => (prev[schema] ? prev : {...prev, [schema]: tables ?? []}));
                    } catch {
                        if (cancelled) return;
                        setSearchError(prev => `${prev}${prev ? ' ' : ''}Não foi possível buscar tabelas do schema ${schema}.`);
                    }
                }
            } finally {
                if (!cancelled) setSearchLoading(false);
            }
        }, 300);
        return () => {
            cancelled = true;
            clearTimeout(timer);
            setSearchLoading(false);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search, schemas, connected, tabId]);

    const query = search.trim().toLowerCase();

    // Schema aparece se o próprio nome bate, ou se alguma tabela já
    // carregada bate — nunca esconde um schema só porque suas tabelas ainda
    // não chegaram (evita "sumir" a lista enquanto o fetch de busca roda).
    const visibleSchemas = useMemo(() => {
        if (!query) return schemas;
        return schemas.filter(s => {
            if (s.toLowerCase().includes(query)) return true;
            return (tablesBySchema[s] ?? []).some(t => t.Name.toLowerCase().includes(query));
        });
    }, [schemas, query, tablesBySchema]);

    function visibleTables(schema: string, tables: db.Table[]): db.Table[] {
        if (!query) return tables;
        if (schema.toLowerCase().includes(query)) return tables;
        return tables.filter(t => t.Name.toLowerCase().includes(query));
    }

    async function toggleSchema(schema: string) {
        const next = new Set(expanded);
        if (next.has(schema)) {
            next.delete(schema);
            setExpanded(next);
            return;
        }
        next.add(schema);
        setExpanded(next);

        if (!tablesBySchema[schema]) {
            const tables = await ListTables(tabId, schema);
            setTablesBySchema(prev => ({...prev, [schema]: tables ?? []}));
        }
    }

    if (!connected) {
        return (
            <aside className="sidebar" style={style}>
                <div className="sidebar-empty">
                    <svg className="sidebar-empty-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <ellipse cx="12" cy="5" rx="9" ry="3" />
                        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                    </svg>
                    <span>Conecte-se a um banco para explorar schemas e tabelas.</span>
                </div>
            </aside>
        );
    }

    return (
        <aside className="sidebar" style={style}>
            <div className="sidebar-header">
                <span className="sidebar-heading">Schemas & Tabelas</span>
                <button className="sidebar-refresh-btn" onClick={handleRefresh} disabled={loading} title="Recarregar catálogo (ignora o cache)">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
                    </svg>
                    {loading ? 'Carregando…' : 'Atualizar'}
                </button>
                {onCollapse && (
                    <button className="sidebar-collapse-btn" onClick={onCollapse} title="Recolher painel lateral">
                        ‹
                    </button>
                )}
            </div>

            <div className="sidebar-search">
                <input
                    type="text"
                    className="sidebar-search-input"
                    placeholder="Buscar schema ou tabela…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    title="Busca client-side por nome — carrega as tabelas de schemas ainda não expandidos pra poder buscar neles também."
                />
                {searchLoading && <span className="sidebar-search-loading">buscando…</span>}
            </div>

            {searchError && <div className="sidebar-empty" role="alert">{searchError}</div>}

            <div className="sidebar-tree">
                {schemas.length === 0 && !loading && (
                    <div className="sidebar-empty" style={{padding: '16px 8px'}}>
                        <span>Nenhum schema carregado. Clique em "Atualizar" para listar.</span>
                    </div>
                )}

                <ul className="tree-list">
                    {visibleSchemas.map(schema => {
                        // Buscando: expande sozinho pra mostrar o resultado
                        // sem exigir clique manual em cada schema.
                        const isExpanded = query ? true : expanded.has(schema);
                        const tables = visibleTables(schema, tablesBySchema[schema] ?? []);

                        return (
                            <li key={schema}>
                                <div
                                    className="tree-node"
                                    onClick={() => {
                                        // isCtrlHeld() em vez de e.ctrlKey: nesta stack (GTK/WebKitGTK
                                        // sob Wayland) o clique real não chega com ctrlKey correto, ver
                                        // lib/modifierKeyTracker.ts.
                                        if (isCtrlHeld() && onOpenSchema) {
                                            onOpenSchema(schema);
                                            return;
                                        }
                                        toggleSchema(schema);
                                    }}
                                    title={`Clique para expandir/colapsar · Ctrl+click para abrir ${schema} em aba própria`}
                                >
                                    <span className="tree-arrow">
                                        {isExpanded ? '▾' : '▸'}
                                    </span>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <ellipse cx="12" cy="5" rx="9" ry="3" />
                                        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                                        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                                    </svg>
                                    <span>{schema}</span>
                                </div>

                                {isExpanded && (
                                    <ul className="tree-sublist">
                                        {tables.length === 0 ? (
                                            <li className="tree-leaf" style={{opacity: 0.5, fontStyle: 'italic'}}>
                                                {query ? '(nenhuma tabela corresponde à busca)' : '(nenhuma tabela)'}
                                            </li>
                                        ) : (
                                            tables.map(t => (
                                                <li
                                                    key={t.Name}
                                                    className="tree-leaf"
                                                    onClick={() => {
                                                        // isCtrlHeld() em vez de e.ctrlKey — ver lib/modifierKeyTracker.ts.
                                                        if (isCtrlHeld() && onOpenTable) {
                                                            onOpenTable(schema, t.Name);
                                                            return;
                                                        }
                                                        onSelectTable(schema, t.Name);
                                                    }}
                                                    title={`${t.Kind === 'view' ? 'View' : 'Tabela'} · Clique para gerar SELECT · Ctrl+click para abrir ${schema}.${t.Name} em aba própria`}
                                                >
                                                    {t.Kind === 'view' ? (
                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                            <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
                                                            <circle cx="12" cy="12" r="3" />
                                                        </svg>
                                                    ) : (
                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                            <rect x="3" y="3" width="18" height="18" rx="2" />
                                                            <path d="M3 9h18M3 15h18M9 3v18" />
                                                        </svg>
                                                    )}
                                                    <span className="tree-leaf-name">{t.Name}</span>
                                                    {t.Kind === 'view' && <span className="tree-leaf-badge" title="View">view</span>}
                                                    {onOpenTable && (
                                                        <button
                                                            className="tree-leaf-open"
                                                            title={`Abrir ${schema}.${t.Name} em aba própria`}
                                                            onClick={e => {
                                                                e.stopPropagation();
                                                                onOpenTable(schema, t.Name);
                                                            }}
                                                        >
                                                            ↗
                                                        </button>
                                                    )}
                                                </li>
                                            ))
                                        )}
                                    </ul>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </div>
        </aside>
    );
}
