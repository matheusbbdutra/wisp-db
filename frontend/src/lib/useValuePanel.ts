// Painel dockado de valor da célula ativa (deriva de gridSelection).
// Extraído do ResultGrid sem mudança de comportamento.
import {useMemo, useState} from 'react';
import type {GridSelection} from '@glideapps/glide-data-grid';
import {displayValue} from './gridCopyFormats';
import {useDragResize} from './useDragResize';

export function useValuePanel(
    gridSelection: GridSelection | undefined,
    columns: string[],
    rows: any[][],
    rowCount: number,
    toOriginalRow: (displayRow: number) => number,
    pendingInserts: Record<string, string>[],
) {
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

    return {valuePanelOpen, valuePanelResize, valuePanelCell, openValuePanel, closeValuePanel};
}
