# Wisp

Cliente SQL desktop leve e nativo (Go + Wails, Webview + React/Monaco) — buscando a produtividade de um DBeaver sem o consumo de memória de JVM/Electron.

📖 [Read in English (README.md)](../README.md)

Ver `docs/ARCHITECTURE.md`, `docs/adr/` e `docs/ROADMAP.md` (em inglês) para as decisões de arquitetura e o plano de fases.

## Status

Beta inicial (`v0.1.0-beta.x`). Bancos suportados hoje: **PostgreSQL** e **SQLite**. Veja [Releases](https://github.com/matheusbbdutra/wisp-db/releases) pros pacotes `.deb` prontos (Debian 12+/Ubuntu 22.04+).

## Funcionalidades

- Múltiplas abas de console independentes (conexão isolada por aba, cancelar uma query em andamento sem derrubar a conexão).
- Fetch de resultado em streaming real (baseado em cursor, tamanho de lote configurável — nunca carrega o resultado inteiro em memória).
- Autocomplete SQL (tabelas, colunas, schemas, keywords, funções built-in por dialeto), pretty-print de SQL, uppercase automático de keywords.
- Grid de resultados: cópia com múltipla seleção, "copiar como" CSV/INSERT SQL/Markdown, edição inline de células (só com PK real detectada — nunca heurística; ver ADR 0004).
- Exploração de tabela/schema como aba própria: Dados / DDL / Triggers / Funções / Colunas, aberta pelo ícone ↗ ou Ctrl+click (na sidebar e dentro do próprio editor SQL, estilo DBeaver).
- Múltiplas abas de resultado por console (rodar outra query nunca descarta o resultado anterior) com fila de execução (rodar uma query enquanto outra está em andamento entra na fila em vez de bloquear a interface).
- Painéis redimensionáveis (largura da sidebar, divisão editor/grid) por arrasto.
- Conexões salvas (cifradas em disco, chave mestra no keychain do SO), histórico de queries, scripts salvos nomeados.

## Requisitos de sistema (Linux)

- Go 1.21+
- Node 18+
- `webkit2gtk-4.1` (o Arch descontinuou o pacote `webkit2gtk-4.0`; a build tag abaixo é obrigatória)

## Build

Este sistema tem só `webkit2gtk-4.1` instalado, então **todo build/dev precisa da tag `webkit2_41`**:

```bash
wails build -tags webkit2_41
wails dev -tags webkit2_41
```

Sem a tag, o build falha com `Package 'webkit2gtk-4.0' not found` mesmo com o pacote 4.1 instalado — é uma diferença de nome de pacote entre distros, não falta de dependência.

## Testar localmente (SQLite)

Gere um banco de teste:

```bash
sqlite3 testdata/sample.db < testdata/seed.sql
```

Rode `wails dev -tags webkit2_41` e crie uma conexão SQLite apontando pra `testdata/sample.db` no gerenciador de conexões.

## Testar localmente (Postgres via Docker)

```bash
cd testdata
docker compose up -d
```

Sobe um Postgres 16 em `localhost:5432` (usuário/senha/db: `wisp`/`wisp`/`wisp_test`, credenciais de teste local, nunca usar em produção) com seed aplicado automaticamente (`postgres-seed.sql`): tabela com PK simples, tabela com PK composta e tabela com coluna gerada — cobre os casos de `docs/adr/0004-inline-edit-safety.md`.

DSN pra usar no gerenciador de conexões: `postgres://wisp:wisp@localhost:5432/wisp_test`

Para derrubar: `docker compose down` (dentro de `testdata/`). `docker compose down -v` remove o volume de dados também.

## Rodando a suíte de testes

```bash
go test ./...                 # backend Go — SQLite real (arquivo temporário) e Postgres
                               # real (pula graciosamente os testes de Postgres se a
                               # instância acima não estiver rodando)
cd frontend && npm run test   # Vitest — lógica pura (sem DOM/React)
```

Nenhum mock no lugar de um banco real em nenhum teste da suíte — é regra fixa do projeto (ver `CLAUDE.md`).

## Estrutura

- `internal/db` — interface `DatabaseDriver` (Strategy), uma implementação por dialeto SQL.
- `internal/session` — Session Manager, isolamento por `tabId` (conexão dedicada + cancelamento).
- `internal/store` — persistência local em SQLite (conexões, histórico, cache de schema).
- `frontend/` — webview React + TypeScript (Monaco Editor, Glide Data Grid).

## Contribuindo

Ver `CONTRIBUTING.md` (em inglês).

## Licença

Ainda não decidida — confirme antes de depender deste projeto em produção.
