import {useEffect, useState} from 'react';
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
            <button className="update-check-btn" onClick={() => handleCheck()} disabled={checking} title="Consulta a API pública do GitHub — não baixa nem instala nada automaticamente.">
                {checking ? 'Verificando…' : 'Verificar atualização'}
            </button>
            {result && (
                <div className={`update-result ${result.hasUpdate ? 'update-available' : ''}`}>
                    {result.hasUpdate ? (
                        <>
                            Nova versão disponível: {result.latest}.{' '}
                            <button className="update-link" onClick={() => OpenReleaseURL(result.url)}>Ver release</button>
                        </>
                    ) : (
                        'Você já está na versão mais recente.'
                    )}
                    <button className="update-dismiss" onClick={() => setResult(null)} title="Fechar">✕</button>
                </div>
            )}
            {error && (
                <div className="update-result">
                    Não foi possível verificar agora ({error}).
                    <button className="update-dismiss" onClick={() => setError(null)} title="Fechar">✕</button>
                </div>
            )}
        </div>
    );
}
