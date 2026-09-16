import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import DataEditor, {
    CellClickedEventArgs,
    CompactSelection,
    DataEditorRef,
    GridCell,
    GridCellKind,
    GridColumn,
    GridSelection,
    Item,
    Theme,
} from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';
import {UpdateCell, ExecuteBatch} from '../lib/tabApi';
import {
    copyToClipboard,
    displayValue,
    matrixToTsv,
    rowToTsv,
    toCSV,
    toInsertSQL,
    toMarkdownTable,
} from '../lib/gridCopyFormats';
import CellValueViewer from './CellValueViewer';
import PendingChangesReview from './PendingChangesReview';
import {useDragResize} from '../lib/useDragResize';
import type {db} from '../../wailsjs/go/models';

// Contexto de edição inline (ADR 0004): só existe quando a query é um
// SELECT simples de tabela única com PK real detectada no catálogo.
// editableColumns já é a interseção entre as colunas do resultado e as
// colunas reais da tabela (expressões/aliases ficam de fora), excluídas
// as geradas — computado em ConsoleTab via IntrospectTable.
export interface EditContext {
    schema: string;
    table: string;
    pkColumns: string[];
    editableColumns: string[];
    // Colunas reais da tabela (todas, incluindo PK/geradas) — usado pelas
    // linhas de rascunho de INSERT (tipo pra coerceInsertValue e quais
    // campos oferecer; geradas ficam de fora do rascunho).
    allColumns: db.Column[];
}

interface Props {
    columns: string[];
    rows: any[][];
    tabId: string;
    editContext?: EditContext | null;
    readOnlyNotice?: string | null;
    onCellSaved?: (rowIndex: number, colIndex: number, newValue: any) => void;
    // rowIndex é o índice ORIGINAL em `rows` (já traduzido pelo ResultGrid,
    // ver toOriginalRow) — quem recebe não precisa se preocupar com filtro.
    onRowDeleted?: (rowIndex: number) => void;
    // row já vem na mesma ordem de `columns` (colunas ausentes do INSERT
    // aparecem como null — pode não bater com o valor real gerado pelo
    // banco, ex. DEFAULT/SERIAL; um refresh manual do usuário mostraria o
    // valor real. Aceito como limitação de v1, documentado no formulário).
    onRowInserted?: (row: any[]) => void;
    onStatus?: (msg: string) => void;
    onCopied?: () => void;
}

interface PendingEdit {
    col: number;
    row: number;
    columnName: string;
    oldValue: any;
    newValue: any;
    preview: string;
}

interface DirectEdit {
    col: number;
    // Índice original em `rows`, ou -1 quando a edição é de linha de
    // rascunho (aí `draftIndex` aponta em pendingInserts).
    row: number;
    draftIndex?: number;
    value: string;
    bounds: {x: number; y: number; width: number; height: number};
}

// Formata um valor pra exibição no preview do UPDATE (só visual — a query
// real é montada parametrizada no backend, nunca com esses literais).
function formatPreviewValue(val: any): string {
    if (val === null || val === undefined) {
        return 'NULL';
    }
    if (typeof val === 'number' || typeof val === 'boolean') {
        return String(val);
    }
    return `'${String(val).replace(/'/g, "''")}'`;
}

// Monta o preview legível do UPDATE com checagem otimista (WHERE pk... AND
// coluna_antiga...), espelhando o que o backend executa de forma
// parametrizada (ver db.buildUpdateCellQuery).
function buildUpdatePreview(schema: string, table: string, pkColumns: string[], pkValues: any[], column: string, oldValue: any, newValue: any): string {
    const qualified = schema && schema !== 'main' ? `"${schema}"."${table}"` : `"${table}"`;
    const where = pkColumns.map((pk, i) => {
        const v = pkValues[i];
        return v === null || v === undefined ? `"${pk}" IS NULL` : `"${pk}" = ${formatPreviewValue(v)}`;
    });
    where.push(oldValue === null || oldValue === undefined ? `"${column}" IS NULL` : `"${column}" = ${formatPreviewValue(oldValue)}`);
    return `UPDATE ${qualified} SET "${column}" = ${formatPreviewValue(newValue)} WHERE ${where.join(' AND ')}`;
}

// Monta o preview legível do DELETE, mesmo espírito de buildUpdatePreview.
function buildDeletePreview(schema: string, table: string, pkColumns: string[], pkValues: any[]): string {
    const qualified = schema && schema !== 'main' ? `"${schema}"."${table}"` : `"${table}"`;
    const where = pkColumns.map((pk, i) => {
        const v = pkValues[i];
        return v === null || v === undefined ? `"${pk}" IS NULL` : `"${pk}" = ${formatPreviewValue(v)}`;
    });
    return `DELETE FROM ${qualified} WHERE ${where.join(' AND ')}`;
}

// Preview textual do INSERT (só exibição — ExecuteBatch usa bindings).
function buildInsertPreview(schema: string, table: string, columns: string[], values: any[]): string {
    const qualified = schema && schema !== 'main' ? `"${schema}"."${table}"` : `"${table}"`;
    const cols = columns.map(c => `"${c}"`).join(', ');
    const vals = values.map(v => formatPreviewValue(v)).join(', ');
    return `INSERT INTO ${qualified} (${cols}) VALUES (${vals})`;
}

// Converte o texto editado no overlay pro tipo do valor original, pra
// manter a matriz de linhas tipada (número continua número no grid).
function coerceEditedValue(oldValue: any, text: string): any {
    if (typeof oldValue === 'number') {
        const n = Number(text);
        return Number.isNaN(n) ? text : n;
    }
    if (typeof oldValue === 'boolean') {
        if (text === 'true' || text === '1') return true;
        if (text === 'false' || text === '0') return false;
    }
    return text;
}

