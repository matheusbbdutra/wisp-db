# Análise UX/UI — Visor de valor, Sidebar colapsável e polish geral (OpenCode, 2026-09-15)

> Tarefa de ANÁLISE/PROPOSTA — nenhum código foi alterado. Proposta independente
> (rodada em paralelo com Antigravity e Cursor; não li as outras análises antes
> de escrever esta). Limitação declarada: análise feita só por leitura de código
> (`CellValueViewer.tsx`, `ResultGrid.tsx`, `Sidebar.tsx`, `ConsoleTab.tsx`,
> `TableTab.tsx`, `App.tsx`, `App.css`, `useDragResize.ts`, `valueFormat.ts`);
> não rodei `wails dev` pra testar visualmente.

## Resumo executivo

- **Ponto 1 — Visor de valor vira painel dockado à DIREITA do grid** (padrão DBeaver):
  estado mora dentro do `ResultGrid` (funciona igual em Console e TableTab sem
  prop drilling), segue a seleção ativa sozinho, redimensionável com o
  `useDragResize` já existente, preserva formato/wrap/copiar. Mantém o item
  "Ver valor…" no menu de contexto como atalho que abre o painel. Prioridade
  ALTA, esforço MÉDIO.
- **Ponto 2 — Sidebar colapsa para ESCONDIDA (não ícone-only)**, com botão
  chevron na borda + faixa/tab fina pra reabrir; preferência em `localStorage`
  (`wisp:sidebarCollapsed`); estado mora no `ConsoleTab` (único consumidor real
  da Sidebar — verificado por grep). Prioridade ALTA, esforço BAIXO.
- **Ponto 3 — Polish geral**: o problema estrutural nº 1 é **cores/valores
  hardcoded fora das vars do `:root`** (`#1e1e22`, `#93c5fd`, `#2563eb` direto
  no CSS e no TSX) + **duas vars referenciadas mas nunca definidas**
  (`--font-mono`, `--accent-color`). Corrigir isso primeiro (esforço baixo, alto
  valor) antes de qualquer outro polish. Lista priorizada completa abaixo.
- **O que NÃO fazer**: nenhum framework de UI novo, nenhum mecanismo de resize
  novo, nenhum estado global novo — tudo cabe nos padrões existentes
  (CSS puro + `useDragResize` + `localStorage`).
- **Sequência sugerida**: (1) sanear vars CSS → (2) sidebar colapsável →
  (3) painel de valor dockado → (4) resto do polish por prioridade.

---

## Ponto 1: Visor de valor como painel lateral dockado (padrão DBeaver)

### Diagnóstico do atual (verificado)

- `CellValueViewer.tsx:28-51` — modal centralizado reaproveitando a classe
  `.grid-edit-overlay` (`App.css:1486-1494`, `position:absolute; inset:0` dentro
  de `.result-grid-canvas`). Problemas concretos que justificam o feedback
  "não utilitário": (a) cobre o grid — impede comparar o valor com as linhas
  vizinhas; (b) congela o contexto — `rawValue` é snapshot (`ResultGrid.tsx:142`,
  `valueViewer` state), navegar pra outra célula não atualiza, precisa
  fechar → botão direito → "Ver valor…" de novo a cada célula; (c) o header do
  painel (`.value-viewer-header`, `App.css:1589-1594`, `space-between` com 5
  controles) espreme em modal de `min-width:420px` (`App.css:1576`).
- A funcionalidade em si (detecção Auto/Texto/JSON/XML via `valueFormat.ts`,
  wrap, copiar) está boa e deve ser preservada integralmente — o problema é
  só o *contêiner*.

### Proposta: painel dockado à DIREITA do grid

- **Lado: DIREITA.** É o padrão DBeaver ("Value" viewer à direita/inferior) e,
  no layout atual do Wisp, a esquerda já está ocupada pela Sidebar de
  schemas/tabelas — dockar o valor à esquerda criaria duas faixas verticais
  concorrentes do mesmo lado e espremeria o grid pelo meio. Direita mantém
  simetria: navegação (esq) → dados (centro) → detalhe (dir).
- **Onde mora o estado**: dentro do `ResultGrid` (state local, ao lado do
  `valueViewer` atual, `ResultGrid.tsx:142`). Motivo: o grid é compartilhado
  entre Console e TableTab, e colocar o painel como irmão do grid *dentro* do
  `ResultGrid` faz a feature funcionar nos dois contextos sem mudar
  `ConsoleTab`/`TableTab` nem fazer prop drilling além de 1 nível (convenção
  do projeto). O layout interno vira flex-row: `DataEditor` (flex:1) +
  handle vertical + painel (largura do hook).
