// Barra secundária do console: salvar script, painéis, formatar e
// auto-uppercase. Extraído do ConsoleTab sem mudança de comportamento.
import {useTranslation} from 'react-i18next';

interface ConsoleToolbarProps {
    showSaveForm: boolean;
    saveNameInput: string;
    savingScript: boolean;
    queryEmpty: boolean;
    activeScriptId: string | null;
    activeScriptName: string;
    showScripts: boolean;
    showHistory: boolean;
    autoUppercase: boolean;
    onSaveNameChange: (name: string) => void;
    onConfirmSaveNew: () => void;
    onCancelSaveForm: () => void;
    onSaveClick: () => void;
    onNewScript: () => void;
    onToggleScripts: () => void;
    onToggleHistory: () => void;
    onFormat: () => void;
    onAutoUppercaseChange: (next: boolean) => void;
}

export default function ConsoleToolbar({
    showSaveForm,
    saveNameInput,
    savingScript,
    queryEmpty,
    activeScriptId,
    activeScriptName,
    showScripts,
    showHistory,
    autoUppercase,
    onSaveNameChange,
    onConfirmSaveNew,
    onCancelSaveForm,
    onSaveClick,
    onNewScript,
    onToggleScripts,
    onToggleHistory,
    onFormat,
    onAutoUppercaseChange,
}: ConsoleToolbarProps) {
    const {t} = useTranslation();
    return (
        <div className="toolbar-secondary">
            {showSaveForm ? (
                <span className="script-save-form">
                    <input
                        className="input-control"
                        autoFocus
                        placeholder={t('consoleTab.scriptNamePlaceholder')}
                        value={saveNameInput}
                        onChange={e => onSaveNameChange(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') onConfirmSaveNew();
                            if (e.key === 'Escape') onCancelSaveForm();
                        }}
                    />
                    <button className="btn btn-success" onClick={onConfirmSaveNew} disabled={savingScript || !saveNameInput.trim()}>
                        {t('consoleTab.confirm')}
                    </button>
                    <button className="btn btn-secondary" onClick={onCancelSaveForm}>
                        {t('consoleTab.cancel')}
                    </button>
                </span>
            ) : (
                <button
                    className="btn btn-secondary"
                    onClick={onSaveClick}
                    disabled={savingScript || queryEmpty}
                    title={activeScriptId ? t('consoleTab.overwriteScriptTitle', {name: activeScriptName}) : t('consoleTab.saveAsNewTitle')}
                >
                    {activeScriptId ? t('consoleTab.saveScriptNamed', {name: activeScriptName}) : t('consoleTab.saveScript')}
                </button>
            )}
            {activeScriptId && (
                <button className="btn btn-secondary" onClick={onNewScript} title={t('consoleTab.newScriptTitle')}>
                    {t('consoleTab.new')}
                </button>
            )}
            <button
                className={`btn btn-secondary ${showScripts ? 'active' : ''}`}
                onClick={onToggleScripts}
                title={t('consoleTab.scriptsToggleTitle')}
            >
                {t('consoleTab.scripts')}
            </button>
            <button
                className={`btn btn-secondary ${showHistory ? 'active' : ''}`}
                onClick={onToggleHistory}
                title={t('consoleTab.historyToggleTitle')}
            >
                {t('consoleTab.history')}
            </button>
            <button
                className="btn btn-secondary"
                onClick={onFormat}
                disabled={queryEmpty}
                title={t('consoleTab.formatTitle')}
            >
                {t('consoleTab.format')}
            </button>
            <label className="auto-uppercase-toggle" title={t('consoleTab.autoUppercaseTitle')}>
                <input
                    type="checkbox"
                    checked={autoUppercase}
                    onChange={e => onAutoUppercaseChange(e.target.checked)}
                />
                {t('consoleTab.autoUppercase')}
            </label>
        </div>
    );
}
