// Popover de confirmação do UPDATE (ADR 0004: nunca commitar silencioso).
// Extraído do ResultGrid sem mudança de comportamento.
import {useTranslation} from 'react-i18next';
import {displayValue} from '../lib/gridCopyFormats';
import type {PendingEdit} from '../lib/useCellEditing';

interface GridEditPopoverProps {
    pendingEdit: PendingEdit;
    savingEdit: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export default function GridEditPopover({pendingEdit, savingEdit, onConfirm, onCancel}: GridEditPopoverProps) {
    const {t} = useTranslation();
    return (
        <div className="grid-edit-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
            <div className="grid-edit-popover" role="dialog" aria-label={t('resultGrid.confirmUpdateAria')}>
                <div className="grid-context-menu-group-label">{t('resultGrid.confirmUpdate')}</div>
                <div className="grid-edit-field">
                    <span className="grid-edit-label">{t('resultGrid.cell')}</span>
                    <span className="grid-edit-value">{t('resultGrid.cellLine', {column: pendingEdit.columnName, row: pendingEdit.row + 1})}</span>
                </div>
                <div className="grid-edit-field">
                    <span className="grid-edit-label">{t('resultGrid.from')}</span>
                    <span className="grid-edit-value">{displayValue(pendingEdit.oldValue)}</span>
                </div>
                <div className="grid-edit-field">
                    <span className="grid-edit-label">{t('resultGrid.to')}</span>
                    <span className="grid-edit-value">{displayValue(pendingEdit.newValue)}</span>
                </div>
                <code className="grid-edit-preview">{pendingEdit.preview}</code>
                <div className="grid-edit-actions">
                    <button className="btn btn-success" onClick={onConfirm} disabled={savingEdit}>
                        {savingEdit ? t('resultGrid.saving') : t('resultGrid.confirm')}
                    </button>
                    <button className="btn btn-secondary" onClick={onCancel} disabled={savingEdit}>
                        {t('resultGrid.cancel')}
                    </button>
                </div>
            </div>
        </div>
    );
}
