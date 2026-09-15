# ADR 0005 — Formatação de SQL via lib pronta (`sql-formatter`)

**Status:** Aceito
**Data:** 2026-09-15

## Contexto
Pretty-print de SQL (estilo "Format SQL" do DBeaver) era pendência da Fase 2. A regra do projeto ("sem parser SQL customizado", ver `docs/ARCHITECTURE.md`) existe para impedir que o Wisp implemente seu próprio parser/language-service para features como autocomplete — escrever um formatador próprio cairia no mesmo custo de manutenção sem benefício.

## Decisão
- Usar a lib npm **`sql-formatter`** (MIT, madura, tipada em TS) — versão instalada `15.8.2` — 100% no frontend, síncrona, sem binding novo no backend.
- Mapeamento de dialeto a partir do `driver` ativo da aba: `postgres` → `postgresql`, `sqlite` → `sqlite`, demais/indefinido → `sql` (genérico). Nomes confirmados contra `supportedDialects` da versão instalada.
- Botão "Formatar" na `.toolbar-secondary` do `ConsoleTab.tsx`; formata o editor inteiro (sem "formatar seleção" — escopo extra não pedido). Erro de parsing não trava a UI: mostra no `status` e mantém o conteúdo original intacto.

## Alternativas consideradas
- **Formatador/parser próprio**: rejeitado — viola a regra de não construir parser customizado e reinventa o que uma lib MIT madura já resolve. Análogo à decisão do ADR 0001 de usar Glide Data Grid pronto em vez de grid virtualizado próprio.
- **Formatação via backend Go**: rejeitado — sem lib Go madura equivalente e adicionaria round-trip IPC para algo puramente de apresentação.

## Consequências
- Dependência npm nova (verificada: fonte confiável, manutenção ativa, licença MIT).
- Sem opção de estilo de indentação configurável por enquanto — defaults da lib; só reabrir com pedido real do usuário.
