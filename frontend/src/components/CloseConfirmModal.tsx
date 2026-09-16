// Modal de "SQL não salvo" ao fechar a aba de console.
// Extraído do ConsoleTab sem mudança de comportamento.
import {useTranslation} from 'react-i18next';

interface CloseConfirmModalProps {
    activeScriptId: string | null;
    activeScriptName: string;
    saveNameInput: string;
    closeSaving: boolean;
    onSaveNameChange: (name: string) => void;
    onCancel: () => void;
    onDiscard: () => void;
    onSaveAndClose: () => void;
}

export default function CloseConfirmModal({
    activeScriptId,
    activeScriptName,
    saveNameInput,
    closeSaving,
    onSaveNameChange,
    onCancel,
    onDiscard,
    onSaveAndClose,
}: CloseConfirmModalProps) {
    const {t} = useTranslation();
    return (
        <div className="modal-backdrop" onClick={onCancel}>
            <div className="modal-container" onClick={e => e.stopPropagation()} style={{maxWidth: 420}}>
                <div className="modal-header">
                    <div className="modal-title-group">
                        <h2 className="modal-title">{t('consoleTab.closeUnsavedTitle')}</h2>
                        <span className="modal-subtitle">{t('consoleTab.closeUnsavedSubtitle')}</span>
                    </div>
                    <button className="modal-close-btn" onClick={onCancel} title={t('consoleTab.cancel')}>✕</button>
                </div>
                <div className="modal-body">
                    {!activeScriptId && (
                        <input
                            className="input-control"
                            autoFocus
                            placeholder={t('consoleTab.scriptNamePlaceholder')}
                            value={saveNameInput}
                            onChange={e => onSaveNameChange(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && saveNameInput.trim()) onSaveAndClose();
                            }}
                        />
                    )}
                    <div className="modal-actions" style={{marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end'}}>
                        <button className="btn btn-secondary" onClick={onCancel}>
                            {t('consoleTab.cancel')}
                        </button>
                        <button className="btn btn-secondary" onClick={onDiscard}>
                            {t('consoleTab.closeWithoutSaving')}
                        </button>
                        <button
                            className="btn btn-success"
                            onClick={onSaveAndClose}
                            disabled={closeSaving || (!activeScriptId && !saveNameInput.trim())}
                            title={activeScriptId ? t('consoleTab.overwriteScriptTitle', {name: activeScriptName}) : t('consoleTab.saveAsNewCloseTitle')}
                        >
                            {activeScriptId ? t('consoleTab.saveAndCloseNamed', {name: activeScriptName}) : t('consoleTab.saveAndClose')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
