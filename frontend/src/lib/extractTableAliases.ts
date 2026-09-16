export interface AliasedTable {
    schema: string | null;
    table: string;
}

// Extrai aliases de tabela (FROM/JOIN tabela [AS] alias) da query inteira —
// mesmo espírito de inspeção de string sem parser SQL de detectSingleTable.ts
// (ver docs/ARCHITECTURE.md, "sem parser SQL customizado"). Usado só pelo
// autocomplete (SqlEditor.tsx): resolver "c." pra "customers" quando a query
// tem "FROM customers c" ou "FROM customers AS c", inclusive com JOINs.
//
// Limitação aceita: só reconhece UMA tabela por FROM/JOIN (não separa lista
// por vírgula do JOIN implícito antigo, "FROM a, b" — estilo raro no SQL
// moderno; usar JOIN explícito). Subquery/CTE como fonte ("FROM (SELECT...)
// alias") não é reconhecida — a entrada correspondente é simplesmente
// omitida do mapa, sem erro.
export function extractTableAliases(query: string): Map<string, AliasedTable> {
    // Mesma limpeza de detectSingleTable.ts: apaga strings literais e
    // comentários, mas PRESERVA identificadores quotados (aspas duplas).
    const cleaned = query
        .replace(/'(?:[^']|'')*'/g, "''")
        .replace(/--[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');

    const result = new Map<string, AliasedTable>();
    // O lookahead inclui os modificadores de tipo de JOIN (LEFT/INNER/...)
    // como fronteira também — sem isso, "FROM customers c LEFT JOIN orders"
    // vira um chunk "customers c LEFT" (3 tokens, não bate no padrão
    // tabela+alias) só porque LEFT antecede o JOIN seguinte, não faz parte
    // da cláusula FROM atual. Bug real pego pelo próprio teste desta função.
    const clauseRe = /\b(from|join)\b\s+([\s\S]*?)(?=\b(?:from|join|where|on|using|group|order|having|limit|offset|union|intersect|except|natural|lateral|inner|outer|left|right|full|cross)\b|;|$)/gi;

    let clauseMatch: RegExpExecArray | null;
    while ((clauseMatch = clauseRe.exec(cleaned)) !== null) {
        const chunk = clauseMatch[2].trim();
        // "(" logo após FROM/JOIN é subquery — não tenta extrair, pula.
        if (chunk === '' || chunk.startsWith('(')) continue;

        const tableRe = /^(?:"([^"]+)"|([A-Za-z_][\w$]*))(?:\s*\.\s*(?:"([^"]+)"|([A-Za-z_][\w$]*)))?\s*(?:(?:as\s+)?(?:"([^"]+)"|([A-Za-z_][\w$]*)))?$/i;
        const m = chunk.match(tableRe);
        if (!m) continue;

        const first = m[1] ?? m[2];
        const second = m[3] ?? m[4];
        const aliasRaw = m[5] ?? m[6];
        // Sem qualificação de schema: first É a tabela. Com qualificação
        // ("schema.tabela"): first é o schema, second é a tabela.
        const schema = second !== undefined ? first : null;
        const table = second !== undefined ? second : first;
        if (!table) continue;

        // Alias que na verdade é uma palavra reservada (a cláusula seguinte
        // começa logo ali, ex. "FROM customers WHERE..." — mas "WHERE" já é
        // fronteira do regex acima, então isso só filtra remanescentes tipo
        // "NATURAL"/"LATERAL" que não são fronteira própria).
        if (aliasRaw && /^(natural|lateral|inner|outer|left|right|full|cross)$/i.test(aliasRaw)) continue;

        const alias = (aliasRaw ?? table).toLowerCase();
        result.set(alias, {schema: schema ?? null, table});
    }
    return result;
}
