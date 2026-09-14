import {useState} from 'react';
import {ListSchemas, ListTables} from '../../wailsjs/go/main/App';
import type {db} from '../../wailsjs/go/models';

// Árvore de schemas/tabelas com introspecção lazy: só busca tabelas de um
// schema quando ele é expandido, nunca faz dump completo do catálogo de
// uma vez (ver docs/ARCHITECTURE.md, "Fluxo de metadados"). Cache de schema
// (TTL + invalidação) é Fase 2 — aqui é sempre fetch on-demand.
interface Props {
    tabId: string;
    connected: boolean;
    onSelectTable: (schema: string, table: string) => void;
}

export default function Sidebar({tabId, connected, onSelectTable}: Props) {
    const [schemas, setSchemas] = useState<string[]>([]);
    const [tablesBySchema, setTablesBySchema] = useState<Record<string, db.Table[]>>({});
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);

    async function loadSchemas() {
        setLoading(true);
        try {
            const result = await ListSchemas(tabId);
            setSchemas(result ?? []);
        } finally {
            setLoading(false);
        }
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
            <aside className="sidebar">
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
        <aside className="sidebar">
            <div className="sidebar-header">
                <span className="sidebar-heading">Schemas & Tabelas</span>
                <button className="sidebar-refresh-btn" onClick={loadSchemas} disabled={loading} title="Recarregar catálogo">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
                    </svg>
                    {loading ? 'Carregando…' : 'Atualizar'}
                </button>
            </div>

            <div className="sidebar-tree">
                {schemas.length === 0 && !loading && (
                    <div className="sidebar-empty" style={{padding: '16px 8px'}}>
                        <span>Nenhum schema carregado. Clique em "Atualizar" para listar.</span>
                    </div>
                )}

                <ul className="tree-list">
                    {schemas.map(schema => {
                        const isExpanded = expanded.has(schema);
                        const tables = tablesBySchema[schema] ?? [];

                        return (
                            <li key={schema}>
                                <div className="tree-node" onClick={() => toggleSchema(schema)}>
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
                                                (nenhuma tabela)
                                            </li>
                                        ) : (
                                            tables.map(t => (
                                                <li
                                                    key={t.Name}
                                                    className="tree-leaf"
                                                    onClick={() => onSelectTable(schema, t.Name)}
                                                    title={`Clique para gerar SELECT em ${schema}.${t.Name}`}
                                                >
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <rect x="3" y="3" width="18" height="18" rx="2" />
                                                        <path d="M3 9h18M3 15h18M9 3v18" />
                                                    </svg>
                                                    <span>{t.Name}</span>
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
