import SqlEditor from './SqlEditor';

interface Props {
    kind: 'trigger' | 'function';
    name: string;
    definition: string;
    hidden: boolean;
}

// Aba de leitura pura pra um trigger/função (nível superior, irmã do
// Console/TableTab): SEM tabId/conexão próprios, ao contrário de
// TableTab/SchemaTab — a definição já veio completa de ListTriggers/
// ListFunctions (uma query batched por tabela/schema, ver
// internal/db.PostgresDriver), então não há nada a buscar aqui, só exibir.
export default function RoutineTab({kind, name, definition, hidden}: Props) {
    return (
        <div className="table-tab" hidden={hidden}>
            <div className="toolbar-secondary">
                <span className="table-tab-title" title={name}>
                    {kind === 'trigger' ? 'Trigger' : 'Função'}: {name}
                </span>
            </div>
            <div className="ddl-editor-pane">
                <SqlEditor value={definition} onChange={() => {}} onRunRequested={() => {}} readOnly />
            </div>
        </div>
    );
}
