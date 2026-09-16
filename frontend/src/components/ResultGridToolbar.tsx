// Toolbar do grid de resultados: estatísticas, filtro rápido e ações de
// staging. Extraído do ResultGrid sem mudança de comportamento.
import {useTranslation} from 'react-i18next';
import type {EditContext} from './ResultGrid';

interface ResultGridToolbarProps {
    filtered: boolean;
    rowCount: number;
    totalRows: number;
    columnsLength: number;
    editContext?: EditContext | null;
    pendingChangeCount: number;
    filterText: string;
    valuePanelOpen: boolean;
    onFilterChange: (text: string) => void;
    onToggleValuePanel: () => void;
    onInsertRow: () => void;
    onReview: () => void;
    onDiscard: () => void;
}

export default function ResultGridToolbar({
    filtered,
    rowCount,
    totalRows,
    columnsLength,
    editContext,
    pendingChangeCount,
    filterText,
    valuePanelOpen,
    onFilterChange,
    onToggleValuePanel,
    onInsertRow,
    onReview,
    onDiscard,
}: ResultGridToolbarProps) {
    const {t} = useTranslation();
    return (
        <div className="result-toolbar">
            <div className="result-stats">
                <span>{t('resultGrid.results')}</span>
                <span className="result-stat-badge">
                    {filtered
                        ? t('resultGrid.rowFiltered', {count: rowCount, shown: rowCount, total: totalRows})
                        : t('resultGrid.row', {count: totalRows})}
                </span>
                <span className="result-stat-badge">{t('resultGrid.column', {count: columnsLength})}</span>
                {editContext && (
                    <span className="result-stat-badge result-editable-badge" title={t('resultGrid.editableTitle', {pks: editContext.pkColumns.join(', ')})}>
                        {t('resultGrid.editable')}
                    </span>
                )}
            </div>
            <input
                className="result-filter-input"
                type="text"
                placeholder={t('resultGrid.filterPlaceholder')}
                value={filterText}
                onChange={e => onFilterChange(e.target.value)}
                title={t('resultGrid.filterTitle')}
            />
            <button
                className={`btn btn-secondary ${valuePanelOpen ? 'active' : ''}`}
                onClick={onToggleValuePanel}
                title={t('resultGrid.valueToggleTitle')}
            >
                {t('resultGrid.value')}
            </button>
            {editContext && (
                <button className="btn btn-secondary" onClick={onInsertRow} title={t('resultGrid.insertRowTitle')}>
                    {t('resultGrid.insertRow')}
                </button>
            )}
            {editContext && pendingChangeCount > 0 && (
                <>
                    <button className="btn btn-secondary" onClick={onReview}>
                        {t('resultGrid.reviewChanges', {count: pendingChangeCount})}
                    </button>
                    <button className="btn btn-secondary" onClick={onDiscard} title={t('resultGrid.discardChanges')}>
                        {t('resultGrid.discardChanges')}
                    </button>
                </>
            )}
        </div>
    );
}
