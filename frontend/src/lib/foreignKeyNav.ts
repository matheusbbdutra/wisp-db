import type {db} from '../../wailsjs/go/models';
import {formatPreviewValue} from './gridEditPreview';

export interface ForeignKeyReference {
    column: string;
    targetSchema: string;
    targetTable: string;
    targetColumn: string;
}

/**
 * Extracts normalized foreign key column mappings from database metadata.
 */
export function extractForeignKeyReferences(
    fks: db.ForeignKey[] | undefined | null,
    defaultSchema: string,
): ForeignKeyReference[] {
    if (!fks || fks.length === 0) {
        return [];
    }

    const refs: ForeignKeyReference[] = [];

    for (const fk of fks) {
        if (!fk.RefTable || !fk.Columns || fk.Columns.length === 0) {
            continue;
        }

        const targetSchema = fk.RefSchema && fk.RefSchema.trim() !== '' ? fk.RefSchema : defaultSchema;
        const refCols = fk.RefColumns && fk.RefColumns.length > 0 ? fk.RefColumns : ['id'];

        fk.Columns.forEach((col, idx) => {
            const targetCol = refCols[idx] ?? refCols[0] ?? 'id';
            refs.push({
                column: col,
                targetSchema,
                targetTable: fk.RefTable,
                targetColumn: targetCol,
            });
        });
    }

    return refs;
}

/**
 * Finds a foreign key mapping for a given column name (case-insensitive).
 */
export function findForeignKeyReference(
    references: ForeignKeyReference[] | undefined | null,
    columnName: string,
): ForeignKeyReference | undefined {
    if (!references || !columnName) {
        return undefined;
    }
    const lower = columnName.toLowerCase();
    return references.find(ref => ref.column.toLowerCase() === lower);
}

/**
 * Generates a filtered SELECT statement targeting a referenced record by key value.
 */
export function buildForeignKeyFilterQuery(
    schema: string,
    table: string,
    column: string,
    value: any,
    limit = 200,
): string {
    const qualified = schema && schema !== 'main' ? `"${schema}"."${table}"` : `"${table}"`;
    const where =
        value === null || value === undefined
            ? `"${column}" IS NULL`
            : `"${column}" = ${formatPreviewValue(value)}`;
    return `SELECT * FROM ${qualified} WHERE ${where} LIMIT ${limit}`;
}
