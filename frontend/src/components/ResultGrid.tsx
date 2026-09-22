import {useCallback, useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useRef} from 'react';
import {CompactSelection} from '@glideapps/glide-data-grid';
import type {DataEditorRef, GridSelection} from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';
import {useGridFilter} from '../lib/useGridFilter';
import {useGridCopy} from '../lib/useGridCopy';
import {usePendingBatch} from '../lib/usePendingBatch';
import {useCellEditing} from '../lib/useCellEditing';
import {useEditability} from '../lib/useEditability';
import {useValuePanel} from '../lib/useValuePanel';
import CellValueViewer from './CellValueViewer';
import PendingChangesReview from './PendingChangesReview';
import ResultGridToolbar from './ResultGridToolbar';
import GridCanvas from './GridCanvas';
import GridContextMenu, {MenuState} from './GridContextMenu';
import GridEditPopover from './GridEditPopover';
import type {db} from '../../wailsjs/go/models';

import type {ForeignKeyReference} from '../lib/foreignKeyNav';
import {findForeignKeyReference} from '../lib/foreignKeyNav';

// Contexto de edição inline (ADR 0004): só existe quando a query é um
// SELECT simples de tabela única com PK real detectada no catálogo.
// editableColumns já é a interseção entre as colunas do resultado e as
// colunas reais da tabela (expressões/aliases ficam de fora), excluídas
// as geradas — computado via useResultExecution (tryComputeEditContext).
export interface EditContext {
    schema: string;
    table: string;
    pkColumns: string[];
    editableColumns: string[];
    // Colunas reais da tabela (todas, incluindo PK/geradas) — usado pelas
    // linhas de rascunho de INSERT (tipo pra coerceInsertValue e quais
    // campos oferecer; geradas ficam de fora do rascunho).
    allColumns: db.Column[];
    foreignKeys?: ForeignKeyReference[];
}

interface Props {
    columns: string[];
    rows: any[][];
    tabId: string;
    editContext?: EditContext | null;
    foreignKeys?: ForeignKeyReference[];
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
    onNavigateForeignKey?: (targetSchema: string, targetTable: string, targetColumn: string, value: any) => void;
}

