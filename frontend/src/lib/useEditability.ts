// Regras de editabilidade de célula (ADR 0004): só com PK real detectada,
// nunca heurística. Extraído do ResultGrid sem mudança de comportamento.
import {useCallback, useMemo} from 'react';
import type {EditContext} from '../components/ResultGrid';

export function useEditability(
    editContext: EditContext | undefined | null,
    columns: string[],
    rows: any[][],
    pendingDeleteRows: Set<number>,
) {
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

    return {pkIndexes, rowHasPkValues, isCellEditable};
}
