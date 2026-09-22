import {forwardRef, useEffect, useImperativeHandle, useRef} from 'react';
// Import da API core (não do pacote 'monaco-editor' inteiro, que arrasta os
// language services completos de TypeScript/CSS/HTML/JSON — dezenas de MB —
// e o highlighting de dezenas de linguagens que o Wisp nunca usa). SQL é só
// registrado como "basic language" (tokenizer leve), sem language service
// próprio — ver docs/ARCHITECTURE.md: "sem parser SQL customizado".
import * as monaco from 'monaco-editor/editor/editor.api';
import {conf as sqlConf, language as sqlLanguage} from 'monaco-editor/languages/definitions/sql/sql';
import i18n from '../i18n';
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
import {isCtrlHeld} from '../lib/modifierKeyTracker';
import {extractTableAliases} from '../lib/extractTableAliases';

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
const catalogLoaderByModel = new Map<monaco.editor.ITextModel, () => Promise<void>>();

type MonacoRange = {
    startLineNumber: number;
    endLineNumber: number;
    startColumn: number;
    endColumn: number;
};

// Preferência GLOBAL de uppercase automático (não por conexão/aba): é gosto
// de edição do usuário, não dado de negócio — fica em localStorage, não no
// Store SQLite do backend. Ausência = ligado (padrão).
export const AUTO_UPPERCASE_STORAGE_KEY = 'wisp:autoUppercaseKeywords';

export function readAutoUppercasePreference(): boolean {
    try {
        const raw = localStorage.getItem(AUTO_UPPERCASE_STORAGE_KEY);
        if (raw === null) return true;
        return raw === 'true';
    } catch {
        return true;
    }
}

// Preferência GLOBAL de quebra automática de linha (word wrap): evita que
// colagens longas se estendam infinitamente na horizontal. Padrão = ligado.
export const WORD_WRAP_STORAGE_KEY = 'wisp:wordWrap';

export function readWordWrapPreference(): boolean {
    try {
        const raw = localStorage.getItem(WORD_WRAP_STORAGE_KEY);
        if (raw === null) return true;
        return raw === 'true';
    } catch {
        return true;
    }
}

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

// Só palavras únicas participam do uppercase automático: a detecção acontece
// uma palavra digitada por vez, então compostas ("INNER JOIN", "GROUP BY",
// "IS NULL", ...) não fazem sentido aqui.
const AUTO_UPPERCASE_WORDS = new Set(
    SQL_KEYWORDS.filter(keyword => !keyword.includes(' ')).map(keyword => keyword.toLowerCase()),
);

// Lexing via tokenizer Monarch já registrado (não é "parser SQL customizado":
// só classifica o token sob o cursor). Erra pro lado de NÃO transformar em
// caso de dúvida — menos agressivo é mais seguro que estragar string do usuário.
function isInStringOrComment(model: monaco.editor.ITextModel, lineNumber: number, wordStartColumn: number): boolean {
    try {
        // Tokeniza do início do documento até a linha atual numa chamada só,
        // pra que o estado (ex.: bloco /* ... */ aberto linhas acima) esteja
        // correto na linha do cursor. Barato pro tamanho típico de query.
        const textUpToLine = model.getValueInRange({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: lineNumber,
            endColumn: model.getLineMaxColumn(lineNumber),
        });
        const tokensByLine = monaco.editor.tokenize(textUpToLine, 'sql');
        const lineTokens = tokensByLine[lineNumber - 1];
        if (!lineTokens) return true;
        const wordOffset = wordStartColumn - 1;
        let currentType = '';
        for (const token of lineTokens) {
            if (token.offset <= wordOffset) {
                currentType = token.type;
            } else {
                break;
            }
        }
        return currentType.includes('string') || currentType.includes('comment');
    } catch {
        return true;
    }
}

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
        detail: i18n.t('sqlEditor.detailKeyword'),
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
        detail: i18n.t('sqlEditor.detailSchema'),
        insertText: schema,
        range: range as monaco.IRange,
    }));
}

