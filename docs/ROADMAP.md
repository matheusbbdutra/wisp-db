# Wisp — Roadmap

Ver `docs/ARCHITECTURE.md` e ADRs em `docs/adr/` para o racional de cada decisão citada aqui.

## Fase 1 — MVP funcional ✅ concluída (2026-09-15)
- ✅ Conexão nativa com PostgreSQL e SQLite local (DuckDB ainda não implementado, ver ADR 0002).
- ✅ Execução de queries com `tabId` dedicado e cancelamento real nativo (não só ctx local — ver memória `pgx-context-cancel-closes-connection`).
- ✅ Grid virtualizado (Glide Data Grid), fetch em streaming real (cursor, não full-scan), paginação configurável (default 200, "Carregar mais").
- ✅ Local Store SQLite: conexões cifradas, histórico de queries.
- ✅ **Critério de performance medido de verdade**: RAM idle ~158-164MB (meta <500MB).

## Fase 2 — Produtividade & Autocomplete (parcial)
- ✅ Sidebar com árvore lazy de schemas/tabelas.
- ✅ Schema cache em duas camadas, TTL + invalidação manual/DDL.
- ✅ Histórico de queries persistido, painel na UI.
- ❌ Autocomplete no Monaco via schema cache — pendente.
- ❌ Formatação de SQL (pretty-print) — pendente.

## Fase 2.5 — Multi-console e organização (nova, combinada com o usuário em 2026-09-15)
- Múltiplas abas/consoles (backend já suporta via Session Manager, falta UI).
- Salvar scripts SQL nomeados (diferente do histórico automático).
- Abrir tabela como aba própria (estilo "view data"), incluindo ver DDL/triggers/funções.

## Fase 3 — Recursos avançados
- Túnel SSH integrado no fluxo de conexão (`crypto/ssh`) — pendente.
- Edição inline de células — **escopo restrito conforme ADR 0004** — pendente.
- Exportador de datasets grandes (CSV, JSON, Parquet) — pendente.
- Integração com agentes de terminal via servidor MCP exposto pelo Wisp — deixado por último a pedido do usuário, escopo grande/arquitetura nova.

## Fase 4+ — Explorações futuras (não comprometidas)
- Query builder visual (Strategy por dialeto SQL) — só entra em planejamento real após Fase 3 estável.
- Busca semântica sobre histórico de queries (`sqlite-vec`, nunca serviço vetorial externo) — só se houver demanda real validada.
- Sync de conexões salvas entre dispositivos (reabriria avaliação de Turso) — só se houver demanda real validada.

## Fora de escopo (decisão ativa, não esquecimento)
- Aceleração por GPU em pipeline de dados — nenhum hot path identificado.
- Parser SQL customizado.
- Qualquer dependência de rede para funcionalidade core (o app funciona 100% offline exceto pela própria conexão ao banco do usuário).
