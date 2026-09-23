import {type Dialect, quoteIdent, qualifyTable} from './sqlDialect';

export interface SortConfig {
    column: string;
    direction: 'ASC' | 'DESC';
}

export interface TableFilterConfig {
    rawWhere?: string;
    columnFilter?: {
        column: string;
        operator: '=' | '!=' | '>' | '<' | 'LIKE' | 'ILIKE' | 'IS NULL' | 'IS NOT NULL';
        value: string;
    };
}

export {qualifyTable};

/**
 * Escapes single quotes in SQL string literals by doubling them.
 */
function escapeSqlString(value: string): string {
    return value.replace(/'/g, "''");
}

/**
 * Builds a SQL condition for a column filter.
 * - Quotes column identifier with quoteIdent(filter.column, dialect).
 * - For 'IS NULL' and 'IS NOT NULL', returns `${quotedCol} ${filter.operator}`.
 * - For 'ILIKE', uses ILIKE on PostgreSQL and falls back to LOWER(...) LIKE LOWER(...) on other dialects.
 * - For other operators, encloses escaped value in single quotes.
 */
export function buildColumnCondition(
    filter: NonNullable<TableFilterConfig['columnFilter']>,
    dialect: Dialect,
): string {
    const quotedCol = quoteIdent(filter.column, dialect);
    const op = filter.operator;

    if (op === 'IS NULL' || op === 'IS NOT NULL') {
        return `${quotedCol} ${op}`;
    }

    const escapedVal = `'${escapeSqlString(filter.value)}'`;

    if (op === 'ILIKE') {
        if (dialect === 'postgres') {
            return `${quotedCol} ILIKE ${escapedVal}`;
        }
        return `LOWER(${quotedCol}) LIKE LOWER(${escapedVal})`;
    }

    return `${quotedCol} ${op} ${escapedVal}`;
}

/**
 * Builds a SQL WHERE condition for foreign key navigation filters.
 * - Quotes column with quoteIdent.
 * - If value is null/undefined, returns `${quotedCol} IS NULL`.
 * - Otherwise returns `${quotedCol} = ${formattedValue}` (numeric as-is, boolean as true/false, strings enclosed with single quotes and doubled quotes).
 */
export function buildFkCondition(
    fkFilter: { column: string; value: any },
    dialect: Dialect,
): string {
    const quotedCol = quoteIdent(fkFilter.column, dialect);
    if (fkFilter.value === null || fkFilter.value === undefined) {
        return `${quotedCol} IS NULL`;
    }
    if (typeof fkFilter.value === 'number') {
        return `${quotedCol} = ${fkFilter.value}`;
    }
    if (typeof fkFilter.value === 'boolean') {
        return `${quotedCol} = ${fkFilter.value ? 'true' : 'false'}`;
    }
    const escaped = escapeSqlString(String(fkFilter.value));
    return `${quotedCol} = '${escaped}'`;
}

/**
 * Generates the full SELECT query for TableTab.
 * - Combines whereClauses from fkFilter and filter (rawWhere or columnFilter).
 * - Appends ORDER BY if sort is present.
 * - Appends LIMIT batchSize.
 */
export function buildTableQuery(
    qualifiedTable: string,
    filter: TableFilterConfig | null,
    fkFilter: { column: string; value: any } | null,
    sort: SortConfig | null,
    batchSize: number,
    dialect: Dialect,
): string {
    let sql = `SELECT * FROM ${qualifiedTable}`;
    const whereClauses: string[] = [];

    if (fkFilter) {
        whereClauses.push(buildFkCondition(fkFilter, dialect));
    }
    if (filter?.rawWhere && filter.rawWhere.trim() !== '') {
        whereClauses.push(`(${filter.rawWhere.trim()})`);
    } else if (filter?.columnFilter) {
        whereClauses.push(buildColumnCondition(filter.columnFilter, dialect));
    }

    if (whereClauses.length > 0) {
        sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    if (sort) {
        const quotedCol = quoteIdent(sort.column, dialect);
        sql += ` ORDER BY ${quotedCol} ${sort.direction}`;
    }

    sql += ` LIMIT ${batchSize}`;
    return sql;
}

/**
 * Cycles through 3 sorting states:
 * null / different column -> ASC -> DESC -> null (resets sort).
 */
export function toggleSort(
    currentSort: SortConfig | null,
    column: string,
): SortConfig | null {
    if (!currentSort || currentSort.column !== column) {
        return { column, direction: 'ASC' };
    }
    if (currentSort.direction === 'ASC') {
        return { column, direction: 'DESC' };
    }
    return null;
}
