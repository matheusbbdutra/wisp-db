import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import './App.css';
import ConsoleTab from './components/ConsoleTab';
import TableTab from './components/TableTab';
import SchemaTab from './components/SchemaTab';
import RoutineTab from './components/RoutineTab';
import UpdateChecker from './components/UpdateChecker';
import LanguageSwitcher from './components/LanguageSwitcher';
import AboutModal from './components/AboutModal';
import QuickOpenModal from './components/QuickOpenModal';
import {TabsProvider, useTabs} from './context/TabsContext';
import {useEffect} from 'react';

function AppContent() {
    const {t} = useTranslation();
    const {
        tabs,
        activeId,
        setActiveId,
        addConsoleTab,
        openTableTab,
        openSchemaTab,
        openRoutineTab,
        closeTab,
        updateTabConnected,
        registerConsoleRef,
        initialTabId,
    } = useTabs();
    const [showAbout, setShowAbout] = useState(false);
    const [showQuickOpen, setShowQuickOpen] = useState(false);

    const activeTab = tabs.find(t => t.id === activeId);
    const activeConnectionId = activeTab && 'connectionId' in activeTab ? activeTab.connectionId : undefined;

    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
                e.preventDefault();
                setShowQuickOpen(prev => !prev);
            }
        }
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
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
                                    closeTab(tab.id);
                                }}
                            >
                                ×
                            </button>
                        )}
                    </div>
                ))}
                <button className="tab-add" title={t('app.newTab')} onClick={addConsoleTab}>
                    +
                </button>
                <UpdateChecker />
                <button
                    className="about-btn"
                    onClick={() => setShowAbout(true)}
                    title={t('aboutModal.title')}
                >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="16" x2="12" y2="12" />
                        <line x1="12" y1="8" x2="12.01" y2="8" />
                    </svg>
                    <span>{t('aboutModal.btnLabel')}</span>
                </button>
                <LanguageSwitcher />
            </div>

            {tabs.map(tab => (
                tab.kind === 'console' ? (
                    <ConsoleTab
                        key={tab.id}
                        ref={el => registerConsoleRef(tab.id, el)}
                        tabId={tab.id}
                        hidden={tab.id !== activeId}
                        onConnectedChange={connected => updateTabConnected(tab.id, connected)}
                        onOpenTable={openTableTab}
                        onOpenSchema={openSchemaTab}
                        restoreLastScriptOnMount={tab.id === initialTabId}
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
                        onConnectedChange={connected => updateTabConnected(tab.id, connected)}
                        onOpenRoutine={openRoutineTab}
                        onOpenTable={openTableTab}
                    />
                ) : tab.kind === 'schema' ? (
                    <SchemaTab
                        key={tab.id}
                        tabId={tab.id}
                        connectionId={tab.connectionId}
                        schema={tab.schema}
                        hidden={tab.id !== activeId}
                        onConnectedChange={connected => updateTabConnected(tab.id, connected)}
                        onOpenTable={openTableTab}
                        onOpenRoutine={openRoutineTab}
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
            <AboutModal isOpen={showAbout} onClose={() => setShowAbout(false)} />
            <QuickOpenModal
                isOpen={showQuickOpen}
                onClose={() => setShowQuickOpen(false)}
                tabId={activeId}
                connectionId={activeConnectionId}
                onOpenTable={openTableTab}
            />
        </div>
    );
}

export default function App() {
    return (
        <TabsProvider>
            <AppContent />
        </TabsProvider>
    );
}
