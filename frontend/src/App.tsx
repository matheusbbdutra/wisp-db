import {useState} from 'react';
import './App.css';
import {Disconnect} from '../wailsjs/go/main/App';
import ConsoleTab from './components/ConsoleTab';

interface TabState {
    id: string;
    title: string;
    connected: boolean;
}

let tabCounter = 1;

function createTab(): TabState {
    const n = tabCounter++;
    return {id: `tab-${crypto.randomUUID()}`, title: `Console ${n}`, connected: false};
}

function App() {
    const [tabs, setTabs] = useState<TabState[]>(() => [createTab()]);
    const [activeId, setActiveId] = useState(() => tabs[0].id);

    function handleAddTab() {
        const tab = createTab();
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
                <ConsoleTab
                    key={tab.id}
                    tabId={tab.id}
                    hidden={tab.id !== activeId}
                    onConnectedChange={connected => handleConnectedChange(tab.id, connected)}
                />
            ))}
        </div>
    )
}

export default App
