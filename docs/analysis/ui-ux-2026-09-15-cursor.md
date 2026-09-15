# Análise UX/UI — Wisp (Cursor Agent) — 2026-09-15

> **Gerado por:** Cursor Agent (Composer).  
> **Escopo:** análise e proposta apenas — **sem implementação**.  
> **Fontes:** código atual em `frontend/src/` + memória `wisp-ui-ux-analysis-value-viewer-sidebar-task` + contexto `wisp` no memory-mcp.  
> **App rodando:** não testei via `wails dev` nesta rodada; achados são de leitura estruturada do código/CSS.

---

## Resumo executivo (prioridade)

1. **P0 — Visor de valor dockado à direita do grid** (dentro de `ResultGrid`, não no `workspace`): trocar o modal `.grid-edit-overlay` por painel lateral redimensionável com `useDragResize`, seguindo a célula ativa só enquanto o painel estiver aberto.
2. **P0 — Sidebar colapsável (esconder, não ícone-only)** em `ConsoleTab`: toggle + persistência `localStorage`; reabrir por faixa fina / botão na borda. Nota: `TableTab`/`SchemaTab` **não** têm Sidebar hoje.
3. **P1 — Polimento de consistência visual**: tokens CSS vs hex hardcoded, `--accent-color` indefinido, densidade da toolbar de execução, filtro do grid em larguras estreitas, affordance ↗ vs SVGs.
4. **P2 — Histórico/Scripts à direita do workspace** já competem por espaço horizontal: o inspetor de célula deve ficar **escopo-grid** para não empilhar três painéis à direita no mesmo eixo.

---

## Ponto 1 — Visor de valor: modal → painel lateral

### Diagnóstico (estado atual)

| Peça | Onde | Problema |
| --- | --- | --- |
| Modal | `CellValueViewer.tsx` L29–51 | Overlay central + backdrop; bloqueia leitura do grid e exige reabrir para outra célula |
| Montagem | `ResultGrid.tsx` L142, L689–695 | Estado `valueViewer` só preenchido pelo menu “Ver valor…” (L627–637) |
| CSS | `App.css` L1486–1494 (`.grid-edit-overlay`), L1575–1640 (`.value-viewer-*`) | Mesmo padrão visual do popover de confirmação de UPDATE — modo “diálogo”, não “ferramenta” |

O comentário no próprio componente já diz “estilo DBeaver”, mas a interação é de **modal**, não do painel Value/Panels do DBeaver.

### Layout: esquerda vs direita

**Recomendação: direita do canvas do grid (dentro de `.result-container` / ao lado de `.result-grid-canvas`).**

Por quê:

- A esquerda do `workspace` já é ocupada pela Sidebar de schemas (`ConsoleTab.tsx` L755–764).
- `ResultGrid` é compartilhado por Console e TableTab (`ConsoleTab.tsx` ~L876; `TableTab.tsx` painel Dados). Solução no `ResultGrid` cobre os dois contextos sem prop drilling até `App.tsx`.
- Padrão DBeaver/DataGrip: inspetor à **direita** da grade.
- Histórico/Scripts já dockam à **direita do workspace** (`.history-panel` ~280px, `App.css` L1101+; montados em `ConsoleTab.tsx` L895–900). Se o visor fosse irmão do `main-panel` no workspace, ao abrir Histórico + Visor o usuário perderia metade da tela. Escopo **dentro do grid** evita esse empilhamento.

**Não recomendar esquerda do grid:** competiria com a Sidebar no Console e, na TableTab (sem Sidebar), criaria um painel “órfão” sem o mesmo contexto visual.

### Redimensionamento

Reusar `useDragResize` (`frontend/src/lib/useDragResize.ts`) com `axis: 'x'`, algo como `initial: 320`, `min: 220`, `max: 640`, `storageKey: 'wisp:valueViewerWidth'`, handle `.resize-handle-v` entre canvas e painel — mesmo padrão sidebar/editor.

**Limitação atual do hook:** retorna só `{size, onMouseDown}` — **não expõe `setSize`**. Para colapsar o painel a 0 sem perder a largura “lembrada”, a implementação futura deve:

- guardar `viewerOpen: boolean` (e opcionalmente `wisp:valueViewerOpen` no `localStorage`), e
- aplicar `width` só quando aberto; ao reabrir, reutilizar `size` do hook.

