import {useEffect, useRef} from 'react';
// Import da API core (não do pacote 'monaco-editor' inteiro, que arrasta os
// language services completos de TypeScript/CSS/HTML/JSON — dezenas de MB —
// e o highlighting de dezenas de linguagens que o Wisp nunca usa). SQL é só
// registrado como "basic language" (tokenizer leve), sem language service
// próprio — ver docs/ARCHITECTURE.md: "sem parser SQL customizado".
import * as monaco from 'monaco-editor/editor/editor.api';
import {conf as sqlConf, language as sqlLanguage} from 'monaco-editor/languages/definitions/sql/sql';
// Import de efeito colateral: registra o SuggestController como contribuição
// do editor. Sem isso, registerCompletionItemProvider (abaixo) só guarda os
// providers num registro global — nenhum editor tem o widget/gatilho que
// consulta esse registro, e Ctrl+Space/digitação não fazem nada (bug real
// investigado em 2026-09-15: catálogo carregava certo, mas nunca aparecia
// sugestão nenhuma, nem manual). A API "core" (editor.api, acima) não traz
// contribuições do editor por padrão — só o essencial de formatação.
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js';
import type {db} from '../../wailsjs/go/models';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';

// Registro manual do SQL em vez de importar o "basic-languages" agregado
// (que nesta versão do monaco-editor puxa TODAS as linguagens suportadas
// de uma vez, ~90 chunks). Só o tokenizer léxico (Monarch) + configuração
// de comentários/parênteses — sem language service, conforme
// docs/ARCHITECTURE.md ("sem parser SQL customizado").
monaco.languages.register({id: 'sql'});
monaco.languages.setLanguageConfiguration('sql', sqlConf);
monaco.languages.setMonarchTokensProvider('sql', sqlLanguage);

// Provider global único (API por linguagem, não por instância): registrar no
// nível de módulo evita N provedores duplicados com N abas abertas, que
// repetiriam cada sugestão N vezes. O catálogo certo por aba é resolvido
// pelo model recebido no provider — cada editor tem seu próprio model.
const catalogByModel = new Map<monaco.editor.ITextModel, db.Table[]>();
const driverByModel = new Map<monaco.editor.ITextModel, string | undefined>();

type MonacoRange = {
    startLineNumber: number;
    endLineNumber: number;
    startColumn: number;
    endColumn: number;
};

// Keywords SQL ANSI (não específicas de dialeto), sempre disponíveis. O
// Monaco filtra por prefixo do que foi digitado, então concatenar a lista
// cheia é barato e correto.
const SQL_KEYWORDS = [
    'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
    'DELETE', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'ON',
    'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'DISTINCT', 'AS',
    'AND', 'OR', 'NOT', 'NULL', 'IS NULL', 'IS NOT NULL', 'IN', 'BETWEEN',
    'LIKE', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'UNION', 'UNION ALL',
    'WITH', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'PRIMARY KEY',
    'FOREIGN KEY', 'REFERENCES', 'DEFAULT', 'EXISTS',
];

// Funções built-in curadas por dialeto (só nomes com existência confirmada;
// em caso de dúvida o nome foi omitido em vez de arriscado).
const POSTGRES_FUNCTIONS = [
    'count', 'sum', 'avg', 'min', 'max', 'array_agg', 'string_agg', 'json_agg',
    'length', 'lower', 'upper', 'trim', 'substring', 'concat', 'concat_ws',
    'replace', 'split_part', 'regexp_replace',
    'now', 'current_date', 'current_timestamp', 'age', 'date_trunc', 'extract',
    'to_char', 'to_date', 'to_timestamp',
    'coalesce', 'nullif', 'greatest', 'least',
    'json_build_object', 'jsonb_build_object', 'json_extract_path',
    'row_number', 'rank', 'dense_rank', 'lag', 'lead',
    'generate_series', 'unnest', 'array_length',
];

const SQLITE_FUNCTIONS = [
    'count', 'sum', 'avg', 'min', 'max', 'group_concat',
    'length', 'lower', 'upper', 'trim', 'substr', 'replace', 'instr', 'printf',
    'date', 'time', 'datetime', 'julianday', 'strftime',
    'coalesce', 'ifnull', 'nullif',
    'abs', 'round', 'random', 'typeof', 'last_insert_rowid', 'changes', 'sqlite_version',
    'json_extract', 'json_array', 'json_object',
    'row_number', 'rank', 'dense_rank', 'lag', 'lead',
];

function buildKeywordSuggestions(range: MonacoRange): monaco.languages.CompletionItem[] {
    return SQL_KEYWORDS.map(keyword => ({
        label: keyword,
        kind: monaco.languages.CompletionItemKind.Keyword,
        detail: 'keyword',
        insertText: keyword,
        range: range as monaco.IRange,
    }));
}

