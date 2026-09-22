import {useState, useRef, useEffect} from 'react';
import {useTranslation} from 'react-i18next';
import './App.css';
import {Disconnect, ConfirmQuit} from '../wailsjs/go/main/App';
import {EventsOn} from '../wailsjs/runtime/runtime';
import ConsoleTab, {type ConsoleTabHandle} from './components/ConsoleTab';
import TableTab from './components/TableTab';
import SchemaTab from './components/SchemaTab';
import RoutineTab from './components/RoutineTab';
import UpdateChecker from './components/UpdateChecker';
import LanguageSwitcher from './components/LanguageSwitcher';
import i18n from './i18n';

interface ConsoleTabState {
    kind: 'console';
    id: string;
    title: string;
    connected: boolean;
}

interface TableTabState {
    kind: 'table';
    id: string;
    title: string;
    connected: boolean;
    connectionId: string;
    schema: string;
    table: string;
    initialFilter?: { column: string; value: any };
}

interface SchemaTabState {
    kind: 'schema';
    id: string;
    title: string;
    connected: boolean;
    connectionId: string;
    schema: string;
}

interface RoutineTabState {
    kind: 'routine';
    id: string;
    title: string;
    // Sem conexão própria (ver RoutineTab.tsx) — a definição já veio
    // completa de ListTriggers/ListFunctions, exibida verbatim aqui. Sempre
    // true (não há estado de conexão real pra essa aba).
    connected: boolean;
    routineKind: 'trigger' | 'function';
    name: string;
    definition: string;
}

type TabState = ConsoleTabState | TableTabState | SchemaTabState | RoutineTabState;

let tabCounter = 1;

function createTab(): ConsoleTabState {
    const n = tabCounter++;
    return {kind: 'console', id: `tab-${crypto.randomUUID()}`, title: i18n.t('app.consoleTitle', {n}), connected: false};
}

