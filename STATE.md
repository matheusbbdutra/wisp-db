# STATE — Wisp

## 🚀 Release v0.1.0-beta.16 — PUBLICADA (2026-09-22)
- **Tag**: `v0.1.0-beta.16`
- **Release GitHub**: https://github.com/matheusbbdutra/wisp-db/releases/tag/v0.1.0-beta.16
- **Status do Workflow CI**: Sucesso (2m14s) via GitHub Actions + GoReleaser.
- **Artefatos Publicados**:
  - Debian/Ubuntu: `wisp_0.1.0-beta.16_linux_amd64.deb` (5.76 MiB)
  - Fedora/RHEL/openSUSE: `wisp_0.1.0-beta.16_linux_amd64.rpm` (5.76 MiB)
  - Arch Linux: `wisp_0.1.0-beta.16_linux_amd64.pkg.tar.zst` (5.86 MiB)
  - Universal Linux: `wisp_0.1.0-beta.16_linux_amd64.tar.gz` (5.76 MiB)
  - Windows: `wisp_0.1.0-beta.16_windows_amd64.zip` (9.86 MiB) com `wisp.exe`
  - Hashes: `checksums.txt` (SHA-256)
- **Destaque**: Pipeline automatizado de releases multiplataforma via GoReleaser + GitHub Actions.
- **Artefatos gerados pelo CI**:
  - Debian/Ubuntu: `.deb`
  - Fedora/RHEL/openSUSE: `.rpm`
  - Arch Linux: `.pkg.tar.zst`
  - Universal Linux: `.tar.gz`
  - Windows 10/11: `.zip` (com `wisp.exe` nativo)
  - `checksums.txt` (SHA-256)

## 📦 Automação de Releases Multiplataforma (GoReleaser + GitHub Actions) — PRONTO (2026-09-22)
1. **Configuração Unificada do GoReleaser (`.goreleaser.yaml`)**:
   - Compilação do frontend React/Monaco via hook antes do build (`npm --prefix frontend run build`).
   - Build Linux (`id: wisp-linux`): binário ELF com `CGO_ENABLED=1`, `-tags webkit2_41` e `-trimpath`.
   - Build Windows (`id: wisp-windows`): binário PE32+ com `CGO_ENABLED=0`, `-H windowsgui` e `-trimpath` (cross-compile nativo sem necessidade de CGO ou Wine).
   - Empacotamento Linux via nFPM:
     - Debian/Ubuntu: `.deb` com dependências `libwebkit2gtk-4.1-0` e `libgtk-3-0`.
     - Fedora/RHEL/openSUSE: `.rpm` com dependências `webkit2gtk4.1` e `gtk3`.
     - Arch Linux: `.pkg.tar.zst` nativo com dependências `gtk3` e `webkit2gtk-4.1`.
     - Universal Linux: `.tar.gz` contendo executável, assets e licença.
   - Empacotamento Windows: `.zip` com `wisp.exe`, ícone, documentação e licença.
   - Cálculo automático de integridade com `checksums.txt` (SHA-256).
2. **Scripts Compartilhados (`packaging/scripts/`)**:
   - `postinstall.sh` e `postremove.sh` compartilhados entre `.deb` e `.rpm` para regeneração de cache de ícones e base de dados desktop.
3. **Pipeline CI/CD no GitHub Actions (`.github/workflows/release.yml`)**:
   - Disparado exclusivamente em tags de release (`v*`).
   - Custo zero/desprezível (repositório público com runners ilimitados).
4. **Validação**:
   - `goreleaser check`: 100% válido, zero deprecations.
   - `goreleaser release --snapshot --clean`: testado e validado em 9 segundos com geração de todos os 5 formatos.