function buildFunctionSuggestions(driver: string | undefined, range: MonacoRange): monaco.languages.CompletionItem[] {
    const list = driver === 'postgres' ? POSTGRES_FUNCTIONS : driver === 'sqlite' ? SQLITE_FUNCTIONS : [];
    return list.map(name => ({
        label: name,
        kind: monaco.languages.CompletionItemKind.Function,
        detail: driver,
        insertText: `${name}()`,
        range: range as monaco.IRange,
    }));
}

function distinctSchemas(catalog: db.Table[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const table of catalog) {
        if (!table?.Schema || seen.has(table.Schema.toLowerCase())) continue;
        seen.add(table.Schema.toLowerCase());
        out.push(table.Schema);
    }
    return out;
}

function buildSchemaSuggestions(catalog: db.Table[], range: MonacoRange): monaco.languages.CompletionItem[] {
    return distinctSchemas(catalog).map(schema => ({
        label: schema,
        kind: monaco.languages.CompletionItemKind.Module,
        detail: 'schema',
        insertText: schema,
        range: range as monaco.IRange,
    }));
}

function buildTableSuggestions(catalog: db.Table[], range: MonacoRange, onlyTables?: db.Table[]): monaco.languages.CompletionItem[] {
    const source = onlyTables ?? catalog;
    const singleSchema = new Set(catalog.map(t => t.Schema)).size <= 1;
    const seen = new Set<string>();
    const out: monaco.languages.CompletionItem[] = [];
    for (const table of source) {
        if (!table?.Name) continue;
        const key = table.Name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
            label: table.Name,
            kind: monaco.languages.CompletionItemKind.Class,
            detail: table.Schema,
            insertText: table.Name,
            range: range as monaco.IRange,
        });
        const qualified = `${table.Schema}.${table.Name}`;
        if (!singleSchema && !onlyTables && !seen.has(qualified.toLowerCase())) {
            seen.add(qualified.toLowerCase());
            out.push({
                label: qualified,
                kind: monaco.languages.CompletionItemKind.Class,
                detail: 'tabela',
                insertText: qualified,
                range: range as monaco.IRange,
            });
        }
    }
    return out;
}

function buildColumnSuggestions(catalog: db.Table[], range: MonacoRange, onlyTables?: db.Table[]): monaco.languages.CompletionItem[] {
    const source = onlyTables ?? catalog;
    const seen = new Set<string>();
    const out: monaco.languages.CompletionItem[] = [];
    for (const table of source) {
        for (const col of table.Columns ?? []) {
            if (!col?.Name) continue;
            const key = col.Name.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
                label: col.Name,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `${table.Schema}.${table.Name} · ${col.Type}`,
                insertText: col.Name,
                range: range as monaco.IRange,
            });
        }
    }
    return out;
}

type DotContext =
    | {kind: 'schema-tables'; tables: db.Table[]}
    | {kind: 'table-columns'; tables: db.Table[]};

// Member completion sem parser SQL (ver docs/ARCHITECTURE.md): só inspeção
// de string da linha atual até o cursor. Retorna null quando não há ponto
// ou o identificador antes dele não é conhecido (caller cai no full list).
function resolveDotContext(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    wordStartColumn: number,
    catalog: db.Table[],
): DotContext | null {
    const prefix = model.getLineContent(position.lineNumber).slice(0, wordStartColumn - 1);
    const match = prefix.match(/([A-Za-z_][A-Za-z0-9_]*)\.$/);
    if (!match) return null;
    const ident = match[1].toLowerCase();
    const schemaTables = catalog.filter(t => t.Schema?.toLowerCase() === ident);
    if (schemaTables.length > 0) return {kind: 'schema-tables', tables: schemaTables};
    const namedTables = catalog.filter(t => t.Name?.toLowerCase() === ident);
    if (namedTables.length > 0) return {kind: 'table-columns', tables: namedTables};
    return null;
}

