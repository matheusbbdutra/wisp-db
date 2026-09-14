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

## Próximos passos (não iniciados)
1. Implementação real do primeiro `DatabaseDriver`: Postgres via `pgx`, incluindo `CancelRunningQuery` nativo (`pgx.CancelQuery`).
2. Ligar `Session.Open`/`Get`/`Cancel` a bindings Wails reais expostos ao frontend (hoje o Manager existe mas não está exposto em `App`).
3. Credential Vault (cifragem de `encrypted_secret` + chave mestra no keychain do SO — `go-keyring` é candidato, não validado em profundidade ainda).
4. UI real: Monaco Editor + Glide Data Grid substituindo o placeholder atual em `frontend/src/App.tsx`.

## Pendências/perguntas em aberto
- Nenhuma bloqueante. Próxima decisão real é a lib de keychain cross-platform ao implementar o Credential Vault.

## Última atualização
2026-09-14 — skeleton Wails funcional criado e validado (build ponta a ponta).
