import {useTranslation} from 'react-i18next';
import type {db} from '../../wailsjs/go/models';
import type {SchemaCategory} from '../lib/useSchemaObjects';

interface Props {
    category: SchemaCategory;
    schema: string;
    connectionId: string;
    tables: db.Table[];
    views: db.Table[];
    functions: db.Function[];
    sequences: db.Sequence[];
    onOpenTable: (connectionId: string, schema: string, table: string) => void;
    onOpenRoutine?: (kind: 'trigger' | 'function', name: string, definition: string) => void;
}

export default function SchemaObjectList({
    category,
    schema,
    connectionId,
    tables,
    views,
    functions,
    sequences,
    onOpenTable,
    onOpenRoutine,
}: Props) {
    const {t} = useTranslation();

    if (category === 'tables') {
        if (tables.length === 0) {
            return <div className="meta-empty">{t('schemaTab.emptyTables', 'Nenhuma tabela encontrada.')}</div>;
        }
        return (
            <div className="meta-list">
                {tables.map(table => (
                    <div
                        key={table.Name}
                        className="meta-item"
                        role="button"
                        tabIndex={0}
                        title={t('schemaTab.openTitle', {schema, table: table.Name})}
                        onClick={() => onOpenTable(connectionId, schema, table.Name)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onOpenTable(connectionId, schema, table.Name);
                            }
                        }}
                    >
                        <div className="meta-name">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: 6}}>
                                <rect x="3" y="3" width="18" height="18" rx="2" />
                                <path d="M3 9h18M3 15h18M9 3v18" />
                            </svg>
                            {table.Name}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (category === 'views') {
        if (views.length === 0) {
            return <div className="meta-empty">{t('schemaTab.emptyViews', 'Nenhuma view encontrada.')}</div>;
        }
        return (
            <div className="meta-list">
                {views.map(view => (
                    <div
                        key={view.Name}
                        className="meta-item"
                        role="button"
                        tabIndex={0}
                        title={t('schemaTab.openViewTitle', {schema, table: view.Name})}
                        onClick={() => onOpenTable(connectionId, schema, view.Name)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onOpenTable(connectionId, schema, view.Name);
                            }
                        }}
                    >
                        <div className="meta-name">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: 6}}>
                                <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
                                <circle cx="12" cy="12" r="3" />
                            </svg>
                            {view.Name}
                            <span className="tree-leaf-badge" style={{marginLeft: 6}} title="View">view</span>
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (category === 'functions') {
        if (functions.length === 0) {
            return <div className="meta-empty">{t('schemaTab.emptyFunctions', 'Nenhuma função encontrada.')}</div>;
        }
        return (
            <div className="meta-list">
                {functions.map(fn => (
                    <div
                        key={fn.Name}
                        className="meta-item"
                        role="button"
                        tabIndex={0}
                        title={t('schemaTab.openRoutineTitle', 'Clique para ver a definição da função')}
                        onClick={() => onOpenRoutine?.('function', fn.Name, fn.Definition)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onOpenRoutine?.('function', fn.Name, fn.Definition);
                            }
                        }}
                    >
                        <div className="meta-name">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: 6}}>
                                <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
                            </svg>
                            {fn.Name}
                            <span className="tree-leaf-badge" style={{marginLeft: 6, background: 'rgba(52, 211, 153, 0.15)', color: '#34d399'}} title="Function">fn</span>
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (category === 'sequences') {
        if (sequences.length === 0) {
            return <div className="meta-empty">{t('schemaTab.emptySequences', 'Nenhuma sequence encontrada.')}</div>;
        }
        return (
            <div className="meta-list">
                {sequences.map(seq => (
                    <div key={seq.Name} className="meta-item" style={{cursor: 'default'}}>
                        <div className="meta-name" style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%'}}>
                            <div style={{display: 'flex', alignItems: 'center'}}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: 6}}>
                                    <path d="M4 19h16M4 12h16M4 5h16" />
                                </svg>
                                <span>{seq.Name}</span>
                                <span className="tree-leaf-badge" style={{marginLeft: 6, background: 'rgba(251, 191, 36, 0.15)', color: '#fbbf24'}} title="Sequence">seq</span>
                            </div>
                            <span style={{fontSize: '11px', opacity: 0.6}}>
                                {seq.DataType} (start: {seq.StartValue}, inc: {seq.Increment})
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    return null;
}
