// Formatação pura pra "copiar especial" do grid de resultados (estilo DBeaver).
// Fica fora do componente React (SRP): aqui não há estado nem DOM, só
// transformação de valores -> texto. O grid exibe objetos via JSON.stringify
// e NULL em itálico âmbar (ver getCellContent no ResultGrid) — as funções
// abaixo reusam a mesma conversão pra copiar o que o usuário vê.
export type CellValue = unknown;

/** Converte um valor de célula pro texto exibido/copiado. */
export function displayValue(val: CellValue): string {
    if (val === null || val === undefined) {
        return 'NULL';
    }
    if (typeof val === 'object') {
        return JSON.stringify(val);
    }
    return String(val);
}

/** Uma linha de valores separada por tab (cola bem em planilhas). */
export function rowToTsv(row: CellValue[]): string {
    return row.map(displayValue).join('\t');
}

/** Matriz de valores separada por tab entre colunas e \n entre linhas. */
export function matrixToTsv(matrix: CellValue[][]): string {
    return matrix.map(rowToTsv).join('\n');
}

function needsCsvQuote(text: string): boolean {
    return text.includes(',') || text.includes('"') || text.includes('\n') || text.includes('\r');
}

function quoteCsvField(text: string): string {
    if (!needsCsvQuote(text)) {
        return text;
    }
    return `"${text.replace(/"/g, '""')}"`;
}

/** Linhas alvo formatadas como CSV (RFC 4180) com cabeçalho na primeira linha. */
export function toCSV(header: string[], matrix: CellValue[][]): string {
    const lines = [header.map(quoteCsvField).join(',')];
    for (const row of matrix) {
        lines.push(row.map(v => quoteCsvField(displayValue(v))).join(','));
    }
    return lines.join('\n');
}

function sqlLiteral(val: CellValue): string {
    if (val === null || val === undefined) {
        return 'NULL';
    }
    if (typeof val === 'number') {
        return Number.isFinite(val) ? String(val) : 'NULL';
    }
    if (typeof val === 'boolean') {
        return val ? 'TRUE' : 'FALSE';
    }
    const text = typeof val === 'object' ? JSON.stringify(val) : String(val);
    return `'${text.replace(/'/g, "''")}'`;
}

// O Wisp não sabe a tabela de origem de um resultado arbitrário (pode ser
// join, subquery, etc.), então o nome é um placeholder literal que o usuário
// troca à mão — documentado de propósito em vez de "adivinhar" errado.
export const INSERT_TABLE_PLACEHOLDER = 'table_name';

/** Linhas alvo como `INSERT INTO table_name (...) VALUES (...), (...);`. */
export function toInsertSQL(header: string[], matrix: CellValue[][], table = INSERT_TABLE_PLACEHOLDER): string {
    const cols = header.join(', ');
    const tuples = matrix.map(row => `(${row.map(sqlLiteral).join(', ')})`).join(', ');
    return `INSERT INTO ${table} (${cols}) VALUES ${tuples};`;
}

function escapeMarkdownCell(text: string): string {
    return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** Matriz alvo como tabela Markdown (cabeçalho + separador + dados). */
export function toMarkdownTable(header: string[], matrix: CellValue[][]): string {
    const head = `| ${header.map(escapeMarkdownCell).join(' | ')} |`;
    const separator = `| ${header.map(() => '---').join(' | ')} |`;
    const body = matrix.map(row => `| ${row.map(v => escapeMarkdownCell(displayValue(v))).join(' | ')} |`);
    return [head, separator, ...body].join('\n');
}

/**
 * Copia texto pra área de transferência. Tenta a API moderna primeiro;
 * webkit2gtk (Wails/Linux) pode não suportá-la no webview, então há fallback
 * pro `execCommand('copy')` via textarea temporário. Retorna true se copiou.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // Segue pro fallback abaixo.
    }
    try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.top = '-9999px';
        area.style.left = '-9999px';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(area);
        return ok;
    } catch {
        return false;
    }
}
