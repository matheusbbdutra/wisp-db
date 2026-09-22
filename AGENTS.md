# Wisp — Regras do Projeto

Cliente SQL desktop leve e nativo (Go/Wails + Webview). Estas regras são **específicas do Wisp** e complementam (nunca substituem) as regras globais do usuário. Em conflito, as regras globais de segurança prevalecem; convenções deste arquivo prevalecem sobre preferência genérica do agente.

## Antes de codar
- Leia `docs/ARCHITECTURE.md` e o(s) ADR(s) relevante(s) em `docs/adr/` antes de tocar em módulo novo.
- Leia `STATE.md` no início de qualquer sessão — ele traz o checkpoint da tarefa em andamento.
- Tarefa multi-etapa ou sessão longa: carregue a skill `context-guard` e mantenha `STATE.md` atualizado (regra global, reforçada aqui porque este projeto terá várias fases).

## Idioma (política do projeto — sobrescreve a regra global de PT-BR)
Decisão do usuário (2026-09-16), motivo explícito: mais chance de o projeto
ser visto/descoberto em inglês do que em português, sendo open source.
Isso substitui, só neste projeto, a regra global de "comentários e commits
em PT-BR" — a regra global segue valendo em outros projetos.

- **Comentários no código Go** (`.go`, incluindo `app.go`/`internal/**`):
  **inglês**, a partir de agora. Comentários já existentes em PT-BR migram
  numa leva dedicada futura (não é retrofit obrigatório imediato); todo
  comentário NOVO a partir de 2026-09-16 já nasce em inglês.
- **Mensagens de commit**: inglês, a partir de agora (histórico do git é
  público e pesquisável).
- **Conteúdo voltado ao GitHub** (release notes, README, issues, PRs,
  CONTRIBUTING, ADRs): inglês — já era a prática desde 2026-09-15/16 (ver
  `docs/adr/0006-i18n.md`), aqui só formalizado como política do projeto.
- **Interface do app (frontend)**: **bilíngue** (inglês + PT-BR), nunca só
  inglês — o mantenedor continua usando em português no dia a dia. Ver
  plano em `docs/adr/0006-i18n.md` (i18next/react-i18next, seletor de
  idioma, detecção por locale do SO) — aceito, ainda não implementado.
- **O que continua em PT-BR, sem mudança**: `STATE.md` e `AGENTS.md` (notas
  de trabalho internas, nunca voltadas a quem lê o repo por fora) — mesma
  lógica de sempre, isso não muda com a política acima. Comentários no
  código TS/TSX do frontend não foram decididos ainda nesta conversa —
  tratar como PT-BR até decisão explícita em contrário (mesma convenção
  global), já que o pedido do usuário foi especificamente sobre "docs go"
  (comentários Go) e conteúdo git-facing, não sobre comentários TS/TSX.

