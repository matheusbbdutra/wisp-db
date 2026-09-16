// Prefixa a query com EXPLAIN do dialeto certo — usado pelo botão "Explain"
// do console (ConsoleTab.tsx), que reaproveita o pipeline normal de
// execução (handleRun/RunQuery/ResultGrid): o resultado de um EXPLAIN é só
// mais um conjunto de linhas de texto, não precisa de UI nova nenhuma.
//
// Deliberadamente NUNCA usa EXPLAIN ANALYZE (Postgres) — ANALYZE executa a
// query de verdade, então rodar "só pra ver o plano" numa query de escrita
// (UPDATE/DELETE/INSERT) executaria a escrita de verdade. EXPLAIN sozinho
// (sem ANALYZE) só mostra as estimativas do planner, nunca roda a query.
export function explainQuery(text: string, driver: string | undefined): string {
    // Remove ; e espaço em branco do fim — EXPLAIN só aceita UM statement
    // logo em seguida; múltiplos statements separados por ; não são
    // suportados aqui (mesma limitação de "sem parser SQL" do resto do app).
    const trimmed = text.trim().replace(/;+\s*$/, '');
    if (driver === 'sqlite') {
        return `EXPLAIN QUERY PLAN ${trimmed}`;
    }
    // Postgres (e fallback genérico): EXPLAIN puro é sintaxe ANSI-ish comum
    // o bastante pra servir de default razoável mesmo sem dialeto confirmado.
    return `EXPLAIN ${trimmed}`;
}