- **Resize**: reaproveitar `useDragResize({axis:'x', initial:320, min:240,
  max:640, storageKey:'wisp:valuePanelWidth'})` — mesmo hook da sidebar e do
  split editor/grid (`ConsoleTab.tsx:135-136`). Nenhum mecanismo novo.
- **Seguir seleção vs. abertura explícita — recomendo HÍBRIDO**:
  - Painel tem toggle visível na `result-toolbar` (ex.: botão "Valor" que
    mostra/esconde, com preferência em `localStorage` `wisp:valuePanelOpen`).
  - Com o painel ABERTO, ele **segue a seleção ativa sozinho**: `ResultGrid`
    já tem `gridSelection` (`ResultGrid.tsx:125`, atualizado via
    `onGridSelectionChange`) e `handleCellClicked` (`ResultGrid.tsx:314`) —
    o painel deriva `{coluna, valor}` da célula atual sem ação extra.
  - Com o painel FECHADO, o item "Ver valor…" do menu de contexto
    (`ResultGrid.tsx:627-637`) continua existindo e passa a **abrir o painel
    já posicionado naquela célula** (em vez de abrir modal). Quem prefere o
    fluxo antigo não perde nada; quem quer o fluxo DBeaver deixa o painel
    aberto e só navega com setas/clique.
  - Detalhe de correção obrigatória: a derivação célula→valor deve passar por
    `toOriginalRow` (`ResultGrid.tsx:170-172`), porque `gridSelection` é em
    espaço **visual** (pós-filtro) — sem isso, com filtro rápido ativo, o
    painel mostraria a linha errada (mesma armadilha já documentada nos
    comentários de `markedRowsMatrix`/`rangeMatrix`).
- **Preservar**: seletor de formato, toggle wrap, botão copiar (mesmo
  `valueFormat.ts` + `copyToClipboard`, sem mudar lógica); `role="dialog"`
  vira `role="complementary"` com `aria-label` da coluna (painel persistente
  não é modal); `Escape` com foco no painel fecha/oculta (o handler global de
  `Escape` em `ResultGrid.tsx:471-476` já limpa `valueViewer` — adaptar pro
  novo estado).
- **Edge cases**: sem seleção (grid vazio / `columns.length===0`) o painel
  mostra o empty state ("Selecione uma célula…") em vez de sumir — evita
  layout pulando a cada execução; valor NULL mostra o mesmo estilo âmbar do
  grid; texto muito longo continua com scroll próprio (`overflow:auto` como
  `.value-viewer-content` atual, `App.css:1620-1631`).
- Prioridade ALTA · esforço MÉDIO (layout + wiring de seleção; zero lógica
  nova de formato/cópia).

### O que NÃO recomendo

- Painel INFERIOR (abaixo do grid): o eixo vertical já está disputado por
  editor → actions → result-tab-bar → grid → load-more; mais um split
  horizontal achata o grid até inutilidade. Split vertical à direita é o único
  que escala.
- Ícone-only/mini-barra genérica: o painel precisa de ~300px pra exibir
  JSON pretty-print legível; mini-barra que expande é um passo a mais sem
  ganho sobre o toggle direto na toolbar.

---

## Ponto 2: Sidebar minimizável/colapsável

### Diagnóstico do atual (verificado)

- `Sidebar.tsx:27` recebe `style` com largura de fora; `ConsoleTab.tsx:135`
  (`useDragResize`, min 180 / max 480) + handle em `ConsoleTab.tsx:764`.
  Só existe arrasto — o mínimo de 180px nunca libera espaço real pro grid.
- **Verificação de escopo**: grep por `useDragResize|Sidebar` em
  `frontend/src` mostra que só `ConsoleTab.tsx` importa a `Sidebar`
  (linhas 12, 756-764). `TableTab.tsx` não tem sidebar (lê só as primeiras
  100 linhas + grep sem match de Sidebar). Ou seja: o estado de colapso mora
  em **um único lugar** (`ConsoleTab`), sem coordenação entre abas.

### Proposta: colapsado = ESCONDIDO + faixa de reabertura

