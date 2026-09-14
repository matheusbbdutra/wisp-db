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

## Estrutura
- `internal/db` — interface `DatabaseDriver` (Strategy), um dialeto por implementação.
- `internal/session` — Session Manager, isolamento por `tabId` (conexão + cancelamento).
- `internal/store` — persistência local em SQLite (conexões, histórico, cache de schema).
- `frontend/` — Webview React + TypeScript (Monaco Editor e data grid entram na Fase 1-2, ver roadmap).
