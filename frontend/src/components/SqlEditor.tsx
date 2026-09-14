import {useEffect, useRef} from 'react';
// Import da API core (não do pacote 'monaco-editor' inteiro, que arrasta os
// language services completos de TypeScript/CSS/HTML/JSON — dezenas de MB —
// e o highlighting de dezenas de linguagens que o Wisp nunca usa). SQL é só
// registrado como "basic language" (tokenizer leve), sem language service
// próprio — ver docs/ARCHITECTURE.md: "sem parser SQL customizado".
import * as monaco from 'monaco-editor/editor/editor.api';
import {conf as sqlConf, language as sqlLanguage} from 'monaco-editor/languages/definitions/sql/sql';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';

// Registro manual do SQL em vez de importar o "basic-languages" agregado
// (que nesta versão do monaco-editor puxa TODAS as linguagens suportadas
// de uma vez, ~90 chunks). Só o tokenizer léxico (Monarch) + configuração
// de comentários/parênteses — sem language service, conforme
// docs/ARCHITECTURE.md ("sem parser SQL customizado").
monaco.languages.register({id: 'sql'});
monaco.languages.setLanguageConfiguration('sql', sqlConf);
monaco.languages.setMonarchTokensProvider('sql', sqlLanguage);

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
    readOnly?: boolean;
}

export default function SqlEditor({value, onChange, onRunRequested, readOnly}: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const onChangeRef = useRef(onChange);
    const onRunRef = useRef(onRunRequested);
    onChangeRef.current = onChange;
    onRunRef.current = onRunRequested;

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
            readOnly: readOnly ?? false,
        });
        editorRef.current = editor;

        editor.onDidChangeModelContent(() => onChangeRef.current(editor.getValue()));
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onRunRef.current());

        return () => editor.dispose();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const editor = editorRef.current;
        if (editor && editor.getValue() !== value) {
            editor.setValue(value);
        }
    }, [value]);

    return <div ref={containerRef} style={{height: '100%', width: '100%'}} />;
}
