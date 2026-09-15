// Serializa uma sequência de chamadas assíncronas por chave. Duas chaves
// distintas usam esta fila hoje, de propósito nunca a mesma dentro de uma
// mesma sequência (ver TableTab.tsx/SchemaTab.tsx pra por quê misturar
// causaria deadlock):
// - `tabId` puro: TODOS os bindings Go escopados por aba, via lib/tabApi.ts
//   — garante que nenhuma aba tenha duas chamadas ao backend em voo ao
//   mesmo tempo (a conexão da aba não suporta uso concorrente).
// - `${tabId}:mount`: só em TableTab.tsx/SchemaTab.tsx, serializa a
//   sequência "conectar → sou a montagem válida?" entre duas montagens do
//   StrictMode (dev) pro mesmo tabId.
const queues = new Map<string, Promise<void>>();

export async function withQueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prior = queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>(resolve => {
        release = resolve;
    });
    queues.set(key, prior.then(() => mine));
    await prior;
    try {
        return await fn();
    } finally {
        release();
    }
}
