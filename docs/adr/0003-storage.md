# ADR 0003 — Storage interno: SQLite (não JSON, não Turso), sem vetor

**Status:** Aceito
**Data:** 2026-09-14

## Contexto
O Wisp precisa persistir localmente: conexões salvas (com credenciais), histórico de queries executadas, e cache de metadados de schema (catálogo de tabelas/colunas por conexão).

## Decisão
- **SQLite via `modernc.org/sqlite`** (puro Go, sem CGO) para todo o store interno.
- **Não JSON solto em disco**: falta atomicidade transacional (risco de corrupção em crash no meio de um write) e não escala bem para consulta filtrada (histórico por data/conexão/status).
- **Não Turso/libSQL**: Turso resolve sync distribuído/multi-réplica, cenário que não existe no escopo atual (app é local, single-user, single-process). Adotá-lo introduziria dependência de rede e complexidade operacional sem necessidade real.
- **Sem busca vetorial/embeddings** no cache de schema: a busca de tabelas/colunas é exata ou prefix-match; FTS5 nativo do SQLite cobre busca fuzzy por nome se necessário. Embeddings adicionariam custo de geração/indexação sem ganho no caso de uso.

## Schema inicial (referência, sujeito a migração)
```sql
connections(id, name, driver, host, port, database, username, encrypted_secret, ssh_tunnel_config, created_at)
query_history(id, connection_id, tab_id, query_text, executed_at, duration_ms, status, row_count)
schema_cache(connection_id, catalog_json, fetched_at, ttl_expires_at)
```
- `encrypted_secret`: cifrado com chave derivada; chave mestra fica no keychain do SO (`go-keyring` ou equivalente), nunca em texto plano no SQLite.
- `catalog_json`: blob JSON por conexão — aceitável aqui porque é write-once/read-often por conexão, não uma entidade relacional com múltiplos writers concorrentes.

## Reabertura futura (fora de escopo agora)
- Se surgir necessidade real de **sync de conexões salvas entre dispositivos**, revisar Turso como opção nesse momento — não antes.
- Se surgir necessidade real de **busca semântica sobre histórico de queries** (ex. "queries parecidas com esta"), considerar `sqlite-vec` (extensão SQLite, mesmo arquivo local) — nunca serviço vetorial externo, para manter a filosofia de app local sem dependência de rede.

## Consequências
- Um único arquivo `.db` local concentra todo o estado do app — backup/restore trivial (copiar o arquivo).
- Exige rotina de migração de schema (versionamento de `schema_cache`/`connections`) conforme o produto evolui.
