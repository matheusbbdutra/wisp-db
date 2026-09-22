// Estado de conexão da aba de console + carregamento sob demanda do
// catálogo de autocomplete. Extraído do ConsoleTab sem mudança de
// comportamento.
import {useEffect, useRef, useState} from 'react';
import type {RefObject} from 'react';
import {useTranslation} from 'react-i18next';
import {Disconnect, ListSchemas, IntrospectSchemaTables, GetCachedCatalog, WarmupCatalog} from './tabApi';
import {EventsOn, EventsOff} from '../../wailsjs/runtime';
import type {db} from '../../wailsjs/go/models';

export interface CatalogConnection {
    id: string;
    name?: string;
    driver?: string;
}

interface UseConnectionArgs {
    tabId: string;
    onConnectedChange: (connected: boolean) => void;
    setStatus: React.Dispatch<React.SetStateAction<string>>;
    pendingQueryCountRef: RefObject<number>;
}

export function useConnection({tabId, onConnectedChange, setStatus, pendingQueryCountRef}: UseConnectionArgs) {
    const {t} = useTranslation();
    const [connected, setConnected] = useState(false);
    const [catalog, setCatalog] = useState<db.Table[]>([]);
    const [driver, setDriver] = useState<string | undefined>(undefined);
    // ID da conexão salva que originou a sessão desta aba — repassado pra
    // App.tsx ao abrir uma aba de tabela, que reconecta com ConnectSaved
    // (conexão própria por aba, nunca reusa a sessão do console).
    const [connectionId, setConnectionId] = useState<string | null>(null);
    const catalogCancelledRef = useRef(false);
    const catalogLoadingRef = useRef(false);
    const catalogReadyRef = useRef(false);
    const catalogConnectionRef = useRef<CatalogConnection | null>(null);

    // Escuta eventos assíncronos do backend Go para reatividade do catálogo
    useEffect(() => {
        EventsOn('wisp:catalog-updated', async (data: any) => {
            if (data?.tabId && data.tabId !== tabId) return;
            try {
                const cached = await GetCachedCatalog(tabId);
                if (cached && cached.length > 0) {
                    setCatalog(cached);
                    catalogReadyRef.current = true;
                }
            } catch {
                // falha silenciosa em background
            }
        });
        EventsOn('wisp:catalog-invalidated', (data: any) => {
            if (data?.tabId && data.tabId !== tabId) return;
            catalogReadyRef.current = false;
            void WarmupCatalog(tabId);
        });
        return () => {
            EventsOff('wisp:catalog-updated', 'wisp:catalog-invalidated');
        };
    }, [tabId]);

    async function loadCatalog(connectionId: string, connName?: string) {
        if (catalogLoadingRef.current || catalogReadyRef.current) return;
        catalogLoadingRef.current = true;
        catalogCancelledRef.current = false;
        try {
            // 1. Tenta carregar instantaneamente do cache persistido local (0ms de latência)
            const cached = await GetCachedCatalog(tabId);
            if (cached && cached.length > 0) {
                setCatalog(cached);
                catalogReadyRef.current = true;
                setStatus(connName ? t('consoleTab.connectedNamed', {name: connName}) : t('consoleTab.connected'));
                // Atualiza/aquece em background sem travar o usuário
                void WarmupCatalog(tabId);
                return;
            }

            // 2. Sem cache prévio (primeira conexão), dispara warmup em background
            setStatus(prev => t('consoleTab.loadingCatalog', {status: prev}));
            void WarmupCatalog(tabId);

            // Aguarda pequeno delay para queries prioritárias entrarem na fila primeiro
            await new Promise(resolve => window.setTimeout(resolve, 150));
            if (catalogCancelledRef.current || pendingQueryCountRef.current > 0) return;

            const schemas = await ListSchemas(tabId);
            const detailed: db.Table[] = [];
            for (const schema of schemas ?? []) {
                if (catalogCancelledRef.current || pendingQueryCountRef.current > 0) return;
                try {
                    const tables = await IntrospectSchemaTables(tabId, schema);
                    detailed.push(...(tables ?? []));
                } catch (schemaErr) {
                    console.error(`erro ao introspectar schema ${schema} para autocomplete:`, schemaErr);
                }
                setCatalog([...detailed]);
            }
            if (!catalogCancelledRef.current && catalogConnectionRef.current?.id === connectionId) {
                catalogReadyRef.current = true;
                setStatus(connName ? t('consoleTab.connectedNamed', {name: connName}) : t('consoleTab.connected'));
            }
        } catch (err) {
            if (!catalogCancelledRef.current) {
                console.error('erro ao carregar catálogo para autocomplete:', err);
                setStatus(connName ? t('consoleTab.connectedNamed', {name: connName}) : t('consoleTab.connected'));
            }
        } finally {
            catalogLoadingRef.current = false;
        }
    }
    async function handleConnected(connectionId: string, connName?: string, activeDriver?: string) {
        setConnected(true);
        onConnectedChange(true);
        setConnectionId(connectionId);
        setDriver(activeDriver);
        catalogConnectionRef.current = {id: connectionId, name: connName, driver: activeDriver};
        catalogCancelledRef.current = false;
        catalogReadyRef.current = false;
        setStatus(connName ? t('consoleTab.connectedNamed', {name: connName}) : t('consoleTab.connected'));
        // O catálogo completo do autocomplete é carregado sob demanda pelo
        // editor. Não fazemos introspecção pesada ao conectar: em bancos
        // grandes isso bloquearia a primeira consulta do usuário.
        //
        // Sequencial POR SCHEMA, nunca Promise.all: a sessão de uma aba usa
        // uma única conexão (*sql.Conn/pgx) dedicada (ver internal/session),
        // que não suporta uso concorrente. Bug real: com 2+ schemas as
        // chamadas em paralelo colidiam com erro "conn busy" e derrubavam o
        // catálogo inteiro (ver memória wisp-autocomplete-conn-busy-concurrency).
        //
    }

    function handleError(err: string) {
        setStatus(t('consoleTab.error', {error: err}));
    }

    // Desconecta o binding e limpa o estado de conexão/catálogo. Limpar as
    // abas de resultado é responsabilidade do chamador (domínio de execução).
    async function handleDisconnect() {
        catalogCancelledRef.current = true;
        catalogConnectionRef.current = null;
        catalogReadyRef.current = false;
        await Disconnect(tabId);
        setConnected(false);
        onConnectedChange(false);
        setCatalog([]);
        setDriver(undefined);
        setConnectionId(null);
    }

    return {
        connected,
        connectionId,
        catalog,
        driver,
        catalogCancelledRef,
        catalogConnectionRef,
        loadCatalog,
        handleConnected,
        handleDisconnect,
        handleError,
    };
}
