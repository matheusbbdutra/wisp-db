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

## Fase 2.6 — Exploração de schema / View Data + Copiar ✅ concluída (2026-09-15)
- ✅ Edição inline de células — ADR 0004, com PK real via introspecção (nunca heurística), checagem otimista de concorrência.
- ✅ Tabela como aba própria (Dados/DDL/Triggers/Funções por tabela), Schema como aba própria (lista de tabelas), abre por ↗ ou Ctrl+click (sidebar e dentro do editor SQL).
- ✅ Copiar especial no grid de resultados (célula/linha/seleção, CSV/INSERT SQL/Markdown).
- ✅ **Release v0.1.0-beta.1 publicada** (github.com/matheusbbdutra/wisp-db).

## Fase 3 — Fechar o gap de migração DBeaver (próxima leva, priorizada em 2026-09-15)
Análise feita via Cursor Agent + OpenCode (independentes) + ponderação própria —
ver memória `wisp-next-features-analysis-2026-09-15`. Convergência das duas
análises: o maior gap restante pra substituir o DBeaver no dia a dia não é
integração com agentes nem query builder, é exploração de objetos + ergonomia
de inspeção de dados. Ordem sugerida (a confirmar com o usuário antes de
implementar cada item):
1. **Índices, FKs e distinguir Views de tabelas** na exploração de schema — hoje `ListTables`/`TableDDL` não expõem isso; é o que mais se sente faltando ao abrir uma tabela desconhecida. Esforço médio, risco baixo/médio.
2. **Ganhos rápidos de ergonomia**: visor de valor de célula pra texto longo/JSON(B) hoje truncado no grid; filtro rápido na TableTab; busca na árvore da sidebar (schemas com muitas tabelas). Todos pequenos, risco baixo.
3. **EXPLAIN / plano de execução** (v1 textual, `EXPLAIN ANALYZE` renderizado — sem grafo visual ainda).
4. **INSERT/DELETE de linha no grid** (fecha o ciclo da edição inline/ADR 0004 — hoje só `UpdateCell`). Mesmas regras de PK real e preview; sem PK, read-only. Risco médio.
5. **Verificador de atualização** (checagem manual/ao abrir, sem download automático): consulta a API do GitHub Releases (`/repos/.../releases/latest`), compara com a versão embutida no binário, mostra aviso com link se houver uma mais nova. Wails não tem updater nativo (diferente de Electron `autoUpdater`/Tauri updater) — escopo v1 é só avisar, nunca baixar/substituir o binário sozinho. Esforço pequeno, risco baixo (só leitura de uma API pública, sem tocar em nada crítico).

**✅ Concluído fora da ordem acima** (pedido direto do usuário em 2026-09-15,
publicado na v0.1.0-beta.2): abas de resultado (múltiplas execuções sem
sobrescrever resultado anterior, limite 10), fila de execução (Executar
enfileira em vez de bloquear), painéis redimensionáveis por arrasto
(sidebar, split editor/grid). Ver memória `wisp-result-tabs-queue-resizable-panels`.

Fora da próxima leva, mas registrado por diverger entre as duas análises (não
descartado, só sem evidência de demanda ainda):
- **Driver MySQL** (ou outro dialeto): o projeto é open source e vai crescer
  além do uso do autor (hoje só Postgres/SQLite), então isso deve voltar à
  mesa conforme aparecer demanda real de outros usuários — não implementar
  especulativamente antes disso.
- **Transação explícita** (toggle de autocommit, commit/rollback manual): a
  análise mais aprofundada (OpenCode) marcou como o item de maior risco
  arquitetural do lote — mexe em invariante do Session Manager (o que
  acontece com um cursor de streaming aberto dentro de uma transação).
  Desenhar com calma, só depois do restante da Fase 3 estabilizar.
- Integração com agentes de terminal via servidor MCP — escopo ainda a
  desenhar melhor; as duas análises concordam que isso não resolve nenhum
  gap de migração do DBeaver e deve ficar em exploração, não na fila ativa.
- Exportador de datasets grandes (CSV, JSON, Parquet) — as duas análises
  divergiram na prioridade (uma diz subir, outra diz manter baixo por já
  haver cópia especial pra área de transferência); mantido como baixa
  prioridade até haver sinal mais forte de uso real.

## Fase 4+ — Explorações futuras (não comprometidas)
- Query builder visual (Strategy por dialeto SQL) — as duas análises da Fase 3 concordam: irrelevante pra quem já escreve SQL, só entra em planejamento real após a Fase 3 estável e com demanda validada.
- Busca semântica sobre histórico de queries (`sqlite-vec`, nunca serviço vetorial externo) — só se houver demanda real validada.
- Sync de conexões salvas entre dispositivos (reabriria avaliação de Turso) — só se houver demanda real validada.
- **Túnel SSH integrado no fluxo de conexão** (`crypto/ssh`) — o projeto já será open source (não é um "se"), mas isso não torna a feature urgente: o primeiro usuário é o próprio autor, que já tem VPN cobrindo o acesso a bancos atrás de firewall. Fica na fila, despriorizada até haver demanda real (própria ou de outro usuário do projeto).
- DuckDB (ADR 0002) — CGO + CI nativa por OS é esforço grande; só entra em planejamento real se surgir um caso de uso analítico de verdade, não como "substituto do DBeaver".

## Fora de escopo (decisão ativa, não esquecimento)
- Aceleração por GPU em pipeline de dados — nenhum hot path identificado.
- Parser SQL customizado.
- Qualquer dependência de rede para funcionalidade core (o app funciona 100% offline exceto pela própria conexão ao banco do usuário).
