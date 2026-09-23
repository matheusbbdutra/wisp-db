import type {Dialect} from './sqlDialect';
import {quoteIdent, qualifyTable} from './sqlDialect';
import type {db} from '../../wailsjs/go/models';

/**
 * Returns a default literal/placeholder representation for a given column data type.
 */
export function defaultValueForType(type?: string): string {
    if (!type) return "''";
    const t = type.toLowerCase().trim();
    if (
        t.includes('int') ||
        t.includes('serial') ||
        t.includes('float') ||
        t.includes('double') ||
        t.includes('real') ||
        t.includes('numeric') ||
        t.includes('decimal')
    ) {
        return '0';
    }
    if (t.includes('bool')) {
        return 'false';
    }
    if (t.includes('date') || t.includes('time')) {
        return 'CURRENT_TIMESTAMP';
    }
    if (t.includes('json')) {
        return "'{}'";
    }
    return "''";
}

function isGeneratedColumn(col: db.Column): boolean {
    return Boolean(col.IsGenerated || (col as any).Generated);
}

/**
 * Generates a SELECT boilerplate query with LIMIT 50.
 */
export function generateSelect(schema: string, table: string, dialect: Dialect): string {
    const target = qualifyTable(schema, table, dialect);
    return `SELECT * FROM ${target} LIMIT 50;`;
}

/**
 * Generates an INSERT boilerplate query excluding generated columns.
 */
export function generateInsert(
    schema: string,
    table: string,
    columns: db.Column[],
    dialect: Dialect,
): string {
    const target = qualifyTable(schema, table, dialect);
    const validCols = (columns || []).filter(c => !isGeneratedColumn(c));
    if (validCols.length === 0) {
        return `INSERT INTO ${target} DEFAULT VALUES;`;
    }
    const colNames = validCols.map(c => quoteIdent(c.Name, dialect)).join(', ');
    const placeholders = validCols.map(c => defaultValueForType(c.Type)).join(', ');
    return `INSERT INTO ${target} (${colNames}) VALUES (${placeholders});`;
}

/**
 * Generates an UPDATE boilerplate query targeting primary keys.
 * If no primary key is detected, sets dummy condition and warning comment.
 */
export function generateUpdate(
    schema: string,
    table: string,
    columns: db.Column[],
    dialect: Dialect,
): string {
    const target = qualifyTable(schema, table, dialect);
    const nonGenCols = (columns || []).filter(c => !isGeneratedColumn(c));
    const pkCols = nonGenCols.filter(c => c.IsPrimaryKey);
    const nonPkUpdateCols = nonGenCols.filter(c => !c.IsPrimaryKey);
    const setCols = nonPkUpdateCols.length > 0 ? nonPkUpdateCols : nonGenCols;

    const setClause = setCols.length > 0
        ? setCols.map(c => `${quoteIdent(c.Name, dialect)} = ${defaultValueForType(c.Type)}`).join(', ')
        : '/* no columns */';

    if (pkCols.length === 0) {
        return `UPDATE ${target} SET ${setClause} WHERE 1 = 0; -- WARNING: No primary key detected`;
    }

    const whereClause = pkCols
        .map(c => `${quoteIdent(c.Name, dialect)} = ${defaultValueForType(c.Type)}`)
        .join(' AND ');

    return `UPDATE ${target} SET ${setClause} WHERE ${whereClause};`;
}

/**
 * Generates a DELETE boilerplate query targeting primary key columns.
 * If pkColumns is empty, appends a warning comment with dummy condition.
 */
export function generateDelete(
    schema: string,
    table: string,
    pkColumns: string[],
    dialect: Dialect,
): string {
    const target = qualifyTable(schema, table, dialect);
    if (!pkColumns || pkColumns.length === 0) {
        return `DELETE FROM ${target} WHERE 1 = 0; -- WARNING: No primary key detected`;
    }
    const whereClause = pkColumns.map(pk => `${quoteIdent(pk, dialect)} = 1`).join(' AND ');
    return `DELETE FROM ${target} WHERE ${whereClause};`;
}

/**
 * Generates a boilerplate CREATE TABLE statement for a schema.
 */
export function generateCreateTable(
    schema: string,
    table: string = 'new_table',
    dialect: Dialect = 'postgres',
): string {
    const target = qualifyTable(schema, table, dialect);
    if (dialect === 'sqlite') {
        return `CREATE TABLE ${target} (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    name TEXT NOT NULL,\n    created_at TEXT DEFAULT CURRENT_TIMESTAMP\n);`;
    }
    if (dialect === 'mysql') {
        return `CREATE TABLE ${target} (\n    id BIGINT AUTO_INCREMENT PRIMARY KEY,\n    name VARCHAR(255) NOT NULL,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);`;
    }
    return `CREATE TABLE ${target} (\n    id BIGSERIAL PRIMARY KEY,\n    name TEXT NOT NULL,\n    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP\n);`;
}