// Converte o texto digitado no formulário de "Nova linha" pro tipo Go
// esperado, a partir do nome do tipo da coluna (não tem um valor antigo
// pra inferir o tipo, diferente de coerceEditedValue) — heurística simples
// por substring, mesmo espírito do resto do projeto (sem parser SQL).
function coerceInsertValue(columnType: string, text: string): any {
    const t = columnType.toLowerCase();
    if (/bool/.test(t)) {
        if (text === 'true' || text === '1') return true;
        if (text === 'false' || text === '0') return false;
        return text;
    }
    if (/int|numeric|real|double|float|decimal|serial/.test(t)) {
        const n = Number(text);
        return Number.isNaN(n) ? text : n;
    }
    return text;
}

interface MenuState {
    x: number;
    y: number;
    col: number;
    // row (original, índice em `rows`) usado pra conteúdo (copiar célula/
    // linha/valor); displayRow (índice visual, pós-filtro) usado só pra
    // checar se o clique caiu dentro da seleção ativa do grid (gridSelection
    // é sempre em espaço visual — ver comentário em toOriginalRow).
    // draftIndex definido = clique numa linha de rascunho (INSERT pendente).
    row: number;
    displayRow: number;
    draftIndex?: number;
}

function isCellInRange(col: number, row: number, range: {x: number; y: number; width: number; height: number}): boolean {
    return col >= range.x && col < range.x + range.width && row >= range.y && row < range.y + range.height;
}

