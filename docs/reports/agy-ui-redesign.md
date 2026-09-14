# Relatório de Redesign Visual da UI — Wisp

**Data:** 2026-09-14  
**Escopo:** Redesign visual completo da interface frontend (React/Monaco Editor), mantendo bindings Go, lógica interna e arquitetura intocados.

---

## 1. Lista de Arquivos Alterados

- `frontend/src/style.css`: Reset e estilização base da aplicação, remoção de centralização herdada de template, integração com variáveis de sistema e scrollbars customizadas.
- `frontend/src/App.css`: Design system completo em CSS puro com variáveis de cores, elevações, botões estilizados, inputs, status badges, chips de conexões salvas, hierarquia da sidebar, toolbar do editor e tabela do grid.
- `frontend/src/App.tsx`: Atualização semântica da toolbar do editor (botão Executar com ícone de Play e badge `<kbd>Ctrl+Enter</kbd>`, botão Cancelar com ícone de Stop) e preservação estrita de todos os estados e handlers.
- `frontend/src/components/ConnectionBar.tsx`: Organização em duas fileiras limpas (conexão ativa e favoritos salvos), classes dedicadas para input DSN monoestilizado, badges de status pulsantes/coloridos e chips de conexões com tags de dialeto.
- `frontend/src/components/Sidebar.tsx`: Hierarquia visual clara com ícones SVG inline para schemas (database) e tabelas (grid), setas de expansão com animação sutil, empty state ilustrado e botão de atualização compacto.
- `frontend/src/components/SqlEditor.tsx`: Configuração de opções visuais do Monaco Editor para alinhamento com a nova paleta (font-family mono moderna, font-size 13px, padding vertical, remoção de réguas desnecessárias e scrollbars finas).
- `frontend/src/components/ResultGrid.tsx`: Visual estilo IDE/DB tool profissional com cabeçalho sticky, numeração de linhas (#) em coluna fixa à esquerda, zebra striping sutil, destaque visual para valores `NULL`, toolbar de contagem de linhas/colunas e empty state explicativo.

---

## 2. Decisões de Design

### Paleta de Cores (Dark Theme Profissional)
Inspirada em ferramentas desktop modernas (VS Code, TablePlus, DataGrip):
- **Fundo da Janela / Base:** `#121214` (zinc escuro profundo)
- **Top Bar & Barras de Ferramentas:** `#18181b` / `#1a1a1e`
- **Sidebar de Navegação:** `#141416` com bordas em `#242428` / `#2d2d32`
- **Editor Monaco:** `#1e1e1e` (tema padrão `vs-dark` totalmente integrado)
- **Grid de Resultados:** `#131315` com cabeçalho em `#1f1f23` e destaque em hover `rgba(59, 130, 246, 0.09)`
- **Acentos e Estados:**
  - Botão de Executar / Sucesso: Verde esmeralda (`#059669` / `#047857`)
  - Conexão / Primário: Azul profissional (`#2563eb` / `#1d4ed8`)
  - Alertas / Erro / Cancelar: Vermelho (`#dc2626` / `#ef4444`)
  - Indicador `NULL`: Âmbar sutil (`#d97706` com itálico)

### Tipografia
- **UI Geral:** `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
- **Código, DSN, SQL e Células de Dados:** `ui-monospace, "Cascadia Code", "Fira Code", "JetBrains Mono", Menlo, Consolas, monospace` com suporte a `tabular-nums` para alinhamento numérico impecável.

### Conformidade 100% Offline (Zero CDN)
- Todos os ícones foram implementados em **SVG inline**, sem adição de pacotes externos, sem requisições de rede ou dependências de fontes CDN.
- Mantido estritamente o isolamento local exigido pela arquitetura do Wisp.

---

## 3. Verificação de Tipagem e Build

Execução dos comandos obrigatórios:

```bash
cd frontend && npx tsc --noEmit && npm run build
```

### Saída:
```text
vite v7.0.0 building for production...
transforming...
✓ 1563 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                  0.45 kB │ gzip:     0.29 kB
dist/assets/codicon-Brq4_Ui5.ttf               140.96 kB
dist/assets/editor.worker-DIDyqMcf.js          272.76 kB
dist/assets/json.worker-D71nRnS-.js            404.05 kB
dist/assets/html.worker-GHzVgjxi.js            714.10 kB
dist/assets/css.worker-DrPvyF-b.js           1,051.35 kB
dist/assets/ts.worker-_me3HhwX.js            7,031.80 kB
dist/assets/index-1zq8466J.css                 172.41 kB │ gzip:    27.20 kB
...
dist/assets/index-C-IHNGN1.js                4,156.35 kB │ gzip: 1,087.94 kB
✓ built in 18.57s
```

- `npx tsc --noEmit`: código de saída 0 (zero erros de tipagem).
- `npm run build`: código de saída 0 (build de produção concluído com sucesso).

---

## 4. Limitações e Fora de Escopo

- **Virtualização do Grid (Glide Data Grid):** Não foi adicionada neste momento, permanecendo como tabela HTML com renderização imediata, cabeçalho sticky e scroll otimizado, respeitando a decisão de roadmap da Fase 1.
- **Redimensionamento manual de painéis (Split panes / Resizers):** A proporção atual (sidebar 250px fixa, editor 220px, grid ocupando o restante flex) é responsiva ao resize da janela, mas ainda não possui barras de arraste entre painéis.
- **Lógica e bindings de backend:** Mantidos 100% intactos conforme solicitado.
