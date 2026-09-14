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

## Confirmado visualmente pelo usuário (parcial, 2026-09-15)
Gerenciamento de conexões testado na janela: "aparentemente OK" — sem detalhamento de quais fluxos específicos (modal, file picker, select) foram exercitados. Tratar como confirmação fraca, não equivalente às confirmações anteriores (que tiveram prints).

## Feito em sessão seguinte (Glide Data Grid virtualizado — agy)
1. ✅ Substituição da tabela HTML simples em `frontend/src/components/ResultGrid.tsx` por `<DataEditor>` do `@glideapps/glide-data-grid`, 100% offline (sem CDN).
2. ✅ Mantida rigorosamente a interface de props (`columns: string[], rows: any[][]`) — nenhuma mudança necessária em `App.tsx`.
3. ✅ Mapeamento completo do tema escuro integrado com as CSS properties de `App.css` (`darkTheme`), suporte nativo a colunas redimensionáveis (`onColumnResize`) e coluna de índice fixa (`rowMarkers="number"`).
4. ✅ Tratamento visual diferenciado de valores `NULL` com `themeOverride` (itálico + tom âmbar `#d97706`) diretamente no canvas.
5. ✅ Mantidos o Empty State ilustrado e a toolbar de contagem de linhas e colunas.
6. ✅ Impacto de bundle rigorosamente medido: aumento de apenas ~450 kB no bundle total de produção (`dist/assets` foi de ~3.16 MB para ~3.61 MB), sem inchaço indesejado.
7. ✅ Validação completa: `npx tsc --noEmit` (código 0), `npm run build` (código 0) e `wails build -tags webkit2_41` (código 0, executável compilado em 10.7s).
8. ✅ Relatório gerado em `docs/reports/agy-glide-data-grid.md`, e via memory-mcp (`wisp-agy-glide-data-grid-result`).
9. ✅ **Verificado independentemente por mim**: tamanho de bundle real medido bate exatamente com o relatório (~3.61MB total, editor.worker 272.76KB + css 106.55KB + index.js 3214.61KB + overlays ~20KB — +450KB sobre a baseline, nada escondido). `lodash`/`marked`/`react-responsive-carousel` no `package.json` investigados e confirmados como peerDependencies reais do `@glideapps/glide-data-grid` (não são lixo adicionado à toa). `.npmrc` novo (`legacy-peer-deps=true`) é benigno — necessário porque a lib declara peer range de React 16-18 e o projeto usa React 19.
10. ⚠️ **Achado e corrigido por mim**: `.result-grid-scroll`/`.result-table`/`.cell-null` etc. ficaram como CSS morto em `App.css` (a tabela HTML antiga foi substituída no `.tsx` mas o CSS correspondente não foi removido) — confirmei via grep que nenhum `.tsx` referencia mais essas classes, removi o bloco inteiro, rebuild revalidado.
11. ✅ Testado volume real (não só visual): 50.000 linhas via Postgres real (`generate_series`) executadas e escaneadas pelo `PostgresDriver` em ~21ms no backend — confirma que o gargalo de volume grande não está na camada de dados, só falta confirmação visual de que o canvas do Glide Data Grid renderiza isso suave na janela.

## Feito em sessão seguinte (bug crítico do editor + fetch em streaming real)
1. ✅ **Bug crítico corrigido**: `SqlEditor.tsx` fixava `readOnly` só na criação do Monaco (useEffect com `[]`), nunca atualizava depois — editor ficava travado em somente-leitura pra sempre, pois a primeira renderização sempre acontece desconectado. Corrigido com `editor.updateOptions({readOnly})` reativo. Bug meu, da implementação original, só ficou visível quando o fluxo de conexão mudou.
2. ✅ **Feature nova**: `Ctrl+Shift+Enter` no `SqlEditor.tsx` executa só o texto selecionado, ou (sem seleção) o statement SQL sob o cursor (delimitado por `;`), sem precisar selecionar manualmente.
3. ✅ **Fetch em streaming real** (pedido do usuário, comparando com o "fetch size" configurável do DBeaver — 200 linhas por padrão, editável, "carregar mais" sob demanda em vez de trazer tudo de uma vez):
   - `internal/db/driver.go`: `DatabaseDriver` ganhou `ExecuteStreaming`/`FetchNext`/`CloseCursor`. `Execute` (full-scan) continua existindo para uso geral, não removido.
   - `internal/db/sqlite.go` e `postgres.go`: cursor guardado como campo do driver (`*sql.Rows`/`pgx.Rows`), fechado automaticamente por uma nova `ExecuteStreaming` ou por `Close()`.
   - **Bug latente real encontrado e corrigido**: `session.Manager.Open` retornava um `ctx` cancelável mas só era usado uma vez (em `Connect`) — todo o resto (`Execute`/`ListSchemas`/`ListTables`) usava `a.ctx` (contexto do app inteiro, nunca cancelado). `CancelQuery` cancelava um context que nunca era passado pra nenhuma query — o cancelamento só funcionava por causa do `CancelRunningQuery` nativo do Postgres, nunca via `ctx`. Corrigido: `Session` agora tem `Ctx` (vive enquanto a sessão está conectada) e `QueryCtx` (por execução, criado em `StartQuery`, cancelado individualmente por `Cancel` sem invalidar a sessão inteira — dá pra rodar outra query depois de cancelar, sem reconectar).
   - `internal/store/store.go`: `RecordQuery` agora retorna o `id` inserido; novo `FinishQuery(id, status, rowCount)` atualiza a entrada do histórico quando o cursor se esgota (o `row_count` real só é conhecido depois do fetch, não na hora de iniciar a query).
   - `app.go`: `Execute` (binding) removido, substituído por `RunQuery` (inicia streaming, grava histórico com duração da execução) + `FetchRows` (busca lote, atualiza histórico quando termina). Retornos empacotados em structs (`QueryMetadata`, `FetchBatch`) porque bindings Wails não lidam bem com mais de um valor além do `error`.
   - `frontend/src/App.tsx`: novo fluxo `RunQuery` → primeira leva automática via `FetchRows` → botão "Carregar mais N" (N configurável, campo numérico no toolbar) enquanto `hasMore=true`. Badge de tempo de execução (`durationMs`) visível ao lado do botão Executar.
