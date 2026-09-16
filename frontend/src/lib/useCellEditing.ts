// Edição de célula do grid: input direto posicionado sobre a célula
// (segundo clique) + popover de confirmação do UPDATE (ADR 0004: nunca
// commitar silencioso). Extraído do ResultGrid sem mudança de comportamento.
import {useCallback, useRef, useState} from 'react';
import type {RefObject} from 'react';
import {useTranslation} from 'react-i18next';
import type {DataEditorRef, Item} from '@glideapps/glide-data-grid';
import {UpdateCell} from './tabApi';
import {buildUpdatePreview, coerceEditedValue} from './gridEditPreview';
import type {EditContext} from '../components/ResultGrid';

export interface PendingEdit {
    col: number;
    row: number;
    columnName: string;
    oldValue: any;
    newValue: any;
    preview: string;
}

export interface DirectEdit {
    col: number;
    // Índice original em `rows`, ou -1 quando a edição é de linha de
    // rascunho (aí `draftIndex` aponta em pendingInserts).
    row: number;
    draftIndex?: number;
    value: string;
    bounds: {x: number; y: number; width: number; height: number};
}

interface UseCellEditingArgs {
    editContext?: EditContext | null;
    rows: any[][];
    columns: string[];
    pkIndexes: number[];
    tabId: string;
    rowCount: number;
    toOriginalRow: (displayRow: number) => number;
    pendingInserts: Record<string, string>[];
    setPendingInserts: React.Dispatch<React.SetStateAction<Record<string, string>[]>>;
    isCellEditable: (colIndex: number, rowIndex: number) => boolean;
    gridRef: RefObject<DataEditorRef | null>;
    onCellSaved?: (rowIndex: number, colIndex: number, newValue: any) => void;
    onStatus?: (msg: string) => void;
}

export function useCellEditing({
    editContext,
    rows,
    columns,
    pkIndexes,
    tabId,
    rowCount,
    toOriginalRow,
    pendingInserts,
    setPendingInserts,
    isCellEditable,
    gridRef,
    onCellSaved,
    onStatus,
}: UseCellEditingArgs) {
    const {t} = useTranslation();
    const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
    const [savingEdit, setSavingEdit] = useState(false);
    const [directEdit, setDirectEdit] = useState<DirectEdit | null>(null);
    // Edição de célula própria (não usa o editor nativo do Glide): a
    // ativação por duplo-clique da lib depende de um estado interno
    // (mouseState) cujo closure fica desatualizado entre o mousedown e o
    // mouseup do mesmo clique (bug real da lib, confirmado lendo o
    // código-fonte — não é limitação de ambiente). onCellClicked, ao
    // contrário, dispara de forma simples e confiável a cada clique válido,
    // então detectamos "segundo clique na mesma célula já selecionada" nós
    // mesmos e desenhamos nosso próprio input posicionado sobre a célula.
    const lastClickRef = useRef<{col: number; row: number; time: number} | null>(null);

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
    }, [isCellEditable, rows, toOriginalRow, rowCount, pendingInserts, columns, gridRef]);

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
    }, [directEdit, rows, startPendingEdit, columns, setPendingInserts]);

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

    return {
        pendingEdit,
        savingEdit,
        directEdit,
        setDirectEdit,
        handleCellClicked,
        commitDirectEdit,
        cancelDirectEdit,
        cancelPendingEdit,
        confirmPendingEdit,
    };
}
