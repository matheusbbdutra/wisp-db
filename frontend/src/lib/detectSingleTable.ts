export interface SingleTableRef {
    schema: string | null;
    table: string;
}

// Detecta a tabela-fonte de uma query só quando ela é um SELECT simples de
// tabela única — mesmo espírito da inspeção de string já usada no narrowing
// do autocomplete, não um parser SQL (ver docs/ARCHITECTURE.md, "sem parser
// SQL customizado"). Qualquer padrão fora disso retorna null e o grid fica
// read-only por omissão (comportamento seguro, não erro).
//
// Aceita: SELECT ... FROM [schema.]tabela [alias] [WHERE ...] [ORDER ...]
//   [LIMIT ...] [OFFSET ...] [GROUP BY ...] [HAVING ...]
// Rejeita: JOIN, UNION/INTERSECT/EXCEPT, subquery (2º SELECT), WITH/CTE,
//   múltiplos FROM, INSERT/UPDATE/DELETE/DDL.
export function detectSingleTable(query: string): SingleTableRef | null {
    // Remove strings literais antes de contar keywords, pra não confundir
    // ex. WHERE nome = 'select from join' com estrutura real da query.
    const withoutStrings = query.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
    // Remove comentários de linha e de bloco pelo mesmo motivo.
    const code = withoutStrings
        .replace(/--[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim()
        .replace(/;+\s*$/, '')
        .trim();

    if (!/^\s*select\b/i.test(code)) {
        return null;
    }
    const countKeyword = (re: RegExp): number => code.match(re)?.length ?? 0;
    // Um único SELECT (sem subquery/CTE) e um único FROM (sem join implícito
    // por vírgula tratado aqui — FROM a, b cai no "sem alias simples" abaixo
    // ou no pós-match; o ponto é nunca adivinhar).
    if (countKeyword(/\bselect\b/gi) !== 1 || countKeyword(/\bfrom\b/gi) !== 1) {
        return null;
    }
    if (/\b(join|union|intersect|except|with)\b/i.test(code)) {
        return null;
    }

    const m = code.match(/\bfrom\s+(?:"([^"]+)"\s*\.\s*)?"?([A-Za-z_][\w$]*)"?\s*(.*)$/is);
    if (!m) {
        return null;
    }
    const schema = m[1] ?? null;
    const table = m[2];
    let rest = (m[3] ?? '').trim();

    // Resto permitido: alias simples opcional + cláusulas de leitura
    // (WHERE/GROUP/ORDER/LIMIT/OFFSET/HAVING) ou fim. Qualquer outra coisa
    // (ex. segunda tabela por vírgula, parêntese de subquery/função de
    // tabela) → read-only por omissão.
    if (rest.startsWith('(')) {
        return null;
    }
    const aliasMatch = rest.match(/^(?:as\s+)?([A-Za-z_][\w$]*)\s*(.*)$/is);
    if (aliasMatch && !/^(where|group|order|limit|offset|having|for|fetch)$/i.test(aliasMatch[1])) {
        rest = aliasMatch[2].trim();
    }
    if (rest !== '' && !/^(where|group|order|limit|offset|having|for|fetch)\b/is.test(rest)) {
        return null;
    }
    return {schema, table};
}
