// Filtro rápido do grid (client-side, sobre as linhas já carregadas — não
// requery no servidor, ver docs/ARCHITECTURE.md sobre não ter parser SQL
// custom): substring case-insensitive em qualquer coluna da linha.
// Extraído do ResultGrid sem mudança de comportamento.
import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {GridSelection} from '@glideapps/glide-data-grid';
import {displayValue} from './gridCopyFormats';

export function useGridFilter(
    rows: any[][],
    pendingInsertCount: number,
    gridSelection: GridSelection | undefined,
    setGridSelection: (sel: GridSelection | undefined) => void,
) {
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
    const displayRowCount = rowCount + pendingInsertCount;

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
    }, [filteredIndices, rowCount, displayRowCount, gridSelection, toOriginalRow, setGridSelection]);

    return {filterText, setFilterText, filteredIndices, rowCount, displayRowCount, toOriginalRow};
}
