# Wisp — Roadmap

Ver `docs/ARCHITECTURE.md` e ADRs em `docs/adr/` para o racional de cada decisão citada aqui.

## Fase 1 — MVP funcional ✅ concluída (2026-09-15)
- ✅ Conexão nativa com PostgreSQL e SQLite local (DuckDB ainda não implementado, ver ADR 0002).
- ✅ Execução de queries com `tabId` dedicado e cancelamento real nativo (não só ctx local — ver memória `pgx-context-cancel-closes-connection`).
- ✅ Grid virtualizado (Glide Data Grid), fetch em streaming real (cursor, não full-scan), paginação configurável (default 200, "Carregar mais").
- ✅ Local Store SQLite: conexões cifradas, histórico de queries.
- ✅ **Critério de performance medido de verdade**: RAM idle ~158-164MB (meta <500MB).

## Fase 2 — Produtividade & Autocomplete
- ✅ Sidebar com árvore lazy de schemas/tabelas.
- ✅ Schema cache em duas camadas, TTL + invalidação manual/DDL.
- ✅ Histórico de queries persistido, painel na UI.
- ✅ Autocomplete no Monaco via schema cache — concluído em 2026-09-15 (schemas, tabelas, colunas, keywords, funções por dialeto, narrowing por ponto).
- ✅ Formatação de SQL (pretty-print) — concluída em 2026-09-15: botão "Formatar" na toolbar do `ConsoleTab.tsx` via lib `sql-formatter` (ver ADR 0005).

## Fase 2.5 — Multi-console e organização ✅ concluída (2026-09-15)
- ✅ Múltiplas abas/consoles (Session Manager isola por `tabId`, UI de tabs em `App.tsx`/`ConsoleTab.tsx`).
- ✅ Salvar scripts SQL nomeados (diferente do histórico automático) — `ScriptsPanel.tsx`.

## Fase 2.6 — Exploração de schema / View Data + Copiar (nova, combinada com o usuário em 2026-09-15)
Escopo mais amplo do que o item original "tabela como aba própria" — inclui navegação de schema além de uma única tabela, mais a feature de copiar (uso frequente do usuário no dia a dia, priorizada junto por tocar no mesmo grid/exploração de dados).
- Abrir tabela como aba própria (estilo "view data" do DBeaver), incluindo dados, DDL, triggers e funções da tabela.
- Navegar/listar tabelas de um schema a partir dessa exploração (não só a árvore lazy da sidebar).
- **Copiar especial no grid de resultados** (estilo DBeaver): menu de contexto com copiar célula única, copiar linha inteira, copiar seleção de várias células, e formatar como CSV/INSERT SQL/Markdown.
- Demais detalhes (ex.: views, índices) a definir conforme necessidade real ao implementar — não especular além do que o usuário use no dia a dia.

## Fase 3 — Recursos avançados
- Edição inline de células — **escopo restrito conforme ADR 0004** — pendente.
- Integração com agentes de terminal via servidor MCP exposto pelo Wisp — escopo ainda a desenhar melhor com o usuário antes de entrar em implementação (arquitetura nova, não é só "próximo item da fila").
- Exportador de datasets grandes (CSV, JSON, Parquet) — baixa prioridade, usuário raramente usa; fica na fila mas sem pressa.

## Fase 4+ — Explorações futuras (não comprometidas)
- Query builder visual (Strategy por dialeto SQL) — só entra em planejamento real após Fase 3 estável.
- Busca semântica sobre histórico de queries (`sqlite-vec`, nunca serviço vetorial externo) — só se houver demanda real validada.
- Sync de conexões salvas entre dispositivos (reabriria avaliação de Turso) — só se houver demanda real validada.
- **Túnel SSH integrado no fluxo de conexão** (`crypto/ssh`) — o projeto já será open source (não é um "se"), mas isso não torna a feature urgente: o primeiro usuário é o próprio autor, que já tem VPN cobrindo o acesso a bancos atrás de firewall. Fica na fila, despriorizada até haver demanda real (própria ou de outro usuário do projeto).

## Fora de escopo (decisão ativa, não esquecimento)
- Aceleração por GPU em pipeline de dados — nenhum hot path identificado.
- Parser SQL customizado.
- Qualquer dependência de rede para funcionalidade core (o app funciona 100% offline exceto pela própria conexão ao banco do usuário).