function buildTableSuggestions(catalog: db.Table[], range: MonacoRange, onlyTables?: db.Table[], sortPrefix = ''): monaco.languages.CompletionItem[] {
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
            sortText: `${sortPrefix}${table.Name}`,
            range: range as monaco.IRange,
        });
        const qualified = `${table.Schema}.${table.Name}`;
        if (!singleSchema && !onlyTables && !seen.has(qualified.toLowerCase())) {
            seen.add(qualified.toLowerCase());
            out.push({
                label: qualified,
                kind: monaco.languages.CompletionItemKind.Class,
                detail: i18n.t('sqlEditor.detailTable'),
                insertText: qualified,
                sortText: `${sortPrefix}${qualified}`,
                range: range as monaco.IRange,
            });
        }
    }
    return out;
}

// dedupKey inclui schema+tabela (não só o nome da coluna): a versão anterior
// deduplicava só por nome, então duas tabelas com coluna homônima em schemas
// diferentes (comum: "id", "created_at") faziam a coluna da tabela errada
// "vencer" e aparecer como se fosse da tabela que o usuário está de fato
// consultando — bug real relatado pelo usuário (2026-09-16).
function buildColumnSuggestions(catalog: db.Table[], range: MonacoRange, onlyTables?: db.Table[], sortPrefix = ''): monaco.languages.CompletionItem[] {
    const source = onlyTables ?? catalog;
    const seenNames = new Set<string>();
    const seenKeys = new Set<string>();
    const out: monaco.languages.CompletionItem[] = [];
    for (const table of source) {
        for (const col of table.Columns ?? []) {
            if (!col?.Name) continue;
            const dedupKey = onlyTables ? `${table.Schema}.${table.Name}.${col.Name}`.toLowerCase() : col.Name.toLowerCase();
            const seenSet = onlyTables ? seenKeys : seenNames;
            if (seenSet.has(dedupKey)) continue;
            seenSet.add(dedupKey);
            out.push({
                label: col.Name,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `${table.Schema}.${table.Name} · ${col.Type}`,
                insertText: col.Name,
                sortText: `${sortPrefix}${col.Name}`,
                range: range as monaco.IRange,
            });
        }
    }
    return out;
}

// Resolve as tabelas do catálogo que a query já referencia via FROM/JOIN
// (com ou sem alias) — mesmo mapa que resolveDotContext usa pra "alias.".
// Usado no fallback (sem ponto) pra priorizar/escopar tabela e coluna às
// tabelas realmente em jogo na query, em vez do catálogo inteiro sem
// distinção (bug real: em bancos com muitos schemas/tabelas, colunas e
// tabelas de outras partes do catálogo afogavam as relevantes).
function resolveQueryTables(query: string, catalog: db.Table[]): db.Table[] {
    const aliases = extractTableAliases(query);
    const seen = new Set<string>();
    const out: db.Table[] = [];
    for (const {schema, table} of aliases.values()) {
        for (const candidate of catalog) {
            const nameMatches = candidate.Name?.toLowerCase() === table.toLowerCase();
            if (!nameMatches) continue;
            if (schema !== null && candidate.Schema?.toLowerCase() !== schema.toLowerCase()) continue;
            const key = `${candidate.Schema}.${candidate.Name}`.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(candidate);
        }
    }
    return out;
}