// Grid de resultado virtualizado via Glide Data Grid (@glideapps/glide-data-grid).
// Renderização em canvas de alto desempenho, com suporte a milhares de linhas sem travar,
// tema escuro consistente com o Wisp, colunas redimensionáveis, índice de linha nativo
// e destaque visual âmbar para valores NULL.
export default function ResultGrid({columns, rows, tabId, editContext, readOnlyNotice, onCellSaved, onRowDeleted, onRowInserted, onStatus, onCopied}: Props) {
    const {t} = useTranslation();
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
    const [gridSelection, setGridSelection] = useState<GridSelection | undefined>(undefined);
    const [menu, setMenu] = useState<MenuState | null>(null);
    const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
    const [savingEdit, setSavingEdit] = useState(false);
    // Staging multi-linha: rascunhos de INSERT (fim do grid) e índices
    // ORIGINAIS marcados pra DELETE. Nada executa até "Revisar mudanças".
    const [pendingInserts, setPendingInserts] = useState<Record<string, string>[]>([]);
    const [pendingDeleteRows, setPendingDeleteRows] = useState<Set<number>>(() => new Set());
    const [reviewOpen, setReviewOpen] = useState(false);
    const [executingBatch, setExecutingBatch] = useState(false);
    const [batchError, setBatchError] = useState<string | null>(null);
    const lastMousePos = useRef({x: 0, y: 0});
    const menuRef = useRef<HTMLDivElement | null>(null);
    const gridRef = useRef<DataEditorRef | null>(null);
    // Edição de célula própria (não usa o editor nativo do Glide): a
    // ativação por duplo-clique da lib depende de um estado interno
    // (mouseState) cujo closure fica desatualizado entre o mousedown e o
    // mouseup do mesmo clique (bug real da lib, confirmado lendo o
    // código-fonte — não é limitação de ambiente). onCellClicked, ao
    // contrário, dispara de forma simples e confiável a cada clique válido,
    // então detectamos "segundo clique na mesma célula já selecionada" nós
    // mesmos e desenhamos nosso próprio input posicionado sobre a célula.
    const lastClickRef = useRef<{col: number; row: number; time: number} | null>(null);
    const [directEdit, setDirectEdit] = useState<DirectEdit | null>(null);
    // Painel dockado de valor (não mais modal — ver docs/analysis/
    // ui-ux-2026-09-15*.md): aberto/fechado persiste em localStorage, largura
    // reaproveita o mesmo useDragResize já usado por Sidebar/split editor.
    // useDragResize não expõe um "setSize" pra zerar a largura ao fechar, por
    // isso `open` é um boolean separado — o painel só é montado quando aberto.
    const [valuePanelOpen, setValuePanelOpen] = useState(() => {
        try {
            return localStorage.getItem('wisp:valuePanelOpen') === '1';
        } catch {
            return false;
        }
    });
    // invert:true — painel ANCORADO À DIREITA (handle na borda esquerda dele);
    // arrastar em direção ao painel (delta negativo) deve aumentar a largura,
    // o oposto do caso padrão do hook (painel à esquerda, ex. Sidebar). Bug
    // real achado em revisão de código: sem isso o arrasto respondia ao
    // contrário do cursor.
    const valuePanelResize = useDragResize({axis: 'x', initial: 320, min: 240, max: 640, storageKey: 'wisp:valuePanelWidth', invert: true});

    function openValuePanel() {
        setValuePanelOpen(true);
        try {
            localStorage.setItem('wisp:valuePanelOpen', '1');
        } catch {
            // localStorage indisponível — segue só em memória.
        }
    }

    function closeValuePanel() {
        setValuePanelOpen(false);
        try {
            localStorage.setItem('wisp:valuePanelOpen', '0');
        } catch {
            // localStorage indisponível — segue só em memória.
        }
    }

    // Filtro rápido (client-side, sobre as linhas já carregadas — não
    // requery no servidor, ver docs/ARCHITECTURE.md sobre não ter parser SQL
    // custom): substring case-insensitive em qualquer coluna da linha.
    const [filterText, setFilterText] = useState('');

    // filteredIndices é null quando o filtro está vazio (caminho comum, sem
    // custo de indireção) — nesse caso índice visual == índice em `rows`
    // (identidade). Com filtro ativo, mapeia índice visual (posição na grade
    // renderizada) pro índice real em `rows`, já que o Glide Data Grid só
    // enxerga "quantas linhas existem" (rowCount) e pede conteúdo por
    // posição visual — sem essa tradução, editar/copiar uma célula filtrada
    // pegaria a linha errada de `rows`.
    const filteredIndices = useMemo(() => {
        const q = filterText.trim().toLowerCase();
        if (!q) return null;
        const idx: number[] = [];
        rows.forEach((row, i) => {
            if (row.some(v => displayValue(v).toLowerCase().includes(q))) {
                idx.push(i);
            }
        });
        return idx;
    }, [filterText, rows]);

    const rowCount = filteredIndices ? filteredIndices.length : rows.length;
    const displayRowCount = rowCount + pendingInserts.length;
    const pendingChangeCount = pendingInserts.length + pendingDeleteRows.size;

    const toOriginalRow = useCallback((displayRow: number): number => {
        return filteredIndices ? filteredIndices[displayRow] : displayRow;
    }, [filteredIndices]);

    // A seleção ativa é em espaço visual (pós-filtro) — trocar o filtro muda
    // o que cada posição visual significa, então uma seleção antiga ficaria
    // apontando pra linha errada (ou fora dos limites, já que rowCount muda).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => setGridSelection(undefined), [filterText]);

    const previousFilteredIndices = useRef(filteredIndices);
    useLayoutEffect(() => {
        const previous = previousFilteredIndices.current;
        previousFilteredIndices.current = filteredIndices;
        const cell = gridSelection?.current?.cell;
        if (!cell) return;
        const displayRow = cell[1];
        // Linhas de rascunho (displayRow >= rowCount) ficam no fim e não
        // dependem do mapa de filtro — só invalida se saiu do total.
        if (displayRow >= displayRowCount) {
            setGridSelection(undefined);
            return;
        }
        if (displayRow >= rowCount) return;
        const previousRow = previous ? previous[displayRow] : displayRow;
        if (previousRow !== toOriginalRow(displayRow)) {
            setGridSelection(undefined);
        }
    }, [filteredIndices, rowCount, displayRowCount, gridSelection, toOriginalRow]);

    // Célula ativa do painel dockado: deriva de gridSelection.current.cell
    // (espaço visual, mesma armadilha filtro-vs-real de sempre — traduz via
    // toOriginalRow) só quando o painel está aberto. Painel fechado não
    // recalcula nada (evita trabalho à toa navegando o grid sem o painel).
    const valuePanelCell = useMemo(() => {
        if (!valuePanelOpen) return null;
        const cur = gridSelection?.current?.cell;
        if (!cur) return null;
        const [colIndex, displayRowIndex] = cur;
        const columnName = columns[colIndex];
        if (columnName === undefined) return null;
        if (displayRowIndex >= rowCount) {
            const draft = pendingInserts[displayRowIndex - rowCount];
            if (!draft) return null;
            return {columnName, rawValue: displayValue(draft[columnName] ?? '')};
        }
        const rowIndex = toOriginalRow(displayRowIndex);
        const row = rows[rowIndex];
        if (!row) return null;
        return {columnName, rawValue: displayValue(row[colIndex])};
    }, [valuePanelOpen, gridSelection, rows, columns, toOriginalRow, rowCount, pendingInserts]);

    const darkTheme: Partial<Theme> = useMemo(() => ({
        accentColor: '#2563eb',
        accentFg: '#ffffff',
        accentLight: 'rgba(37, 99, 235, 0.2)',
        textDark: '#f4f4f5',
        textMedium: '#a1a1aa',
        textLight: '#71717a',
        textHeader: '#a1a1aa',
        textHeaderSelected: '#f4f4f5',
        bgCell: '#131315',
        bgCellMedium: '#18181c',
        bgHeader: '#1f1f23',
        bgHeaderHasFocus: '#27272a',
        bgHeaderHovered: '#2a2a30',
        borderColor: '#242428',
        horizontalBorderColor: '#1a1a1e',
        headerBottomBorderColor: '#3f3f46',
        fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", "JetBrains Mono", Menlo, monospace',
        baseFontStyle: '12px ui-monospace, "Cascadia Code", monospace',
        headerFontStyle: '600 11.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        markerFontStyle: '11px ui-monospace, monospace',
        editorFontSize: '12px',
        lineHeight: 1.4,
    }), []);

    const gridColumns = useMemo<GridColumn[]>(() => {
        return columns.map(c => ({
            id: c,
            title: c,
            width: columnWidths[c] ?? Math.max(120, Math.min(320, c.length * 10 + 48)),
        }));
    }, [columns, columnWidths]);

    const onColumnResize = useCallback((column: GridColumn, newSize: number) => {
        if (column.id) {
            setColumnWidths(prev => ({
                ...prev,
                [column.id!]: newSize,
            }));
        }
    }, []);

    // Índices das colunas de PK no resultado; -1 quando a PK não foi
    // selecionada (ex. SELECT sem a coluna id) — nesse caso nenhuma linha
    // tem os valores de PK e o grid inteiro fica read-only.
    const pkIndexes = useMemo(() => {
        if (!editContext) return [];
        return editContext.pkColumns.map(pk => columns.indexOf(pk));
    }, [editContext, columns]);

    const editableSet = useMemo(() => new Set(editContext?.editableColumns ?? []), [editContext]);

    const rowHasPkValues = useCallback((rowIndex: number): boolean => {
        if (!editContext || pkIndexes.length === 0) return false;
        const row = rows[rowIndex];
        if (!row) return false;
        return pkIndexes.every(i => i >= 0 && row[i] !== null && row[i] !== undefined);
    }, [editContext, pkIndexes, rows]);

    const isCellEditable = useCallback((colIndex: number, rowIndex: number): boolean => {
        if (!editContext) return false;
        if (pendingDeleteRows.has(rowIndex)) return false;
        const name = columns[colIndex];
        if (!name || !editableSet.has(name)) return false;
        // Condição única da spec: coluna editável + PK da linha conhecida e
        // não-nula. Célula NULL é editável (vira valor via SET; o WHERE usa
        // IS NULL no backend) — string vazia digitada salva '' (não NULL).
        return rowHasPkValues(rowIndex);
    }, [editContext, columns, editableSet, rowHasPkValues, pendingDeleteRows]);

    const getCellContent = useCallback((cell: Item): GridCell => {
        const [colIndex, displayRowIndex] = cell;

        // Linhas de rascunho (INSERT pendente) ficam SEMPRE no fim, fora do
        // filtro — displayRowIndex >= rowCount.
        if (displayRowIndex >= rowCount) {
            const draftIndex = displayRowIndex - rowCount;
            const draft = pendingInserts[draftIndex] ?? {};
            const columnName = columns[colIndex] ?? '';
            const raw = draft[columnName] ?? '';
            const str = raw === '' ? '' : String(raw);
            return {
                kind: GridCellKind.Text,
                allowOverlay: false,
                readonly: false,
                data: str,
                displayData: str === '' ? '' : str,
                themeOverride: {
                    bgCell: 'rgba(16,185,129,0.14)',
                },
            };
        }

        const rowIndex = toOriginalRow(displayRowIndex);
        const row = rows[rowIndex];
        const val = row ? row[colIndex] : null;
        const markedDelete = pendingDeleteRows.has(rowIndex);
        const deleteTheme = markedDelete ? {bgCell: 'rgba(239,68,68,0.14)'} : undefined;

        if (val === null || val === undefined) {
            const editable = isCellEditable(colIndex, rowIndex);
            return {
                kind: GridCellKind.Text,
                // allowOverlay sempre false: o editor nativo do Glide é
                // acionado por double-click/Enter internos à lib, cuja
                // lógica de ativação tem um bug real de closure obsoleto
                // (mouseState lido no mouseup reflete o render anterior ao
                // mousedown do mesmo clique — confirmado lendo o
                // código-fonte da lib, não é limitação de teste). Edição
                // própria via handleCellClicked substitui totalmente esse
                // mecanismo.
                allowOverlay: false,
                readonly: !editable,
                data: 'NULL',
                displayData: 'NULL',
                themeOverride: {
                    textDark: '#d97706',
                    baseFontStyle: 'italic 12px ui-monospace, monospace',
                    ...deleteTheme,
                },
            };
        }

        const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
        const editable = isCellEditable(colIndex, rowIndex);
        return {
            kind: GridCellKind.Text,
            allowOverlay: false,
            readonly: !editable,
            data: str,
            displayData: str,
            themeOverride: deleteTheme,
        };
    }, [rows, isCellEditable, toOriginalRow, rowCount, pendingInserts, pendingDeleteRows, columns]);

    // Diff contra o valor atual e abre o popover de preview do UPDATE (ADR
    // 0004: nunca commitar silencioso). O UPDATE real só executa no
    // Confirmar, via binding parametrizado. Usado tanto pelo commit da
    // edição direta (handleCellClicked/commitDirectEdit) quanto — se algum
    // dia o overlay nativo for reabilitado — pelo mesmo fluxo.
    const startPendingEdit = useCallback((colIndex: number, rowIndex: number, typed: any) => {
        if (!editContext) return;
        const row = rows[rowIndex];
        const oldValue = row[colIndex];
        if (typed === oldValue) return;
        const pkValues = pkIndexes.map(i => row[i]);
        const columnName = columns[colIndex];
        setPendingEdit({
            col: colIndex,
            row: rowIndex,
            columnName,
            oldValue,
            newValue: typed,
            preview: buildUpdatePreview(editContext.schema, editContext.table, editContext.pkColumns, pkValues, columnName, oldValue, typed),
        });
    }, [editContext, rows, pkIndexes, columns]);

    // Detecta "segundo clique na mesma célula já selecionada, dentro de
    // 500ms" nós mesmos — onCellClicked dispara de forma simples e
    // confiável a cada clique válido (ver comentário do lastClickRef).
    const handleCellClicked = useCallback((cell: Item) => {
        const [colIndex, displayRowIndex] = cell;
        const now = Date.now();
        const last = lastClickRef.current;

        // Rascunho de INSERT: sempre editável; commit grava em pendingInserts.
        if (displayRowIndex >= rowCount) {
            const draftIndex = displayRowIndex - rowCount;
            const clickKey = {col: colIndex, row: -(draftIndex + 1), time: now};
            const isSecondClick = last !== null && last.col === colIndex && last.row === clickKey.row && now - last.time < 500;
            lastClickRef.current = clickKey;
            if (!isSecondClick) return;
            const bounds = gridRef.current?.getBounds(colIndex, displayRowIndex);
            if (!bounds) return;
            const columnName = columns[colIndex] ?? '';
            const draft = pendingInserts[draftIndex] ?? {};
            setDirectEdit({
                col: colIndex,
                row: -1,
                draftIndex,
                value: draft[columnName] ?? '',
                bounds,
            });
            return;
        }

        const rowIndex = toOriginalRow(displayRowIndex);
        const editable = isCellEditable(colIndex, rowIndex);
        const isSecondClick = editable && last !== null && last.col === colIndex && last.row === rowIndex && now - last.time < 500;
        lastClickRef.current = {col: colIndex, row: rowIndex, time: now};
        if (!isSecondClick) return;
        // getBounds já soma o rowMarkerOffset internamente (ver
        // data-editor.js: `getBounds: (col,row) => ... gridRef.current?.getBounds((col ?? 0) + rowMarkerOffset, row)`)
        // — passar o índice VISUAL (displayRowIndex), já que bounds é
        // posição na tela; a linha real (rowIndex) só importa pra ler/gravar
        // o valor em `rows`.
        const bounds = gridRef.current?.getBounds(colIndex, displayRowIndex);
        if (!bounds) return;
        const row = rows[rowIndex];
        const oldValue = row[colIndex];
        setDirectEdit({
            col: colIndex,
            row: rowIndex,
            value: oldValue === null || oldValue === undefined ? '' : String(oldValue),
            bounds,
        });
    }, [isCellEditable, rows, toOriginalRow, rowCount, pendingInserts, columns]);

    const cancelDirectEdit = useCallback(() => setDirectEdit(null), []);

    const commitDirectEdit = useCallback(() => {
        if (!directEdit) return;
        if (directEdit.draftIndex !== undefined) {
            const columnName = columns[directEdit.col];
            const draftIndex = directEdit.draftIndex;
            const value = directEdit.value;
            setDirectEdit(null);
            if (!columnName) return;
            setPendingInserts(prev => {
                if (draftIndex < 0 || draftIndex >= prev.length) return prev;
                const next = [...prev];
                next[draftIndex] = {...next[draftIndex], [columnName]: value};
                return next;
            });
            return;
        }
        const row = rows[directEdit.row];
        const oldValue = row[directEdit.col];
        const typed = coerceEditedValue(oldValue, directEdit.value);
        setDirectEdit(null);
        startPendingEdit(directEdit.col, directEdit.row, typed);
    }, [directEdit, rows, startPendingEdit, columns]);

    const cancelPendingEdit = useCallback(() => {
        if (!savingEdit) setPendingEdit(null);
    }, [savingEdit]);

    const confirmPendingEdit = useCallback(async () => {
        if (!pendingEdit || !editContext || savingEdit) return;
        setSavingEdit(true);
        try {
            const row = rows[pendingEdit.row] ?? [];
            const pkValues = pkIndexes.map(i => row[i]);
            const affected = await UpdateCell(tabId, editContext.schema, editContext.table, editContext.pkColumns, pkValues, pendingEdit.columnName, pendingEdit.oldValue, pendingEdit.newValue);
            if (affected === 0) {
                // Checagem otimista falhou: outro processo alterou a linha
                // entre o fetch e o save — avisa e reverte (não toca em rows,
                // então a célula volta ao valor antigo sozinha).
                onStatus?.(t('resultGrid.warnOptimisticUpdate'));
            } else {
                onCellSaved?.(pendingEdit.row, pendingEdit.col, pendingEdit.newValue);
                onStatus?.(t('resultGrid.okCellUpdated', {count: affected}));
            }
            setPendingEdit(null);
        } catch (err) {
            onStatus?.(t('resultGrid.errorSaveCell', {error: err}));
        } finally {
            setSavingEdit(false);
        }
    }, [pendingEdit, editContext, savingEdit, rows, pkIndexes, tabId, onCellSaved, onStatus, t]);

    // Anexa uma linha em branco no fim do grid (staging de INSERT).
    const addPendingInsert = useCallback(() => {
        if (!editContext) return;
        const fields: Record<string, string> = {};
        for (const col of editContext.allColumns) {
            if (!col.IsGenerated) fields[col.Name] = '';
        }
        setPendingInserts(prev => [...prev, fields]);
    }, [editContext]);

    const togglePendingDelete = useCallback((rowIndex: number) => {
        setPendingDeleteRows(prev => {
            const next = new Set(prev);
            if (next.has(rowIndex)) next.delete(rowIndex);
            else next.add(rowIndex);
            return next;
        });
    }, []);

    const discardPendingChanges = useCallback(() => {
        setPendingInserts([]);
        setPendingDeleteRows(new Set());
        setBatchError(null);
        setReviewOpen(false);
        setDirectEdit(null);
    }, []);

    const openReview = useCallback(() => {
        setBatchError(null);
        setReviewOpen(true);
    }, []);

    const closeReview = useCallback(() => {
        if (!executingBatch) setReviewOpen(false);
    }, [executingBatch]);

    // Monta os BatchOp + previews a partir do staging atual. Campo vazio no
    // rascunho = coluna omitida (DEFAULT/SERIAL), igual ao confirmInsert antigo.
    // strict=true (execução): rascunho totalmente vazio vira erro; false
    // (preview): só omite aquele INSERT do script.
    const buildBatchFromPending = useCallback((strict: boolean): {ops: db.BatchOp[]; statements: string[]; error: string | null} => {
        if (!editContext) return {ops: [], statements: [], error: null};
        const columnByName = new Map(editContext.allColumns.map(c => [c.Name, c]));
        const ops: db.BatchOp[] = [];
        const statements: string[] = [];

        for (const draft of pendingInserts) {
            const insertColumns: string[] = [];
            const insertValues: any[] = [];
            for (const [name, text] of Object.entries(draft)) {
                if (text.trim() === '') continue;
                const col = columnByName.get(name);
                insertColumns.push(name);
                insertValues.push(coerceInsertValue(col?.Type ?? '', text));
            }
            if (insertColumns.length === 0) {
                if (strict) {
                    return {ops: [], statements: [], error: t('resultGrid.fillOneColumn')};
                }
                continue;
            }
            ops.push({
                Kind: 'insert',
                Schema: editContext.schema,
                Table: editContext.table,
                Columns: insertColumns,
                Values: insertValues,
                PKColumns: [],
                PKValues: [],
            } as db.BatchOp);
            statements.push(buildInsertPreview(editContext.schema, editContext.table, insertColumns, insertValues));
        }

        const deleteIndexes = Array.from(pendingDeleteRows).sort((a, b) => a - b);
        for (const rowIndex of deleteIndexes) {
            const row = rows[rowIndex] ?? [];
            const pkValues = pkIndexes.map(i => row[i]);
            ops.push({
                Kind: 'delete',
                Schema: editContext.schema,
                Table: editContext.table,
                Columns: [],
                Values: [],
                PKColumns: editContext.pkColumns,
                PKValues: pkValues,
            } as db.BatchOp);
            statements.push(buildDeletePreview(editContext.schema, editContext.table, editContext.pkColumns, pkValues));
        }

        return {ops, statements, error: null};
    }, [editContext, pendingInserts, pendingDeleteRows, rows, pkIndexes, t]);

    const reviewStatements = useMemo(() => {
        if (!reviewOpen) return [];
        return buildBatchFromPending(false).statements;
    }, [reviewOpen, buildBatchFromPending]);

    const executePendingBatch = useCallback(async () => {
        if (!editContext || executingBatch) return;
        const built = buildBatchFromPending(true);
        if (built.error) {
            setBatchError(built.error);
            return;
        }
        if (built.ops.length === 0) return;
        setExecutingBatch(true);
        setBatchError(null);
        try {
            await ExecuteBatch(tabId, built.ops);
            // Deletes primeiro, índices ORIGINAIS em ordem decrescente —
            // onRowDeleted do pai faz filter por índice a cada chamada.
            const deleteIndexes = Array.from(pendingDeleteRows).sort((a, b) => b - a);
            for (const rowIndex of deleteIndexes) {
                onRowDeleted?.(rowIndex);
            }
            // Inserts na ordem dos rascunhos, linha montada como no
            // confirmInsert antigo (colunas do resultado; ausente = null).
            const columnByName = new Map(editContext.allColumns.map(c => [c.Name, c]));
            for (const draft of pendingInserts) {
                const insertColumns: string[] = [];
                const insertValues: any[] = [];
                for (const [name, text] of Object.entries(draft)) {
                    if (text.trim() === '') continue;
                    const col = columnByName.get(name);
                    insertColumns.push(name);
                    insertValues.push(coerceInsertValue(col?.Type ?? '', text));
                }
                const valueByName = new Map(insertColumns.map((name, i) => [name, insertValues[i]]));
                const row = columns.map(name => (valueByName.has(name) ? valueByName.get(name) : null));
                onRowInserted?.(row);
            }
            const insertCount = pendingInserts.length;
            const deleteCount = pendingDeleteRows.size;
            setPendingInserts([]);
            setPendingDeleteRows(new Set());
            setReviewOpen(false);
            onStatus?.(t('resultGrid.okBatchApplied', {inserts: insertCount, deletes: deleteCount}));
        } catch (err) {
            setBatchError(t('resultGrid.errorBatch', {error: err}));
        } finally {
            setExecutingBatch(false);
        }
    }, [editContext, executingBatch, buildBatchFromPending, tabId, pendingDeleteRows, pendingInserts, onRowDeleted, onRowInserted, columns, onStatus, t]);

    // Captura a posição do mouse na fase de captura (roda antes do handler
    // interno do grid), porque CellClickedEventArgs só traz coordenadas
    // relativas à célula (localEventX/localEventY), não clientX/clientY.
    const handleContextMenuCapture = useCallback((e: React.MouseEvent) => {
        lastMousePos.current = {x: e.clientX, y: e.clientY};
    }, []);

    const handleCellContextMenu = useCallback((cell: Item, event: CellClickedEventArgs) => {
        event.preventDefault();
        // Usa o parâmetro `cell` (Item) do próprio callback, não
        // `event.location` — bug real: com rowMarkers="number" ativo,
        // `event.location` veio deslocado em 1 coluna (clicar em "name"
        // reportava a célula de "email"), enquanto `cell` bate certo com
        // os índices usados em getCellContent/columns/rows.
        const [col, displayRow] = cell;
        if (displayRow < 0 || col < 0) {
            return;
        }
        if (displayRow >= rowCount) {
            setMenu({
                x: lastMousePos.current.x,
                y: lastMousePos.current.y,
                col,
                row: -1,
                displayRow,
                draftIndex: displayRow - rowCount,
            });
            return;
        }
        setMenu({x: lastMousePos.current.x, y: lastMousePos.current.y, col, row: toOriginalRow(displayRow), displayRow});
    }, [toOriginalRow, rowCount]);

    // Linhas marcadas via rowMarkers ("number") como matriz completa.
    // selected.toArray() vem em espaço VISUAL (posição na grade renderizada,
    // pós-filtro) — traduz cada índice pro real em `rows` via toOriginalRow
    // antes de devolver, pra quem consome (selectionTarget/handleCopy*)
    // nunca precisar pensar em espaço visual vs. real.
    const markedRowsMatrix = useCallback((): number[] | null => {
        const selected = gridSelection?.rows;
        if (!selected || selected.length === 0) {
            return null;
        }
        const valid = selected.toArray()
            .filter(r => r >= 0 && r < rowCount)
            .map(toOriginalRow);
        return valid.length > 0 ? valid : null;
    }, [gridSelection, rowCount, toOriginalRow]);

    // Matriz da seleção retangular atual (range), recortada pros limites
    // reais — range.y/height são em espaço VISUAL, rowsIdx já sai traduzido
    // pra espaço real (ver comentário em markedRowsMatrix).
    const rangeMatrix = useCallback((): {cols: number[]; rowsIdx: number[]} | null => {
        const range = gridSelection?.current?.range;
        if (!range || range.width * range.height <= 1) {
            return null;
        }
        const cols: number[] = [];
        for (let c = range.x; c < range.x + range.width && c < columns.length; c++) {
            if (c >= 0) cols.push(c);
        }
        const rowsIdx: number[] = [];
        for (let r = range.y; r < range.y + range.height && r < rowCount; r++) {
            if (r >= 0) rowsIdx.push(toOriginalRow(r));
        }
        if (cols.length === 0 || rowsIdx.length === 0) {
            return null;
        }
        return {cols, rowsIdx};
    }, [gridSelection, columns.length, rowCount, toOriginalRow]);

    // Alvo do menu: a seleção ativa quando o clique cai dentro dela, senão só
    // a célula/linha clicada (não tenta "adivinhar" intenção). displayRow
    // (não o `row` original) é o parâmetro certo aqui — gridSelection
    // (hasIndex/range) é sempre espaço VISUAL; marked/rect já saem traduzidos
    // pra espaço real (ver markedRowsMatrix/rangeMatrix), então o resto do
    // corpo usa `rows[...]` sem tradução extra.
    const selectionTarget = useCallback((col: number, displayRow: number): {header: string[]; matrix: any[][]} | null => {
        const marked = markedRowsMatrix();
        if (marked && gridSelection?.rows.hasIndex(displayRow)) {
            return {header: columns, matrix: marked.map(r => rows[r] ?? [])};
        }
        const range = gridSelection?.current?.range;
        const rect = rangeMatrix();
        if (rect && range && isCellInRange(col, displayRow, range)) {
            return {
                header: rect.cols.map(c => columns[c]),
                matrix: rect.rowsIdx.map(r => rect.cols.map(c => (rows[r] ?? [])[c])),
            };
        }
        return null;
    }, [markedRowsMatrix, rangeMatrix, gridSelection, columns, rows]);

    const closeMenu = useCallback(() => setMenu(null), []);

    useEffect(() => {
        if (!menu && !pendingEdit) {
            return;
        }
        const onPointerDown = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenu(null);
            }
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setMenu(null);
                cancelPendingEdit();
            }
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [menu, pendingEdit, cancelPendingEdit]);

    const copyAndClose = useCallback(async (text: string) => {
        const ok = await copyToClipboard(text);
        if (!ok) {
            console.error('não foi possível copiar para a área de transferência');
        } else {
            onCopied?.();
        }
        setMenu(null);
    }, [onCopied]);

    const handleCopyCell = useCallback((col: number, row: number, draftIndex?: number) => {
        if (draftIndex !== undefined) {
            const columnName = columns[col] ?? '';
            void copyAndClose(displayValue(pendingInserts[draftIndex]?.[columnName] ?? ''));
            return;
        }
        void copyAndClose(displayValue((rows[row] ?? [])[col]));
    }, [rows, columns, pendingInserts, copyAndClose]);

    const handleCopyRow = useCallback((row: number) => {
        void copyAndClose(rowToTsv(rows[row] ?? []));
    }, [rows, copyAndClose]);

    const handleCopySelection = useCallback((target: {matrix: any[][]}) => {
        void copyAndClose(matrixToTsv(target.matrix));
    }, [copyAndClose]);

    const handleCopyAs = useCallback((format: 'csv' | 'sql' | 'md', header: string[], matrix: any[][]) => {
        if (format === 'csv') {
            void copyAndClose(toCSV(header, matrix));
            return;
        }
        if (format === 'sql') {
            void copyAndClose(toInsertSQL(header, matrix));
            return;
        }
        void copyAndClose(toMarkdownTable(header, matrix));
    }, [copyAndClose]);

    if (columns.length === 0) {
        return (
            <div className="result-container">
                <div className="result-empty">
                    <span>{t('resultGrid.empty')}</span>
                    <span>{t('resultGrid.emptyHint')}</span>
                </div>
            </div>
        );
    }

    const target = menu ? selectionTarget(menu.col, menu.displayRow) : null;
    const targetHeader = target ? target.header : columns;
    const targetMatrix = target ? target.matrix : [rows[menu?.row ?? 0] ?? []];
    const menuStyle = menu
        ? {
            left: Math.min(menu.x, window.innerWidth - 240),
            top: Math.min(menu.y, window.innerHeight - 280),
        }
        : undefined;

    return (
        <div className="result-container">
            <div className="result-toolbar">
                <div className="result-stats">
                    <span>{t('resultGrid.results')}</span>
                    <span className="result-stat-badge">
                        {filteredIndices
                            ? t('resultGrid.rowFiltered', {count: rowCount, shown: rowCount, total: rows.length})
                            : t('resultGrid.row', {count: rows.length})}
                    </span>
                    <span className="result-stat-badge">{t('resultGrid.column', {count: columns.length})}</span>
                    {editContext && (
                        <span className="result-stat-badge result-editable-badge" title={t('resultGrid.editableTitle', {pks: editContext.pkColumns.join(', ')})}>
                            {t('resultGrid.editable')}
                        </span>
                    )}
                </div>
                <input
                    className="result-filter-input"
                    type="text"
                    placeholder={t('resultGrid.filterPlaceholder')}
                    value={filterText}
                    onChange={e => setFilterText(e.target.value)}
                    title={t('resultGrid.filterTitle')}
                />
                <button
                    className={`btn btn-secondary ${valuePanelOpen ? 'active' : ''}`}
                    onClick={() => (valuePanelOpen ? closeValuePanel() : openValuePanel())}
                    title={t('resultGrid.valueToggleTitle')}
                >
                    {t('resultGrid.value')}
                </button>
                {editContext && (
                    <button className="btn btn-secondary" onClick={addPendingInsert} title={t('resultGrid.insertRowTitle')}>
                        {t('resultGrid.insertRow')}
                    </button>
                )}
                {editContext && pendingChangeCount > 0 && (
                    <>
                        <button className="btn btn-secondary" onClick={openReview}>
                            {t('resultGrid.reviewChanges', {count: pendingChangeCount})}
                        </button>
                        <button className="btn btn-secondary" onClick={discardPendingChanges} title={t('resultGrid.discardChanges')}>
                            {t('resultGrid.discardChanges')}
                        </button>
                    </>
                )}
            </div>
            {readOnlyNotice && (
                <div className="result-readonly-notice" title={readOnlyNotice}>
                    {readOnlyNotice}
                </div>
            )}

            <div className="result-body">
            <div
                className="result-grid-canvas"
                onContextMenuCapture={handleContextMenuCapture}
                onContextMenu={e => e.preventDefault()}
            >
                <DataEditor
                    ref={gridRef}
                    width="100%"
                    height="100%"
                    columns={gridColumns}
                    rows={displayRowCount}
                    getCellContent={getCellContent}
                    onCellClicked={handleCellClicked}
                    onPaste={false}
                    rowMarkers="number"
                    onColumnResize={onColumnResize}
                    theme={darkTheme}
                    smoothScrollX
                    smoothScrollY
                    gridSelection={gridSelection}
                    onGridSelectionChange={setGridSelection}
                    onCellContextMenu={handleCellContextMenu}
                />
                {directEdit && (
                    <input
                        className="grid-direct-edit-input"
                        autoFocus
                        style={{
                            position: 'fixed',
                            left: directEdit.bounds.x,
                            top: directEdit.bounds.y,
                            width: directEdit.bounds.width,
                            height: directEdit.bounds.height,
                        }}
                        value={directEdit.value}
                        onChange={e => setDirectEdit(prev => (prev ? {...prev, value: e.target.value} : prev))}
                        onKeyDown={e => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                commitDirectEdit();
                            } else if (e.key === 'Escape') {
                                e.preventDefault();
                                cancelDirectEdit();
                            }
                        }}
                        onBlur={commitDirectEdit}
                    />
                )}
                {menu && (
                    <div ref={menuRef} className="grid-context-menu" style={menuStyle} role="menu">
                        <button className="grid-context-menu-item" onClick={() => handleCopyCell(menu.col, menu.row, menu.draftIndex)}>
                            {t('resultGrid.copyCell')}
                        </button>
                        <button
                            className="grid-context-menu-item"
                            onClick={() => {
                                // Move a seleção do grid pra célula clicada — o
                                // painel deriva o conteúdo de gridSelection
                                // (valuePanelCell), então isso é o suficiente
                                // pra ele mostrar o valor certo ao abrir.
                                setGridSelection({
                                    current: {cell: [menu.col, menu.displayRow], range: {x: menu.col, y: menu.displayRow, width: 1, height: 1}, rangeStack: []},
                                    rows: CompactSelection.empty(),
                                    columns: CompactSelection.empty(),
                                });
                                openValuePanel();
                                setMenu(null);
                            }}
                        >
                            {t('resultGrid.viewValue')}
                        </button>
                        {menu.draftIndex === undefined && !target && (
                            <button className="grid-context-menu-item" onClick={() => handleCopyRow(menu.row)}>
                                {t('resultGrid.copyRow')}
                            </button>
                        )}
                        {menu.draftIndex !== undefined && (
                            <button
                                className="grid-context-menu-item grid-context-menu-item-danger"
                                onClick={() => {
                                    const idx = menu.draftIndex!;
                                    setPendingInserts(prev => prev.filter((_, i) => i !== idx));
                                    setMenu(null);
                                }}
                            >
                                {t('resultGrid.removeDraftRow')}
                            </button>
                        )}
                        {menu.draftIndex === undefined && !target && editContext && rowHasPkValues(menu.row) && (
                            <button
                                className="grid-context-menu-item grid-context-menu-item-danger"
                                onClick={() => {
                                    togglePendingDelete(menu.row);
                                    setMenu(null);
                                }}
                            >
                                {pendingDeleteRows.has(menu.row) ? t('resultGrid.unmarkDelete') : t('resultGrid.deleteRow')}
                            </button>
                        )}
                        {target && (
                            <button className="grid-context-menu-item" onClick={() => handleCopySelection(target)}>
                                {t('resultGrid.copySelection')}
                            </button>
                        )}
                        <div className="grid-context-menu-separator" />
                        <div className="grid-context-menu-group-label">{t('resultGrid.copyAs')}</div>
                        <button className="grid-context-menu-item" onClick={() => handleCopyAs('csv', targetHeader, targetMatrix)}>
                            {t('resultGrid.csv')}
                        </button>
                        <button className="grid-context-menu-item" onClick={() => handleCopyAs('sql', targetHeader, targetMatrix)}>
                            {t('resultGrid.insertSql')}
                        </button>
                        <button className="grid-context-menu-item" onClick={() => handleCopyAs('md', targetHeader, targetMatrix)}>
                            {t('resultGrid.markdown')}
                        </button>
                    </div>
                )}
                {pendingEdit && (
                    <div className="grid-edit-overlay" onMouseDown={e => { if (e.target === e.currentTarget) cancelPendingEdit(); }}>
                        <div className="grid-edit-popover" role="dialog" aria-label={t('resultGrid.confirmUpdateAria')}>
                            <div className="grid-context-menu-group-label">{t('resultGrid.confirmUpdate')}</div>
                            <div className="grid-edit-field">
                                <span className="grid-edit-label">{t('resultGrid.cell')}</span>
                                <span className="grid-edit-value">{t('resultGrid.cellLine', {column: pendingEdit.columnName, row: pendingEdit.row + 1})}</span>
                            </div>
                            <div className="grid-edit-field">
                                <span className="grid-edit-label">{t('resultGrid.from')}</span>
                                <span className="grid-edit-value">{displayValue(pendingEdit.oldValue)}</span>
                            </div>
                            <div className="grid-edit-field">
                                <span className="grid-edit-label">{t('resultGrid.to')}</span>
                                <span className="grid-edit-value">{displayValue(pendingEdit.newValue)}</span>
                            </div>
                            <code className="grid-edit-preview">{pendingEdit.preview}</code>
                            <div className="grid-edit-actions">
                                <button className="btn btn-success" onClick={confirmPendingEdit} disabled={savingEdit}>
                                    {savingEdit ? t('resultGrid.saving') : t('resultGrid.confirm')}
                                </button>
                                <button className="btn btn-secondary" onClick={cancelPendingEdit} disabled={savingEdit}>
                                    {t('resultGrid.cancel')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                {editContext && (
                    <PendingChangesReview
                        open={reviewOpen}
                        tabId={tabId}
                        schema={editContext.schema}
                        table={editContext.table}
                        statements={reviewStatements}
                        hasDeletes={pendingDeleteRows.size > 0}
                        executing={executingBatch}
                        error={batchError}
                        onClose={closeReview}
                        onDiscard={discardPendingChanges}
                        onExecute={() => void executePendingBatch()}
                    />
                )}
            </div>
            {valuePanelOpen && (
                <CellValueViewer
                    cell={valuePanelCell}
                    width={valuePanelResize.size}
                    onResizeMouseDown={valuePanelResize.onMouseDown}
                    onClose={closeValuePanel}
                />
            )}
            </div>
        </div>
    );
}