4. ✅ **Validado com execução real** (múltiplos scripts descartáveis, todos removidos depois):
   - Fetch em lotes até esgotar: `SELECT * FROM customers` em lotes de 2, total bate (3 linhas).
   - Nova `ExecuteStreaming` fecha cursor anterior automaticamente sem vazar.
   - **Achado real**: `pg_sleep()` por linha não é lazy no protocolo do Postgres via `pgx.Query()` simples — a computação acontece antes do primeiro `Next()` retornar, não incrementalmente. Isso não afeta o objetivo real (tabelas grandes sem computação cara por linha), confirmado à parte.
   - Query de 5 milhões de linhas: `ExecuteStreaming` retorna em ~308ms (não espera a transferência toda), primeiro lote de 200 em ~66µs, heap não cresce proporcional ao total (731KB→761KB).
   - **Achado real**: só `CloseCursor()` pra abandonar uma query de 5M linhas leva ~1.47s (driver drena parte do buffer de rede antes de fechar); cancelamento nativo (`CancelRunningQuery`) + `CloseCursor` juntos (o fluxo real do botão Cancelar) leva ~11ms — a ordem importa, documentado no ARCHITECTURE.md.
   - `RecordQuery`/`FinishQuery`: grava com `row_count=0`, atualiza depois pro total real; `FinishQuery(0, ...)` (caso ad-hoc sem conexão salva) é no-op sem erro.
5. ✅ Build completo (`go build`/`go vet`/`gofmt`/`tsc`/`wails build -tags webkit2_41`) validado em cada etapa.
6. ✅ `docs/ARCHITECTURE.md` atualizado com o fluxo de execução em streaming real (substituiu a descrição antiga, que já estava desatualizada — falava em "streamado em chunks via eventos Wails", que nunca foi implementado assim).

## Próximos passos (não iniciados)
1. Autocomplete no Monaco alimentado pelo schema cache (Fase 2) — usar `ListSchemas`/`ListTables` (já cacheados) para alimentar `monaco.languages.registerCompletionItemProvider`.
2. **Confirmação visual pelo usuário pendente** — todo o fluxo desta sessão (editor editável de novo, Ctrl+Shift+Enter, fetch em streaming com "Carregar mais", badge de duração) ainda não foi visto rodando na janela por ninguém. Prioridade alta pro próximo teste, já que envolveu um bug crítico (editor travado).

## Feito em sessão seguinte (testar conexão sem salvar + colar DSN direto)
Reportado pelo usuário: tentou salvar uma conexão Postgres com o nome do banco errado (`wisp_teste` em vez de `wisp_test`), o erro apareceu mas ele não tinha como saber se a conexão tinha sido salva mesmo assim — e pediu pra poder colar a DSN direto em vez de só preencher campos.
1. ✅ **Bug real corrigido**: `ConnectionModal.handleSave(connectAfter=true)` ("Salvar e Conectar") chamava `SaveConnection` **antes** de tentar `ConnectSaved` — uma conexão com erro de digitação ficava salva mesmo falhando ao conectar. Corrigido: agora sempre chama `TestConnection` (novo binding) antes de `SaveConnection`, nos dois botões (Salvar e Salvar e Conectar) — nada é persistido se a conexão falhar.
2. ✅ Novo binding `App.TestConnection(driver, dsn) error` — conecta e fecha imediatamente, sem sessão, sem persistência, timeout de 10s. Botão "Testar conexão" no modal, separado dos botões de salvar, para o usuário validar antes de decidir salvar.
3. ✅ Modo de colar DSN direto: toggle "Prefere colar a DSN/link de conexão direto?" no modal — alterna entre os campos estruturados (host/porta/user/senha) e um único campo de DSN completa, para os dois drivers. Campo de caminho do SQLite também deixou de ser `readOnly` (dá pra digitar direto, não só usar o file picker).
4. ✅ Validado com execução real: reproduzi o erro exato do usuário (`database "wisp_teste" does not exist`) via `TestConnection`, confirmei que com a nova ordem `SaveConnection` nunca é chamado nesse caso (0 conexões persistidas), e que o caminho correto (`wisp_test`) e casos de SQLite (arquivo existente/inexistente) continuam funcionando.
5. ✅ Conferido o banco real do app (`~/.config/wisp/wisp.db`) — sem sobra de conexão quebrada da tentativa anterior do usuário.
6. ✅ Build completo (`go vet`/`gofmt`/`tsc`/`wails build -tags webkit2_41`) validado.

## Pendências/perguntas em aberto
- Nenhuma bloqueante.

## Última atualização
2026-09-14 — Ordem de salvar/testar conexão corrigida (nunca mais salva uma conexão quebrada), binding TestConnection + botão dedicado, modo de colar DSN direto além dos campos estruturados. Ainda pendente: confirmação visual do usuário de toda a leva anterior (editor, streaming/paginação) e desta leva (modal de conexão).