Não inventar segundo mecanismo de drag.

### Seguir seleção vs abrir só por ação explícita

**Recomendação híbrida (padrão DBeaver):**

1. Painel **fechado por padrão** (ou última preferência persistida).
2. Abrir via: menu “Ver valor…”, **e** toggle na toolbar do grid (ícone/`{}`/“Valor”) — mini-barra/rail de ~24–28px quando fechado é opcional mas alinhada ao feedback do usuário (“minibarra lateral”).
3. **Enquanto aberto**, atualizar conteúdo a partir da célula ativa:
   - fonte natural: `gridSelection?.current?.cell` + `onGridSelectionChange` já ligados em `ResultGrid.tsx` L125, L593–594;
   - mapear display row → original com `toOriginalRow` (já existe por causa do filtro, L170–172);
   - `NULL` → mostrar literal visual consistente com o grid (âmbar / `NULL`), não string vazia ambígua.
4. **Não** seguir seleção com painel fechado (evita trabalho e re-render desnecessário).
5. Duplo-clique para editar (`handleCellClicked` L314–338) permanece independente — abrir o visor não deve conflitar com edição inline.

### O que preservar

- `valueFormat.ts`: Auto/Texto/JSON/XML, `detectFormat` / `formatValue`.
- Toggle quebra de linha, Copiar (`copyToClipboard`).
- Nome da coluna no header.
- Remover “Fechar” como único caminho: preferir toggle do painel + Esc quando o foco estiver no painel (Esc no grid já tem outros significados — avaliar na implementação para não roubar cancelamento de edição).

### Onde viver o estado (convenção do projeto)

- Estado `viewerOpen` + payload derivado da seleção: **dentro de `ResultGrid`** (já concentra menu, edição, filtro).
- Refatorar `CellValueViewer` para modo `docked` (sem overlay), props: `columnName`, `rawValue`, `onClose`/`onToggle`, opcionalmente `compact`.
- Evitar subir estado para `ConsoleTab`/`TableTab` (prop drilling > 2 níveis).

### Esforço estimado

| Item | Esforço |
| --- | --- |
| Layout dock + CSS (sem overlay) | médio |
| Sync com `gridSelection` | baixo–médio |
| Toggle + persistência open/width | baixo |
| Rail colapsado (ícone) | baixo (opcional P1) |

---

## Ponto 2 — Sidebar minimizável

### Diagnóstico

- Sidebar: `Sidebar.tsx` (header L165+, search L175+, tree L187+).
- Largura: **só** `ConsoleTab.tsx` L135 + L756–764 via `useDragResize` (`wisp:sidebarWidth`, 180–480).
- **Correção ao enunciado da task:** `TableTab.tsx` e `SchemaTab.tsx` **não** usam `Sidebar` nem `useDragResize`. Colapso aplica-se ao Console (e a qualquer futuro host da Sidebar).

Hoje o mínimo útil é 180px — ainda consome espaço em monitores estreitos / grids largos; não há “recolher de um clique”.

### Colapsado = escondido (não ícone-only)

**Recomendação: colapsar = ocultar a árvore (width ~0 / `display` off), com controle para reabrir.**

Por quê ícone-only falha aqui:

- Conteúdo é **texto** (schemas/tabelas + busca), não toolbar de ícones.
- Busca (`sidebar-search-input`) e nomes longos não cabem em 48px.
- O botão ↗ por tabela e expand/collapse de schema dependem de labels.

### Interação proposta

1. Botão chevron/“«” no `sidebar-header` (ao lado do refresh) → colapsa.
2. Com colapsado: faixa ~16–20px **ou** só o handle vertical + botão “Schemas” flutuante na borda esquerda do `workspace` (preferência: faixa com botão, mais descoberta).
3. Persistir `wisp:sidebarCollapsed` (`'1'|'0'`) no `localStorage`, espelhando o padrão do hook / uppercase do editor.
4. Ao colapsar, **não** destruir estado React da árvore (expanded/search/tables) — só esconder; evita refetch ao reabrir.
5. Atalho opcional (P2): `Ctrl+B` estilo VS Code — só se não conflitar com atalhos Monaco já usados.

### Onde o estado vive

- `collapsed` em `ConsoleTab` (dono do `sidebarResize`), passando `collapsed`/`onToggleCollapse` para `Sidebar` **ou** controlando width no wrapper (`style={{width: collapsed ? 0 : sidebarResize.size, ...}}` + esconder handle).
- `Sidebar` continua “burro” quanto a resize (já recebe `style`) — bom para SRP.

