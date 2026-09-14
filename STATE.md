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

## Feito em sessão seguinte (UI real com Monaco + sidebar)
1. ✅ `frontend/src/components/SqlEditor.tsx` — Monaco Editor bundlado 100% local (sem CDN, workers via `?worker` do Vite), Ctrl+Enter executa.
2. ✅ `frontend/src/components/Sidebar.tsx` — árvore de schemas/tabelas com introspecção lazy real (`ListSchemas`/`ListTables`, novos bindings em `app.go`), clique em tabela preenche `SELECT * FROM ... LIMIT 200` no editor.
3. ✅ `frontend/src/components/ResultGrid.tsx` — tabela de resultado simples (ainda não é Glide Data Grid virtualizado — fica para quando o volume de linhas justificar).
4. ✅ Layout real (topbar de conexão + sidebar + editor + grid) substituindo a UI de teste manual anterior.
5. ✅ Corrigido `tsconfig.json` (`moduleResolution: "Bundler"`) e `vite.config.ts` (`worker: {format: 'es'}`) exigidos pelo Monaco.
6. ✅ Vulnerabilidade moderada em `dompurify` (transitiva via monaco-editor) corrigida via `overrides` no `package.json`, sem downgrade do monaco — `npm audit` limpo.
7. ✅ Build completo (`wails build -tags webkit2_41`) validado. **UI confirmada visualmente pelo usuário** (2026-09-14): topbar, sidebar, Monaco com highlight SQL e grid de resultado renderizando corretamente, Connect/Execute funcionando ponta a ponta contra `testdata/sample.db`.

## Feito em sessão seguinte (Credential Vault + conexões salvas)
1. ✅ `internal/vault/vault.go` — Credential Vault real: ChaCha20-Poly1305, chave mestra persistida no keychain do SO via `go-keyring`. Validado neste sistema (gnome-keyring-daemon rodando via Secret Service/dbus): cifra/decifra funciona, chave persiste entre "reaberturas" do vault, confirmado também via `secret-tool search`.
2. ✅ `internal/store/store.go` — schema `connections` simplificado (decisão pragmática: DSN completa cifrada em vez de decompor host/port/user/senha por dialeto — documentado no topo do arquivo). `SaveConnection`/`ListConnections` (nunca expõe DSN)/`ResolveConnection` (decifra só no momento de conectar)/`DeleteConnection`. Validado com execução real (save → list → resolve → delete).
3. ✅ `app.go` — bindings `SaveConnection`/`ListSavedConnections`/`ConnectSaved`/`DeleteSavedConnection`.
4. ✅ `frontend/src/components/ConnectionBar.tsx` — UI para salvar a conexão atual e reconectar a partir de conexões salvas (chips com botão de deletar), extraído da topbar por SRP.
5. ✅ Build completo (`wails build -tags webkit2_41`) validado. Warning inofensivo do bindgen do Wails sobre `time.Time` (campo `CreatedAt` vira `any` no TS — não usado na UI ainda, sem impacto).

## Feito em sessão seguinte (PostgresDriver validado contra Postgres real)
1. ✅ `testdata/docker-compose.yml` + `testdata/postgres-seed.sql` — Postgres 16 local com seed cobrindo PK simples (`customers`), PK composta (`order_items`) e coluna gerada (`invoice_lines.total`), exatamente os casos do ADR 0004.
2. ✅ `PostgresDriver` validado com execução real contra o container: `Execute`, `ListSchemas`, `ListTables`, `Introspect` (PK simples ✅, PK composta detectou as duas colunas ✅, coluna gerada marcou `IsGenerated: true` ✅).
3. ✅ **Cancelamento real confirmado**: `SELECT pg_sleep(30)` cancelado via `CancelRunningQuery` após 500ms, retornou com `SQLSTATE 57014 — canceling statement due to user request` (erro nativo do Postgres, não timeout local) — valida o requisito mais crítico do `CLAUDE.md` ("Cancelamento Real").
4. ✅ README atualizado com instruções de subir/derrubar o Postgres de teste e a DSN pronta para colar na UI.

## Feito em sessão seguinte (Redesign visual completo da UI)
1. ✅ Redesign visual completo dos componentes frontend mantendo lógica e bindings intactos.
2. ✅ `frontend/src/style.css` e `frontend/src/App.css` reestruturados com design system escuro profissional (tons zinc, variáveis de tema, scrollbars desktop, botões estilizados, inputs e chips).
3. ✅ `ConnectionBar.tsx`, `Sidebar.tsx`, `SqlEditor.tsx` e `ResultGrid.tsx` aprimorados com ícones SVG inline (100% offline), hierarquia visual de schemas/tabelas, sticky header no grid com numeração de linha e destaque para valores `NULL`.
4. ✅ Validação de tipagem (`npx tsc --noEmit`) e build do frontend (`npm run build`) concluídos com sucesso.
5. ✅ Relatório detalhado gerado em `docs/reports/agy-ui-redesign.md`.

