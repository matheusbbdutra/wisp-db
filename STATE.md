# STATE — Wisp

Checkpoint compacto pra retomar em sessão nova. Histórico detalhado de cada
mudança está nos commits do git (`git log`), não duplicado aqui.

## O que já funciona (validado com execução real, não só compilado)
- **Drivers**: SQLite (`modernc.org/sqlite`) e Postgres (`pgx`) via Strategy (`internal/db`). Fetch em **streaming real** (cursor + `FetchNext` em lotes, não carrega tudo em memória) — testado com 5M linhas.
- **Cancelamento real**: `CancelRunningQuery` nativo (pgx `CancelRequest`) desbloqueia um fetch em andamento sem matar a conexão. **Nunca cancelar `QueryCtx` de uma query com cursor aberto** — mata a conexão do pgx (ver memória `pgx-context-cancel-closes-connection`).
- **Session Manager** (`internal/session`): isolamento por `tabId`, `Ctx` (vida da sessão) + `QueryCtx` (por execução).
- **Schema cache** (`internal/schemacache`): 2 camadas (memória + SQLite), TTL 15min, invalidação manual/DDL.
- **Credential Vault** (`internal/vault`): ChaCha20-Poly1305, chave no keychain do SO.
- **Store** (`internal/store`): conexões salvas cifradas, histórico de queries (`RecordQuery`/`FinishQuery`), schema cache.
- **UI**: Monaco Editor (bundle otimizado, ~3.2MB — nunca importar `monaco-editor` inteiro, ver memória `monaco-editor-exports-map-vite`), editável reativo (`readOnly` corrigido), `Ctrl+Enter` roda tudo / `Ctrl+Shift+Enter` roda seleção ou statement sob o cursor. Glide Data Grid virtualizado. Modal de conexão estruturado (file picker SQLite, campos Postgres, testar sem salvar, colar DSN direto). Histórico de queries em painel lateral. Paginação configurável ("Carregar mais N", default 200, como DBeaver).
- **RAM idle medida**: ~158-164MB (meta era <500MB — ADR 0001, folgado).
- **Empacotamento**: `packaging/arch/PKGBUILD` e `packaging/deb/build.sh`, ambos buildados e testados de verdade (binário extraído isoladamente e rodando). Artefatos em `dist/` (gitignored). **Ainda sem repo remoto no GitHub** — publicar em Releases é passo futuro, não feito ainda.

## Limitações conhecidas (não são bugs, decisões/gaps documentados)
- SQLite não tem cancelamento nativo de query em andamento (sem native cancel; impacto baixo, queries locais).
- Só uma aba/console (`TAB_ID` fixo em `App.tsx`) — backend já suporta múltiplas (`Session Manager` isola por `tabId`), falta UI.
- `.deb` só suporta Debian 12+/Ubuntu 22.04+ (precisa `libwebkit2gtk-4.1-0`, distros mais antigos só têm 4.0).

## Próximos passos combinados com o usuário (em ordem)
1. ~~**Múltiplas abas/consoles**~~ — **CONCLUÍDO e confirmado pelo usuário** testando no app real: duas abas simultâneas, uma SQLite e outra Postgres, consultas rodadas independentemente em cada uma, sem interferência. `ConsoleTab.tsx` isola estado por `tabId` (Session Manager já dava suporte no backend); `App.tsx` virou gerenciador de abas (tab bar +/×, abas ficam montadas e ocultas via `hidden` pra preservar estado ao trocar). Fechar aba chama `Disconnect(tabId)`.
2. **Salvar scripts SQL** — arquivos de query nomeados, editáveis, reabertos (diferente do histórico, que é log automático). **Próximo item a implementar.**
3. **Tabela como aba própria** — clicar numa tabela na sidebar abre uma aba de dados dedicada (estilo "view data" do DBeaver), inclui ver DDL/triggers/funções da tabela/schema.
4. **Integração com agentes de terminal** — cogitado como servidor MCP exposto pelo Wisp (conexões já configuradas, agente de terminal lista/consulta via MCP). Deixado por último a pedido do usuário — escopo grande, arquitetura nova.

## Pendências das specs originais (`docs/ROADMAP.md`), fora dos 4 itens acima
- Autocomplete no Monaco via schema cache (Fase 2)
- Formatação de SQL / pretty-print (Fase 2)
- Túnel SSH (Fase 3)
- Edição inline de células — ADR 0004 já define o escopo restrito (Fase 3)
- Exportador CSV/JSON/Parquet (Fase 3)

## Confirmação visual do usuário
- Redesign visual, Monaco+highlight, Glide Data Grid, streaming/paginação (50k linhas, "Carregar mais"), correção do editor travado, correção do bug "conn closed" — **todos confirmados funcionando** pelo usuário testando na janela.
- Múltiplas abas/consoles (SQLite + Postgres simultâneos, cada um com sua query rodando independente) — **confirmado funcionando**.
- Gerenciamento de conexões (modal) — confirmação fraca ("aparentemente OK", sem detalhe de quais fluxos testou).

## Padrão de delegação (ver memória `delegacao-agy-via-memory-mcp-funciona`)
- **agy**: headless bloqueado por permissão — pedir pro usuário rodar interativo, com prompt instruindo a consultar/gravar na memória compartilhada (`memory` MCP, já configurado nele). Sempre verificar independentemente antes de aceitar (já achei bugs reais e código morto em entregas "prontas").
- **OpenCode**: `opencode run "..."` funciona headless direto — **nunca colocar `&` no fim do comando quando usar `run_in_background: true` no Bash tool** (bug já cometido: duplica o backgrounding e o comando real nunca roda). Também já mostrou instabilidade de provedor (timeout de 900s) uma vez — se acontecer de novo, matar e pedir pro usuário rodar manualmente.
- Tarefas que tocam os mesmos arquivos: rodar sequencialmente, nunca em paralelo.

## Última atualização
2026-09-15 — RAM/startup medidos (Fase 1 fechada), pacotes Arch/.deb buildados e testados, STATE.md consolidado (histórico detalhado migrado pros commits do git).
