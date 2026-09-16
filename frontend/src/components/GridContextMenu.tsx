// Menu de contexto do grid (copiar célula/linha/seleção, ver valor,
// marcar/desmarcar DELETE, copiar como CSV/SQL/Markdown).
// Extraído do ResultGrid sem mudança de comportamento.
import {useTranslation} from 'react-i18next';

export interface MenuState {
    x: number;
    y: number;
    col: number;
    // row (original, índice em `rows`) usado pra conteúdo (copiar célula/
    // linha/valor); displayRow (índice visual, pós-filtro) usado só pra
    // checar se o clique caiu dentro da seleção ativa do grid (gridSelection
    // é sempre em espaço visual — ver comentário em toOriginalRow).
    // draftIndex definido = clique numa linha de rascunho (INSERT pendente).
    row: number;
    displayRow: number;
    draftIndex?: number;
}

interface GridContextMenuProps {
    hasSelectionTarget: boolean;
    canCopyRow: boolean;
    showRemoveDraft: boolean;
    showDelete: boolean;
    deleteLabel: string;
    onCopyCell: () => void;
    onViewValue: () => void;
    onCopyRow: () => void;
    onRemoveDraft: () => void;
    onToggleDelete: () => void;
    onCopySelection: () => void;
    onCopyAs: (format: 'csv' | 'sql' | 'md') => void;
}

export default function GridContextMenu({
    hasSelectionTarget,
    canCopyRow,
    showRemoveDraft,
    showDelete,
    deleteLabel,
    onCopyCell,
    onViewValue,
    onCopyRow,
    onRemoveDraft,
    onToggleDelete,
    onCopySelection,
    onCopyAs,
}: GridContextMenuProps) {
    const {t} = useTranslation();
    return (
        <>
            <button className="grid-context-menu-item" onClick={onCopyCell}>
                {t('resultGrid.copyCell')}
            </button>
            <button className="grid-context-menu-item" onClick={onViewValue}>
                {t('resultGrid.viewValue')}
            </button>
            {canCopyRow && (
                <button className="grid-context-menu-item" onClick={onCopyRow}>
                    {t('resultGrid.copyRow')}
                </button>
            )}
            {showRemoveDraft && (
                <button
                    className="grid-context-menu-item grid-context-menu-item-danger"
                    onClick={onRemoveDraft}
                >
                    {t('resultGrid.removeDraftRow')}
                </button>
            )}
            {showDelete && (
                <button
                    className="grid-context-menu-item grid-context-menu-item-danger"
                    onClick={onToggleDelete}
                >
                    {deleteLabel}
                </button>
            )}
            {hasSelectionTarget && (
                <button className="grid-context-menu-item" onClick={onCopySelection}>
                    {t('resultGrid.copySelection')}
                </button>
            )}
            <div className="grid-context-menu-separator" />
            <div className="grid-context-menu-group-label">{t('resultGrid.copyAs')}</div>
            <button className="grid-context-menu-item" onClick={() => onCopyAs('csv')}>
                {t('resultGrid.csv')}
            </button>
            <button className="grid-context-menu-item" onClick={() => onCopyAs('sql')}>
                {t('resultGrid.insertSql')}
            </button>
            <button className="grid-context-menu-item" onClick={() => onCopyAs('md')}>
                {t('resultGrid.markdown')}
            </button>
        </>
    );
}
