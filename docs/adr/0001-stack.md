# ADR 0001 — Stack: Go + Wails + Webview (React/Monaco)

**Status:** Aceito
**Data:** 2026-09-14

## Contexto
Ferramentas de cliente SQL tradicionais (DBeaver/JVM, alternativas Electron) têm startup lento e consumo de RAM alto (frequentemente 1-1.5GB+). Objetivo é um cliente desktop leve e nativo.

## Decisão
- Backend: **Go**, usando **Wails v2/v3** como camada de bridge nativo ↔ webview.
- Frontend: **React + Monaco Editor** rodando na webview nativa do Wails (WebKitGTK/WebView2/WKWebView conforme OS), não Electron.
- Data grid: **Glide Data Grid** (renderização em `<canvas>`, virtualizado) em vez de grid baseado em milhares de nós DOM.

## Alternativas consideradas
- **Electron + Node backend**: descartado — reintroduz o overhead de memória que o projeto busca eliminar.
- **JVM (tipo DBeaver)**: descartado — startup lento, RAM alta, não é objetivo do projeto.
- **Tauri**: viável tecnicamente (Rust + webview), mas exigiria trocar toda a expertise/ecossistema de drivers para Rust. Go tem drivers maduros para os bancos-alvo (pgx, clickhouse-go) sem essa migração.

## Consequências
- Sem overhead de runtime pesado; startup sub-segundo é factível.
- RAM idle meta realista: **abaixo de 500MB** (não abaixo de 80MB — meta original era aspiracional demais, corrigida em conversa com o usuário; Webview + Monaco já consomem mais que isso sozinhos em vários cenários, especialmente WebKitGTK no Linux).
- Webview varia de motor por OS — testes de UI precisam cobrir os três motores (WebKitGTK, WebView2, WKWebView), não só um.