## Feito em sessão seguinte (delegação: OpenCode + agy, e correção de bundle)
1. ✅ Botão "Cancelar" ligado à UI — **delegado ao OpenCode** (`opencode run`, direção validada da skill `agent-delegate`; contexto do projeto gravado antes em memory-mcp na memória `wisp-sql-client`). Verificado por mim: `tsc --noEmit` e `wails build` passaram. `App.tsx`: estado `running` alterna botão Executar/Cancelar, `handleCancel` chama `CancelQuery(TAB_ID)`.
2. ✅ Redesign visual completo — **delegado ao agy**, rodado interativamente pelo usuário (headless bloqueado duas vezes por permissões distintas — `read_file` e depois `command` — não resolvidas mesmo após o usuário já ter usado agy antes; tentativas documentadas na memória `wisp-agy-ui-redesign-task`, sem insistir em mais variações de flag conforme a skill orienta). Relatório do agy em `docs/reports/agy-ui-redesign.md`. **Verificado por mim de forma independente** (não só confiando no relatório): reli o diff de todos os arquivos tocados (só CSS/markup, nenhuma lógica/binding alterado), rodei `tsc --noEmit` e `npm run build` eu mesmo — bateram com o que o agy reportou.
3. ⚠️ **Bug real encontrado na verificação, não introduzido pelo agy** (débito meu, de quando montei o `SqlEditor.tsx` original): `import * as monaco from 'monaco-editor'` importava o pacote inteiro — todos os language services completos (TypeScript, CSS, HTML, JSON) e dezenas de linguagens nunca usadas (PHP, Perl, Ruby, Solidity...). Build gerava **93 chunks JS, ~14MB** (destaque: `ts.worker` sozinho com 6.8MB) — contradizia direto a meta de app leve do ADR 0001. **Corrigido**: troquei para `monaco-editor/editor/editor.api` (core) + registro manual do SQL via `monaco-editor/languages/definitions/sql/sql` (Monarch tokenizer + config, sem language service) — descoberta de que o `exports` map do pacote nesta versão (0.56.0) exige o specifier sem o prefixo `esm/vs/` (ex. `monaco-editor/editor/editor.worker`, não `monaco-editor/esm/vs/editor/editor.worker`). Resultado: **2 assets JS, ~3.2MB** (`editor.worker` 272KB + `index.js` 2.9MB, o núcleo inevitável do Monaco). Adicionado `declare module` em `vite-env.d.ts` para o submódulo sem `.d.ts` publicado. Build completo (`wails build -tags webkit2_41`) revalidado após a correção.

## Confirmado visualmente pelo usuário (2026-09-14)
Redesign do agy + correção do bundle do Monaco renderizando corretamente: topbar organizada, chips de conexão salva, sidebar com empty state ilustrado, editor Monaco com highlight de SQL funcionando (confirma que o registro manual via `languages/definitions/sql/sql` substituiu o `basic-languages` agregado sem regressão), grid com empty state. Um glitch visual de hot-reload do `wails dev` apareceu momentaneamente e sumiu sozinho — não é bug do app.

## Feito em sessão seguinte (Histórico de queries — binding + UI)
1. ✅ `internal/store/store.go` — `QueryHistoryEntry` + `RecordQuery` (ignora `connectionID` vazio, sem erro) + `ListQueryHistory(limit)` (`ORDER BY executed_at DESC`).
2. ✅ `app.go` — `Execute` grava histórico (`ok`/`error`, duração via `time.Since`, `rowCount`; falha só logada, retorno inalterado) + binding `GetQueryHistory(limit)`.
3. ✅ `frontend/src/components/QueryHistory.tsx` — painel lateral direito com toggle no toolbar do editor, resumo truncado em 60 chars, status colorido, duração, horário; clique preenche o editor; atualiza após cada execução (`refreshToken`).
4. ✅ Validado: `go build ./...`, `go vet ./...`, `gofmt` limpo, `wails build -tags webkit2_41` (bindings regenerados) e `npx tsc --noEmit` — todos passando.
5. ✅ **Limitação corrigida por mim depois**: `RecordQuery` recebia `connectionID` sempre vazio → painel sempre vazio na prática. Adicionei `Session.ConnectionID` (`internal/session`), `App.connect` interno compartilhado por `Connect`/`ConnectSaved` que propaga o id, e `Execute` agora usa `s.ConnectionID`. Validado com execução real: conexão salva → executa → aparece no histórico (3 linhas); conexão ad-hoc → corretamente não grava nada.
6. Nota histórica: o "ajuste colateral" mencionado abaixo (opencode adaptando `Manager.Open` pra 3 args) foi absorvido pela minha implementação completa do schema cache logo em seguida — `Manager.Open` agora tem assinatura final com `cacheKey` + `connectionID`.