## Decisões técnicas fixas (não reabrir sem ADR novo)
1. **Backend: Go + Wails v2/v3.** Frontend: Webview (React + Monaco Editor). Ver `docs/adr/0001-stack.md`.
2. **Evitar CGO onde possível — não é regra absoluta.** Drivers puro Go (`pgx`, `clickhouse-go`, `go-sql-driver/mysql`, `modernc.org/sqlite`) são obrigatórios quando existir opção madura. **Exceção documentada: DuckDB** (`go-duckdb`/`duckdb-go` exigem CGO — não há driver puro Go maduro). Builds de release com DuckDB rodam em runners nativos por OS (GitHub Actions macOS/Linux/Windows), não cross-compile forçado. Ver `docs/adr/0002-cgo-policy.md`.
3. **Store interno (conexões, histórico, cache de schema): SQLite via `modernc.org/sqlite`** (puro Go, sem CGO), nunca JSON solto em disco. Nunca Turso/libSQL remoto — não há caso de sync multi-dispositivo no escopo atual. Ver `docs/adr/0003-storage.md`.
4. **Sem vetor/embeddings no cache de metadados.** Busca de schema é exata/prefix-match (FTS5 se necessário), não semântica. Reabrir só se surgir feature de busca em linguagem natural sobre histórico de queries — e mesmo assim, SQLite + `sqlite-vec`, nunca serviço externo.
5. **Sem otimização por GPU.** Não há hot path identificado que justifique. Grid virtualizado usa renderização em canvas (Glide Data Grid) no frontend — isso já é o único ponto onde "aceleração gráfica" se aplica, e é decisão de lib, não de pipeline de dados custom.
6. **Isolamento de sessão**: cada aba = `tabId` único → `*sql.Conn` dedicado + `context.WithCancel()` próprio. Nunca compartilhar conexão entre abas. Cancelamento real (`pgx.CancelQuery` ou equivalente nativo do driver) é requisito, não "nice to have".
7. **Formato de resultado de query na ponte IPC**: sempre `{ columns: string[], types: string[], rows: any[][] }`. Nunca `[]map[string]any` (duplica chaves em JSON, explode payload).
8. **Isolamento de statements no editor SQL (CRÍTICO - NÃO ALTERAR SEM TESTES E ADR)**:
   - A execução via atalhos (Ctrl+Enter, Ctrl+Alt+Enter, Ctrl+Shift+Enter) e botões da RunBar (`onRun`, `onRunNewTab`, `onExplain`) NUNCA deve enviar o buffer inteiro do editor se houver múltiplos comandos na tela.
   - A resolução do comando ativo DEVE usar o scanner de ranges (`splitStatements` e `resolveStatementAtOffset` em `frontend/src/lib/sqlStatements.ts`), que calcula limites `[start, end]` precisos e preserva strings (`'...'`, escapes `''` e `\'`) e comentários (`--` e `/* ... */`), delimitando por `;` e linhas em branco (`\n\s*\n`).
   - Se o cursor estiver posicionado sobre ou adjacente a qualquer query, apenas ela é enviada ao backend/driver. NUNCA regredir para splits ingênuos por regex relativo ou fallbacks acidentais `|| query` que agrupem múltiplos statements, pois o PostgreSQL (`pgx`) e a maioria dos drivers relacionais em modo estendido rejeitam múltiplos comandos com erro de sintaxe imediato (`ERROR: syntax error at or near "SELECT"`).

## Metas de performance (critério de aceite, não aspiracional)
- RAM idle com 1 conexão ativa, sem grid grande carregado: **abaixo de 500MB**.
- Startup até UI interativa: sub-segundo em hardware comum.
- Esses números são medidos ao fechar cada fase, não prometidos antes de medir.

## Segurança específica do domínio
- Credenciais de conexão: **nunca texto puro em disco**. Criptografar com chave derivada e guardar a chave mestra no keychain do SO (`go-keyring` ou equivalente por OS). Nunca logar credencial, mesmo em debug.
- Edição inline de células: **só habilitar quando existir PK simples ou composta detectada via catálogo real** (nunca heurística por nome de coluna tipo "assumir que `id` é PK"). Colunas geradas/computed ficam read-only automaticamente. UPDATE gerado usa `WHERE pk = ? AND coluna_antiga = ?` (checagem otimista de concorrência) — nunca só PK.
- Túnel SSH: suportar `ssh-agent` e `known_hosts` custom; nunca desabilitar verificação de host key por padrão.
- Toda query roda com o mesmo nível de acesso da credencial fornecida pelo usuário — o Wisp não eleva privilégio nem contorna permissões do banco.

## Convenções de código
- Go: seguir `gofmt`/`goimports` padrão, sem exceção. Nomes de pacote curtos e sem abreviação obscura (Object Calisthenics reforçado pelas regras globais).
- Padrão de acesso a driver: **Strategy** (uma implementação por dialeto de banco atrás de uma interface comum `DatabaseDriver`), nunca `switch` gigante por tipo de banco espalhado pelo código.
- Frontend: componentes pequenos, estado de conexão/aba isolado por contexto React, sem prop drilling de mais de 2 níveis.
- Nenhuma dependência nova (Go ou npm) sem checar licença e manutenção ativa — registrar em ADR se for decisão estrutural (driver, ORM, lib de grid).

## Definição de pronto (específica do Wisp, além da global)
- [ ] Cancelamento de query testado manualmente (clicar "stop" numa query lenta de verdade cancela no servidor, não só na UI).
- [ ] Se tocou em módulo de driver: testado contra pelo menos uma instância real do banco (não só mock), respeitando a regra global de não rodar teste unitário sem implementação real.
- [ ] Se tocou em edição inline: testado contra tabela sem PK (deve recusar) e com PK composta.
- [ ] ADR criado/atualizado se a mudança alterar uma decisão listada acima.
