import {useState} from 'react';
import './App.css';
import {Disconnect} from '../wailsjs/go/main/App';
import ConsoleTab from './components/ConsoleTab';
import TableTab from './components/TableTab';
import SchemaTab from './components/SchemaTab';

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
}

interface SchemaTabState {
    kind: 'schema';
    id: string;
    title: string;
    connected: boolean;
    connectionId: string;
    schema: string;
}

type TabState = ConsoleTabState | TableTabState | SchemaTabState;

let tabCounter = 1;

function createTab(): ConsoleTabState {
    const n = tabCounter++;
    return {kind: 'console', id: `tab-${crypto.randomUUID()}`, title: `Console ${n}`, connected: false};
}

function App() {
    const [tabs, setTabs] = useState<TabState[]>(() => [createTab()]);
    const [activeId, setActiveId] = useState(() => tabs[0].id);

    function handleAddTab() {
        const tab = createTab();
        setTabs(prev => [...prev, tab]);
        setActiveId(tab.id);
    }

    // Abre a tabela numa aba própria (irmã do Console): tabId novo com
    // conexão própria via ConnectSaved no mount do TableTab — nunca reusa
    // a sessão do console de origem (1 tabId = 1 conexão dedicada).
    function handleOpenTable(connectionId: string, schema: string, table: string) {
        const tab: TableTabState = {
            kind: 'table',
            id: `tab-${crypto.randomUUID()}`,
            title: table,
            connected: false,
            connectionId,
            schema,
            table,
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

    function handleConnectedChange(tabId: string, connected: boolean) {
        setTabs(prev => prev.map(t => (t.id === tabId ? {...t, connected} : t)));
    }

    async function handleCloseTab(tabId: string) {
        if (tabs.length === 1) {
            return;
        }

        try {
            await Disconnect(tabId);
        } catch {
            // Sessão já não existia (aba nunca conectou) — ignora.
        }

        setTabs(prev => {
            const remaining = prev.filter(t => t.id !== tabId);
            if (activeId === tabId && remaining.length > 0) {
                setActiveId(remaining[remaining.length - 1].id);
            }
            return remaining;
        });
    }

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
                                title="Fechar aba"
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
                <button className="tab-add" title="Nova aba" onClick={handleAddTab}>
                    +
                </button>
            </div>

            {tabs.map(tab => (
                tab.kind === 'console' ? (
                    <ConsoleTab
                        key={tab.id}
                        tabId={tab.id}
                        hidden={tab.id !== activeId}
                        onConnectedChange={connected => handleConnectedChange(tab.id, connected)}
                        onOpenTable={(connectionId, schema, table) => handleOpenTable(connectionId, schema, table)}
                        onOpenSchema={(connectionId, schema) => handleOpenSchema(connectionId, schema)}
                    />
                ) : tab.kind === 'table' ? (
                    <TableTab
                        key={tab.id}
                        tabId={tab.id}
                        connectionId={tab.connectionId}
                        schema={tab.schema}
                        table={tab.table}
                        hidden={tab.id !== activeId}
                        onConnectedChange={connected => handleConnectedChange(tab.id, connected)}
                    />
                ) : (
                    <SchemaTab
                        key={tab.id}
                        tabId={tab.id}
                        connectionId={tab.connectionId}
                        schema={tab.schema}
                        hidden={tab.id !== activeId}
                        onConnectedChange={connected => handleConnectedChange(tab.id, connected)}
                        onOpenTable={(connectionId, schema, table) => handleOpenTable(connectionId, schema, table)}
                    />
                )
            ))}
        </div>
    )
}

export default App