## Feito em sessão seguinte (Schema cache com TTL — Claude Code direto)
1. ✅ `internal/schemacache/cache.go` — pacote novo: `Catalog{Schemas, Tables}`, cache em duas camadas (memória + `PersistentStore` opcional, satisfeito estruturalmente por `*store.Store` sem import cruzado), `Key(driver, dsn)` como SHA-256 (nunca DSN em texto puro), `Get`/`Set`/`Invalidate`.
2. ✅ `internal/store/store.go` — `schema_cache` migrado de `connection_id` (FK) para `cache_key` (hash, sem FK — conexões ad-hoc também cacheiam). `GetSchemaCacheJSON`/`SetSchemaCacheJSON` (upsert com `ON CONFLICT`, respeita TTL)/`DeleteSchemaCacheJSON`.
3. ✅ `internal/session/manager.go` — `Session.CacheKey` e `Session.ConnectionID`, `Manager.Open` com assinatura final (`tabID, driver, cacheKey, connectionID`).
4. ✅ `app.go` — `App.schemaCache` (TTL 15min), `ListSchemas`/`ListTables` consultam cache antes de ir ao driver e gravam depois de um fetch real; `Execute` invalida o cache da conexão quando detecta DDL (`isDDL`: primeiro token `CREATE`/`ALTER`/`DROP`/`TRUNCATE`, checagem léxica simples, não parser); novo binding `RefreshSchema(tabID)` para invalidação manual.
5. ✅ `frontend/src/components/Sidebar.tsx` — botão "Atualizar" agora chama `RefreshSchema` antes de `ListSchemas` (senão serviria do cache em vez de forçar fetch real) e limpa o estado de tabelas expandidas.
6. ✅ Validado com execução real (não mock): miss inicial, hit em memória, hit via SQLite persistido simulando reinício do app, expiração por TTL (2s), invalidação manual, invalidação propagando pra camada persistente — os 6 cenários passaram.
7. ✅ Build completo (`wails build -tags webkit2_41`) validado com histórico + schema cache juntos.

## Feito em sessão seguinte (Gerenciamento de conexões reformulado — agy)
1. ✅ Barra de DSN cru totalmente removida da interface principal (`ConnectionBar.tsx`), eliminando a causa raiz de perda de DSN e criação acidental de bancos SQLite vazios.
2. ✅ `app.go`: novo binding `PickSQLiteFile() (string, error)` integrado a `runtime.OpenFileDialog` do Wails com filtros nativos para `.db`, `.sqlite`, `.sqlite3`.
3. ✅ `frontend/src/components/ConnectionModal.tsx`: modal estruturado com abas de criação e gerenciamento, file picker nativo de SQLite e formulário completo para PostgreSQL (host/porta/db/user/password/ssl) com escape rigoroso de credenciais via `encodeURIComponent`.
4. ✅ `frontend/src/components/ConnectionBar.tsx` e `frontend/src/App.tsx`: topbar compacta com select de conexões salvas, botão Conectar/Desconectar, atalho para modal e tag da conexão ativa.
5. ✅ Validação completa: `go build ./... && go vet ./... && gofmt -l -w .` (código 0), `npx tsc --noEmit` (código 0) e `wails build -tags webkit2_41` (gerou `build/bin/wisp` com código 0).
6. ✅ Relatório gerado em `docs/reports/agy-connection-management.md`, e também via memory-mcp (`wisp-agy-connection-management-result`, agent=antigravity) — primeira vez usando o MCP compartilhado pra ida e volta da delegação, funcionou.
7. ✅ **Verificado independentemente por mim** (não só aceito o relatório): reli o diff completo (`ConnectionModal.tsx`, `ConnectionBar.tsx`, `App.tsx`, `app.go`) — sem código morto deixado para trás. Rebuild próprio (`go vet`/`gofmt`/`tsc`/`wails build`) todos limpos. **Validação crítica da montagem de DSN**: reproduzi o `encodeURIComponent` real do JS em Go (não confundir com `url.QueryEscape`, que usa `+` em vez de `%20` para espaço — errei isso na primeira tentativa e o teste falhou até corrigir) e testei senha com todos os caracteres perigosos (`@ : / espaço ! * ' ( )`) — sobrevive ida e volta perfeita pelo `pgx.ParseConfig`. Testei o fluxo completo (montar DSN → `SaveConnection` → `ResolveConnection` → `Connect` → `Execute`) contra o Postgres real do Docker: funcionou de ponta a ponta.

## Próximos passos (não iniciados)
1. Data grid virtualizado real (Glide Data Grid) — ver relatório esperado em `docs/reports/agy-glide-data-grid.md`.
2. Autocomplete no Monaco alimentado pelo schema cache (Fase 2) — usar `ListSchemas`/`ListTables` (já cacheados) para alimentar `monaco.languages.registerCompletionItemProvider`.
3. Confirmação visual pelo usuário das novas telas de gerenciamento de conexões.

## Pendências/perguntas em aberto
- Nenhuma bloqueante.

## Última atualização
2026-09-14 — Reformulação completa do gerenciamento de conexões (modal estruturado + file picker SQLite) implementada e validada.


