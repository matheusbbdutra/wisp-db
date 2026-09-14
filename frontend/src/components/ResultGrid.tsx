import {useCallback, useMemo, useState} from 'react';
import DataEditor, {
    GridCell,
    GridCellKind,
    GridColumn,
    Item,
    Theme,
} from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';

interface Props {
    columns: string[];
    rows: any[][];
}

// Grid de resultado virtualizado via Glide Data Grid (@glideapps/glide-data-grid).
// Renderização em canvas de alto desempenho, com suporte a milhares de linhas sem travar,
// tema escuro consistente com o Wisp, colunas redimensionáveis, índice de linha nativo
// e destaque visual âmbar para valores NULL.
export default function ResultGrid({columns, rows}: Props) {
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});

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

    return (
        <div className="result-container">
            <div className="result-toolbar">
                <div className="result-stats">
                    <span>Resultados:</span>
                    <span className="result-stat-badge">{rows.length} {rows.length === 1 ? 'linha' : 'linhas'}</span>
                    <span className="result-stat-badge">{columns.length} {columns.length === 1 ? 'coluna' : 'colunas'}</span>
                </div>
            </div>

            <div className="result-grid-canvas">
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
                />
            </div>
        </div>
    );
}
