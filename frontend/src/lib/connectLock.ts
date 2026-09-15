// Serializa a sequência de conexão (ConnectSaved + setup inicial) por tabId.
//
// Necessário porque o React StrictMode (modo dev) monta/desmonta/remonta um
// efeito rapidamente — sem este lock, as duas montagens chamam ConnectSaved
// com o MESMO tabId quase ao mesmo tempo, e o backend (Manager.Open, ver
// internal/session) cancela a sessão existente a cada reconexão por tabId.
// Se a chamada da 1ª montagem (já obsoleta) terminar DEPOIS da 2ª, ela cancela
// a sessão que a 2ª montagem já está usando — "context canceled" na primeira
// query. Forçar as duas a rodar em sequência (nunca concorrentes) elimina a
// corrida: a 1ª sempre termina (e se desconecta, se obsoleta) antes da 2ª
// começar. Módulo compartilhado entre TableTab.tsx e SchemaTab.tsx (mesmo
// padrão de conexão própria por aba nos dois).
const locks = new Map<string, Promise<void>>();

export async function withConnectLock<T>(tabId: string, fn: () => Promise<T>): Promise<T> {
    const prior = locks.get(tabId) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>(resolve => {
        release = resolve;
    });
    locks.set(tabId, prior.then(() => mine));
    await prior;
    try {
        return await fn();
    } finally {
        release();
    }
}
