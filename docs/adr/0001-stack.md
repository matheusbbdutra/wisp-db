# ADR 0001 — Stack: Go + Wails + Webview (React/Monaco)

**Status:** Accepted
**Date:** 2026-09-14

## Context
Traditional SQL client tools (DBeaver/JVM, Electron-based alternatives) have slow startup and high RAM usage (often 1-1.5GB+). The goal is a lightweight, native desktop client.

## Decision
- Backend: **Go**, using **Wails v2/v3** as the native ↔ webview bridge layer.
- Frontend: **React + Monaco Editor** running in Wails' native webview (WebKitGTK/WebView2/WKWebView depending on OS), not Electron.
- Data grid: **Glide Data Grid** (`<canvas>` rendering, virtualized) instead of a grid backed by thousands of DOM nodes.

## Alternatives considered
- **Electron + Node backend**: dropped — reintroduces the memory overhead the project is trying to eliminate.
- **JVM (like DBeaver)**: dropped — slow startup, high RAM, not the project's goal.
- **Tauri**: technically viable (Rust + webview), but would require moving the entire driver ecosystem/expertise to Rust. Go has mature drivers for the target databases (pgx, clickhouse-go) without that migration.

## Consequences
- No heavy runtime overhead; sub-second startup is achievable.
- Realistic idle RAM target: **under 500MB** (not under 80MB — the original target was too aspirational, corrected after discussion with the maintainer; Webview + Monaco alone already exceed that in several scenarios, especially WebKitGTK on Linux).
- The webview engine varies per OS — UI testing needs to cover all three engines (WebKitGTK, WebView2, WKWebView), not just one.
