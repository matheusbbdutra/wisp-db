// Staging multi-linha do grid: rascunhos de INSERT (fim do grid) e índices
// ORIGINAIS marcados pra DELETE. Nada executa até "Revisar mudanças".
// Extraído do ResultGrid sem mudança de comportamento.
import {useCallback, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ExecuteBatch} from './tabApi';
import {buildDeletePreview, buildInsertPreview, coerceInsertValue} from './gridEditPreview';
import type {EditContext} from '../components/ResultGrid';
import type {db} from '../../wailsjs/go/models';

interface UsePendingBatchArgs {
    editContext?: EditContext | null;
    tabId: string;
    rows: any[][];
    columns: string[];
    onRowDeleted?: (rowIndex: number) => void;
    onRowInserted?: (row: any[]) => void;
    onStatus?: (msg: string) => void;
}

export function usePendingBatch({editContext, tabId, rows, columns, onRowDeleted, onRowInserted, onStatus}: UsePendingBatchArgs) {
    const {t} = useTranslation();
    // Índices das colunas de PK no resultado; -1 quando a PK não foi
    // selecionada — nesse caso os previews de DELETE saem sem valor de PK,
    // igual ao comportamento original (a UI só oferece DELETE com PK válida).
    const pkIndexes = useMemo(() => {
        if (!editContext) return [];
        return editContext.pkColumns.map(pk => columns.indexOf(pk));
    }, [editContext, columns]);
    const [pendingInserts, setPendingInserts] = useState<Record<string, string>[]>([]);
    const [pendingDeleteRows, setPendingDeleteRows] = useState<Set<number>>(() => new Set());
    const [reviewOpen, setReviewOpen] = useState(false);
    const [executingBatch, setExecutingBatch] = useState(false);
    const [batchError, setBatchError] = useState<string | null>(null);

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
            statements.push(buildInsertPreview(editContext.schema, editContext.table, insertColumns, insertValues, editContext.dialect));
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
            statements.push(buildDeletePreview(editContext.schema, editContext.table, editContext.pkColumns, pkValues, editContext.dialect));
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

    return {
        pendingInserts,
        setPendingInserts,
        pendingDeleteRows,
        pkIndexes,
        reviewOpen,
        executingBatch,
        batchError,
        addPendingInsert,
        togglePendingDelete,
        discardPendingChanges,
        openReview,
        closeReview,
        reviewStatements,
        executePendingBatch,
    };
}
