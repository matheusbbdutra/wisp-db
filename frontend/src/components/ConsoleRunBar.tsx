// Barra de execução do console: Executar, nova aba, Explain, Cancelar,
// duração e tamanho do lote. Extraído do ConsoleTab sem mudança de
// comportamento.
import {useTranslation} from 'react-i18next';

interface ConsoleRunBarProps {
    connected: boolean;
    queryEmpty: boolean;
    anyRunning: boolean;
    durationMs: number | null;
    batchSizeInput: string;
    activeFetching: boolean;
    batchSize: number;
    onRun: () => void;
    onRunNewTab: () => void;
    onExplain: () => void;
    onCancel: () => void;
    onBatchSizeInput: (raw: string) => void;
    onBatchSizeBlur: () => void;
}

export default function ConsoleRunBar({
    connected,
    queryEmpty,
    anyRunning,
    durationMs,
    batchSizeInput,
    activeFetching,
    batchSize,
    onRun,
    onRunNewTab,
    onExplain,
    onCancel,
    onBatchSizeInput,
    onBatchSizeBlur,
}: ConsoleRunBarProps) {
    const {t} = useTranslation();
    return (
        <div className="editor-actions">
            <div className="editor-actions-left">
                <button className="btn btn-success" onClick={onRun} disabled={!connected} title={t('consoleTab.runTitle')}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    {t('consoleTab.run')}
                    <kbd className="kbd-shortcut">Ctrl+Enter</kbd>
                    <kbd className="kbd-shortcut" title={t('consoleTab.runSelectionTitle')}>Ctrl+Shift+Enter</kbd>
                </button>
                <button className="btn btn-secondary" onClick={onRunNewTab} disabled={!connected} title={t('consoleTab.runNewTabTitle')}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 5v14M5 12h14" />
                    </svg>
                    {t('consoleTab.newResultTab')}
                    <kbd className="kbd-shortcut">Ctrl+Alt+Enter</kbd>
                </button>
                <button
                    className="btn btn-secondary"
                    onClick={onExplain}
                    disabled={!connected || queryEmpty}
                    title={t('consoleTab.explainTitle')}
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4M9 3v6h6M9 3l11 11" />
                    </svg>
                    {t('consoleTab.explain')}
                </button>
                {anyRunning && (
                    <button className="btn btn-danger" onClick={onCancel} title={t('consoleTab.cancelQueryTitle')}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <rect x="4" y="4" width="16" height="16" rx="2" />
                        </svg>
                        {t('consoleTab.cancelQuery')}
                    </button>
                )}

                {durationMs != null && (
                    <span className="duration-badge" title={t('consoleTab.durationTitle')}>
                        {durationMs} ms
                    </span>
                )}
            </div>
            <div className="editor-actions-right">
                <label className="batch-size-field" title={t('consoleTab.batchSizeTitle')}>
                    {t('consoleTab.fetch')}
                    <input
                        type="number"
                        min={1}
                        max={1000000}
                        value={batchSizeInput}
                        onChange={e => onBatchSizeInput(e.target.value)}
                        onBlur={onBatchSizeBlur}
                        disabled={activeFetching}
                    />
                    {t('consoleTab.atATime')}
                </label>
            </div>
        </div>
    );
}