// Logo após FROM/JOIN (primeiro token, antes de qualquer ponto/alias), só
// schema ou tabela fazem sentido gramaticalmente — nunca coluna. Sem essa
// distinção, uma coluna homônima (ou parecida o bastante pro fuzzy-match do
// Monaco) de QUALQUER tabela de QUALQUER schema competia de igual pra igual
// com a tabela certa e podia aparecer no lugar dela — bug real relatado
// pelo usuário (2026-09-16): "FROM s_solicitacao" mostrando uma coluna de
// outro schema em vez da tabela. Mesma inspeção de string sem parser SQL
// (ver docs/ARCHITECTURE.md) — limitação aceita: só detecta quando FROM/JOIN
// está na MESMA linha do cursor (igual resolveDotContext/extractTableAliases
// já assumem para o narrowing por ponto).
function isAfterFromOrJoin(model: monaco.editor.ITextModel, lineNumber: number, wordStartColumn: number): boolean {
    const prefix = model.getLineContent(lineNumber).slice(0, wordStartColumn - 1);
    return /\b(?:from|join)\s+$/i.test(prefix);
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

    // Alias de tabela (FROM/JOIN tabela [AS] alias) — ex. "SELECT c.nome
    // FROM customers c JOIN orders o ON ..." → "c." deve sugerir as colunas
    // de customers, não cair na lista genérica. Extrai da query INTEIRA
    // (não só da linha atual), já que FROM/JOIN pode estar em outra linha.
    const aliases = extractTableAliases(model.getValue());
    const aliased = aliases.get(ident);
    if (aliased) {
        const aliasTables = catalog.filter(t => {
            const nameMatches = t.Name?.toLowerCase() === aliased.table.toLowerCase();
            if (!nameMatches) return false;
            return aliased.schema === null || t.Schema?.toLowerCase() === aliased.schema.toLowerCase();
        });
        if (aliasTables.length > 0) return {kind: 'table-columns', tables: aliasTables};
    }
    return null;
}

monaco.languages.registerCompletionItemProvider('sql', {
    async provideCompletionItems(model, position) {
        const textModel = model as monaco.editor.ITextModel;
        let catalog = catalogByModel.get(textModel) ?? [];
        if (catalog.length === 0) {
            await catalogLoaderByModel.get(textModel)?.();
            catalog = catalogByModel.get(textModel) ?? [];
        }
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
        // Logo após FROM/JOIN: só schema/tabela — nunca coluna (ver
        // isAfterFromOrJoin acima).
        if (isAfterFromOrJoin(textModel, position.lineNumber, word.startColumn)) {
            return {
                suggestions: [
                    ...buildSchemaSuggestions(catalog, range),
                    ...buildTableSuggestions(catalog, range),
                ],
            };
        }
        // Sem ponto e fora de FROM/JOIN: quando a query já referencia
        // tabelas conhecidas (via FROM/JOIN), restringe as sugestões de
        // coluna a ELAS — nunca ao catálogo inteiro junto. O Monaco ordena
        // por fuzzy match score antes de sortText, então injetar todas as
        // colunas do catálogo (mesmo com sortText pior) deixava uma coluna
        // de OUTRA tabela, com nome mais parecido ao digitado, vencer a
        // coluna certa — bug real relatado pelo usuário (2026-09-17): no
        // WHERE, a sugestão de coluna veio de uma tabela totalmente
        // diferente da indicada no FROM. Só cai no catálogo inteiro quando
        // nenhuma tabela é conhecida ainda (ex.: digitando antes do FROM).
        const queryTables = catalog.length > 0 ? resolveQueryTables(textModel.getValue(), catalog) : [];
        const suggestions: monaco.languages.CompletionItem[] = [
            ...buildSchemaSuggestions(catalog, range),
            ...buildTableSuggestions(catalog, range, undefined, queryTables.length > 0 ? '1' : ''),
            // Coluna: só do catálogo inteiro quando NENHUMA tabela da query
            // é conhecida ainda. Com tabela(s) conhecida(s), a coluna vem só
            // delas — nunca junto com o catálogo inteiro (ver comentário
            // acima da declaração de queryTables).
            ...buildColumnSuggestions(catalog, range, queryTables.length > 0 ? queryTables : undefined),
            ...buildKeywordSuggestions(range),
            ...buildFunctionSuggestions(driver, range),
        ];
        return {suggestions};
    },
});

