export type Dialect = 'postgres' | 'mysql' | 'sqlite';

/**
 * Normalizes a database driver name to a supported SQL dialect.
 * MySQL and MariaDB map to 'mysql' (backtick quoting).
 * SQLite maps to 'sqlite' (double quote quoting, main schema omitted).
 * All other drivers default to standard 'postgres' (double quote quoting).
 */
export function normalizeDialect(driver: string): Dialect {
    const d = (driver ?? '').toLowerCase().trim();
    if (d === 'mysql' || d === 'mariadb') {
        return 'mysql';
    }
    if (d === 'sqlite') {
        return 'sqlite';
    }
    return 'postgres';
}

/**
 * Quotes an identifier according to the given SQL dialect.
 * - 'mysql': uses backticks (`) and escapes embedded backticks by doubling them (``).
 * - 'postgres' | 'sqlite': uses double quotes (") and escapes embedded quotes by doubling them ("").
 */
export function quoteIdent(identifier: string, dialect: Dialect): string {
    if (dialect === 'mysql') {
        return '`' + identifier.replace(/`/g, '``') + '`';
    }
    return '"' + identifier.replace(/"/g, '""') + '"';
}

/**
 * Qualifies a table name with an optional schema prefix according to SQL dialect rules.
 * - If schema is omitted, empty, or 'main' (SQLite), returns only the quoted table name.
 * - In MySQL, if schema is 'def' (default catalog), returns only the quoted table name.
 * - Otherwise returns quoted schema and quoted table joined by a dot.
 */
export function qualifyTable(schema: string | undefined, table: string, dialect: Dialect): string {
    const quotedTable = quoteIdent(table, dialect);
    if (!schema || schema.trim() === '' || schema === 'main' || (dialect === 'mysql' && schema === 'def')) {
        return quotedTable;
    }
    const quotedSchema = quoteIdent(schema, dialect);
    return `${quotedSchema}.${quotedTable}`;
}