monaco.languages.registerCompletionItemProvider('sql', {
    provideCompletionItems(model, position) {
        const textModel = model as monaco.editor.ITextModel;
        const catalog = catalogByModel.get(textModel) ?? [];
        const driver = driverByModel.get(textModel);
        const word = model.getWordUntilPosition(position);
        const range: MonacoRange = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
        };
        // Sem parser SQL customizado (ver docs/ARCHITECTURE.md): sugestão
        // simples por prefixo, com narrowing por ponto via inspeção da linha.
        const dot = catalog.length > 0 ? resolveDotContext(textModel, position as monaco.Position, word.startColumn, catalog) : null;
        if (dot?.kind === 'schema-tables') {
            return {suggestions: buildTableSuggestions(catalog, range, dot.tables)};
        }
        if (dot?.kind === 'table-columns') {
            return {suggestions: buildColumnSuggestions(catalog, range, dot.tables)};
        }
        const suggestions: monaco.languages.CompletionItem[] = [
            ...buildSchemaSuggestions(catalog, range),
            ...buildTableSuggestions(catalog, range),
            ...buildColumnSuggestions(catalog, range),
            ...buildKeywordSuggestions(range),
            ...buildFunctionSuggestions(driver, range),
        ];
        return {suggestions};
    },
});

declare global {
    interface Window {
        MonacoEnvironment?: monaco.Environment;
    }
}

// Bundle 100% local do worker do Monaco (sem CDN) — necessário para o Wisp
// funcionar offline. Só o worker base do editor é necessário aqui (sem
// language service próprio para SQL, não há worker de linguagem a registrar).
self.MonacoEnvironment = {
    getWorker() {
        return new editorWorker();
    },
};

interface Props {
    value: string;
    onChange: (value: string) => void;
    onRunRequested: () => void;
    // onRunSelectionRequested roda só o texto selecionado (ou, sem seleção,
    // o "statement" sob o cursor — delimitado por ';'). Ctrl+Enter continua
    // rodando o editor inteiro; Ctrl+Shift+Enter dispara este.
    onRunSelectionRequested?: (text: string) => void;
    catalog?: db.Table[];
    driver?: string;
}

export default function SqlEditor({value, onChange, onRunRequested, onRunSelectionRequested, catalog, driver}: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const catalogRef = useRef(catalog);
    catalogRef.current = catalog;
    const driverRef = useRef(driver);
    driverRef.current = driver;
    const onChangeRef = useRef(onChange);
    const onRunRef = useRef(onRunRequested);
    const onRunSelectionRef = useRef(onRunSelectionRequested);
    onChangeRef.current = onChange;
    onRunRef.current = onRunRequested;
    onRunSelectionRef.current = onRunSelectionRequested;

    useEffect(() => {
        if (!containerRef.current) return;

        const editor = monaco.editor.create(containerRef.current, {
            value,
            language: 'sql',
            theme: 'vs-dark',
            automaticLayout: true,
            minimap: {enabled: false},
            fontSize: 13,
            lineHeight: 20,
            fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", "JetBrains Mono", Menlo, Consolas, monospace',
            padding: {top: 8, bottom: 8},
            lineNumbersMinChars: 3,
            renderLineHighlight: 'line',
            scrollBeyondLastLine: false,
            roundedSelection: true,
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            scrollbar: {
                verticalScrollbarSize: 8,
                horizontalScrollbarSize: 8,
            },
        });
        editorRef.current = editor;
        const initialModel = editor.getModel();
        if (initialModel) {
            catalogByModel.set(initialModel, catalogRef.current ?? []);
            driverByModel.set(initialModel, driverRef.current);
        }

        editor.onDidChangeModelContent(() => onChangeRef.current(editor.getValue()));
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onRunRef.current());

        // Ctrl+Shift+Enter: roda só o texto selecionado, ou (sem seleção) o
        // "statement" sob o cursor — texto entre o ';' anterior e o próximo.
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => {
            if (!onRunSelectionRef.current) return;
            const model = editor.getModel();
            const selection = editor.getSelection();
            if (!model) return;

            let text: string;
            if (selection && !selection.isEmpty()) {
                text = model.getValueInRange(selection);
            } else {
                const position = editor.getPosition();
                const full = model.getValue();
                const offset = position ? model.getOffsetAt(position) : 0;
                const start = full.lastIndexOf(';', offset - 1) + 1;
                const semicolonAfter = full.indexOf(';', offset);
                const end = semicolonAfter === -1 ? full.length : semicolonAfter;
                text = full.slice(start, end);
            }

            text = text.trim();
            if (text) onRunSelectionRef.current(text);
        });

        return () => {
            const m = editor.getModel();
            if (m) {
                catalogByModel.delete(m);
                driverByModel.delete(m);
            }
            editor.dispose();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const model = editorRef.current?.getModel();
        if (model) {
            catalogByModel.set(model, catalog ?? []);
            driverByModel.set(model, driver);
        }
    }, [catalog, driver]);

    useEffect(() => {
        const editor = editorRef.current;
        if (editor && editor.getValue() !== value) {
            editor.setValue(value);
        }
    }, [value]);

    return <div ref={containerRef} style={{height: '100%', width: '100%'}} />;
}