function App() {
    const {t} = useTranslation();
    const [tabs, setTabs] = useState<TabState[]>(() => [createTab()]);
    const [activeId, setActiveId] = useState(() => tabs[0].id);
    // Handles imperativos dos ConsoleTab vivos, pra handleCloseTab poder
    // perguntar "tem SQL não salvo?" antes de fechar (ver ConsoleTabHandle) —
    // só consoles têm essa checagem, TableTab/SchemaTab não têm editor livre.
    const consoleRefs = useRef(new Map<string, ConsoleTabHandle>());
    // Espelho de `tabs` pro listener de beforeClose (registrado uma vez só,
    // ver useEffect abaixo) — sem isso ele ficaria preso à lista de abas do
    // primeiro render (closure obsoleta).
    const tabsRef = useRef(tabs);
    tabsRef.current = tabs;
    // Id da aba de console criada no startup da sessão — só ELA recarrega o
    // último script aberto sozinha (ver ConsoleTab.restoreLastScriptOnMount);
    // abas novas via "+" continuam sempre em branco, de propósito.
    const initialTabIdRef = useRef(tabs[0].id);

    function handleAddTab() {
        const tab = createTab();
        setTabs(prev => [...prev, tab]);
        setActiveId(tab.id);
    }

    // Abre a tabela numa aba própria (irmã do Console): tabId novo com
    // conexão própria via ConnectSaved no mount do TableTab — nunca reusa
    // a sessão do console de origem (1 tabId = 1 conexão dedicada).
    function handleOpenTable(
        connectionId: string,
        schema: string,
        table: string,
        initialFilter?: { column: string; value: any }
    ) {
        const title = initialFilter ? `${table} (${initialFilter.column}=${initialFilter.value})` : table;
        const tab: TableTabState = {
            kind: 'table',
            id: `tab-${crypto.randomUUID()}`,
            title,
            connected: false,
            connectionId,
            schema,
            table,
            initialFilter,
        };
        setTabs(prev => [...prev, tab]);
        setActiveId(tab.id);
    }

    // Abre o schema numa aba própria listando suas tabelas — mesmo padrão:
    // tabId novo, conexão própria via ConnectSaved no mount do SchemaTab.
    function handleOpenSchema(connectionId: string, schema: string) {
        const tab: SchemaTabState = {
            kind: 'schema',
            id: `tab-${crypto.randomUUID()}`,
            title: schema,
            connected: false,
            connectionId,
            schema,
        };
        setTabs(prev => [...prev, tab]);
        setActiveId(tab.id);
    }

    // Abre a definição de um trigger/função numa aba própria de leitura —
    // sem tabId/conexão nova (ver RoutineTab.tsx), a definição já foi
    // buscada pela TableTab que chamou isso.
    function handleOpenRoutine(kind: 'trigger' | 'function', name: string, definition: string) {
        const tab: RoutineTabState = {
            kind: 'routine',
            id: `tab-${crypto.randomUUID()}`,
            title: name,
            connected: true,
            routineKind: kind,
            name,
            definition,
        };
        setTabs(prev => [...prev, tab]);
        setActiveId(tab.id);
    }

    function handleConnectedChange(tabId: string, connected: boolean) {
        setTabs(prev => prev.map(tab => (tab.id === tabId ? {...tab, connected} : tab)));
    }

    async function handleCloseTab(tabId: string) {
        if (tabs.length === 1) {
            return;
        }

        const tab = tabs.find(item => item.id === tabId);
        if (tab?.kind === 'console') {
            const handle = consoleRefs.current.get(tabId);
            if (handle) {
                const proceed = await handle.confirmClose();
                if (!proceed) return;
            }
        }

        try {
            await Disconnect(tabId);
        } catch {
            // Sessão já não existia (aba nunca conectou) — ignora.
        }

        setTabs(prev => {
            const remaining = prev.filter(item => item.id !== tabId);
            if (activeId === tabId && remaining.length > 0) {
                setActiveId(remaining[remaining.length - 1].id);
            }
            return remaining;
        });
    }

    // Fechar a JANELA (X do app, não uma aba) também pergunta por SQL não
    // salvo — Go sempre bloqueia o primeiro pedido (ver app.go beforeClose)
    // e emite este evento; aqui passamos por TODAS as abas de console (não
    // só a ativa) reaproveitando o mesmo confirmClose de handleCloseTab.
    // setActiveId torna a aba visível antes de perguntar (o modal de
    // confirmClose só renderiza na aba ativa, ver ConsoleTab.tsx). Qualquer
    // cancelamento aborta o fechamento inteiro — não fecha "as outras" e
    // deixa a cancelada pendurada.
    useEffect(() => {
        // SEM cleanup (não retorna a função de unsubscribe) — de propósito.
        // Causa raiz de um bug real: App é o componente raiz (vive pela
        // sessão inteira), mas o React.StrictMode (main.tsx) monta→desmonta
        // →remonta este efeito em dev. A desmontagem simulada chamaria
        // off(), que no runtime do Wails (events.js: listenerOff →
        // removeListener) avisa o Go "sem ouvintes pra esse evento"
        // (WailsInvoke('EX'+eventName)) assim que a contagem local cai a
        // zero — e o registro de listener do lado Go nunca é reavisado
        // quando o efeito remonta e registra de novo. Resultado: o Go ficava
        // permanentemente achando que não havia ouvinte ("No listeners for
        // event 'wisp:before-close'" no log), então EventsEmit nunca
        // chegava no frontend — a janela fechava sem perguntar nada.
        EventsOn('wisp:before-close', async () => {
            for (const tab of tabsRef.current) {
                if (tab.kind !== 'console') continue;
                const handle = consoleRefs.current.get(tab.id);
                if (!handle) continue;
                setActiveId(tab.id);
                const proceed = await handle.confirmClose();
                if (!proceed) return;
            }
            await ConfirmQuit();
        });
    }, []);

    return (
        <div id="App">
            <div className="tab-bar">
                {tabs.map(tab => (
                    <div
                        key={tab.id}
                        className={`tab-item ${tab.id === activeId ? 'active' : ''}`}
                        onClick={() => setActiveId(tab.id)}
                    >
                        <span className={`tab-dot ${tab.connected ? 'connected' : ''}`} />
                        <span className="tab-title">{tab.title}</span>
                        {tabs.length > 1 && (
                            <button
                                className="tab-close"
                                title={t('app.closeTab')}
                                onClick={e => {
                                    e.stopPropagation();
                                    handleCloseTab(tab.id);
                                }}
                            >
                                ×
                            </button>
                        )}
                    </div>
                ))}
                <button className="tab-add" title={t('app.newTab')} onClick={handleAddTab}>
                    +
                </button>
                <UpdateChecker />
                <LanguageSwitcher />
            </div>

            {tabs.map(tab => (
                tab.kind === 'console' ? (
                    <ConsoleTab
                        key={tab.id}
                        ref={el => {
                            if (el) consoleRefs.current.set(tab.id, el);
                            else consoleRefs.current.delete(tab.id);
                        }}
                        tabId={tab.id}
                        hidden={tab.id !== activeId}
                        onConnectedChange={connected => handleConnectedChange(tab.id, connected)}
                        onOpenTable={handleOpenTable}
                        onOpenSchema={(connectionId, schema) => handleOpenSchema(connectionId, schema)}
                        restoreLastScriptOnMount={tab.id === initialTabIdRef.current}
                    />
                ) : tab.kind === 'table' ? (
                    <TableTab
                        key={tab.id}
                        tabId={tab.id}
                        connectionId={tab.connectionId}
                        schema={tab.schema}
                        table={tab.table}
                        initialFilter={tab.initialFilter}
                        hidden={tab.id !== activeId}
                        onConnectedChange={connected => handleConnectedChange(tab.id, connected)}
                        onOpenRoutine={(kind, name, definition) => handleOpenRoutine(kind, name, definition)}
                        onOpenTable={handleOpenTable}
                    />
                ) : tab.kind === 'schema' ? (
                    <SchemaTab
                        key={tab.id}
                        tabId={tab.id}
                        connectionId={tab.connectionId}
                        schema={tab.schema}
                        hidden={tab.id !== activeId}
                        onConnectedChange={connected => handleConnectedChange(tab.id, connected)}
                        onOpenTable={(connectionId, schema, table) => handleOpenTable(connectionId, schema, table)}
                        onOpenRoutine={(kind, name, definition) => handleOpenRoutine(kind, name, definition)}
                    />
                ) : (
                    <RoutineTab
                        key={tab.id}
                        kind={tab.routineKind}
                        name={tab.name}
                        definition={tab.definition}
                        hidden={tab.id !== activeId}
                    />
                )
            ))}
        </div>
    )
}

export default App
