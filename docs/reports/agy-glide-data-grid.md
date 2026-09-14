# Relatório de Implementação do Glide Data Grid — Wisp

**Data:** 2026-09-14  
**Responsável:** Antigravity (agy)  
**Contexto:** Substituição da tabela HTML simples do grid de resultados pelo Glide Data Grid virtualizado (`@glideapps/glide-data-grid`), mantendo a mesma interface de props e alta performance com milhares de linhas.

---

## 1. Arquivos Alterados

1. **`frontend/package.json`**:
   - Adicionadas as dependências `@glideapps/glide-data-grid` e dependências peer locais (`lodash`, `marked`, `react-responsive-carousel`, `@types/lodash`).
   - 100% offline (sem requisições externas ou CDN).
2. **`frontend/.npmrc`**:
   - Criado com `legacy-peer-deps=true` para compatibilidade entre React 19 e peer dependencies do ecossistema.
3. **`frontend/src/components/ResultGrid.tsx`**:
   - Substituída a renderização `<table>` HTML pelo componente `<DataEditor>` do `@glideapps/glide-data-grid`.
   - Mantida exatamente a mesma interface de props (`columns: string[], rows: any[][]`). Nenhuma alteração foi necessária em `App.tsx`.
   - Mantido o Empty State amigável quando `columns.length === 0`.
   - Mantida a barra de estatísticas (`rows.length` linhas × `columns.length` colunas).
4. **`frontend/src/App.css`**:
   - Adicionada a classe `.result-grid-canvas` (`flex: 1; min-height: 0; min-width: 0; position: relative; width: 100%; height: 100%; overflow: hidden; background: var(--bg-grid);`) para fornecer as dimensões e bounding box ideais para o canvas do Glide Data Grid.

---

## 2. Decisões de Implementação

### Mapeamento de Tema Escuro
O tema customizado (`darkTheme: Partial<Theme>`) foi mapeado diretamente a partir das CSS custom properties de `App.css`:
- `bgCell`: `#131315` (fundo das células de dados)
- `bgCellMedium`: `#18181c`
- `bgHeader`: `#1f1f23` (cabeçalho das colunas)
- `bgHeaderHasFocus`: `#27272a`
- `bgHeaderHovered`: `#2a2a30`
- `borderColor`: `#242428` (linhas de grade sutis)
- `horizontalBorderColor`: `#1a1a1e`
- `headerBottomBorderColor`: `#3f3f46`
- `textDark`: `#f4f4f5` (cor principal do texto)
- `textHeader`: `#a1a1aa` (títulos das colunas)
- `accentColor`: `#2563eb` e `accentLight`: `rgba(37, 99, 235, 0.2)` (foco e seleções)
- `fontFamily` & `baseFontStyle`: `ui-monospace, "Cascadia Code", "Fira Code", monospace` com tamanho `12px`

### Tratamento Visual de Valores `NULL`
No callback `getCellContent`:
Quando a célula possui `val === null` ou `val === undefined`:
- Retorna célula com `data: 'NULL'`, `displayData: 'NULL'`
- Aplica `themeOverride`:
  - `textDark: '#d97706'` (tom âmbar alinhado com `--accent-amber`)
  - `baseFontStyle: 'italic 12px ui-monospace, monospace'`
Dessa forma, valores `NULL` são destacados visualmente direto no canvas, idêntico à intenção original do design.

### Coluna de Índice Fixa
Utilizado o suporte nativo do Glide Data Grid via prop:
`rowMarkers="number"`
Isso cria a coluna de índice fixa à esquerda com numeração iniciando em 1 (1, 2, 3...), sem necessidade de criar colunas sintéticas na matriz de dados.

### Colunas Redimensionáveis
Implementado state local `columnWidths: Record<string, number>` e callback `onColumnResize`:
- Ao redimensionar uma coluna, a nova largura é salva no state local.
- Largura inicial calculada dinamicamente com base no tamanho do nome da coluna (mínimo 120px, máximo 320px).

---

## 3. Impacto no Tamanho do Bundle

Conforme a regra crítica do projeto contra bundles inflados (memória `monaco-editor-exports-map-vite`), medimos os assets de produção em `dist/assets`:

### Antes da instalação do Glide Data Grid:
- `editor.worker-...js`: 267 kB
- `index-...css`: 92 kB
- `index-...js`: 2.8 MB
- **Total:** ~3.16 MB

### Depois da instalação do Glide Data Grid:
- `editor.worker-DIDyqMcf.js`: 272.76 kB
- `index-C-ColBSv.css`: 106.55 kB
- `data-grid-overlay-editor-CPXHxapU.js`: 3.56 kB
- `number-overlay-editor-DetCm0Sz.js`: 16.23 kB
- `index-CjmyfphP.js`: 3,214.61 kB (3.21 MB)
- **Total:** ~3.61 MB

**Acréscimo total:** ~450 kB (perfeitamente dentro do limite esperado de <1MB, sem puxar chunks desnecessários).

---

## 4. Validação dos 3 Passos Obrigatórios

### Passo 1: Verificação de Tipos TypeScript
```bash
cd /home/matheusdutra/Projects/wisp/frontend && npx tsc --noEmit
```
- **Resultado:** Código de saída 0. Zero erros de compilação/tipagem.

### Passo 2: Build do Frontend (Vite)
```bash
npm run build
```
- **Resultado:** Código de saída 0. Build completado em 5.87s.

### Passo 3: Build do Wails
```bash
cd /home/matheusdutra/Projects/wisp && wails build -tags webkit2_41
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
Built '/home/matheusdutra/Projects/wisp/build/bin/wisp' in 10.775s.
```
- **Resultado:** Código de saída 0. Executável nativo gerado com sucesso.

---

## 5. Limitações e Próximos Passos

- **Edição Inline de Células no Grid:** Atualmente o grid opera como visualizador de resultados de alta performance (`read-only`). Edição inline com verificação de PK via catálogo (ADR 0004) poderá ser conectada via `onCellEdited` quando essa feature for iniciada.
- **Tipos Customizados de Células (JSON viewer / Arrays):** Valores complexos são atualmente serializados para string legível (`JSON.stringify`).