### Esforço

Baixo–médio (UI + persistência; sem backend).

---

## Ponto 3 — Revisão geral de UI (polish, priorizado)

Foco em inconsistências do que **já existe**, não features novas.

| Pri | Achado | Evidência | Esforço |
| --- | --- | --- | --- |
| P1 | `--accent-color` usado no resize-handle mas **não** definido em `:root` (fallback `#3b82f6`) | `App.css` L932 vs L5–34 | baixo |
| P1 | Hex hardcoded fora dos tokens (`#1e1e22`, `#131315`, `#2563eb`, `#4ade80`, `#93c5fd`, status `#10b981`) | value-viewer, grid-edit, badges, tree links | médio |
| P1 | Toolbar de execução densa: 2–3 `<kbd>` visíveis por botão + batch size | `ConsoleTab.tsx` L781–830; `.kbd-shortcut` | baixo–médio |
| P1 | `toolbar-tab-id` expõe `tabId` na UI — útil p/ debug, ruído p/ usuário final | `ConsoleTab.tsx` L752 | baixo (ocultar ou só title/dev) |
| P2 | Filtro do grid largura fixa 220px + badges à esquerda — risco de wrap/aperto | `App.css` L1559–1567; toolbar L546–567 | baixo |
| P2 | Affordance abrir aba: caractere “↗” vs ícones SVG no restante | `Sidebar.tsx` L271 | baixo |
| P2 | Histórico/Scripts: largura fixa, **sem** `useDragResize` (assimétrico vs Sidebar) | `.history-panel` L1101; `ConsoleTab` L895–900 | médio |
| P2 | Duas faixas de chrome empilhadas (`.topbar` + `.toolbar-secondary`) | `ConnectionBar` + Console | médio (cuidado: não redesign amplo) |
| P3 | TableTab meta ainda em `<table class="columns-table">` — ok p/ metadados; alinhar tipografia/padding aos tokens do grid | `TableTab.tsx` L298+ | baixo |
| P3 | Empty states misturam `style={{fontSize…}}` inline | `ResultGrid.tsx` L528 | baixo |

**Fora de escopo consciente:** redesign completo, Tailwind/MUI, virtualização do meta, novos painéis de propriedade de tabela.

---

## Ordem sugerida de implementação (quando aprovada)

1. Dock do `CellValueViewer` + sync de seleção + toggle (fecha o feedback literal do usuário).
2. Collapse da Sidebar no Console.
3. Pacote P1 de tokens/toolbar/`tabId`.
4. Opcionais P2 (resize History/Scripts, rail do visor).

---

## Riscos / invariantes

- Não quebrar edição inline / overlay de confirmação UPDATE (continuar modal — é fluxo destrutivo, overlay faz sentido).
- Respeitar filtro: sempre `toOriginalRow` ao ler valor da seleção.
- Sem framework CSS novo; só variáveis em `:root` + classes existentes.
- Estado por aba/grid local — não globalizar no `App.tsx`.

---

## Limitações desta análise

- Memory-mcp: `get_memory` foi rejeitado uma vez no ambiente; `search_memory` funcionou (task + contexto `wisp`).
- Sem validação visual em `wails dev` nesta rodada.
- Proposta independente (não li resultados de Antigravity/OpenCode antes de gravar).

---

## Nota comparativa (após gravar a própria análise)

Consulta pós-fato às memórias dos outros agentes:

- **Convergência forte** com OpenCode e Antigravity: direita do grid, estado no `ResultGrid`, sidebar colapsar=esconder (não ícone-only), `useDragResize`, polish de tokens.
- **Diferencial Cursor**: enfatizar conflito com Histórico/Scripts à direita do *workspace* (por isso o dock deve ser escopo-grid); flag de que `useDragResize` não expõe `setSize` (boolean `open` separado).
- **OpenCode**: ordem de implementação começa por sanear CSS vars (incl. `--font-mono`); bom checklist de polish (hit-area dos handles, focus-visible).
- **Antigravity**: memória gravada como `wisp-ui-ux-analysis-result` (sem sufixo `-antigravity`) e arquivo `docs/analysis/ui-ux-2026-09-15.md` — nomes fora do contrato da task; conteúdo alinhado no geral.