// Grid de resultado virtualizado (Glide Data Grid, renderização em canvas).
// Orquestra os domínios extraídos (mesmo comportamento, arquivos próprios):
// filtro visual↔real (useGridFilter), cópia especial (useGridCopy), staging
// INSERT/DELETE (usePendingBatch), edição de célula (useCellEditing),
// regras de editabilidade (useEditability), painel de valor (useValuePanel),
// canvas (GridCanvas), toolbar, menu e popover.
export default function ResultGrid({columns, rows, tabId, editContext, foreignKeys, readOnlyNotice, onCellSaved, onRowDeleted, onRowInserted, onStatus, onCopied, onNavigateForeignKey}: Props) {
    const {t} = useTranslation();
    const [gridSelection, setGridSelection] = useState<GridSelection | undefined>(undefined);
    const [menu, setMenu] = useState<MenuState | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const gridRef = useRef<DataEditorRef | null>(null);

    const {
        pendingInserts,
        setPendingInserts,
        pendingDeleteRows,
        pkIndexes,
        reviewOpen,
        executingBatch,
        batchError,
        addPendingInsert,
        togglePendingDelete,
        discardPendingChanges: discardBatch,
        openReview,
        closeReview,
        reviewStatements,
        executePendingBatch,
    } = usePendingBatch({editContext, tabId, rows, columns, onRowDeleted, onRowInserted, onStatus});

    const {rowHasPkValues, isCellEditable} = useEditability(editContext, columns, rows, pendingDeleteRows);

    const {filterText, setFilterText, filteredIndices, rowCount, displayRowCount, toOriginalRow} = useGridFilter(
        rows,
        pendingInserts.length,
        gridSelection,
        setGridSelection,
    );

    const {
        pendingEdit,
        savingEdit,
        directEdit,
        setDirectEdit,
        handleCellClicked,
        commitDirectEdit,
        cancelDirectEdit,
        cancelPendingEdit,
        confirmPendingEdit,
    } = useCellEditing({
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
    });

    const {selectionTarget, handleCopyCell, handleCopyRow, handleCopySelection, handleCopyAs} = useGridCopy({
        gridSelection,
        rows,
        columns,
        pendingInserts,
        rowCount,
        toOriginalRow,
        onCopied,
    });

    const {valuePanelOpen, valuePanelResize, valuePanelCell, openValuePanel, closeValuePanel} = useValuePanel(
        gridSelection,
        columns,
        rows,
        rowCount,
        toOriginalRow,
        pendingInserts,
    );

    const pendingChangeCount = pendingInserts.length + pendingDeleteRows.size;

    // Descartar também fecha edição direta aberta (era parte do
    // discardPendingChanges original, que morava no mesmo componente).
    const discardPendingChanges = useCallback(() => {
        discardBatch();
        setDirectEdit(null);
    }, [discardBatch, setDirectEdit]);

    const closeMenu = useCallback(() => setMenu(null), []);

    // Move a seleção do grid pra célula clicada — o painel deriva o conteúdo
    // de gridSelection (valuePanelCell), então isso é o suficiente pra ele
    // mostrar o valor certo ao abrir.
    const handleViewValue = useCallback(() => {
        if (!menu) return;
        setGridSelection({
            current: {cell: [menu.col, menu.displayRow], range: {x: menu.col, y: menu.displayRow, width: 1, height: 1}, rangeStack: []},
            rows: CompactSelection.empty(),
            columns: CompactSelection.empty(),
        });
        openValuePanel();
        setMenu(null);
    }, [menu, openValuePanel]);

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

    const effectiveForeignKeys = foreignKeys ?? editContext?.foreignKeys ?? [];
    const menuColName = menu ? (columns[menu.col] ?? '') : '';
    const menuRowVal = menu && menu.row >= 0 && rows[menu.row] ? rows[menu.row][menu.col] : null;
    const menuFkRef = menuColName && menuRowVal !== null && menuRowVal !== undefined && menuRowVal !== ''
        ? findForeignKeyReference(effectiveForeignKeys, menuColName)
        : undefined;
    const menuFkTarget = menuFkRef && menuRowVal !== null && menuRowVal !== undefined && menuRowVal !== ''
        ? {
            targetSchema: menuFkRef.targetSchema,
            targetTable: menuFkRef.targetTable,
            targetColumn: menuFkRef.targetColumn,
            value: menuRowVal,
        }
        : null;

    return (
        <div className="result-container">
            <ResultGridToolbar
                filtered={filteredIndices !== null}
                rowCount={rowCount}
                totalRows={rows.length}
                columnsLength={columns.length}
                editContext={editContext}
                pendingChangeCount={pendingChangeCount}
                filterText={filterText}
                valuePanelOpen={valuePanelOpen}
                onFilterChange={setFilterText}
                onToggleValuePanel={() => (valuePanelOpen ? closeValuePanel() : openValuePanel())}
                onInsertRow={addPendingInsert}
                onReview={openReview}
                onDiscard={discardPendingChanges}
            />
            {readOnlyNotice && (
                <div className="result-readonly-notice" title={readOnlyNotice}>
                    {readOnlyNotice}
                </div>
            )}

            <div className="result-body">
            <GridCanvas
                columns={columns}
                rows={rows}
                rowCount={rowCount}
                displayRowCount={displayRowCount}
                pendingInserts={pendingInserts}
                pendingDeleteRows={pendingDeleteRows}
                isCellEditable={isCellEditable}
                toOriginalRow={toOriginalRow}
                gridSelection={gridSelection}
                onGridSelectionChange={setGridSelection}
                gridRef={gridRef}
                directEdit={directEdit}
                foreignKeys={effectiveForeignKeys}
                onNavigateForeignKey={onNavigateForeignKey}
                onDirectEditChange={value => setDirectEdit(prev => (prev ? {...prev, value} : prev))}
                onCommitDirectEdit={commitDirectEdit}
                onCancelDirectEdit={cancelDirectEdit}
                onCellClicked={handleCellClicked}
                onMenu={setMenu}
            >
            {menu && (
                <div ref={menuRef} className="grid-context-menu" style={menuStyle} role="menu">
                    <GridContextMenu
                        hasSelectionTarget={target !== null}
                        canCopyRow={menu.draftIndex === undefined && target === null}
                        showRemoveDraft={menu.draftIndex !== undefined}
                        showDelete={menu.draftIndex === undefined && target === null && !!editContext && rowHasPkValues(menu.row)}
                        deleteLabel={pendingDeleteRows.has(menu.row) ? t('resultGrid.unmarkDelete') : t('resultGrid.deleteRow')}
                        fkTarget={menuFkTarget}
                        onNavigateForeignKey={target => {
                            onNavigateForeignKey?.(target.targetSchema, target.targetTable, target.targetColumn, target.value);
                            closeMenu();
                        }}
                        onCopyCell={() => handleCopyCell(menu.col, menu.row, menu.draftIndex, closeMenu)}
                        onViewValue={handleViewValue}
                        onCopyRow={() => handleCopyRow(menu.row, closeMenu)}
                        onRemoveDraft={() => {
                            const idx = menu.draftIndex!;
                            setPendingInserts(prev => prev.filter((_, i) => i !== idx));
                            setMenu(null);
                        }}
                        onToggleDelete={() => {
                            togglePendingDelete(menu.row);
                            setMenu(null);
                        }}
                        onCopySelection={() => target && handleCopySelection(target, closeMenu)}
                        onCopyAs={format => handleCopyAs(format, targetHeader, targetMatrix, closeMenu)}
                    />
                </div>
            )}
            {pendingEdit && (
                <GridEditPopover
                    pendingEdit={pendingEdit}
                    savingEdit={savingEdit}
                    onConfirm={() => void confirmPendingEdit()}
                    onCancel={cancelPendingEdit}
                />
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
            </GridCanvas>
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
