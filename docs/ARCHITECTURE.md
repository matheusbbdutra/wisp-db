# Wisp — Arquitetura

Cliente SQL desktop leve e nativo. Ver decisões formais em `docs/adr/`.

## Visão geral

```
+-----------------------------------------------------------------------+
|                         Frontend (Webview)                            |
|  - Monaco Editor (IntelliSense, syntax highlight, multi-cursor)       |
|  - Data Grid Virtualizado (Glide Data Grid, renderização em canvas)   |
|  - Painéis Reativos: Sidebar de Schemas, Histórico, Detalhes de Célula|
+-----------------------------------------------------------------------+
                                  ▲
                                  │ IPC (Wails Bindings & Events)
                                  ▼
+-----------------------------------------------------------------------+
|                          Backend (Go Core)                            |
|  - Session Manager: tabId -> (*sql.Conn, context.CancelFunc)          |
|  - DatabaseDriver (Strategy): pgx, clickhouse-go, go-duckdb*, sqlite  |
|  - Streaming / Chunk Fetcher: {columns, types, rows} sem duplicação   |
|  - SSH Tunneling nativo via crypto/ssh                                |
|  - Local Store: SQLite (modernc.org/sqlite) — credenciais cifradas,  |
|    histórico, schema_cache                                            |
+-----------------------------------------------------------------------+
```
`*` go-duckdb é a única exceção CGO da matriz de drivers — ver ADR 0002.

## Módulos e responsabilidades

| Módulo | Responsabilidade | Decisão-chave |
|---|---|---|
| Session Manager | 1 `tabId` = 1 `*sql.Conn` + 1 `context.CancelFunc` isolados | Sem pool compartilhado entre abas |
| DatabaseDriver (interface) | Abstrai execução/introspecção por dialeto | Strategy pattern, uma impl. por banco |
| Chunk Fetcher | Serializa resultado em `{columns, types, rows}` | Evita `[]map[string]any` (overhead JSON) |
| Schema Cache | Metadados de catálogo em 2 camadas (memória + SQLite) | TTL + invalidação manual + invalidação por DDL detectado |
| Local Store | Conexões, histórico, cache — tudo em SQLite | Nunca JSON solto; nunca Turso (sem caso de sync) |
| SSH Tunnel | Túnel TCP local via `crypto/ssh` | Sem binário externo do SO |
| Credential Vault | Cifra credenciais, chave mestra no keychain do SO | Nunca texto puro em disco |

## Fluxo de execução de query (streaming real, não tudo de uma vez)

Implementado assim porque rodar `SELECT *` numa tabela de milhões de linhas
não pode carregar tudo em memória Go nem transferir tudo pro frontend de
uma vez — precisa de fetch sob demanda em lotes, como o "fetch size"
configurável de clientes como o DBeaver (padrão 200 linhas por lote, editável).

1. Usuário dispara execução na aba (`tabId`) → binding `RunQuery(tabId, sql)`.
2. Backend cria um `QueryCtx` novo pra essa execução (derivado do `Ctx` da
   sessão, ver `session.Manager.StartQuery`) e chama
   `driver.ExecuteStreaming(ctx, sql)`, que abre o cursor no banco (`*sql.Rows`
   no SQLite, `pgx.Rows` no Postgres) e retorna só as colunas/tipos — nenhuma
   linha é buscada ainda. A duração dessa etapa (execução no servidor) já é
   gravada no histórico de queries (`query_history`, `row_count` inicial 0).
3. Frontend chama `FetchRows(tabId, batchSize)` repetidamente — cada chamada
   busca até `batchSize` linhas do cursor aberto (`driver.FetchNext`) e
   retorna `{rows, hasMore}`. A primeira leva é automática (mesmo tamanho
   configurado); as próximas exigem clique explícito em "Carregar mais" —
   nunca busca tudo sozinho.
4. Quando o cursor se esgota (`hasMore=false`) ou dá erro no meio do fetch, o
   histórico gravado no passo 2 é atualizado (`store.FinishQuery`) com o
   total real de linhas buscadas e o status final.
5. Botão "Cancelar" (`CancelQuery`) cancela o `QueryCtx` daquela query
   específica (não a sessão inteira — dá pra rodar outra query em seguida
   sem reconectar) **e** dispara o cancelamento nativo do driver (`pgx`
   `CancelRequest`). A ordem importa: cancelar no servidor primeiro e só
   depois fechar o cursor localmente evita que o driver fique drenando o
   resultado restante pela rede antes de fechar — medido na prática: só
   fechar o cursor de uma query de 5 milhões de linhas levou ~1.5s, cancelar
   no servidor primeiro e então fechar levou ~11ms.
6. `ExecuteStreaming` fecha automaticamente qualquer cursor anterior ainda
   aberto na mesma conexão antes de abrir um novo (nunca dois cursores vivos
   ao mesmo tempo numa aba).

## Fluxo de metadados/schema

1. Ao expandir nó na sidebar (schema → tabelas → colunas), backend verifica `schema_cache` (SQLite) com TTL.
2. Cache válido → retorna direto, sem round-trip ao banco externo.
3. Cache expirado/ausente → fetch incremental via catálogo nativo do dialeto (`information_schema`, `pg_catalog`, `duckdb_tables()`, `system.tables`), grava no cache.
4. DDL detectado na própria aba (parse do primeiro token: `CREATE|ALTER|DROP`) invalida o cache daquela conexão imediatamente.

## Fronteiras de segurança (ver também CLAUDE.md)

- Toda credencial passa por `Credential Vault` antes de tocar disco.
- Edição inline só é permitida com PK real detectada via catálogo — nunca heurística.
- SSH tunnel valida host key por padrão; desabilitar exige ação explícita do usuário com aviso.

## O que fica fora de escopo (decisões descartadas com justificativa)

- **Turso/libSQL remoto**: sem caso de uso de sync multi-dispositivo no escopo atual.
- **Busca vetorial/embeddings**: busca de schema é exata; sem necessidade de busca semântica.
- **Aceleração por GPU em pipeline de dados**: nenhum hot path identificado fora da renderização do grid (que já usa canvas).
- **Parser SQL customizado**: autocomplete depende de metadados de catálogo + eventos de digitação do Monaco, não de parsing próprio.
