// Cópia especial do grid (célula/linha/seleção, CSV/INSERT/Markdown) e o
// cálculo do alvo do menu de contexto a partir da seleção ativa.
// Extraído do ResultGrid sem mudança de comportamento.
import {useCallback} from 'react';
import type {GridSelection} from '@glideapps/glide-data-grid';
import {
    copyToClipboard,
    displayValue,
    matrixToTsv,
    rowToTsv,
    toCSV,
    toInsertSQL,
    toMarkdownTable,
} from './gridCopyFormats';

function isCellInRange(col: number, row: number, range: {x: number; y: number; width: number; height: number}): boolean {
    return col >= range.x && col < range.x + range.width && row >= range.y && row < range.y + range.height;
}

interface UseGridCopyArgs {
    gridSelection: GridSelection | undefined;
    rows: any[][];
    columns: string[];
    pendingInserts: Record<string, string>[];
    rowCount: number;
    toOriginalRow: (displayRow: number) => number;
    onCopied?: () => void;
}

export function useGridCopy({gridSelection, rows, columns, pendingInserts, rowCount, toOriginalRow, onCopied}: UseGridCopyArgs) {
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

    const copyAndClose = useCallback(async (text: string, onClose: () => void) => {
        const ok = await copyToClipboard(text);
        if (!ok) {
            console.error('não foi possível copiar para a área de transferência');
        } else {
            onCopied?.();
        }
        onClose();
    }, [onCopied]);

    const handleCopyCell = useCallback((col: number, row: number, draftIndex: number | undefined, onClose: () => void) => {
        if (draftIndex !== undefined) {
            const columnName = columns[col] ?? '';
            void copyAndClose(displayValue(pendingInserts[draftIndex]?.[columnName] ?? ''), onClose);
            return;
        }
        void copyAndClose(displayValue((rows[row] ?? [])[col]), onClose);
    }, [rows, columns, pendingInserts, copyAndClose]);

    const handleCopyRow = useCallback((row: number, onClose: () => void) => {
        void copyAndClose(rowToTsv(rows[row] ?? []), onClose);
    }, [rows, copyAndClose]);

    const handleCopySelection = useCallback((target: {matrix: any[][]}, onClose: () => void) => {
        void copyAndClose(matrixToTsv(target.matrix), onClose);
    }, [copyAndClose]);

    const handleCopyAs = useCallback((format: 'csv' | 'sql' | 'md', header: string[], matrix: any[][], onClose: () => void) => {
        if (format === 'csv') {
            void copyAndClose(toCSV(header, matrix), onClose);
            return;
        }
        if (format === 'sql') {
            void copyAndClose(toInsertSQL(header, matrix), onClose);
            return;
        }
        void copyAndClose(toMarkdownTable(header, matrix), onClose);
    }, [copyAndClose]);

    return {selectionTarget, handleCopyCell, handleCopyRow, handleCopySelection, handleCopyAs};
}
