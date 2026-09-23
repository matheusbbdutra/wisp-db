import React, {createContext, useContext, useState, useRef, useEffect} from 'react';
import {Disconnect, ConfirmQuit} from '../../wailsjs/go/main/App';
import {EventsOn} from '../../wailsjs/runtime/runtime';
import type {ConsoleTabHandle} from '../components/ConsoleTab';
import i18n from '../i18n';

export interface ConsoleTabState {
    kind: 'console';
    id: string;
    title: string;
    connected: boolean;
}

export interface TableTabState {
    kind: 'table';
    id: string;
    title: string;
    connected: boolean;
    connectionId: string;
    schema: string;
    table: string;
    initialFilter?: { column: string; value: any };
}

export interface SchemaTabState {
    kind: 'schema';
    id: string;
    title: string;
    connected: boolean;
    connectionId: string;
    schema: string;
}

export interface RoutineTabState {
    kind: 'routine';
    id: string;
    title: string;
    connected: boolean;
    routineKind: 'trigger' | 'function';
    name: string;
    definition: string;
}

export type TabState = ConsoleTabState | TableTabState | SchemaTabState | RoutineTabState;

export interface TabsContextValue {
    tabs: TabState[];
    activeId: string;
    setActiveId: (id: string) => void;
    addConsoleTab: () => void;
    openTableTab: (connectionId: string, schema: string, table: string, initialFilter?: { column: string; value: any }) => void;
    openSchemaTab: (connectionId: string, schema: string) => void;
    openRoutineTab: (kind: 'trigger' | 'function', name: string, definition: string) => void;
    closeTab: (tabId: string) => Promise<void>;
    updateTabConnected: (tabId: string, connected: boolean) => void;
    registerConsoleRef: (tabId: string, handle: ConsoleTabHandle | null) => void;
    initialTabId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

let tabCounter = 1;

function createConsoleTab(): ConsoleTabState {
    const n = tabCounter++;
    return {
        kind: 'console',
        id: `tab-${crypto.randomUUID()}`,
        title: i18n.t('app.consoleTitle', {n}),
        connected: false,
    };
}

export function TabsProvider({children}: {children: React.ReactNode}) {
    const [tabs, setTabs] = useState<TabState[]>(() => [createConsoleTab()]);
    const [activeId, setActiveId] = useState<string>(() => tabs[0].id);

    const consoleRefs = useRef(new Map<string, ConsoleTabHandle>());
    const tabsRef = useRef(tabs);
    tabsRef.current = tabs;
    const initialTabIdRef = useRef(tabs[0].id);

    function addConsoleTab() {
        const tab = createConsoleTab();
        setTabs(prev => [...prev, tab]);
        setActiveId(tab.id);
    }

    function openTableTab(
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

    function openSchemaTab(connectionId: string, schema: string) {
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

    function openRoutineTab(kind: 'trigger' | 'function', name: string, definition: string) {
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

    function updateTabConnected(tabId: string, connected: boolean) {
        setTabs(prev => prev.map(tab => (tab.id === tabId ? {...tab, connected} : tab)));
    }

    function registerConsoleRef(tabId: string, handle: ConsoleTabHandle | null) {
        if (handle) {
            consoleRefs.current.set(tabId, handle);
        } else {
            consoleRefs.current.delete(tabId);
        }
    }

    async function closeTab(tabId: string) {
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
            // Ignored if session didn't exist
        }

        setTabs(prev => {
            const remaining = prev.filter(item => item.id !== tabId);
            if (activeId === tabId && remaining.length > 0) {
                setActiveId(remaining[remaining.length - 1].id);
            }
            return remaining;
        });
    }

    useEffect(() => {
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

    const value: TabsContextValue = {
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
        initialTabId: initialTabIdRef.current,
    };

    return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

export function useTabs(): TabsContextValue {
    const ctx = useContext(TabsContext);
    if (!ctx) {
        throw new Error('useTabs must be used within a TabsProvider');
    }
    return ctx;
}
