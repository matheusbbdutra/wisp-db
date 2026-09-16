import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {CheckForUpdate, OpenReleaseURL} from '../../wailsjs/go/main/App';

// Verificador de atualização (Phase 3, item 5 do docs/ROADMAP.md): nunca
// baixa/substitui o binário sozinho (Wails não tem updater nativo, diferente
// do autoUpdater do Electron/updater do Tauri) — só aviso, sempre.
//
// Checagem automática E assíncrona ao montar (uma vez por sessão do app):
// não bloqueia a abertura do app (dispara em segundo plano, sem tela de
// carregamento nem atraso perceptível) e fica SILENCIOSA quando não há
// atualização ou a rede falha — só aparece um aviso quando existe mesmo uma
// versão nova (nunca um popup de "você já está atualizado" toda vez que o
// app abre, isso seria ruído). O botão manual continua existindo e sempre
// mostra o resultado, incluindo "já está atualizado" — é a única forma de
// confirmar que a checagem rodou.
export default function UpdateChecker() {
    const {t} = useTranslation();
    const [checking, setChecking] = useState(false);
    const [result, setResult] = useState<{hasUpdate: boolean; latest: string; url: string} | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function handleCheck(silent = false) {
        if (!silent) {
            setChecking(true);
            setError(null);
            setResult(null);
        }
        try {
            const info = await CheckForUpdate();
            if (silent && !info.HasUpdate) return; // silencioso: nada a mostrar
            setResult({hasUpdate: info.HasUpdate, latest: info.LatestVersion, url: info.HTMLURL});
        } catch (err) {
            if (!silent) setError(String(err));
            // silencioso: falha de rede no startup não deve incomodar ninguém
        } finally {
            if (!silent) setChecking(false);
        }
    }

    useEffect(() => {
        void handleCheck(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="update-checker">
            <button className="update-check-btn" onClick={() => handleCheck()} disabled={checking} title={t('updateChecker.checkTitle')}>
                {checking ? t('updateChecker.checking') : t('updateChecker.check')}
            </button>
            {result && (
                <div className={`update-result ${result.hasUpdate ? 'update-available' : ''}`}>
                    {result.hasUpdate ? (
                        <>
                            {t('updateChecker.available', {latest: result.latest})}{' '}
                            <button className="update-link" onClick={() => OpenReleaseURL(result.url)}>{t('updateChecker.viewRelease')}</button>
                        </>
                    ) : (
                        t('updateChecker.upToDate')
                    )}
                    <button className="update-dismiss" onClick={() => setResult(null)} title={t('updateChecker.closeTitle')}>✕</button>
                </div>
            )}
            {error && (
                <div className="update-result">
                    {t('updateChecker.error', {error})}
                    <button className="update-dismiss" onClick={() => setError(null)} title={t('updateChecker.closeTitle')}>✕</button>
                </div>
            )}
        </div>
    );
}
