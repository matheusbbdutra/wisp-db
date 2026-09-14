# STATE — Wisp

## Status atual
Projeto criado em 2026-09-14. Fase: **pré-Fase 1** — só documentação/specs geradas, nenhum código escrito ainda.

## Decisões fechadas (não reabrir sem ADR novo)
- Stack: Go + Wails + React/Monaco (`docs/adr/0001-stack.md`)
- CGO: evitar por padrão, exceção documentada para DuckDB (`docs/adr/0002-cgo-policy.md`)
- Storage: SQLite puro Go (`modernc.org/sqlite`), sem JSON solto, sem Turso, sem vetor (`docs/adr/0003-storage.md`)
- Edição inline: escopo restrito por PK real detectada via catálogo (`docs/adr/0004-inline-edit-safety.md`)
- Meta de RAM idle: abaixo de 500MB (corrigida de "abaixo de 80MB" da proposta original — irreal para Webview+Monaco)
- Sem GPU: nenhum hot path identificado que justifique

## Próximos passos (não iniciados)
1. Scaffold do projeto Wails (`wails init`) — estrutura de pastas Go + frontend React.
2. Definir interface `DatabaseDriver` (Strategy) e implementação inicial para Postgres (`pgx`).
3. Session Manager (`tabId` → `*sql.Conn` + `context.CancelFunc`).
4. Local Store SQLite: schema inicial de `connections` (ver ADR 0003) + Credential Vault (cifragem + keychain do SO).

## Pendências/perguntas em aberto
- Nenhuma no momento. Próxima decisão real ocorre ao escolher a lib de keychain cross-platform (`go-keyring` é candidato, não validado em profundidade ainda).

## Última atualização
2026-09-14 — sessão de criação de docs/specs iniciais (CLAUDE.md, ARCHITECTURE.md, ADRs 0001-0004, ROADMAP.md, CONTRIBUTING.md).
