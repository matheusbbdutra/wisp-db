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
    onExportClick?: () => void;
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
    onExportClick,
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
            {onExportClick && (
                <button
                    className="btn btn-secondary"
                    onClick={onExportClick}
                    title={t('exportModal.toolbarTitle')}
                >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: 4, verticalAlign: 'text-bottom'}}>
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    {t('exportModal.toolbarButton')}
                </button>
            )}
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
