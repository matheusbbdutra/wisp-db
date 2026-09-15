import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import DataEditor, {
    CellClickedEventArgs,
    GridCell,
    GridCellKind,
    GridColumn,
    GridSelection,
    Item,
    Theme,
} from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';
import {
    copyToClipboard,
    displayValue,
    matrixToTsv,
    rowToTsv,
    toCSV,
    toInsertSQL,
    toMarkdownTable,
} from '../lib/gridCopyFormats';

interface Props {
    columns: string[];
    rows: any[][];
    onCopied?: () => void;
}

interface MenuState {
    x: number;
    y: number;
    col: number;
    row: number;
}

function isCellInRange(col: number, row: number, range: {x: number; y: number; width: number; height: number}): boolean {
    return col >= range.x && col < range.x + range.width && row >= range.y && row < range.y + range.height;
}

// Grid de resultado virtualizado via Glide Data Grid (@glideapps/glide-data-grid).
// Renderização em canvas de alto desempenho, com suporte a milhares de linhas sem travar,
// tema escuro consistente com o Wisp, colunas redimensionáveis, índice de linha nativo
// e destaque visual âmbar para valores NULL.
export default function ResultGrid({columns, rows, onCopied}: Props) {
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
    const [gridSelection, setGridSelection] = useState<GridSelection | undefined>(undefined);
    const [menu, setMenu] = useState<MenuState | null>(null);
    const lastMousePos = useRef({x: 0, y: 0});
    const menuRef = useRef<HTMLDivElement | null>(null);

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

    const getCellContent = useCallback((cell: Item): GridCell => {
        const [colIndex, rowIndex] = cell;
        const row = rows[rowIndex];
        const val = row ? row[colIndex] : null;

        if (val === null || val === undefined) {
            return {
                kind: GridCellKind.Text,
                allowOverlay: false,
                data: 'NULL',
                displayData: 'NULL',
                themeOverride: {
                    textDark: '#d97706',
                    baseFontStyle: 'italic 12px ui-monospace, monospace',
                },
            };
        }

        const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
        return {
            kind: GridCellKind.Text,
            allowOverlay: false,
            data: str,
            displayData: str,
        };
    }, [rows]);

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
        const [col, row] = cell;
        if (row < 0 || col < 0) {
            return;
        }
        setMenu({x: lastMousePos.current.x, y: lastMousePos.current.y, col, row});
    }, []);

    // Linhas marcadas via rowMarkers ("number") como matriz completa.
    const markedRowsMatrix = useCallback((): number[] | null => {
        const selected = gridSelection?.rows;
        if (!selected || selected.length === 0) {
            return null;
        }
        const valid = selected.toArray().filter(r => r >= 0 && r < rows.length);
        return valid.length > 0 ? valid : null;
    }, [gridSelection, rows.length]);

    // Matriz da seleção retangular atual (range), recortada pros limites reais.
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
        for (let r = range.y; r < range.y + range.height && r < rows.length; r++) {
            if (r >= 0) rowsIdx.push(r);
        }
        if (cols.length === 0 || rowsIdx.length === 0) {
            return null;
        }
        return {cols, rowsIdx};
    }, [gridSelection, columns.length, rows.length]);

    // Alvo do menu: a seleção ativa quando o clique cai dentro dela,
    // senão só a célula/linha clicada (não tenta "adivinhar" intenção).
    const selectionTarget = useCallback((col: number, row: number): {header: string[]; matrix: any[][]} | null => {
        const marked = markedRowsMatrix();
        if (marked && gridSelection?.rows.hasIndex(row)) {
            return {header: columns, matrix: marked.map(r => rows[r] ?? [])};
        }
        const range = gridSelection?.current?.range;
        const rect = rangeMatrix();
        if (rect && range && isCellInRange(col, row, range)) {
            return {
                header: rect.cols.map(c => columns[c]),
                matrix: rect.rowsIdx.map(r => rect.cols.map(c => (rows[r] ?? [])[c])),
            };
        }
        return null;
    }, [markedRowsMatrix, rangeMatrix, gridSelection, columns, rows]);

    const closeMenu = useCallback(() => setMenu(null), []);

    useEffect(() => {
        if (!menu) {
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
            }
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [menu]);

    const copyAndClose = useCallback(async (text: string) => {
        const ok = await copyToClipboard(text);
        if (!ok) {
            console.error('não foi possível copiar para a área de transferência');
        } else {
            onCopied?.();
        }
        setMenu(null);
    }, [onCopied]);

    const handleCopyCell = useCallback((col: number, row: number) => {
        void copyAndClose(displayValue((rows[row] ?? [])[col]));
    }, [rows, copyAndClose]);

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
                    <svg className="result-empty-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18" />
                    </svg>
                    <span>Nenhum resultado para exibir.</span>
                    <span style={{fontSize: '11px', opacity: 0.7}}>Execute uma consulta SQL para visualizar os dados aqui.</span>
                </div>
            </div>
        );
    }

    const target = menu ? selectionTarget(menu.col, menu.row) : null;
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
                    <span>Resultados:</span>
                    <span className="result-stat-badge">{rows.length} {rows.length === 1 ? 'linha' : 'linhas'}</span>
                    <span className="result-stat-badge">{columns.length} {columns.length === 1 ? 'coluna' : 'colunas'}</span>
                </div>
            </div>

            <div
                className="result-grid-canvas"
                onContextMenuCapture={handleContextMenuCapture}
                onContextMenu={e => e.preventDefault()}
            >
                <DataEditor
                    width="100%"
                    height="100%"
                    columns={gridColumns}
                    rows={rows.length}
                    getCellContent={getCellContent}
                    rowMarkers="number"
                    onColumnResize={onColumnResize}
                    theme={darkTheme}
                    smoothScrollX
                    smoothScrollY
                    gridSelection={gridSelection}
                    onGridSelectionChange={setGridSelection}
                    onCellContextMenu={handleCellContextMenu}
                />
                {menu && (
                    <div ref={menuRef} className="grid-context-menu" style={menuStyle} role="menu">
                        <button className="grid-context-menu-item" onClick={() => handleCopyCell(menu.col, menu.row)}>
                            Copiar célula
                        </button>
                        {!target && (
                            <button className="grid-context-menu-item" onClick={() => handleCopyRow(menu.row)}>
                                Copiar linha
                            </button>
                        )}
                        {target && (
                            <button className="grid-context-menu-item" onClick={() => handleCopySelection(target)}>
                                Copiar seleção
                            </button>
                        )}
                        <div className="grid-context-menu-separator" />
                        <div className="grid-context-menu-group-label">Copiar como</div>
                        <button className="grid-context-menu-item" onClick={() => handleCopyAs('csv', targetHeader, targetMatrix)}>
                            CSV
                        </button>
                        <button className="grid-context-menu-item" onClick={() => handleCopyAs('sql', targetHeader, targetMatrix)}>
                            INSERT SQL
                        </button>
                        <button className="grid-context-menu-item" onClick={() => handleCopyAs('md', targetHeader, targetMatrix)}>
                            Markdown
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
