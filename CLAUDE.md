# Wisp — Regras do Projeto

Cliente SQL desktop leve e nativo (Go/Wails + Webview). Estas regras são **específicas do Wisp** e complementam (nunca substituem) as regras globais do usuário em `~/.claude/CLAUDE.md`. Em conflito, as regras globais de segurança prevalecem; convenções deste arquivo prevalecem sobre preferência genérica do agente.

## Antes de codar
- Leia `docs/ARCHITECTURE.md` e o(s) ADR(s) relevante(s) em `docs/adr/` antes de tocar em módulo novo.
- Leia `STATE.md` no início de qualquer sessão — ele traz o checkpoint da tarefa em andamento.
- Tarefa multi-etapa ou sessão longa: carregue a skill `context-guard` e mantenha `STATE.md` atualizado (regra global, reforçada aqui porque este projeto terá várias fases).

## Decisões técnicas fixas (não reabrir sem ADR novo)
1. **Backend: Go + Wails v2/v3.** Frontend: Webview (React + Monaco Editor). Ver `docs/adr/0001-stack.md`.
2. **Evitar CGO onde possível — não é regra absoluta.** Drivers puro Go (`pgx`, `clickhouse-go`, `go-sql-driver/mysql`, `modernc.org/sqlite`) são obrigatórios quando existir opção madura. **Exceção documentada: DuckDB** (`go-duckdb`/`duckdb-go` exigem CGO — não há driver puro Go maduro). Builds de release com DuckDB rodam em runners nativos por OS (GitHub Actions macOS/Linux/Windows), não cross-compile forçado. Ver `docs/adr/0002-cgo-policy.md`.
3. **Store interno (conexões, histórico, cache de schema): SQLite via `modernc.org/sqlite`** (puro Go, sem CGO), nunca JSON solto em disco. Nunca Turso/libSQL remoto — não há caso de sync multi-dispositivo no escopo atual. Ver `docs/adr/0003-storage.md`.
4. **Sem vetor/embeddings no cache de metadados.** Busca de schema é exata/prefix-match (FTS5 se necessário), não semântica. Reabrir só se surgir feature de busca em linguagem natural sobre histórico de queries — e mesmo assim, SQLite + `sqlite-vec`, nunca serviço externo.
5. **Sem otimização por GPU.** Não há hot path identificado que justifique. Grid virtualizado usa renderização em canvas (Glide Data Grid) no frontend — isso já é o único ponto onde "aceleração gráfica" se aplica, e é decisão de lib, não de pipeline de dados custom.
6. **Isolamento de sessão**: cada aba = `tabId` único → `*sql.Conn` dedicado + `context.WithCancel()` próprio. Nunca compartilhar conexão entre abas. Cancelamento real (`pgx.CancelQuery` ou equivalente nativo do driver) é requisito, não "nice to have".
7. **Formato de resultado de query na ponte IPC**: sempre `{ columns: string[], types: string[], rows: any[][] }`. Nunca `[]map[string]any` (duplica chaves em JSON, explode payload).

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
