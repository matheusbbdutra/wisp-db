import {useState, useEffect, useId} from 'react';
import {useTranslation} from 'react-i18next';
import {CancelQuery} from '../../wailsjs/go/main/App';
import {PickExportFile, ExportToFile} from '../lib/tabApi';

export interface ExportModalProps {
    isOpen: boolean;
    onClose: () => void;
    tabId: string;
    query?: string;
    schema?: string;
    table?: string;
    defaultFormat?: 'csv' | 'json' | 'sql';
}

function formatBytes(bytes: number): string {
    if (bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export default function ExportModal({
    isOpen,
    onClose,
    tabId,
    query = '',
    schema = '',
    table = '',
    defaultFormat = 'csv',
}: ExportModalProps) {
    const {t} = useTranslation();
    const hasQuery = Boolean(query.trim());
    const hasTable = Boolean(table.trim());

    const [format, setFormat] = useState<'csv' | 'json' | 'sql'>(defaultFormat);
    const [scope, setScope] = useState<'query' | 'table'>(hasTable && !hasQuery ? 'table' : 'query');
    const [filePath, setFilePath] = useState<string>('');
    const [isExporting, setIsExporting] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<{totalRows: number; durationMs: number; fileSizeBytes: number} | null>(null);

    const formatId = useId();
    const scopeId = useId();
    const fileId = useId();

    useEffect(() => {
        if (!isOpen) return;
        setFormat(defaultFormat);
        setScope(hasTable && !hasQuery ? 'table' : 'query');
        setFilePath('');
        setIsExporting(false);
        setError(null);
        setResult(null);
    }, [isOpen, defaultFormat, hasTable, hasQuery]);

    useEffect(() => {
        if (!isOpen) return;
        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape' && !isExporting) {
                onClose();
            }
        }
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, isExporting, onClose]);

    if (!isOpen) return null;

    const suggestedBaseName = scope === 'table' && table ? table : 'export_data';

    async function handleBrowse() {
        try {
            setError(null);
            const path = await PickExportFile(suggestedBaseName, format);
            if (path) {
                setFilePath(path);
            }
        } catch (err: any) {
            setError(err?.message || String(err));
        }
    }

    async function handleStartExport() {
        if (!filePath.trim()) {
            setError(t('exportModal.errorNoPath'));
            return;
        }

        setIsExporting(true);
        setError(null);
        setResult(null);

        try {
            const res = await ExportToFile({
                tabId,
                query: scope === 'query' ? query : '',
                schema: scope === 'table' ? schema : '',
                table: scope === 'table' ? table : '',
                filePath: filePath.trim(),
                format,
                batchSize: 1000,
            });
            setResult({
                totalRows: res.totalRows,
                durationMs: res.durationMs,
                fileSizeBytes: res.fileSizeBytes,
            });
        } catch (err: any) {
            setError(err?.message || String(err));
        } finally {
            setIsExporting(false);
        }
    }

    async function handleCancelExport() {
        try {
            await CancelQuery(tabId);
        } catch {
            // Best effort cancel
        }
        setIsExporting(false);
    }

    return (
        <div className="modal-backdrop" onClick={!isExporting ? onClose : undefined}>
            <div className="modal-container export-modal-container" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <div className="modal-title-group">
                        <h2 className="modal-title">{t('exportModal.title')}</h2>
                        <span className="modal-subtitle">{t('exportModal.subtitle')}</span>
                    </div>
                    {!isExporting && (
                        <button className="modal-close-btn" onClick={onClose} aria-label={t('exportModal.close')}>
                            ✕
                        </button>
                    )}
                </div>

                <div className="modal-body export-modal-body">
                    {error && (
                        <div className="modal-error-banner" role="alert">
                            {error}
                        </div>
                    )}

                    {result ? (
                        <div className="export-success-container">
                            <div className="export-success-icon">✓</div>
                            <h3>{t('exportModal.successTitle')}</h3>
                            <div className="export-stats-grid">
                                <div className="export-stat-card">
                                    <span className="export-stat-label">{t('exportModal.totalRows')}</span>
                                    <span className="export-stat-value">{result.totalRows.toLocaleString()}</span>
                                </div>
                                <div className="export-stat-card">
                                    <span className="export-stat-label">{t('exportModal.fileSize')}</span>
                                    <span className="export-stat-value">{formatBytes(result.fileSizeBytes)}</span>
                                </div>
                                <div className="export-stat-card">
                                    <span className="export-stat-label">{t('exportModal.duration')}</span>
                                    <span className="export-stat-value">{result.durationMs} ms</span>
                                </div>
                            </div>
                            <p className="export-file-path-hint">{filePath}</p>
                        </div>
                    ) : (
                        <>
                            {hasQuery && hasTable && (
                                <div className="form-group">
                                    <label htmlFor={scopeId} className="form-label">{t('exportModal.scopeLabel')}</label>
                                    <div className="export-scope-selector">
                                        <label className={`export-radio-btn ${scope === 'query' ? 'active' : ''}`}>
                                            <input
                                                id={scopeId}
                                                type="radio"
                                                name="exportScope"
                                                value="query"
                                                checked={scope === 'query'}
                                                onChange={() => setScope('query')}
                                                disabled={isExporting}
                                            />
                                            {t('exportModal.scopeCurrentQuery')}
                                        </label>
                                        <label className={`export-radio-btn ${scope === 'table' ? 'active' : ''}`}>
                                            <input
                                                type="radio"
                                                name="exportScope"
                                                value="table"
                                                checked={scope === 'table'}
                                                onChange={() => setScope('table')}
                                                disabled={isExporting}
                                            />
                                            {t('exportModal.scopeEntireTable', {table})}
                                        </label>
                                    </div>
                                </div>
                            )}

                            <div className="form-group">
                                <label htmlFor={formatId} className="form-label">{t('exportModal.formatLabel')}</label>
                                <div className="export-format-selector">
                                    {(['csv', 'json', 'sql'] as const).map(fmt => (
                                        <button
                                            key={fmt}
                                            type="button"
                                            className={`export-format-pill ${format === fmt ? 'active' : ''}`}
                                            onClick={() => {
                                                setFormat(fmt);
                                                if (filePath) {
                                                    const dotIdx = filePath.lastIndexOf('.');
                                                    if (dotIdx > 0) {
                                                        setFilePath(filePath.substring(0, dotIdx) + '.' + fmt);
                                                    }
                                                }
                                            }}
                                            disabled={isExporting}
                                        >
                                            {fmt.toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="form-group">
                                <label htmlFor={fileId} className="form-label">{t('exportModal.destinationLabel')}</label>
                                <div className="export-path-row">
                                    <input
                                        id={fileId}
                                        type="text"
                                        className="form-input export-path-input"
                                        placeholder={t('exportModal.destinationPlaceholder')}
                                        value={filePath}
                                        onChange={e => setFilePath(e.target.value)}
                                        disabled={isExporting}
                                    />
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={handleBrowse}
                                        disabled={isExporting}
                                    >
                                        {t('exportModal.browse')}
                                    </button>
                                </div>
                            </div>

                            {isExporting && (
                                <div className="export-progress-container">
                                    <div className="export-spinner" />
                                    <span>{t('exportModal.exporting')}</span>
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div className="modal-footer">
                    {result ? (
                        <button type="button" className="btn btn-primary" onClick={onClose}>
                            {t('exportModal.close')}
                        </button>
                    ) : isExporting ? (
                        <button type="button" className="btn btn-danger" onClick={handleCancelExport}>
                            {t('exportModal.cancel')}
                        </button>
                    ) : (
                        <>
                            <button type="button" className="btn btn-secondary" onClick={onClose}>
                                {t('exportModal.cancel')}
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={handleStartExport}
                                disabled={!filePath.trim()}
                            >
                                {t('exportModal.exportButton')}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
