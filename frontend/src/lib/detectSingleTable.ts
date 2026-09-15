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
    // "forCounting": só pra CONTAR keywords (SELECT/FROM/JOIN/...) — aqui é
    // seguro (e necessário) apagar TANTO strings ('...') QUANTO identificadores
    // quotados ("..."), pra não confundir um valor ou nome de coluna com
    // estrutura real da query (ex. WHERE nome = 'select from join').
    const forCounting = query
        .replace(/'(?:[^']|'')*'/g, "''")
        .replace(/"(?:[^"]|"")*"/g, '""')
        .replace(/--[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim()
        .replace(/;+\s*$/, '')
        .trim();

    if (!/^\s*select\b/i.test(forCounting)) {
        return null;
    }
    const countKeyword = (re: RegExp): number => forCounting.match(re)?.length ?? 0;
    // Um único SELECT (sem subquery/CTE) e um único FROM (sem join implícito
    // por vírgula tratado aqui — FROM a, b cai no "sem alias simples" abaixo
    // ou no pós-match; o ponto é nunca adivinhar).
    if (countKeyword(/\bselect\b/gi) !== 1 || countKeyword(/\bfrom\b/gi) !== 1) {
        return null;
    }
    if (/\b(join|union|intersect|except|with)\b/i.test(forCounting)) {
        return null;
    }

    // "forExtraction": pra ler schema/tabela precisamos PRESERVAR
    // identificadores quotados (aspas duplas = identificador em SQL, nunca
    // string literal — bug real corrigido: a versão anterior apagava
    // "schema" antes de extrair, então "schema".tabela nunca funcionava e
    // schema.tabela sem aspas também não era nem tentado). Só strings
    // literais (aspas simples) e comentários são removidos aqui.
    const forExtraction = query
        .replace(/'(?:[^']|'')*'/g, "''")
        .replace(/--[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim()
        .replace(/;+\s*$/, '')
        .trim();

    // Schema opcional aceita COM ou SEM aspas.
    const m = forExtraction.match(/\bfrom\s+(?:(?:"([^"]+)"|([A-Za-z_][\w$]*))\s*\.\s*)?(?:"([^"]+)"|([A-Za-z_][\w$]*))\s*(.*)$/is);
    if (!m) {
        return null;
    }
    const schema = m[1] ?? m[2] ?? null;
    const table = m[3] ?? m[4];
    let rest = (m[5] ?? '').trim();

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
