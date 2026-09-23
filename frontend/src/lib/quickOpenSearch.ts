import type {db} from '../../wailsjs/go/models';

/**
 * Filters and sorts catalog tables for Quick Open search.
 * Prioritizes prefix matches on table name, then substring matches on table or schema.
 */
export function filterAndSortCatalog(
    tables: db.Table[],
    query: string,
    limit: number = 50
): db.Table[] {
    const q = query.trim().toLowerCase();
    if (!q) {
        return tables.slice(0, limit);
    }

    return tables
        .filter(t => {
            const nameMatch = (t.Name || '').toLowerCase().includes(q);
            const schemaMatch = (t.Schema || '').toLowerCase().includes(q);
            const qualifiedMatch = `${t.Schema || ''}.${t.Name || ''}`.toLowerCase().includes(q);
            return nameMatch || schemaMatch || qualifiedMatch;
        })
        .sort((a, b) => {
            const aName = (a.Name || '').toLowerCase();
            const bName = (b.Name || '').toLowerCase();
            const aPrefix = aName.startsWith(q);
            const bPrefix = bName.startsWith(q);
            if (aPrefix && !bPrefix) return -1;
            if (!aPrefix && bPrefix) return 1;
            return aName.localeCompare(bName);
        })
        .slice(0, limit);
}
