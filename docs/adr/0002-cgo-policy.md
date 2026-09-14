# ADR 0002 — Política de CGO: evitar por padrão, exceção documentada para DuckDB

**Status:** Aceito
**Data:** 2026-09-14

## Contexto
A proposta original definia "evitar CGO" como regra absoluta, para simplificar cross-compilation (Linux/macOS/Windows × amd64/arm64). Verificação prática (busca na documentação oficial, setembro/2026) mostrou que:

- `pgx` (Postgres), `clickhouse-go` (ClickHouse), `go-sql-driver/mysql` (MySQL) e `modernc.org/sqlite` (SQLite, transpilado de C para Go) são **100% Go, sem CGO**.
- `go-duckdb` (marcboeker) e seu sucessor oficial `duckdb/duckdb-go` **exigem CGO** — linkam contra `libduckdb` nativa. Não existe hoje driver DuckDB Go puro e maduro. Cross-compile exige `CGO_ENABLED=1` + toolchain C cruzada (`CC=...`) por combinação de OS/arch.
- DuckDB está no escopo da Fase 1 (MVP), então a regra absoluta "sem CGO" quebraria no primeiro milestone.

## Decisão
- **Regra geral**: preferir sempre driver 100% Go quando existir opção madura e mantida.
- **Exceção documentada**: DuckDB é CGO obrigatório. Isso é aceito porque é a única exceção da matriz, não o padrão.
- **Estratégia de build**: builds de release com suporte a DuckDB rodam em **runners nativos por OS** (GitHub Actions macOS/Linux/Windows), evitando cross-compile forçado sempre que possível. Cross-compile cruzado (`CGO_ENABLED=1` + `CC` cruzado) só é usado se surgir necessidade de arch não coberta por runner nativo (ex. Linux ARM64 a partir de runner amd64).
- SQLite do **store interno** do Wisp (conexões, histórico, cache) usa `modernc.org/sqlite` (sem CGO) — não usa CGO mesmo indiretamente, mantendo o binário base do app livre de CGO exceto quando o usuário conecta a um DuckDB.

## Alternativas consideradas
- **Remover DuckDB do escopo**: rejeitado — é um requisito explícito do produto (suporte a bancos analíticos modernos).
- **Aguardar driver DuckDB puro Go**: não existe previsão; bloquear o roadmap nisso não é razoável.

## Consequências
- CI precisa de matriz de build com runners nativos por OS, não só `GOOS=... go build` cross-platform simples.
- Binário com suporte a DuckDB é maior e depende de `libduckdb` estática por plataforma — aumenta tamanho de distribuição.
- Se o driver DuckDB puro Go amadurecer no futuro, revisar este ADR.
