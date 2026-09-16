// Persistência do "último script aberto" (localStorage, mesmo padrão de
// AUTO_UPPERCASE_STORAGE_KEY/wisp:sidebarWidth) — usada só pela aba de
// console inicial da sessão pra recarregar sozinha o script que o usuário
// tinha aberto da última vez que fechou o app, em vez de sempre começar
// em branco. Extraído do ConsoleTab sem mudança de comportamento.
const LAST_SCRIPT_STORAGE_KEY = 'wisp:lastOpenScript';

export function rememberLastScript(id: string, name: string) {
    try {
        localStorage.setItem(LAST_SCRIPT_STORAGE_KEY, JSON.stringify({id, name}));
    } catch {
        // localStorage indisponível — sem persistência, sem crash.
    }
}

export function forgetLastScript() {
    try {
        localStorage.removeItem(LAST_SCRIPT_STORAGE_KEY);
    } catch {
        // idem
    }
}

export function readLastScript(): {id: string; name: string} | null {
    try {
        const raw = localStorage.getItem(LAST_SCRIPT_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (typeof parsed?.id === 'string' && typeof parsed?.name === 'string') return parsed;
        return null;
    } catch {
        return null;
    }
}
