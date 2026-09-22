// ============================================================================
// INVARIANTE DO PROJETO (AGENTS.md #8 / ARCHITECTURE.md):
// NUNCA simplificar este módulo para regex relativo ou remover o scanner de ranges.
// A execução no PostgreSQL (pgx) e em drivers relacionais rejeita múltiplos comandos
// colados com "ERROR: syntax error at or near SELECT". Qualquer alteração aqui DEVE
// passar pelos testes de frontend/src/lib/sqlStatements.test.ts e ser validada empiricamente.
// ============================================================================

export interface StatementRange {
    text: string;
    start: number;
    end: number;
}


/**
 * Divide o texto do editor SQL em declarações individuais.
 *
 * Delimitadores suportados:
 * 1. Ponto e vírgula (';') fora de strings ('...') e comentários (-- ou /* ... * /).
 * 2. Linhas em branco (uma ou mais linhas contendo apenas espaços/tabs entre quebras de linha).
 *
 * Preserva integridade de:
 * - Aspas simples '...' (incluindo aspas escapadas '' e \')
 * - Comentários de linha -- ...
 * - Comentários de bloco /* ... * /
 */
export function splitStatements(full: string): StatementRange[] {
    const statements: StatementRange[] = [];
    let inString = false;
    let inComment = false;
    let inBlockComment = false;
    let lastIndex = 0;

    for (let i = 0; i < full.length; i++) {
        const ch = full[i];
        const next = full[i + 1] || '';

        // Comentário de bloco /* ... */
        if (!inString && !inComment && !inBlockComment && ch === '/' && next === '*') {
            inBlockComment = true;
            i++;
            continue;
        }
        if (inBlockComment) {
            if (ch === '*' && next === '/') {
                inBlockComment = false;
                i++;
            }
            continue;
        }

        // Comentário de linha -- ...
        if (!inString && !inComment && ch === '-' && next === '-') {
            inComment = true;
            i++;
            continue;
        }
        if (inComment) {
            if (ch === '\n') {
                inComment = false;
            }
            continue;
        }

        // String '...'
        if (ch === "'") {
            if (inString && next === "'") {
                // Aspa simples escapada em SQL: ''
                i++;
                continue;
            }
            inString = !inString;
            continue;
        }
        if (inString) {
            if (ch === '\\') {
                // Escape de barra invertida \'
                i++;
            }
            continue;
        }

        // Delimitador 1: ';'
        if (ch === ';') {
            const text = full.slice(lastIndex, i).trim();
            if (text) {
                statements.push({text, start: lastIndex, end: i + 1});
            }
            lastIndex = i + 1;
            continue;
        }

        // Delimitador 2: linha em branco (newline + whitespace + newline)
        if (ch === '\n') {
            let j = i + 1;
            while (j < full.length && (full[j] === ' ' || full[j] === '\t' || full[j] === '\r')) {
                j++;
            }
            if (j < full.length && full[j] === '\n') {
                const text = full.slice(lastIndex, i).trim();
                if (text) {
                    statements.push({text, start: lastIndex, end: j + 1});
                }
                lastIndex = j + 1;
                i = j;
                continue;
            }
        }
    }

    const trailing = full.slice(lastIndex).trim();
    if (trailing) {
        statements.push({text: trailing, start: lastIndex, end: full.length});
    }

    return statements;
}

/**
 * Retorna os limites exatos do statement SQL associado ao offset para fins de formatação
 * ou substituição pontual, excluindo whitespaces intermediários das pontas mas preservando
 * terminadores como ';' caso existam.
 */
export function resolveStatementTargetAtOffset(full: string, offset: number): StatementRange | null {
    const stmts = splitStatements(full);
    if (stmts.length === 0) {
        const trimmed = full.trim();
        if (!trimmed) return null;
        let start = 0;
        while (start < full.length && /\s/.test(full[start])) start++;
        let end = full.length;
        while (end > start && /\s/.test(full[end - 1])) end--;
        return { text: full.slice(start, end), start, end };
    }

    let target: StatementRange | null = null;

    // 1. Cursor contido dentro do range [start, end]
    for (const s of stmts) {
        if (offset >= s.start && offset <= s.end) {
            target = s;
            break;
        }
    }

    // 2. Cursor em linhas em branco / espaçamento intermediário:
    if (!target) {
        for (let i = stmts.length - 1; i >= 0; i--) {
            if (offset >= stmts[i].start) {
                target = stmts[i];
                break;
            }
        }
    }

    // 3. Fallback se estiver antes do primeiro statement
    if (!target) {
        target = stmts[0];
    }

    let start = target.start;
    while (start < target.end && /\s/.test(full[start])) {
        start++;
    }
    let end = target.end;
    while (end > start && /\s/.test(full[end - 1])) {
        end--;
    }

    if (start >= end) {
        return null;
    }

    const text = full.slice(start, end);
    return { text, start, end };
}

/**
 * Retorna o comando SQL correspondente à posição atual do cursor (offset).
 * Se o cursor estiver exatamente sobre um statement ou logo após o seu delimitador/whitespace,
 * retorna aquele statement isolado (nunca o buffer inteiro com múltiplos statements).
 */
export function resolveStatementAtOffset(full: string, offset: number): string {
    const stmts = splitStatements(full);
    if (stmts.length === 0) return full.trim();

    // 1. Cursor contido dentro do range [start, end]
    for (const s of stmts) {
        if (offset >= s.start && offset <= s.end) {
            return s.text;
        }
    }

    // 2. Cursor em linhas em branco / espaçamento intermediário:
    // retorna o statement imediatamente anterior ao offset.
    for (let i = stmts.length - 1; i >= 0; i--) {
        if (offset >= stmts[i].start) {
            return stmts[i].text;
        }
    }

    // 3. Fallback se estiver antes do primeiro statement
    return stmts[0].text;
}
