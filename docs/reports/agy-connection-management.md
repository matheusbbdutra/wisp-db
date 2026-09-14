# Relatório de Reformulação do Gerenciamento de Conexões — Wisp

**Data:** 2026-09-14  
**Responsável:** Antigravity (agy)  
**Contexto:** Substituição completa da barra de DSN cru por seleção de conexões salvas e modal estruturado (file picker para SQLite, campos estruturados para Postgres).

---

## 1. Arquivos Alterados

1. **`app.go`**:
   - Adicionado import `"github.com/wailsapp/wails/v2/pkg/runtime"`.
   - Adicionado novo binding exposto ao frontend: `PickSQLiteFile() (string, error)`, que dispara o diálogo nativo do sistema operacional (`runtime.OpenFileDialog`) com filtros para `*.db;*.sqlite;*.sqlite3`.
2. **`frontend/wailsjs/go/main/App.d.ts` e `frontend/wailsjs/go/main/App.js`**:
   - Adicionada assinatura de tipo e binding JS para `PickSQLiteFile()`.
3. **`frontend/src/components/ConnectionModal.tsx`** *(novo)*:
   - Modal estruturado de conexão com abas "Nova Conexão" e "Conexões Salvas (N)".
   - Suporte a SQLite com botão para acionar o file picker nativo via `PickSQLiteFile()`.
   - Suporte a PostgreSQL com campos estruturados (Host, Porta, Database, Usuário, Senha, Modo SSL).
   - Sanitização e escape seguro de usuário e senha via `encodeURIComponent` para prevenir quebra de DSN por caracteres especiais (`@`, `:`, `/`).
   - Ações de "Salvar" e "Salvar e Conectar", além de exclusão de conexões salvas com `DeleteSavedConnection`.
4. **`frontend/src/components/ConnectionBar.tsx`**:
   - Barra de DSN cru totalmente removida da topbar.
   - Substituída por:
     - Dropdown seletor de conexões salvas (`ListSavedConnections`).
     - Botão "Conectar" / "Desconectar" baseado na conexão selecionada (`ConnectSaved`).
     - Botão "Gerenciar Conexões" para abrir o modal.
     - Tag indicadora da conexão ativa (driver + nome).
     - Badge de status da sessão.
5. **`frontend/src/App.tsx`**:
   - Limpeza de estados locais de DSN/driver soltos em `App.tsx` (agora centralizados no fluxo seguro de conexões salvas).
   - Remoção de handlers redundantes de DSN.
6. **`frontend/src/App.css`**:
   - Adicionadas classes e temas para o modal estruturado, backdrop escuro, abas, campos de formulário, pills de seleção de driver, botão do file picker e lista de conexões no gerenciador.

---

## 2. Decisões de UX

- **Eliminação de DSN em texto cru na barra principal:** A causa raiz dos problemas anteriores (perda de DSN ao trocar de driver e criação silenciosa de banco vazio no SQLite) foi eliminada na origem. A DSN agora é sempre gerada de forma transparente e estruturada.
- **SQLite com File Picker Nativo:** Em vez de digitar um caminho ou arriscar typos em paths do sistema de arquivos, o usuário clica em "Procurar arquivo..." e seleciona o `.db` diretamente no diálogo nativo do SO (GTK no Linux/WebKit, Cocoa no macOS, Win32 no Windows).
- **Postgres Estruturado com Escape Obrigatório:** Campos de host, porta, banco, usuário e senha dedicados, aplicando `encodeURIComponent` em credenciais sensíveis antes de montar `postgres://...`, protegendo contra caracteres especiais como `@` ou `:`.
- **Topbar Limpa e Produtiva:** A barra superior agora ocupa apenas uma única linha limpa com o select de conexões existentes, botão de conectar/desconectar, atalho para o modal e status da sessão.

---

## 3. Validação dos 3 Passos Obrigatórios

### Passo 1: Validação Go (`go build`, `go vet`, `gofmt`)
```bash
cd /home/matheusdutra/Projects/wisp && go build ./... && go vet ./... && gofmt -l -w .
```
- **Resultado:** Código de saída 0. Nenhum erro ou alerta.

### Passo 2: Verificação de Tipagem Frontend (`npx tsc --noEmit`)
```bash
cd frontend && npx tsc --noEmit
```
- **Resultado:** Código de saída 0. Zero erros de TypeScript.

### Passo 3: Build do Wails (`wails build -tags webkit2_41`)
```bash
wails build -tags webkit2_41
```
- **Saída:**
```text
Wails CLI v2.16.0
# Building target: linux/amd64
  • Generating bindings: Done.
  • Installing frontend dependencies: Done.
  • Compiling frontend: Done.
  • Compiling application: Done.
  • Packaging application: Done.
Built '/home/matheusdutra/Projects/wisp/build/bin/wisp' in 9.185s.
```
- **Resultado:** Código de saída 0. Binário gerado com sucesso.

---

## 4. Limitações e Fora de Escopo

- **Edição direta de conexão existente:** O usuário pode criar novas conexões salvas e excluir as existentes; a edição in-place de parâmetros de uma conexão existente não foi solicitada e poderá ser adicionada futuramente caso necessário.
- **Testes de conexão (Ping/Test Connection):** O usuário pode salvar e conectar diretamente em um clique ("Salvar e Conectar"). Um botão isolado de "Testar Conexão" sem salvar fica para evolução futura.
