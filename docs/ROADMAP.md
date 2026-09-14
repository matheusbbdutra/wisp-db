# Wisp — Roadmap

Ver `docs/ARCHITECTURE.md` e ADRs em `docs/adr/` para o racional de cada decisão citada aqui.

## Fase 1 — MVP funcional
- Conexão nativa com PostgreSQL e DuckDB/SQLite local (ver ADR 0002 para política CGO do DuckDB).
- Execução de queries com `tabId` dedicado (`*sql.Conn` + `context.CancelFunc` isolados) e botão de cancelamento real (não só na UI — cancelamento nativo no servidor).
- Renderização de resultados em grid virtualizado (Glide Data Grid), limite padrão de 200 linhas, com paginação/streaming.
- Local Store SQLite funcional: conexões salvas com credenciais cifradas (chave mestra no keychain do SO), sem histórico ainda.
- **Critério de aceite de performance** (medido, não assumido): RAM idle com 1 conexão ativa, sem grid grande carregado, abaixo de 500MB. Startup até UI interativa sub-segundo.

## Fase 2 — Produtividade & Autocomplete
- Sidebar com árvore de bancos/schemas/tabelas, introspecção lazy (sob demanda por nó expandido).
- Schema cache em duas camadas (memória + SQLite `schema_cache`), TTL configurável + invalidação manual + invalidação por DDL detectado na própria aba.
- Autocomplete no Monaco Editor alimentado pelo schema cache (sem parser SQL customizado).
- Histórico de queries executadas (tempo, status, texto da query) persistido em SQLite.
- Formatação de SQL (pretty-print) via lib no frontend (ex. `sql-formatter`).

## Fase 3 — Recursos avançados
- Túnel SSH integrado no fluxo de conexão (`crypto/ssh`, suporte a `ssh-agent`, `known_hosts` custom, verificação de host key ativa por padrão).
- Edição inline de células — **escopo restrito conforme ADR 0004**: só tabelas com PK real detectada via catálogo, preview do SQL gerado antes de commitar, checagem otimista de concorrência.
- Exportador de datasets grandes (CSV, JSON, Parquet) via streaming em disco, sem carregar tudo em memória.

## Fase 4+ — Explorações futuras (não comprometidas)
- Query builder visual (Strategy por dialeto SQL) — só entra em planejamento real após Fase 3 estável.
- Busca semântica sobre histórico de queries (`sqlite-vec`, nunca serviço vetorial externo) — só se houver demanda real validada.
- Sync de conexões salvas entre dispositivos (reabriria avaliação de Turso) — só se houver demanda real validada.

## Fora de escopo (decisão ativa, não esquecimento)
- Aceleração por GPU em pipeline de dados — nenhum hot path identificado.
- Parser SQL customizado.
- Qualquer dependência de rede para funcionalidade core (o app funciona 100% offline exceto pela própria conexão ao banco do usuário).