## 🚀 Release v0.1.0-beta.15 — PUBLICADA (2026-09-22)
- **Tag**: `v0.1.0-beta.15`
- **Release GitHub**: https://github.com/matheusbbdutra/wisp-db/releases/tag/v0.1.0-beta.15
- **Issue Fechada**: [Issue #1](https://github.com/matheusbbdutra/wisp-db/issues/1) (fechada com comentário detalhado).
- **Pacotes Anexados**:
  - Debian: `wisp_0.1.0~beta15_amd64.deb` (6.6 MiB)
  - Arch Linux: `wisp-0.1.0-8-x86_64.pkg.tar.zst` (8.5 MiB)
- **Principais Entregas**:
  1. Resolução cirúrgica da formatação SQL na Issue #1 (`resolveStatementTargetAtOffset`, `formatStatementOrSelection` via `editor.executeEdits`, atalho `Shift+Alt+F`, preservação de histórico de Undo).
  2. Modal "Sobre o Wisp" com versão do app, logo, links úteis externos, tags da stack e licença MIT.
  3. Paridade de cancelamento nativo de queries em SQLite (ADR 0015).

## ✅ Modal "Sobre o Wisp" (About Wisp) — FEITO (2026-09-22)
1. **Identidade e Exibição de Versão**:
   - `app.go`: adicionado binding `GetAppVersion() string` expondo a versão compilada em `version.go` (`AppVersion`).
   - `frontend/wailsjs/go/main/App.d.ts` e `App.js`: registradas declarações de `GetAppVersion`.
2. **Componente e Interface (`frontend/src/components/AboutModal.tsx`)**:
   - Modal com logo do Wisp, badge de versão oficial, subtítulo/descrição com i18n, cards para links úteis (GitHub, Releases e Issues) abrindo no navegador nativo via `OpenReleaseURL`, tags da stack tecnológica (Go, Wails v2, React 19, Monaco Editor, Glide Data Grid, etc.) e nota de licença MIT.
   - Suporte a tecla `Escape` e clique externo no backdrop para fechar.
3. **Integração na Barra Superior (`frontend/src/App.tsx` e `App.css`)**:
   - Adicionado botão discreto `.about-btn` com ícone informativo ao lado do `LanguageSwitcher`.
   - Suporte bilíngue completo em `pt-BR.json` e `en.json`.
4. **Testes e Validação E2E no Navegador**:
   - Validado no Chrome DevTools Protocol (`http://localhost:34115`): abertura do modal ao clicar no botão "Sobre", verificação do nome, versão `v0.1.0-beta.14`, links e tags; validação de alternância dinâmica para inglês ("About Wisp", "Release Notes", etc.) e fechamento com `Escape` e botão `✕`.
   - `npm run test` (54/54 testes passando), `npm run build` e `go test` 100% limpos.

## ✅ Issue #1 — Formatação SQL Cirúrgica por Statement ou Seleção Ativa — FEITO (2026-09-22)
1. **Problema**: O botão "Formatar" reformatava o buffer inteiro do console SQL, substituindo todas as queries da tela de uma vez via `setQuery(format(query))`, perdendo a posição do cursor e resetando o histórico de undo do Monaco.
2. **Scanner e Delimitação Pontual (`frontend/src/lib/sqlStatements.ts`)**:
   - Criada função `resolveStatementTargetAtOffset(full: string, offset: number): StatementRange | null` que localiza com precisão os limites `[start, end]` e o texto do statement SQL associado à posição atual do cursor, preservando terminadores `;` caso existam e excluindo quebras de linha e whitespaces que pertencem ao espaçamento entre queries.
   - Adicionada suíte de testes unitários dedicada em `sqlStatements.test.ts` (18/18 testes passando).
3. **Substituição Cirúrgica no Monaco (`frontend/src/components/SqlEditor.tsx`)**:
   - `SqlEditorHandle`: adicionado método `formatStatementOrSelection(formatter: (text: string) => string)`.
   - Se houver texto selecionado pelo usuário, formata estritamente a seleção via `editor.executeEdits`.
   - Se não houver seleção, localiza o statement sob o cursor via `resolveStatementTargetAtOffset`, formata apenas essa instrução e aplica a edição pontual no range exato via `editor.executeEdits`, mantendo o histórico de Undo (`Ctrl+Z`) e sem mover o cursor para o topo.
   - Adicionado atalho nativo do editor `Shift+Alt+F` mapeado para acionar a formatação.
4. **Integração na ConsoleTab (`frontend/src/components/ConsoleTab.tsx`)**:
   - `handleFormatQuery` agora delega a formatação para `sqlEditorRef.current.formatStatementOrSelection`, mantendo fallback para `setQuery` caso o editor não esteja montado.
5. **Testes e Validação**:
   - `vitest run`: 54/54 testes passando (100%).
   - `npm run build`: `tsc` e `vite build` 100% limpos.
   - `go test -count=1 ./internal/... .`: 100% passando.
   - `git diff --check`: 0 avisos.
   - **Teste End-to-End no Navegador via Chrome DevTools Protocol (`http://localhost:34115`)**:
     - Submetido buffer com múltiplos statements: `SELECT 1;`, `SELECT id, name, email FROM users WHERE id = 1;` e `SELECT 3;`.
     - Cursor posicionado na query intermediária (linha 3, coluna 10). Botão "Formatar" acionado.
     - `SELECT 1;` e `SELECT 3;` permaneceram 100% intactos; apenas o segundo statement foi reformatado em múltiplas linhas identadas.
     - Acionado Undo (`Ctrl+Z`): apenas o segundo statement retornou ao formato original, confirmando preservação do histórico de edições.
     - Selecionado trecho pontual da primeira query: botão "Formatar" formatou unicamente a seleção sem tocar nas demais queries.

## ✅ ADR 0015 — Paridade de Cancelamento Nativo de Queries entre Dialetos — FEITO (2026-09-22)
1. **Cancelamento Nativo no Driver SQLite (`internal/db/sqlite.go`)**:
   - Adicionados campos `mu sync.Mutex` e `cancelQuery context.CancelFunc` na struct `SQLiteDriver`.
   - `Execute` e `ExecuteStreaming` agora vinculam a execução do statement a um contexto cancelável derivado (`queryCtx, cancel := context.WithCancel(ctx)`), registrando a função de cancelamento ativa sob mutex.
   - `CloseCursor` invoca `cancel()` e fecha o cursor de streaming sob mutex garantindo liberação imediata.
   - `CancelRunningQuery` implementado delegando a `CloseCursor()`, o que aciona `cancel()`: isso dispara imediatamente o hook `interruptOnDone` do `modernc.org/sqlite` que chama `sqlite3_interrupt`, interrompendo queries em voo (como CTEs recursivas, joins pesados ou varreduras longas) em microssegundos com `context.Canceled` / erro de interrupção.
   - `FetchNext` atualizado para checar periodicamente `ctx.Err()` dentro do loop de paginação, abortando iterações pendentes imediatamente caso o contexto seja cancelado.
2. **Atualização do Session Manager (`internal/session/manager.go`)**:
   - Comentário de `Manager.Cancel` revisado (em inglês, conforme convenção Go do projeto), removendo a limitação legada sobre o SQLite e formalizando a estratégia uniforme por dialeto (Postgres via `PgConn.CancelRequest`, MySQL via reconnect de `dataConn`, e SQLite via context cancel + `sqlite3_interrupt` no nível do statement).
3. **Bypass de Fila Confirmado no Frontend (`frontend/src/lib/tabApi.ts` e `useResultExecution.ts`)**:
   - Confirmado que `CancelQuery` no frontend ignora intencionalmente a fila serializada `withQueue`, permitindo envio assíncrono e imediato mesmo com consultas em execução na aba.
4. **Testes e Validação**:
   - `internal/db/sqlite_test.go`: adicionados testes unitários cobrindo cancelamento de query simples (`TestSQLiteQueryCancellation`), interrupção de streaming (`TestSQLiteStreamingCancellation`), interrupção durante `FetchNext` (`TestSQLiteCancelRunningQueryDuringFetchNext`) e cancelamento durante query pesada em execução (`TestSQLiteCancelRunningQueryDuringExecute`).
   - `internal/session/session_test.go`: adicionado `TestManagerCancelSQLiteQuery` validando o ciclo de vida completo via `Manager.Cancel`, confirmando interrupção rápida (<30ms) e reutilização da sessão para queries subsequentes sem necessidade de reconexão.
   - **Teste End-to-End no Navegador via Subagente `/browser` + Chrome DevTools (`http://localhost:34115`)**:
     - Servidor de desenvolvimento `wails dev` e Chrome instrumentado via CDP.
     - Conexão estabelecida com sucesso na base SQLite `sample (cópia)`.
     - Inserida e disparada a query recursiva infinita: `WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt) SELECT count(*) FROM cnt;`.
     - Aba entrou em status `rodando...` e o botão "Cancelar" foi exibido na RunBar.
     - Botão "Cancelar" acionado: query abortada com sucesso pelo backend (`erro ao executar: Error: executando query: context canceled`), sem travar a interface.
     - Imediatamente após a interrupção, executada a query `SELECT 1;`: executou em 0 ms e renderizou `Resultados: 1 linha, 1 coluna` no grid Canvas sem necessidade de reconectar.
   - Validações: `go test -count=1 ./...`, `go vet ./...`, `npm run build` (`tsc` + `vite build`), `npx vitest run` (49/49 testes) e `git diff --check` 100% limpos.

## ✅ ADR 0014 — Execução Sequencial de Scripts Multi-Statement (Batch) — FEITO (2026-09-22)
1. **Pipeline de Execução Sequencial em Lote**:
   - `frontend/src/lib/useResultExecution.ts`: implementado `handleRunScript(text, connected, onStatementError)` utilizando o scanner robusto de `splitStatements`.
   - Execução enfileirada sob a fila exclusiva da aba (`withQueue(`${tabId}:query`)`), garantindo atomicidade contra operações paralelas de introspecção ou load-more.
   - Suporte unificado a scripts mistos (DDL, DML e DQL): comandos com dados (`SELECT`) geram abas de resultado correspondentes (`ResultTabState`); comandos DDL/DML acumulam contagem e tempo de execução sem gerar abas vazias.
   - Parada imediata no primeiro erro com criação de aba de erro e chamada a `onStatementError(start, end)`.
   - Cancelamento cooperativo: `handleCancel` interrompe o loop de statements via flag `scriptCancelledRef` e aciona `CancelQuery(tabId)` para abortar a query em voo no servidor.
2. **Affordance Visual e Integração no Editor Monaco**:
   - `frontend/src/components/SqlEditor.tsx`:
     - Atalho de teclado `Alt+X` registrado no Monaco via `editor.addCommand`.
     - `SqlEditorHandle`: adicionados métodos `getScriptTextOrSelection()` (captura seleção ativa ou o buffer completo com `baseOffset`) e `highlightRange(startOffset, endOffset)` (seleciona e centraliza o trecho com erro via `revealRangeInCenter`).
   - `frontend/src/components/ConsoleRunBar.tsx` e `ConsoleToolbar.tsx`:
     - Adicionado botão "Executar script" (`Alt+X`) na `ConsoleRunBar` e na `ConsoleToolbar`.
   - `frontend/src/components/ConsoleTab.tsx`:
     - Atalho global `Alt+X` conectado com tratamento de foco e seleção automática do statement que falhar.
3. **Internacionalização e Testes**:
   - Textos bilíngues em `pt-BR.json` e `en.json` (`runScript`, `runScriptTitle`, `scriptProgress`, `scriptSuccess`, `scriptCancelled`, `scriptErrorAtStatement`, `scriptNoStatements`).
   - `sqlStatements.test.ts`: adicionados testes unitários para verificação de particionamento e precisão de ranges em scripts batch DDL/DML/DQL (49/49 testes passando).
   - **Teste End-to-End no Navegador via Subagente `/browser` + Chrome DevTools (`http://localhost:34115`)**:
     - Conexão ativa no SQLite `sample (cópia)`.
     - **Execução com sucesso**: submetido script misto com 5 comandos (DDL `authors`, DDL `books` com FK, 2x INSERTs e `SELECT * FROM books`). Execução concluída em 2 ms, gerando automaticamente a aba de resultado `books` com 2 linhas e 3 colunas.
     - **Interrupção e Destaque de Erro**: submetido script com erro intermediário (`SELECT 1; THIS IS A SYNTAX ERROR; SELECT 2;`). A execução interrompeu no comando 2, abriu a aba de erro correspondente, abortou o comando 3 e selecionou/destacou automaticamente no Monaco o trecho com erro (`highlightRange` das linhas 1:10 a 2:24).
   - **Correção da Concorrência SQLite (`internal/db/sqlite.go`)**:
     - Diagnosticada e corrigida causa raiz de erro `SQLITE_BUSY` durante batch com DDL: configurado `PRAGMA busy_timeout = 5000;` na abertura da conexão e garantido fechamento imediato de `*sql.Rows` em `ExecuteStreaming` quando `len(columns) == 0` (DDL/DML), liberando locks de escrita instantaneamente sem reter o cursor.
   - Validações: `npm run build` (`tsc` + `vite build`), `npx vitest run`, `go test -count=1 ./...`, `go vet ./...` e `git diff --check` limpos.

## ✅ ADR 0013 — Navegação Relacional por Foreign Keys no ResultGrid — FEITO (2026-09-22)
1. **Mapeamento de Foreign Keys e Normalização**:
   - Criado módulo `frontend/src/lib/foreignKeyNav.ts` (`extractForeignKeyReferences`, `findForeignKeyReference`, `buildForeignKeyFilterQuery`) com 9 testes unitários em `foreignKeyNav.test.ts`.
   - `useResultExecution.ts`: `tryComputeEditContext` agora busca metadados de chaves estrangeiras via `ListForeignKeys(tabId, schema, table)` e anexa `foreignKeys` ao `editContext` mesmo quando a tabela não possui PK (permitindo navegação relacional em tabelas de relacionamento ou unconstrained).
   - `TableTab.tsx`: no `init()`, consulta `ListForeignKeys` em lote mantendo em cache local (`tableFksRef`) e preenche `foreignKeys` no `editContext` da sub-aba Dados, além de alimentar instantaneamente a sub-aba FKs.
2. **Affordance Visual e Ações de Célula no Grid**:
   - `GridCanvas.tsx`: colunas com chaves estrangeiras ganham indicador visual `↗` no título.
   - Células que contêm FK e valor não-nulo recebem destaque em azul (`textDark: '#60a5fa'`) com peso de fonte semibold (`500`).
   - Navegação direta via clique com tecla modificadora: `isCtrlHeld() || event.shiftKey` (suportando ambiente Wayland/Hyprland) navega diretamente para o registro referenciado.
   - Menu de contexto (`GridContextMenu.tsx`): adicionado item dedicado `Ir para [tabela] ([coluna] = [valor])` com ícone 🔗 e atalho de visualização rápida.
3. **Navegação em Nova Aba Dedicada com Pré-Filtro (Preservando Grid de Origem)**:
   - `App.tsx`: `TableTabState` e `handleOpenTable` atualizados para suportar parâmetro opcional `initialFilter: { column, value }`. Ao navegar, uma nova aba `TableTab` é aberta com título descritivo `${table} (${column}=${value})`.
   - `TableTab.tsx`: carrega os dados com query filtrada (`SELECT * FROM ${qualified} WHERE "${column}" = ${value} LIMIT 200`), exibindo uma barra informativa `.table-filter-banner` com botão "Limpar filtro" que permite recarregar a tabela completa sob demanda.
   - O grid anterior permanece intacto com posição de scroll, filtros e seleção preservados (fechar com `Ctrl+W` retorna instantaneamente).
   - Suporte bilingue completo em `pt-BR.json` e `en.json`.
4. **Validação**:
   - `npx vitest run`: 49/49 testes unitários passando (incluindo 9/9 testes de `foreignKeyNav`).
   - `npm run build`: `tsc` e `vite build` limpos.
   - `go test -count=1 ./...` e `go vet ./...` limpos.
   - `git diff --check` limpo.
   - **Teste End-to-End no Navegador via Subagente `/browser` + Chrome DevTools (`http://localhost:34115`)**:
     - **Affordance e Renderização**: `SELECT * FROM books;` renderizou coluna com título `author_id ↗` no GridCanvas e células (`id: 1` e `id: 2`) com destaque azul (`textDark: '#60a5fa'`, peso 500).
     - **Menu de Contexto**: clique na célula abriu menu com opção `"Ir para registro em authors (id = 1)"` (com title `"Abrir registro referenciado em uma nova aba"`).
     - **Navegação e Isolamento de Abas**: ao clicar na ação, abriu instantaneamente nova aba `authors (id=1)` com badge de pré-filtro `Filtrado por: id = 1` e botão interativo "Limpar filtro", exibindo unicamente o registro referenciado (`Machado de Assis`). A aba original `Console 1` permaneceu intacta com todas as sub-abas de resultados preservadas.

## ✅ ADR 0012 — Catálogo Hierárquico em Duas Fases e Lazy Loading de Colunas — FEITO (2026-09-22)
1. **Fase 1 (Catálogo Flat $O(T)$)**:
   - `app.go`: `WarmupCatalog` atualizado para listar tabelas de forma rasa por schema (`ListTables`) em pouquíssimos milissegundos sem consultar `information_schema.columns`, preservando em cache tabelas cujas colunas já foram previamente introspectadas.
   - `frontend/src/lib/useConnection.ts`: `loadCatalog` substituído de introspecção massiva por chamada rasa de `ListTables(tabId, schema)`, eliminando esperas de dezenas de segundos no startup em bases com milhares de tabelas.
2. **Fase 2 (Resolução Lazy de Colunas $O(C)$ sob demanda)**:
   - `frontend/src/lib/useConnection.ts`: implementada função `ensureTableColumns(schema, tableName)` com deduplicação de requisições em voo (`inFlightColumnsRef`), consultando `IntrospectTable` sob demanda e atualizando o estado do catálogo em memória.
   - `frontend/src/components/SqlEditor.tsx`: registrado provider assíncrono `columnLoaderByModel`. Quando o usuário referencia tabelas na query (`FROM/JOIN` via `resolveQueryTables`) ou digita narrowing por ponto (`dot?.kind === 'table-columns'`), o editor solicita as colunas daquelas tabelas específicas em background, preenchendo as sugestões sem travar o editor.
   - `frontend/src/components/ConsoleTab.tsx`: conexão repassada via prop `onEnsureTableColumns`.
3. **Validação**:
   - `go test -count=1 ./...` passando em todos os pacotes.
   - `npm run build` (`tsc` + `vite build`) limpo.
   - `npx vitest run` 49/49 testes unitários passando.
   - `git diff --check` limpo.
   - **Teste End-to-End no Navegador via Subagente `/browser` + Chrome DevTools (`http://localhost:34115`)**:
     - **Catálogo Raso**: inspecionado estado do catálogo em memória no `useConnection`: tabelas `authors`, `books` e `customers` carregadas com `columnsCount: 0`.
     - **Lazy Loading Contextual no Monaco**: digitado `SELECT  FROM books;` (cursor após `SELECT `) e `SELECT books.`; o provider assíncrono disparou a carga exclusiva das colunas da tabela `books`.
     - **Sugestões Exibidas**: popup de autocomplete exibiu exatamente as colunas `author_id` (`main.books · INTEGER`), `id` e `title`. O catálogo atualizou `books` para `columnsCount: 3` mantendo `authors` e `customers` com `columnsCount: 0` (zero desperdício de memória).

## ✅ Release v0.1.0-beta.13 — Scanner de Statements e Correção de Execução Sob Cursor (2026-09-22)
- **Problema**: No console SQL com múltiplos SELECTs (com ou sem ponto e vírgula, com ou sem linhas em branco), ao executar com o cursor posicionado sobre uma query sem selecionar com o mouse, `resolveStatementOrSelection` colapsava ranges em posições de borda (offset logo após `;` ou quebras de linha), retornando string vazia `""`. Na Toolbar do console, o fallback `|| query` enviava o buffer inteiro da tela para o driver PostgreSQL/pgx, resultando em `ERROR: syntax error at or near "SELECT" (SQLSTATE 42601)`.
- **Solução**:
  - Criado módulo `frontend/src/lib/sqlStatements.ts` com parser/scanner robusto (`splitStatements` e `resolveStatementAtOffset`) que preserva strings `'...'` (com escapes `''` e `\'`) e comentários (`--` e `/* ... */`), mapeando ranges `[start, end]` para cada statement delimitado por `;` ou linhas em branco.
  - Implementado isolamento exato: o cursor sobre qualquer ponto de um statement (ou seu delimitador imediato) seleciona única e exclusivamente aquela instrução SQL.
  - Adicionada suíte de testes unitários `frontend/src/lib/sqlStatements.test.ts` (12 casos de teste cobrindo todas as variações e edge cases).
  - Integrado em `frontend/src/components/SqlEditor.tsx`.
  - Bump de versão para `v0.1.0-beta.13` em `version.go` e `pkgrel=6` em `packaging/arch/PKGBUILD`.
  - Reorganizada toda a semântica de releases no GitHub (`v0.1.0-beta.1` a `v0.1.0-beta.13`) com títulos canônicos uniformes, tags alinhadas e flag Pre-release (removido status indevido de "Latest" da beta.12 e preenchida a release faltante da beta.8).
  - Invariante formalizada no `AGENTS.md` (regra fixa #8), `docs/ARCHITECTURE.md` (passo 0 do query flow) e cabeçalho de proteção em `sqlStatements.ts`.
  - Migrado `CLAUDE.md` para o padrão aberto de mercado `AGENTS.md`, com todas as referências cruzadas da documentação e código atualizadas.

## ✅ ADRs 0009, 0010 e 0011 — Cache Reativo, Objetos de Schema e Word Wrap — FEITO (2026-09-22)
Implementação cirúrgica dos 3 ADRs validada com build limpo do frontend (`npm run build`) e backend (`go test -count=1 ./...`):
1. **ADR 0009 — Cache Reativo e Ciclo de Vida**:
   - `internal/store/store.go`: `GetSchemaCacheJSON` sem descarte por TTL (stale-while-revalidate permanente); `DeleteConnection` com transação atômica deletando `query_history` e `connections`.
   - `internal/schemacache/cache.go`: `Get` com read-through que popula a memória a partir do SQLite persistido e método `IsFresh`.
   - `app.go`: `DeleteSavedConnection` invalida `schema_cache` antes de remover a conexão salva (garantindo que histórico e cache só sejam apagados ao excluir a conexão); novos métodos `GetCachedCatalog` (leitura local instantânea em 0ms) e `WarmupCatalog` (introspecção assíncrona em goroutine em background emitindo `wisp:catalog-updated`); emissão de `wisp:catalog-invalidated` em queries DDL.
   - `frontend/src/lib/useConnection.ts`: escuta eventos Wails `wisp:catalog-updated` e `wisp:catalog-invalidated`; usa `GetCachedCatalog` para autocomplete instantâneo sem bloquear a fila de queries do usuário.
2. **ADR 0010 — Catálogo Multi-Objetos por Schema (Anti-God-File)**:
   - `internal/db/driver.go`: structs `Sequence` e `SchemaObjects`; método `ListSequences(ctx, schema)` na interface `DatabaseDriver`.
   - Drivers: implementado `ListSequences` em Postgres (via `information_schema.sequences`), e no-op vazio em SQLite e MySQL.
   - `app.go`: endpoint agregado `ListSchemaObjects(tabID, schema)` que reúne tables, views, functions e sequences em um único DTO.
   - Frontend: hook `frontend/src/lib/useSchemaObjects.ts` e subcomponente `frontend/src/components/SchemaObjectList.tsx` para exibição categorizada; `frontend/src/components/SchemaTab.tsx` refatorado para pills de contagem e busca, conectando `onOpenRoutine` para abrir definições de funções na `RoutineTab`.
3. **ADR 0011 — Quebra de Linha Automática (Word Wrap)**:
   - `frontend/src/components/SqlEditor.tsx`: preferência `WORD_WRAP_STORAGE_KEY` persistida em `localStorage` (default ligado); suporte a `wordWrap` configurável com `wrappingIndent: 'indent'`.
   - `frontend/src/components/ConsoleToolbar.tsx`: toggle de Word Wrap posicionado na toolbar com i18n (`consoleTab.wordWrap` e `consoleTab.wordWrapTitle`) em PT-BR e EN.
   - `frontend/src/components/ConsoleTab.tsx`: estado `wordWrap` conectado do toolbar ao editor.

Plano em `~/.claude/plans/giggly-scribbling-tome.md`. ADR 0007 aceito
(`docs/adr/0007-mysql-mariadb-driver.md`): `go-sql-driver/mysql` v1.10.1 puro
Go + MPL-2.0; MariaDB via mesmo driver; cancelamento via close+reopen do
`*sql.Conn` (KILL QUERY abandonado — ver ADR 0007 update 2026-09-17 sobre a
constraint de uma-query-por-conn em `database/sql`). **Recusados nesta
leva**: Oracle (CGO viola ADR 0002), MongoDB (interface NoSQL não bate com
`DatabaseDriver` relacional).

**Fundação pronta e validada contra MySQL 8.4 reais**:
- `go.mod`: `go-sql-driver/mysql v1.10.1` adicionado, build limpo.
- `testdata/01-init-grants.sql` (cria `reporting` + grant pro `wisp`) e
  `testdata/02-mysql-seed.sql` (tabelas/triggers/views/funções/seed).
  Validado end-to-end: `reporting.customers.total` (coluna gerada) = 20.00
  (=10*2) e 60.00 (=20*3); FK cross-schema `reporting.deals.customer_id`
  → `wisp_test.customers.id` resolvida; view `open_orders` materializada;
  `reporting.total_by_region(1)` retorna 0.00 (correto, região 1 sem orders).
- `testdata/docker-compose.yml`: serviços `mysql:8.4` (porta 3306) e
  `mariadb:11` (porta 3307) com healthchecks; ambos `Up (healthy)`.
- Flag `--log-bin-trust-function-creators=1` no MySQL pra permitir
  CREATE FUNCTION sem privilégio SUPER (erro 1419 do MySQL 8 com binlog).

**Driver MySQL completo e validado end-to-end** (`internal/db/mysql.go`,
`internal/db/factory.go`):
- `internal/db/factory.go`: `DriverMySQL` + `DriverMariaDB` (mesma instância).
- `internal/db/mysql.go`: implementação completa de `DatabaseDriver` —
  Connect/Close, Execute/ExecuteStreaming/FetchNext/CloseCursor, cancel via
  close+reopen, ListSchemas/ListTables/Introspect/IntrospectSchema,
  UpdateCell/InsertRow/DeleteRow/ExecuteBatch (builders locais
  `buildUpdateCellQueryMySQL` etc. — as builders compartilhadas em
  `sqlite.go` usam `"` para quoting, MySQL usa backtick),
  ListIncomingForeignKeys/TableDDL/ListTriggers/ListFunctions/ListIndexes/
  ListForeignKeys.
- `internal/db/mysql_test.go`: testes de integração contra MySQL 8.4 real
  cobrindo todos os caminhos; **6/6 sub-testes passam** (ListSchemas,
  ListTables, Introspect PK + coluna gerada, Execute/Streaming/cancel,
  UpdateCell/DeleteRow/Batch/ListIncomingFKs, TableDDL/Triggers/
  Functions/Indexes/FKs).
- `go vet ./...` limpo, `go test ./...` passa pra TODOS os pacotes
  (wisp, internal/db, internal/errlog, internal/session).

**Bugs reais encontrados e corrigidos durante integração** (todos no driver):
1. `SHOW CREATE TRIGGER` e `SHOW CREATE FUNCTION` retornam **mais colunas**
   do que eu havia estimado na primeira escrita (7 e 6, não 9 e 8). Corrigido
   usando `sql.NullString` por posição, com fallback pra coluna 4 se a 3 vier
   vazia (defensivo contra shift de versão).
2. `SHOW INDEX FROM` no MySQL 8+ retorna 15 colunas (não 13) — inclui
   `Visible` e `Expression` adicionadas no MySQL 8.
3. **Constraint crítica do `database/sql`**: `*sql.Conn` aceita apenas UMA
   statement em voo. Métodos que fazem `SELECT metadata` e depois `SHOW
   CREATE <thing>` na mesma conexão (`ListTriggers`, `ListFunctions`)
   precisam **fechar o cursor** do SELECT antes de rodar a próxima query.
   Erro reportado pelo driver é "bad connection" — enganoso, não é a
   conexão morta. Documentado no ADR 0007 e em comentário nos métodos.

## ✅ Polish de docs (2026-09-17): release v0.1.0-beta.9 + estratégia de distribuição

**README.md** atualizado: lista agora Postgres + SQLite + **MySQL 8+ + MariaDB 10.11+** como suportados; menciona `.deb` (Debian/Ubuntu) + `.pkg.tar.zst` (Arch) na seção Status; seção "Testing locally" agora cobre as 3 instâncias de docker (Postgres, MySQL, MariaDB) e explica que `parseTime=true` é obrigatório pro DSN MySQL/MariaDB.

**docs/ROADMAP.md** atualizado: MySQL/MariaDB sai de "fora de ordem" e entra como **Phase 3+ completed** (v0.1.0-beta.9); DuckDB rebaixado de novo (já tinha saido atrás do MySQL, agora vai pra trás do MariaDB também); nova seção **"Cross-distro packaging (current state + roadmap)"** mapeia RPM, AppImage, Flatpak como follow-up (cada um com a condição que justificaria adicionar).

**docs/adr/0008-distribution-strategy.md** novo:
- Decisão: manter `.deb` + Arch PKG (estado atual, suportado).
- Tarball `.tar.gz` **rejeitado explicitamente** — binário depende de libs do sistema (`libwebkit2gtk-4.1`, `libgtk-3`, etc.), cada distro tem versões ligeiramente diferentes → ABI mismatch é a regra, "static" não resolve. Documentado como pergunta frequente a rejeitar.
- RPM, AppImage, Flatpak **mapeados** com o trigger que justificaria cada um ("Fedora/RHEL user real pede", "cross-distro demand grows beyond .deb+Arch", "sandbox becomes stated requirement"). Nenhum implementado neste ADR.
- Cada um quando implementado deve ganhar seu próprio ADR (`.spec` / `linuxdeploy` invocation / Flatpak manifest) — não retrofitted silenciosamente.

## ✅ Drivers MySQL/MariaDB + clone de conexão — FEITO (2026-09-17)

**Backend novo:**
- `internal/db/mysql.go` — `MySQLDriver` completo (cancelamento via
  close+reopen; SHOW CREATE TRIGGER/FUNCTION drenando cursor antes da
  próxima query; SHOW INDEX com 15 colunas; SHOW CREATE TABLE com 2
  colunas). Validação via teste de integração contra MySQL 8.4 real —
  6/6 sub-testes passando (ListSchemas, ListTables, Introspect PK + gerada,
  Execute/Streaming/cancel, UpdateCell/DeleteRow/Batch/ListIncomingFKs,
  TableDDL/Triggers/Functions/Indexes/FKs).
- `internal/db/factory.go` — `DriverMySQL`/`DriverMariaDB` (mesma
  instância, protocolo compartilhado).
- `internal/store/store.go` — struct `SavedConnectionEdit` (DSN
  descriptografada) separada de `SavedConnection` (que nunca descriptografa
  — superfície de exposição reduzida).
- `app.go` — `GetConnectionForEdit(id) (SavedConnectionEdit, error)` com
  regra de auditoria no comentário: consumido SÓ pelo ConnectionModal.

**Frontend novo:**
- `frontend/src/components/ConnectionModal.tsx`:
  - Pílulas MySQL/MariaDB adicionadas
  - Form específico (porta 3306, sslmode `preferred/required/skip-verify/false`)
  - `buildDsn()` constrói `user:pass@tcp(host:port)/db?parseTime=true&tls=...`
    — `parseTime=true` é default sempre (sem isso colunas DATE/DATETIME viram
    []byte ilegível no JSON IPC)
  - Props `cloneSourceId?: string` + `onCloneRequest?: (id) => void`
  - useEffect que carrega DSN quando `cloneSourceId` muda, força
    `rawDsnMode=true`, sugere nome `"<original> (cópia)"`
  - Botão "Clonar" na lista manage (entre Conectar e Excluir)
- `frontend/src/components/ConnectionBar.tsx`: state `cloneSourceId`,
  handler que seta o state + abre modal; limpa `cloneSourceId` em todos os
  pontos de fechamento do modal pra não vazar pra próxima abertura.
- `frontend/src/i18n/locales/{en,pt-BR}.json`: chaves novas
  (`mysqlDesc`, `mariadbDesc`, `sslSkipVerify`, `clone`, `cloneTitle`,
  `errorCloneLoad`, `errorMysqlDatabase`, `rawDsnPlaceholderMysql`,
  `rawDsnHintMysql`).
- `frontend/wailsjs/go/**` regenerado via `wails generate module`.

**Verificação ponta-a-ponta:**
- `go build ./...` limpo
- `go vet ./...` limpo
- `go test ./... -count=1` passa em todos os pacotes (wisp, internal/db,
  internal/errlog, internal/session)
- `npx tsc --noEmit` limpo
- `npm run build` limpo (apenas aviso conhecido de bundle > 500KB)
- `npx vitest run` 27/27 passando
- `git diff --check` limpo

**Pendente (decisão consciente, parar aqui pra você testar):**
- Verificação manual na janela nativa (não automatizável): abrir Wisp,
  criar conexão MySQL/MariaDB via modal, conectar, rodar query, abrir
  TableTab, clonar conexão mudando IP, validar que tudo funciona.
- Após teste manual positivo: commit + bump de versão (sugiro
  v0.1.0-beta.9 — já que beta.8 foi o último).

## ✅ Validado (2026-09-16): `restoreLastScript` não tem bug de closure obsoleta
Pendência pré-existente do STATE.md (S3): o `getQuery: () => string` em
`useScriptState.ts:131-155` é uma **função getter**, não um valor capturado
— cada chamada dentro do `.then(...)` lê o `query` atual do escopo do
componente. Bug não existe mais no código pós-S3. Anotado como resolvido
por leitura, sem alteração de código.

## ✅ Executado (2026-09-16): S1/S2/S3/S5/S6, S4 virou roteiro acima
Ordem crítico→simples. S3: ResultGrid 1134→311, ConsoleTab 1037→353 (hooks
useGridFilter/useGridCopy/usePendingBatch/useCellEditing/useEditability/
useValuePanel/useConnection/useResultExecution/useScriptState + componentes
pequenos). S5: version.go fonte única + isNewerVersion semver + version_test.go
(12 casos), build.sh deriva VERSION (`0.1.0~beta7` confirmado). S1: linha
`// replace` removida (grep 0). S2+S6: receipts/ ignorados. Validado por mim:
tsc, vite build, vitest 27/27, go build/vet/test, diff --check. Revisão do
Claude (delegate 20260916T195924): APROVAR — sem divergência de comportamento
nos pontos críticos; ressalva: ele não rodou builds (bloqueio do harness
dele), compilação verificada só por mim. Sem commit (não pedido).

## 🐛 Fix (2026-09-16): painel de valor no lado errado após S3
Causa raiz: na reescrita do ResultGrid, o `CellValueViewer` saiu de dentro
de `.result-body` (flex row → dock à direita) pra dentro de
`.result-container` (flex column → caía pra baixo do grid); o overlay de
edição (`position:absolute`) também perdeu o ancestral `relative`
(`.result-grid-canvas`). Fix: `GridCanvas` aceita `children` (menu, popover,
review voltam pra dentro do canvas) e o viewer volta pra dentro do
`.result-body` — mesmo aninhamento do original. Sem teste mantido: repo não
tem harness de componente (sem jsdom/testing-library); adicioná-lo só pra
isso é desproporcional — verificação por tsc/build/vitest + diff estrutural
+ confirmação visual do usuário.

## 💡 Não-bloqueantes pré-existentes (2026-09-16, sem ação)
a. `restoreLastScript` compara contra `query` do mount (closure obsoleta) —
confirmado idêntico no original (ConsoleTab HEAD:706-728); corrigir mudaria
comportamento, fora do escopo do refactor.
b. `usePendingBatch` mistura staging/preview/execução (SRP) — extração 1:1,
não agravado; quebrar mais aumenta risco sem ganho atual.
c. `loadCatalog` usa 4 refs em vez de máquina de estado — extração fiel;
unificar é refactor comportamental, adiar p/ quando mexer no catálogo.

## 🧪 A validar manualmente (2026-09-16): S4 + regressão do S3
Roteiro p/ janela nativa (não executável por agente — exige DB real + Webview).
Pré-requisito: build com as mudanças S1–S3+S5 (beta8 ou dev contra staging).

**A. Autocomplete multi-schema (beta7+, banco real c/ vários schemas):**
1. `FROM sigfacil.s_solicitacao` → sugere schema/tabela certos, sem coluna de outro schema no meio.
2. `WHERE` sem alias → colunas das tabelas do FROM/JOIN primeiro.
3. `alias.` após JOIN → só colunas da tabela do alias.

**B. ErrorBoundary + ReportFrontendError:** forçar erro de render temporário →
fallback visual + linha NDJSON em `wisp.log` com DSN redigido (`***`), sem query literal.

**C. Panic recovery (main.go):** panic síncrono alcançável → logado em `wisp.log`, processo repropaga (não silencia).

**D. Regressão do refactor S3 (comportamento idêntico):**
1. Filtrar grid → editar célula filtrada salva na linha REAL; copiar célula/linha/seleção filtrada.
2. Staging INSERT (rascunho verde) + DELETE (vermelho) → Revisar → Executar; erro inline não limpa pendências.
3. Console: salvar/sobrescrever script, fechar aba com SQL sujo (3 botões), Explain, load-more, fechar aba de resultado.
4. Toggle scripts/history/painel de valor; resize sidebar/editor.

**Evidência:** anotar passou/falhou por item + trechos do `wisp.log` (redigidos).
Se achar bug, abrir spec de fix separada (não misturar aqui).

## 🚧 Em andamento (2026-09-16): captura local de erros (base para "Reportar problema")
Decisão do usuário: em vez de Sentry (rejeitado — risco de vazar DSN/query
mesmo com DSN client-side não sendo segredo em si) e em vez de abrir issue
automática no GitHub (rejeitado — exigiria token de escrita real embutido
no binário público, abusável), a captura fica 100% local; reportar é ação
manual do usuário depois (URL pré-preenchida de issue, ele revisa e
submete — ainda não implementado, é o próximo passo).

**Feito nesta etapa (captura local):**
- `internal/errlog/errlog.go` (pacote novo): log local em NDJSON (JSON
  Lines, um objeto por linha — apêndice seguro mesmo se o processo morrer
  no meio, ao contrário de um array JSON único) via `log/slog` da stdlib
  (Go 1.26, sem dependência nova). Escreve em `<user config>/wisp/wisp.log`
  (mesmo diretório do `wisp.db`). Rotação simples por tamanho (5MB →
  `.log.1`, sobrescrito). `Scrub()` redige DSN (`scheme://user:pass@host`
  → `scheme://***@host`) e literais SQL entre aspas simples ANTES de
  persistir — nunca depois.
- `main.go`: `recover()` no nível de `main()` loga o panic (via
  `errlog.Error`) e repropaga — cobre panics síncronos alcançáveis a
  partir de `wails.Run`/`OnStartup`/etc.; **não cobre** panic em goroutine
  solta (limitação conhecida, documentada no comentário).
- `app.go`: `errlog.Init(dbDir)` no `startup`, `errlog.Close()` no
  `shutdown`; novo método bindado `ReportFrontendError(source, message,
  stack)` para o frontend reportar erro não tratado.
- Frontend: `lib/errorReporting.ts` (`window.onerror` +
  `unhandledrejection` → `ReportFrontendError`) instalado uma vez em
  `main.tsx`; `components/ErrorBoundary.tsx` (classe React, único jeito de
  capturar erro de render) envolvendo `<App/>` em `main.tsx`, com fallback
  visual (`errorBoundary.*` em `en.json`/`pt-BR.json`, CSS em `App.css`
  `.error-boundary`).
- `frontend/wailsjs/**` regenerado via `wails generate module` (inclui o
  binding novo `ReportFrontendError`; diff em `models.ts` é só whitespace,
  igual ao padrão já visto no commit `b125f5c`).

**Verificado por mim:** `go build ./...`, `go vet ./...`, `go test ./...
-count=1` (sem cache) passaram, incluindo `internal/errlog/errlog_test.go`
novo (3 casos: redige credencial de DSN, redige literal entre aspas, não
toca mensagem sem dado sensível). Verificação manual extra fora dos
testes automatizados: rodei um `main` descartável chamando
`errlog.Init`/`errlog.Error`/`errlog.Close` de verdade contra um diretório
temporário e li o `wisp.log` resultante — confirmei na prática que a
linha NDJSON sai como esperado e a credencial aparece redigida
(`postgres://***@host:5432/app`), não em texto puro. `tsc --noEmit`,
`npm run build` (só avisos conhecidos de dependência) e `npx vitest run`
(27/27) passaram no frontend.

**Não verificado:** teste manual na janela nativa (React ErrorBoundary
disparando de verdade num erro de render real, e o Go panic recovery
disparando de verdade) — só testei a lógica isolada (Scrub + escrita em
disco), não o fluxo ponta a ponta dentro do app rodando via Wails.

**Próximo passo (não implementado ainda):** UI de "Reportar problema" que
lê o `wisp.log`, mostra o erro já escrubado pro usuário revisar, e abre
`github.com/.../issues/new?body=...` no browser — nada é enviado sem o
usuário ver e confirmar.

---

## ✅ Corrigido (2026-09-16): autocomplete não escopava por tabela em bancos com muitos schemas
Causa raiz confirmada em `frontend/src/components/SqlEditor.tsx`: fora do
contexto `alias.` (ponto), o provider do Monaco sempre listava
tabelas/colunas do **catálogo inteiro**, sem filtrar pelas tabelas já
referenciadas no `FROM`/`JOIN` da query atual. `buildColumnSuggestions`
deduplicava só por **nome** de coluna (não por schema+tabela+nome), então
com colunas homônimas em tabelas diferentes (`id`, `created_at`, etc. —
comum em bancos com muitos schemas), a coluna da tabela errada "vencia" e
aparecia como se fosse da tabela relevante — exatamente o bug relatado
pelo usuário ("traz uma coluna que não tem relação"). No `WHERE` (sem
alias), as colunas relevantes ficavam afogadas entre centenas de outras
sem prioridade nenhuma.

**Correção 1:** nova função `resolveQueryTables()` reaproveita
`extractTableAliases()` (já usado em `resolveDotContext` para `alias.`)
para resolver as tabelas do FROM/JOIN mesmo sem alias explícito. No
fallback sem ponto, essas tabelas agora geram sugestões de coluna com
`sortText` prioritário (`'0'`, dedupe por `schema.tabela.coluna`) e o
catálogo inteiro continua disponível como fallback de menor prioridade
(`'1'`) — nada foi escondido, só reordenado. `buildTableSuggestions`
também ganhou `sortText` para consistência.

**Correção 2 (causa raiz mais grave, confirmada com exemplo real do
usuário):** logo após `FROM`/`JOIN` (primeiro token, sem ponto/alias
ainda), o provider misturava tabelas E colunas na mesma lista com a mesma
prioridade. Exemplo relatado: schema `sigfacil` com tabela
`s_solicitacao`; ao digitar `FROM s_solicitacao`, aparecia uma **coluna**
de outro schema (`apache`) em vez da tabela — porque qualquer coluna de
qualquer tabela/schema que combinasse com o texto digitado competia de
igual pra igual com a tabela certa. Nova função `isAfterFromOrJoin()`
detecta esse contexto (mesma inspeção de string sem parser SQL, mesma
limitação aceita de `resolveDotContext`: só funciona quando FROM/JOIN
está na mesma linha do cursor) e, quando verdadeiro, a lista fica restrita
a schema+tabela — nunca coluna.

**Verificado por mim:** `tsc --noEmit`, `npm run build` (só avisos
conhecidos de dependência), `npx vitest run` (27/27), `go build ./...` e
`go vet ./...` passaram após as duas correções. **Não verificado:** teste
manual num banco real com múltiplos schemas (o cenário relatado usa infra
da empresa do usuário, só reproduz nesse PC — usuário só consegue validar
numa build de release, não em dev).

**Release preparada a pedido do usuário:** `version.go` → `v0.1.0-beta.7`
e `packaging/deb/build.sh` (`VERSION="0.1.0~beta7"`), mesmo padrão do
commit `b125f5c` (beta6). **Eu não empacotei nem publiquei nada** — isso
é ação visível/de distribuição, fora do meu escopo sem pedido explícito.
Pra gerar o artefato: `packaging/deb/build.sh` (Debian/Ubuntu 22.04+) ou
`makepkg` via `packaging/arch/PKGBUILD` (Arch — `pkgver`/`pkgrel` não
carregam o sufixo beta, não precisou de bump aí). Pendente: usuário
instala no outro PC e confirma se `FROM sigfacil.s_solicitacao` (e casos
parecidos) agora sugere schema/tabela certos sem coluna de outro schema
aparecendo no meio.

---

## ✅ Concluído (2026-09-16): staging INSERT/DELETE no ResultGrid
Delegate `20260916T131731-grid-batch-review` (Cursor).

**Validação retomada (2026-09-16):** `npm run build` (inclui `tsc`),
`go build ./...` e `go vet ./...` passaram. O Vite emitiu somente avisos de
anotações `PURE`/tamanho de bundle vindos de dependência; nenhum erro do
código do projeto. O usuário confirmou o fluxo funcionando na janela nativa
(staging, revisão, confirmação e execução). `git diff --check` também passa.

**Feito (código):**
- `ResultGrid.tsx`: removidos popovers imediatos de insert/delete; staging
  multi-linha (`pendingInserts` verdes no fim do grid + `pendingDeleteRows`
  vermelhos); toolbar "Revisar mudanças (N)" / "Descartar mudanças"; execução
  via `ExecuteBatch` + callbacks `onRowInserted`/`onRowDeleted` (deletes em
  ordem decrescente de índice).
- Novo `PendingChangesReview.tsx`: preview SQL textual, copiar, aviso CASCADE
  via `ListIncomingForeignKeys` + checkbox obrigatório, erro inline sem limpar
  pendências.
- i18n `resultGrid` em `en.json` / `pt-BR.json`; CSS em `App.css`
  (`.pending-changes-*`).

**Verificação anterior:** ReadLints sem erros nos arquivos tocados. A
verificação de shell agora foi concluída conforme registrado acima.

**Não tocado (contrato):** `.go`, `wailsjs/`, i18n infra, outros componentes.

**Fila atual após o encerramento da Fase 3:** não há implementação urgente
definida. Os próximos itens dependem de demanda real: transações explícitas,
exportação de datasets grandes, driver MySQL, integração de agentes via MCP,
túnel SSH e DuckDB. O autocomplete de aliases ainda merece confirmação em
queries reais do usuário; os demais itens da Fase 3 estão concluídos no
`docs/ROADMAP.md`.

**Bug identificado após a beta5:** em bancos grandes, o pré-carregamento do
catálogo de autocomplete ocupava a conexão/fila principal até terminar. Uma
consulta iniciada nesse intervalo aparecia como `queued`; o botão Cancelar
chamava apenas `CancelQuery`, que não remove uma tarefa ainda não iniciada da
fila. A correção usa conexão e fila próprias para metadados, carrega o
catálogo sob demanda quando o autocomplete é solicitado e trata o
cancelamento de consultas `queued` no frontend. Verificação: backend
(`go test ./...`, `go vet ./...`), 27 testes frontend, `npm run build` e
`git diff --check` passaram; falta confirmação manual na janela nativa antes
de publicar a próxima beta.

---

## ✅ Checkpoint de delegação em massa (2026-09-16): i18n + comentários Go + polish visual
Sessão inteiramente delegada (Cursor > Codex, na ordem preferida pelo
usuário a partir de agora), com meu papel restrito a desenhar o contrato
técnico, disparar via `delegate-run`, e **verificar eu mesmo** (nunca só
aceitar o relato do agente) antes de aceitar cada rodada.

**1. i18n da UI concluída** (todos os componentes React, `docs/adr/0006-i18n.md`):
- Infra própria (não delegada): `frontend/src/i18n/index.ts` (i18next +
  react-i18next, detecção por `navigator.language`, override em
  localStorage), `frontend/src/i18n/locales/{en,pt-BR}.json`,
  `LanguageSwitcher.tsx` (seletor na tab bar), `Sidebar.tsx` migrado como
  componente de referência de estilo pra delegação.
- **Batch1** (Cursor, `20260916T120442-i18n-batch1`): ConnectionBar,
  ConnectionModal, QueryHistory, CellValueViewer.
- **Batch2** (Cursor, `20260916T121303-i18n-batch2`): ScriptsPanel,
  UpdateChecker, RoutineTab, SchemaTab.
- **Batch3** (Cursor, `20260916T121850-i18n-batch3`): App, ConsoleTab,
  ResultGrid, SqlEditor, TableTab.
- Verificado por mim: nenhuma string PT-BR visível remanescente (grep em
  todo `frontend/src`), `tsc --noEmit` e `npm run build` limpos após cada
  rodada e no final.

**2. Comentários Go migrados para inglês** (Codex, `20260916T120756-go-comments-en`,
política em `AGENTS.md`/`docs/adr/0006-i18n.md`): os 10 arquivos com
comentário PT-BR (`app.go`, `internal/db/{driver,factory,postgres,sqlite}.go`,
`internal/schemacache/cache.go`, `internal/session/manager.go`,
`internal/store/store.go`, `internal/vault/vault.go`, `version.go`) —
significado técnico preservado (causas raiz, invariantes, referências a
memórias/ADRs mantidas literais). Verificado por mim: `go build ./...` e
`go vet ./...` limpos; só restam 2 ocorrências de "PT-BR" que são
referências literais a seções do `AGENTS.md` dentro de comentário já em
inglês (correto, não é resíduo).

**3. Polish visual** (Codex, `20260916T122129-ui-polish`, lista das 3
análises de UX anteriores): removido o `tabId` cru visível na toolbar do
Console (`ConsoleTab.tsx`), hit-area maior nos resize-handles, `:focus-visible`
global, `.table-subbar` virou segmented control, scrollbars customizadas
(`--scrollbar-thumb*`), contraste de `--text-muted` ajustado (`#71717a` →
`#93939e`), empty states unificados.

**Risco real identificado e verificado nesta sessão**: batch3 (i18n) e
ui-polish rodaram **concorrentemente** (ambos tocando `ConsoleTab.tsx` e
`ResultGrid.tsx`, meu erro de sequenciamento — deveria ter serializado por
arquivo). Conferi manualmente depois: a remoção do `tabId` visível (polish)
sobreviveu ao lado das chaves `t(...)` novas (i18n) — sem sobrescrita real
neste caso, mas foi sorte de timing, não garantia. **Lição pra próxima
delegação em paralelo**: nunca disparar dois alvos que tocam o mesmo
arquivo ao mesmo tempo; serializar ou dividir por arquivo/diretório sem
overlap.

**Nada commitado ainda** — `git status` mostra 30 arquivos modificados +
`frontend/src/i18n/` e `LanguageSwitcher.tsx` novos. Pendente: usuário
revisar/testar na janela nativa antes de commitar (idioma/troca EN↔PT-BR,
visual do polish) — não fiz teste end-to-end via Claude in Chrome nesta
rodada, só verificação estática (tsc/build/go build/go vet + grep).

**Autocomplete de alias**: usuário ainda não testou (respondeu "ainda não"
nesta sessão) — segue pendente, sem achado novo.

## ✅ Revisão de código pelo Codex (2026-09-15) + 3 bugs reais corrigidos
Primeira tentativa (`20260915T233639-wisp-code-review-ui-codex`) falhou: o
sandbox do Codex bloqueia aprovação de tool call, então `memory` MCP nunca
respondia (`approval_policy=never` no ambiente dele). Retentei embutindo
todo o contexto direto no prompt (`--prompt-file`, sem depender de MCP) —
funcionou. Relatório completo em
`docs/analysis/code-review-ui-changes-2026-09-15-codex.md` (9 achados,
verificação explícita dos 6 pontos de risco que eu tinha apontado).

**3 bugs reais confirmados e corrigidos:**
1. **Arrasto do painel de valor invertido** — `useDragResize` foi desenhado
   pra painéis à ESQUERDA (Sidebar); o painel de valor é à DIREITA, então
   arrastar respondia ao contrário do cursor. Fix: novo parâmetro
   `invert?: boolean` no hook (`frontend/src/lib/useDragResize.ts`), usado
   pelo `valuePanelResize` em `ResultGrid.tsx`.
2. **Índice UNIQUE do SQLite sempre mostrava "não"** — `indexInfo` nunca
   lia o flag de unicidade (comentário antigo dizia "over-engineering",
   mas isso fazia a UI mentir, não só omitir). Fix: `uniqueIndexNames`
   novo em `internal/db/sqlite.go`, lê `PRAGMA index_list(tabela)` uma vez
   e cruza pelo nome do índice.
3. **`bytea` real virava lixo irrecuperável** — `normalizeCellValue`
   (fix de XML da rodada anterior) convertia QUALQUER `[]byte` pra
   `string`, incluindo binário genuíno — bytes que não formam UTF-8 válido
   viram U+FFFD (replacement character), perda permanente. Fix:
   `normalizeRowSkipping` (`internal/db/driver.go`) preserva `[]byte` como
   está pras colunas identificadas como binárias (Postgres: OID 17/bytea
   via `pgtype.ByteaOID`, `binaryColumnMask` em `postgres.go`; SQLite:
   `DatabaseTypeName() == "BLOB"`, `binaryColumnMaskSQLite` em
   `sqlite.go`) — volta a virar base64 em JSON pra esses casos (reversível,
   comportamento de antes desta sessão), enquanto XML/texto sem codec
   continua sendo convertido pra string legível.

**Verificado contra Postgres real**: `metadata_xml` (`invoice_lines`)
continua mostrando texto real depois do fix (não regrediu); coluna
`bytea` de teste (`decode('deadbeef','hex')`) mostrou `3q2+7w==` — base64
correto e reversível, não mais bytes mangled.

**Achados do Codex não corrigidos nesta rodada** (documentados no
relatório completo, ficam pra depois — nenhum é regressão introduzida
por mim, todos são refinamento):
- Formatador XML (`valueFormat.ts`) não faz escaping de entidades ao
  reserializar e descarta CDATA/comentários — o valor exibido/copiado
  pode divergir sutilmente do original em casos com `&`/`<`/CDATA.
- FK reconstruída do SQLite (`ListForeignKeys`) perde `ON DELETE/UPDATE
  CASCADE` e pode gerar `REFERENCES parent ()` (parênteses vazios) se a
  FK não lista colunas explícitas.
- Sidebar: indicador "buscando…" pode ficar preso se o usuário limpar a
  busca no meio de um fetch; erro de `ListTables` durante busca é
  engolido silenciosamente (não interrompe nem avisa).
- `valuePanelCell`/seleção do grid: janela transitória (não crash, só
  render potencialmente desatualizado por um frame) quando o filtro muda
  com o painel de valor aberto; editar uma célula que deixa de bater com
  o filtro ativo pode deslocar o "significado" do índice de seleção
  visual (0 passa a apontar pra outra linha real).
- `testdata/postgres-seed.sql` não é idempotente se reaplicado sobre um
  container já inicializado por uma versão anterior do seed (ALTER
  ausente pras colunas novas) — usar sempre `docker compose down -v &&
  up -d` pra recriar do zero, não reaplicar o `.sql` num container vivo.

`go build`/`go vet`/`tsc --noEmit`/`npm run build` limpos depois dos 3 fixes.

Checkpoint compacto pra retomar em sessão nova. Histórico detalhado de cada
mudança está nos commits do git (`git log`), não duplicado aqui.

## ✅ Concluído nesta sessão (2026-09-15) — "Tabela como aba própria" + Ctrl+click

Commit da feature anterior (edição inline de células) feito no início da
sessão (`4a74409`). Contratos técnicos completos nas memórias
`wisp-table-tab-task-context` e `wisp-ctrlclick-open-tabs-task-context`.
Decisão confirmada com o usuário: cada aba de tabela/schema aberta tem
`tabId`/conexão **próprios** (reconecta via `ConnectSaved` com o mesmo
`connectionId` da origem), nunca reusa a sessão do console — custo aceito:
N abas = N conexões reais.

**Backend** (`Trigger`/`Function` + `TableDDL`/`ListTriggers`/`ListFunctions`
na interface `DatabaseDriver`, Postgres via `information_schema`+`pg_get_*def`,
SQLite via literal de `sqlite_master.sql`, 3 bindings em `app.go`) — via
OpenCode + minha revisão. **Bug real corrigido por mim**: a query de
constraints do Postgres (`TableDDL`) não selecionava `conname`, gerando SQL
inválido (`CONSTRAINT PRIMARY KEY (id)` sem nome). **Validado contra SQLite
real** (DDL/Triggers/Functions corretos). Postgres real ainda não testado
(serviço local inativo nesta sessão).

**Frontend**: `App.tsx` com `TabState` união de 3 kinds (`console`/`table`/
`schema`); `Sidebar.tsx` com botão ↗ por tabela E ctrl+click (tabela → abre
TableTab; schema → abre SchemaTab; sem ctrl, comportamento antigo inalterado);
`TableTab.tsx` (sub-abas Dados/DDL/Triggers/Funções, lazy-load); `SchemaTab.tsx`
(lista de tabelas do schema, cada uma abre sua própria TableTab) — via OpenCode
+ minha revisão, 2 rodadas de delegação.

**Bug real de causa raiz encontrado e corrigido por mim** (não veio da
delegação — achei testando via Claude in Chrome): `TableTab`/`SchemaTab`
conectam no mount via `useEffect`; o React StrictMode (dev) monta→desmonta→
remonta o efeito rapidamente, e as duas chamadas a `ConnectSaved` (mesmo
tabId) corriam concorrentes no backend — `Manager.Open` (`internal/session`)
cancela a sessão existente do mesmo tabId ao reconectar (comportamento
correto isoladamente), mas se a chamada da montagem obsoleta terminasse
DEPOIS da montagem real, cancelava a sessão que já estava em uso →
`"context canceled"` na primeira query da aba nova. Fix: novo módulo
`frontend/src/lib/connectLock.ts` (`withConnectLock`) serializa o connect por
tabId; a montagem obsoleta se desconecta antes de liberar o lock. **Ver
memória `wisp-table-schema-tab-context-canceled-fix`** pro relato completo.

**Nota tangencial resolvida**: uma exceção genérica `Cannot read properties of
null (reading 'nodes')` em `wails/ipc.js` apareceu recorrentemente durante os
testes — confirmado que é ruído do dev-bridge do Wails ao testar via Chrome
puro (não correlaciona com falha real, aparece até em cliques que funcionam
perfeitamente). Não é bug, não precisa de mais investigação.

**Verificado de ponta a ponta por mim mesmo** via Claude in Chrome (SQLite
real, `wails dev -tags webkit2_41`): ctrl+click numa tabela abre TableTab e
carrega Dados/DDL/Triggers/Funções corretos; ctrl+click num schema abre
SchemaTab, lista tabelas, clicar numa delas abre sua própria TableTab
aninhada — sem `context canceled` depois do fix. `go build`, `tsc --noEmit`
e `npm run build` limpos em todas as rodadas.

**Testado contra Postgres real** (subimos `docker compose up -d` em
`testdata/docker-compose.yml`, seed com PK simples/composta/coluna gerada +
trigger/função ad-hoc criados via `psql` só para o teste, removidos depois):
- `customers` (PK simples + UNIQUE `email`): DDL correto, incluindo o nome
  da constraint UNIQUE (`customers_email_key`) — confirma o fix de `conname`.
- `order_items` (PK composta): DDL com `PRIMARY KEY (order_id, item_seq)` correto.
- `invoice_lines` (coluna gerada `total`): **2º bug real encontrado e
  corrigido nesta rodada** — `TableDDL` perdia a expressão `GENERATED ALWAYS
  AS (...) STORED` completamente (gerava só `"total" numeric,`, que rodado de
  verdade criaria uma coluna normal em vez de gerada). Fix: query de colunas
  agora também lê `is_generated`/`generation_expression` de
  `information_schema.columns`. Revalidado depois do fix: DDL mostra
  `GENERATED ALWAYS AS ((unit_price * (quantity)::numeric)) STORED,`
  corretamente. Ver memória `wisp-table-ddl-generated-column-fix`.
- Trigger e função reais (`trg_customers_touch`/`touch_updated_at`, criados
  ad-hoc, removidos depois de testar): definição completa e correta nas
  sub-abas Triggers/Funções.

`go build`, `tsc --noEmit` e `npm run build` limpos depois do 2º fix.

## Ctrl+click não funcionava na janela nativa — bug real de plataforma encontrado e corrigido
Depois de reportar a feature como pronta, o usuário testou na janela nativa e
Ctrl+click não fazia nada — nem na Sidebar, nem no editor. Eu errei ao concluir
de cara "é o seu WM/Hyprland engolindo globalmente" sem evidência — o usuário
contestou corretamente (se fosse isso, precisaria configurar TODO app). Investigação
real: Ctrl+Enter (atalho já existente, via `editor.addCommand` do Monaco) sempre
funcionou pro usuário — prova que o Ctrl chega certo via teclado (keydown/keyup),
mas **`MouseEvent.ctrlKey` de um clique real não chega correto** nesse ambiente
(GTK/WebKitGTK sob Wayland/Hyprland) — bug real de plataforma, não do nosso código
nem do WM interceptando. Ver memória `wisp-ctrlclick-mouseevent-ctrlkey-unreliable-fix`
pro relato completo (inclui um mal-entendido de UI no meio do caminho: o usuário
queria Ctrl+click **dentro do editor SQL** estilo DBeaver, não só na Sidebar).

**Fix**: novo `frontend/src/lib/modifierKeyTracker.ts` (`isCtrlHeld()`) rastreia
Ctrl/Meta via `keydown`/`keyup` global, independente do clique. Usado em
`Sidebar.tsx` (substituindo `e.ctrlKey`) e na **feature nova**: Ctrl+click num
identificador dentro do editor Monaco (`SqlEditor.tsx`, novo `onMouseDown` +
prop `onOpenIdentifier`) abre a TableTab/SchemaTab do nome clicado na query —
`ConsoleTab.tsx` resolve contra o catálogo já carregado, ignora silenciosamente
identificadores que não correspondem a nada real (typo/keyword).

**Verificado via Claude in Chrome** simulando o estado real de teclado com
`window.dispatchEvent(new KeyboardEvent('keydown'/'keyup', {key:'Control'}))`
(não `modifiers:'ctrl'` do CDP no clique, que não reproduz/valida o bug real):
Ctrl+click em "customers" dentro de `SELECT * FROM public.customers` abriu a
TableTab certa; Ctrl+click em "public" abriu a SchemaTab certa.

**Confirmado pelo usuário na janela nativa**: Ctrl+click funciona na Sidebar E
dentro do editor SQL (abriu a TableTab certa a partir do nome da tabela na
query). Logs de diagnóstico temporários removidos, build final limpo
(`go build`, `tsc --noEmit`, `npm run build`).

## 📋 Análise pós-beta.1 — próxima leva (2026-09-15, só proposta)
Sessão de análise (sem código). Contexto: autor testa `.deb` na empresa pra
substituir DBeaver. Priorização sugerida (detalhe na resposta da sessão):
(1) views/índices/FKs na exploração, (2) visor de valor de célula (JSON/texto),
(3) filtro rápido na TableTab/grid, (4) EXPLAIN textual, (5) INSERT/DELETE
seguro no grid, (6) busca na sidebar. Despriorizar agora: MCP, query builder,
busca semântica, sync, SSH (VPN), export grande/Parquet, DuckDB sem demanda.
`docs/ROADMAP.md` ainda marca edição inline como pendente e Fase 2.6 aberta —
desatualizado vs release. **Próximo passo**: usuário escolher a leva; só então
implementar.

## ✅ Release v0.1.0-beta.1 publicada (2026-09-15)
Commits `9f448ce` (feature completa) e `cbd0cf9` (versão do .deb) na branch
`master`, remote `git@github.com:matheusbbdutra/wisp-db.git` configurado via
SSH (chave já cadastrada na conta). Tag `v0.1.0-beta.1` criada e enviada.
Release publicada em https://github.com/matheusbbdutra/wisp-db/releases/tag/v0.1.0-beta.1
(prerelease=true) com `packaging/deb/wisp_0.1.0~beta1_amd64.deb` anexado —
`VERSION` do `build.sh` ajustada de `0.1.0` pra `0.1.0~beta1` (convenção
Debian de pre-release, `~` ordena antes da versão final no dpkg). Nota: o
GitHub sanitiza `~` no nome do arquivo do asset pra `.` na exibição/download
(`wisp_0.1.0.beta1_amd64.deb`) — cosmético, o `.deb` em si mantém
`Version: 0.1.0~beta1` correto no `DEBIAN/control` (o que importa pro apt).

Container de teste `wisp-postgres-test` (docker compose em `testdata/`) ainda
está de pé no ambiente de dev — não é usado pelo build, pode ser derrubado
quando não precisar mais (`docker compose -f testdata/docker-compose.yml down`).

**Próximo passo combinado com o usuário**: ele vai testar o `.deb` no ambiente
da empresa, pra avaliar substituir o DBeaver no uso dele.

## ⏸️ Pausa em 2026-09-15 — retomar daqui amanhã

**Pendências pra você testar/confirmar antes de continuar** (nenhum bloqueia o trabalho, mas ficaram sem confirmação final):
1. **Copiar especial no grid** — clique direito numa célula → "Copiar célula" deve colar o valor da coluna certa (achei e corrigi um bug de coluna trocada, mas não consegui reconfirmar via automação — ver item 6 abaixo).
2. Geral: dar uma olhada na janela do Wisp depois de tanta mudança acumulada (autocomplete v1/v2, uppercase automático, pretty-print, copiar especial, edição inline) — tudo testado por mim via browser onde deu, mas nunca dói confirmar na janela nativa.

**Nota operacional nova**: `wails dev` sozinho falha neste ambiente Arch (só tem `webkit2gtk-4.1`) — sempre `wails dev -tags webkit2_41` (já no README.md, mas reforçando aqui porque me pegou de surpresa nesta sessão).

## Edição inline de células (Fase 3, ADR 0004) — 2026-09-15, CONCLUÍDO e confirmado pelo usuário
Reprioridade a pedido do usuário (era item 7 na fila; "tabela como aba própria" volta a ser o próximo, ver seção abaixo). Ver memória `wisp-inline-edit-doubleclick-bug-fixed` pro relato técnico completo com todos os bugs encontrados.

- **Implementado**: `UpdateCell` na interface `DatabaseDriver` (`internal/db/driver.go`, `sqlite.go`, `postgres.go`, sempre parametrizado) + binding em `app.go`; `detectSingleTable.ts` (regex leve pra `SELECT ... FROM tabela` única, sem parser completo); `ConsoleTab.tsx` cruza colunas do resultado com `IntrospectTable` (PK real, exclui geradas E a própria PK — ver ajuste de produto abaixo); `ResultGrid.tsx` implementa edição de célula própria (não usa o overlay nativo do Glide — ver bugs abaixo), popover de preview do UPDATE antes de confirmar, trata `rowsAffected=0` como aviso de concorrência (não erro). Via delegação ao OpenCode + revisão minha, mesmo padrão das features anteriores.
- **4 bugs reais de causa raiz encontrados e corrigidos** (nenhum era limitação de ambiente/automação, todos confirmados lendo código-fonte ou testando na janela nativa de verdade):
  1. `buildUpdateCellQuery` (Go): ordem dos args do SQL parametrizado errada pro placeholder `?` posicional — sempre 0 linhas afetadas. Fix: `args` na ordem textual real dos `?` (SET antes do WHERE).
  2. Duplo-clique nunca ativava o overlay nativo do Glide Data Grid — bug real na lib (`onMouseUp` lê `mouseState` de um closure desatualizado do render anterior ao mousedown do mesmo clique, confirmado lendo `node_modules/@glideapps/glide-data-grid`). Fix: abandonei o overlay nativo (`allowOverlay: false` sempre), implementei edição própria via `onCellClicked` + detecção de "segundo clique em <500ms" num `useRef`, com `<input>` HTML posicionado via `gridRef.current.getBounds(...)`.
  3. `flushSync` (resquício da tentativa de fix do bug #2, ficou desnecessário depois) quebrou o clique ESQUERDO inteiro no WebKitGTK nativo, sem erro visível e sem sintoma no Chrome de teste — removido. Ver memória `wisp-flushsync-broke-click-selection` (lição geral sobre `flushSync` em handlers controlados por libs de terceiro).
  4. Offset duplicado em `getBounds`: eu somava `rowMarkerOffset` manualmente, mas a API pública do Glide já soma internamente — duplicava o offset, retornando bounds errados nas colunas do meio e `undefined` (célula não abria) na última coluna. Só foi possível achar pedindo pro usuário abrir o Web Inspector nativo (WebKitGTK) e colar debug — nenhum teste via Chrome/automação teria achado sozinho.
- **Ajuste de produto a pedido do usuário**: PK (`id`) ficou editável inicialmente — usuário apontou o risco (mudar identidade de uma linha existente, referências de FK). Fix: `editableColumns` em `ConsoleTab.tsx` agora exclui `IsPrimaryKey` além de `IsGenerated`. PK sempre read-only, mesmo padrão do DBeaver.
- **Verificado de verdade, ponta a ponta**: `go build`/`tsc`/`npm run build` limpos em cada rodada; `go test` com SQLite real cobrindo caso feliz, concorrência, PK composta, NULL antigo, tentativa de injeção, sem PK; **e confirmado pelo usuário na janela nativa** — duplo-clique abre editor, PK trava, `name`/`email` editáveis, popover de preview aparece, Confirmar salva de verdade.
- **Lição de processo pra sessões futuras**: quando o comportamento diverge entre o Chrome de teste (via Claude in Chrome) e a janela nativa real, a fonte de verdade é o Web Inspector DENTRO da janela nativa (botão direito → Inspecionar, funciona mesmo em `wails dev`) — pedir pro usuário abrir e colar console é mais confiável do que insistir em reproduzir via automação de browser quando os dois ambientes já divergiram uma vez.

## Próximo item a implementar (retomado à posição original): "Tabela como aba própria"
Fase 2.6, item 6 na lista abaixo — dados/DDL/triggers/funções de uma tabela numa aba dedicada, navegar tabelas de um schema a partir dali. Precisa de bindings novos no backend (`app.go`/`internal/db`):
- **Triggers**: fácil e confiável — Postgres tem `pg_get_triggerdef(oid)` nativo; SQLite tem a definição literal em `sqlite_master.sql` (`WHERE type='trigger'`).
- **DDL da tabela**: mais difícil — Postgres não tem um "SHOW CREATE TABLE" nativo (diferente de MySQL), precisa reconstruir a partir de `information_schema.columns` + `pg_get_constraintdef` pras constraints; SQLite já guarda o DDL literal em `sqlite_master.sql` (`WHERE type='table'`, direto, sem reconstrução).
- **Funções do schema**: Postgres via `pg_proc`/`information_schema.routines`; SQLite não tem função de usuário no sentido tradicional (provavelmente lista vazia com nota, não é lacuna real).
- Frontend: novo "tipo" de aba (`App.tsx`/tab manager) além do console — uma aba de tabela com sub-abas Dados/DDL/Triggers/Funções.
- Meu plano: desenhar o contrato de dados (structs Go, bindings) e a arquitetura da aba nova eu mesmo (é decisão estrutural), delegar a implementação mecânica por partes ao OpenCode, verificar cada parte via browser antes de aceitar — mesmo padrão usado nos itens anteriores desta sessão.

**Padrão de trabalho que funcionou bem esta sessão** (repetir): eu desenho a spec técnica detalhada (arquitetura, armadilhas, contratos de API) e gravo na `memory-mcp`; delego a implementação mecânica ao OpenCode (`opencode run`) apontando pra essa memória; reviso o diff e rodo `go build`/`tsc --noEmit`/`npm run build` eu mesmo antes de aceitar; quando dá pra testar de verdade, abro `http://localhost:34115` (URL que o `wails dev` do usuário expõe) via Claude in Chrome em vez de só pedir pro usuário testar — isso já achou bugs reais (SuggestController ausente, `ListTables` sem colunas, concorrência "conn busy", offset de coluna no copiar) antes de qualquer coisa chegar ao usuário.

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
- `.deb` só suporta Debian 12+/Ubuntu 22.04+ (precisa `libwebkit2gtk-4.1-0`, distros mais antigos só têm 4.0).

## Próximos passos combinados com o usuário (em ordem)
1. ~~**Múltiplas abas/consoles**~~ — **CONCLUÍDO**. `ConsoleTab.tsx` isola estado por `tabId`; `App.tsx` é o gerenciador de abas (tab bar +/×, abas montadas e ocultas via `hidden`). Confirmado: SQLite + Postgres simultâneos, consultas independentes.
2. ~~**Salvar scripts SQL**~~ — **CONCLUÍDO**. Tabela `saved_scripts` no `internal/store`, CRUD (`SaveScript/ListScripts/UpdateScript/DeleteScript`) em `app.go`, `ScriptsPanel.tsx` (listar/renomear/excluir) + botões "Salvar script"/"Novo" no `ConsoleTab.tsx`. Confirmado salvar/reabrir/renomear/excluir. Duas correções derivadas do teste, já aplicadas e confirmadas: (a) UI reorganizada — nova `.toolbar-secondary` abaixo da `ConnectionBar` concentra Salvar/Novo/Scripts/Histórico/tabId, rodapé do editor ficou só com Executar/Cancelar/duração/paginação; (b) bug corrigido — atalhos de teclado (`Ctrl+Enter`/`Ctrl+Shift+Enter`) rodavam query mesmo desconectado (não passavam pelo `disabled` do botão), guard clause adicionada no início de `handleRun`.
3. ~~**Autocomplete no Monaco via schema cache**~~ (pendência da Fase 2) — **CONCLUÍDO e confirmado**. Implementado via delegação ao OpenCode (ver [[delegacao-agy-via-memory-mcp-funciona]] e memória `wisp-autocomplete-task-context`/`wisp-autocomplete-implemented`), revisado independentemente por mim antes de aceitar.
   - `SqlEditor.tsx`: completion provider registrado **uma única vez no nível de módulo** (evita duplicar sugestões com N abas abertas — API de linguagem do Monaco é global, não por instância). Catálogo isolado por aba via `Map<model, db.Table[]>`, sincronizado por prop `catalog` e limpo no dispose do editor. Sugestão simples por prefixo (sem parser SQL, conforme `docs/ARCHITECTURE.md`): tabelas (+ `schema.tabela` se houver mais de um schema) e colunas.
   - `ConsoleTab.tsx`: `handleConnected` agora é async e carrega o catálogo completo (`ListSchemas` + `ListTables` por schema, barato via cache de 15min do backend); limpa no disconnect.
   - **Limitação aceita** (trade-off do escopo "sem parser custom"): colunas deduplicadas globalmente por nome — coluna homônima em tabelas diferentes (ex. `id`) só mostra o `detail` de uma delas.
   - **Bug real encontrado no teste do usuário e corrigido** (ver memória `wisp-monaco-suggest-controller-missing`): autocomplete não aparecia (nem automático nem `Ctrl+Espaço`) porque o `SqlEditor.tsx` importa só a API "core" do Monaco (`monaco-editor/editor/editor.api`, decisão de bundle size), que não inclui o `SuggestController` — a contribuição do editor que efetivamente chama os completion providers. Sem ela, o provider ficava registrado mas nada nunca o invocava (por isso zero erro, zero log — não tinha o que falhar). Diagnosticado abrindo `http://localhost:34115` (URL que o `wails dev` expõe) num navegador normal via Claude in Chrome — inspecionei o DOM (`0` elementos `.suggest-widget`) em vez de só especular. Fix: `import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js';` como efeito colateral em `SqlEditor.tsx`. Custo: bundle +~150KB JS, +~18KB CSS (aceitável).
   - Também corrigido nessa investigação: campo do editor não podia mais ser editado quando desconectado (`readOnly={!connected}` em `ConsoleTab.tsx`) — usuário queria editar sempre, só não executar. Removida a amarração (e o prop `readOnly` inteiro do `SqlEditor.tsx`, que ficou código morto).
   - `go build`, `tsc --noEmit` e `npm run build` limpos. **Testado e confirmado por mim mesmo** via Claude in Chrome (não só pelo usuário): conectei, digitei `SELECT * FROM cust`, sugestão "customers (public)" apareceu automaticamente.
   - **Autocomplete v2 (2026-09-15)**, feedback do usuário após o teste inicial — 4 melhorias, todas via delegação ao OpenCode (memórias `wisp-autocomplete-v2-task-context`/`wisp-autocomplete-v2-implemented`) + 1 bug real de raiz mais profunda achado na minha verificação:
     1. Nomes de schema agora são sugeridos como item próprio (`kind Module`), não só no `detail` da tabela.
     2. Keywords SQL ANSI (47, ex. `SELECT`/`FROM`/`WHERE`) sempre disponíveis — antes só sugeria tabela mesmo em linha nova.
     3. Funções built-in por dialeto (`kind Function`) — plumbing do `driver` ativo da aba adicionado (`ConnectionModal.tsx`→`ConnectionBar.tsx`→`ConsoleTab.tsx`→`SqlEditor.tsx`), listas curadas Postgres/SQLite só com nomes confirmados.
     4. Narrowing por ponto (`schema.` → só tabelas daquele schema; `tabela.` → só colunas daquela tabela) via inspeção de string da linha atual (sem parser SQL); identificador desconhecido (ex. alias `t.`) cai no full-list em vez de vazio.
     - **Bug real achado na minha verificação em browser** (não no teste do usuário — eu mesmo testei antes de devolver): sugestão de coluna nunca aparecia, nem no narrowing nem na lista geral. Causa raiz: `ListTables` no backend (`internal/db/sqlite.go`, `internal/db/postgres.go`) **nunca preenche `Columns`** — só `Schema`+`Name`. Colunas exigiam um `Introspect` por tabela que existia na interface do driver mas não estava exposto como binding do Wails (ninguém tinha notado porque a Sidebar nunca precisou de colunas). Fix (memória `wisp-autocomplete-columns-missing-introspect`/`wisp-autocomplete-columns-fix-applied`, via OpenCode): novo binding `IntrospectTable(tabID, schema, table)` em `app.go` reaproveitando o schema cache existente (cache hit se já tem `Columns`, senão chama o driver e atualiza a entrada); `ConsoleTab.tsx` chama esse binding em paralelo pra cada tabela após montar a lista (`Promise.all` + try/catch individual — uma tabela falhando não derruba o catálogo inteiro).
     - **Trade-off aceito**: N chamadas `IntrospectTable` (uma por tabela) no connect, cacheadas depois (TTL 15min). Pode ficar mais lento em bases com centenas de tabelas — se acontecer, a alternativa é carregar colunas sob demanda só ao digitar `tabela.` (completion provider assíncrono, Monaco suporta `Promise`), não implementado agora por ser over-engineering sem medir necessidade.
     - **Bug real achado testando com múltiplos schemas de verdade** (usuário relatou: "banco com vários schemas, tabela de outro schema não completa"; ver memória `wisp-autocomplete-conn-busy-concurrency`): criei um schema `reports.sales` de teste no Postgres pra reproduzir — com 2 schemas, o autocomplete parava de sugerir QUALQUER coisa (nem tabelas de `public`). Causa raiz: a sessão de uma aba usa uma única conexão (`*sql.Conn`/pgx, não suporta uso concorrente), mas `handleConnected` disparava `ListTables`/`IntrospectTable` via `Promise.all` (paralelo) — uma chamada colidindo com "conn busy" rejeitava o `Promise.all` inteiro e zerava o catálogo todo. **Fix**: trocado por loops sequenciais (`for...of` + `await`) — mais lento mas correto. Schema de teste removido depois (`DROP SCHEMA reports CASCADE`).
     - **Regra geral extraída**: nenhuma chamada nova ao backend disparada em loop pra mesma aba pode usar `Promise.all` — a conexão é single-threaded por design, mesmo pra leituras simples.
     - **Todos os pontos + os dois fixes de causa raiz testados e confirmados por mim mesmo** via Claude in Chrome: `public.` → tabelas do schema; `customers.` → colunas reais; linha nova → keyword; `coale` → função `postgres`; e com 2 schemas reais, `sal` → `sales (reports)` + `reports.sales` corretamente.
     - `go build`, `tsc --noEmit`, `npm run build` limpos em cada rodada.
   - **Uppercase automático de keywords SQL (2026-09-15)**, pedido do usuário, via OpenCode (memórias `wisp-sql-uppercase-keywords-task-context`/`wisp-sql-uppercase-keywords-result-opencode`): checkbox "Uppercase automático" na `.toolbar-secondary`, **ligado por padrão**, preferência global em `localStorage` (`wisp:autoUppercaseKeywords`). Converte só keywords de UMA palavra (não "INNER JOIN"/"GROUP BY") ao cruzar um word-boundary (espaço/quebra de linha/pontuação), nunca dentro de string/comentário (checado via o tokenizer Monarch já registrado). Guard `isApplyingAutoCaseRef` evita loop infinito ao aplicar a edição programática. Limitações aceitas: undo em 2 passos, paste não converte, checkbox não sincroniza ao vivo entre abas já abertas (só ao remontar). Confirmado por mim via Claude in Chrome: `select * from customers where id = 1 and name = 'select from where'` → keywords maiúsculas, string preservada intacta; toggle desligado mantém tudo minúsculo.
5. ~~**Formatação de SQL / pretty-print**~~ (pendência da Fase 2) — **CONCLUÍDO em 2026-09-15, via OpenCode** (memória `wisp-sql-pretty-print-implemented-opencode`). Botão "Formatar" na `.toolbar-secondary` do `ConsoleTab.tsx` via lib `sql-formatter` 15.8.2 (MIT), 100% frontend. Mapeamento `postgres`→`postgresql`, `sqlite`→`sqlite`, fallback `sql` (nomes confirmados em `supportedDialects` da versão instalada). Erro de parsing mostra no `status` sem tocar no editor. ADR 0005 criado + nota no `docs/ROADMAP.md`. `npm install`, `tsc --noEmit` e `npm run build` limpos. Sem testes unitários (conforme pedido). **Testado e confirmado por mim mesmo** via Claude in Chrome: `select id, name, email from customers where id in (1,2,3) order by id` → quebra de linha por cláusula, indentação, `IN (1, 2, 3)` espaçado corretamente.
6. **Exploração de schema / View Data + Copiar** (Fase 2.6, nova) — escopo mais amplo do que só "tabela como aba própria":
   - Tabela como aba dedicada com dados/DDL/triggers/funções, e navegar tabelas de um schema a partir dali. **Próximo item a implementar.**
   - ~~**Copiar especial no grid de resultados**~~ — **implementado** (estilo DBeaver, priorizado por uso frequente do usuário), via OpenCode (memória `wisp-grid-copy-special-task-context`). Menu de contexto (clique direito) no `ResultGrid.tsx`: copiar célula, copiar linha, copiar seleção (multi-célula/multi-linha via `gridSelection` controlado), e "Copiar como" CSV/INSERT SQL/Markdown — funções puras extraídas em `frontend/src/lib/gridCopyFormats.ts` (`toCSV`, `toInsertSQL`, `toMarkdownTable`, `copyToClipboard` com fallback `execCommand('copy')` pro caso do `navigator.clipboard` falhar no webkit2gtk). Limitação assumida: `INSERT SQL` usa `table_name` como placeholder (Wisp não sabe a tabela de origem de um resultado arbitrário).
     - **Bug real encontrado e corrigido na minha verificação**: clicar com botão direito numa célula copiava o valor da coluna ERRADA (ex.: clique em "name" copiava o valor de "email") — causa raiz era usar `event.location` (de `CellClickedEventArgs`) em vez do parâmetro `cell: Item` que o próprio callback `onCellContextMenu` já passa correto (mesmos índices usados em `getCellContent`/`columns`/`rows`); `event.location` veio deslocado em 1 coluna nesse cenário com `rowMarkers="number"` ativo. Corrigido usando `cell` diretamente.
     - **Verificação parcial**: reproduzi o bug original com um right-click real (screenshot mostrou "Ana Silva" clicado → colou "ana@example.com"), apliquei o fix, e o `tsc`/`build` seguem limpos. **Não consegui reconfirmar o fim-a-fim via automação depois do fix** — right-click num `<canvas>` (Glide Data Grid) via CDP ficou instável nessa sessão (conflito com menu nativo do Chrome, trava captura de screenshot), não é um problema do código. **Pendente: você confirmar manualmente na janela nativa do Wails** — clique direito numa célula, confira se "Copiar célula" cola o valor certo (da coluna clicada, não da vizinha).
   - Ocupa o lugar que era do Túnel SSH na Fase 3 antiga.
7. ~~**Edição inline de células**~~ (Fase 3, ADR 0004) — **CONCLUÍDO e confirmado pelo usuário em 2026-09-15**, ver seção própria acima (com todos os bugs de causa raiz encontrados).
8. **Integração com agentes de terminal via MCP** — escopo ainda a desenhar melhor com o usuário antes de implementar (arquitetura nova, não é só "próximo da fila").
9. **Exportador CSV/JSON/Parquet** (Fase 3) — baixa prioridade, usuário raramente usa; fica na fila sem pressa.

## Túnel SSH — fora da sequência ativa (decisão de 2026-09-15)
Adiado deliberadamente pelo usuário — não por causa do open source em si (o projeto já vai ser open source, isso é dado, não condição), mas porque não é urgente: o primeiro usuário é o próprio autor, que já tem VPN cobrindo o acesso a bancos atrás de firewall no uso pessoal atual. Reservado para a Fase 4+ (`docs/ROADMAP.md`), despriorizado até haver demanda real (própria ou de outro usuário do projeto).

## Confirmação visual do usuário
- Redesign visual, Monaco+highlight, Glide Data Grid, streaming/paginação (50k linhas, "Carregar mais"), correção do editor travado, correção do bug "conn closed" — **todos confirmados funcionando** pelo usuário testando na janela.
- Múltiplas abas/consoles (SQLite + Postgres simultâneos, cada um com sua query rodando independente) — **confirmado funcionando**.
- Salvar/reabrir/renomear/excluir scripts SQL, reorganização da toolbar e correção do bug "rodar query desconectado via atalho" — **todos confirmados funcionando** pelo usuário.
- Gerenciamento de conexões (modal) — confirmação fraca ("aparentemente OK", sem detalhe de quais fluxos testou).

## Padrão de delegação (ver memória `delegacao-agy-via-memory-mcp-funciona`)
- **agy**: headless bloqueado por permissão — pedir pro usuário rodar interativo, com prompt instruindo a consultar/gravar na memória compartilhada (`memory` MCP, já configurado nele). Sempre verificar independentemente antes de aceitar (já achei bugs reais e código morto em entregas "prontas").
- **OpenCode**: `opencode run "..."` funciona headless direto — **nunca colocar `&` no fim do comando quando usar `run_in_background: true` no Bash tool** (bug já cometido: duplica o backgrounding e o comando real nunca roda). Também já mostrou instabilidade de provedor (timeout de 900s) uma vez — se acontecer de novo, matar e pedir pro usuário rodar manualmente.
- Tarefas que tocam os mesmos arquivos: rodar sequencialmente, nunca em paralelo.

## 🔄 Sincronização com o outro PC + Item 1 do Phase 3 (2026-09-15, sessão nova)
Puxado `git pull --rebase` do outro PC (commits `1437d13`/`0d78496`): fix real de
"conn busy" no Postgres (cursor de streaming não fechado antes de rodar
DDL/Triggers/Funções — fix manda `CancelRequest` antes de fechar), N+1 no
catálogo (`IntrospectTable` por tabela → `IntrospectSchema`/
`IntrospectSchemaTables` batched), UX de console (Ctrl+Enter reaproveita aba
de resultado, confirmação antes de fechar aba/janela com SQL não salvo,
`RoutineTab` para Triggers/Funções), e `.deb` ganhou `postinst`/`postrm`
(ícone não aparecia no launcher sem `gtk-update-icon-cache`). Havia uma
mudança local não commitada em `packaging/deb/build.sh` (heredoc inline dos
mesmos `postinst`/`postrm`) — descartada por ser redundante com a versão já
implementada como arquivos próprios pelo outro PC.

Implementado sozinho (sem delegação, contrato pequeno o suficiente pra não
precisar) o **item 1 do Phase 3** (`docs/ROADMAP.md`): Índices, FKs e
distinção View/Tabela na exploração de schema. Ver detalhe técnico completo
na entrada do ROADMAP. Verificado contra Postgres real via Claude in Chrome
(view/índice/FK criados ad-hoc via `psql`, removidos depois) — sidebar e
TableTab mostram os dados corretos, exclusão do índice de suporte de
UNIQUE/PK confirmada. Lógica SQLite (PRAGMA scan) validada via `sqlite3` CLI
direto (não passou pela UI — sem instância de teste com view/índice/FK à
mão nesta sessão). `go build`/`go vet`/`tsc --noEmit`/`npm run build`
limpos.

**Pendente de confirmação do usuário**: testar Índices/FKs/badge de view na
janela nativa (SQLite real, não só Postgres) antes de considerar o item
fechado de vez.

## ✅ Item 1 confirmado pelo usuário + Item 2 do Phase 3 implementado (2026-09-15)
Usuário confirmou o item 1 (Índices/FKs/Views) na janela nativa do `wails
dev` — FKs especificamente testado lá (não tinha no banco do outro PC);
Triggers/Funções/DDL não puderam ser re-testados por falta de tabela com
esse conteúdo no Postgres de teste atual, mas já tinham sido confirmados
antes no outro PC com um banco maior.

Implementado o **item 2 do Phase 3** (visor de valor de célula + filtro
rápido + busca), a pedido explícito do usuário incluindo XML como formato
adicional (além de JSON/texto) e comportamento "tipo DBeaver" (select de
formato + quebra de linha). Ver detalhe técnico completo na entrada do
ROADMAP. Ponto de atenção da implementação: o filtro rápido do grid exigiu
traduzir "posição visual" (o que o Glide Data Grid e sua seleção enxergam)
pra "índice real em `rows`" em todo ponto de entrada (conteúdo de
célula/clique/menu de contexto/seleção) — verificado contra Postgres real
via Claude in Chrome que editar/copiar uma linha filtrada ainda pega a linha
certa, não a visualmente adjacente. Busca da sidebar busca tabelas de
schemas ainda não expandidos sob demanda (debounce 300ms, sequencial).

Tudo verificado ao vivo via Claude in Chrome contra Postgres real: "Ver
valor…" formatou JSON aninhado corretamente com quebra de linha; filtro
rápido reduziu "3 linhas" pra "1 de 3 linha" e manteve a edição direta
mirando na linha certa (Bruno Costa, não a linha 0); busca na sidebar
filtrou `order_items` corretamente escondendo `customers`/`invoice_lines`.
`go build`/`go vet`/`tsc --noEmit`/`npm run build` limpos.

**Pendente de confirmação do usuário**: testar na janela nativa (não só
Chrome) — em especial o popover do visor de valor (posicionamento/z-index)
e a busca da sidebar com um schema de muitas tabelas de verdade.

**Próximo item da fila** (ROADMAP Phase 3, item 3): EXPLAIN / plano de
execução (v1 textual via `EXPLAIN ANALYZE`).

## 🐛 Bug real corrigido (2026-09-15): coluna XML aparecia como base64 ilegível
Usuário pediu um seed de teste mais completo (múltiplos schemas, JSON/XML,
FKs, triggers, funções, índices) pra validar os itens 1-2 do Phase 3 contra
dados reais — não existe gerador de mock pronto pra estrutura (FK/trigger/
view/tipo de coluna são decisão de schema, não dado fake; Faker et al.
geram só dados). Escrevi `testdata/postgres-seed.sql` na mão cobrindo tudo
isso em 3 schemas (`public`/`sales`/`reporting`), recriei o container
(`docker compose down -v && up -d`, container só reaplica o seed no
primeiro init).

Testando o visor de valor contra uma coluna XML real (`invoice_lines.
metadata_xml`), o grid mostrava a célula como base64 ilegível
(`PGludn9pY2U+...`) em vez do XML de verdade. **Causa raiz confirmada**:
pgx v5 tem codec nativo pra JSON/JSONB (decodifica pra `string`), mas NÃO
pra `xml` do Postgres — `rows.Values()` devolve o valor cru do wire como
`[]byte` pra qualquer tipo sem codec. `QueryResult.Rows` (`[][]any`) vira
JSON puro na ponte IPC do Wails, e `encoding/json` do Go serializa
`[]byte` como base64 automaticamente — silencioso, sem erro.

**Fix**: `normalizeCellValue`/`normalizeRow` em `internal/db/driver.go`
(convertem `[]byte`→`string` genericamente, não só pra XML — qualquer tipo
sem codec teria o mesmo problema), aplicado em `Execute`/`FetchNext` de
`postgres.go` e `scanRows`/`FetchNext` de `sqlite.go` (defensivo, mesmo
risco em teoria com `database/sql`).

**Verificado contra Postgres real**: `SELECT metadata_xml FROM
invoice_lines` mostrou o XML de verdade no grid antes e depois do fix
(antes: base64; depois: `<invoice><line sku="KB-100">...`); "Ver valor…"
detectou `xml` automaticamente e formatou com indentação correta.

**Todos os itens 1-2 do Phase 3 revalidados contra o seed novo** (3
schemas, JSON/XML, FKs cruzando schema, 2 índices incluindo composto
único, trigger, 2 funções, 2 views): sidebar mostra os 3 schemas e a view
com badge; busca encontrou `sales.deals`/`sales.open_deals` buscando por
"deals" sem o schema estar expandido antes; `sales.deals` mostra os 2
índices (incluindo o único composto corretamente marcado) e as 2 FKs
cruzando pra `public.customers`/`sales.regions`; `customers` mostra o
trigger `trg_customers_touch` (abre definição correta em aba própria); a
função `sales.total_by_region` aparece na aba Funções do schema certo.

`go build`/`go vet`/`tsc --noEmit`/`npm run build` limpos.

**Nota operacional**: `testdata/postgres-seed.sql` agora é a fixture de
referência pra testar contra Postgres real em sessões futuras — cobre
JSON(B)/XML/multi-schema/FK/trigger/função/índice/view de propósito, não é
mock de negócio realista. Recriar com `docker compose -f
testdata/docker-compose.yml down -v && up -d` sempre que precisar resetar
pro estado do seed (o `-v` remove o volume — perde dado que você tenha
inserido manualmente na sessão de teste, nunca dados de produção).

## ✅ Melhorias de UX/UI (2026-09-15): visor de valor dockado + sidebar colapsável + saneamento de CSS
A pedido do usuário, depois de ver o visor de valor funcionando na prática:
"a opção de ver valor ta muito pouco utilitária... normalmente tem uma
minibarra lateral... schemas e tabelas poderia ser 'minimizadas'". Em vez de
implementar direto, rodei uma **análise comparativa em 3 agentes em
paralelo** (Antigravity, OpenCode, Cursor Agent) via `delegate-run` +
memória compartilhada (`wisp-ui-ux-analysis-value-viewer-sidebar-task`,
cada um gravou o resultado com nome próprio pra não sobrescrever —
`wisp-ui-ux-analysis-result-{antigravity,opencode,cursor}` — e arquivo em
`docs/analysis/ui-ux-2026-09-15-*.md`). As 3 convergiram fortemente:
painel de valor dockado à direita dentro do `ResultGrid` (não sobe pra
`ConsoleTab`/`TableTab`), sidebar colapsa pra escondida (não ícone-only —
é árvore de texto+busca), e saneamento de vars CSS antes do resto do
polish. OpenCode e Cursor trouxeram achados extras que Antigravity não
pegou: 2 vars CSS referenciadas mas nunca definidas (`--font-mono`,
`--accent-color`), `useDragResize` não expõe `setSize` (colapso precisa de
boolean `open` separado, não dá pra só zerar a largura), e o cuidado de
que Histórico/Scripts já dockam à direita do workspace inteiro — por isso
o painel de valor precisa ficar **escopo-grid**, não workspace, senão
empilha 3 painéis à direita.

Implementei as 3 melhorias na ordem sugerida (saneamento CSS → sidebar
colapsável → visor de valor dockado):

1. **CSS**: `--font-mono`/`--accent-color` definidas em `:root`
   (`App.css`); `--bg-panel`/`--accent-blue-light` novas pra eliminar hex
   duplicado (`#1e1e22`, `#93c5fd`); demais `#2563eb`/`#131315` soltos
   trocados por `var(--accent-blue)`/`var(--bg-grid)`.
2. **Sidebar colapsável**: `Sidebar.tsx` ganhou prop `onCollapse` (botão
   `‹` no header); `ConsoleTab.tsx` tem `sidebarCollapsed` (boolean,
   `localStorage wisp:sidebarCollapsed`) — colapsado desmonta a
   `<Sidebar/>` e mostra uma faixa fina (`.sidebar-reopen-rail`, `‹`/`›`)
   pra reabrir. Decisão consciente (mesma dos 3 agentes): perder
   busca/schemas-expandidos em memória ao colapsar é aceitável, elevar
   esse estado furaria a convenção de não subir estado sem necessidade.
3. **Visor de valor dockado**: `CellValueViewer.tsx` deixou de ser modal
   (`.grid-edit-overlay`) e virou painel lateral (`.value-viewer-dock`)
   dentro do `ResultGrid` (`.result-body`, novo wrapper flex-row ao lado
   de `.result-grid-canvas`), redimensionável via `useDragResize` mesmo
   padrão da sidebar (`wisp:valuePanelWidth`). Segue a célula ativa
   sozinho via `gridSelection.current.cell` (traduzido por
   `toOriginalRow` — mesma armadilha do filtro rápido, célula errada com
   filtro ativo se esquecesse essa tradução). Aberto/fechado via botão
   "Valor" na toolbar (`wisp:valuePanelOpen`) ou pelo item "Ver valor…" do
   menu de contexto (agora move a seleção do grid pra célula clicada em
   vez de tirar um snapshot). Empty state quando não há seleção (evita
   layout pulando). Formato/wrap/copiar preservados sem mudança de lógica.

**Verificado ao vivo via Claude in Chrome** (Postgres real, seed com
JSON): sidebar colapsa/expande preservando schemas; painel de valor abre
dockado à direita, JSON pretty-print correto; navegar entre células
diferentes atualiza o painel sozinho sem reabrir; com filtro rápido ativo,
o painel continua mostrando a linha certa (não a visualmente adjacente);
"Ver valor…" do menu de contexto também sincroniza certo. `go build`/
`go vet`/`tsc --noEmit`/`npm run build` limpos.

**Confirmado pelo usuário na janela nativa** (2026-09-15): "aparentemente
utilizável, não encontrei bug aparente" — painel de valor (arrasto,
formato), sidebar colapsável e o restante testado sem achado novo.

**Itens de polish restantes** (não implementados nesta rodada, ficam pra
quando o usuário quiser continuar — lista completa nos 3 arquivos
`docs/analysis/ui-ux-2026-09-15-*.md`): esconder/reduzir o `tabId` cru na
toolbar, hit-area maior nos resize-handles, `:focus-visible` global,
segmented control no `.table-subbar`, scrollbars customizadas, contraste
de `--text-muted`, empty states unificados entre Sidebar/ResultGrid/Meta.

## ✅ EXPLAIN / plano de execução (2026-09-15)
Item 3 do Phase 3. Implementação bem mais simples do que o esboço original
do ROADMAP sugeria: **sem binding novo no backend** — um plano de execução
é só mais um resultado de query (uma coluna de texto no Postgres, quatro
colunas no SQLite). Botão "Explain" novo em `ConsoleTab.tsx`, ao lado de
"Executar"/"Nova aba", prefixa o texto atual do editor via
`frontend/src/lib/explainQuery.ts` (dialect-aware) e chama o mesmo
`handleRun(..., true)` já usado por tudo — reaproveita `RunQuery`,
`ResultGrid`, abas de resultado, sem UI nova.

**Decisão deliberada**: nunca `EXPLAIN ANALYZE` — essa variante EXECUTA a
query de verdade (rodaria um UPDATE/DELETE real só de "olhar o plano"),
`EXPLAIN` puro só mostra a estimativa do planner sem rodar nada. O ROADMAP
antigo mencionava ANALYZE; ajustei a decisão por segurança real, não é
regressão de escopo.

**Verificado contra Postgres real** via Claude in Chrome:
`EXPLAIN SELECT * FROM customers WHERE id = 1` abriu aba nova mostrando
`Index Scan using customers_pkey` / `Index Cond: (id = 1)`, editor
original intacto. SQLite (`EXPLAIN QUERY PLAN`) não testado ao vivo nesta
rodada — mesmo caminho de código, risco baixo (só troca o prefixo de
string), mas fica como pendência de confirmação se o usuário quiser.

`go build`/`go vet`/`go test ./...`/`tsc --noEmit`/`npm run build` limpos.
Nada commitado ainda desta feature.

**Nota operacional**: durante o teste, achei o `wails dev` anterior com o
frontend dev server morto silenciosamente (matei sem querer o processo
certo, mas o processo antigo da janela nativa ficou vivo servindo uma
versão cacheada, sem hot-reload real) — tive que matar o processo antigo
e subir um `wails dev` novo. Se a janela nativa parecer "travada" sem
refletir mudanças, checar se `lsof -i :5173` (ou a porta do Vite) tem
processo vivo antes de assumir que é bug de código.

## ✅ INSERT/DELETE no grid (2026-09-15)
Item 4 do Phase 3 — fecha o ciclo da edição inline (ADR 0004). Mesmo
padrão de segurança do `UpdateCell`: sempre parametrizado, só aparece
quando `editContext` existe (PK real detectada via introspecção — views e
tabelas sem PK continuam automaticamente read-only, mesmo gating de
sempre).

**Backend**: `InsertRow`/`DeleteRow` novos na interface `DatabaseDriver`
(`internal/db/driver.go`), implementados nos dois dialetos via builders
compartilhados `buildInsertRowQuery`/`buildDeleteRowQuery`
(`internal/db/sqlite.go`, mesmo arquivo/padrão do `buildUpdateCellQuery`
já existente — INSERT sempre com lista explícita de colunas, nunca
posicional; DELETE sempre por PK real). Bindings novos em `app.go`. Testes
novos: unitários dos 2 builders (`internal/db/sqlite_test.go`) + um teste
de integração contra SQLite real (`TestSQLiteInsertAndDeleteRow`).

**Frontend**: botão "+ Nova linha" na toolbar do `ResultGrid.tsx` abre um
formulário com um campo de texto por coluna não-gerada (PK inclusa —
usuário pode digitar uma PK natural; campo em branco **omite** a coluna
do INSERT inteiro, deixando o banco aplicar `DEFAULT`/auto-incremento em
vez de forçar `NULL`). "Excluir linha…" no menu de contexto da linha
mostra o `DELETE` parametrizado exato antes de confirmar, mesmo padrão
visual do preview de UPDATE já existente.

**Verificado contra Postgres real** via Claude in Chrome, ponta a ponta:
inseri uma linha deixando `id`/`profile`/`updated_at` em branco → grid
mostrou `id: NULL` (limitação documentada — o cliente não busca de volta
os defaults gerados pelo servidor até a query rodar de novo) → rodei a
query de novo e vi o `SERIAL` real (`4`) → apaguei essa mesma linha →
confirmei sumida no grid E via `psql` direto no banco.

`go build`/`go vet`/`go test ./...`/`tsc --noEmit`/`npm run build`
limpos. Nada commitado ainda desta feature.

**Restam do Phase 3**: verificador de atualização (GitHub Releases API,
só aviso). Fora da fila ativa: polish visual restante das 3 análises de
UX (tabId exposto, hit-area dos handles, `:focus-visible`, etc.).

## ✅ Autocomplete resolve alias de tabela (2026-09-15)
Gap real apontado pelo usuário: em query com JOIN/alias
(`FROM customers c JOIN order_items o ON ...`), digitar `c.` caía na lista
genérica em vez de sugerir as colunas de `customers` — o narrowing por
ponto (`resolveDotContext`, `SqlEditor.tsx`) só reconhecia nome de
schema/tabela literal, nunca um alias.

**Fix**: novo `frontend/src/lib/extractTableAliases.ts` — extrai
`FROM/JOIN tabela [AS] alias` da query INTEIRA (não só da linha atual, já
que o FROM pode estar em outra linha) via inspeção de string, mesmo
espírito sem-parser-SQL de `detectSingleTable.ts`. `resolveDotContext`
agora consulta esse mapa quando o identificador antes do ponto não bate
com schema/tabela literal.

**Bug real achado pelo próprio teste unitário que escrevi**: a fronteira
de cláusula não considerava os modificadores de JOIN (`LEFT`/`INNER`/
`OUTER`/`FULL`/`CROSS`/`NATURAL`/`LATERAL`) — em `"FROM customers c LEFT
JOIN..."`, o chunk extraído virava `"customers c LEFT"` (3 tokens, não
batia no padrão tabela+alias) só porque `LEFT` antecede o próximo `JOIN`
mas não faz parte da cláusula `FROM` atual. Corrigido incluindo esses
modificadores na fronteira do lookahead. 9 testes novos em
`extractTableAliases.test.ts` (incluindo esse caso), todos passando.

**Limitação aceita**: só reconhece um alias por `FROM`/`JOIN` (não separa
lista por vírgula do JOIN implícito antigo, `FROM a, b` — estilo raro,
usar JOIN explícito); subquery como fonte (`FROM (SELECT...) alias`) não
é reconhecida, a entrada é só omitida do mapa sem erro.

**Verificado contra Postgres real** via Claude in Chrome: query com
`customers c LEFT JOIN order_items o ON ...`, `c.` sugeriu
`email/id/name/profile/updated_at` (colunas reais de `public.customers`),
`o.` sugeriu `customer_id/item_seq/order_id/product/quantity` (colunas
reais de `public.order_items`) — os dois aliases resolvidos corretamente
mesmo com o `LEFT JOIN` no meio.

`go build`/`go vet`/`tsc --noEmit`/`vitest run` (27 testes)/
`npm run build` limpos. Nada commitado ainda desta feature.

## ✅ Verificador de atualização (2026-09-15) — Phase 3 completo
Item 5 do Phase 3, último item da leva original combinada com o usuário
pós-beta.1. **Fecha o Phase 3 inteiro.**

**Bug real evitado antes de escrever qualquer código**: bati na API real do
GitHub durante o design e descobri que `/repos/.../releases/latest`
**exclui prereleases e devolve 404** quando não há nenhuma release
estável — TODAS as releases do Wisp até agora são prerelease
(`v0.1.0-beta.1/2/3`), então esse endpoint sempre daria 404. Usei
`/repos/.../releases` (a lista, mais recente primeiro) e peguei o
primeiro item.

**Implementação**: `version.go` novo (`AppVersion` const, atualizado à
mão a cada release — sem infra de ldflags/build-time ainda, mesmo padrão
manual do `VERSION` em `packaging/deb/build.sh`). `CheckForUpdate`
(`app.go`) consulta a API pública (sem credencial nenhuma), timeout de 8s,
compara por igualdade de string (não semver-aware, suficiente pro escopo
"só aviso"). `OpenReleaseURL` abre a release no navegador padrão do
sistema (`runtime.BrowserOpenURL`), restrito a `https://github.com/` —
nunca uma URL arbitrária. Frontend: botão "Verificar atualização" na
barra de abas (`UpdateChecker.tsx`) — **manual só**, nunca checa sozinho
no startup (decisão consciente: app não deve depender de rede pra abrir).

**Verificado contra a API real do GitHub** via Claude in Chrome: com a
versão real embutida (`v0.1.0-beta.3`), reportou corretamente "você já
está na versão mais recente"; troquei temporariamente pra uma versão
falsa mais antiga (`v0.0.9-test`) pra confirmar visualmente o banner
"Nova versão disponível: v0.1.0-beta.3 · Ver release" e revertidi depois.

`go build`/`go vet`/`go test ./...`/`tsc --noEmit`/`vitest run` (27
testes)/`npm run build` limpos. Nada commitado ainda desta feature.

**Phase 3 está completo**: itens 1-5 do `docs/ROADMAP.md` implementados e
verificados nesta sessão (índices/FKs/views, visor de valor + filtro +
busca + sidebar colapsável, EXPLAIN, INSERT/DELETE, verificador de
atualização) — mais o extra de autocomplete de alias que não estava na
lista original mas foi pedido pelo usuário no meio do caminho.

**Restam apenas os itens de polish visual** documentados nas 3 análises
de UX (`docs/analysis/ui-ux-2026-09-15-*.md`) — sem prazo definido, o
usuário decide quando (ou se) retomar.

## ✅ Verificador de atualização virou automático (2026-09-15, ajuste a pedido do usuário)
Usuário perguntou "não tem como ser automático?" depois de eu ter
implementado só manual. Ajustado: agora checa sozinho ao abrir o app, mas
**assíncrono e silencioso** — nunca bloqueia a abertura, e só aparece
alguma coisa na tela quando existe mesmo uma versão nova (nada de popup
"você já está atualizado" toda vez que abre, isso seria ruído). Falha de
rede no check automático também fica silenciosa (só o botão manual mostra
erro). O botão "Verificar atualização" continua existindo pra checagem
sob demanda, sempre mostra o resultado (incluindo "já está atualizado").

Bug evitado no meio do caminho: o primeiro rascunho tinha
`onClick={handleCheck}` — passaria o `MouseEvent` do clique como
argumento `silent` da função (truthy), silenciando o botão manual sem
querer. Corrigido pra `onClick={() => handleCheck()}` antes de testar.

**Verificado ao vivo nos dois cenários** via Claude in Chrome: com a
versão real embutida, abrir o app não mostra nada (checagem rodou em
segundo plano, sem update real); troquei temporariamente pra uma versão
falsa mais antiga e o banner "Nova versão disponível" apareceu sozinho
assim que a página carregou, sem precisar clicar em nada — revertido
depois.

`go build`/`go vet`/`tsc --noEmit`/`vitest run` (27 testes)/
`npm run build` limpos. Nada commitado ainda desta mudança.

## ⏸️ Pausa combinada com o usuário (2026-09-15) — Phase 3 fechado, sem próximo item definido
Perguntei sobre Phase 4+ (query builder, busca semântica, sync, SSH,
DuckDB) — usuário confirmou que nenhum tem demanda real validada ainda
(todos deliberadamente "esperar aparecer necessidade real de uso", ver
ROADMAP) e decidiu **pausar aqui** em vez de adiantar algo ou puxar o
polish visual agora.

**Estado**: `master` limpo, todos os commits da sessão de pé (Phase 3
completo: itens 1-5 + autocomplete de alias + verificador de atualização
automático). Nada pendente de teste imediato — usuário vai testar o
autocomplete de alias com queries grandes reais amanhã, por conta própria.

**Retomar por**: esperar o usuário trazer o próximo pedido real de uso
(bug encontrado no dia a dia, ou demanda concreta de algum item do
Phase 4+/polish visual). Não iniciar nada novo por conta própria.

## ✅ i18n: plano desenhado + docs internos traduzidos (2026-09-16)
Usuário pediu i18n de verdade (com seletor de idioma) pra UI, mas depois
pediu explicitamente pra **não implementar agora** — só fechar o que já
estava em andamento: tradução dos relatórios internos e o plano técnico.

- **Docs traduzidos pra inglês** (delegado ao OpenCode, verificado sem
  resquício de PT-BR via grep de acentuação): `docs/reports/agy-*.md` (3
  arquivos) e `docs/analysis/*.md` (5 arquivos, incluindo os que eu mesmo
  gravei nesta sessão). Resumo em
  `docs/analysis/i18n-reports-translation-2026-09-15.md`.
- **Plano de i18n da UI desenhado e ACEITO, não implementado**:
  `docs/adr/0006-i18n.md` — `i18next`+`react-i18next` (confirmado MIT e
  mantido ativamente via `npm view` real: 26.4.2/17.0.14), estrutura
  `frontend/src/i18n/` com `locales/en.json`+`locales/pt-BR.json`,
  detecção por locale do SO com override salvo em `localStorage`,
  seletor de idioma na barra de abas. Decisões confirmadas com o
  usuário: idioma padrão detecta do SO (não fixo em inglês); mensagens
  de erro do backend Go entram no escopo (viram texto fixo em inglês,
  sem i18n de verdade no Go). **Também planejado pra mesma leva futura**:
  comentários de código Go (`app.go`/`internal/**/*.go`) também vão pra
  inglês — ainda em PT-BR, não mexido agora.
- **Escopo explicitamente fora desta rodada**: nenhum componente React
  foi tocado, nenhuma string de UI foi trocada, nenhuma dependência nova
  foi instalada ainda. É trabalho pra uma leva dedicada futura.

## ✅ Política de idioma do projeto definida (2026-09-16)
Usuário formalizou (motivo explícito: mais chance de ser visto/descoberto
em inglês do que em português, sendo open source):
- Comentários no código Go: inglês a partir de agora (existentes migram
  numa leva futura, não é retrofit imediato).
- Mensagens de commit: inglês a partir de agora.
- Conteúdo voltado ao GitHub (release notes, README, ADRs, issues, PRs):
  inglês — já estava assim desde 2026-09-15/16, só formalizado.
- Interface do app: **bilíngue** (inglês + PT-BR), nunca só inglês — plano
  já aceito em `docs/adr/0006-i18n.md`, ainda não implementado.
- Ficam como estavam: `STATE.md`/`AGENTS.md` em PT-BR (notas internas);
  comentários TS/TSX do frontend não decididos ainda, tratar como PT-BR
  até decisão explícita.

Registrado em `AGENTS.md` (seção "Idioma", nova) e `docs/adr/0006-i18n.md`
(corrigida contradição — dizia que comentários ficariam em português).
**A partir deste commit, meus próprios commits neste projeto passam a ser
em inglês.**

## 🔜 Checkpoint de próximos passos (2026-09-16, fim de sessão)
`master` limpo e sincronizado com o remoto (push feito até `1e1d25b`).
Release `v0.1.0-beta.4` publicada. README (EN + PT-BR) com logo, badges
(licença/Wails/Go) e RAM idle medida. Política de idioma do projeto
formalizada em `AGENTS.md`/`docs/adr/0006-i18n.md`.

**Aviso do usuário pra próxima sessão**: possivelmente vamos delegar mais
(OpenCode/Codex/Cursor/Antigravity) daqui pra frente pra não estourar
contexto/orçamento rápido — reforça o padrão já usado a sessão inteira
(eu desenho o contrato técnico, delego a execução mecânica, reviso antes
de aceitar) em vez de fazer tudo eu mesmo linha a linha quando o trabalho
for grande/mecânico.

**Pendências reais em aberto**:
1. **i18n da UI** — infra + Sidebar + LanguageSwitcher + batch1
   (ConnectionBar/Modal, QueryHistory, CellValueViewer) feitos.
   Restam outros componentes com literais PT — continuar em lotes
   delegados no mesmo padrão (`useTranslation` / chaves flat por
   namespace / en+pt-BR). Ver topo deste `STATE.md`.
2. **Comentários Go em inglês** — política definida (`AGENTS.md`,
   "Idioma"), comentários novos já nascem em inglês; comentários
   existentes em PT-BR (a maioria do código atual) ainda não migrados —
   fica pra leva dedicada futura, também candidato a delegação mecânica
   em lotes por arquivo/pacote.
3. **Autocomplete de alias** (feature de `dcb454f`) — usuário ainda não
   testou com queries grandes reais (prometido "amanhã", ver mensagens
   anteriores) — sem achado reportado ainda.
4. **Fase 4+** do ROADMAP: nada com demanda validada ainda (ver seção
   "Phase 4+" do `docs/ROADMAP.md`, já revisada e cortada nesta sessão —
   query builder e sync entre dispositivos removidos, DuckDB rebaixado
   abaixo de MySQL). Não iniciar nada disso sem sinal real de uso.
5. **Polish visual menor** das 3 análises de UX (tabId exposto na
   toolbar, hit-area dos resize handles, `:focus-visible` global,
   segmented control no `.table-subbar`, scrollbars customizadas) — sem
   prazo, nunca priorizado explicitamente pelo usuário.

**Retomar por**: perguntar ao usuário se o autocomplete de alias passou
no teste real, e se algum item acima virou prioridade — não escolher
sozinho por onde continuar.

## Última atualização
2026-09-15 (fim de sessão) — Autocomplete completo (v1+v2), uppercase automático, pretty-print SQL, copiar especial no grid e **edição inline de células** (item 7, concluído nesta sessão com 4 bugs reais de causa raiz corrigidos — ver seção "Edição inline de células" acima), todos implementados via delegação ao OpenCode + revisão/depuração minha antes de aceitar.

**Retomar a próxima sessão por**: "Tabela como aba própria" (item 6 da lista de próximos passos) — dados/DDL/triggers/funções de uma tabela numa aba dedicada. Ver seção própria acima com o plano técnico já esboçado (triggers/DDL/funções por dialeto, novo tipo de aba no frontend). Meu plano: eu desenho o contrato de dados (structs Go, bindings, arquitetura da aba) antes de delegar a implementação mecânica ao OpenCode — mesmo padrão que funcionou bem nesta sessão.

**Pendências de confirmação manual que ficaram em aberto** (não bloqueiam, ver seção de pausa no topo): "Copiar especial no grid" (clique direito → "Copiar célula") e uma olhada geral na janela após tanta mudança acumulada.

## 🐛 Bug real corrigido (2026-09-15, pós-release): "conn busy" em base grande
Relatado pelo usuário testando no PC da empresa (base corporativa grande,
sem git configurado nesse PC). Erro: "failed to deallocate cached state,
conn busy" ao rodar query normal; sidebar de schemas/tabelas nem abriu.

**Causa raiz confirmada**: `ConsoleTab.handleConnected` carrega o catálogo do
autocomplete num loop sequencial mas NÃO bloqueante (`ListSchemas`→
`ListTables`→`IntrospectTable` por tabela). Em bases pequenas termina em
milissegundos; em bases com centenas de tabelas, esse loop ainda roda quando
o usuário já executou uma query manual — as duas colidem na mesma conexão
(`*sql.Conn`/pgx, não suporta uso concorrente). Recidiva da mesma classe de
bug do autocomplete (`wisp-autocomplete-conn-busy-concurrency`), mas agora
entre QUALQUER chamada da aba, não só dentro do próprio loop.

**Fix geral**: novo `frontend/src/lib/tabCallQueue.ts` (`withQueue`) +
`frontend/src/lib/tabApi.ts` — reexporta todo binding tabId-scoped (exceto
`CancelQuery`, que precisa interromper uma chamada em voo e nunca pode
enfileirar) envolto numa fila por tabId. Todo componente
(ConsoleTab/Sidebar/ResultGrid/TableTab/SchemaTab/ConnectionBar/
ConnectionModal) importa de `lib/tabApi` agora. `connectLock.ts` removido
(substituído, mais genérico) — cuidado: o wrapper de conexão do
TableTab/SchemaTab usa chave `${tabId}:mount` (não `tabId` puro) pra não
deadlockar com a fila geral das chamadas internas.

**Verificado contra Postgres real com 403 tabelas** (geradas ad-hoc,
removidas depois): conectei e disparei Ctrl+Enter imediatamente — rodou
certo, sem erro; sidebar carregou as 403 tabelas depois. Ver memória
`wisp-conn-busy-large-db-fix`. `go build`/`tsc --noEmit`/`npm run build` limpos.

**Nota de UX não resolvida**: em bases muito grandes, a query do usuário
agora fica na fila (sem erro) atrás do carregamento do catálogo, sem feedback
visual de "carregando" — considerar colunas lazy no autocomplete se isso for
reportado como lento de novo.

## ✨ Abas de resultado + fila de execução + painéis redimensionáveis (2026-09-15)
Pedido do usuário: (1) múltiplas queries no console sem perder resultado
anterior; (2) painéis redimensionáveis por arrasto (não precisa de Qt/GTK,
Wails é webview comum, CSS/JS puro); (3) fila de execução (Executar com
outra rodando enfileira, não bloqueia).

**Restrição real exposta antes de implementar**: backend só mantém 1 cursor
de streaming ativo por sessão — só a aba de resultado MAIS RECENTE pode ter
"Carregar mais"; abas anteriores congelam ao iniciar uma execução nova
(aceito pelo usuário, é o comportamento comum de clientes SQL).

**Implementação**: `frontend/src/lib/useDragResize.ts` (hook genérico,
sem lib nova) pros painéis. `ConsoleTab.tsx`: estado único de resultado
trocado por `resultTabs: ResultTabState[]` (limite 10, descarta as mais
antigas já terminadas); cada `handleRun` serializa a sequência completa via
`withQueue(`${tabId}:query`, ...)` — chave DIFERENTE de `tabId` puro (usado
pelos bindings individuais via `lib/tabApi.ts`), mesmo cuidado anti-deadlock
do TableTab/SchemaTab. "Executar" sempre clicável; "Cancelar" só quando algo
roda/está na fila.

**Verificado contra Postgres real**: `pg_sleep(3)` + query imediata depois
→ 2ª só roda após 1ª terminar, sem se sobrescreverem; `order_items` depois
→ 3ª aba ok, conexão saudável; cancelar `pg_sleep(30)` real → erro pgx
correto, conexão recupera. Redimensionar sidebar/editor por arrasto →
funciona, persiste no localStorage. Ver memória
`wisp-result-tabs-queue-resizable-panels`. `go build`/`tsc`/`npm run build`
limpos.

## 🔜 Handoff pra próxima sessão (2026-09-15, fim de sessão)
**Estado**: `master` limpo e sincronizado com o remote. Releases publicadas:
`v0.1.0-beta.1` e `v0.1.0-beta.2` (esta última com o fix de conn busy +
abas de resultado + fila de execução + painéis redimensionáveis).

**Próximo passo combinado com o usuário**: revisar a lista abaixo antes de
iniciar a próxima leva de implementação (nada foi codado ainda dos itens
1-5, só planejado/priorizado):
1. Índices, FKs e distinguir Views de tabelas na exploração de schema.
2. Ganhos rápidos de ergonomia: visor de valor de célula (JSON/texto longo),
   filtro rápido na TableTab, busca na sidebar.
3. EXPLAIN / plano de execução (v1 textual).
4. INSERT/DELETE de linha no grid (fecha o ciclo da edição inline).
5. **Verificador de atualização** (GitHub Releases API, só aviso — sem
   download automático, Wails não tem updater nativo) — usuário confirmou
   que vale a pena, entra "na próxima release com as novas features" (ou
   seja, junto com algum dos itens 1-4, não como release isolada).

Ver `docs/ROADMAP.md` (Fase 3) pra detalhe de esforço/risco de cada item, e
a seção "Fora da próxima leva" pra itens conscientemente adiados (MySQL,
transação explícita, MCP, exportador grande).

**Pendências reais em aberto**: nenhuma — todo bug relatado nesta sessão
(conn busy, ctrl+click) foi corrigido e verificado contra ambiente real
(Postgres com dados reais e/ou base grande simulada). Container de teste
`wisp-postgres-test` (`testdata/docker-compose.yml`) segue rodando no
ambiente de dev — sem uso pra próxima sessão, pode subir de novo quando
precisar (`docker compose up -d`).

## 🐛 Bug real corrigido (2026-09-15): DDL/Triggers/Funções ainda dava conn busy
Usuário reportou (já na beta.2) que DDL/Triggers/Funções na TableTab
continuavam dando "conn busy". Causa raiz real: o fix anterior só impedia
duas chamadas em voo ao MESMO tempo, mas não impedia uma chamada de entrar
NO MEIO de um par `RunQuery`+`FetchRows` (cursor de streaming do pgx fica
aberto entre os dois) — clicar em DDL enquanto "Dados" ainda buscava as
primeiras linhas intercalava a query no meio do cursor aberto.

**Fix**: unificado `${tabId}:mount` (TableTab.tsx) em `${tabId}:query`,
agora também envolvendo `handleSelectSub` e `handleLoadMore`; ConsoleTab.tsx
também passou a envolver `handleLoadMore` e o loop de catálogo em
`handleConnected` na mesma trava (só `handleRun` tinha antes).

**Verificado de verdade**: criei uma VIEW lenta no Postgres real
(`pg_sleep(2)` embutido) só pra forçar a janela de corrida, e cliquei em
DDL 369ms depois de abrir a TableTab (via polling programático, não
manual) — sem erro, tudo carregou certo. Ver memória
`wisp-tabletab-conn-busy-interleave-fix`.

**Feature nova**: sub-aba "Colunas" na TableTab (Nome/Tipo/Nulo/PK/Gerada),
pedido do usuário — sem chamada nova ao backend, reusa dado já buscado.

`go build`/`tsc`/`npm run build` limpos.

## ✅ Primeira suíte de testes do projeto (2026-09-15)
Delegada ao OpenCode (Codex falhou 2x por problemas do próprio ambiente/CLI,
não do contrato — ver memória `wisp-first-test-suite-result` pro relato
completo, incluindo a lição de sempre confirmar `pgrep` que um processo
delegado morreu antes de tentar outro alvo). Resultado: `internal/db/{sqlite,postgres}_test.go`,
`internal/session/session_test.go` (todos contra SQLite/Postgres reais,
nenhum mock), `frontend/vitest.config.ts` +
`frontend/src/lib/{tabCallQueue,detectSingleTable,gridCopyFormats}.test.ts`.

**Bug real encontrado na revisão** (não veio do contrato): `detectSingleTable`
nunca detectava schema qualificado sem aspas (`public.customers`) — edição
inline sempre caía em read-only silencioso pra esse caso comum. Causa raiz
em duas camadas (regex só aceitava schema quotado + o pré-processamento
apagava identificadores quotados igual a strings antes da extração, então
nem o caso "com aspas" funcionava de verdade). Corrigido e verificado ao
vivo contra Postgres real — badge "editável" aparece agora. Ver memória
`wisp-first-test-suite-result`.

`go test ./...` (8 testes), `npm run test` (18 testes), `go build`, `tsc`,
`npm run build` todos limpos.

## 📋 Análise UX/UI (só proposta) — visor + sidebar + polish (2026-09-15)

Rodada paralela (Antigravity / OpenCode / Cursor) pedida pelo orquestrador.
**Cursor Agent** gravou análise independente (sem código) em
`docs/analysis/ui-ux-2026-09-15-cursor.md` e memória
`wisp-ui-ux-analysis-result-cursor`. Resumo: visor dockado à **direita do
grid** (escopo `ResultGrid`, não workspace — evita colidir com
Histórico/Scripts); sidebar **colapsar=esconder** só no Console (TableTab/
SchemaTab não têm Sidebar); polish P1 de tokens/`--accent-color`/toolbar.
Aguardando síntese do Claude Code + decisão do usuário antes de implementar.


## Polish visual — delegate-20260916T122129-ui-polish (2026-09-16)

Sete ajustes implementados: remoção do ID interno da toolbar, handles com
hit-area de 12px e linha de 4px, foco global, sub-abas segmentadas,
scrollbars por tokens (WebKit/Firefox), texto muted mais legível e padrão
CSS compartilhado de estados vazios (sidebar/grid/metadados/visor).
O código atual só define tema dark; não foi introduzido um tema novo.
Alterações preexistentes e textos/i18n preservados. Validação concluída:
`npx tsc --noEmit`, `npm run build` e `git diff --check` passaram.
Contraste calculado de --text-muted sobre todos os tokens --bg-*: 4,95–6,15:1.
Sem validação visual na aplicação aberta. Build com avisos de anotações
PURE do Glide e bundle acima de 500 kB; sem erros.
A primeira chamada de npx foi iniciada na raiz por engano e interrompida;
a validação foi executada novamente no diretório frontend correto.
Regras ativas: não ler .env, não criar commit, manter escopo visual mínimo.

Persistência no memory-mcp bloqueada pela política de aprovação `never`;
checkpoint preservado neste STATE.md.
