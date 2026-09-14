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
        return <div className="sidebar sidebar-empty">Conecte-se a um banco para ver os schemas.</div>;
    }

    return (
        <div className="sidebar">
            <button className="sidebar-refresh" onClick={loadSchemas} disabled={loading}>
                {loading ? 'Carregando…' : 'Carregar schemas'}
            </button>
            <ul>
                {schemas.map(schema => (
                    <li key={schema}>
                        <div className="tree-node" onClick={() => toggleSchema(schema)}>
                            {expanded.has(schema) ? '▾' : '▸'} {schema}
                        </div>
                        {expanded.has(schema) && (
                            <ul>
                                {(tablesBySchema[schema] ?? []).map(t => (
                                    <li
                                        key={t.Name}
                                        className="tree-leaf"
                                        onClick={() => onSelectTable(schema, t.Name)}
                                    >
                                        {t.Name}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}
