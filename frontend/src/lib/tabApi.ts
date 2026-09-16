// Wrapper de todos os bindings Go escopados por tabId (exceto CancelQuery,
// ver nota abaixo). Cada aba usa uma única conexão dedicada (*sql.Conn/pgx,
// ver internal/session) que NÃO suporta uso concorrente — duas chamadas
// simultâneas pro mesmo tabId colidem no backend com erro "conn busy" /
// "failed to deallocate cached state" (pgx).
//
// Bug real de produção (relatado pelo usuário, base corporativa grande):
// ConsoleTab.handleConnected carrega o catálogo de autocomplete num loop
// sequencial em background ao conectar (ListSchemas → ListTables por schema
// → IntrospectTable por tabela) — em bases pequenas termina em milissegundos
// e passa despercebido, mas em bases com centenas de tabelas esse loop ainda
// está rodando quando o usuário já digitou e executou uma query manualmente,
// colidindo na MESMA conexão. Mesma classe de bug já resolvida uma vez
// dentro do próprio loop (Promise.all → sequencial, ver memória
// wisp-autocomplete-conn-busy-concurrency) — mas aquele fix só serializava
// as chamadas UMAS COM AS OUTRAS dentro do loop, não contra chamadas de
// QUALQUER outro lugar da mesma aba (Sidebar expandindo schema, usuário
// rodando query, TableTab/SchemaTab abrindo, ResultGrid salvando edição).
//
// Fix: todo componente que precisa de um binding tabId-scoped importa daqui
// (nunca direto de wailsjs/go/main/App) — cada chamada passa por
// withQueue(tabId, ...), que serializa TODAS elas entre si, de qualquer
// componente, sem excluir uma corrida entre lugares diferentes do código.
//
// CancelQuery é a ÚNICA exceção: ela existe pra INTERROMPER uma chamada já
// em voo (FetchRows bloqueado esperando o servidor) — se passasse pela
// mesma fila, ficaria enfileirada atrás da própria chamada que deveria
// cancelar, nunca executando a tempo. Importar CancelQuery direto de
// wailsjs/go/main/App, não daqui.
import * as App from '../../wailsjs/go/main/App';
import type {main, db} from '../../wailsjs/go/models';
import {withQueue} from './tabCallQueue';

export function ConnectSaved(tabId: string, connectionId: string): Promise<void> {
    return withQueue(tabId, () => App.ConnectSaved(tabId, connectionId));
}

export function Disconnect(tabId: string): Promise<void> {
    return withQueue(tabId, () => App.Disconnect(tabId));
}

export function ListSchemas(tabId: string): Promise<string[]> {
    return withQueue(`${tabId}:metadata`, () => App.ListSchemas(tabId));
}

export function ListTables(tabId: string, schema: string): Promise<db.Table[]> {
    return withQueue(`${tabId}:metadata`, () => App.ListTables(tabId, schema));
}

export function IntrospectTable(tabId: string, schema: string, table: string): Promise<db.Table> {
    return withQueue(`${tabId}:metadata`, () => App.IntrospectTable(tabId, schema, table));
}

// Equivalente batched de IntrospectTable para o schema inteiro (uma única
// query no backend em vez de N — ver internal/db.DatabaseDriver.
// IntrospectSchema). Usado pelo catálogo de autocomplete do console em vez
// do loop de IntrospectTable por tabela, que travava a fila da aba por muito
// tempo em schemas com centenas de tabelas.
export function IntrospectSchemaTables(tabId: string, schema: string): Promise<db.Table[]> {
    return withQueue(`${tabId}:metadata`, () => App.IntrospectSchemaTables(tabId, schema));
}

export function RunQuery(tabId: string, query: string): Promise<main.QueryMetadata> {
    return withQueue(tabId, () => App.RunQuery(tabId, query));
}

export function FetchRows(tabId: string, n: number): Promise<main.FetchBatch> {
    return withQueue(tabId, () => App.FetchRows(tabId, n));
}

export function UpdateCell(
    tabId: string,
    schema: string,
    table: string,
    pkColumns: string[],
    pkValues: any[],
    column: string,
    oldValue: any,
    newValue: any
): Promise<number> {
    return withQueue(tabId, () => App.UpdateCell(tabId, schema, table, pkColumns, pkValues, column, oldValue, newValue));
}

export function InsertRow(tabId: string, schema: string, table: string, columns: string[], values: any[]): Promise<void> {
    return withQueue(tabId, () => App.InsertRow(tabId, schema, table, columns, values));
}

export function DeleteRow(tabId: string, schema: string, table: string, pkColumns: string[], pkValues: any[]): Promise<number> {
    return withQueue(tabId, () => App.DeleteRow(tabId, schema, table, pkColumns, pkValues));
}

// Roda todos os INSERTs/DELETEs pendentes da tela de "Revisar mudanças" numa
// única transação (tudo ou nada) — ver db.BatchOp e a nota em
// DatabaseDriver.ExecuteBatch.
export function ExecuteBatch(tabId: string, ops: db.BatchOp[]): Promise<void> {
    return withQueue(tabId, () => App.ExecuteBatch(tabId, ops));
}

export function ListIncomingForeignKeys(tabId: string, schema: string, table: string): Promise<db.IncomingForeignKey[]> {
    return withQueue(tabId, () => App.ListIncomingForeignKeys(tabId, schema, table));
}

export function GetTableDDL(tabId: string, schema: string, table: string): Promise<string> {
    return withQueue(tabId, () => App.GetTableDDL(tabId, schema, table));
}

export function ListTriggers(tabId: string, schema: string, table: string): Promise<db.Trigger[]> {
    return withQueue(tabId, () => App.ListTriggers(tabId, schema, table));
}

export function ListFunctions(tabId: string, schema: string): Promise<db.Function[]> {
    return withQueue(tabId, () => App.ListFunctions(tabId, schema));
}

export function RefreshSchema(tabId: string): Promise<void> {
    return withQueue(tabId, () => App.RefreshSchema(tabId));
}

export function ListIndexes(tabId: string, schema: string, table: string): Promise<db.Index[]> {
    return withQueue(tabId, () => App.ListIndexes(tabId, schema, table));
}

export function ListForeignKeys(tabId: string, schema: string, table: string): Promise<db.ForeignKey[]> {
    return withQueue(tabId, () => App.ListForeignKeys(tabId, schema, table));
}
