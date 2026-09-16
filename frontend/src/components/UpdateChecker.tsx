import {useState} from 'react';
import {CheckForUpdate, OpenReleaseURL} from '../../wailsjs/go/main/App';

// Verificador de atualização (Phase 3, item 5 do docs/ROADMAP.md): só
// checagem manual sob pedido do usuário — nunca automática no startup (o
// app não deve depender de rede pra abrir), nunca baixa/substitui o binário
// sozinho (Wails não tem updater nativo, diferente do autoUpdater do
// Electron/updater do Tauri). Consulta a API pública do GitHub
// (CheckForUpdate, app.go) — sem credencial nenhuma envolvida.
export default function UpdateChecker() {
    const [checking, setChecking] = useState(false);
    const [result, setResult] = useState<{hasUpdate: boolean; latest: string; url: string} | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function handleCheck() {
        setChecking(true);
        setError(null);
        setResult(null);
        try {
            const info = await CheckForUpdate();
            setResult({hasUpdate: info.HasUpdate, latest: info.LatestVersion, url: info.HTMLURL});
        } catch (err) {
            setError(String(err));
        } finally {
            setChecking(false);
        }
    }

    return (
        <div className="update-checker">
            <button className="update-check-btn" onClick={handleCheck} disabled={checking} title="Consulta a API pública do GitHub — não baixa nem instala nada automaticamente.">
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