// Delimitador de statement: ';' OU linha em branco (uma ou mais linhas só
// com espaço entre duas quebras). Só ';' não bastava — bug real relatado
// pelo usuário (2026-09-17): dois SELECTs digitados em blocos separados por
// linha em branco, sem ';' em lugar nenhum, foram mandados juntos pro driver
// (nenhum ';' encontrado → fallback pro texto inteiro), gerando erro de
// sintaxe. Uma quebra de linha ÚNICA não conta (formatação normal de uma
// mesma query multi-linha), só a linha em branco entre statements.
const STATEMENT_SEPARATOR_RE = /;|\n[ \t]*\n/g;

// Texto selecionado, ou (sem seleção) o "statement" sob o cursor — texto
// entre o separador anterior e o próximo (ver STATEMENT_SEPARATOR_RE acima).
// Mesma inspeção de string sem parser SQL usada no resto do arquivo: não
// distingue um ';' dentro de string/comentário de um separador real de
// statement (limitação aceita, igual extractTableAliases).
function resolveStatementOrSelection(editor: monaco.editor.IStandaloneCodeEditor): string {
    const model = editor.getModel();
    const selection = editor.getSelection();
    if (!model) return '';

    let text: string;
    if (selection && !selection.isEmpty()) {
        text = model.getValueInRange(selection);
    } else {
        const position = editor.getPosition();
        const full = model.getValue();
        const offset = position ? model.getOffsetAt(position) : 0;
        let start = 0;
        let end = full.length;
        STATEMENT_SEPARATOR_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = STATEMENT_SEPARATOR_RE.exec(full)) !== null) {
            const separatorEnd = match.index + match[0].length;
            if (separatorEnd <= offset) {
                start = separatorEnd;
            } else if (match.index >= offset) {
                end = match.index;
                break;
            } else {
                // Cursor caiu DENTRO do separador (ex.: na linha em branco
                // entre dois statements) — trata como "depois" dele.
                start = separatorEnd;
            }
        }
        text = full.slice(start, end);
    }
    return text.trim();
}

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
    // Ctrl+Enter roda só o texto selecionado ou, sem seleção, o "statement"
    // sob o cursor (delimitado por ';') — estilo DBeaver/DataGrip. Antes
    // rodava o editor inteiro de uma vez como uma única string, o que fazia
    // o driver receber múltiplos statements colados (com ';' no meio) numa
    // chamada só — bug real relatado pelo usuário (2026-09-17): "executa
    // múltiplos [statements], não considera terminar com ; ou quebra de
    // linha". Corrigido delimitando sempre pelo statement sob o cursor.
    onRunRequested: (text: string) => void;
    // onRunSelectionRequested tem a mesma resolução de texto que
    // onRunRequested (mantido como atalho alternativo, Ctrl+Shift+Enter).
    onRunSelectionRequested?: (text: string) => void;
    // onRunNewTabRequested força uma aba de resultado NOVA em vez de
    // reaproveitar a ativa — mesma resolução de statement sob o
    // cursor/seleção, só que sempre em aba nova (Ctrl+Alt+Enter, mesmo
    // espírito do "Execute SQL Statement in New Tab" do DBeaver).
    onRunNewTabRequested?: (text: string) => void;
    catalog?: db.Table[];
    onCatalogNeeded?: () => Promise<void>;
    driver?: string;
    autoUppercase?: boolean;
    wordWrap?: boolean;
    // Somente leitura (ex.: visualização de DDL na aba de tabela): bloqueia
    // digitação no Monaco sem mudar nada do modo edição existente.
    readOnly?: boolean;
    // Ctrl+click num identificador da query (tabela, ou schema em
    // "schema.tabela") — ConsoleTab resolve contra o catálogo e decide se
    // abre TableTab ou SchemaTab.
    onOpenIdentifier?: (
        target:
            | {kind: 'table'; schema: string | null; table: string}
            | {kind: 'schema'; schema: string}
    ) => void;
}