- **Escondido, não ícone-only.** A Sidebar é árvore de texto com busca
  (`sidebar-header` / `sidebar-search` / `sidebar-tree` — `Sidebar.tsx:165-283`):
  numa faixa de 40px nada disso sobrevive (nem heading, nem input de busca,
  nem nome de tabela). Ícone-only só faz sentido pra barra de ferramentas;
  aqui o correto é `display:none` + controle de reabertura. Isso responde
  direto à pergunta do prompt — sim, escondido é mais adequado.
- **Controles** (dois, ambos baratos):
  1. Botão chevron (`‹`/`›`) na borda direita da sidebar (ou sobre o
     `resize-handle` existente) que colapsa; `title="Recolher painel lateral"`.
  2. Com colapsada: a sidebar some (e o handle junto) e aparece uma faixa
     fina clicável na borda esquerda do workspace (`title="Expandir painel
     lateral"`) — ou, mais simples ainda, um botão discreto na
     `toolbar-secondary`. Recomendo a faixa na borda (padrão VS Code/DBeaver,
     descoberta imediata, zero caça ao botão).
- **Persistência**: `localStorage` `wisp:sidebarCollapsed` (`'1'`/`'0'`),
  mesmo padrão das chaves `wisp:sidebarWidth`/`wisp:editorHeight`/`wisp:lastOpenScript`.
  Estado: `useState` booleano no `ConsoleTab` ao lado do `sidebarResize`;
  render condicional (`{!collapsed && <Sidebar/>}`) — a `Sidebar` em si quase
  não muda (bom pra convenção "componentes pequenos").
- **Comportamento com busca ativa**: ao colapsar com texto na busca, nada se
  perde (o `search` é state interno da Sidebar; se a Sidebar desmonta, o texto
  se perde — aceitar e documentar, ou elevar só o `search` se isso incomodar;
  recomendo aceitar: colapsar com busca ativa é caso raro, não justifica
  elevar estado e furar a convenção de prop drilling).
- Prioridade ALTA · esforço BAIXO (1 boolean + 2 controles + CSS da faixa).

---

## Ponto 3: Revisão geral de UI (polish, priorizado)

Legenda de esforço: **B**aixo (só CSS/classe), **M**édio (markup/TSX local),
**A**lto (muda layout ou toca vários componentes). Nada abaixo pede lib nova —
tudo cabe no CSS puro com vars do `:root`.

### P0 — saneamento das vars (fazer antes de todo o resto)

1. **Cores hardcoded fora da paleta** (B): `#1e1e22` (menu contexto
   `App.css:1428`, popover edição `1509`, painel valor `1582`), `#93c5fd`
   (nome tabela `App.css:244,259`, hover leaf `1095`, conn ativa `526,538`),
   `#2563eb` direto (`App.css:1006`, `1572`, botão editar `1502`) em vez de
   `var(--accent-blue)`/`var(--border-focus)`, `#131315` (`1544,1625`,
   input edição `1500`) em vez de `var(--bg-grid)`. Efeito real: trocar um
   tom hoje exige caçar N pontos; qualquer proposta de "melhoria na UI" sem
   isso vira inconsistência nova.
2. **Vars referenciadas mas NUNCA definidas** (B): `var(--font-mono)` usado em
   `App.css:159,198,256,1407,1564...` e `var(--accent-color, #3b82f6)` em
   `App.css:932` — sem definição no `:root` (`App.css:5-34`), o que vale é
   fallback/herança acidental. Definir `--font-mono` e `--accent-color` de
   verdade no `:root`.
3. **Âmbar do NULL duplicado** (B): `ResultGrid.tsx:272` fixa `textDark:
   '#d97706'` inline enquanto existe `--accent-amber: #d97706`
   (`App.css:33`). Usar a var (ou expor via tema) pra manter fonte única.

### P1 — usabilidade concreta (valor alto, custo baixo/médio)

4. **`tree-leaf-open ↗` só no hover** (`App.css:305-307`) (M): inacessível por
   teclado e em touch (Webview desktop tem touch em alguns setups; e leitor
   de tela nunca "hooveia"). Mostrar também em `:focus-visible`/`focus-within`.
5. **Handles de resize finos demais** (`App.css:935-947`, 4px) (B): alvo
   pequeno até pra mouse; adicionar hit-area invisível (`::after` com
   10-12px) mantendo os 4px visuais.
