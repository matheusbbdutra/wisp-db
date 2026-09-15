# STATE — Wisp

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
