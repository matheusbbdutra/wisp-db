# STATE — Wisp

## Status atual
Projeto criado em 2026-09-14. Fase: **Fase 1 em andamento** — skeleton Wails gerado e validado (build completo funcionando, binário em `build/bin/wisp`).

## Decisões fechadas (não reabrir sem ADR novo)
- Stack: Go + Wails + React/Monaco (`docs/adr/0001-stack.md`)
- CGO: evitar por padrão, exceção documentada para DuckDB (`docs/adr/0002-cgo-policy.md`)
- Storage: SQLite puro Go (`modernc.org/sqlite`), sem JSON solto, sem Turso, sem vetor (`docs/adr/0003-storage.md`)
- Edição inline: escopo restrito por PK real detectada via catálogo (`docs/adr/0004-inline-edit-safety.md`)
- Meta de RAM idle: abaixo de 500MB (corrigida de "abaixo de 80MB" da proposta original — irreal para Webview+Monaco)
- Sem GPU: nenhum hot path identificado que justifique

## Feito nesta sessão (skeleton)
1. ✅ Scaffold Wails (`wails init -t react-ts`), renomeado de `wisp-tmp` para `wisp`, mesclado com os docs já existentes.
2. ✅ `internal/db/driver.go` — interface `DatabaseDriver` (Strategy) + tipos `QueryResult`/`Column`/`Table`. **Sem implementação de dialeto ainda** (nenhum driver real como pgx foi conectado).
3. ✅ `internal/session/manager.go` — Session Manager (`tabId` → `Session{Driver, cancel}`), thread-safe via mutex.
4. ✅ `internal/store/store.go` — Store SQLite (`modernc.org/sqlite`) com schema `connections`/`query_history`/`schema_cache` aplicado via `CREATE TABLE IF NOT EXISTS`.
5. ✅ `app.go`/`main.go` — wiring de startup/shutdown, store abre em `~/.config/wisp/wisp.db` (Linux).
6. ✅ Build completo validado: `go build`, `go vet`, `npm run build` (frontend) e `wails build -tags webkit2_41` — binário gerado em `build/bin/wisp`.
7. ✅ Descoberto e documentado no README: este sistema (Arch/Omarchy) só tem `webkit2gtk-4.1`, exige `-tags webkit2_41` em todo build/dev (`wails build`/`wails dev`), senão falha procurando `webkit2gtk-4.0`.
8. ✅ Removido placeholder `Greet` do template padrão do Wails (era binding de demonstração sem relação com o produto).

## Feito em sessão seguinte (drivers + wiring)
1. ✅ `internal/db/sqlite.go` — `SQLiteDriver` completo (Execute, ListTables, Introspect via `PRAGMA table_xinfo`, detecta PK e colunas geradas). Validado com implementação real contra `testdata/sample.db` (não mock).
2. ✅ `internal/db/postgres.go` — `PostgresDriver` via `pgx` (Execute, cancelamento nativo via `CancelRequest`, introspecção via `information_schema` cruzando PK real). **Não testado contra Postgres real ainda** — sem instância disponível nesta sessão, só compilado.
3. ✅ `internal/db/factory.go` — único ponto de seleção por dialeto (Strategy).
4. ✅ `app.go` — bindings `Connect`/`Execute`/`CancelQuery`/`Disconnect` expostos ao frontend via Session Manager.
5. ✅ UI de teste manual em `frontend/src/App.tsx` (não é a UI final — Monaco/Glide Data Grid ainda não entraram) para validar o fluxo ponta a ponta pela janela.
6. ✅ `testdata/seed.sql` — script reproduzível pra gerar banco SQLite de teste (`sqlite3 testdata/sample.db < testdata/seed.sql`).

## Próximos passos (não iniciados)
1. Validar `PostgresDriver` contra instância Postgres real (Docker local) — só foi compilado, não exercitado.
2. Credential Vault (cifragem de `encrypted_secret` + chave mestra no keychain do SO — `go-keyring` é candidato, não validado em profundidade ainda).
3. UI real: Monaco Editor + Glide Data Grid substituindo a UI de teste manual atual.
4. Persistir conexões testadas no Store (`connections` table) — hoje `Connect` não grava nada, é só sessão em memória.

## Pendências/perguntas em aberto
- Nenhuma bloqueante. Próxima decisão real é a lib de keychain cross-platform ao implementar o Credential Vault.

## Última atualização
2026-09-14 — skeleton Wails funcional criado e validado (build ponta a ponta).
