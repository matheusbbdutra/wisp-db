// Previews textuais e coerções de valor da edição inline (só exibição — as
// queries reais são montadas parametrizadas no backend, nunca com literais).
// Extraído do ResultGrid sem mudança de comportamento; funções puras, sem React.
import {qualifyTable, quoteIdent, type Dialect} from './sqlDialect';

export function formatPreviewValue(val: any): string {
    if (val === null || val === undefined) {
        return 'NULL';
    }
    if (typeof val === 'number' || typeof val === 'boolean') {
        return String(val);
    }
    return `'${String(val).replace(/'/g, "''")}'`;
}

// Preview legível do UPDATE com checagem otimista (WHERE pk... AND
// coluna_antiga...), espelhando o que o backend executa de forma
// parametrizada (ver db.buildUpdateCellQuery).
export function buildUpdatePreview(
    schema: string,
    table: string,
    pkColumns: string[],
    pkValues: any[],
    column: string,
    oldValue: any,
    newValue: any,
    dialect: Dialect = 'postgres',
): string {
    const qualified = qualifyTable(schema, table, dialect);
    const quotedCol = quoteIdent(column, dialect);
    const where = pkColumns.map((pk, i) => {
        const v = pkValues[i];
        const quotedPk = quoteIdent(pk, dialect);
        return v === null || v === undefined ? `${quotedPk} IS NULL` : `${quotedPk} = ${formatPreviewValue(v)}`;
    });
    where.push(oldValue === null || oldValue === undefined ? `${quotedCol} IS NULL` : `${quotedCol} = ${formatPreviewValue(oldValue)}`);
    return `UPDATE ${qualified} SET ${quotedCol} = ${formatPreviewValue(newValue)} WHERE ${where.join(' AND ')}`;
}

// Preview legível do DELETE, mesmo espírito de buildUpdatePreview.
export function buildDeletePreview(
    schema: string,
    table: string,
    pkColumns: string[],
    pkValues: any[],
    dialect: Dialect = 'postgres',
): string {
    const qualified = qualifyTable(schema, table, dialect);
    const where = pkColumns.map((pk, i) => {
        const v = pkValues[i];
        const quotedPk = quoteIdent(pk, dialect);
        return v === null || v === undefined ? `${quotedPk} IS NULL` : `${quotedPk} = ${formatPreviewValue(v)}`;
    });
    return `DELETE FROM ${qualified} WHERE ${where.join(' AND ')}`;
}

// Preview textual do INSERT (só exibição — ExecuteBatch usa bindings).
export function buildInsertPreview(
    schema: string,
    table: string,
    columns: string[],
    values: any[],
    dialect: Dialect = 'postgres',
): string {
    const qualified = qualifyTable(schema, table, dialect);
    const cols = columns.map(c => quoteIdent(c, dialect)).join(', ');
    const vals = values.map(v => formatPreviewValue(v)).join(', ');
    return `INSERT INTO ${qualified} (${cols}) VALUES (${vals})`;
}

// Converte o texto editado no overlay pro tipo do valor original, pra
// manter a matriz de linhas tipada (número continua número no grid).
export function coerceEditedValue(oldValue: any, text: string): any {
    if (typeof oldValue === 'number') {
        const n = Number(text);
        return Number.isNaN(n) ? text : n;
    }
    if (typeof oldValue === 'boolean') {
        if (text === 'true' || text === '1') return true;
        if (text === 'false' || text === '0') return false;
    }
    return text;
}

// Converte o texto digitado no formulário de "Nova linha" pro tipo Go
// esperado, a partir do nome do tipo da coluna (não tem um valor antigo
// pra inferir o tipo, diferente de coerceEditedValue) — heurística simples
// por substring, mesmo espírito do resto do projeto (sem parser SQL).
export function coerceInsertValue(columnType: string, text: string): any {
    const t = columnType.toLowerCase();
    if (/bool/.test(t)) {
        if (text === 'true' || text === '1') return true;
        if (text === 'false' || text === '0') return false;
        return text;
    }
    if (/int|numeric|real|double|float|decimal|serial/.test(t)) {
        const n = Number(text);
        return Number.isNaN(n) ? text : n;
    }
    return text;
}