6. **`result-toolbar` com `space-between`** (`App.css:1384-1393`) (B): em
   janela estreita o `result-filter-input` (largura fixa 220px, `App.css:1567`)
   comprime os badges ou estoura. `flex-wrap:wrap` + `min-width:0` resolve.
7. **`tabId` cru exposto na toolbar** (`ConsoleTab.tsx:752`,
   `.toolbar-tab-id`) (B): `tab-uuid…` é ruído visual pro usuário final
   (útil pra debug, não pra UI). Esconder atrás de `title` ou remover da
   barra — libera espaço e reduz poluição.
8. **Select do valor fora do padrão** (B): `.value-viewer-controls select`
   (`App.css:1604-1611`) não usa `.input-control` (`App.css:347-371`, que já
   tem hover/focus/disabled). Unificar (no painel dockado, herda de graça).
9. **Contraste de texto secundário** (B): `--text-muted #71717a` sobre fundos
   `#131315/#141416` fica no limite do WCAG AA em fonte 11px (badges,
   hints, `result-readonly-notice`). Subir um degrau (ex. `#8e8e96`) ou
   restringir o tom atual a textos ≥12px.
10. **Empilhamento de 3 barras** (M): `toolbar-secondary` + `editor-actions` +
    `result-tab-bar` ocupam ~100px verticais antes do primeiro dado. Avaliar
    fundir `toolbar-secondary` na linha do `editor-actions` (ou mover o
    toggle uppercase pros settings) — ganho direto de área de grid, que é o
    bem mais escasso da tela.

### P2 — consistência (quando sobrar fôlego)

11. **Empty states em 3 dialetos** (B): `sidebar-empty` / `result-empty` /
    `meta-empty` com paddings, tamanhos de ícone e tons diferentes
    (`App.css:1021-1038, 1642-1660, 268-277`). Unificar num único padrão.
12. **Modal container hardcoded** (B): `.modal-container` usa `#18181c` e
    `#151518` (`App.css:557,616`) em vez de vars — entra no saneamento P0,
    mas cito separado porque o ConnectionModal é a outra superfície "flutuante"
    que sofre do mesmo mal do CellValueViewer antigo.
13. **`history-panel` sem colapso** (M): quando o Ponto 2 estiver pronto,
    aplicar o mesmo padrão escondido+faixa ao `QueryHistory` (mesma mecânica,
    outro `localStorage` key) — não fazer junto pra não inflar o escopo.
14. **Foco visível inconsistente** (B): inputs têm `:focus` com anel azul
    (`.input-control:focus`), mas `.btn`, `.tab-item` e `.tree-leaf` não têm
    estilo de foco — navegação por teclado fica cega fora dos inputs.
    Adicionar `:focus-visible` global com `var(--border-focus)`.

### Explicitamente FORA de escopo (não propor agora)

- Virtualização nova, paginação no servidor, tema claro, troca de grid lib,
  busca semântica — nada disso decorre do feedback e tudo viola "mudança
  mínima" ou ADRs existentes.

---

## Arquivos/linhas de referência (tudo confirmado por leitura)

| O quê | Onde |
|---|---|
| Modal atual do valor | `frontend/src/components/CellValueViewer.tsx:28-51` |
| Estado snapshot do valor | `frontend/src/components/ResultGrid.tsx:142, 627-637, 689-695` |
| Seleção ativa do grid | `frontend/src/components/ResultGrid.tsx:125, 314-338, 593-594` |
| Armadilha espaço visual vs. real | `frontend/src/components/ResultGrid.tsx:149-172, 400-436` |
| Escape global | `frontend/src/components/ResultGrid.tsx:462-484` |
| Formato/cópia (preservar) | `frontend/src/lib/valueFormat.ts`, `gridCopyFormats.ts` |
| Sidebar + style externo | `frontend/src/components/Sidebar.tsx:24, 27, 164-186` |
| Único consumidor da Sidebar | `frontend/src/components/ConsoleTab.tsx:12, 135-136, 756-764` |
| Hook de resize | `frontend/src/lib/useDragResize.ts:15-54` |
| Vars `:root` | `frontend/src/App.css:5-34` |
| Overlay/painel valor CSS | `frontend/src/App.css:1486-1494, 1575-1640` |
| resize-handle CSS | `frontend/src/App.css:922-947` |
| Abas/tipos de aba | `frontend/src/App.tsx:10-49` |

*Análise gravada por OpenCode em 2026-09-15. Nenhum arquivo de código foi
alterado — só leitura e este documento.*