// Exposto via ref pro botão "Explain" da toolbar (ConsoleTab.tsx), que fica
// FORA do Monaco e não tem acesso a cursor/seleção do editor de outro jeito
// — precisa do mesmo statement que Ctrl+Enter rodaria, não do editor
// inteiro (EXPLAIN só aceita um statement por vez, ver explainQuery.ts).
export interface SqlEditorHandle {
    getStatementOrSelection: () => string;
}

const SqlEditor = forwardRef<SqlEditorHandle, Props>(function SqlEditor({value, onChange, onRunRequested, onRunSelectionRequested, onRunNewTabRequested, catalog, driver, autoUppercase = true, wordWrap, readOnly = false, onOpenIdentifier, onCatalogNeeded}, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    useImperativeHandle(ref, () => ({
        getStatementOrSelection: () => {
            const editor = editorRef.current;
            return editor ? resolveStatementOrSelection(editor) : '';
        },
    }));
    const catalogRef = useRef(catalog);
    catalogRef.current = catalog;
    const driverRef = useRef(driver);
    driverRef.current = driver;
    const onChangeRef = useRef(onChange);
    const onRunRef = useRef(onRunRequested);
    const onRunSelectionRef = useRef(onRunSelectionRequested);
    const onRunNewTabRef = useRef(onRunNewTabRequested);
    const onOpenIdentifierRef = useRef(onOpenIdentifier);
    const onCatalogNeededRef = useRef(onCatalogNeeded);
    onChangeRef.current = onChange;
    onRunRef.current = onRunRequested;
    onRunSelectionRef.current = onRunSelectionRequested;
    onRunNewTabRef.current = onRunNewTabRequested;
    onOpenIdentifierRef.current = onOpenIdentifier;
    onCatalogNeededRef.current = onCatalogNeeded;
    // Refs (não estado) pro listener do Monaco, que é registrado uma vez só
    // na montagem e não re-registra a cada render.
    const autoUppercaseRef = useRef(autoUppercase);
    autoUppercaseRef.current = autoUppercase;
    // Guarda contra loop/undo duplo: a edição programática abaixo dispara
    // onDidChangeModelContent de novo — sem a flag, ela se auto-realimentaria
    // (loop) e empurraria entradas inúteis na pilha de undo (Ctrl+Z desfaria
    // só a caixa alta em vez do que o usuário digitou).
    const isApplyingAutoCaseRef = useRef(false);

    const effectiveWordWrap = readOnly || (wordWrap ?? readWordWrapPreference());

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
            readOnly,
            wordWrap: effectiveWordWrap ? 'on' : 'off',
            wrappingIndent: 'indent',
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
            catalogLoaderByModel.set(initialModel, () => onCatalogNeededRef.current?.() ?? Promise.resolve());
        }

        editor.onDidChangeModelContent(e => {
            onChangeRef.current(editor.getValue());
            if (isApplyingAutoCaseRef.current || !autoUppercaseRef.current) return;
            const model = editor.getModel();
            if (!model) return;
            for (const change of e.changes) {
                // Só digitação de 1 caractere dispara a checagem — paste,
                // delete e undo passam batido de propósito.
                if (change.rangeLength !== 0 || change.text.length !== 1) continue;
                // Enquanto o caractere é identificador, a palavra ainda está
                // sendo digitada — só converte ao cruzar o word-boundary
                // (espaço, quebra de linha, parêntese, vírgula, ;, etc.).
                if (/[A-Za-z0-9_]/.test(change.text)) continue;
                const lineNumber = change.range.startLineNumber;
                const boundaryColumn = change.range.startColumn;
                if (boundaryColumn <= 1) continue;
                const word = model.getLineContent(lineNumber).slice(0, boundaryColumn - 1).match(/([A-Za-z_][A-Za-z0-9_]*)$/)?.[1];
                if (!word || word === word.toUpperCase() || !AUTO_UPPERCASE_WORDS.has(word.toLowerCase())) continue;
                const wordStartColumn = boundaryColumn - word.length;
                if (isInStringOrComment(model, lineNumber, wordStartColumn)) continue;
                isApplyingAutoCaseRef.current = true;
                try {
                    editor.executeEdits('wisp-auto-uppercase', [{
                        range: {
                            startLineNumber: lineNumber,
                            endLineNumber: lineNumber,
                            startColumn: wordStartColumn,
                            endColumn: boundaryColumn,
                        },
                        text: word.toUpperCase(),
                    }]);
                } finally {
                    isApplyingAutoCaseRef.current = false;
                }
                // Para após a primeira substituição: as ranges dos demais
                // changes do mesmo evento ficaram obsoletas após a edição.
                break;
            }
        });
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
            const text = resolveStatementOrSelection(editor);
            if (text) onRunRef.current(text);
        });

        // Ctrl+click num identificador da query abre a tabela/schema numa
        // aba própria (ver Props.onOpenIdentifier). Usa isCtrlHeld() (rastreado
        // via keydown/keyup) em vez de e.event.ctrlKey do próprio clique —
        // nesta stack (GTK/WebKitGTK sob Wayland) o clique real não chega com
        // ctrlKey correto, mas keydown/keyup chegam certos (mesma razão de
        // Ctrl+Enter acima funcionar). Ver lib/modifierKeyTracker.ts.
        editor.onMouseDown(e => {
            if (!isCtrlHeld() || !onOpenIdentifierRef.current) return;
            const model = editor.getModel();
            const position = e.target.position;
            if (!model || !position) return;
            const word = model.getWordAtPosition(position);
            if (!word) return;
            const line = model.getLineContent(position.lineNumber);
            const before = line.slice(0, word.startColumn - 1);
            const after = line.slice(word.endColumn - 1);
            const qualifier = before.match(/([A-Za-z_][A-Za-z0-9_]*)\.$/)?.[1] ?? null;
            // Se o próprio identificador clicado é seguido de "." (ex.: "public"
            // em "public.customers"), ele é o schema — não uma tabela.
            if (qualifier === null && after.startsWith('.')) {
                onOpenIdentifierRef.current({kind: 'schema', schema: word.word});
                return;
            }
            onOpenIdentifierRef.current({kind: 'table', schema: qualifier, table: word.word});
        });

        // Ctrl+Shift+Enter: mesma resolução de texto que Ctrl+Enter
        // (resolveStatementOrSelection) — mantido como atalho alternativo.
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => {
            if (!onRunSelectionRef.current) return;
            const text = resolveStatementOrSelection(editor);
            if (text) onRunSelectionRef.current(text);
        });

        // Ctrl+\ (atalho do DBeaver) causava uma regressão real e confirmada
        // pelo usuário: registrar esse binding quebrava Ctrl+Enter/
        // Ctrl+Shift+Enter também (provavelmente colisão de scancode em
        // teclado ABNT2/GTK — Backslash fica em posição física bem diferente
        // nesse layout — mecanismo exato não confirmado, sem acesso à janela
        // nativa/devtools daqui). Troquei por Ctrl+Alt+Enter, combinação sem
        // caractere especial, mais segura entre layouts de teclado.
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.Enter, () => {
            const text = resolveStatementOrSelection(editor);
            if (text) onRunNewTabRef.current?.(text);
        });

        return () => {
            const m = editor.getModel();
            if (m) {
                catalogByModel.delete(m);
                driverByModel.delete(m);
                catalogLoaderByModel.delete(m);
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
            catalogLoaderByModel.set(model, () => onCatalogNeededRef.current?.() ?? Promise.resolve());
        }
    }, [catalog, driver]);

    useEffect(() => {
        const editor = editorRef.current;
        if (editor && editor.getValue() !== value) {
            editor.setValue(value);
        }
    }, [value]);

    useEffect(() => {
        editorRef.current?.updateOptions({
            wordWrap: effectiveWordWrap ? 'on' : 'off',
            wrappingIndent: 'indent',
        });
    }, [effectiveWordWrap]);

    return <div ref={containerRef} style={{height: '100%', width: '100%'}} />;
});

export default SqlEditor;
