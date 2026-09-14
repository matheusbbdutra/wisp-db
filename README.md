# Wisp

Cliente SQL desktop leve e nativo (Go + Wails, Webview + React/Monaco). Ver `docs/ARCHITECTURE.md`, `docs/adr/` e `docs/ROADMAP.md` para as decisões e o plano de fases.

## Requisitos de sistema (Linux/Arch)
- Go 1.21+
- Node 18+
- `webkit2gtk-4.1` (Arch descontinuou o pacote `webkit2gtk-4.0`; use a build tag abaixo)

## Build

Este sistema tem apenas `webkit2gtk-4.1` instalado, então **todo build/dev precisa da tag `webkit2_41`**:

```bash
wails build -tags webkit2_41
wails dev -tags webkit2_41
```

Sem a tag, o build falha com `Package 'webkit2gtk-4.0' not found` mesmo com o pacote 4.1 instalado — é uma diferença de nome de pacote entre distros, não falta de dependência.

## Testar localmente (SQLite)

Gere um banco de teste com dados de exemplo:

```bash
sqlite3 testdata/sample.db < testdata/seed.sql
```

Rode `wails dev -tags webkit2_41`. A UI atual (placeholder de teste manual,
não a UI final) já vem preenchida com driver `sqlite` e o DSN apontando
para `testdata/sample.db` — clique em "Conectar" e depois "Executar".

## Testar localmente (Postgres via Docker)

```bash
cd testdata
docker compose up -d
```

Sobe um Postgres 16 em `localhost:5432` (usuário/senha/db: `wisp`/`wisp`/`wisp_test`,
credenciais de teste local, nunca usar em produção) com seed aplicado
automaticamente (`postgres-seed.sql`): tabela com PK simples, tabela com PK
composta e tabela com coluna gerada — cobre os casos de
`docs/adr/0004-inline-edit-safety.md`.

DSN para usar na UI: `postgres://wisp:wisp@localhost:5432/wisp_test`

Para derrubar: `docker compose down` (dentro de `testdata/`). `docker compose down -v` remove o volume de dados também.

## Estrutura
- `internal/db` — interface `DatabaseDriver` (Strategy), um dialeto por implementação.
- `internal/session` — Session Manager, isolamento por `tabId` (conexão + cancelamento).
- `internal/store` — persistência local em SQLite (conexões, histórico, cache de schema).
- `frontend/` — Webview React + TypeScript (Monaco Editor e data grid entram na Fase 1-2, ver roadmap).
