// Ciclo de vida dos scripts nomeados do console (salvar/sobrescrever/novo)
// + modal de "SQL não salvo" ao fechar a aba. Extraído do ConsoleTab sem
// mudança de comportamento.
import {useCallback, useRef, useState} from 'react';
import {SaveScript, UpdateScript, ListScripts} from '../../wailsjs/go/main/App';
import {forgetLastScript, readLastScript, rememberLastScript} from './lastScript';

interface UseScriptStateArgs {
    restoreLastScriptOnMount?: boolean;
}

export function useScriptState({restoreLastScriptOnMount}: UseScriptStateArgs) {
    const [activeScriptId, setActiveScriptId] = useState<string | null>(null);
    const [activeScriptName, setActiveScriptName] = useState('');
    const [scriptsToken, setScriptsToken] = useState(0);
    const [showSaveForm, setShowSaveForm] = useState(false);
    const [saveNameInput, setSaveNameInput] = useState('');
    const [savingScript, setSavingScript] = useState(false);
    // Conteúdo do editor no momento do último save bem-sucedido (ou '' antes
    // de qualquer save) — "sujo" (não salvo) é query !== lastSavedQuery,
    // usado por requestCloseConfirm pra perguntar antes de fechar a aba com
    // SQL não salvo, em vez de descartar silenciosamente.
    const lastSavedQueryRef = useRef('');
    // Promise pendente do requestCloseConfirm enquanto o modal de "fechar sem
    // salvar?" está aberto — resolvida por qualquer um dos 3 botões do modal.
    const [closeConfirm, setCloseConfirm] = useState<{resolve: (proceed: boolean) => void} | null>(null);
    const [closeSaveNameInput, setCloseSaveNameInput] = useState('');
    const [closeSaving, setCloseSaving] = useState(false);

    function handleSelectScript(id: string, name: string, queryText: string, setQuery: (q: string) => void) {
        setActiveScriptId(id);
        setActiveScriptName(name);
        setQuery(queryText);
        lastSavedQueryRef.current = queryText;
        rememberLastScript(id, name);
    }

    // Sem script ativo, "Salvar" abre um campo de nome inline (novo script).
    // Com script ativo, sobrescreve o mesmo script direto — mesmo
    // comportamento de "salvar" de um editor de arquivos comum.
    async function handleSaveClick(query: string) {
        if (activeScriptId) {
            setSavingScript(true);
            try {
                await UpdateScript(activeScriptId, activeScriptName, query);
                lastSavedQueryRef.current = query;
                setScriptsToken(n => n + 1);
            } finally {
                setSavingScript(false);
            }
            return;
        }
        setSaveNameInput('');
        setShowSaveForm(true);
    }

    async function handleConfirmSaveNew(query: string) {
        const name = saveNameInput.trim();
        if (!name) {
            return;
        }
        setSavingScript(true);
        try {
            const id = await SaveScript(name, query);
            setActiveScriptId(id);
            setActiveScriptName(name);
            lastSavedQueryRef.current = query;
            rememberLastScript(id, name);
            setShowSaveForm(false);
            setScriptsToken(n => n + 1);
        } finally {
            setSavingScript(false);
        }
    }

    function handleNewScript() {
        setActiveScriptId(null);
        setActiveScriptName('');
        setShowSaveForm(false);
        lastSavedQueryRef.current = '';
        forgetLastScript();
    }

    // Fecha o modal de "SQL não salvo" e resolve a Promise que
    // requestCloseConfirm devolveu pra App.tsx — proceed=true libera o
    // fechamento da aba.
    function resolveCloseConfirm(proceed: boolean) {
        closeConfirm?.resolve(proceed);
        setCloseConfirm(null);
        setCloseSaveNameInput('');
    }

    // "Salvar e fechar": sobrescreve o script ativo, ou — sem script ativo —
    // salva um novo com o nome digitado no próprio modal (mescla o fluxo de
    // handleConfirmSaveNew aqui pra não precisar encadear dois diálogos).
    async function handleCloseSaveAndClose(query: string) {
        setCloseSaving(true);
        try {
            if (activeScriptId) {
                await UpdateScript(activeScriptId, activeScriptName, query);
            } else {
                const name = closeSaveNameInput.trim();
                if (!name) return;
                await SaveScript(name, query);
                setScriptsToken(n => n + 1);
            }
            lastSavedQueryRef.current = query;
            resolveCloseConfirm(true);
        } finally {
            setCloseSaving(false);
        }
    }

    // Resolve true se pode fechar (nada pra salvar, ou o usuário decidiu
    // salvar/descartar), false se o usuário cancelou o fechamento.
    const requestCloseConfirm = useCallback((query: string): Promise<boolean> => {
        const dirty = query.trim() !== '' && query !== lastSavedQueryRef.current;
        if (!dirty) return Promise.resolve(true);
        return new Promise<boolean>(resolve => {
            setCloseSaveNameInput('');
            setCloseConfirm({resolve});
        });
    }, []);

    // Recarrega o último script aberto só na aba de console inicial da
    // sessão — nunca sobrescreve texto que o usuário já tenha digitado nesta
    // aba antes deste efeito rodar (guarda `query === ''`, ainda que na
    // prática essa aba comece sempre vazia). Script apagado/renomeado fora
    // do Wisp entre sessões — falha silenciosa, cai pra aba em branco.
    // Retorna o cleanup pro useEffect do chamador.
    function restoreLastScript(
        setQuery: (q: string) => void,
        getQuery: () => string,
    ): () => void {
        if (!restoreLastScriptOnMount) return () => {};
        const last = readLastScript();
        if (!last) return () => {};
        let cancelled = false;
        ListScripts()
            .then(scripts => {
                if (cancelled) return;
                const found = (scripts ?? []).find(s => s.ID === last.id);
                if (!found || getQuery() !== '') return;
                setActiveScriptId(found.ID);
                setActiveScriptName(found.Name);
                setQuery(found.QueryText);
                lastSavedQueryRef.current = found.QueryText;
            })
            .catch(() => {
                // Sem sorte restaurando — segue com a aba em branco normal.
            });
        return () => {
            cancelled = true;
        };
    }

    return {
        activeScriptId,
        activeScriptName,
        scriptsToken,
        showSaveForm,
        setShowSaveForm,
        saveNameInput,
        setSaveNameInput,
        savingScript,
        closeConfirm,
        closeSaveNameInput,
        setCloseSaveNameInput,
        closeSaving,
        handleSelectScript,
        handleSaveClick,
        handleConfirmSaveNew,
        handleNewScript,
        resolveCloseConfirm,
        handleCloseSaveAndClose,
        requestCloseConfirm,
        restoreLastScript,
    };
}
