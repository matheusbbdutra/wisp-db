import {useState, useEffect} from 'react';
import {ListSchemaObjects} from './tabApi';
import type {db} from '../../wailsjs/go/models';

export type SchemaCategory = 'tables' | 'views' | 'functions' | 'sequences';

interface UseSchemaObjectsArgs {
    tabId: string;
    schema: string;
    connected: boolean;
}

export function useSchemaObjects({tabId, schema, connected}: UseSchemaObjectsArgs) {
    const [objects, setObjects] = useState<db.SchemaObjects>({
        tables: [],
        views: [],
        functions: [],
        sequences: [],
    } as unknown as db.SchemaObjects);
    const [activeCategory, setActiveCategory] = useState<SchemaCategory>('tables');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');

    useEffect(() => {
        if (!connected) return;
        let cancelled = false;
        setLoading(true);
        setError(null);

        ListSchemaObjects(tabId, schema)
            .then(res => {
                if (cancelled) return;
                setObjects({
                    tables: res?.tables ?? [],
                    views: res?.views ?? [],
                    functions: res?.functions ?? [],
                    sequences: res?.sequences ?? [],
                } as unknown as db.SchemaObjects);
            })
            .catch(err => {
                if (cancelled) return;
                setError(String(err));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [tabId, schema, connected]);

    const query = search.trim().toLowerCase();

    const filteredTables: db.Table[] = (objects.tables ?? []).filter(t => !query || t.Name.toLowerCase().includes(query));
    const filteredViews: db.Table[] = (objects.views ?? []).filter(v => !query || v.Name.toLowerCase().includes(query));
    const filteredFunctions: db.Function[] = (objects.functions ?? []).filter(f => !query || f.Name.toLowerCase().includes(query));
    const filteredSequences: db.Sequence[] = (objects.sequences ?? []).filter(s => !query || s.Name.toLowerCase().includes(query));

    const counts = {
        tables: objects.tables?.length ?? 0,
        views: objects.views?.length ?? 0,
        functions: objects.functions?.length ?? 0,
        sequences: objects.sequences?.length ?? 0,
    };

    return {
        objects,
        activeCategory,
        setActiveCategory,
        loading,
        error,
        search,
        setSearch,
        counts,
        filteredTables,
        filteredViews,
        filteredFunctions,
        filteredSequences,
    };
}
