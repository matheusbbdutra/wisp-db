// Canvas do grid (Glide Data Grid): colunas, tema, conteúdo das células e
// input de edição direta. Extraído do ResultGrid sem mudança de
// comportamento — o ResultGrid fica com filtro, staging, menu e overlays.
import {useCallback, useMemo, useRef, useState} from 'react';
import type {ReactNode, RefObject} from 'react';
import DataEditor, {
    CellClickedEventArgs,
    DataEditorRef,
    GridCell,
    GridCellKind,
    GridColumn,
    GridSelection,
    Item,
    Theme,
} from '@glideapps/glide-data-grid';
import type {DirectEdit} from '../lib/useCellEditing';
import type {MenuState} from './GridContextMenu';
import type {ForeignKeyReference} from '../lib/foreignKeyNav';
import {isCtrlHeld} from '../lib/modifierKeyTracker';

interface GridCanvasProps {
    columns: string[];
    rows: any[][];
    rowCount: number;
    displayRowCount: number;
    pendingInserts: Record<string, string>[];
    pendingDeleteRows: Set<number>;
    isCellEditable: (colIndex: number, rowIndex: number) => boolean;
    toOriginalRow: (displayRow: number) => number;
    gridSelection: GridSelection | undefined;
    onGridSelectionChange: (sel: GridSelection) => void;
    gridRef: RefObject<DataEditorRef | null>;
    directEdit: DirectEdit | null;
    foreignKeys?: ForeignKeyReference[];
    onNavigateForeignKey?: (targetSchema: string, targetTable: string, targetColumn: string, value: any) => void;
    onDirectEditChange: (value: string) => void;
    onCommitDirectEdit: () => void;
    onCancelDirectEdit: () => void;
    onCellClicked: (cell: Item) => void;
    onMenu: (menu: MenuState | null) => void;
    // Overlays do ResultGrid (menu, popover de edição, revisão) — renderizam
    // DENTRO do canvas (position:relative), mesma posição do original: o
    // popover usa position:absolute inset:0 e precisa desse ancestral.
    children?: ReactNode;
}

export default function GridCanvas({
    columns,
    rows,
    rowCount,
    displayRowCount,
    pendingInserts,
    pendingDeleteRows,
    isCellEditable,
    toOriginalRow,
    gridSelection,
    onGridSelectionChange,
    gridRef,
    directEdit,
    foreignKeys,
    onNavigateForeignKey,
    onDirectEditChange,
    onCommitDirectEdit,
    onCancelDirectEdit,
    onCellClicked,
    onMenu,
    children,
}: GridCanvasProps) {
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
    const lastMousePos = useRef({x: 0, y: 0});

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

    const fkByCol = useMemo(() => {
        const map = new Map<string, ForeignKeyReference>();
        for (const fk of foreignKeys ?? []) {
            map.set(fk.column.toLowerCase(), fk);
        }
        return map;
    }, [foreignKeys]);

    const gridColumns = useMemo<GridColumn[]>(() => {
        return columns.map(c => {
            const isFk = fkByCol.has(c.toLowerCase());
            return {
                id: c,
                title: isFk ? `${c} ↗` : c,
                width: columnWidths[c] ?? Math.max(120, Math.min(320, (c.length + (isFk ? 2 : 0)) * 10 + 48)),
            };
        });
    }, [columns, columnWidths, fkByCol]);

    const onColumnResize = useCallback((column: GridColumn, newSize: number) => {
        if (column.id) {
            setColumnWidths(prev => ({
                ...prev,
                [column.id!]: newSize,
            }));
        }
    }, []);

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

        const colName = columns[colIndex] ?? '';
        const fkRef = fkByCol.get(colName.toLowerCase());
        const isFk = !!fkRef && val !== null && val !== undefined && val !== '';

        const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
        const editable = isCellEditable(colIndex, rowIndex);
        return {
            kind: GridCellKind.Text,
            allowOverlay: false,
            readonly: !editable,
            data: str,
            displayData: str,
            themeOverride: {
                ...(isFk ? {textDark: '#60a5fa', baseFontStyle: '500 12px ui-monospace, monospace'} : {}),
                ...deleteTheme,
            },
        };
    }, [rows, isCellEditable, toOriginalRow, rowCount, pendingInserts, pendingDeleteRows, columns, fkByCol]);

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
            onMenu({
                x: lastMousePos.current.x,
                y: lastMousePos.current.y,
                col,
                row: -1,
                displayRow,
                draftIndex: displayRow - rowCount,
            });
            return;
        }
        onMenu({x: lastMousePos.current.x, y: lastMousePos.current.y, col, row: toOriginalRow(displayRow), displayRow});
    }, [toOriginalRow, rowCount, onMenu]);

    const handleCellClickedWrapper = useCallback((cell: Item, event?: CellClickedEventArgs) => {
        const [colIndex, displayRowIndex] = cell;
        if (displayRowIndex < rowCount && (isCtrlHeld() || (event && (event.shiftKey || (event as any).ctrlKey || (event as any).metaKey)))) {
            const rowIndex = toOriginalRow(displayRowIndex);
            const colName = columns[colIndex] ?? '';
            const fkRef = fkByCol.get(colName.toLowerCase());
            const val = rows[rowIndex]?.[colIndex];
            if (fkRef && val !== null && val !== undefined && val !== '' && onNavigateForeignKey) {
                onNavigateForeignKey(fkRef.targetSchema, fkRef.targetTable, fkRef.targetColumn, val);
                return;
            }
        }
        onCellClicked(cell);
    }, [rowCount, toOriginalRow, columns, fkByCol, rows, onNavigateForeignKey, onCellClicked]);

    return (
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
                onCellClicked={handleCellClickedWrapper}
                onPaste={false}
                rowMarkers="number"
                onColumnResize={onColumnResize}
                theme={darkTheme}
                smoothScrollX
                smoothScrollY
                gridSelection={gridSelection}
                onGridSelectionChange={onGridSelectionChange}
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
                    onChange={e => onDirectEditChange(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            onCommitDirectEdit();
                        } else if (e.key === 'Escape') {
                            e.preventDefault();
                            onCancelDirectEdit();
                        }
                    }}
                    onBlur={onCommitDirectEdit}
                />
            )}
            {children}
        </div>
    );
}
